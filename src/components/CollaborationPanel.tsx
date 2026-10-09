import { useEffect, useState } from 'react';
import { RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import { db, useApp } from '../app/state';
import { useWorkspace } from '../app/workspace';
import { applySnapshot, remoteApi, type RemoteMember } from '../lib/remote';
import { formatDateTime } from '../lib/dates';
import type { CaseRecord } from '../lib/types';

/** Owner, collaborators and sharing controls for a case stored in the shared workspace. Data comes from the server only. */
export function CollaborationPanel({ c }: { c: CaseRecord }) {
  const ws = useWorkspace();
  const { toast } = useApp();
  const [members, setMembers] = useState<RemoteMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'reviewer' | 'viewer'>('reviewer');
  const [busy, setBusy] = useState(false);
  const signedIn = !!ws.session && ws.session.serverUrl === c.remote?.serverUrl;

  useEffect(() => {
    if (!signedIn || !ws.session) { setMembers(null); return; }
    remoteApi.getCase(ws.session, c.id).then((s) => setMembers(s.members)).catch(() => setMembers(null));
  }, [signedIn, ws.session, c.id, c.updatedAt]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card p-5" aria-label="Collaboration" data-testid="collaboration-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Users size={17} className="text-brand" aria-hidden />Shared case collaborators</h2>
        {signedIn ? <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => act(async () => { await ws.pull(c.id); toast('info', 'Refreshed from the shared workspace.'); })}><RefreshCw size={13} />Refresh now</button> : null}
      </div>
      <p className="mb-3 text-xs text-muted">Owner: <span className="font-medium text-ink">{c.remote?.owner}</span> · your role: <span className="font-medium text-ink">{c.remote?.role}</span> · last synchronized {formatDateTime(c.remote?.syncedAt)} · updates are fetched every 15 s while this case is open.</p>
      {!signedIn ? <p className="text-sm text-warn">Sign in to the shared workspace (About &amp; settings) to see collaborators and synchronize.</p> : !members ? <p className="text-sm text-muted">Loading collaborators…</p> : (
        <ul className="divide-y divide-line text-sm" data-testid="member-list">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">{m.displayName} <span className="text-xs text-muted">&lt;{m.email}&gt;</span></span>
              <span className="flex items-center gap-2"><span className="chip bg-soft text-ink">{m.role}</span>
                {c.remote?.role === 'owner' && m.role !== 'owner' ? <button className="text-crit" aria-label={`Remove ${m.email}`} disabled={busy} onClick={() => act(async () => { const s = await remoteApi.removeMember(ws.requireSession(), c.id, m.userId); await applySnapshot(db, ws.session!.serverUrl, s); setMembers(s.members); })}><Trash2 size={14} /></button> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {signedIn && c.remote?.role === 'owner' ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="input" type="email" placeholder="colleague@example.org (must have an account)" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Collaborator email" data-testid="member-email" />
          <select className="input sm:w-36" value={role} onChange={(e) => setRole(e.target.value as 'reviewer' | 'viewer')} aria-label="Role"><option value="reviewer">Reviewer</option><option value="viewer">Viewer (read-only)</option></select>
          <button className="btn-primary" disabled={busy || !email} data-testid="add-member" onClick={() => act(async () => { const s = await remoteApi.addMember(ws.requireSession(), c.id, email, role); await applySnapshot(db, ws.session!.serverUrl, s); setMembers(s.members); setEmail(''); toast('success', `${email} can now access this case as ${role}.`); })}><UserPlus size={15} />Share</button>
        </div>
      ) : null}
    </section>
  );
}
