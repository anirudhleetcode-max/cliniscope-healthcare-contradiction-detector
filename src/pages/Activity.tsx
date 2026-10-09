import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileUp, FolderOpen, MessageSquare, RotateCcw, Sparkles, UserCheck } from 'lucide-react';
import { useWorkspaceData } from '../app/state';
import { Badge, Callout, EmptyState, FilterChip, PageHeader, PageSkeleton, SearchInput, SelectField, cx } from '../components/ui';
import { formatDateTime } from '../lib/dates';
import { splitLabel } from '../lib/metrics';
import type { AuditEvent, CaseRecord, DocumentRecord, EventKind, Finding } from '../lib/types';
import { REVIEW_STATUS_LABEL } from '../lib/types';

export function describeEvent(e: AuditEvent, findings: Finding[], docs: DocumentRecord[]): { title: string; body?: string } {
  const f = e.findingId ? findings.find((x) => x.id === e.findingId) : undefined;
  const d = e.documentId ? docs.find((x) => x.id === e.documentId) : undefined;
  const fRef = f ? `${f.displayId}` : 'finding';
  switch (e.kind) {
    case 'case_created': return { title: 'Case created', body: e.detail };
    case 'document_uploaded': return { title: `Document imported: ${d?.title ?? 'deleted document'}`, body: e.detail };
    case 'document_extracted': return { title: `Text extracted: ${d?.title ?? 'deleted document'}`, body: e.detail };
    case 'document_failed': return { title: `Extraction problem: ${d?.title ?? 'deleted document'}`, body: e.detail };
    case 'document_deleted': return { title: 'Document removed', body: e.detail };
    case 'analysis_started': return { title: 'Analysis started', body: e.detail };
    case 'analysis_failed': return { title: 'Analysis failed', body: e.detail };
    case 'analysis_completed': {
      try {
        const s = JSON.parse(e.detail ?? '{}');
        return { title: 'Analysis completed', body: `${s.comparisonsEvaluated} comparisons · ${s.findingsTotalActive} findings (${s.findingsCreated} new, ${s.findingsSuperseded} superseded)` };
      } catch { return { title: 'Analysis completed' }; }
    }
    case 'finding_created': return { title: `Finding created: ${fRef}`, body: f?.title ?? e.detail };
    case 'finding_superseded': return { title: `Finding superseded: ${fRef}`, body: e.detail };
    case 'status_changed': return { title: `${fRef}: ${REVIEW_STATUS_LABEL[e.fromStatus!]} → ${REVIEW_STATUS_LABEL[e.toStatus!]}`, body: e.reason ? `Reason: ${e.reason}` : f?.title };
    case 'note_added': return { title: `Reviewer note on ${fRef}`, body: e.note };
    case 'ai_analysis_completed': return { title: 'AI-assisted analysis completed', body: e.detail };
    case 'ai_analysis_failed': return { title: 'AI-assisted analysis did not complete', body: e.detail };
    case 'case_shared': return { title: 'Case published to the shared workspace', body: e.detail };
    case 'member_added': return { title: 'Collaborator added', body: e.detail };
    case 'member_removed': return { title: 'Collaborator removed', body: e.detail };
    case 'case_synced': return { title: 'Case data synchronized to the shared workspace', body: e.detail };
    case 'demo_reset': return { title: 'Demo data reset', body: e.detail };
    case 'case_updated': return { title: 'Case details updated', body: e.detail };
    default: return { title: String(e.kind).replace(/_/g, ' '), body: e.detail };
  }
}

type Group = 'case' | 'document' | 'analysis' | 'review' | 'note';
const GROUP_OF: Record<EventKind, Group> = {
  case_created: 'case', case_shared: 'case', member_added: 'case', member_removed: 'case', case_synced: 'case', case_updated: 'case', demo_reset: 'case',
  document_uploaded: 'document', document_extracted: 'document', document_failed: 'document', document_deleted: 'document',
  analysis_started: 'analysis', analysis_completed: 'analysis', analysis_failed: 'analysis', ai_analysis_completed: 'analysis', ai_analysis_failed: 'analysis',
  finding_created: 'analysis', finding_superseded: 'analysis',
  status_changed: 'review', note_added: 'note',
};
const GROUP_META: Record<Group, { label: string; icon: typeof FileUp; cls: string }> = {
  case: { label: 'Cases', icon: FolderOpen, cls: 'bg-subtle text-muted' },
  document: { label: 'Documents imported / extracted', icon: FileUp, cls: 'bg-info-50 text-info' },
  analysis: { label: 'Analysis & findings', icon: Sparkles, cls: 'bg-brand-50 text-brand' },
  review: { label: 'Review decisions', icon: UserCheck, cls: 'bg-ok-50 text-ok' },
  note: { label: 'Notes', icon: MessageSquare, cls: 'bg-warn-50 text-warn' },
};

/** Events at or before a demo case's seeding mark are seeded examples; everything later is a local action. */
export function isSeededEvent(e: AuditEvent, c: CaseRecord | undefined): boolean {
  return !!c?.seededAt && e.at <= c.seededAt && e.kind !== 'demo_reset';
}

