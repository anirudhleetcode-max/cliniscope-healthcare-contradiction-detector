import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileStack, Inbox, ListChecks, Quote, Scale, Timer } from 'lucide-react';
import { useApp, useCaseData } from '../app/state';
import { AnalyzeButton } from '../components/AnalyzeButton';
import { Callout, EmptyState, PageHeader, PageSkeleton, ProcessingBadge, Stat, StatusBadge, TypeBadge, cx } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/dates';
import type { AnalysisSummary, Category, FindingType, ReviewStatus } from '../lib/types';
import { CATEGORY_LABEL, FINDING_TYPE_LABEL, REVIEW_STATUS_LABEL } from '../lib/types';
import { describeEvent } from './Timeline';
import { AiPanel } from '../components/AiPanel';
import { CollaborationPanel } from '../components/CollaborationPanel';

export function Overview() {
  const { currentCase, caseId, seeding, seedStage, seedError, resetDemo, storageError } = useApp();
  const { documents, findings, statements, events, loading } = useCaseData(caseId);

  if (storageError) {
    return <Callout tone="warn" title="Browser storage unavailable">CLINISCOPE stores data in this browser's IndexedDB, which is unavailable ({storageError}). Private browsing modes or blocked site data can cause this. Try a normal window.</Callout>;
  }
  if (seeding) return <div className="space-y-4"><Callout title="Preparing the synthetic demo case">Loading five fictional records and extracting their text in your browser (including OCR of a scanned letter)…<div className="mt-1 font-medium" role="status" data-testid="seed-stage">{seedStage ?? 'Starting…'}</div></Callout><PageSkeleton /></div>;
  if (seedError) return <Callout tone="warn" title="The demo case could not be loaded">{seedError} <button className="btn-secondary ml-2 mt-2" onClick={() => void resetDemo()}>Try again</button></Callout>;
  if (!currentCase || loading) return <PageSkeleton />;

  const active = findings!.filter((f) => !f.stale);
  const awaiting = active.filter((f) => f.reviewStatus === 'unreviewed' || f.reviewStatus === 'in_review');
  const closed = active.filter((f) => f.reviewStatus === 'resolved' || f.reviewStatus === 'dismissed');
  const confirmed = active.filter((f) => f.reviewStatus === 'confirmed');
  const lastSummaryEv = [...events!].reverse().find((e) => e.kind === 'analysis_completed');
  let summary: AnalysisSummary | null = null;
  try { summary = lastSummaryEv?.detail ? JSON.parse(lastSummaryEv.detail) : null; } catch { summary = null; }
  const recent = [...events!].reverse().filter((e) => e.kind === 'status_changed' || e.kind === 'note_added' || e.kind === 'analysis_completed' || e.kind === 'document_uploaded').slice(0, 6);

  const byCat = new Map<Category, number>();
  for (const f of active) byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
  const byType = new Map<FindingType, number>();
  for (const f of active) byType.set(f.findingType, (byType.get(f.findingType) ?? 0) + 1);
  const byStatus = new Map<ReviewStatus, number>();
  for (const f of active) byStatus.set(f.reviewStatus, (byStatus.get(f.reviewStatus) ?? 0) + 1);
  const maxCat = Math.max(1, ...byCat.values());
  const docsProcessing = documents!.filter((d) => d.status === 'extracting' || d.status === 'analyzing').length;
  const docsAttention = documents!.filter((d) => d.status === 'needs_attention' || d.status === 'failed').length;
  const needsAnalysis = documents!.length > 0 && (!currentCase.lastAnalyzedAt || documents!.some((d) => d.status === 'extracted'));
  const caseStatus = documents!.length === 0 ? 'No documents' : docsProcessing ? 'Processing' : needsAnalysis ? 'Awaiting analysis' : awaiting.length ? 'Review in progress' : active.length ? 'All findings reviewed' : 'Analyzed — no findings';

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow={currentCase.isDemo ? 'Synthetic demonstration case' : 'Case overview'}
        title={currentCase.label}
        description={<>Every flagged discrepancy comes with evidence you can inspect. CLINISCOPE compares statements across this case's records and lists possible inconsistencies for a professional to verify. It does not decide which record is correct.</>}
        actions={<>
          <Link to="/queue" className="btn-primary" data-testid="open-queue"><ListChecks size={16} aria-hidden />Open Review Queue</Link>
          <AnalyzeButton variant="secondary" disabled={documents!.length === 0} />
        </>}
      />

      {needsAnalysis ? (
        <div className="mb-6"><Callout tone="info" title={currentCase.lastAnalyzedAt ? 'New documents have not been analyzed yet' : 'Documents are ready for analysis'}>
          {documents!.length} document(s) have been ingested and their text extracted. Run <strong>Analyze documents</strong> to compare their statements and generate findings.
        </Callout></div>
      ) : null}

      <section aria-label="Case metrics" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Documents" value={documents!.length} icon={<FileStack size={16} />} hint={docsAttention ? `${docsAttention} need attention` : 'in this case'} />
        <Stat label="Statements" value={statements!.length} icon={<Quote size={16} />} hint="extracted by rules" />
        <Stat label="Findings" value={active.length} icon={<Scale size={16} />} tone="brand" hint="potential discrepancies" />
        <Stat label="Awaiting review" value={awaiting.length} icon={<Inbox size={16} />} tone={awaiting.length ? 'crit' : undefined} hint="unreviewed or in review" />
        <Stat label="Closed by reviewer" value={closed.length} icon={<CheckCircle2 size={16} />} tone="ok" hint={`resolved or dismissed${confirmed.length ? ` · ${confirmed.length} confirmed` : ''}`} />
        <Stat label="Last analysis" value={<span className="text-base">{currentCase.lastAnalyzedAt ? formatDateTime(currentCase.lastAnalyzedAt) : 'Not run'}</span>} icon={<Timer size={16} />} hint={caseStatus} />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2" aria-label="Findings requiring review">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">What needs review next</h2>
            <Link to="/queue" className="text-sm font-medium text-brand hover:underline">View all</Link>
          </div>
          {active.length === 0 ? (
            <EmptyState title={currentCase.lastAnalyzedAt ? 'No discrepancies detected' : 'No findings yet'} body={currentCase.lastAnalyzedAt ? 'The analysis compared statements across documents and found no inconsistencies. This does not guarantee the records are complete or correct.' : 'Analyze the documents to generate findings.'} action={!currentCase.lastAnalyzedAt && documents!.length ? <AnalyzeButton /> : documents!.length === 0 ? <Link className="btn-primary" to="/documents">Upload documents</Link> : undefined} />
          ) : (
            <ul className="divide-y divide-line">
              {[...active].sort((a, b) => ['prompt', 'routine', 'low'].indexOf(a.reviewPriority) - ['prompt', 'routine', 'low'].indexOf(b.reviewPriority)).slice(0, 6).map((f) => (
                <li key={f.id}>
                  <Link to={`/findings/${f.id}`} className="group flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-4">
                    <span className="font-mono text-xs text-muted">{f.displayId}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium group-hover:text-brand">{f.title}</span>
                      <span className="text-xs text-muted">{CATEGORY_LABEL[f.category]} · {f.sourceDocumentIds.length} documents · {f.relevantDates.filter((d) => d.length === 10).map(formatDate).join(', ')}</span>
                    </span>
                    <span className="flex items-center gap-2"><TypeBadge type={f.findingType} /><StatusBadge status={f.reviewStatus} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5" aria-label="Last analysis summary">
          <h2 className="mb-3 text-base font-semibold">Last analysis summary</h2>
          {summary ? (
            <dl className="space-y-2 text-sm" data-testid="analysis-summary">
              {[
                ['Documents analyzed', summary.documentsAnalyzed],
                ['Statements compared', summary.statementsExtracted],
                ['Comparisons evaluated', summary.comparisonsEvaluated],
                ['Consistent (not flagged)', summary.consistentComparisons],
                ['Explained by dates / documented change', summary.temporallyExplainedComparisons],
                ['Findings produced', summary.findingsTotalActive],
                ['New in last run', summary.findingsCreated],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-3 border-b border-dashed border-line pb-1.5 last:border-0"><dt className="text-muted">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
              ))}
              <p className="pt-1 text-xs text-muted">Method: deterministic rules (no AI model). Completed {formatDateTime(lastSummaryEv!.at)}.</p>
            </dl>
          ) : <p className="text-sm text-muted">No analysis has been run for this case yet.</p>}
        </section>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card p-5" aria-label="Findings by category">
          <h2 className="mb-4 text-base font-semibold">Findings by category</h2>
          {active.length === 0 ? <p className="text-sm text-muted">No findings to chart.</p> : (
            <ul className="space-y-3">
              {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
                <li key={cat}>
                  <Link to={`/queue?category=${cat}`} className="block text-sm hover:text-brand">
                    <div className="mb-1 flex justify-between"><span>{CATEGORY_LABEL[cat]}</span><span className="font-semibold tabular-nums">{n}</span></div>
                    <div className="h-2 rounded-full bg-soft"><div className="h-2 rounded-full bg-brand transition-all" style={{ width: `${(n / maxCat) * 100}%` }} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5" aria-label="Findings by type and status">
          <h2 className="mb-4 text-base font-semibold">Finding type and review status</h2>
          {active.length === 0 ? <p className="text-sm text-muted">No findings to chart.</p> : (
            <div className="space-y-5">
              <StackBar total={active.length} parts={[...byType.entries()].map(([k, v]) => ({ key: k, label: FINDING_TYPE_LABEL[k], value: v, color: { explicit_conflict: '#B42318', potential_discrepancy: '#B7791F', temporal_inconsistency: '#E0A84F', context_dependent: '#7C93C3', insufficient_evidence: '#CBD5E1' }[k] }))} />
              <StackBar total={active.length} parts={[...byStatus.entries()].map(([k, v]) => ({ key: k, label: REVIEW_STATUS_LABEL[k], value: v, color: { unreviewed: '#94A3B8', in_review: '#315EFB', confirmed: '#B42318', resolved: '#16805D', dismissed: '#CBD5E1' }[k] }))} />
            </div>
          )}
        </section>
        <section className="card p-5" aria-label="Recent activity">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Recent activity</h2><Link to="/timeline" className="text-sm font-medium text-brand hover:underline">Timeline</Link></div>
          {recent.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
            <ol className="space-y-3">
              {recent.map((e) => (
                <li key={e.id} className="text-sm">
                  <div className="font-medium">{describeEvent(e, findings!, documents!).title}</div>
                  <div className="text-xs text-muted">{formatDateTime(e.at)} · {e.actor}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {currentCase.remote ? <CollaborationPanel c={currentCase} /> : (
          <section className="card p-5" aria-label="Storage mode" data-testid="local-mode-panel">
            <h2 className="mb-1 text-base font-semibold">Local demo mode</h2>
            <p className="text-sm text-muted">This case is stored only in this browser (IndexedDB). To review it with colleagues, sign in to a shared workspace and publish it from <Link className="text-brand hover:underline" to="/cases">Cases</Link>.</p>
          </section>
        )}
        <AiPanel disabled={documents!.length === 0} />
      </div>

      <section className="card mt-6 p-5" aria-label="Document processing status">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Case records</h2><Link to="/documents" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">Document library<ArrowRight size={14} /></Link></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {documents!.map((d) => (
            <Link key={d.id} to={`/documents/${d.id}`} className="rounded-lg border border-line p-3 transition-colors hover:border-brand/40 hover:bg-soft/50">
              <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{d.title}</span><span className="rounded bg-soft px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">{d.fileKind}</span></div>
              <div className="mt-1 text-xs text-muted">Document date: {formatDate(d.documentDate)}</div>
              <div className={cx('mt-2 flex items-center justify-between text-xs')}><ProcessingBadge status={d.status} /><span className="text-muted">{d.statementCount} statements</span></div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function StackBar({ parts, total }: { parts: { key: string; label: string; value: number; color: string }[]; total: number }) {
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-soft" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}>
        {parts.map((p) => <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="transition-all" />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((p) => <li key={p.key} className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.label} <span className="font-semibold text-ink">{p.value}</span></li>)}
      </ul>
    </div>
  );
}
