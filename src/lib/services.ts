// Application service layer: ingestion, analysis, review and audit.
// All writes go through here so that every state change is paired with an
// append-only audit event.
import type { CliniscopeDB } from './db';
import { isValidIsoDate } from './dates';
import { detectContradictions } from './detect';
import {
  DEFAULT_MAX_UPLOAD_BYTES, UploadValidationError, sanitizeFilename, sha256Hex, validateUpload,
  type ExtractionResult,
} from './extract';
import { ReviewError, validateTransition } from './review';
import { extractStatements } from './statements';
import type {
  AnalysisSummary, AuditEvent, CaseRecord, DocumentRecord, DocumentType, EventKind, FileKind, Finding,
  ReviewStatus,
} from './types';
import { DOCUMENT_TYPE_LABEL } from './types';

export type Extractor = (kind: FileKind, bytes: Uint8Array) => Promise<ExtractionResult>;

export const DEMO_CASE_LABEL = 'DEMO-0042 · Synthetic Patient SP-0042';
export const DEMO_REVIEWER = 'Demo Reviewer (unauthenticated demo identity)';

export class ServiceError extends Error {}

export function uid(prefix: string): string {
  const rnd = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().replace(/-/g, '') : Math.random().toString(16).slice(2);
  return `${prefix}_${rnd.slice(0, 16)}`;
}

const now = () => new Date().toISOString();

let lastEventTs = 0;
/** Strictly increasing ISO timestamps so the append-only log has a stable order. */
function eventTime(): string {
  const t = Math.max(Date.now(), lastEventTs + 1);
  lastEventTs = t;
  return new Date(t).toISOString();
}

async function logEvent(db: CliniscopeDB, e: Omit<AuditEvent, 'id' | 'at'> & { kind: EventKind }): Promise<AuditEvent> {
  const ev: AuditEvent = { id: uid('ev'), at: eventTime(), ...e };
  await db.events.add(ev); // add(): never overwrites an existing event
  return ev;
}

// -------------------------------------------------------------------- cases
export async function createCase(db: CliniscopeDB, label: string, opts: { isDemo?: boolean; actor?: string } = {}): Promise<CaseRecord> {
  const clean = label.trim().slice(0, 80);
  if (!clean) throw new ServiceError('Enter a case label (use a pseudonymous label, not a real patient name).');
  const c: CaseRecord = { id: uid('case'), label: clean, isDemo: !!opts.isDemo, createdAt: now(), updatedAt: now(), lastAnalyzedAt: null };
  await db.cases.add(c);
  await logEvent(db, { caseId: c.id, kind: 'case_created', actor: opts.actor ?? DEMO_REVIEWER, detail: c.isDemo ? 'Synthetic demonstration case created' : 'Case created' });
  return c;
}

async function touchCase(db: CliniscopeDB, caseId: string, patch: Partial<CaseRecord> = {}): Promise<void> {
  await db.cases.update(caseId, { updatedAt: now(), ...patch });
}

async function requireCase(db: CliniscopeDB, caseId: string): Promise<CaseRecord> {
  const c = await db.cases.get(caseId);
  if (!c) throw new ServiceError('Case not found. It may have been deleted.');
  return c;
}

