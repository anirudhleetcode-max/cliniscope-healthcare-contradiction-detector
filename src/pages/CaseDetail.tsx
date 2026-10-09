import { useEffect, useMemo } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, ChevronRight, ExternalLink, FileText, FileUp, FolderX, GitCompareArrows, Inbox, ListChecks, ScanText } from 'lucide-react';
import { db, useApp, useCaseData } from '../app/state';
import { AnalyzeButton } from '../components/AnalyzeButton';
import { AiPanel } from '../components/AiPanel';
import { CollaborationPanel } from '../components/CollaborationPanel';
import { ExportPanel } from '../components/ExportPanel';
import { AnalysisSummaryList, CaseStateBadge, DocKindIcon, latestSummary } from '../components/clinical';
import { DecisionHistory, EvidenceComparison, EvidenceHeading, ReviewPanel, useFindingDocs, useFindingEvents } from '../components/review/Review';
import { Badge, Callout, EmptyState, MetricCard, PageHeader, PageSkeleton, ProcessingBadge, ProgressBar, SectionCard, SeverityBadge, StatusBadge, SyntheticBadge, cx } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/dates';
import { SEVERITY_ORDER, isPending, severityOf, summarizeCase } from '../lib/metrics';
import type { CaseRecord, DocumentRecord, Finding } from '../lib/types';
import { CATEGORY_LABEL, DOCUMENT_TYPE_LABEL } from '../lib/types';
import { FindingExplanation } from './FindingDetail';

/** `/case` — opens the active case. */
export function CurrentCase() {
  const { caseId, cases } = useApp();
  if (!cases) return <PageSkeleton />;
  return caseId ? <Navigate to={`/cases/${caseId}`} replace /> : <Navigate to="/cases" replace />;
}