export function Activity() {
  const { cases, documents, findings, events, loading } = useWorkspaceData();
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(120);
  const q = params.get('q') ?? '';
  const group = (params.get('type') ?? 'all') as Group | 'all';
  const origin = params.get('origin') ?? 'all';
  const caseFilter = params.get('case') ?? 'all';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (!v || v === 'all') n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
  };
  const caseMap = useMemo(() => new Map((cases ?? []).map((c) => [c.id, c])), [cases]);
  const rows = useMemo(() => {
    if (!events) return [];
    const term = q.trim().toLowerCase();
    return [...events].reverse().filter((e) => {
      if (group !== 'all' && GROUP_OF[e.kind] !== group) return false;
      if (caseFilter !== 'all' && e.caseId !== caseFilter) return false;
      const seeded = isSeededEvent(e, caseMap.get(e.caseId));
      if (origin === 'seeded' && !seeded) return false;
      if (origin === 'local' && seeded) return false;
      if (term) {
        const d = describeEvent(e, findings!, documents!);
        const hay = `${d.title} ${d.body ?? ''} ${e.actor} ${caseMap.get(e.caseId)?.label ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [events, findings, documents, q, group, origin, caseFilter, caseMap]);

  if (loading) return <PageSkeleton />;
  const localCount = events!.filter((e) => !isSeededEvent(e, caseMap.get(e.caseId))).length;
  const chips: [string, string][] = [];
  if (q) chips.push(['q', `Search: ${q}`]);
  if (group !== 'all') chips.push(['type', GROUP_META[group].label]);
  if (origin !== 'all') chips.push(['origin', origin === 'seeded' ? 'Seeded examples' : 'Local actions']);
  if (caseFilter !== 'all') chips.push(['case', splitLabel(caseMap.get(caseFilter)?.label ?? '').displayId]);

  // Group by calendar day for scanning.
  let lastDay = '';
  return (
    <div className="animate-fade-up">
      <PageHeader title="Activity" description="Review the actions recorded in this local demonstration workspace." meta={<Badge tone="brand">Local log</Badge>} />
      <div className="mb-5"><Callout tone="info">Entries are appended by the application and never edited, but this is a browser-local activity log for demonstration — it is not a secure, tamper-proof or compliance-grade audit trail. <strong>{events!.length}</strong> events in total · <strong>{localCount}</strong> local actions · <strong>{events!.length - localCount}</strong> seeded examples.</Callout></div>

      <div className="card mb-4 p-3">
        <div className="grid gap-2 md:grid-cols-12">
          <SearchInput className="md:col-span-5" value={q} onChange={(v) => set('q', v)} placeholder="Search events, findings, reviewers…" label="Search activity" testId="activity-search" />
          <SelectField className="md:col-span-3" value={group} onChange={(v) => set('type', v)} label="Event type" testId="activity-type" options={[{ value: 'all', label: 'All event types' }, ...(Object.keys(GROUP_META) as Group[]).map((g) => ({ value: g, label: GROUP_META[g].label }))]} />
          <SelectField className="md:col-span-2" value={origin} onChange={(v) => set('origin', v)} label="Origin" testId="activity-origin" options={[{ value: 'all', label: 'All origins' }, { value: 'local', label: 'Local actions' }, { value: 'seeded', label: 'Seeded examples' }]} />
          <SelectField className="md:col-span-2" value={caseFilter} onChange={(v) => set('case', v)} label="Case" options={[{ value: 'all', label: 'All cases' }, ...(cases ?? []).map((c) => ({ value: c.id, label: splitLabel(c.label).displayId }))]} />
        </div>
        {chips.length ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{chips.map(([k, l]) => <FilterChip key={k} label={l} onRemove={() => set(k, '')} />)}<button className="ml-1 text-xs font-medium text-brand hover:underline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear all</button></div> : null}
      </div>

      {rows.length === 0 ? <EmptyState title="No activity matches these filters" body="Clear a filter or perform an action (analyse a case, record a decision) to add entries." /> : (
        <div className="card overflow-hidden">
          <ol data-testid="timeline-events" className="divide-y divide-line">
            {rows.slice(0, limit).map((e) => {
              const g = GROUP_OF[e.kind];
              const meta = GROUP_META[g];
              const d = describeEvent(e, findings!, documents!);
              const c = caseMap.get(e.caseId);
              const seeded = isSeededEvent(e, c);
              const Icon = e.kind === 'demo_reset' ? RotateCcw : meta.icon;
              const day = e.at.slice(0, 10);
              const header = day !== lastDay ? new Date(e.at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null;
              lastDay = day;
              return (
                <li key={e.id}>
                  {header ? <div className="sticky top-[var(--header-h)] z-[1] border-b border-line bg-subtle/95 px-5 py-1.5 text-xs font-semibold text-muted backdrop-blur">{header}</div> : null}
                  <div className="flex gap-3.5 px-5 py-3.5">
                    <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.cls)}><Icon size={15} aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
                        <div className="min-w-0 text-[13.5px] font-medium">{e.findingId ? <Link to={`/findings/${e.findingId}`} className="hover:text-brand">{d.title}</Link> : e.documentId && documents!.some((x) => x.id === e.documentId) ? <Link to={`/documents/${e.documentId}`} className="hover:text-brand">{d.title}</Link> : d.title}</div>
                        <time className="shrink-0 text-xs tabular-nums text-faint" dateTime={e.at}>{formatDateTime(e.at)}</time>
                      </div>
                      {d.body ? <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-muted">{d.body}</p> : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                        {c ? <Link to={`/cases/${c.id}`} className="chip bg-subtle text-muted ring-1 ring-inset ring-line hover:text-brand">{splitLabel(c.label).displayId}</Link> : <span className="chip bg-subtle">Removed case</span>}
                        <span className="chip bg-subtle text-muted">{meta.label}</span>
                        {seeded ? <Badge tone="warn">Seeded example</Badge> : <Badge tone="brand">Local action</Badge>}
                        <span>by {e.actor}</span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {rows.length > limit ? <div className="border-t border-line p-3 text-center"><button className="btn-secondary" onClick={() => setLimit((l) => l + 200)}>Show more ({rows.length - limit} remaining)</button></div> : null}
        </div>
      )}
    </div>
  );
}
