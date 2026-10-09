// Core domain types for CLINISCOPE. These are shared by the extraction
// pipeline, the detection engine, the persistence layer and the UI.

export type Category =
  | 'allergy'
  | 'medication'
  | 'diagnosis'
  | 'lab'
  | 'procedure'
  | 'history'
  | 'other';

export const CATEGORY_LABEL: Record<Category, string> = {
  allergy: 'Allergy',
  medication: 'Medication',
  diagnosis: 'Diagnosis',
  lab: 'Laboratory result',
  procedure: 'Procedure',
  history: 'Medical history',
  other: 'Other clinical information',
};

export type DocumentType =
  | 'discharge_summary'
  | 'intake_form'
  | 'medication_reconciliation'
  | 'lab_report'
  | 'prescription'
  | 'clinical_note'
  | 'allergy_record'
  | 'other';

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  discharge_summary: 'Discharge summary',
  intake_form: 'Patient intake form',
  medication_reconciliation: 'Medication reconciliation',
  lab_report: 'Laboratory report',
  prescription: 'Prescription',
  clinical_note: 'Clinical note',
  allergy_record: 'Allergy record',
  other: 'Other',
};

export type ProcessingStatus =
  | 'uploaded'
  | 'extracting'
  | 'extracted'
  | 'analyzing'
  | 'analyzed'
  | 'needs_attention'
  | 'failed';

export type FileKind = 'pdf' | 'txt' | 'docx';

export type ExtractionMethod = 'pdf-text-layer' | 'plain-text' | 'docx-raw-text';

export const EXTRACTION_METHOD_LABEL: Record<ExtractionMethod, string> = {
  'pdf-text-layer': 'PDF text layer (pdf.js) — no OCR',
  'plain-text': 'Plain-text decoding (UTF-8)',
  'docx-raw-text': 'DOCX paragraph text (mammoth)',
};

/** Character span of a verified PDF page inside the concatenated extracted text. */
export interface PageSpan {
  page: number;
  start: number;
  end: number;
}

export interface CaseRecord {
  id: string;
  label: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  lastAnalyzedAt: string | null;
}

export interface DocumentRecord {
  id: string;
  caseId: string;
  originalFilename: string;
  title: string;
  documentType: DocumentType;
  /** Clinical/document date as YYYY-MM-DD. Null when unknown — never replaced by upload time. */
  documentDate: string | null;
  uploadedAt: string;
  status: ProcessingStatus;
  fileKind: FileKind;
  mimeType: string;
  sizeBytes: number;
  extractionMethod: ExtractionMethod | null;
  extractedText: string;
  pageCount: number | null;
  pageSpans: PageSpan[];
  extractionErrors: string[];
  extractionWarnings: string[];
  contentHash: string;
  statementCount: number;
  isSeededDemo: boolean;
}

export type Polarity = 'positive' | 'negative';
export type Temporality = 'current' | 'historical' | 'changed' | 'unspecified';
export type StatementStatus = 'active' | 'discontinued' | 'uncertain' | 'resolved' | 'none';

export interface ClinicalStatement {
  id: string;
  caseId: string;
  documentId: string;
  category: Category;
  /** Normalized concept key, e.g. "allergy:penicillin" or "medication:metformin". */
  concept: string;
  /** Human readable concept label, e.g. "Penicillin". */
  conceptLabel: string;
  /** Exact source text: always equal to document.extractedText.slice(charStart, charEnd). */
  originalText: string;
  subject: 'patient';
  polarity: Polarity;
  value: string | null;
  numericValue: number | null;
  unit: string | null;
  frequency: string | null;
  route: string | null;
  /** For documented changes ("increased from 10 mg") the prior value. */
  previousValue: number | null;
  temporality: Temporality;
  status: StatementStatus;
  /** Specimen / event date mentioned in the text (YYYY-MM-DD), if any. */
  eventDate: string | null;
  sourcePage: number | null;
  sourceSection: string | null;
  sourceLine: number | null;
  sourceParagraph: number | null;
  charStart: number;
  charEnd: number;
  extractionMethod: 'deterministic-rules';
  extractionConfidence: 'high' | 'moderate' | 'low';
}