// ---------------------------------------------------------------- ingestion
export interface UploadInput {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface DocumentMeta {
  title?: string;
  documentType?: DocumentType;
  documentDate?: string | null;
  isSeededDemo?: boolean;
}

export async function uploadDocument(
  db: CliniscopeDB,
  extractor: Extractor,
  caseId: string,
  file: UploadInput,
  meta: DocumentMeta = {},
  opts: { actor?: string; maxBytes?: number } = {},
): Promise<DocumentRecord> {
  await requireCase(db, caseId);
  const filename = sanitizeFilename(file.name);
  const kind = validateUpload(filename, file.mime, file.bytes, opts.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES);
  if (meta.documentDate && !isValidIsoDate(meta.documentDate)) {
    throw new UploadValidationError(`"${meta.documentDate}" is not a valid document date (expected YYYY-MM-DD).`);
  }
  const contentHash = await sha256Hex(file.bytes);
  const dup = await db.documents.where('[caseId+contentHash]').equals([caseId, contentHash]).first();
  if (dup) throw new UploadValidationError(`This file is identical to "${dup.title}", which is already in this case.`);

  const actor = opts.actor ?? DEMO_REVIEWER;
  const documentType = meta.documentType ?? 'other';
  const doc: DocumentRecord = {
    id: uid('doc'),
    caseId,
    originalFilename: filename,
    title: (meta.title?.trim() || filename.replace(/\.[^.]+$/, '')).slice(0, 120),
    documentType,
    documentDate: meta.documentDate || null,
    uploadedAt: now(),
    status: 'extracting',
    fileKind: kind,
    mimeType: file.mime || 'application/octet-stream',
    sizeBytes: file.bytes.byteLength,
    extractionMethod: null,
    extractedText: '',
    pageCount: null,
    pageSpans: [],
    extractionErrors: [],
    extractionWarnings: [],
    contentHash,
    statementCount: 0,
    isSeededDemo: !!meta.isSeededDemo,
  };
  await db.transaction('rw', db.documents, db.files, db.events, async () => {
    await db.documents.add(doc);
    await db.files.add({ id: doc.id, caseId, blob: new Blob([file.bytes], { type: doc.mimeType }) });
    await logEvent(db, {
      caseId, documentId: doc.id, kind: 'document_uploaded', actor,
      detail: `${doc.title} (${DOCUMENT_TYPE_LABEL[documentType]}, ${kind.toUpperCase()}, ${(doc.sizeBytes / 1024).toFixed(1)} KB)`,
    });
  });

  let res: ExtractionResult;
  try {
    res = await extractor(kind, file.bytes);
  } catch {
    res = { ok: false, text: '', method: null, pageCount: null, pageSpans: [], errors: ['Text extraction failed unexpectedly.'], warnings: [], needsAttention: false };
  }
  const updated: DocumentRecord = {
    ...doc,
    extractionMethod: res.method,
    extractedText: res.text,
    pageCount: res.pageCount,
    pageSpans: res.pageSpans,
    extractionErrors: res.errors,
    extractionWarnings: res.warnings,
    status: !res.ok ? (res.needsAttention ? 'needs_attention' : 'failed') : res.needsAttention ? 'needs_attention' : 'extracted',
  };
  const statements = res.ok ? extractStatements(updated) : [];
  updated.statementCount = statements.length;
  await db.transaction('rw', db.documents, db.statements, db.events, db.cases, async () => {
    await db.documents.put(updated);
    await db.statements.where('documentId').equals(doc.id).delete();
    await db.statements.bulkAdd(statements);
    await logEvent(db, {
      caseId, documentId: doc.id, kind: res.ok ? 'document_extracted' : 'document_failed', actor: 'System',
      detail: res.ok
        ? `${res.text.length.toLocaleString()} characters extracted${res.pageCount ? ` from ${res.pageCount} page(s)` : ''}; ${statements.length} clinical statement(s) identified${res.warnings.length ? `. Warning: ${res.warnings[0]}` : ''}`
        : res.errors.join(' '),
    });
    await touchCase(db, caseId);
  });
  return updated;
}

export async function updateDocumentMeta(
  db: CliniscopeDB,
  documentId: string,
  patch: { title?: string; documentType?: DocumentType; documentDate?: string | null },
): Promise<DocumentRecord> {
  const doc = await db.documents.get(documentId);
  if (!doc) throw new ServiceError('Document not found.');
  if (patch.documentDate && !isValidIsoDate(patch.documentDate)) throw new ServiceError('Invalid document date (expected YYYY-MM-DD).');
  const next = {
    ...doc,
    ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 120) || doc.title } : {}),
    ...(patch.documentType ? { documentType: patch.documentType } : {}),
    ...(patch.documentDate !== undefined ? { documentDate: patch.documentDate || null } : {}),
  };
  await db.documents.put(next);
  await touchCase(db, doc.caseId);
  return next;
}

