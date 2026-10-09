// MEDGUARD shared-workspace API. Plain node:http, no framework.
// Authorization is enforced here, per request, from the case_members table.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { openDb, tx, type Db } from './db';
import { RateLimiter, createSession, hashPassword, newId, revokeSession, userForToken, verifyPassword, type User } from './auth';
import { AiProviderError, providerFromConfig, type AiProvider } from './aiProvider';
import type { ServerConfig } from './config';
import { validateTransition, ReviewError, isReviewStatus } from '../src/lib/review';
import { verifyAiOutput, AiOutputError } from '../src/lib/ai';
import type { AuditEvent, CaseRole, ClinicalStatement, DocumentRecord, Finding, ReviewStatus } from '../src/lib/types';

export const API_VERSION = '1.1.0';

class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}

const ID_RE = /^[a-z]+_[A-Za-z0-9]{6,40}$/;
const ROLE_RANK: Record<CaseRole, number> = { viewer: 1, reviewer: 2, owner: 3 };

export interface AppDeps { config: ServerConfig; db?: Db; ai?: AiProvider | null; log?: (line: string) => void }

export function createApp(deps: AppDeps): { server: Server; db: Db; close: () => void } {
  const cfg = deps.config;
  const db = deps.db ?? openDb(join(cfg.dataDir, 'medguard.db'));
  const ai = deps.ai === undefined ? providerFromConfig(cfg) : deps.ai;
  const filesDir = resolve(cfg.dataDir, 'files');
  mkdirSync(filesDir, { recursive: true });
  const log = deps.log ?? ((l: string) => console.log(l));
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const aiLimiter = new RateLimiter(10, 10 * 60_000);

  // ------------------------------------------------------------ helpers
  const now = () => new Date().toISOString();
  function audit(e: { caseId: string; actor: User | null; actorName?: string; kind: string; findingId?: string; documentId?: string; from?: string; to?: string; reason?: string; note?: string; detail?: string; entityType?: string; entityId?: string }) {
    db.prepare(`INSERT INTO audit_events (id, case_id, actor_id, actor_name, kind, entity_type, entity_id, finding_id, document_id, from_status, to_status, reason, note, detail)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      newId('ev'), e.caseId, e.actor?.id ?? null, e.actorName ?? (e.actor ? `${e.actor.displayName} <${e.actor.email}>` : 'System'), e.kind,
      e.entityType ?? (e.findingId ? 'finding' : e.documentId ? 'document' : 'case'), e.entityId ?? e.findingId ?? e.documentId ?? e.caseId,
      e.findingId ?? null, e.documentId ?? null, e.from ?? null, e.to ?? null, e.reason ?? null, e.note ?? null, e.detail ?? null,
    );
  }
  function roleFor(user: User, caseId: string): CaseRole | null {
    const r = db.prepare('SELECT role FROM case_members WHERE case_id = ? AND user_id = ?').get(caseId, user.id) as { role: CaseRole } | undefined;
    return r?.role ?? null;
  }
  function requireRole(user: User, caseId: string, min: CaseRole): CaseRole {
    if (!ID_RE.test(caseId)) throw new HttpError(404, 'Case not found.');
    const role = roleFor(user, caseId);
    // Same response for "does not exist" and "not a member", so case IDs cannot be probed.
    if (!role) throw new HttpError(404, 'Case not found or you do not have access.', 'not_found');
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new HttpError(403, `This action requires the ${min} role; you are a ${role}.`, 'forbidden');
    return role;
  }
  function touch(caseId: string, analyzed = false) {
    db.prepare(`UPDATE cases SET updated_at = ?${analyzed ? ', last_analyzed_at = ?' : ''} WHERE id = ?`).run(...(analyzed ? [now(), now(), caseId] : [now(), caseId]));
  }

  function snapshot(caseId: string, user: User) {
    const c = db.prepare('SELECT c.*, u.display_name AS owner_name, u.email AS owner_email FROM cases c JOIN users u ON u.id = c.owner_id WHERE c.id = ?').get(caseId) as Record<string, string>;
    const members = (db.prepare('SELECT m.user_id, m.role, u.email, u.display_name FROM case_members m JOIN users u ON u.id = m.user_id WHERE m.case_id = ? ORDER BY m.created_at').all(caseId) as Record<string, string>[])
      .map((m) => ({ userId: m.user_id, email: m.email, displayName: m.display_name, role: m.role }));
    const documents = (db.prepare('SELECT data_json, file_path FROM documents WHERE case_id = ?').all(caseId) as { data_json: string; file_path: string | null }[])
      .map((d) => ({ ...(JSON.parse(d.data_json) as DocumentRecord), hasServerFile: !!d.file_path }));
    const statements = (db.prepare('SELECT data_json FROM statements WHERE case_id = ?').all(caseId) as { data_json: string }[]).map((s) => JSON.parse(s.data_json) as ClinicalStatement);
    const findings = (db.prepare('SELECT id, review_status, stale, data_json, created_at, updated_at FROM findings WHERE case_id = ?').all(caseId) as Record<string, string | number>[])
      .map((f) => ({ ...(JSON.parse(f.data_json as string) as Finding), id: f.id as string, reviewStatus: f.review_status as ReviewStatus, stale: !!f.stale, createdAt: f.created_at as string, updatedAt: f.updated_at as string }));
    const events: AuditEvent[] = (db.prepare('SELECT * FROM audit_events WHERE case_id = ? ORDER BY seq').all(caseId) as Record<string, string | null>[]).map((e) => ({
      id: e.id!, caseId, kind: e.kind as AuditEvent['kind'], at: e.at!, actor: e.actor_name!,
      ...(e.finding_id ? { findingId: e.finding_id } : {}), ...(e.document_id ? { documentId: e.document_id } : {}),
      ...(e.from_status ? { fromStatus: e.from_status as ReviewStatus } : {}), ...(e.to_status ? { toStatus: e.to_status as ReviewStatus } : {}),
      ...(e.reason ? { reason: e.reason } : {}), ...(e.note ? { note: e.note } : {}), ...(e.detail ? { detail: e.detail } : {}),
    }));
    return {
      case: { id: c.id, label: c.label, createdAt: c.created_at, updatedAt: c.updated_at, lastAnalyzedAt: c.last_analyzed_at, owner: `${c.owner_name} <${c.owner_email}>` },
      role: roleFor(user, caseId), members, documents, statements, findings, events, serverTime: now(),
    };
  }

  // ------------------------------------------------------------ schemas
  const Creds = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(10).max(200) });
  const Register = Creds.extend({ displayName: z.string().trim().min(1).max(80) });
  const NewCase = z.object({ id: z.string().regex(/^case_[A-Za-z0-9]{6,40}$/).optional(), label: z.string().trim().min(1).max(80) });
  const Member = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['reviewer', 'viewer']) });
  const Transition = z.object({ to: z.string(), reason: z.string().max(2000).optional(), expectedStatus: z.string().optional() });
  const Note = z.object({ note: z.string().trim().min(1).max(4000) });
  const Snapshot = z.object({
    documents: z.array(z.record(z.string(), z.unknown())).max(200),
    statements: z.array(z.record(z.string(), z.unknown())).max(20000),
    findings: z.array(z.record(z.string(), z.unknown())).max(2000),
    /** Documents to delete. Absence from `documents` never deletes anything (snapshots merge, they do not replace). */
    removedDocumentIds: z.array(z.string().max(60)).max(200).optional(),
    analyzed: z.boolean().optional(),
    detail: z.string().max(2000).optional(),
  });
  const MIME_BY_KIND: Record<string, string> = {
    pdf: 'application/pdf', txt: 'text/plain', image: 'image/png',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  const AiDoc = z.object({
    id: z.string().max(60), caseId: z.string().max(60), title: z.string().max(200), documentType: z.string().max(60),
    documentDate: z.string().max(20).nullable(), extractedText: z.string().max(400_000),
    pageSpans: z.array(z.object({ page: z.number(), start: z.number(), end: z.number() }).passthrough()).max(2000),
    fileKind: z.enum(['pdf', 'txt', 'docx', 'image']), extractionMethod: z.string().nullable(),
    ocrRegions: z.array(z.object({ start: z.number(), end: z.number(), confidence: z.number().nullable() })).max(2000).optional(),
    ocrLowConfidence: z.array(z.object({ start: z.number(), end: z.number(), confidence: z.number(), text: z.string() })).max(20000).optional(),
  });
  const AiRequest = z.object({ caseId: z.string().max(60), documents: z.array(AiDoc).min(1).max(15), existing: z.array(z.object({ title: z.string().max(300), type: z.string().max(60) })).max(200) });

  // ------------------------------------------------------------ routes
  type Ctx = { req: IncomingMessage; res: ServerResponse; params: string[]; user: User | null; token: string | null; body: () => Promise<unknown>; raw: () => Promise<Buffer> };
  type Handler = (c: Ctx) => Promise<unknown> | unknown;
  const routes: { method: string; re: RegExp; auth: boolean; h: Handler }[] = [];
  const route = (method: string, path: string, auth: boolean, h: Handler) => routes.push({ method, re: new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`), auth, h });

  route('GET', '/api/health', false, () => ({
    ok: true, service: 'medguard-api', version: API_VERSION, time: now(),
    ai: { configured: !!ai, provider: ai?.name ?? null, model: ai?.model ?? null },
    registration: cfg.allowRegistration,
  }));

  route('POST', '/api/auth/register', false, async (c) => {
    if (!cfg.allowRegistration) throw new HttpError(403, 'Self-registration is disabled on this server. Ask an administrator for an account.');
    const b = Register.parse(await c.body());
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw new HttpError(409, 'An account with this email already exists.');
    const id = newId('usr');
    db.prepare('INSERT INTO users (id, email, display_name, password_hash) VALUES (?,?,?,?)').run(id, b.email, b.displayName, await hashPassword(b.password));
    const s = createSession(db, id, cfg.sessionTtlHours);
    return { token: s.token, expiresAt: s.expiresAt, user: { id, email: b.email, displayName: b.displayName } };
  });

  route('POST', '/api/auth/login', false, async (c) => {
    const b = Creds.safeParse(await c.body());
    if (!b.success) throw new HttpError(400, 'Enter a valid email and password.');
    if (!loginLimiter.take(`${b.data.email}|${c.req.socket.remoteAddress}`)) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    const u = db.prepare('SELECT id, email, display_name, password_hash FROM users WHERE email = ?').get(b.data.email) as Record<string, string> | undefined;
    const ok = u ? await verifyPassword(b.data.password, u.password_hash) : (await hashPassword(b.data.password), false);
    if (!u || !ok) throw new HttpError(401, 'Incorrect email or password.', 'invalid_credentials');
    const s = createSession(db, u.id, cfg.sessionTtlHours);
    return { token: s.token, expiresAt: s.expiresAt, user: { id: u.id, email: u.email, displayName: u.display_name } };
  });

  route('POST', '/api/auth/logout', true, (c) => { revokeSession(db, c.token!); return { ok: true }; });
  route('GET', '/api/auth/me', true, (c) => ({ user: c.user }));

  route('GET', '/api/cases', true, (c) => ({
    cases: (db.prepare(`SELECT c.id, c.label, c.updated_at, c.last_analyzed_at, m.role, u.display_name AS owner_name, u.email AS owner_email,
        (SELECT COUNT(*) FROM documents d WHERE d.case_id = c.id) AS documents,
        (SELECT COUNT(*) FROM findings f WHERE f.case_id = c.id AND f.stale = 0) AS findings
      FROM case_members m JOIN cases c ON c.id = m.case_id JOIN users u ON u.id = c.owner_id WHERE m.user_id = ? ORDER BY c.updated_at DESC`).all(c.user!.id) as Record<string, unknown>[])
      .map((r) => ({ id: r.id, label: r.label, updatedAt: r.updated_at, lastAnalyzedAt: r.last_analyzed_at, role: r.role, owner: `${r.owner_name} <${r.owner_email}>`, documents: r.documents, findings: r.findings })),
  }));

  route('POST', '/api/cases', true, async (c) => {
    const b = NewCase.parse(await c.body());
    const id = b.id ?? newId('case');
    if (db.prepare('SELECT 1 FROM cases WHERE id = ?').get(id)) throw new HttpError(409, 'A case with this identifier already exists.');
    tx(db, () => {
      db.prepare('INSERT INTO cases (id, label, owner_id) VALUES (?,?,?)').run(id, b.label, c.user!.id);
      db.prepare("INSERT INTO case_members (case_id, user_id, role, added_by) VALUES (?,?, 'owner', ?)").run(id, c.user!.id, c.user!.id);
      audit({ caseId: id, actor: c.user, kind: 'case_shared', detail: `Shared case "${b.label}" created` });
    });
    return snapshot(id, c.user!);
  });

  route('GET', '/api/cases/([^/]+)', true, (c) => { requireRole(c.user!, c.params[0], 'viewer'); return snapshot(c.params[0], c.user!); });

  route('POST', '/api/cases/([^/]+)/members', true, async (c) => {
    const caseId = c.params[0];
    requireRole(c.user!, caseId, 'owner');
    const b = Member.parse(await c.body());
    const u = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(b.email) as { id: string; display_name: string } | undefined;
    if (!u) throw new HttpError(404, 'No registered user has that email. They must create an account first.');
    if (u.id === c.user!.id) throw new HttpError(400, 'You already own this case.');
    tx(db, () => {
      db.prepare('INSERT INTO case_members (case_id, user_id, role, added_by) VALUES (?,?,?,?) ON CONFLICT(case_id, user_id) DO UPDATE SET role = excluded.role').run(caseId, u.id, b.role, c.user!.id);
      audit({ caseId, actor: c.user, kind: 'member_added', entityType: 'user', entityId: u.id, detail: `${u.display_name} <${b.email}> added as ${b.role}` });
      touch(caseId);
    });
    return snapshot(caseId, c.user!);
  });

  route('DELETE', '/api/cases/([^/]+)/members/([^/]+)', true, (c) => {
    const [caseId, userId] = c.params;
    requireRole(c.user!, caseId, 'owner');
    const m = db.prepare("SELECT m.role, u.email FROM case_members m JOIN users u ON u.id = m.user_id WHERE case_id = ? AND user_id = ?").get(caseId, userId) as { role: string; email: string } | undefined;
    if (!m) throw new HttpError(404, 'Member not found.');
    if (m.role === 'owner') throw new HttpError(400, 'The owner cannot be removed.');
    tx(db, () => {
      db.prepare('DELETE FROM case_members WHERE case_id = ? AND user_id = ?').run(caseId, userId);
      audit({ caseId, actor: c.user, kind: 'member_removed', entityType: 'user', entityId: userId, detail: `${m.email} removed` });
    });
    return snapshot(caseId, c.user!);
  });

  // Full-state synchronization of extracted documents, statements and analysis results.
  // Review status is NEVER taken from the client here; it changes only through /transition.
  route('PUT', '/api/cases/([^/]+)/snapshot', true, async (c) => {
    const caseId = c.params[0];
    requireRole(c.user!, caseId, 'reviewer');
    const b = Snapshot.parse(await c.body());
    const docs = b.documents as unknown as DocumentRecord[];
    const docMap = new Map<string, DocumentRecord>();
    for (const d of docs) {
      if (!ID_RE.test(String(d.id)) || d.caseId !== caseId || typeof d.extractedText !== 'string' || typeof d.title !== 'string') throw new HttpError(422, 'A document in the snapshot is invalid or belongs to another case.');
      if (!(String(d.fileKind) in MIME_BY_KIND)) throw new HttpError(422, 'A document has an unsupported file kind.');
      if (d.extractedText.length > 2_000_000) throw new HttpError(413, 'A document text is too large.');
      docMap.set(d.id, d);
    }
    const removed = new Set((b.removedDocumentIds ?? []).filter((id) => ID_RE.test(id) && !docMap.has(id)));
    // Documents already on the server (and not being removed) remain valid evidence sources.
    const storedDoc = (id: string): DocumentRecord | undefined => {
      if (docMap.has(id)) return docMap.get(id);
      if (removed.has(id)) return undefined;
      const r = db.prepare('SELECT data_json FROM documents WHERE id = ? AND case_id = ?').get(id, caseId) as { data_json: string } | undefined;
      return r ? (JSON.parse(r.data_json) as DocumentRecord) : undefined;
    };
    const statements = b.statements as unknown as ClinicalStatement[];
    for (const s of statements) {
      const d = docMap.get(s.documentId);
      if (!d || s.caseId !== caseId || d.extractedText.slice(s.charStart, s.charEnd) !== s.originalText) throw new HttpError(422, 'A statement does not match its source document text.');
    }
    const findings = b.findings as unknown as Finding[];
    for (const f of findings) {
      if (f.caseId !== caseId || typeof f.fingerprint !== 'string' || !Array.isArray(f.evidence) || !f.evidence.length) throw new HttpError(422, 'A finding in the snapshot is invalid.');
      const prior = db.prepare('SELECT data_json FROM findings WHERE case_id = ? AND fingerprint = ?').get(caseId, f.fingerprint) as { data_json: string } | undefined;
      const priorEvidence = prior ? (JSON.parse(prior.data_json) as Finding).evidence : [];
      for (const e of f.evidence) {
        const d = storedDoc(e.documentId);
        if (d) {
          if (d.extractedText.slice(e.charStart, e.charEnd) !== e.quote) throw new HttpError(422, `Evidence for "${String(f.title).slice(0, 80)}" does not match the source text.`);
        } else {
          // Source document no longer exists: only the evidence already recorded on the server may be kept, unchanged.
          const same = priorEvidence.some((p) => p.documentId === e.documentId && p.charStart === e.charStart && p.charEnd === e.charEnd && p.quote === e.quote);
          if (!same) throw new HttpError(422, 'A finding cites a document that is not in the case.');
        }
      }
    }
    const counts = { added: 0, removed: 0, created: 0, superseded: 0 };
    tx(db, () => {
      const existingDocs = new Set((db.prepare('SELECT id FROM documents WHERE case_id = ?').all(caseId) as { id: string }[]).map((r) => r.id));
      for (const d of docs) {
        if (!existingDocs.has(d.id) && db.prepare('SELECT 1 FROM documents WHERE id = ?').get(d.id)) throw new HttpError(409, 'Document identifier conflict.');
        // The MIME type is derived from the validated file kind, never trusted from the client.
        const clean: DocumentRecord = { ...d, caseId, mimeType: MIME_BY_KIND[d.fileKind] };
        db.prepare(`INSERT INTO documents (id, case_id, data_json, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`).run(d.id, caseId, JSON.stringify(clean), now());
        if (!existingDocs.has(d.id)) { counts.added++; audit({ caseId, actor: c.user, kind: 'document_uploaded', documentId: d.id, detail: `${d.title} added to the shared case (${String(d.fileKind).toUpperCase()}, ${d.extractionMethod ?? 'no text'})` }); }
      }
      for (const id of removed) {
        if (!existingDocs.has(id)) continue;
        const row = db.prepare('SELECT data_json, file_path FROM documents WHERE id = ?').get(id) as { data_json: string; file_path: string | null };
        db.prepare('DELETE FROM documents WHERE id = ?').run(id);
        db.prepare('DELETE FROM statements WHERE document_id = ? AND case_id = ?').run(id, caseId);
        if (row.file_path) rmSync(join(filesDir, row.file_path), { force: true });
        counts.removed++;
        audit({ caseId, actor: c.user, kind: 'document_deleted', documentId: id, detail: `${JSON.parse(row.data_json).title} removed from the shared case` });
      }
      // Statements are replaced only for the documents included in this snapshot.
      const delS = db.prepare('DELETE FROM statements WHERE document_id = ? AND case_id = ?');
      for (const d of docs) delS.run(d.id, caseId);
      const insS = db.prepare('INSERT OR REPLACE INTO statements (id, case_id, document_id, data_json) VALUES (?,?,?,?)');
      for (const s of statements) insS.run(s.id, caseId, s.documentId, JSON.stringify(s));
      for (const f of findings) {
        const prior = db.prepare('SELECT id, stale FROM findings WHERE case_id = ? AND fingerprint = ?').get(caseId, f.fingerprint) as { id: string; stale: number } | undefined;
        const data = { ...f, caseId, reviewStatus: undefined, stale: undefined };
        if (prior) {
          db.prepare('UPDATE findings SET data_json = ?, stale = ?, updated_at = CASE WHEN stale != ? THEN ? ELSE updated_at END WHERE id = ?').run(JSON.stringify({ ...data, id: prior.id }), f.stale ? 1 : 0, f.stale ? 1 : 0, now(), prior.id);
          if (f.stale && !prior.stale) {
            counts.superseded++;
            audit({ caseId, actor: null, kind: 'finding_superseded', findingId: prior.id, detail: `${f.displayId} is no longer produced by the current documents; its evidence and review history are preserved.` });
          }
        } else {
          const id = ID_RE.test(String(f.id)) && !db.prepare('SELECT 1 FROM findings WHERE id = ?').get(f.id) ? f.id : newId('fd');
          db.prepare("INSERT INTO findings (id, case_id, fingerprint, review_status, stale, data_json) VALUES (?,?,?, 'unreviewed', ?, ?)").run(id, caseId, f.fingerprint, f.stale ? 1 : 0, JSON.stringify({ ...data, id }));
          counts.created++;
          audit({ caseId, actor: c.user, actorName: f.origin === 'ai' ? `AI-assisted analysis (${f.aiModel ?? 'model'}) via ${c.user!.displayName}` : 'System (rules engine)', kind: 'finding_created', findingId: id, detail: `${f.displayId}: ${f.title}` });
        }
      }
      audit({ caseId, actor: c.user, kind: b.analyzed ? 'analysis_completed' : 'case_synced', detail: b.detail ?? `Synchronized ${docs.length} document(s), ${statements.length} statement(s), ${findings.length} finding(s): ${counts.created} new, ${counts.superseded} superseded` });
      touch(caseId, !!b.analyzed);
    });
    return snapshot(caseId, c.user!);
  });

  route('PUT', '/api/cases/([^/]+)/documents/([^/]+)/file', true, async (c) => {
    const [caseId, docId] = c.params;
    requireRole(c.user!, caseId, 'reviewer');
    if (!ID_RE.test(docId) || !db.prepare('SELECT 1 FROM documents WHERE id = ? AND case_id = ?').get(docId, caseId)) throw new HttpError(404, 'Document not found in this case. Synchronize the case first.');
    const buf = await c.raw();
    if (!buf.length) throw new HttpError(400, 'Empty file.');
    const rel = join(caseId, docId); // both validated against ID_RE: no traversal possible
    mkdirSync(join(filesDir, caseId), { recursive: true });
    writeFileSync(join(filesDir, rel), buf, { mode: 0o600 });
    db.prepare('UPDATE documents SET file_path = ?, file_size = ? WHERE id = ?').run(rel, buf.length, docId);
    return { ok: true, size: buf.length };
  });

  route('GET', '/api/cases/([^/]+)/documents/([^/]+)/file', true, (c) => {
    const [caseId, docId] = c.params;
    requireRole(c.user!, caseId, 'viewer');
    const row = ID_RE.test(docId) ? db.prepare('SELECT file_path, data_json FROM documents WHERE id = ? AND case_id = ?').get(docId, caseId) as { file_path: string | null; data_json: string } | undefined : undefined;
    if (!row?.file_path || !existsSync(join(filesDir, row.file_path))) throw new HttpError(404, 'The original file is not stored on the server.');
    const d = JSON.parse(row.data_json) as DocumentRecord;
    c.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Content-Mime': d.mimeType, 'Content-Disposition': 'attachment', 'Cache-Control': 'no-store' });
    c.res.end(readFileSync(join(filesDir, row.file_path)));
    return SENT;
  });

  route('POST', '/api/findings/([^/]+)/transition', true, async (c) => {
    const id = c.params[0];
    const f = ID_RE.test(id) ? db.prepare('SELECT case_id, review_status, data_json FROM findings WHERE id = ?').get(id) as { case_id: string; review_status: ReviewStatus; data_json: string } | undefined : undefined;
    if (!f) throw new HttpError(404, 'Finding not found.');
    requireRole(c.user!, f.case_id, 'reviewer');
    const b = Transition.parse(await c.body());
    if (b.expectedStatus && isReviewStatus(b.expectedStatus) && b.expectedStatus !== f.review_status) {
      throw new HttpError(409, `Another reviewer changed this finding to "${f.review_status}" in the meantime. Reload to see the latest state.`, 'conflict');
    }
    try { validateTransition(f.review_status, b.to, b.reason); } catch (e) { if (e instanceof ReviewError) throw new HttpError(422, e.message, 'invalid_transition'); throw e; }
    tx(db, () => {
      const r = db.prepare('UPDATE findings SET review_status = ?, updated_at = ? WHERE id = ? AND review_status = ?').run(b.to, now(), id, f.review_status);
      if (r.changes !== 1) throw new HttpError(409, 'The finding changed concurrently. Reload and try again.', 'conflict');
      audit({ caseId: f.case_id, actor: c.user, kind: 'status_changed', findingId: id, from: f.review_status, to: b.to, reason: b.reason?.trim() || undefined });
      touch(f.case_id);
    });
    return snapshot(f.case_id, c.user!);
  });

  route('POST', '/api/findings/([^/]+)/notes', true, async (c) => {
    const id = c.params[0];
    const f = ID_RE.test(id) ? db.prepare('SELECT case_id FROM findings WHERE id = ?').get(id) as { case_id: string } | undefined : undefined;
    if (!f) throw new HttpError(404, 'Finding not found.');
    requireRole(c.user!, f.case_id, 'reviewer');
    const b = Note.parse(await c.body());
    tx(db, () => { audit({ caseId: f.case_id, actor: c.user, kind: 'note_added', findingId: id, note: b.note }); touch(f.case_id); });
    return snapshot(f.case_id, c.user!);
  });

  route('POST', '/api/ai/analyze', true, async (c) => {
    if (!ai) throw new HttpError(503, 'AI-assisted analysis is not configured on this server (no provider API key). The deterministic analysis is unaffected.', 'not_configured');
    if (!aiLimiter.take(c.user!.id)) throw new HttpError(429, 'AI analysis limit reached (10 requests per 10 minutes). Try again later.', 'rate_limited');
    const b = AiRequest.parse(await c.body());
    if (b.documents.reduce((n, d) => n + d.extractedText.length, 0) > 600_000) throw new HttpError(413, 'The case text is too large for one AI request.');
    if (b.documents.some((d) => d.caseId !== b.caseId)) throw new HttpError(422, 'All documents must belong to the same case.');
    // Analysis uses only the text supplied by the caller and persists nothing, so no case lookup is needed
    // (a lookup here would let any user probe which case IDs exist).
    const started = Date.now();
    let raw: unknown;
    try {
      raw = await ai.analyze(b.documents.map((d) => ({ id: d.id, title: d.title, documentType: d.documentType, documentDate: d.documentDate, text: d.extractedText })), b.existing);
    } catch (e) {
      if (e instanceof AiProviderError) throw new HttpError(e.httpStatus, e.message, e.code);
      throw new HttpError(503, 'AI analysis failed unexpectedly.', 'unavailable');
    }
    let verification;
    try {
      verification = verifyAiOutput(b.caseId, raw, b.documents as unknown as DocumentRecord[], ai.model);
    } catch (e) {
      if (e instanceof AiOutputError) throw new HttpError(502, e.message, 'malformed_output');
      throw e;
    }
    log(`ai analyze user=${c.user!.id} docs=${b.documents.length} accepted=${verification.accepted.length} rejected=${verification.rejected.length} ms=${Date.now() - started}`);
    return { provider: ai.name, model: ai.model, raw, summary: { accepted: verification.accepted.length, rejected: verification.rejected, consistent: verification.consistent, downgraded: verification.downgraded } };
  });

  // ------------------------------------------------------------ plumbing
  const SENT = Symbol('sent');

  function cors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = (req.headers.origin ?? '').replace(/\/$/, '');
    if (origin && cfg.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'X-Content-Mime');
      res.setHeader('Access-Control-Max-Age', '600');
      return true;
    }
    return !origin; // non-browser clients (no Origin) are allowed; browsers from other origins are not
  }

  function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolveP, reject) => {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > limit) { reject(new HttpError(413, 'Request body too large.')); req.resume(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (ch: Buffer) => {
        size += ch.length;
        if (size > limit) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); return; }
        chunks.push(ch);
      });
      req.on('end', () => resolveP(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  const server = createServer(async (req, res) => {
    const started = Date.now();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const allowed = cors(req, res);
    const send = (status: number, body: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      if (!allowed) throw new HttpError(403, 'Origin not allowed.', 'cors');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'Not found.');
      const params = (r.re.exec(url.pathname) ?? []).slice(1).map(decodeURIComponent);
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      const user = userForToken(db, token);
      if (r.auth && !user) throw new HttpError(401, token ? 'Your session has expired. Sign in again.' : 'Sign in to use the shared workspace.', 'unauthenticated');
      const ctx: Ctx = {
        req, res, params, user, token,
        body: async () => {
          const buf = await readBody(req, cfg.maxJsonBytes);
          try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Malformed JSON body.'); }
        },
        raw: () => readBody(req, cfg.maxUploadBytes),
      };
      const out = await r.h(ctx);
      if (out !== SENT) send(200, out);
    } catch (e) {
      if (e instanceof HttpError) send(e.status, { error: e.message, code: e.code });
      else if (e instanceof z.ZodError) send(400, { error: 'Invalid request: ' + e.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; '), code: 'validation' });
      else { log(`error ${req.method} ${url.pathname}: ${(e as Error)?.name ?? 'unknown'}`); send(500, { error: 'Internal server error.', code: 'internal' }); }
    } finally {
      log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  return { server, db, close: () => { server.close(); db.close(); } };
}
