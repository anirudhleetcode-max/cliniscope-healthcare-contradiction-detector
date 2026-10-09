// Domain-specific display components shared across pages.
import { Link, useNavigate } from 'react-router-dom';
import { Eye, FileImage, FileText, FileType2, Files } from 'lucide-react';
import { Badge, cx, SeverityBadge, StatusBadge, TypeBadge } from './ui';
import { formatDate, formatDateTime } from '../lib/dates';
import { CASE_STATE_LABEL, severityOf, splitLabel, type CaseReviewState } from '../lib/metrics';
import type { AnalysisSummary, AuditEvent, CaseRecord, FileKind, Finding } from '../lib/types';
import { CATEGORY_LABEL } from '../lib/types';

export function latestSummary(events: AuditEvent[] | undefined, caseId: string): AnalysisSummary | null {
  const ev = [...(events ?? [])].reverse().find((e) => e.caseId === caseId && e.kind === 'analysis_completed');
  try { return ev?.detail ? JSON.parse(ev.detail) : null; } catch { return null; }
}

export function AnalysisSummaryList({ summary, at }: { summary: AnalysisSummary; at?: string | null }) {
  const rows: [string, number][] = [
    ['Documents analyzed', summary.documentsAnalyzed],
    ['Statements compared', summary.statementsExtracted],
    ['Comparisons evaluated', summary.comparisonsEvaluated],
    ['Consistent (not flagged)', summary.consistentComparisons],
    ['Explained by dates / documented change', summary.temporallyExplainedComparisons],
    ['Findings produced', summary.findingsTotalActive],
    ['New in last run', summary.findingsCreated],
  ];
  return (
    <div>
      <dl className="divide-y divide-line text-[13.5px]" data-testid="analysis-summary">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-muted">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>)}
      </dl>
      <p className="mt-2 text-xs text-faint">Method: deterministic rules (no AI model).{at ? ` Completed ${formatDateTime(at)}.` : ''}</p>
    </div>
  );
}

const STATE_TONE: Record<CaseReviewState, 'neutral' | 'info' | 'warn' | 'ok' | 'brand'> = {
  empty: 'neutral', awaiting_analysis: 'warn', no_findings: 'neutral', not_started: 'info', in_progress: 'brand', reviewed: 'ok',
};
export function CaseStateBadge({ state }: { state: CaseReviewState }) {
  return <Badge tone={STATE_TONE[state]} testId="case-state">{CASE_STATE_LABEL[state]}</Badge>;
}

export function DocKindIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = kind === 'pdf' ? FileType2 : kind === 'image' ? FileImage : kind === 'docx' ? Files : FileText;
  return <Icon size={16} className={cx('shrink-0 text-faint', className)} aria-hidden />;
}

/** Dense findings table with a mobile card fallback. Rows open the finding; an optional preview button opens a drawer. */
export function FindingsTable({ rows, cases, onPreview, testId = 'queue-table', compact, emptyNote }: {
  rows: Finding[]; cases: Map<string, CaseRecord>; onPreview?: (f: Finding) => void; testId?: string; compact?: boolean; emptyNote?: string;
}) {
  const navigate = useNavigate();
  if (!rows.length) return <p className="px-5 py-8 text-center text-[13.5px] text-muted">{emptyNote ?? 'No findings.'}</p>;
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="table" data-testid={testId}>
          <thead>
            <tr>
              <th scope="col" className="w-[110px]">Severity</th>
              <th scope="col">Finding</th>
              <th scope="col">Case</th>
              {!compact ? <th scope="col">Category</th> : null}
              <th scope="col">Sources</th>
              <th scope="col">Review status</th>
              <th scope="col">Updated</th>
              {onPreview ? <th scope="col" className="w-[60px]"><span className="sr-only">Preview</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const c = cases.get(f.caseId);
              return (
                <tr key={f.id} className={cx('row-link', f.stale && 'opacity-60')} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) navigate(`/findings/${f.id}`); }}>
                  <td><SeverityBadge severity={severityOf(f)} compact /></td>
                  <td className="min-w-[300px]">
                    <Link to={`/findings/${f.id}`} className="line-clamp-2 font-medium leading-snug text-ink hover:text-brand" data-testid="finding-link" title={f.title}>{f.title}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5"><span className="font-mono text-[11px] text-faint">{f.displayId}</span><TypeBadge type={f.findingType} />{f.origin === 'ai' ? <Badge tone="brand">AI-assisted</Badge> : null}{f.stale ? <Badge>Superseded</Badge> : null}</div>
                  </td>
                  <td>{c ? <Link to={`/cases/${c.id}`} className="font-mono text-[12.5px] text-muted hover:text-brand">{splitLabel(c.label).displayId}</Link> : '—'}</td>
                  {!compact ? <td className="whitespace-nowrap text-muted">{CATEGORY_LABEL[f.category]}</td> : null}
                  <td className="whitespace-nowrap"><span className="inline-flex items-center gap-1 text-muted"><FileText size={13} aria-hidden />{f.sourceDocumentIds.length} docs</span></td>
                  <td className="whitespace-nowrap"><StatusBadge status={f.reviewStatus} /></td>
                  <td className="whitespace-nowrap text-xs tabular-nums text-muted">{formatDateTime(f.updatedAt)}</td>
                  {onPreview ? <td><button className="btn-icon h-8 w-8" onClick={() => onPreview(f)} aria-label={`Preview ${f.displayId}`} title="Quick preview" data-testid="preview-finding"><Eye size={16} /></button></td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line lg:hidden">
        {rows.map((f) => {
          const c = cases.get(f.caseId);
          return (
            <li key={f.id}>
              <Link to={`/findings/${f.id}`} className="block px-4 py-3.5 active:bg-hover">
                <div className="flex items-center justify-between gap-2"><SeverityBadge severity={severityOf(f)} compact /><StatusBadge status={f.reviewStatus} /></div>
                <div className="mt-1.5 text-[14px] font-medium">{f.title}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"><span className="font-mono">{f.displayId}</span>·<span>{c ? splitLabel(c.label).displayId : ''}</span>·<span>{CATEGORY_LABEL[f.category]}</span>·<span>{f.sourceDocumentIds.length} docs</span></div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function RelevantDates({ f }: { f: Finding }) {
  return <span className="text-xs text-muted">{f.relevantDates.map(formatDate).join(' · ')}</span>;
}
