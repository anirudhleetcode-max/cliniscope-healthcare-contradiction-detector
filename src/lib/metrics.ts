// Pure, testable derivations used by the dashboard, case list and queue.
// Every number shown in the UI is computed here from stored records — never hard-coded.
import { CLOSED_STATUSES, PENDING_STATUSES } from './review';
import type { CaseRecord, Category, DocumentRecord, Finding, FindingType, ReviewPriority, ReviewStatus } from './types';

export type Severity = 'high' | 'medium' | 'low';

/**
 * Display severity is the engine's workflow review priority (allergy / medication conflicts
 * first). It is not a clinical risk score and is never derived from a single keyword.
 */
export const SEVERITY_OF: Record<ReviewPriority, Severity> = { prompt: 'high', routine: 'medium', low: 'low' };
export const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Informational' };
export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];

export const severityOf = (f: Pick<Finding, 'reviewPriority'>): Severity => SEVERITY_OF[f.reviewPriority];

export const isPending = (f: Finding) => PENDING_STATUSES.includes(f.reviewStatus);
export const isOpen = (f: Finding) => !CLOSED_STATUSES.includes(f.reviewStatus);
export const active = (list: Finding[] | undefined) => (list ?? []).filter((f) => !f.stale);

/** Plain-language nature of a finding — distinguishes a potential contradiction from missing data or a time difference. */
export type FindingNature = 'potential' | 'temporal' | 'missing' | 'uncertain_extraction' | 'confirmed';
export const NATURE_LABEL: Record<FindingNature, string> = {
  potential: 'Potential contradiction',
  temporal: 'Temporal difference',
  missing: 'Missing or uncertain information',
  uncertain_extraction: 'Uncertain extraction',
  confirmed: 'Human-confirmed contradiction',
};
const NATURE_OF_TYPE: Record<FindingType, FindingNature> = {
  explicit_conflict: 'potential',
  potential_discrepancy: 'potential',
  temporal_inconsistency: 'potential',
  context_dependent: 'temporal',
  insufficient_evidence: 'missing',
};
export function natureOf(f: Finding): FindingNature {
  if (f.reviewStatus === 'confirmed') return 'confirmed';
  if (f.findingType === 'insufficient_evidence') return 'missing';
  if (f.evidence.some((e) => e.ocrDerived && e.ocrMinConfidence != null && e.ocrMinConfidence < 60)) return 'uncertain_extraction';
  return NATURE_OF_TYPE[f.findingType];
}

export type CaseReviewState = 'empty' | 'awaiting_analysis' | 'no_findings' | 'not_started' | 'in_progress' | 'reviewed';
export const CASE_STATE_LABEL: Record<CaseReviewState, string> = {
  empty: 'No documents',
  awaiting_analysis: 'Awaiting analysis',
  no_findings: 'No findings',
  not_started: 'Not started',
  in_progress: 'In progress',
  reviewed: 'Reviewed',
};

export interface CaseSummary {
  caseRecord: CaseRecord;
  displayId: string;
  alias: string;
  documents: DocumentRecord[];
  findings: Finding[];
  documentCount: number;
  findingCount: number;
  highCount: number;
  pendingCount: number;
  decidedCount: number;
  state: CaseReviewState;
  lastActivity: string;
  categories: Set<Category>;
}

/** "DEMO-0042 · Synthetic Patient SP-0042" → id "DEMO-0042", alias "Synthetic Patient SP-0042". */
export function splitLabel(label: string): { displayId: string; alias: string } {
  const i = label.indexOf(' · ');
  return i > 0 ? { displayId: label.slice(0, i), alias: label.slice(i + 3) } : { displayId: label, alias: '—' };
}

export function summarizeCase(c: CaseRecord, allDocs: DocumentRecord[], allFindings: Finding[]): CaseSummary {
  const documents = allDocs.filter((d) => d.caseId === c.id);
  const findings = active(allFindings.filter((f) => f.caseId === c.id));
  const pendingCount = findings.filter(isPending).length;
  const awaiting = documents.length > 0 && (!c.lastAnalyzedAt || documents.some((d) => d.status === 'extracted'));
  const state: CaseReviewState = documents.length === 0 ? 'empty'
    : awaiting ? 'awaiting_analysis'
    : findings.length === 0 ? 'no_findings'
    : pendingCount === findings.length && findings.every((f) => f.reviewStatus === 'unreviewed') ? 'not_started'
    : pendingCount > 0 ? 'in_progress' : 'reviewed';
  const { displayId, alias } = splitLabel(c.label);
  return {
    caseRecord: c, displayId, alias, documents, findings,
    documentCount: documents.length,
    findingCount: findings.length,
    highCount: findings.filter((f) => severityOf(f) === 'high').length,
    pendingCount,
    decidedCount: findings.length - pendingCount,
    state,
    lastActivity: c.updatedAt,
    categories: new Set(findings.map((f) => f.category)),
  };
}

export interface WorkspaceMetrics {
  caseCount: number;
  casesReviewed: number;
  analyzedCases: number;
  openContradictions: number;
  pendingReviews: number;
  documentsProcessed: number;
  documentCount: number;
  documentsNeedingAttention: number;
  byCategory: Map<Category, number>;
  byStatus: Map<ReviewStatus, number>;
  bySeverity: Map<Severity, number>;
}

export function workspaceMetrics(cases: CaseRecord[], docs: DocumentRecord[], findings: Finding[]): WorkspaceMetrics {
  const summaries = cases.map((c) => summarizeCase(c, docs, findings));
  const live = active(findings).filter((f) => cases.some((c) => c.id === f.caseId));
  const count = <K,>(keys: K[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<K, number>());
  return {
    caseCount: cases.length,
    casesReviewed: summaries.filter((s) => s.state === 'reviewed' || s.state === 'no_findings').length,
    analyzedCases: summaries.filter((s) => !!s.caseRecord.lastAnalyzedAt).length,
    openContradictions: live.filter(isOpen).length,
    pendingReviews: live.filter(isPending).length,
    documentsProcessed: docs.filter((d) => d.status === 'analyzed' || d.status === 'extracted').length,
    documentCount: docs.length,
    documentsNeedingAttention: docs.filter((d) => d.status === 'needs_attention' || d.status === 'failed').length,
    byCategory: count(live.map((f) => f.category)),
    byStatus: count(live.map((f) => f.reviewStatus)),
    bySeverity: count(live.map(severityOf)),
  };
}

/** Template-based review prompt for a finding type. Clearly a template, not an AI-generated question. */
export function suggestedQuestion(f: Finding): string {
  switch (f.findingType) {
    case 'explicit_conflict': return 'Do both records describe the same period, and which source reflects the current documented status? Is one entry outdated or incomplete?';
    case 'potential_discrepancy': return 'Do the values refer to the same date, specimen or prescription? Was one value changed, transcribed incorrectly, or recorded from a different source?';
    case 'temporal_inconsistency': return 'Was the status changed again after the earlier record (for example, restarted), or is the later record carrying forward an outdated entry?';
    case 'context_dependent': return 'Does the documented change explain the difference fully, and is the later value the one currently in use?';
    case 'insufficient_evidence': return 'Can the missing or uncertain information be verified from the original source or with the patient before comparing?';
  }
}
