import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Search, SlidersHorizontal, X } from 'lucide-react';
import { useApp, useCaseData } from '../app/state';
import { AnalyzeButton } from '../components/AnalyzeButton';
import { EmptyState, PageHeader, PageSkeleton, PriorityTag, QualityIndicator, StatusBadge, TypeBadge, cx } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/dates';
import { filterFindings, sortFindings, type FindingFilter, type FindingSort } from '../lib/query';
import type { Category, EvidenceQuality, FindingType, ReviewStatus } from '../lib/types';
import { CATEGORY_LABEL, EVIDENCE_QUALITY_LABEL } from '../lib/types';

const TABS: { key: string; label: string; filter: Partial<FindingFilter> }[] = [
  { key: 'all', label: 'All', filter: {} },
  { key: 'unreviewed', label: 'Unreviewed', filter: { status: 'unreviewed' } },
  { key: 'explicit', label: 'Explicit conflicts', filter: { type: 'explicit_conflict' } },
  { key: 'potential', label: 'Potential discrepancies', filter: { type: 'potential_discrepancy' } },
  { key: 'context', label: 'Historical / contextual', filter: { type: 'context_dependent' } },
  { key: 'insufficient', label: 'Insufficient evidence', filter: { type: 'insufficient_evidence' } },
  { key: 'resolved', label: 'Resolved', filter: { status: 'resolved' } },
  { key: 'dismissed', label: 'Dismissed with reason', filter: { status: 'dismissed' } },
];

