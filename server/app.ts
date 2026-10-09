// MEDGUARD shared-workspace API. Plain node:http, no framework.
// Authorization is enforced here, per request, from the case_members table.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { z } from 'zod';
import { openDb, schemaVersion, SCHEMA_VERSION, DbConflictError, DbUnavailableError, type Db, type Queryable } from './db';
import { OPENAPI } from './openapi';
import { RateLimiter, createSession, hashPassword, newId, revokeSession, userForToken, verifyPassword, type User } from './auth';
import { AiProviderError, providerFromConfig, type AiProvider } from './aiProvider';
import type { ServerConfig } from './config';
import { validateTransition, ReviewError, isReviewStatus } from '../src/lib/review';
import { verifyAiOutput, AiOutputError } from '../src/lib/ai';
import type { AuditEvent, CaseRole, ClinicalStatement, DocumentRecord, Finding, ReviewStatus } from '../src/lib/types';

export const API_VERSION = '1.3.0';

class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}

const ID_RE = /^[a-z]+_[A-Za-z0-9]{6,40}$/;

/** Parses an integer query parameter; out-of-range or malformed values are a 400, never silently clamped. */
function intParam(q: URLSearchParams, name: string, dflt: number, min: number, max: number): number {
  const raw = q.get(name);
  if (raw === null || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Query parameter "${name}" must be an integer between ${min} and ${max}.`, 'validation');
  return n;
}
const ROLE_RANK: Record<CaseRole, number> = { viewer: 1, reviewer: 2, owner: 3 };

export interface AppDeps { config: ServerConfig; db?: Db; ai?: AiProvider | null; log?: (line: string) => void }

/**
 * Opens the database the configuration asks for: the external PostgreSQL server in DATABASE_URL, or the
 * embedded one in MEDGUARD_DATA_DIR/pgdata. With MEDGUARD_REQUIRE_DATABASE_URL=true (hosts whose disk is
 * wiped on restart) a missing DATABASE_URL is a start-up error, never a silent fallback to a disk that loses data.
 */
export async function openConfiguredDb(cfg: ServerConfig): Promise<Db> {
  if (!cfg.databaseUrl && cfg.requireDatabaseUrl) {
    throw new Error('MEDGUARD_REQUIRE_DATABASE_URL is true but DATABASE_URL is not set. Refusing to keep data on an ephemeral disk.');
  }
  return openDb(cfg.databaseUrl ? { url: cfg.databaseUrl } : { dir: join(cfg.dataDir, 'pgdata') });
}

export async function createApp(deps: AppDeps): Promise<{ server: Server; db: Db; routes: string[]; close: () => Promise<void> }> {
  const cfg = deps.config;
  const db = deps.db ?? await openConfiguredDb(cfg);
  const ai = deps.ai === undefined ? providerFromConfig(cfg) : deps.ai;
  const log = deps.log ?? ((l: string) => console.log(l));
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const aiLimiter = new RateLimiter(10, 10 * 60_000);

  // ------------------------------------------------------------ helpers
  const now = () => new Date().toISOString();
  async function audit(q: Queryable, e: { caseId: string; actor: User | null; actorName?: string; kind: string; findingId?: string; documentId?: string; from?: string; to?: string; reason?: string; note?: string; detail?: string; entityType?: string; entityId?: string }) {
    await q.run(`INSERT INTO audit_events (id, case_id, actor_id, actor_name, kind, entity_type, entity_id, finding_id, document_id, from_status, to_status, reason, note, detail)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      newId('ev'), e.caseId, e.actor?.id ?? null, e.actorName ?? (e.actor ? `${e.actor.displayName} <${e.actor.email}>` : 'System'), e.kind,
      e.entityType ?? (e.findingId ? 'finding' : e.documentId ? 'document' : 'case'), e.entityId ?? e.findingId ?? e.documentId ?? e.caseId,
      e.findingId ?? null, e.documentId ?? null, e.from ?? null, e.to ?? null, e.reason ?? null, e.note ?? null, e.detail ?? null,
    ]);
  }
  async function roleFor(user: User, caseId: string): Promise<CaseRole | null> {
    const r = await db.get<{ role: CaseRole }>('SELECT role FROM case_members WHERE case_id = ? AND user_id = ?', [caseId, user.id]);
    return r?.role ?? null;
  }
  async function requireRole(user: User, caseId: string, min: CaseRole, opts: { allowArchived?: boolean } = {}): Promise<CaseRole> {
    if (!ID_RE.test(caseId)) throw new HttpError(404, 'Case not found.');
    const role = await roleFor(user, caseId);
    // Same response for "does not exist" and "not a member", so case IDs cannot be probed.
    if (!role) throw new HttpError(404, 'Case not found or you do not have access.', 'not_found');
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new HttpError(403, `This action requires the ${min} role; you are a ${role}.`, 'forbidden');
    // Archived cases are read-only; only the owner's archive/restore request may change them.
    if (min !== 'viewer' && !opts.allowArchived) {
      const a = await db.get<{ archived_at: string | null }>('SELECT archived_at FROM cases WHERE id = ?', [caseId]);
      if (a?.archived_at) throw new HttpError(409, 'This case is archived and read-only. The owner can restore it.', 'archived');
    }
    return role;
  }
  async function touch(q: Queryable, caseId: string, analyzed = false) {
    await q.run(`UPDATE cases SET updated_at = ?${analyzed ? ', last_analyzed_at = ?' : ''} WHERE id = ?`, analyzed ? [now(), now(), caseId] : [now(), caseId]);
  }
  /** Serialises writers of one case for the rest of the transaction (other cases are unaffected). */
  async function lockCase(q: Queryable, caseId: string) {
    await q.get('SELECT id FROM cases WHERE id = ? FOR UPDATE', [caseId]);
  }

  async function snapshot(caseId: string, user: User) {
    // Independent reads, issued together: with a remote database each one costs a network round trip.
    const [cRow, memberRows, docRows, stmtRows, findingRows, eventRows, role] = await Promise.all([
      db.get<Record<string, string>>('SELECT c.*, u.display_name AS owner_name, u.email AS owner_email FROM cases c JOIN users u ON u.id = c.owner_id WHERE c.id = ?', [caseId]),
      db.all<Record<string, string>>('SELECT m.user_id, m.role, u.email, u.display_name FROM case_members m JOIN users u ON u.id = m.user_id WHERE m.case_id = ? ORDER BY m.created_at, m.user_id', [caseId]),
      db.all<{ data_json: string; file_size: number | null }>('SELECT d.data_json, f.size AS file_size FROM documents d LEFT JOIN document_files f ON f.document_id = d.id WHERE d.case_id = ? ORDER BY d.id', [caseId]),
      db.all<{ data_json: string }>('SELECT data_json FROM statements WHERE case_id = ? ORDER BY document_id, id', [caseId]),
      db.all<Record<string, string | number>>('SELECT id, review_status, stale, data_json, created_at, updated_at FROM findings WHERE case_id = ? ORDER BY created_at, id', [caseId]),
      db.all<Record<string, string | null>>('SELECT * FROM audit_events WHERE case_id = ? ORDER BY seq', [caseId]),
      roleFor(user, caseId),
    ]);
    const c = cRow!;
    const members = memberRows.map((m) => ({ userId: m.user_id, email: m.email, displayName: m.display_name, role: m.role }));
    const documents = docRows.map((d) => ({ ...(JSON.parse(d.data_json) as DocumentRecord), hasServerFile: d.file_size != null }));
    const statements = stmtRows.map((s) => JSON.parse(s.data_json) as ClinicalStatement);
    const findings = findingRows
      .map((f) => ({ ...(JSON.parse(f.data_json as string) as Finding), id: f.id as string, reviewStatus: f.review_status as ReviewStatus, stale: !!f.stale, createdAt: f.created_at as string, updatedAt: f.updated_at as string }));
    const events: AuditEvent[] = eventRows.map((e) => ({
      id: e.id!, caseId, kind: e.kind as AuditEvent['kind'], at: e.at!, actor: e.actor_name!,
      ...(e.finding_id ? { findingId: e.finding_id } : {}), ...(e.document_id ? { documentId: e.document_id } : {}),
      ...(e.from_status ? { fromStatus: e.from_status as ReviewStatus } : {}), ...(e.to_status ? { toStatus: e.to_status as ReviewStatus } : {}),
      ...(e.reason ? { reason: e.reason } : {}), ...(e.note ? { note: e.note } : {}), ...(e.detail ? { detail: e.detail } : {}),
    }));
    return {
      case: { id: c.id, label: c.label, createdAt: c.created_at, updatedAt: c.updated_at, lastAnalyzedAt: c.last_analyzed_at, archivedAt: c.archived_at ?? null, owner: `${c.owner_name} <${c.owner_email}>` },
      role, members, documents, statements, findings, events, serverTime: now(),
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
  type Ctx = { req: IncomingMessage; res: ServerResponse; params: string[]; query: URLSearchParams; user: User | null; token: string | null; body: () => Promise<unknown>; raw: () => Promise<Buffer> };
  type Handler = (c: Ctx) => Promise<unknown> | unknown;
  const routes: { method: string; re: RegExp; auth: boolean; h: Handler }[] = [];
  const route = (method: string, path: string, auth: boolean, h: Handler) => routes.push({ method, re: new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`), auth, h });

  route('GET', '/api/health', false, () => ({
    ok: true, service: 'medguard-api', version: API_VERSION, time: now(),
    ai: { configured: !!ai, provider: ai?.name ?? null, model: ai?.model ?? null },
    registration: cfg.allowRegistration,
  }));

  // Readiness: the database answers a query and is at the schema version this build expects.
  const ready = async () => {
    let dbOk = false;
    let version = 0;
    try { await db.get('SELECT 1'); version = await schemaVersion(db); dbOk = true; } catch { dbOk = false; }
    const ok = dbOk && version === SCHEMA_VERSION;
    if (!ok) throw new HttpError(503, 'Not ready: database unavailable or schema not migrated.', 'not_ready');
    // storage: 'external' = PostgreSQL via DATABASE_URL (survives restarts of a free host); 'embedded' = local PGlite files.
    return { ok: true, database: { reachable: true, engine: 'postgresql', storage: db.storage, schemaVersion: version, expectedSchemaVersion: SCHEMA_VERSION }, time: now() };
  };
  route('GET', '/api/ready', false, ready);
  route('GET', '/ready', false, ready);
  route('GET', '/health', false, () => ({ ok: true, service: 'medguard-api', version: API_VERSION, time: now() }));
  route('GET', '/api/openapi.json', false, () => OPENAPI);

  route('POST', '/api/auth/register', false, async (c) => {
    if (!cfg.allowRegistration) throw new HttpError(403, 'Self-registration is disabled on this server. Ask an administrator for an account.');
    const b = Register.parse(await c.body());
    if (await db.get('SELECT 1 FROM users WHERE email = ?', [b.email])) throw new HttpError(409, 'An account with this email already exists.');
    const id = newId('usr');
    await db.run('INSERT INTO users (id, email, display_name, password_hash) VALUES (?,?,?,?)', [id, b.email, b.displayName, await hashPassword(b.password)]);
    const s = await createSession(db, id, cfg.sessionTtlHours);
    return { token: s.token, expiresAt: s.expiresAt, user: { id, email: b.email, displayName: b.displayName } };
  });

  route('POST', '/api/auth/login', false, async (c) => {
    const b = Creds.safeParse(await c.body());
    if (!b.success) throw new HttpError(400, 'Enter a valid email and password.');
    if (!loginLimiter.take(`${b.data.email}|${c.req.socket.remoteAddress}`)) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    const u = await db.get<Record<string, string>>('SELECT id, email, display_name, password_hash FROM users WHERE email = ?', [b.data.email]);
    const ok = u ? await verifyPassword(b.data.password, u.password_hash) : (await hashPassword(b.data.password), false);
    if (!u || !ok) throw new HttpError(401, 'Incorrect email or password.', 'invalid_credentials');
    const s = await createSession(db, u.id, cfg.sessionTtlHours);
    return { token: s.token, expiresAt: s.expiresAt, user: { id: u.id, email: u.email, displayName: u.display_name } };
  });

  route('POST', '/api/auth/logout', true, async (c) => { await revokeSession(db, c.token!); return { ok: true }; });
  route('GET', '/api/auth/me', true, (c) => ({ user: c.user }));

  route('GET', '/api/cases', true, async (c) => {
    const limit = intParam(c.query, 'limit', 50, 1, 100);
    const offset = intParam(c.query, 'offset', 0, 0, 1_000_000);
    const q = (c.query.get('q') ?? '').trim().slice(0, 80);
    const includeArchived = c.query.get('includeArchived') === 'true';
    const where = `m.user_id = ?${includeArchived ? '' : ' AND c.archived_at IS NULL'}${q ? ' AND c.label ILIKE ? ESCAPE \'\\\'' : ''}`;
    const args: string[] = [c.user!.id, ...(q ? [`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`] : [])];
    const total = (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM case_members m JOIN cases c ON c.id = m.case_id WHERE ${where}`, args))!.n;
    const rows = await db.all<Record<string, unknown>>(`SELECT c.id, c.label, c.updated_at, c.last_analyzed_at, c.archived_at, m.role, u.display_name AS owner_name, u.email AS owner_email,
        (SELECT COUNT(*)::int FROM documents d WHERE d.case_id = c.id) AS documents,
        (SELECT COUNT(*)::int FROM findings f WHERE f.case_id = c.id AND f.stale = 0) AS findings
      FROM case_members m JOIN cases c ON c.id = m.case_id JOIN users u ON u.id = c.owner_id WHERE ${where}
      ORDER BY c.updated_at DESC, c.id LIMIT ? OFFSET ?`, [...args, limit, offset]);
    return {
      cases: rows.map((r) => ({ id: r.id, label: r.label, updatedAt: r.updated_at, lastAnalyzedAt: r.last_analyzed_at, archivedAt: r.archived_at ?? null, role: r.role, owner: `${r.owner_name} <${r.owner_email}>`, documents: r.documents, findings: r.findings })),
      total, limit, offset,
    };
  });

  route('POST', '/api/cases', true, async (c) => {
    const b = NewCase.parse(await c.body());
    const id = b.id ?? newId('case');
    if (await db.get('SELECT 1 FROM cases WHERE id = ?', [id])) throw new HttpError(409, 'A case with this identifier already exists.');
    await db.tx(async (q) => {
      await q.run('INSERT INTO cases (id, label, owner_id) VALUES (?,?,?)', [id, b.label, c.user!.id]);
      await q.run("INSERT INTO case_members (case_id, user_id, role, added_by) VALUES (?,?, 'owner', ?)", [id, c.user!.id, c.user!.id]);
      await audit(q, { caseId: id, actor: c.user, kind: 'case_shared', detail: `Shared case "${b.label}" created` });
    });
    return snapshot(id, c.user!);
  });

  route('GET', '/api/cases/([^/]+)', true, async (c) => { await requireRole(c.user!, c.params[0], 'viewer'); return snapshot(c.params[0], c.user!); });

  route('POST', '/api/cases/([^/]+)/members', true, async (c) => {
    const caseId = c.params[0];
    await requireRole(c.user!, caseId, 'owner');
    const b = Member.parse(await c.body());
    const u = await db.get<{ id: string; display_name: string }>('SELECT id, display_name FROM users WHERE email = ?', [b.email]);
    if (!u) throw new HttpError(404, 'No registered user has that email. They must create an account first.');
    if (u.id === c.user!.id) throw new HttpError(400, 'You already own this case.');
    await db.tx(async (q) => {
      await q.run('INSERT INTO case_members (case_id, user_id, role, added_by) VALUES (?,?,?,?) ON CONFLICT(case_id, user_id) DO UPDATE SET role = excluded.role', [caseId, u.id, b.role, c.user!.id]);
      await audit(q, { caseId, actor: c.user, kind: 'member_added', entityType: 'user', entityId: u.id, detail: `${u.display_name} <${b.email}> added as ${b.role}` });
      await touch(q, caseId);
    });
    return snapshot(caseId, c.user!);
  });

  route('DELETE', '/api/cases/([^/]+)/members/([^/]+)', true, async (c) => {
    const [caseId, userId] = c.params;
    await requireRole(c.user!, caseId, 'owner');
    const m = await db.get<{ role: string; email: string }>('SELECT m.role, u.email FROM case_members m JOIN users u ON u.id = m.user_id WHERE m.case_id = ? AND m.user_id = ?', [caseId, userId]);
    if (!m) throw new HttpError(404, 'Member not found.');
    if (m.role === 'owner') throw new HttpError(400, 'The owner cannot be removed.');
    await db.tx(async (q) => {
      await q.run('DELETE FROM case_members WHERE case_id = ? AND user_id = ?', [caseId, userId]);
      await audit(q, { caseId, actor: c.user, kind: 'member_removed', entityType: 'user', entityId: userId, detail: `${m.email} removed` });
    });
    return snapshot(caseId, c.user!);
  });

  // Full-state synchronization of extracted documents, statements and analysis results.
  // Review status is NEVER taken from the client here; it changes only through /transition.
  route('PUT', '/api/cases/([^/]+)/snapshot', true, async (c) => {
    const caseId = c.params[0];
    await requireRole(c.user!, caseId, 'reviewer');
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
    // Server state needed for validation, read once (not once per statement/finding: the database may be remote).
    const storedJson = new Map((await db.all<{ id: string; data_json: string }>('SELECT id, data_json FROM documents WHERE case_id = ?', [caseId])).map((r) => [r.id, r.data_json]));
    const storedParsed = new Map<string, DocumentRecord>();
    // Documents already on the server (and not being removed) remain valid evidence sources.
    const storedDoc = (id: string): DocumentRecord | undefined => {
      if (docMap.has(id)) return docMap.get(id);
      if (removed.has(id)) return undefined;
      const raw = storedJson.get(id);
      if (raw === undefined) return undefined;
      if (!storedParsed.has(id)) storedParsed.set(id, JSON.parse(raw) as DocumentRecord);
      return storedParsed.get(id);
    };
    // Statements with a repeated id: the last one wins (the previous INSERT OR REPLACE behaviour).
    const statements = [...new Map((b.statements as unknown as ClinicalStatement[]).map((s) => [s.id, s])).values()];
    for (const s of statements) {
      const d = docMap.get(s.documentId);
      if (typeof s.id !== 'string' || !s.id || s.id.length > 120 || !d || s.caseId !== caseId || d.extractedText.slice(s.charStart, s.charEnd) !== s.originalText) throw new HttpError(422, 'A statement does not match its source document text.');
    }
    const findings = b.findings as unknown as Finding[];
    const priorJson = new Map((await db.all<{ fingerprint: string; data_json: string }>('SELECT fingerprint, data_json FROM findings WHERE case_id = ?', [caseId])).map((r) => [r.fingerprint, r.data_json]));
    for (const f of findings) {
      if (f.caseId !== caseId || typeof f.fingerprint !== 'string' || !Array.isArray(f.evidence) || !f.evidence.length) throw new HttpError(422, 'A finding in the snapshot is invalid.');
      const prior = priorJson.get(f.fingerprint);
      const priorEvidence = prior ? (JSON.parse(prior) as Finding).evidence : [];
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
    await db.tx(async (q) => {
      await lockCase(q, caseId);
      const existingDocs = new Set((await q.all<{ id: string }>('SELECT id FROM documents WHERE case_id = ?', [caseId])).map((r) => r.id));
      for (const d of docs) {
        if (!existingDocs.has(d.id) && await q.get('SELECT 1 FROM documents WHERE id = ?', [d.id])) throw new HttpError(409, 'Document identifier conflict.');
        // The MIME type is derived from the validated file kind, never trusted from the client.
        const clean: DocumentRecord = { ...d, caseId, mimeType: MIME_BY_KIND[d.fileKind] };
        // The WHERE clause means a row of another case is never overwritten, even under a race.
        const r = await q.run(`INSERT INTO documents (id, case_id, data_json, updated_at) VALUES (?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at WHERE documents.case_id = excluded.case_id`, [d.id, caseId, JSON.stringify(clean), now()]);
        if (r.changes !== 1) throw new HttpError(409, 'Document identifier conflict.');
        if (!existingDocs.has(d.id)) { counts.added++; await audit(q, { caseId, actor: c.user, kind: 'document_uploaded', documentId: d.id, detail: `${d.title} added to the shared case (${String(d.fileKind).toUpperCase()}, ${d.extractionMethod ?? 'no text'})` }); }
      }
      for (const id of removed) {
        if (!existingDocs.has(id)) continue;
        const row = (await q.get<{ data_json: string }>('SELECT data_json FROM documents WHERE id = ?', [id]))!;
        await q.run('DELETE FROM documents WHERE id = ?', [id]); // the stored original file is deleted with it (ON DELETE CASCADE)
        await q.run('DELETE FROM statements WHERE document_id = ? AND case_id = ?', [id, caseId]);
        counts.removed++;
        await audit(q, { caseId, actor: c.user, kind: 'document_deleted', documentId: id, detail: `${JSON.parse(row.data_json).title} removed from the shared case` });
      }
      // Statements are replaced only for the documents included in this snapshot.
      for (const d of docs) await q.run('DELETE FROM statements WHERE document_id = ? AND case_id = ?', [d.id, caseId]);
      for (let i = 0; i < statements.length; i += 250) {
        const chunk = statements.slice(i, i + 250);
        const r = await q.run(`INSERT INTO statements (id, case_id, document_id, data_json) VALUES ${chunk.map(() => '(?,?,?,?)').join(',')}
          ON CONFLICT (id) DO UPDATE SET document_id = excluded.document_id, data_json = excluded.data_json WHERE statements.case_id = excluded.case_id`,
          chunk.flatMap((s) => [s.id, caseId, s.documentId, JSON.stringify(s)]));
        if (r.changes !== chunk.length) throw new HttpError(409, 'Statement identifier conflict.');
      }
      const priorByFp = new Map((await q.all<{ id: string; stale: number; fingerprint: string }>('SELECT id, stale, fingerprint FROM findings WHERE case_id = ?', [caseId])).map((r) => [r.fingerprint, r]));
      for (const f of findings) {
        const prior = priorByFp.get(f.fingerprint);
        const data = { ...f, caseId, reviewStatus: undefined, stale: undefined };
        if (prior) {
          await q.run('UPDATE findings SET data_json = ?, stale = ?, updated_at = CASE WHEN stale != ? THEN ? ELSE updated_at END WHERE id = ?', [JSON.stringify({ ...data, id: prior.id }), f.stale ? 1 : 0, f.stale ? 1 : 0, now(), prior.id]);
          if (f.stale && !prior.stale) {
            counts.superseded++;
            await audit(q, { caseId, actor: null, kind: 'finding_superseded', findingId: prior.id, detail: `${f.displayId} is no longer produced by the current documents; its evidence and review history are preserved.` });
          }
          prior.stale = f.stale ? 1 : 0;
        } else {
          const id = ID_RE.test(String(f.id)) && !await q.get('SELECT 1 FROM findings WHERE id = ?', [f.id]) ? f.id : newId('fd');
          await q.run("INSERT INTO findings (id, case_id, fingerprint, review_status, stale, data_json) VALUES (?,?,?, 'unreviewed', ?, ?)", [id, caseId, f.fingerprint, f.stale ? 1 : 0, JSON.stringify({ ...data, id })]);
          priorByFp.set(f.fingerprint, { id, stale: f.stale ? 1 : 0, fingerprint: f.fingerprint });
          counts.created++;
          await audit(q, { caseId, actor: c.user, actorName: f.origin === 'ai' ? `AI-assisted analysis (${f.aiModel ?? 'model'}) via ${c.user!.displayName}` : 'System (rules engine)', kind: 'finding_created', findingId: id, detail: `${f.displayId}: ${f.title}` });
        }
      }
      await audit(q, { caseId, actor: c.user, kind: b.analyzed ? 'analysis_completed' : 'case_synced', detail: b.detail ?? `Synchronized ${docs.length} document(s), ${statements.length} statement(s), ${findings.length} finding(s): ${counts.created} new, ${counts.superseded} superseded` });
      await touch(q, caseId, !!b.analyzed);
    });
    return snapshot(caseId, c.user!);
  });

  // Original files are stored in the database (document_files), not on the local disk: free hosts wipe their disk on restart.
  route('PUT', '/api/cases/([^/]+)/documents/([^/]+)/file', true, async (c) => {
    const [caseId, docId] = c.params;
    await requireRole(c.user!, caseId, 'reviewer');
    if (!ID_RE.test(docId) || !await db.get('SELECT 1 FROM documents WHERE id = ? AND case_id = ?', [docId, caseId])) throw new HttpError(404, 'Document not found in this case. Synchronize the case first.');
    const buf = await c.raw();
    if (!buf.length) throw new HttpError(400, 'Empty file.');
    await db.run(`INSERT INTO document_files (document_id, data, size, updated_at) VALUES (?,?,?,?)
      ON CONFLICT (document_id) DO UPDATE SET data = excluded.data, size = excluded.size, updated_at = excluded.updated_at`, [docId, buf, buf.length, now()]);
    return { ok: true, size: buf.length };
  });

  route('GET', '/api/cases/([^/]+)/documents/([^/]+)/file', true, async (c) => {
    const [caseId, docId] = c.params;
    await requireRole(c.user!, caseId, 'viewer');
    const row = ID_RE.test(docId)
      ? await db.get<{ data: Uint8Array; data_json: string }>('SELECT f.data, d.data_json FROM documents d JOIN document_files f ON f.document_id = d.id WHERE d.id = ? AND d.case_id = ?', [docId, caseId])
      : undefined;
    if (!row) throw new HttpError(404, 'The original file is not stored on the server.');
    const d = JSON.parse(row.data_json) as DocumentRecord;
    c.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Content-Mime': d.mimeType, 'Content-Disposition': 'attachment', 'Cache-Control': 'no-store' });
    c.res.end(Buffer.from(row.data));
    return SENT;
  });

  route('POST', '/api/findings/([^/]+)/transition', true, async (c) => {
    const id = c.params[0];
    const f = ID_RE.test(id) ? await db.get<{ case_id: string; review_status: ReviewStatus; data_json: string }>('SELECT case_id, review_status, data_json FROM findings WHERE id = ?', [id]) : undefined;
    if (!f) throw new HttpError(404, 'Finding not found.');
    await requireRole(c.user!, f.case_id, 'reviewer');
    const b = Transition.parse(await c.body());
    if (b.expectedStatus && isReviewStatus(b.expectedStatus) && b.expectedStatus !== f.review_status) {
      throw new HttpError(409, `Another reviewer changed this finding to "${f.review_status}" in the meantime. Reload to see the latest state.`, 'conflict');
    }
    try { validateTransition(f.review_status, b.to, b.reason, 'local'); } catch (e) { if (e instanceof ReviewError) throw new HttpError(422, e.message, 'invalid_transition'); throw e; }
    await db.tx(async (q) => {
      // Optimistic concurrency: the update applies only if nobody changed the status since it was read.
      const r = await q.run('UPDATE findings SET review_status = ?, updated_at = ? WHERE id = ? AND review_status = ?', [b.to, now(), id, f.review_status]);
      if (r.changes !== 1) throw new HttpError(409, 'The finding changed concurrently. Reload and try again.', 'conflict');
      await audit(q, { caseId: f.case_id, actor: c.user, kind: 'status_changed', findingId: id, from: f.review_status, to: b.to, reason: b.reason?.trim() || undefined });
      await touch(q, f.case_id);
    });
    return snapshot(f.case_id, c.user!);
  });

  route('POST', '/api/findings/([^/]+)/notes', true, async (c) => {
    const id = c.params[0];
    const f = ID_RE.test(id) ? await db.get<{ case_id: string }>('SELECT case_id FROM findings WHERE id = ?', [id]) : undefined;
    if (!f) throw new HttpError(404, 'Finding not found.');
    await requireRole(c.user!, f.case_id, 'reviewer');
    const b = Note.parse(await c.body());
    await db.tx(async (q) => { await audit(q, { caseId: f.case_id, actor: c.user, kind: 'note_added', findingId: id, note: b.note }); await touch(q, f.case_id); });
    return snapshot(f.case_id, c.user!);
  });

  const CaseUpdate = z.object({ label: z.string().trim().min(1).max(80).optional(), archived: z.boolean().optional() })
    .refine((b) => b.label !== undefined || b.archived !== undefined, { message: 'Provide label and/or archived.' });
  route('PATCH', '/api/cases/([^/]+)', true, async (c) => {
    const caseId = c.params[0];
    await requireRole(c.user!, caseId, 'owner', { allowArchived: true });
    const b = CaseUpdate.parse(await c.body());
    await db.tx(async (q) => {
      const cur = (await q.get<{ label: string; archived_at: string | null }>('SELECT label, archived_at FROM cases WHERE id = ? FOR UPDATE', [caseId]))!;
      if (b.label !== undefined && b.label !== cur.label) {
        await q.run('UPDATE cases SET label = ?, updated_at = ? WHERE id = ?', [b.label, now(), caseId]);
        await audit(q, { caseId, actor: c.user, kind: 'case_updated', detail: `Case label changed from "${cur.label}" to "${b.label}"` });
      }
      if (b.archived !== undefined && b.archived !== !!cur.archived_at) {
        await q.run('UPDATE cases SET archived_at = ?, updated_at = ? WHERE id = ?', [b.archived ? now() : null, now(), caseId]);
        await audit(q, { caseId, actor: c.user, kind: 'case_updated', detail: b.archived ? 'Case archived (read-only; data retained)' : 'Case restored from archive' });
      }
    });
    return snapshot(caseId, c.user!);
  });

  /** Document metadata without the extracted text (which can be large and is clinical content). */
  type DocRow = { data_json: string; file_size: number | null };
  const DOC_SELECT = 'SELECT d.data_json, f.size AS file_size FROM documents d LEFT JOIN document_files f ON f.document_id = d.id';
  function docMeta(row: DocRow) {
    const { extractedText, ocrLowConfidence: _l, ocrRegions: _r, pageSpans: _p, ...meta } = JSON.parse(row.data_json) as DocumentRecord;
    return { ...meta, textLength: extractedText?.length ?? 0, hasServerFile: row.file_size != null, serverFileSize: row.file_size ?? null };
  }
  route('GET', '/api/cases/([^/]+)/documents', true, async (c) => {
    const caseId = c.params[0];
    await requireRole(c.user!, caseId, 'viewer');
    const rows = await db.all<DocRow>(`${DOC_SELECT} WHERE d.case_id = ? ORDER BY d.id`, [caseId]);
    return { documents: rows.map(docMeta) };
  });
  route('GET', '/api/cases/([^/]+)/documents/([^/]+)', true, async (c) => {
    const [caseId, docId] = c.params;
    await requireRole(c.user!, caseId, 'viewer');
    const row = ID_RE.test(docId) ? await db.get<DocRow>(`${DOC_SELECT} WHERE d.id = ? AND d.case_id = ?`, [docId, caseId]) : undefined;
    if (!row) throw new HttpError(404, 'Document not found in this case.', 'not_found');
    const meta = docMeta(row);
    return c.query.get('include') === 'text' ? { document: { ...meta, extractedText: (JSON.parse(row.data_json) as DocumentRecord).extractedText } } : { document: meta };
  });

  const STATUS_SET = new Set(['unreviewed', 'in_review', 'confirmed', 'resolved', 'dismissed', 'needs_info', 'expected_change', 'undetermined']);
  const TYPE_SET = new Set(['explicit_conflict', 'potential_discrepancy', 'temporal_inconsistency', 'context_dependent', 'insufficient_evidence']);
  async function findingRow(id: string) {
    const f = ID_RE.test(id) ? await db.get<Record<string, string | number>>('SELECT id, case_id, review_status, stale, data_json, created_at, updated_at FROM findings WHERE id = ?', [id]) : undefined;
    if (!f) throw new HttpError(404, 'Finding not found.', 'not_found');
    return f;
  }
  const toFinding = (f: Record<string, string | number>): Finding => ({ ...(JSON.parse(f.data_json as string) as Finding), id: f.id as string, caseId: f.case_id as string, reviewStatus: f.review_status as ReviewStatus, stale: !!f.stale, createdAt: f.created_at as string, updatedAt: f.updated_at as string });

  route('GET', '/api/cases/([^/]+)/findings', true, async (c) => {
    const caseId = c.params[0];
    await requireRole(c.user!, caseId, 'viewer');
    const status = c.query.get('status');
    const type = c.query.get('type');
    const category = c.query.get('category');
    if (status && !STATUS_SET.has(status)) throw new HttpError(400, `Unknown review status "${status}".`, 'validation');
    if (type && !TYPE_SET.has(type)) throw new HttpError(400, `Unknown finding type "${type}".`, 'validation');
    const rows = await db.all<Record<string, string | number>>(`SELECT id, case_id, review_status, stale, data_json, created_at, updated_at FROM findings
      WHERE case_id = ?${status ? ' AND review_status = ?' : ''}${c.query.get('includeStale') === 'true' ? '' : ' AND stale = 0'} ORDER BY created_at, id`,
      [caseId, ...(status ? [status] : [])]);
    let list = rows.map(toFinding);
    if (type) list = list.filter((f) => f.findingType === type);
    if (category) list = list.filter((f) => f.category === category);
    return { findings: list };
  });
  route('GET', '/api/findings/([^/]+)', true, async (c) => {
    const f = await findingRow(c.params[0]);
    await requireRole(c.user!, f.case_id as string, 'viewer');
    return { finding: toFinding(f) };
  });
  /** Evidence references, each re-checked against the stored document text (never altered). */
  route('GET', '/api/findings/([^/]+)/evidence', true, async (c) => {
    const f = await findingRow(c.params[0]);
    await requireRole(c.user!, f.case_id as string, 'viewer');
    const finding = toFinding(f);
    const texts = new Map<string, string>();
    for (const id of new Set(finding.evidence.map((e) => e.documentId))) {
      const d = await db.get<{ data_json: string }>('SELECT data_json FROM documents WHERE id = ? AND case_id = ?', [id, f.case_id]);
      if (d) texts.set(id, (JSON.parse(d.data_json) as DocumentRecord).extractedText);
    }
    return {
      findingId: finding.id,
      evidence: finding.evidence.map((e) => ({
        ...e,
        documentAvailable: texts.has(e.documentId),
        verified: texts.has(e.documentId) && texts.get(e.documentId)!.slice(e.charStart, e.charEnd) === e.quote,
      })),
    };
  });
  route('GET', '/api/findings/([^/]+)/history', true, async (c) => {
    const f = await findingRow(c.params[0]);
    await requireRole(c.user!, f.case_id as string, 'viewer');
    const rows = await db.all<Record<string, string | null>>('SELECT * FROM audit_events WHERE finding_id = ? ORDER BY seq', [f.id]);
    return { findingId: f.id, reviewStatus: f.review_status, history: rows.map(eventOut) };
  });

  function eventOut(e: Record<string, string | number | null>) {
    return {
      id: e.id, seq: e.seq, caseId: e.case_id, kind: e.kind, at: e.at, actor: e.actor_name,
      findingId: e.finding_id ?? undefined, documentId: e.document_id ?? undefined,
      fromStatus: e.from_status ?? undefined, toStatus: e.to_status ?? undefined, reason: e.reason ?? undefined, note: e.note ?? undefined, detail: e.detail ?? undefined,
    };
  }
  route('GET', '/api/cases/([^/]+)/activity', true, async (c) => {
    const caseId = c.params[0];
    await requireRole(c.user!, caseId, 'viewer');
    const limit = intParam(c.query, 'limit', 50, 1, 200);
    const before = c.query.has('before') ? intParam(c.query, 'before', 0, 1, Number.MAX_SAFE_INTEGER) : null;
    const rows = await db.all<Record<string, string | number | null>>(`SELECT * FROM audit_events WHERE case_id = ?${before ? ' AND seq < ?' : ''} ORDER BY seq DESC LIMIT ?`, [caseId, ...(before ? [before] : []), limit]);
    return { events: rows.map(eventOut), nextBefore: rows.length === limit ? rows[rows.length - 1].seq : null };
  });
  route('GET', '/api/activity', true, async (c) => {
    const limit = intParam(c.query, 'limit', 50, 1, 200);
    const rows = await db.all<Record<string, string | number | null>>('SELECT e.* FROM audit_events e JOIN case_members m ON m.case_id = e.case_id AND m.user_id = ? ORDER BY e.seq DESC LIMIT ?', [c.user!.id, limit]);
    return { events: rows.map(eventOut) };
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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
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
      const user = await userForToken(db, token);
      if (r.auth && !user) throw new HttpError(401, token ? 'Your session has expired. Sign in again.' : 'Sign in to use the shared workspace.', 'unauthenticated');
      const ctx: Ctx = {
        req, res, params, query: url.searchParams, user, token,
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
      else if (e instanceof DbUnavailableError) { log(`database unavailable ${req.method} ${url.pathname}`); send(503, { error: 'The database is temporarily unavailable. Try again in a moment.', code: 'database_unavailable' }); }
      else if (e instanceof DbConflictError) send(409, { error: 'The data changed concurrently. Reload and try again.', code: 'conflict' });
      else if (e instanceof z.ZodError) send(400, { error: 'Invalid request: ' + e.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; '), code: 'validation' });
      else { log(`error ${req.method} ${url.pathname}: ${(e as Error)?.name ?? 'unknown'}`); send(500, { error: 'Internal server error.', code: 'internal' }); }
    } finally {
      log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  const close = async () => {
    await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
    await db.close();
  };
  return { server, db, routes: routes.map((r) => `${r.method} ${r.re.source.slice(1, -1)}`), close };
}
