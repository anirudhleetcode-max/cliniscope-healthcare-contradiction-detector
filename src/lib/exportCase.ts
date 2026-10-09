// Local exports: JSON case report, CSV of findings, and a full case backup
// (including original files) that can be restored as a NEW case. Nothing here
// talks to a network; everything is built from the local IndexedDB data.
import { z } from 'zod';
import type { CliniscopeDB } from './db';
import { sha256Hex } from './extract';
import { uid } from './services';
import { APP_VERSION } from './version';
import type { AuditEvent, CaseRecord, ClinicalStatement, DocumentRecord, Finding } from './types';
import { CATEGORY_LABEL, FINDING_TYPE_LABEL, REVIEW_STATUS_LABEL } from './types';

export const SYNTHETIC_NOTICE = 'SYNTHETIC DEMONSTRATION DATA — NOT A REAL PATIENT RECORD';
const DISCLAIMER = 'Findings are candidate inconsistencies produced by rules (and, if marked, AI-assisted proposals). They require professional review and are not diagnostic conclusions.';

async function load(db: CliniscopeDB, caseId: string) {
  const c = await db.cases.get(caseId);
  if (!c) throw new Error('Case not found.');
  const [documents, statements, findings, events] = await Promise.all([
    db.documents.where('caseId').equals(caseId).toArray(),
    db.statements.where('caseId').equals(caseId).toArray(),
    db.findings.where('caseId').equals(caseId).toArray(),
    db.events.where('caseId').equals(caseId).sortBy('at'),
  ]);
  return { c, documents, statements, findings, events };
}

function classification(c: CaseRecord): string {
  return c.isDemo ? SYNTHETIC_NOTICE : 'User-provided records (prototype: use synthetic data only)';
}

