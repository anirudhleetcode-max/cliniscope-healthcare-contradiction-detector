import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Search } from 'lucide-react';
import { useApp, useWorkspaceData } from '../app/state';
import { FindingsTable } from '../components/clinical';
import { DecisionHistory, EvidenceComparison, ReviewPanel, useFindingDocs, useFindingEvents } from '../components/review/Review';
import { Drawer, EmptyState, FilterChip, PageHeader, PageSkeleton, SearchInput, SelectField, cx } from '../components/ui';
import { filterFindings, sortFindings, type FindingSort } from '../lib/query';
import { isOpen, SEVERITY_LABEL, severityOf, splitLabel, type Severity } from '../lib/metrics';
import type { Category, Finding, FindingType, ReviewStatus } from '../lib/types';
import { CATEGORY_LABEL, FINDING_TYPE_LABEL, REVIEW_STATUS_LABEL } from '../lib/types';
import { FindingExplanation } from './FindingDetail';

const TABS: { key: string; label: string; type?: FindingType; status?: ReviewStatus }[] = [
  { key: 'all', label: 'All' },
  { key: 'unreviewed', label: 'Unreviewed', status: 'unreviewed' },
  { key: 'explicit', label: 'Explicit conflicts', type: 'explicit_conflict' },
  { key: 'potential', label: 'Potential discrepancies', type: 'potential_discrepancy' },
  { key: 'context', label: 'Historical / contextual', type: 'context_dependent' },
  { key: 'insufficient', label: 'Insufficient evidence', type: 'insufficient_evidence' },
];