export function Queue() {
  const { caseId, currentCase } = useApp();
  const { findings, documents, loading } = useCaseData(caseId);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'all';
  const set = (k: string, v: string | null) => {
    // Read the live URL (react-router v6 hands updaters the params from the last render).
    const n = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (v === null || v === '' || v === 'all') n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
  };
  const filter: FindingFilter = {
    ...(TABS.find((t) => t.key === tab)?.filter ?? {}),
    search: params.get('q') ?? '',
    ...(params.get('category') ? { category: params.get('category') as Category } : {}),
    ...(params.get('quality') ? { quality: params.get('quality') as EvidenceQuality } : {}),
    ...(params.get('status') ? { status: params.get('status') as ReviewStatus } : {}),
    ...(params.get('type') ? { type: params.get('type') as FindingType } : {}),
    dateFrom: params.get('from') ?? undefined,
    dateTo: params.get('to') ?? undefined,
    includeStale: params.get('stale') === '1',
  };
  const sort = (params.get('sort') as FindingSort) ?? 'priority';
  const rows = useMemo(() => sortFindings(filterFindings(findings ?? [], filter), sort), [findings, JSON.stringify(filter), sort]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!currentCase || loading) return <PageSkeleton />;
  const active = findings!.filter((f) => !f.stale);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, filterFindings(findings!, { ...t.filter }).length]));
  const anyFilter = ['q', 'category', 'quality', 'from', 'to', 'status', 'type'].some((k) => params.get(k));

  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow="Review queue" title="Findings for professional review" description="Each finding links two or more source statements. Evidence availability describes source and extraction reliability — not which record is clinically correct." actions={<AnalyzeButton variant="secondary" disabled={!documents?.length} />} />

      <div className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-1 border-b border-line" role="tablist" aria-label="Quick filters">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => set('tab', t.key)} className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors', tab === t.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>
              {t.label}<span className="ml-1.5 rounded-full bg-soft px-1.5 text-xs tabular-nums text-muted">{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card mb-4 p-3">
        <div className="grid gap-2 md:grid-cols-12">
          <div className="relative md:col-span-4">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className="input pl-9" placeholder="Search titles, categories, evidence text…" aria-label="Search findings" value={params.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} data-testid="queue-search" />
          </div>
          <select className="input md:col-span-2" aria-label="Category" value={params.get('category') ?? 'all'} onChange={(e) => set('category', e.target.value)} data-testid="filter-category">
            <option value="all">All categories</option>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <select className="input md:col-span-2" aria-label="Evidence quality" value={params.get('quality') ?? 'all'} onChange={(e) => set('quality', e.target.value)}>
            <option value="all">Any evidence quality</option>
            {(Object.keys(EVIDENCE_QUALITY_LABEL) as EvidenceQuality[]).map((q) => <option key={q} value={q}>{EVIDENCE_QUALITY_LABEL[q]}</option>)}
          </select>
          <input type="date" className="input md:col-span-1" aria-label="Relevant date from" value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} />
          <input type="date" className="input md:col-span-1" aria-label="Relevant date to" value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} />
          <select className="input md:col-span-2" aria-label="Sort" value={sort} onChange={(e) => set('sort', e.target.value)}>
            <option value="priority">Sort: review priority</option>
            <option value="newest">Sort: recently created</option>
            <option value="oldest">Sort: oldest first</option>
            <option value="category">Sort: category</option>
            <option value="status">Sort: review status</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><SlidersHorizontal size={13} aria-hidden />{rows.length} of {active.length} findings shown</span>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={params.get('stale') === '1'} onChange={(e) => set('stale', e.target.checked ? '1' : null)} />Include superseded findings</label>
          {anyFilter ? <button className="inline-flex items-center gap-1 font-medium text-brand hover:underline" onClick={() => setParams(new URLSearchParams(tab !== 'all' ? { tab } : {}), { replace: true })}><X size={12} />Clear filters</button> : null}
        </div>
      </div>

      {findings!.length === 0 ? (
        <EmptyState title={currentCase.lastAnalyzedAt ? 'No potential contradictions were detected by the available rules.' : 'No findings yet'} body={currentCase.lastAnalyzedAt ? 'This does not mean the records are free of contradictions: the rules cover a limited vocabulary and the records may be incomplete.' : 'Run the analysis to compare statements across this case\'s documents.'} action={documents!.length ? <AnalyzeButton /> : <Link className="btn-primary" to="/documents">Upload documents</Link>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title="No findings match these filters" body="Try clearing the search or selecting a different filter." />
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-hidden lg:block">
            <table className="w-full text-left text-sm" data-testid="queue-table">
              <thead className="border-b border-line bg-soft/60 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">ID</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Finding</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Sources</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Relevant dates</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Evidence</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((f) => (
                  <tr key={f.id} className={cx('group transition-colors hover:bg-soft/40', f.stale && 'opacity-60')}>
                    <td className="px-4 py-3 align-top font-mono text-xs text-muted">{f.displayId}</td>
                    <td className="px-4 py-3 align-top">
                      <Link to={`/findings/${f.id}`} className="font-medium text-ink group-hover:text-brand" data-testid="finding-link">{f.title}</Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-xs text-muted">{CATEGORY_LABEL[f.category]}</span><TypeBadge type={f.findingType} /><PriorityTag priority={f.reviewPriority} />{f.stale ? <span className="chip bg-slate-100 text-slate-500">Superseded</span> : null}</div>
                    </td>
                    <td className="px-4 py-3 align-top"><span className="inline-flex items-center gap-1 text-muted"><FileText size={13} aria-hidden />{f.sourceDocumentIds.length} docs</span></td>
                    <td className="px-4 py-3 align-top text-xs text-muted">{f.relevantDates.map(formatDate).join(' · ')}</td>
                    <td className="px-4 py-3 align-top"><QualityIndicator quality={f.evidenceQuality} compact /></td>
                    <td className="px-4 py-3 align-top"><StatusBadge status={f.reviewStatus} /></td>
                    <td className="px-4 py-3 align-top text-xs text-muted">{formatDateTime(f.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <ul className="space-y-3 lg:hidden">
            {rows.map((f) => (
              <li key={f.id}>
                <Link to={`/findings/${f.id}`} className="card block p-4 active:bg-soft">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted">{f.displayId}</span><StatusBadge status={f.reviewStatus} /></div>
                  <div className="mt-1.5 font-medium">{f.title}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2"><TypeBadge type={f.findingType} /><span className="text-xs text-muted">{CATEGORY_LABEL[f.category]} · {f.sourceDocumentIds.length} docs</span></div>
                  <div className="mt-2 flex items-center justify-between"><QualityIndicator quality={f.evidenceQuality} compact /><PriorityTag priority={f.reviewPriority} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-xs text-muted">“Review priority” is a workflow prioritization suggestion (allergy and medication conflicts first). It is not a clinical risk score and requires professional judgment.</p>
    </div>
  );
}