/** Human-and-machine-readable report: metadata, findings with evidence, decisions, notes and history. No document text bodies. */
export async function buildCaseReport(db: CliniscopeDB, caseId: string) {
  const { c, documents, findings, events } = await load(db, caseId);
  const docTitle = new Map(documents.map((d) => [d.id, d.title]));
  return {
    format: 'cliniscope-case-report',
    formatVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    mode: c.remote ? { kind: 'shared-workspace-cache', server: c.remote.serverUrl, unsynced: !!c.remote.unsynced } : { kind: 'local-demo-mode', note: 'Data stored only in this browser (IndexedDB).' },
    dataClassification: classification(c),
    disclaimer: DISCLAIMER,
    case: { id: c.id, label: c.label, createdAt: c.createdAt, updatedAt: c.updatedAt, lastAnalyzedAt: c.lastAnalyzedAt },
    documents: documents.map((d) => ({
      id: d.id, title: d.title, originalFilename: d.originalFilename, documentType: d.documentType, documentDate: d.documentDate,
      uploadedAt: d.uploadedAt, fileKind: d.fileKind, sizeBytes: d.sizeBytes, status: d.status, extractionMethod: d.extractionMethod,
      pageCount: d.pageCount, statementCount: d.statementCount, sha256: d.contentHash, warnings: d.extractionWarnings, errors: d.extractionErrors,
    })),
    summary: {
      findings: findings.filter((f) => !f.stale).length,
      superseded: findings.filter((f) => f.stale).length,
      byStatus: Object.fromEntries(Object.keys(REVIEW_STATUS_LABEL).map((s) => [s, findings.filter((f) => !f.stale && f.reviewStatus === s).length])),
    },
    findings: findings.map((f) => {
      const hist = events.filter((e) => e.findingId === f.id);
      return {
        id: f.id, displayId: f.displayId, title: f.title, category: f.category, findingType: f.findingType, origin: f.origin ?? 'rules',
        detectionMethod: f.detectionMethod, evidenceQuality: f.evidenceQuality, reviewPriority: f.reviewPriority,
        reviewStatus: f.reviewStatus, superseded: f.stale, createdAt: f.createdAt, updatedAt: f.updatedAt,
        explanation: f.explanation, comparisonReason: f.comparisonReason, caveats: f.contextualCaveats, relevantDates: f.relevantDates,
        evidence: f.evidence.map((e) => ({
          side: e.side, documentId: e.documentId, documentTitle: docTitle.get(e.documentId) ?? `${e.documentTitle} (document removed)`,
          documentDate: e.documentDate, quote: e.quote, charStart: e.charStart, charEnd: e.charEnd, page: e.page, section: e.section,
          line: e.line, ocrDerived: !!e.ocrDerived,
        })),
        reviewerNotes: hist.filter((e) => e.kind === 'note_added').map((e) => ({ at: e.at, by: e.actor, note: e.note })),
        reviewHistory: hist.map((e) => ({ at: e.at, by: e.actor, event: e.kind, from: e.fromStatus ?? null, to: e.toStatus ?? null, reason: e.reason ?? null, note: e.note ?? null })),
      };
    }),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function buildFindingsCsv(db: CliniscopeDB, caseId: string): Promise<string> {
  const { c, documents, findings, events } = await load(db, caseId);
  const docTitle = new Map(documents.map((d) => [d.id, d.title]));
  const header = ['finding_id', 'title', 'category', 'finding_type', 'origin', 'review_status', 'superseded', 'evidence_quality', 'source_documents', 'source_A_quotes', 'source_B_quotes', 'relevant_dates', 'latest_decision_reason', 'reviewer_notes', 'created_at', 'updated_at'];
  const rows = findings.map((f) => {
    const hist = events.filter((e) => e.findingId === f.id);
    const lastDecision = [...hist].reverse().find((e) => e.kind === 'status_changed');
    const quotes = (side: 'A' | 'B') => f.evidence.filter((e) => e.side === side).map((e) => `${docTitle.get(e.documentId) ?? e.documentTitle}: "${e.quote}"`).join(' | ');
    return [
      f.displayId, f.title, CATEGORY_LABEL[f.category] ?? f.category, FINDING_TYPE_LABEL[f.findingType], f.origin ?? 'rules', REVIEW_STATUS_LABEL[f.reviewStatus], f.stale ? 'yes' : 'no', f.evidenceQuality,
      f.sourceDocumentIds.map((id) => docTitle.get(id) ?? `${id} (removed)`).join(' | '), quotes('A'), quotes('B'), f.relevantDates.join(' '),
      lastDecision?.reason ?? '', hist.filter((e) => e.kind === 'note_added').map((e) => `${e.actor}: ${e.note}`).join(' | '), f.createdAt, f.updatedAt,
    ].map(csvCell).join(',');
  });
  return [`# ${classification(c)}`, `# ${DISCLAIMER}`, header.join(','), ...rows].join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ backup
async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function buildBackup(db: CliniscopeDB, caseId: string) {
  const { c, documents, statements, findings, events } = await load(db, caseId);
  const files: { documentId: string; base64: string }[] = [];
  for (const d of documents) {
    const f = await db.files.get(d.id);
    if (f) files.push({ documentId: d.id, base64: await blobToBase64(f.blob) });
  }
  const { remote: _r, ...caseLocal } = c;
  return {
    format: 'cliniscope-backup', formatVersion: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    dataClassification: classification(c),
    case: caseLocal, documents, statements, findings, events, files,
  };
}

const BackupSchema = z.object({
  format: z.literal('cliniscope-backup'),
  formatVersion: z.literal(1),
  case: z.object({ id: z.string(), label: z.string().max(200), isDemo: z.boolean() }).passthrough(),
  documents: z.array(z.object({ id: z.string(), caseId: z.string(), title: z.string(), extractedText: z.string(), contentHash: z.string(), fileKind: z.enum(['pdf', 'txt', 'docx', 'image']) }).passthrough()).max(500),
  statements: z.array(z.object({ id: z.string(), documentId: z.string(), charStart: z.number(), charEnd: z.number(), originalText: z.string() }).passthrough()).max(50000),
  findings: z.array(z.object({ id: z.string(), fingerprint: z.string(), reviewStatus: z.enum(['unreviewed', 'in_review', 'confirmed', 'resolved', 'dismissed']), evidence: z.array(z.object({ documentId: z.string(), statementId: z.string(), charStart: z.number(), charEnd: z.number(), quote: z.string() }).passthrough()) }).passthrough()).max(5000),
  events: z.array(z.object({ id: z.string(), kind: z.string(), at: z.string(), actor: z.string() }).passthrough()).max(100000),
  files: z.array(z.object({ documentId: z.string(), base64: z.string() })).max(500),
});

export class BackupError extends Error {}

/**
 * Validates a backup and restores it as a NEW local case (fresh identifiers), so existing
 * data is never overwritten. Every statement and evidence quote is re-verified against the
 * document text, and every original file against its SHA-256 hash, before anything is written.
 */
export async function restoreBackup(db: CliniscopeDB, raw: unknown): Promise<CaseRecord> {
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) throw new BackupError('This file is not a valid CLINISCOPE backup (format or required fields do not match).');
  const b = parsed.data;
  const docs = b.documents as unknown as DocumentRecord[];
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const d of docs) if (d.caseId !== b.case.id) throw new BackupError('The backup mixes documents from different cases.');
  for (const s of b.statements) {
    const d = byId.get(s.documentId);
    if (!d || d.extractedText.slice(s.charStart, s.charEnd) !== s.originalText) throw new BackupError('A statement in the backup does not match its document text. The file may be corrupted or edited.');
  }
  for (const f of b.findings) for (const e of f.evidence) {
    const d = byId.get(e.documentId);
    // Evidence for documents that had been removed before the backup is kept only on superseded findings.
    if (d ? d.extractedText.slice(e.charStart, e.charEnd) !== e.quote : !(f as { stale?: boolean }).stale) {
      throw new BackupError('A finding in the backup cites evidence that does not match its source. The file may be corrupted or edited.');
    }
  }
  const fileBytes = new Map<string, Uint8Array>();
  for (const f of b.files) {
    const d = byId.get(f.documentId);
    if (!d) throw new BackupError('The backup contains a file for an unknown document.');
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(f.base64); } catch { throw new BackupError('An original file in the backup is not valid base64.'); }
    if ((await sha256Hex(bytes)) !== d.contentHash) throw new BackupError(`The original file of "${d.title}" does not match its recorded SHA-256 hash.`);
    fileBytes.set(d.id, bytes);
  }

  // Fresh identifiers for everything; references are remapped consistently.
  const caseId = uid('case');
  const docMap = new Map(docs.map((d) => [d.id, uid('doc')]));
  const stMap = new Map(b.statements.map((s) => [s.id, 'st_' + uid('r').slice(2)]));
  const fdMap = new Map(b.findings.map((f) => [f.id, uid('fd')]));
  const mapDoc = (id: string) => docMap.get(id) ?? id;
  const now = new Date().toISOString();
  const c: CaseRecord = {
    id: caseId, label: `${b.case.label} (restored ${now.slice(0, 10)})`.slice(0, 80), isDemo: b.case.isDemo,
    createdAt: (b.case as unknown as CaseRecord).createdAt ?? now, updatedAt: now, lastAnalyzedAt: (b.case as unknown as CaseRecord).lastAnalyzedAt ?? null,
  };
  const newDocs: DocumentRecord[] = docs.map((d) => ({ ...d, id: mapDoc(d.id), caseId }));
  const newStatements = (b.statements as unknown as ClinicalStatement[]).map((s) => ({ ...s, id: stMap.get(s.id)!, caseId, documentId: mapDoc(s.documentId) }));
  const newFindings = (b.findings as unknown as Finding[]).map((f) => ({
    ...f, id: fdMap.get(f.id)!, caseId,
    statementIds: f.statementIds.map((id) => stMap.get(id) ?? id),
    sourceDocumentIds: f.sourceDocumentIds.map(mapDoc),
    evidence: f.evidence.map((e) => ({ ...e, documentId: mapDoc(e.documentId), statementId: stMap.get(e.statementId) ?? e.statementId })),
  }));
  const newEvents: AuditEvent[] = (b.events as unknown as AuditEvent[]).map((e) => ({
    ...e, id: uid('ev'), caseId,
    ...(e.findingId ? { findingId: fdMap.get(e.findingId) ?? e.findingId } : {}),
    ...(e.documentId ? { documentId: mapDoc(e.documentId) } : {}),
  }));
  newEvents.push({ id: uid('ev'), caseId, kind: 'case_created', at: now, actor: 'Local restore', detail: `Restored from a CLINISCOPE backup exported ${String((raw as { exportedAt?: string }).exportedAt ?? 'unknown')} (${docs.length} documents, ${b.findings.length} findings, ${b.events.length} history events). Identifiers were reassigned.` });

  await db.transaction('rw', [db.cases, db.documents, db.files, db.statements, db.findings, db.events], async () => {
    await db.cases.add(c);
    await db.documents.bulkAdd(newDocs);
    for (const [oldId, bytes] of fileBytes) {
      const d = byId.get(oldId)!;
      await db.files.add({ id: mapDoc(oldId), caseId, blob: new Blob([bytes], { type: d.mimeType }) });
    }
    await db.statements.bulkAdd(newStatements);
    await db.findings.bulkAdd(newFindings);
    await db.events.bulkAdd(newEvents);
  });
  return c;
}

/** Triggers a browser download of text/JSON content. The object URL is revoked afterwards. */
export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function exportFilename(c: CaseRecord, kind: string, ext: string): string {
  const slug = c.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'case';
  return `cliniscope-${slug}-${kind}-${new Date().toISOString().slice(0, 10)}${c.isDemo ? '-SYNTHETIC' : ''}.${ext}`;
}
