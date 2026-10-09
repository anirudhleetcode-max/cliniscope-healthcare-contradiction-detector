import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cloud, FlaskConical, LogIn, RefreshCw, UserPlus } from 'lucide-react';
import { useWorkspace } from '../app/workspace';
import { remoteApi, RemoteError, type RemoteOverview } from '../lib/remote';
import { formatDateTime } from '../lib/dates';
import { Badge, MetricCard, SectionCard } from './ui';

const KIND_LABEL: Record<string, string> = {
  case_shared: 'Case shared', member_added: 'Reviewer added', member_removed: 'Reviewer removed', status_changed: 'Review decision',
  note_added: 'Note added', document_uploaded: 'Document uploaded', analysis_completed: 'Analysis synchronized', case_created: 'Case created',
};

/** Signed-out: the three entry choices. Signed in: totals from the API for the caller's own and shared cases only. */
export function AccountOverview({ onExploreDemo }: { onExploreDemo: () => void }) {
  const ws = useWorkspace();
  const session = ws.session;
  const [data, setData] = useState<RemoteOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!session) return;
    const mine = ++seq.current; // only the latest request may update the view
    setLoading(true); setError(null);
    try {
      const r = await remoteApi.overview(session);
      if (mine === seq.current) setData(r);
    } catch (e) {
      if (mine !== seq.current) return;
      setData(null);
      setError(e instanceof RemoteError && e.status === 401 ? 'Your session has expired. Sign in again under Settings → Shared workspace.' : `Server data could not be loaded: ${(e as Error).message}`);
    } finally { if (mine === seq.current) setLoading(false); }
  }, [session]);

  useEffect(() => { setData(null); setError(null); if (session) void load(); }, [session, load]);

  if (!session) {
    return (
      <SectionCard title="Welcome to MedGuard" testId="entry-choices">
        <p className="text-sm text-muted">Review healthcare records, identify potential contradictions and manage the evidence with other reviewers. Below is a fictional demo workspace stored only in this browser; sign in to work on cases saved on the server.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/settings#workspace" className="btn-primary" data-testid="entry-sign-in"><LogIn size={16} aria-hidden />Sign in</Link>
          <Link to="/settings#workspace" state={{ mode: 'register' }} className="btn-secondary" data-testid="entry-register"><UserPlus size={16} aria-hidden />Create account</Link>
          <button className="btn-secondary" onClick={onExploreDemo} data-testid="entry-demo"><FlaskConical size={16} aria-hidden />Explore demo</button>
        </div>
      </SectionCard>
    );
  }

  const t = data?.totals;
  return (
    <SectionCard
      title={<span className="flex items-center gap-2">Your shared workspace <Badge tone="brand" icon={<Cloud size={12} aria-hidden />}>SERVER DATA</Badge></span>}
      testId="account-overview"
      actions={<button className="btn-secondary py-1.5" onClick={() => void load()} disabled={loading} data-testid="overview-refresh" aria-busy={loading}><RefreshCw size={14} aria-hidden className={loading ? 'animate-spin' : undefined} />{loading ? 'Refreshing…' : 'Refresh'}</button>}
    >
      <p className="mb-3 text-sm text-muted">Signed in as <strong>{session.user.displayName}</strong>. These figures come from the server and cover only cases you own or that were shared with you. The local demo below is separate.</p>
      {error ? (
        <div className="rounded-lg border border-line bg-soft px-3 py-2 text-sm" role="alert" data-testid="overview-error">{error} <button className="ml-2 font-semibold text-brand underline" onClick={() => void load()}>Retry</button></div>
      ) : !t ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true" data-testid="overview-loading">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-panel bg-soft" />)}</div>
      ) : t.cases === 0 ? (
        <div className="text-sm" data-testid="overview-empty">You don&apos;t have any server cases yet. <Link to="/cases" className="font-semibold text-brand underline">Create a shared case</Link> to start.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="overview-totals">
            <MetricCard label="Cases" value={t.cases} hint={`${t.owned} owned · ${t.shared} shared with you`} to="/cases" testId="ov-cases" />
            <MetricCard label="Documents" value={t.documents} testId="ov-documents" />
            <MetricCard label="Findings awaiting review" value={t.awaitingReview} tone={t.awaitingReview ? 'warn' : 'ok'} testId="ov-awaiting" />
            <MetricCard label="Findings reviewed" value={t.reviewed} hint={`of ${t.findings} current findings`} testId="ov-reviewed" />
          </div>
          {data!.recentActivity.length ? (
            <ul className="mt-4 divide-y divide-line text-sm" data-testid="overview-activity">
              {data!.recentActivity.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span><strong>{KIND_LABEL[e.kind] ?? e.kind}</strong>{e.detail ? ` · ${e.detail}` : ''} <span className="text-muted">by {e.actor.replace(/\s*<[^>]*>$/, '')}</span></span>
                  <span className="text-xs text-faint">{formatDateTime(e.at)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