export type FindingType =
  | 'explicit_conflict'
  | 'potential_discrepancy'
  | 'temporal_inconsistency'
  | 'context_dependent'
  | 'insufficient_evidence';

export const FINDING_TYPE_LABEL: Record<FindingType, string> = {
  explicit_conflict: 'Explicit text conflict',
  potential_discrepancy: 'Potential value discrepancy',
  temporal_inconsistency: 'Temporal inconsistency',
  context_dependent: 'Historical / contextual difference',
  insufficient_evidence: 'Insufficient evidence',
};

export type EvidenceQuality = 'high' | 'moderate' | 'limited' | 'insufficient';

export const EVIDENCE_QUALITY_LABEL: Record<EvidenceQuality, string> = {
  high: 'High evidence availability',
  moderate: 'Moderate evidence availability',
  limited: 'Limited evidence availability',
  insufficient: 'Insufficient evidence',
};

export type ReviewPriority = 'prompt' | 'routine' | 'low';

export const REVIEW_PRIORITY_LABEL: Record<ReviewPriority, string> = {
  prompt: 'Prompt review suggested',
  routine: 'Routine review',
  low: 'Low — informational',
};

export type ReviewStatus = 'unreviewed' | 'in_review' | 'confirmed' | 'resolved' | 'dismissed';

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  unreviewed: 'Unreviewed',
  in_review: 'In review',
  confirmed: 'Confirmed discrepancy',
  resolved: 'Resolved by reviewer',
  dismissed: 'Dismissed — not a contradiction',
};

export interface EvidenceRef {
  statementId: string;
  documentId: string;
  side: 'A' | 'B';
  quote: string;
  charStart: number;
  charEnd: number;
  page: number | null;
  section: string | null;
  line: number | null;
  paragraph: number | null;
  documentTitle: string;
  documentDate: string | null;
  extractionMethod: ExtractionMethod | null;
}

export interface Finding {
  id: string;
  caseId: string;
  /** Deterministic fingerprint used to reconcile findings across re-analysis. */
  fingerprint: string;
  displayId: string;
  category: Category;
  concept: string;
  title: string;
  findingType: FindingType;
  statementIds: string[];
  sourceDocumentIds: string[];
  evidence: EvidenceRef[];
  sideALabel: string;
  sideBLabel: string;
  explanation: string;
  comparisonReason: string;
  contextualCaveats: string[];
  alternativeExplanations: string[];
  evidenceQuality: EvidenceQuality;
  evidenceQualityReason: string;
  reviewPriority: ReviewPriority;
  detectionMethod: string;
  reviewStatus: ReviewStatus;
  /** True when the latest analysis no longer produced this finding (e.g. a source was removed). */
  stale: boolean;
  isSeededDemo: boolean;
  relevantDates: string[];
  createdAt: string;
  updatedAt: string;
}

export type EventKind =
  | 'case_created'
  | 'document_uploaded'
  | 'document_extracted'
  | 'document_failed'
  | 'document_deleted'
  | 'analysis_started'
  | 'analysis_completed'
  | 'analysis_failed'
  | 'finding_created'
  | 'finding_superseded'
  | 'status_changed'
  | 'note_added';

/** Append-only audit / timeline event. Never updated after insert. */
export interface AuditEvent {
  id: string;
  caseId: string;
  kind: EventKind;
  at: string;
  actor: string;
  findingId?: string;
  documentId?: string;
  fromStatus?: ReviewStatus;
  toStatus?: ReviewStatus;
  reason?: string;
  note?: string;
  detail?: string;
}

export interface AnalysisSummary {
  documentsAnalyzed: number;
  statementsExtracted: number;
  comparisonsEvaluated: number;
  consistentComparisons: number;
  temporallyExplainedComparisons: number;
  findingsCreated: number;
  findingsRetained: number;
  findingsSuperseded: number;
  findingsTotalActive: number;
}
