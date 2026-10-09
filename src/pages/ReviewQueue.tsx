import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Inbox } from 'lucide-react';
import { useWorkspaceData } from '../app/state';
import { DecisionHistory, EvidenceComparison, ReviewPanel, useFindingDocs, useFindingEvents } from '../components/review/Review';
import { Callout, EmptyState, MetricCard, PageHeader, PageSkeleton, SearchInput, SelectField, SeverityBadge, StatusBadge, cx } from '../components/ui';
import { formatDateTime } from '../lib/dates';
import { SEVERITY_ORDER, isPending, severityOf, splitLabel } from '../lib/metrics';
import { PENDING_STATUSES } from '../lib/review';
import type { CaseRecord, Category, Finding, ReviewStatus } from '../lib/types';
import { CATEGORY_LABEL, REVIEW_STATUS_LABEL } from '../lib/types';

export function ReviewQueue() {
  const { cases, findings, loading } = useWorkspaceData();
  const [params, setParams] = useSearchParams();
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (!v || v === 'all') n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
  };
  const caseMap = useMemo(() => new Map((cases ?? []).map((c) => [c.id, c])), [cases]);
  const view = params.get('view') ?? 'pending';
  const q = (params.get('q') ?? '').toLowerCase();
  const all = useMemo(() => (findings ?? []).filter((f) => !f.stale && caseMap.has(f.caseId)), [findings, caseMap]);
  const rows = useMemo(() => all.filter((f) => {
    if (view === 'pending' && !isPending(f)) return false;
    if (view !== 'pending' && view !== 'all' && f.reviewStatus !== view) return false;
    if (params.get('severity') && severityOf(f) !== params.get('severity')) return false;
    if (params.get('category') && f.category !== params.get('category')) return false;
    if (params.get('case') && f.caseId !== params.get('case')) return false;
    if (q && !`${f.title} ${f.displayId} ${caseMap.get(f.caseId)?.label}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => params.get('sort') === 'recent' ? b.updatedAt.localeCompare(a.updatedAt) : SEVERITY_ORDER.indexOf(severityOf(a)) - SEVERITY_ORDER.indexOf(severityOf(b)) || b.updatedAt.localeCompare(a.updatedAt)), [all, view, params, q, caseMap]);

  if (loading) return <PageSkeleton />;
  const count = (s: ReviewStatus) => all.filter((f) => f.reviewStatus === s).length;
  const selected = rows.find((f) => f.id === params.get('f')) ?? rows[0];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Review Queue" description="Review potential documentation inconsistencies and record decisions." meta={<span className="chip bg-warn-50 text-warn">Local demonstration — decisions stay in this browser</span>} />
      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Queue summary" data-testid="queue-summary">
        <MetricCard label="Pending" value={count('unreviewed')} to="/queue?view=unreviewed" />
        <MetricCard label="In review" value={count('in_review')} tone="brand" to="/queue?view=in_review" />
        <MetricCard label="Confirmed" value={count('confirmed')} tone="crit" to="/queue?view=confirmed" />
        <MetricCard label="Dismissed" value={count('dismissed')} to="/queue?view=dismissed" />
        <MetricCard label="Needs more info" value={count('needs_info')} tone="warn" to="/queue?view=needs_info" />
      </section>

      <div className="card mb-4 grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-6">
        <SearchInput className="xl:col-span-2" value={params.get('q') ?? ''} onChange={(v) => set('q', v)} placeholder="Search pending findings…" label="Search queue" testId="review-search" />
        <SelectField value={view} onChange={(v) => set('view', v === 'pending' ? null : v)} label="Status" testId="queue-view" options={[{ value: 'pending', label: 'Pending only' }, { value: 'all', label: 'All statuses' }, ...(Object.keys(REVIEW_STATUS_LABEL) as ReviewStatus[]).map((s) => ({ value: s, label: REVIEW_STATUS_LABEL[s] }))]} />
        <SelectField value={params.get('severity') ?? 'all'} onChange={(v) => set('severity', v)} label="Severity" options={[{ value: 'all', label: 'Any severity' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Informational' }]} />
        <SelectField value={params.get('category') ?? 'all'} onChange={(v) => set('category', v)} label="Category" options={[{ value: 'all', label: 'All categories' }, ...(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]} />
        <SelectField value={params.get('sort') ?? 'priority'} onChange={(v) => set('sort', v === 'priority' ? null : v)} label="Sort" options={[{ value: 'priority', label: 'Sort: priority' }, { value: 'recent', label: 'Recently updated' }]} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Inbox size={19} />} title={view === 'pending' ? 'Nothing is waiting for review' : 'No findings match'} body={view === 'pending' ? 'All findings have a recorded decision, or no case has been analysed yet.' : 'Change the filters to see more findings.'} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
          <ul className="card max-h-none divide-y divide-line overflow-hidden xl:max-h-[calc(100vh-180px)] xl:overflow-y-auto" data-testid="review-list">
            {rows.map((f) => (
              <li key={f.id}>
                <button onClick={() => set('f', f.id)} aria-current={selected?.id === f.id ? 'true' : undefined} className={cx('w-full px-4 py-3 text-left transition-colors', selected?.id === f.id ? 'bg-brand-50' : 'hover:bg-hover')} data-testid="review-item">
                  <div className="flex items-center gap-1.5"><SeverityBadge severity={severityOf(f)} compact /><span className="text-xs text-muted">{CATEGORY_LABEL[f.category]}</span><span className="ml-auto font-mono text-[11px] text-faint">{splitLabel(caseMap.get(f.caseId)?.label ?? '').displayId}</span></div>
                  <div className="mt-1 text-[13.5px] font-medium leading-snug">{f.title}</div>
                  <div className="mt-1.5 flex items-center gap-2"><StatusBadge status={f.reviewStatus} /><span className="text-[11.5px] text-faint">{f.evidence.length} sources · {formatDateTime(f.updatedAt)}</span><span className="ml-auto text-xs font-semibold text-brand">Review</span></div>
                </button>
              </li>
            ))}
          </ul>
          {selected ? <Workspace finding={selected} caseRec={caseMap.get(selected.caseId)} /> : null}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Pending = {PENDING_STATUSES.map((s) => REVIEW_STATUS_LABEL[s]).join(', ')}.</p>
    </div>
  );
}

function Workspace({ finding, caseRec }: { finding: Finding; caseRec: CaseRecord | undefined }) {
  const docs = useFindingDocs(finding);
  const events = useFindingEvents(finding.id);
  return (
    <div className="min-w-0 space-y-5" data-testid="review-workspace">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-faint">{finding.displayId}</span><SeverityBadge severity={severityOf(finding)} /><StatusBadge status={finding.reviewStatus} /><Link to={`/findings/${finding.id}`} className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">Full page<ExternalLink size={13} /></Link></div>
        <h2 className="mt-2 text-[19px] font-semibold leading-snug">{finding.title}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{finding.explanation}</p>
      </div>
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        {docs ? <EvidenceComparison finding={finding} docs={docs} compact /> : <div />}
        <div className="space-y-5">
          <ReviewPanel finding={finding} caseRec={caseRec} />
          {events ? <DecisionHistory finding={finding} events={events} /> : null}
          <Callout tone="info">Decisions are recorded locally and are not shared with another user or any hospital system.</Callout>
        </div>
      </div>
    </div>
  );
}