export async function deleteDocument(db: CliniscopeDB, documentId: string, actor = DEMO_REVIEWER): Promise<void> {
  const doc = await db.documents.get(documentId);
  if (!doc) throw new ServiceError('Document not found.');
  await db.transaction('rw', db.documents, db.files, db.statements, db.events, db.cases, async () => {
    await db.documents.delete(documentId);
    await db.files.delete(documentId);
    await db.statements.where('documentId').equals(documentId).delete();
    await logEvent(db, { caseId: doc.caseId, documentId, kind: 'document_deleted', actor, detail: `${doc.title} removed. Existing findings keep their recorded evidence; re-run analysis to reconcile.` });
    await touchCase(db, doc.caseId);
  });
}

// ----------------------------------------------------------------- analysis
let analysisInFlight = new Map<string, Promise<AnalysisSummary>>();

/**
 * Re-runs detection over every successfully extracted document in the case.
 * Findings are reconciled by fingerprint: existing findings (and their review
 * status and history) are kept, new ones are added, and findings that are no
 * longer produced are marked stale — never deleted.
 */
export function analyzeCase(db: CliniscopeDB, caseId: string, actor = DEMO_REVIEWER): Promise<AnalysisSummary> {
  // Guard against duplicate concurrent analysis requests for the same case.
  const existing = analysisInFlight.get(caseId);
  if (existing) return existing;
  const p = runAnalysis(db, caseId, actor).finally(() => analysisInFlight.delete(caseId));
  analysisInFlight.set(caseId, p);
  return p;
}

export function _resetAnalysisGuard(): void {
  analysisInFlight = new Map();
}

async function runAnalysis(db: CliniscopeDB, caseId: string, actor: string): Promise<AnalysisSummary> {
  const c = await requireCase(db, caseId);
  const docs = (await db.documents.where('caseId').equals(caseId).toArray()).filter((d) => d.extractedText && d.status !== 'failed');
  if (!docs.length) throw new ServiceError('There are no documents with extracted text to analyze in this case.');
  await logEvent(db, { caseId, kind: 'analysis_started', actor, detail: `Analyzing ${docs.length} document(s)` });
  const prevStatus = new Map(docs.map((d) => [d.id, d.status]));
  await db.documents.bulkPut(docs.map((d) => ({ ...d, status: 'analyzing' as const })));
  try {
    const statements = await db.statements.where('caseId').equals(caseId).toArray();
    const result = detectContradictions(caseId, statements, docs);
    const existing = await db.findings.where('caseId').equals(caseId).toArray();
    const byFp = new Map(existing.map((f) => [f.fingerprint, f]));
    const produced = new Set(result.findings.map((f) => f.fingerprint));
    let created = 0;
    let retained = 0;
    let superseded = 0;
    const ts = now();
    await db.transaction('rw', db.findings, db.events, db.documents, db.cases, async () => {
      for (const draft of result.findings) {
        const prior = byFp.get(draft.fingerprint);
        if (prior) {
          retained++;
          await db.findings.put({ ...prior, ...draft, id: prior.id, reviewStatus: prior.reviewStatus, stale: false, createdAt: prior.createdAt, updatedAt: prior.stale ? ts : prior.updatedAt, isSeededDemo: prior.isSeededDemo });
        } else {
          created++;
          const f: Finding = { ...draft, id: uid('fd'), reviewStatus: 'unreviewed', stale: false, createdAt: ts, updatedAt: ts, isSeededDemo: c.isDemo };
          await db.findings.add(f);
          await logEvent(db, { caseId, findingId: f.id, kind: 'finding_created', actor: 'System', detail: `${f.displayId}: ${f.title}` });
        }
      }
      for (const f of existing) {
        if (!produced.has(f.fingerprint) && !f.stale) {
          superseded++;
          await db.findings.put({ ...f, stale: true, updatedAt: ts });
          await logEvent(db, { caseId, findingId: f.id, kind: 'finding_superseded', actor: 'System', detail: `${f.displayId} is no longer produced by the current documents (a source may have been removed or changed). Its evidence and review history are preserved.` });
        }
      }
      await db.documents.bulkPut(docs.map((d) => ({ ...d, status: prevStatus.get(d.id) === 'needs_attention' ? 'needs_attention' as const : 'analyzed' as const })));
      await touchCase(db, caseId, { lastAnalyzedAt: ts });
    });
    const summary: AnalysisSummary = {
      documentsAnalyzed: docs.length,
      statementsExtracted: statements.length,
      comparisonsEvaluated: result.comparisonsEvaluated,
      consistentComparisons: result.consistentComparisons,
      temporallyExplainedComparisons: result.temporallyExplainedComparisons,
      findingsCreated: created,
      findingsRetained: retained,
      findingsSuperseded: superseded,
      findingsTotalActive: result.findings.length,
    };
    await logEvent(db, { caseId, kind: 'analysis_completed', actor: 'System', detail: JSON.stringify(summary) });
    return summary;
  } catch (err) {
    await db.documents.bulkPut(docs.map((d) => ({ ...d, status: prevStatus.get(d.id) ?? 'extracted' })));
    await logEvent(db, { caseId, kind: 'analysis_failed', actor: 'System', detail: err instanceof Error ? err.message : 'Unknown error' });
    throw err;
  }
}