export function Contradictions() {
  const { caseId } = useApp();
  const { cases, findings, loading } = useWorkspaceData();
  const [params, setParams] = useSearchParams();
  const [preview, setPreview] = useState<Finding | null>(null);
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (v === null || v === '' || v === 'all') n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
  };
  const tab = TABS.find((t) => t.key === (params.get('tab') ?? 'all')) ?? TABS[0];
  const caseParam = params.get('case') === 'current' ? caseId : params.get('case');
  const severity = (params.get('severity') ?? 'all') as Severity | 'all';
  const sort = (params.get('sort') as FindingSort) ?? 'priority';
  const caseMap = useMemo(() => new Map((cases ?? []).map((c) => [c.id, c])), [cases]);

  const scoped = useMemo(() => (findings ?? []).filter((f) => caseMap.has(f.caseId) && (!caseParam || f.caseId === caseParam)), [findings, caseMap, caseParam]);
  const rows = useMemo(() => {
    let list = filterFindings(scoped, {
      search: params.get('q') ?? '',
      status: (params.get('status') as ReviewStatus) ?? tab.status ?? 'all',
      type: (params.get('type') as FindingType) ?? tab.type ?? 'all',
      category: (params.get('category') as Category) ?? 'all',
      includeStale: params.get('stale') === '1',
    });
    if (severity !== 'all') list = list.filter((f) => severityOf(f) === severity);
    if (params.get('open') === '1') list = list.filter(isOpen);
    return sortFindings(list, sort);
  }, [scoped, params, tab, severity, sort]);

  if (loading) return <PageSkeleton />;
  const chips: [string, string][] = [];
  if (params.get('q')) chips.push(['q', `Search: ${params.get('q')}`]);
  if (caseParam) chips.push(['case', `Case: ${splitLabel(caseMap.get(caseParam)?.label ?? '').displayId}`]);
  if (params.get('category')) chips.push(['category', CATEGORY_LABEL[params.get('category') as Category]]);
  if (params.get('status')) chips.push(['status', REVIEW_STATUS_LABEL[params.get('status') as ReviewStatus]]);
  if (severity !== 'all') chips.push(['severity', `${SEVERITY_LABEL[severity]} severity`]);
  if (params.get('open') === '1') chips.push(['open', 'Open only']);
  const anyFindings = scoped.some((f) => !f.stale);
  const scopedCase = caseParam ? caseMap.get(caseParam) : undefined;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Contradictions" description="Compare potentially inconsistent statements across clinical documents." meta={<span className="chip bg-brand-50 text-brand-700" data-testid="match-count">{rows.length} matching</span>} />

      <div className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-1 border-b border-line" role="tablist" aria-label="Quick filters">
          {TABS.map((t) => {
            const n = filterFindings(scoped, { status: t.status ?? 'all', type: t.type ?? 'all' }).length;
            return (
              <button key={t.key} role="tab" aria-selected={tab.key === t.key} onClick={() => set('tab', t.key)} className={cx('-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium transition-colors', tab.key === t.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>
                {t.label}<span className="ml-1.5 rounded-full bg-line/70 px-1.5 text-xs tabular-nums text-muted">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card mb-4 p-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-12">
          <SearchInput className="xl:col-span-4" value={params.get('q') ?? ''} onChange={(v) => set('q', v)} placeholder="Search titles, categories, evidence text…" label="Search findings" testId="queue-search" />
          <SelectField className="xl:col-span-2" value={severity} onChange={(v) => set('severity', v)} label="Severity" testId="filter-severity" options={[{ value: 'all', label: 'Any severity' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Informational' }]} />
          <SelectField className="xl:col-span-2" value={params.get('category') ?? 'all'} onChange={(v) => set('category', v)} label="Category" testId="filter-category" options={[{ value: 'all', label: 'All categories' }, ...(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]} />
          <SelectField className="xl:col-span-2" value={caseParam ?? 'all'} onChange={(v) => set('case', v)} label="Case" testId="filter-case" options={[{ value: 'all', label: 'All cases' }, ...(cases ?? []).map((c) => ({ value: c.id, label: splitLabel(c.label).displayId }))]} />
          <SelectField className="xl:col-span-2" value={sort} onChange={(v) => set('sort', v)} label="Sort" options={[{ value: 'priority', label: 'Sort: priority' }, { value: 'newest', label: 'Sort: newest' }, { value: 'oldest', label: 'Sort: oldest' }, { value: 'category', label: 'Sort: category' }, { value: 'status', label: 'Sort: status' }]} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <SelectField className="w-[190px]" value={params.get('status') ?? 'all'} onChange={(v) => set('status', v)} label="Review status" testId="filter-status" options={[{ value: 'all', label: 'Any review status' }, ...(Object.keys(REVIEW_STATUS_LABEL) as ReviewStatus[]).map((s) => ({ value: s, label: REVIEW_STATUS_LABEL[s] }))]} />
          <label className="ml-2 inline-flex items-center gap-1.5"><input type="checkbox" checked={params.get('stale') === '1'} onChange={(e) => set('stale', e.target.checked ? '1' : null)} />Include superseded</label>
          {chips.map(([k, l]) => <FilterChip key={k} label={l} onRemove={() => set(k, null)} />)}
          {chips.length ? <button className="ml-1 font-medium text-brand hover:underline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear all</button> : null}
        </div>
      </div>

      {!anyFindings ? (
        <EmptyState title={scopedCase?.lastAnalyzedAt || (!scopedCase && scoped.length === 0 && (cases ?? []).some((c) => c.lastAnalyzedAt)) ? 'No potential contradictions were detected by the available rules.' : 'No findings yet'}
          body={scopedCase?.lastAnalyzedAt ? 'This does not mean the records are free of contradictions: the rules cover a limited vocabulary and the records may be incomplete.' : 'Run the analysis on a case to compare statements across its documents.'}
          action={scopedCase ? <Link className="btn-primary" to={`/cases/${scopedCase.id}`}>Open case</Link> : undefined} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search size={19} />} title="No findings match these filters" body="Try clearing the search or selecting a different filter." />
      ) : (
        <div className="card overflow-hidden"><FindingsTable rows={rows} cases={caseMap} onPreview={setPreview} /></div>
      )}
      <p className="mt-4 text-xs text-muted">Severity reflects the engine's workflow review priority (allergy and medication conflicts first). It is not a clinical risk score. {FINDING_TYPE_LABEL.insufficient_evidence} and historical differences are shown separately from potential contradictions.</p>

      <Drawer open={!!preview} onClose={() => setPreview(null)} title={preview ? `${preview.displayId} · ${preview.title}` : ''} testId="finding-drawer"
        footer={preview ? <Link to={`/findings/${preview.id}`} className="btn-primary"><ExternalLink size={15} />Open full page</Link> : null}>
        {preview ? <DrawerBody finding={(findings ?? []).find((f) => f.id === preview.id) ?? preview} /> : null}
      </Drawer>
    </div>
  );
}

function DrawerBody({ finding }: { finding: Finding }) {
  const { cases } = useApp();
  const docs = useFindingDocs(finding);
  const events = useFindingEvents(finding.id);
  const c = cases?.find((x) => x.id === finding.caseId);
  return (
    <div className="space-y-5">
      <FindingExplanation finding={finding} />
      {docs ? <EvidenceComparison finding={finding} docs={docs} compact /> : null}
      <ReviewPanel finding={finding} caseRec={c} />
      {events ? <DecisionHistory finding={finding} events={events} /> : null}
    </div>
  );
}
