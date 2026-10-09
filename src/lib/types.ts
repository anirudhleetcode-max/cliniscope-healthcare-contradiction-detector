// Core domain types for MEDGUARD. These are shared by the extraction
// pipeline, the detection engine, the persistence layer and the UI.

export type Category =
  | 'allergy'
  | 'medication'
  | 'diagnosis'
  | 'lab'
  | 'procedure'
  | 'history'
  | 'demographic'
  | 'other';

export const CATEGORY_LABEL: Record<Category, string> = {
  allergy: 'Allergy',
  medication: 'Medication',
  diagnosis: 'Diagnosis',
  lab: 'Laboratory result',
  procedure: 'Procedure',
  history: 'Medical history',
  demographic: 'Demographics',
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
  | 'ocr_running'
  | 'extracted'
  | 'analyzing'
  | 'analyzed'
  | 'needs_attention'
  | 'failed';

export type FileKind = 'pdf' | 'txt' | 'docx' | 'image';

export type ExtractionMethod = 'pdf-text-layer' | 'pdf-ocr' | 'pdf-text-layer+ocr' | 'image-ocr' | 'plain-text' | 'docx-raw-text';

export const EXTRACTION_METHOD_LABEL: Record<ExtractionMethod, string> = {
  'pdf-text-layer': 'PDF text layer (pdf.js)',
  'pdf-ocr': 'OCR of scanned PDF pages (Tesseract.js)',
  'pdf-text-layer+ocr': 'PDF text layer + OCR of scanned pages (Tesseract.js)',
  'image-ocr': 'OCR of image (Tesseract.js)',
  'plain-text': 'Plain-text decoding (UTF-8)',
  'docx-raw-text': 'DOCX paragraph text (mammoth)',
};

/** Character span of a verified PDF page inside the concatenated extracted text. */
export interface PageSpan {
  page: number;
  start: number;
  end: number;
  /** How this page's text was obtained. Absent on records created before OCR support (= text layer). */
  method?: 'text-layer' | 'ocr';
  /** Mean word confidence reported by the OCR engine (0-100), when OCR was used. */
  ocrConfidence?: number | null;
}

export interface OcrSpan {
  start: number;
  end: number;
  confidence: number;
  text: string;
}

export type CaseRole = 'owner' | 'reviewer' | 'viewer';

export interface CaseRecord {
  id: string;
  label: string;
  isDemo: boolean;
  /** Stable key of a synthetic demo case (e.g. "DEMO-0042"); absent for user-created cases. */
  demoKey?: string;
  /** Short description of what a synthetic demo case demonstrates. */
  demoScenario?: string;
  /** When seeding of a demo case finished. Events at or before this time are seeded examples. */
  seededAt?: string;
  /** Present when this case is stored in a shared workspace server; the local copy is a cache. */
  remote?: {
    serverUrl: string; role: CaseRole; owner: string; syncedAt: string | null;
    /** Local changes not yet accepted by the server; background pulls are suspended while set. */
    unsynced?: boolean;
    /** Documents deleted locally whose deletion has not yet been sent to the server. */
    pendingRemovals?: string[];
  };
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
  /** OCR words whose engine-reported confidence was below the review threshold (character offsets into extractedText). */
  ocrLowConfidence?: OcrSpan[];
  /** Character spans of text produced by OCR (whole pages or images). */
  ocrRegions?: { start: number; end: number; confidence: number | null }[];
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
  /** True when the quoted source text was produced by OCR. */
  ocrDerived?: boolean;
  /** Lowest OCR word confidence inside the quote (engine-reported, 0-100); null when not OCR. */
  ocrMinConfidence?: number | null;
  /** True when a word in the quote fell below the OCR confidence threshold. */
  ocrLowConfidence?: boolean;
  /** True when a value is expected (e.g. a unit is present) but could not be read. */
  valueUnreadable?: boolean;
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

/**
 * Review status. The first five exist in both local and shared mode; needs_info,
 * expected_change and undetermined are local-mode review outcomes only (see lib/review.ts).
 */
export type ReviewStatus =
  | 'unreviewed' | 'in_review' | 'confirmed' | 'resolved' | 'dismissed'
  | 'needs_info' | 'expected_change' | 'undetermined';

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  unreviewed: 'Unreviewed',
  in_review: 'In review',
  confirmed: 'Confirmed discrepancy',
  resolved: 'Resolved by reviewer',
  dismissed: 'Dismissed — not a contradiction',
  needs_info: 'Needs more information',
  expected_change: 'Expected change',
  undetermined: 'Unable to determine',
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
  ocrDerived?: boolean;
  ocrMinConfidence?: number | null;
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
  /** Which engine proposed the finding. Absent = deterministic rules. */
  origin?: 'rules' | 'ai';
  /** Model identifier for AI-assisted findings. */
  aiModel?: string;
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
  | 'note_added'
  | 'ai_analysis_completed'
  | 'ai_analysis_failed'
  | 'case_shared'
  | 'member_added'
  | 'member_removed'
  | 'case_synced'
  | 'case_updated'
  | 'demo_reset';

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