export function CaseDetail() {
  const { id } = useParams();
  const { caseId, setCaseId, seeding } = useApp();
  const caseRec = useLiveQuery(() => db.cases.get(id ?? '').then((c) => c ?? null), [id]);
  const { documents, findings, statements, events, loading } = useCaseData(id ?? null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => { if (caseRec && caseRec.id !== caseId) setCaseId(caseRec.id); }, [caseRec, caseId, setCaseId]);

  const sortedFindings = useMemo(() => [...(findings ?? [])].filter((f) => !f.stale)
    .sort((a, b) => Number(isPending(b)) - Number(isPending(a)) || SEVERITY_ORDER.indexOf(severityOf(a)) - SEVERITY_ORDER.indexOf(severityOf(b)) || a.displayId.localeCompare(b.displayId)), [findings]);

  if (caseRec === undefined || loading) return <PageSkeleton />;
  if (caseRec === null) return <EmptyState icon={<FolderX size={19} />} title="Case not found" body={seeding ? 'The demonstration workspace is being prepared…' : 'This case does not exist in this browser. It may have been deleted or reset.'} action={<Link className="btn-primary" to="/cases">Back to clinical cases</Link>} />;

  const s = summarizeCase(caseRec, documents!, findings!);
  const summary = latestSummary(events, caseRec.id);
  const selFinding = sortedFindings.find((f) => f.id === params.get('f'));
  const selDoc = documents!.find((d) => d.id === params.get('doc'));
  const current = selFinding ?? (selDoc ? undefined : sortedFindings[0]);
  const select = (k: 'f' | 'doc', v: string) => setParams(new URLSearchParams({ [k]: v }), { replace: true });
  const awaiting = s.state === 'awaiting_analysis';
  const datedDocs = [...documents!].sort((a, b) => (a.documentDate ?? '9999').localeCompare(b.documentDate ?? '9999'));

  return (
    <div className="animate-fade-up" data-testid="case-detail">
      <PageHeader
        eyebrow={caseRec.isDemo ? 'Synthetic demonstration case' : 'Clinical case'}
        title={caseRec.label}
        meta={<>{caseRec.isDemo ? <SyntheticBadge label="SYNTHETIC DEMONSTRATION DATA" /> : null}<CaseStateBadge state={s.state} /></>}
        description={caseRec.demoScenario ?? 'Statements are compared across this case\'s documents only. Every finding links to the exact source text.'}
        actions={<>
          <Link to={`/documents?case=${caseRec.id}#import`} className="btn-secondary"><FileUp size={16} aria-hidden />Import documents</Link>
          <Link to={`/contradictions?case=${caseRec.id}`} className="btn-secondary" data-testid="case-findings-link"><GitCompareArrows size={16} aria-hidden />All findings</Link>
          <AnalyzeButton caseId={caseRec.id} variant={awaiting ? 'primary' : 'secondary'} disabled={documents!.length === 0} />
        </>}
      />

      {awaiting ? <div className="mb-5"><Callout tone="info" title={caseRec.lastAnalyzedAt ? 'New documents have not been analyzed yet' : 'Documents are ready for analysis'}>{documents!.length} document(s) have been ingested and their text extracted. Run <strong>Analyze documents</strong> to compare their statements and generate findings.</Callout></div> : null}

      <section aria-label="Case metrics" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="metrics">
        <MetricCard label="Documents" value={s.documentCount} icon={<FileText size={16} />} hint={`${documents!.filter((d) => d.status === 'analyzed' || d.status === 'extracted').length} processed${documents!.some((d) => d.status === 'needs_attention' || d.status === 'failed') ? ' · some need attention' : ''}`} />
        <MetricCard label="Potential findings" value={s.findingCount} icon={<GitCompareArrows size={16} />} tone="brand" hint={caseRec.lastAnalyzedAt ? `${statements!.length} statements compared` : 'analysis not run yet'} />
        <MetricCard label="Pending review" value={s.pendingCount} icon={<Inbox size={16} />} tone={s.pendingCount ? 'warn' : undefined} hint="unreviewed, in review or needs info" />
        <MetricCard label="Decided" value={s.decidedCount} icon={<ListChecks size={16} />} tone={s.decidedCount ? 'ok' : undefined} hint={s.findingCount ? `${Math.round((s.decidedCount / s.findingCount) * 100)}% of findings` : '—'} progress={s.findingCount ? s.decidedCount / s.findingCount : undefined} />
      </section>

      {documents!.length === 0 ? (
        <EmptyState icon={<FileUp size={19} />} title="No documents in this case" body="Import discharge summaries, intake forms, medication lists or lab reports (PDF, scanned PDF, PNG/JPEG, TXT or DOCX) to compare them." action={<Link className="btn-primary" to={`/documents?case=${caseRec.id}#import`}><FileUp size={16} />Import documents</Link>} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          {/* LEFT: summary, documents, findings */}
          <div className="space-y-5 lg:row-span-2 2xl:row-span-1">
            <SectionCard title="Case summary" bodyClassName="px-5 py-4">
              <div className="mb-3">
                <div className="mb-1 flex justify-between text-xs text-muted"><span>Review progress</span><span className="tabular-nums">{s.decidedCount}/{s.findingCount}</span></div>
                <ProgressBar value={s.findingCount ? s.decidedCount / s.findingCount : 0} tone={s.pendingCount ? 'brand' : 'ok'} label="Review progress" />
              </div>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted">Patient alias</dt><dd className="truncate">{s.alias}</dd>
                <dt className="text-muted">Documents</dt><dd>{s.documentCount}</dd>
                <dt className="text-muted">Findings</dt><dd>{s.findingCount} ({s.highCount} high)</dd>
                <dt className="text-muted">Last analysis</dt><dd>{caseRec.lastAnalyzedAt ? formatDateTime(caseRec.lastAnalyzedAt) : 'Never'}</dd>
                <dt className="text-muted">Last activity</dt><dd>{formatDateTime(caseRec.updatedAt)}</dd>
                <dt className="text-muted">Storage</dt><dd>{caseRec.remote ? `Shared · ${caseRec.remote.role}` : 'This browser only'}</dd>
              </dl>
            </SectionCard>

            <SectionCard title="Documents" description={`${documents!.length} source record(s)`} bodyClassName="p-1.5">
              <ul className="space-y-0.5" data-testid="case-documents">
                {documents!.map((d) => <DocumentListItem key={d.id} doc={d} active={selDoc?.id === d.id} findings={sortedFindings.filter((f) => f.sourceDocumentIds.includes(d.id)).length} onSelect={() => select('doc', d.id)} />)}
              </ul>
            </SectionCard>

            <SectionCard title="Findings" description={sortedFindings.length ? 'Pending first, then by priority' : undefined} bodyClassName="p-1.5">
              {sortedFindings.length ? (
                <ul className="space-y-0.5" data-testid="case-findings">
                  {sortedFindings.map((f) => <FindingListItem key={f.id} f={f} active={current?.id === f.id} onSelect={() => select('f', f.id)} />)}
                </ul>
              ) : <p className="px-3.5 py-4 text-[13px] text-muted">{caseRec.lastAnalyzedAt ? 'No potential contradictions were detected by the available rules.' : 'No findings yet — run the analysis.'}</p>}
            </SectionCard>
          </div>

          {/* CENTER: selected finding evidence or document preview */}
          <div className="min-w-0 space-y-5">
            {current ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-faint">{current.displayId}</span><SeverityBadge severity={severityOf(current)} /><Badge>{CATEGORY_LABEL[current.category]}</Badge><StatusBadge status={current.reviewStatus} />
                  <Link to={`/findings/${current.id}`} className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">Open full page<ExternalLink size={13} aria-hidden /></Link>
                </div>
                <h2 className="text-[20px] font-semibold leading-snug tracking-[-0.01em]" data-testid="case-selected-finding">{current.title}</h2>
                <FindingEvidence finding={current} />
                <FindingExplanation finding={current} />
              </>
            ) : selDoc ? (
              <DocumentPreviewPanel doc={selDoc} findings={sortedFindings.filter((f) => f.sourceDocumentIds.includes(selDoc.id))} onFinding={(fid) => select('f', fid)} />
            ) : (
              <EmptyState icon={<ScanText size={19} />} title={caseRec.lastAnalyzedAt ? 'No potential contradictions were detected by the available rules.' : 'No findings yet'} body={caseRec.lastAnalyzedAt ? 'This does not mean the records are free of contradictions: the rules cover a limited vocabulary. Select a document to inspect its text.' : 'Run the analysis to compare statements across this case\'s documents, or select a document to preview it.'} />
            )}
          </div>

          {/* RIGHT: review decision + history (moves below centre on smaller screens) */}
          <div className="min-w-0 space-y-5 lg:col-start-2 2xl:col-start-auto">
            {current ? <CaseReview finding={current} caseRec={caseRec} /> : null}
            {summary ? <SectionCard title="Last analysis" bodyClassName="px-5 py-3"><AnalysisSummaryList summary={summary} at={caseRec.lastAnalyzedAt} /></SectionCard> : null}
          </div>
        </div>
      )}

      {documents!.length ? (
        <section className="card mt-6 p-5" aria-label="Clinical record dates">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><CalendarDays size={16} className="text-brand" aria-hidden />Clinical record dates</h2>
          <p className="mb-4 mt-0.5 text-xs text-muted">Dates written on, or entered for, each document. An upload time is never treated as a clinical date.</p>
          <ol className="flex flex-col gap-3 md:flex-row md:gap-0">
            {datedDocs.map((d, i) => (
              <li key={d.id} className="relative flex-1 md:pr-4">
                <div className="hidden md:block"><div className={cx('absolute left-0 right-0 top-[7px] h-0.5 bg-line', i === 0 && 'left-2', i === datedDocs.length - 1 && 'right-[calc(100%-1rem)]')} /></div>
                <span className="relative z-10 block h-4 w-4 rounded-full border-[3px] border-surface bg-brand shadow" aria-hidden />
                <div className="mt-2">
                  <div className="text-[13px] font-semibold">{d.documentDate ? formatDate(d.documentDate) : <span className="text-warn">Date not recorded</span>}</div>
                  <button className="text-left text-[13px] text-brand hover:underline" onClick={() => select('doc', d.id)}>{d.title}</button>
                  <div className="text-xs text-muted">{DOCUMENT_TYPE_LABEL[d.documentType]}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ExportPanel c={caseRec} />
        <AiPanel disabled={!documents!.length} />
      </div>
      {caseRec.remote ? <div className="mt-6"><CollaborationPanel c={caseRec} /></div> : null}
      <p className="mt-6 text-xs text-faint">Need the full document list? <button className="text-brand hover:underline" onClick={() => navigate(`/documents?case=${caseRec.id}`)}>Open this case in the document library</button>.</p>
    </div>
  );
}

function FindingEvidence({ finding }: { finding: Finding }) {
  const docs = useFindingDocs(finding);
  if (!docs) return null;
  return <div><EvidenceHeading /><EvidenceComparison finding={finding} docs={docs} /></div>;
}

function CaseReview({ finding, caseRec }: { finding: Finding; caseRec: CaseRecord }) {
  const events = useFindingEvents(finding.id);
  return (
    <>
      <ReviewPanel finding={finding} caseRec={caseRec} />
      {events ? <DecisionHistory finding={finding} events={events} /> : null}
    </>
  );
}

function DocumentListItem({ doc, active, findings, onSelect }: { doc: DocumentRecord; active: boolean; findings: number; onSelect: () => void }) {
  return (
    <li>
      <button onClick={onSelect} aria-current={active ? 'true' : undefined} className={cx('flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-150', active ? 'bg-brand-50 ring-1 ring-inset ring-brand/20' : 'hover:bg-hover')}>
        <DocKindIcon kind={doc.fileKind} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{doc.title}</span>
          <span className="block truncate text-[11.5px] text-muted">{DOCUMENT_TYPE_LABEL[doc.documentType]} · {doc.fileKind.toUpperCase()} · {formatDate(doc.documentDate)}</span>
          <span className="mt-1 flex items-center gap-1.5"><ProcessingBadge status={doc.status} />{findings ? <span className="text-[11.5px] text-muted">{findings} finding{findings === 1 ? '' : 's'}</span> : null}</span>
        </span>
      </button>
    </li>
  );
}

function FindingListItem({ f, active, onSelect }: { f: Finding; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button onClick={onSelect} aria-current={active ? 'true' : undefined} data-testid="case-finding-item" className={cx('w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150', active ? 'bg-brand-50 ring-1 ring-inset ring-brand/20' : 'hover:bg-hover')}>
        <span className="flex items-center gap-1.5"><SeverityBadge severity={severityOf(f)} compact /><span className="truncate text-[11.5px] text-muted">{CATEGORY_LABEL[f.category]}</span><ChevronRight size={14} className={cx('ml-auto shrink-0', active ? 'text-brand' : 'text-faint')} aria-hidden /></span>
        <span className="mt-1 block text-[13px] font-medium leading-snug text-ink">{f.title}</span>
        <span className="mt-1.5 flex items-center gap-2"><StatusBadge status={f.reviewStatus} /><span className="text-[11.5px] text-faint">{f.evidence.length} evidence</span></span>
      </button>
    </li>
  );
}

function DocumentPreviewPanel({ doc, findings, onFinding }: { doc: DocumentRecord; findings: Finding[]; onFinding: (id: string) => void }) {
  return (
    <SectionCard title={doc.title} icon={<FileText size={16} aria-hidden />} actions={<Link to={`/documents/${doc.id}`} className="btn-secondary btn-sm">Open viewer<ExternalLink size={13} aria-hidden /></Link>} testId="case-doc-preview">
      <div className="mb-3 flex flex-wrap gap-2 text-xs"><Badge>{DOCUMENT_TYPE_LABEL[doc.documentType]}</Badge><Badge>{doc.fileKind.toUpperCase()} · {(doc.sizeBytes / 1024).toFixed(1)} KB</Badge><Badge>{formatDate(doc.documentDate)}</Badge><ProcessingBadge status={doc.status} /></div>
      {findings.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px]"><span className="text-muted">Related findings:</span>{findings.map((f) => <button key={f.id} className="chip bg-brand-50 text-brand-700 hover:bg-brand-100" onClick={() => onFinding(f.id)}>{f.displayId}</button>)}</div>
      ) : null}
      {doc.extractedText ? (
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-subtle p-4 font-mono text-[12.5px] leading-6 text-ink" data-testid="case-doc-text">{doc.extractedText}</pre>
      ) : <Callout tone="warn" title="No extracted text">{doc.extractionErrors[0] ?? 'Text could not be extracted from this document.'}</Callout>}
      <p className="mt-2 text-xs text-faint">Extracted text shown as plain text; uploaded content is never rendered as HTML.</p>
    </SectionCard>
  );
}