// ------------------------------------------------------------------- review
export async function transitionFinding(
  db: CliniscopeDB,
  findingId: string,
  to: ReviewStatus,
  opts: { reason?: string; reviewer?: string } = {},
): Promise<Finding> {
  return db.transaction('rw', db.findings, db.events, db.cases, async () => {
    const f = await db.findings.get(findingId);
    if (!f) throw new ReviewError('Finding not found.');
    validateTransition(f.reviewStatus, to, opts.reason);
    const updated: Finding = { ...f, reviewStatus: to, updatedAt: now() };
    await db.findings.put(updated);
    await logEvent(db, {
      caseId: f.caseId, findingId, kind: 'status_changed', actor: opts.reviewer?.trim() || DEMO_REVIEWER,
      fromStatus: f.reviewStatus, toStatus: to, reason: opts.reason?.trim() || undefined,
    });
    await touchCase(db, f.caseId);
    return updated;
  });
}

export async function addReviewerNote(db: CliniscopeDB, findingId: string, note: string, reviewer?: string): Promise<AuditEvent> {
  const text = note.trim();
  if (!text) throw new ReviewError('A note cannot be empty.');
  if (text.length > 4000) throw new ReviewError('Notes are limited to 4000 characters.');
  return db.transaction('rw', db.findings, db.events, db.cases, async () => {
    const f = await db.findings.get(findingId);
    if (!f) throw new ReviewError('Finding not found.');
    await db.findings.update(findingId, { updatedAt: now() });
    await touchCase(db, f.caseId);
    return logEvent(db, { caseId: f.caseId, findingId, kind: 'note_added', actor: reviewer?.trim() || DEMO_REVIEWER, note: text });
  });
}

// --------------------------------------------------------------------- demo
export interface DemoFile {
  file: string;
  title: string;
  documentType: DocumentType;
  documentDate: string;
  mime: string;
}

/** Deletes a case and everything that belongs to it (only that case). */
export async function deleteCase(db: CliniscopeDB, caseId: string): Promise<void> {
  await db.transaction('rw', [db.cases, db.documents, db.files, db.statements, db.findings, db.events], async () => {
    await db.documents.where('caseId').equals(caseId).delete();
    await db.files.where('caseId').equals(caseId).delete();
    await db.statements.where('caseId').equals(caseId).delete();
    await db.findings.where('caseId').equals(caseId).delete();
    await db.events.where('caseId').equals(caseId).delete();
    await db.cases.delete(caseId);
  });
}

/**
 * Creates the synthetic demo case and ingests the demo files through the
 * normal upload pipeline. Analysis is NOT run here — the reviewer starts it.
 * Only demo cases are removed on reset; user-created cases are untouched.
 */
export async function seedDemoCase(
  db: CliniscopeDB,
  extractor: Extractor,
  files: { meta: DemoFile; bytes: Uint8Array }[],
): Promise<CaseRecord> {
  const demos = await db.cases.filter((c) => c.isDemo).toArray();
  for (const d of demos) await deleteCase(db, d.id);
  const c = await createCase(db, DEMO_CASE_LABEL, { isDemo: true, actor: 'System' });
  for (const f of files) {
    await uploadDocument(db, extractor, c.id, { name: f.meta.file, mime: f.meta.mime, bytes: f.bytes }, {
      title: f.meta.title, documentType: f.meta.documentType, documentDate: f.meta.documentDate, isSeededDemo: true,
    }, { actor: 'System (demo seed)' });
  }
  return c;
}
