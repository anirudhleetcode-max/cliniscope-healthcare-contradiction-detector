import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { FolderPlus, RotateCcw, Trash2 } from 'lucide-react';
import { db, useApp } from '../app/state';
import { Callout, Modal, PageHeader, PageSkeleton, cx } from '../components/ui';
import { formatDateTime } from '../lib/dates';
import { createCase, deleteCase } from '../lib/services';
import { useWorkspace } from '../app/workspace';
import { applySnapshot, remoteApi, type RemoteCaseSummary } from '../lib/remote';
import { useEffect } from 'react';
import { Cloud, Share2 } from 'lucide-react';
import type { CaseRecord } from '../lib/types';

export function Cases() {
  const { cases, caseId, setCaseId, toast, resetDemo, seeding, reviewer } = useApp();
  const ws = useWorkspace();
  const [shared, setShared] = useState<RemoteCaseSummary[] | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  useEffect(() => {
    if (!ws.session) { setShared(null); return; }
    remoteApi.listCases(ws.session).then((r) => setShared(r.cases)).catch(() => setShared(null));
  }, [ws.session, cases]);
  const [params] = useSearchParams();
  const [label, setLabel] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [toDelete, setToDelete] = useState<CaseRecord | null>(null);
  const navigate = useNavigate();
  const counts = useLiveQuery(async () => {
    const out: Record<string, { docs: number; findings: number }> = {};
    for (const c of cases ?? []) out[c.id] = { docs: await db.documents.where('caseId').equals(c.id).count(), findings: await db.findings.where('caseId').equals(c.id).count() };
    return out;
  }, [cases]);
  if (!cases || !counts) return <PageSkeleton />;

  const create = async () => {
    try {
      const c = await createCase(db, label, { actor: reviewer });
      setLabel('');
      setCaseId(c.id);
      toast('success', `Case "${c.label}" created. Upload documents to begin.`);
      navigate('/documents');
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not create case'); }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow="Cases" title="Case management" description="Records are only ever compared within a single case. Use pseudonymous labels — do not enter real names, dates of birth or record numbers." />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-5" aria-label="Create case">
          <h2 className="mb-3 text-base font-semibold">New case</h2>
          <label htmlFor="case-label" className="label">Pseudonymous case label</label>
          <input id="case-label" className="input" placeholder="e.g. CASE-0107 · Ward review" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} autoFocus={params.get('new') === '1'} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} data-testid="new-case-label" />
          <button className="btn-primary mt-3 w-full" onClick={create} disabled={!label.trim()} data-testid="create-case"><FolderPlus size={16} />Create local case</button>
          {ws.session ? <button className="btn-secondary mt-2 w-full" disabled={!label.trim()} data-testid="create-shared-case" onClick={async () => {
            try {
              const snap = await remoteApi.createCase(ws.requireSession(), undefined, label);
              await applySnapshot(db, ws.session!.serverUrl, snap);
              setLabel('');
              setCaseId(snap.case.id);
              toast('success', `Shared case "${snap.case.label}" created on the shared workspace.`);
              navigate('/documents');
            } catch (e) { toast('error', (e as Error).message); }
          }}><Cloud size={16} />Create in shared workspace</button> : <p className="mt-2 text-xs text-muted">Sign in to a shared workspace (About &amp; settings) to create cases other reviewers can access.</p>}
          <div className="mt-6 border-t border-line pt-4">
            <h3 className="mb-1 text-sm font-semibold">Synthetic demo case</h3>
            <p className="mb-3 text-xs text-muted">Re-creates DEMO-0042 from the bundled fictional files. Only the demo case is reset; your own cases are not touched.</p>
            <button className="btn-secondary w-full" onClick={() => setConfirmReset(true)} disabled={seeding} data-testid="reset-demo"><RotateCcw size={15} />{seeding ? 'Resetting…' : 'Reset demo case'}</button>
          </div>
        </section>
        <section className="card overflow-hidden lg:col-span-2" aria-label="All cases">
          <ul className="divide-y divide-line">
            {cases.map((c) => (
              <li key={c.id} className={cx('flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center', c.id === caseId && 'bg-brand-50/40')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.label}</span>{c.isDemo ? <span className="chip bg-ink text-white">Synthetic demo</span> : null}{c.remote ? <span className="chip bg-ok-50 text-ok"><Cloud size={11} />Shared · {c.remote.role}</span> : <span className="chip bg-soft text-muted">Local only</span>}{c.id === caseId ? <span className="chip bg-brand-50 text-brand-700">Open</span> : null}</div>
                  <div className="text-xs text-muted">{counts[c.id]?.docs ?? 0} documents · {counts[c.id]?.findings ?? 0} findings · created {formatDateTime(c.createdAt)} · last analysis {c.lastAnalyzedAt ? formatDateTime(c.lastAnalyzedAt) : 'never'}</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary py-1.5" onClick={() => { setCaseId(c.id); navigate('/'); }}>Open</button>
                  {!c.remote && ws.session ? <button className="btn-secondary py-1.5" disabled={sharing === c.id} data-testid={`publish-${c.id}`} onClick={async () => {
                    setSharing(c.id);
                    try { await ws.publishCase(c); toast('success', `"${c.label}" is now stored in the shared workspace. Add collaborators from the Overview.`); } catch (e) { toast('error', (e as Error).message); } finally { setSharing(null); }
                  }}><Share2 size={14} />{sharing === c.id ? 'Publishing…' : 'Publish to workspace'}</button> : null}
                  {!c.isDemo ? <button className="btn-ghost px-2 text-crit" onClick={() => setToDelete(c)} aria-label={`Delete case ${c.label}`}><Trash2 size={15} /></button> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {ws.session ? (
        <section className="card mt-6 overflow-hidden" aria-label="Shared workspace cases" data-testid="shared-cases">
          <div className="border-b border-line px-5 py-3"><h2 className="flex items-center gap-2 text-base font-semibold"><Cloud size={16} className="text-brand" />Shared workspace cases you can access</h2><p className="text-xs text-muted">From {ws.session.serverUrl} as {ws.session.user.displayName}. Access is granted by each case owner.</p></div>
          {!shared ? <p className="px-5 py-4 text-sm text-muted">Loading…</p> : shared.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No shared cases yet.</p> : (
            <ul className="divide-y divide-line">
              {shared.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1"><div className="font-medium">{r.label} <span className="chip ml-1 bg-soft text-ink">{r.role}</span></div><div className="text-xs text-muted">Owner {r.owner} · {r.documents} documents · {r.findings} findings · updated {formatDateTime(r.updatedAt)}</div></div>
                  <button className="btn-secondary py-1.5" data-testid={`open-shared-${r.id}`} onClick={async () => {
                    try { await ws.pull(r.id); setCaseId(r.id); navigate('/'); } catch (e) { toast('error', (e as Error).message); }
                  }}>Open shared case</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <div className="mt-6"><Callout tone="info" title="Where is this data stored?">Local cases are stored only in this browser's IndexedDB. Shared cases are stored on the shared-workspace server and cached locally; the server copy is authoritative and only members of the case can read it.</Callout></div>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset the demo case?" footer={<>
        <button className="btn-secondary" onClick={() => setConfirmReset(false)}>Cancel</button>
        <button className="btn-danger" data-testid="confirm-reset" onClick={async () => { setConfirmReset(false); const c = await resetDemo(); if (c) { toast('success', 'Demo case reset. Run the analysis to regenerate findings.'); navigate('/'); } else toast('error', 'Demo reset failed.'); }}>Reset demo</button>
      </>}><p className="text-sm">This deletes the synthetic demo case, including its review decisions and audit history, and re-ingests the four fictional documents. Other cases are not affected.</p></Modal>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Delete case?" footer={<>
        <button className="btn-secondary" onClick={() => setToDelete(null)}>Cancel</button>
        <button className="btn-danger" onClick={async () => { if (toDelete) { await deleteCase(db, toDelete.id); toast('success', `Case "${toDelete.label}" deleted.`); } setToDelete(null); }}>Delete permanently</button>
      </>}><p className="text-sm">{toDelete?.remote ? <>This removes the local copy of the shared case <strong>{toDelete?.label}</strong> from this browser. The shared-workspace copy, its review decisions and audit history are not affected.</> : <>This permanently deletes <strong>{toDelete?.label}</strong> and all its documents, findings and audit history from this browser.</>}</p></Modal>
    </div>
  );
}
