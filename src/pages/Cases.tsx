import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Cloud, FileText, FolderOpen, FolderPlus, Search, Share2, Trash2, Upload } from 'lucide-react';
import { db, useApp, useWorkspaceData } from '../app/state';
import { useWorkspace } from '../app/workspace';
import { CaseStateBadge } from '../components/clinical';
import { DemoControls } from '../components/DemoControls';
import { Badge, ConfirmDialog, EmptyState, FilterChip, Modal, PageHeader, PageSkeleton, ProgressBar, SearchInput, SectionCard, SelectField, cx } from '../components/ui';
import { formatDateTime } from '../lib/dates';
import { CASE_STATE_LABEL, summarizeCase, type CaseReviewState, type CaseSummary } from '../lib/metrics';
import { createCase, deleteCase } from '../lib/services';
import { restoreBackup } from '../lib/exportCase';
import { applySnapshot, remoteApi, type RemoteCaseSummary } from '../lib/remote';
import type { CaseRecord, Category } from '../lib/types';
import { CATEGORY_LABEL } from '../lib/types';

const PAGE = 10;
type Sort = 'updated' | 'findings' | 'id';

export function Cases() {
  const { setCaseId, toast, reviewer } = useApp();
  const { cases, documents, findings, loading } = useWorkspaceData();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(params.get('new') === '1');
  const [label, setLabel] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [toDelete, setToDelete] = useState<CaseRecord | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [shared, setShared] = useState<RemoteCaseSummary[] | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!ws.session) { setShared(null); return; }
    remoteApi.listCases(ws.session).then((r) => setShared(r.cases)).catch(() => setShared(null));
  }, [ws.session, cases]);

  const q = params.get('q') ?? '';
  const state = (params.get('state') ?? 'all') as CaseReviewState | 'all';
  const severity = params.get('severity') ?? 'all';
  const category = (params.get('category') ?? 'all') as Category | 'all';
  const sort = (params.get('sort') ?? 'updated') as Sort;
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (!v || v === 'all' || (k === 'sort' && v === 'updated')) n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
    setPage(0);
  };

  const rows = useMemo<CaseSummary[]>(() => {
    if (loading) return [];
    const term = q.trim().toLowerCase();
    const list = cases!.map((c) => summarizeCase(c, documents!, findings!)).filter((s) => {
      if (term && !`${s.caseRecord.label} ${s.caseRecord.demoScenario ?? ''}`.toLowerCase().includes(term)) return false;
      if (state !== 'all' && !(state === 'reviewed' ? s.state === 'reviewed' || s.state === 'no_findings' : s.state === state)) return false;
      if (severity === 'high' && s.highCount === 0) return false;
      if (category !== 'all' && !s.categories.has(category)) return false;
      return true;
    });
    return list.sort((a, b) => sort === 'findings' ? b.findingCount - a.findingCount || a.displayId.localeCompare(b.displayId)
      : sort === 'id' ? a.displayId.localeCompare(b.displayId) : b.lastActivity.localeCompare(a.lastActivity));
  }, [loading, cases, documents, findings, q, state, severity, category, sort]);

  if (loading) return <PageSkeleton />;

  const create = async () => {
    try {
      const c = await createCase(db, label, { actor: reviewer });
      setLabel('');
      setNewOpen(false);
      setCaseId(c.id);
      toast('success', `Case "${c.label}" created. Upload documents to begin.`);
      navigate(`/cases/${c.id}`);
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not create case'); }
  };
  const createShared = async () => {
    try {
      const snap = await remoteApi.createCase(ws.requireSession(), undefined, label);
      await applySnapshot(db, ws.session!.serverUrl, snap);
      setLabel('');
      setNewOpen(false);
      setCaseId(snap.case.id);
      toast('success', `Shared case "${snap.case.label}" created on the shared workspace.`);
      navigate(`/cases/${snap.case.id}`);
    } catch (e) { toast('error', (e as Error).message); }
  };
  const onRestore = async (file: File | undefined) => {
    if (!file) return;
    setRestoring(true);
    try {
      if (file.size > 200 * 1048576) throw new Error('The file is larger than 200 MB.');
      let raw: unknown;
      try { raw = JSON.parse(await file.text()); } catch { throw new Error('The file is not valid JSON.'); }
      const c = await restoreBackup(db, raw);
      setCaseId(c.id);
      toast('success', `Backup restored as a new case: "${c.label}".`);
      navigate(`/cases/${c.id}`);
    } catch (err) {
      toast('error', `Restore failed — nothing was changed. ${(err as Error).message}`);
    } finally {
      setRestoring(false);
    }
  };

  const chips: [string, string][] = [];
  if (q) chips.push(['q', `Search: ${q}`]);
  if (state !== 'all') chips.push(['state', `Status: ${CASE_STATE_LABEL[state]}`]);
  if (severity !== 'all') chips.push(['severity', 'Has high-priority findings']);
  if (category !== 'all') chips.push(['category', `Category: ${CATEGORY_LABEL[category]}`]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="animate-fade-up">
      <PageHeader title="Clinical Cases" description="Browse and review clinical record sets in the local demonstration workspace. Records are only compared within a single case."
        actions={<>
          <label className={cx('btn-secondary cursor-pointer', restoring && 'pointer-events-none opacity-60')}>
            <Upload size={16} aria-hidden />{restoring ? 'Validating…' : 'Restore backup'}
            <input type="file" accept=".json,application/json" className="sr-only" data-testid="restore-input" disabled={restoring} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onRestore(f); }} />
          </label>
          <button className="btn-primary" onClick={() => setNewOpen(true)} data-testid="new-case"><FolderPlus size={16} aria-hidden />New case</button>
        </>} />

      <div className="card mb-4 p-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-12">
          <SearchInput className="xl:col-span-4" value={q} onChange={(v) => set('q', v)} placeholder="Search case ID or patient alias…" label="Search cases" testId="case-search" />
          <SelectField className="xl:col-span-2" value={state} onChange={(v) => set('state', v)} label="Review status" testId="case-state-filter" options={[{ value: 'all', label: 'All statuses' }, ...(['awaiting_analysis', 'not_started', 'in_progress', 'reviewed', 'empty'] as CaseReviewState[]).map((s) => ({ value: s, label: CASE_STATE_LABEL[s] }))]} />
          <SelectField className="xl:col-span-2" value={severity} onChange={(v) => set('severity', v)} label="Severity" testId="case-severity-filter" options={[{ value: 'all', label: 'Any severity' }, { value: 'high', label: 'Has high priority' }]} />
          <SelectField className="xl:col-span-2" value={category} onChange={(v) => set('category', v)} label="Category" options={[{ value: 'all', label: 'All categories' }, ...(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]} />
          <SelectField className="xl:col-span-2" value={sort} onChange={(v) => set('sort', v)} label="Sort" testId="case-sort" options={[{ value: 'updated', label: 'Sort: last activity' }, { value: 'findings', label: 'Sort: most findings' }, { value: 'id', label: 'Sort: case ID' }]} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="mr-1">{rows.length} of {cases!.length} cases</span>
          {chips.map(([k, l]) => <FilterChip key={k} label={l} onRemove={() => set(k, '')} />)}
          {chips.length ? <button className="ml-1 font-medium text-brand hover:underline" onClick={() => setParams(new URLSearchParams(sort !== 'updated' ? { sort } : {}), { replace: true })}>Clear filters</button> : null}
        </div>
      </div>

      {cases!.length === 0 ? (
        <EmptyState icon={<FolderOpen size={19} />} title="No cases yet" body="Load the synthetic demonstration workspace or create a case for your own synthetic documents." action={<><DemoControls compact /></>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search size={19} />} title="No cases match these filters" body="Remove a filter or clear the search." action={<button className="btn-secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button>} />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="table" data-testid="cases-table">
              <thead><tr>
                <th scope="col">Case</th><th scope="col">Patient alias</th><th scope="col" className="text-right">Documents</th><th scope="col" className="text-right">Findings</th>
                <th scope="col" className="text-right">High priority</th><th scope="col" className="w-[170px]">Review progress</th><th scope="col">Status</th><th scope="col">Last activity</th><th scope="col"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.caseRecord.id} className="row-link" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) navigate(`/cases/${s.caseRecord.id}`); }}>
                    <td>
                      <Link to={`/cases/${s.caseRecord.id}`} className="font-mono text-[13px] font-semibold text-ink hover:text-brand" data-testid="case-link">{s.displayId}</Link>
                      <div className="mt-1 flex gap-1">{s.caseRecord.isDemo ? <Badge tone="dark">Synthetic</Badge> : <Badge>Local</Badge>}{s.caseRecord.remote ? <Badge tone="ok" icon={<Cloud size={11} aria-hidden />}>Shared · {s.caseRecord.remote.role}</Badge> : null}</div>
                    </td>
                    <td className="max-w-[260px]"><div className="truncate">{s.alias}</div>{s.caseRecord.demoScenario ? <div className="truncate text-xs text-faint" title={s.caseRecord.demoScenario}>{s.caseRecord.demoScenario}</div> : null}</td>
                    <td className="text-right tabular-nums"><span className="inline-flex items-center gap-1"><FileText size={13} className="text-faint" aria-hidden />{s.documentCount}</span></td>
                    <td className="text-right font-medium tabular-nums">{s.findingCount}</td>
                    <td className="text-right tabular-nums">{s.highCount ? <span className="font-semibold text-crit">{s.highCount}</span> : <span className="text-faint">0</span>}</td>
                    <td>{s.findingCount ? <div><ProgressBar value={s.decidedCount / s.findingCount} label={`${s.decidedCount} of ${s.findingCount} decided`} tone={s.pendingCount ? 'brand' : 'ok'} /><div className="mt-1 text-[11.5px] text-muted">{s.decidedCount} of {s.findingCount} decided</div></div> : <span className="text-xs text-faint">—</span>}</td>
                    <td><CaseStateBadge state={s.state} /></td>
                    <td className="whitespace-nowrap text-xs tabular-nums text-muted">{formatDateTime(s.lastActivity)}</td>
                    <td className="whitespace-nowrap text-right">
                      {!s.caseRecord.remote && ws.session ? <button className="btn-ghost btn-sm" disabled={sharing === s.caseRecord.id} data-testid={`publish-${s.caseRecord.id}`} onClick={async () => {
                        setSharing(s.caseRecord.id);
                        try { await ws.publishCase(s.caseRecord); toast('success', `"${s.caseRecord.label}" is now stored in the shared workspace.`); } catch (e) { toast('error', (e as Error).message); } finally { setSharing(null); }
                      }}><Share2 size={14} aria-hidden />{sharing === s.caseRecord.id ? 'Publishing…' : 'Publish'}</button> : null}
                      {!s.caseRecord.isDemo ? <button className="btn-icon h-8 w-8 hover:text-crit" onClick={() => setToDelete(s.caseRecord)} aria-label={`Delete case ${s.caseRecord.label}`} title="Delete case"><Trash2 size={15} /></button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {shown.map((s) => (
              <li key={s.caseRecord.id}>
                <Link to={`/cases/${s.caseRecord.id}`} className="block px-4 py-3.5 active:bg-hover">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-[13px] font-semibold">{s.displayId}</span><CaseStateBadge state={s.state} /></div>
                  <div className="mt-0.5 text-[13.5px] text-muted">{s.alias}</div>
                  <div className="mt-2 flex gap-4 text-xs text-muted"><span>{s.documentCount} documents</span><span>{s.findingCount} findings</span>{s.highCount ? <span className="font-semibold text-crit">{s.highCount} high</span> : null}</div>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
              <span>Page {page + 1} of {pages}</span>
              <div className="flex gap-2"><button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button></div>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Demonstration data" description="Six fictional cases, 16 synthetic records">
          <p className="mb-3 text-[13.5px] text-muted">Reset removes and recreates <strong>only the synthetic demonstration cases</strong>; cases you created are never touched.</p>
          <DemoControls compact />
        </SectionCard>
        <SectionCard title="Where is this data stored?">
          <p className="text-[13.5px] text-muted">Local cases exist only in this browser's IndexedDB — not on a server, not shared with other users or devices. Shared cases (optional, only when a shared-workspace server is configured) are cached locally; the server copy is authoritative. Use pseudonymous labels and synthetic documents only.</p>
        </SectionCard>
      </div>

      {ws.session ? (
        <SectionCard className="mt-6" title="Shared workspace cases you can access" icon={<Cloud size={16} aria-hidden />} description={`From ${ws.session.serverUrl} as ${ws.session.user.displayName}`} bodyClassName="p-0" testId="shared-cases">
          {!shared ? <p className="px-5 py-4 text-sm text-muted">Loading…</p> : shared.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No shared cases yet.</p> : (
            <ul className="divide-y divide-line">
              {shared.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1"><div className="font-medium">{r.label} <Badge className="ml-1">{r.role}</Badge></div><div className="text-xs text-muted">Owner {r.owner} · {r.documents} documents · {r.findings} findings · updated {formatDateTime(r.updatedAt)}</div></div>
                  <button className="btn-secondary btn-sm" data-testid={`open-shared-${r.id}`} onClick={async () => {
                    try { await ws.pull(r.id); setCaseId(r.id); navigate(`/cases/${r.id}`); } catch (e) { toast('error', (e as Error).message); }
                  }}>Open shared case</button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New case" description="Records are only compared within one case." footer={<>
        <button className="btn-secondary" onClick={() => setNewOpen(false)}>Cancel</button>
        {ws.session ? <button className="btn-secondary" disabled={!label.trim()} data-testid="create-shared-case" onClick={createShared}><Cloud size={15} aria-hidden />Create in shared workspace</button> : null}
        <button className="btn-primary" onClick={create} disabled={!label.trim()} data-testid="create-case"><FolderPlus size={15} aria-hidden />Create local case</button>
      </>}>
        <label htmlFor="case-label" className="label">Pseudonymous case label</label>
        <input id="case-label" className="input" placeholder="e.g. CASE-0201 · Ward review" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} onKeyDown={(e) => { if (e.key === 'Enter' && label.trim()) void create(); }} data-testid="new-case-label" data-autofocus />
        <p className="mt-2 text-xs text-muted">Do not enter real names, dates of birth or record numbers. Use a format such as <span className="font-mono">ID · description</span> so the ID and alias display separately.</p>
        {!ws.session ? <p className="mt-2 text-xs text-faint">The case is stored only in this browser.</p> : null}
      </Modal>

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} title="Delete case?" danger confirmLabel="Delete permanently"
        onConfirm={async () => { if (toDelete) { await deleteCase(db, toDelete.id); toast('success', `Case "${toDelete.label}" deleted.`); } setToDelete(null); }}>
        <p className="text-sm">{toDelete?.remote ? <>This removes the local copy of the shared case <strong>{toDelete?.label}</strong> from this browser. The shared-workspace copy is not affected.</> : <>This permanently deletes <strong>{toDelete?.label}</strong> and all its documents, findings and history from this browser.</>}</p>
      </ConfirmDialog>
    </div>
  );
}
