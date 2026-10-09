// Backend API and database tests. Every test runs against an isolated, throw-away PostgreSQL
// database (embedded PGlite, or a fresh database on TEST_DATABASE_URL) — never against production data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp, openConfiguredDb } from '../../server/app';
import { loadConfig } from '../../server/config';
import { openDb, schemaVersion, SCHEMA_VERSION, DbConflictError, DbUnavailableError, pgConfigFromUrl, toPgPlaceholders, type Db, type OpenDbOptions } from '../../server/db';
import { OPENAPI } from '../../server/openapi';
import { extractStatements } from '../../src/lib/statements';
import { detectContradictions } from '../../src/lib/detect';
import { makeDoc } from './helpers';
import { newDatabase, REAL_PG } from './testDb';

const ORIGIN = 'http://localhost:4173';

/** Starts an API server on the given database (opened and migrated here unless an open Db is passed). */
async function start(target: OpenDbOptions | Db) {
  const config = { ...loadConfig({}), allowRegistration: true, allowedOrigins: [ORIGIN], anthropicApiKey: null };
  const db = 'tx' in target ? target : await openDb(target);
  const app = await createApp({ config, db, ai: null, log: () => {} });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const api = async (path: string, opts: { method?: string; token?: string; body?: unknown; rawBody?: string } = {}) => {
    const res = await fetch(base + path, {
      method: opts.method ?? (opts.body !== undefined || opts.rawBody !== undefined ? 'POST' : 'GET'),
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), 'Content-Type': 'application/json' },
      body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  return { app, api };
}

const TEXT_A = 'ALLERGIES\nCodeine allergy documented.\nMEDICATIONS\nFurosemide 40 mg once daily.';
const TEXT_B = 'ALLERGIES\nNo known drug allergies.\nMEDICATIONS\nFurosemide 20 mg once daily.';

/** A verifiable analysis snapshot built with the real extraction and detection rules (synthetic text). */
function buildSnapshot(caseId: string) {
  const docs = [
    makeDoc(caseId, TEXT_A, { id: 'doc_backendA01', title: 'Synthetic clinic letter', documentDate: '2026-02-01' }),
    makeDoc(caseId, TEXT_B, { id: 'doc_backendB01', title: 'Synthetic intake form', documentDate: '2026-02-12' }),
  ];
  const statements = docs.flatMap((d) => extractStatements(d));
  const findings = detectContradictions(caseId, statements, docs).findings.map((f, i) => ({ ...f, id: `fd_backend${i}aaaa`, reviewStatus: 'unreviewed', stale: false, createdAt: '', updatedAt: '' }));
  return { documents: docs, statements, findings, analyzed: true };
}

describe('database: migrations, constraints and integrity', () => {
  it('migrates a clean database to the current schema version', async () => {
    const db = await openDb(await newDatabase());
    expect(await schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
    const tables = (await db.all<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'")).map((t) => t.name);
    for (const t of ['users', 'sessions', 'cases', 'case_members', 'documents', 'document_files', 'statements', 'findings', 'audit_events', 'schema_version']) expect(tables).toContain(t);
    await db.close();
  });

  it('upgrades an existing v1 database without losing rows, and re-opening is a no-op', async () => {
    const target = await newDatabase({ onDisk: true });
    const v1 = await openDb({ ...target, upTo: 1 });
    expect(await schemaVersion(v1)).toBe(1);
    await v1.run("INSERT INTO users (id, email, display_name, password_hash) VALUES ('usr_upgrade01', 'u@example.test', 'U', 'x')");
    await v1.run("INSERT INTO cases (id, label, owner_id) VALUES ('case_upgrade01', 'Synthetic', 'usr_upgrade01')");
    await v1.run("INSERT INTO documents (id, case_id, data_json) VALUES ('doc_upgrade01', 'case_upgrade01', '{\"title\":\"d\"}')");
    await v1.run("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_upgrade01', 'case_upgrade01', 'fp1', 'resolved', '{\"title\":\"t\"}')");
    await v1.run("INSERT INTO audit_events (id, case_id, actor_name, kind) VALUES ('ev_upgrade01', 'case_upgrade01', 'System', 'finding_created')");
    // v1 rejects the newer outcomes.
    await expect(v1.run("UPDATE findings SET review_status = 'needs_info'")).rejects.toThrow(/check constraint/);
    await v1.close();

    const v3 = await openDb(target);
    expect(await schemaVersion(v3)).toBe(SCHEMA_VERSION);
    expect(await v3.get("SELECT review_status, data_json FROM findings WHERE id = 'fd_upgrade01'")).toEqual({ review_status: 'resolved', data_json: '{"title":"t"}' });
    expect((await v3.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM audit_events'))!.n).toBe(1);
    expect((await v3.get<{ archived_at: null }>("SELECT archived_at FROM cases WHERE id = 'case_upgrade01'"))!.archived_at).toBeNull();
    expect((await v3.get<{ data_json: string }>("SELECT data_json FROM documents WHERE id = 'doc_upgrade01'"))!.data_json).toBe('{"title":"d"}');
    await v3.run("UPDATE findings SET review_status = 'needs_info' WHERE id = 'fd_upgrade01'");
    await v3.close();
    const again = await openDb(target);
    expect((await again.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM schema_version'))!.n).toBe(SCHEMA_VERSION);
    await again.close();
  });

  it('enforces foreign keys, the status check, uniqueness and the append-only activity log', async () => {
    const db = await openDb(await newDatabase());
    await expect(db.run("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_orphan001', 'case_missing01', 'fp', 'unreviewed', '{}')")).rejects.toBeInstanceOf(DbConflictError);
    await db.run("INSERT INTO users (id, email, display_name, password_hash) VALUES ('usr_c0000001', 'c@example.test', 'C', 'x')");
    await expect(db.run("INSERT INTO users (id, email, display_name, password_hash) VALUES ('usr_c0000002', 'Upper@example.test', 'C', 'x')")).rejects.toThrow(/check constraint/);
    await db.run("INSERT INTO cases (id, label, owner_id) VALUES ('case_c0000001', 'Synthetic', 'usr_c0000001')");
    await expect(db.run("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_c0000001', 'case_c0000001', 'fp', 'approved', '{}')")).rejects.toThrow(/check constraint/);
    await db.run("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_c0000001', 'case_c0000001', 'fp', 'unreviewed', '{}')");
    await expect(db.run("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_c0000002', 'case_c0000001', 'fp', 'unreviewed', '{}')")).rejects.toBeInstanceOf(DbConflictError);
    await db.run("INSERT INTO audit_events (id, case_id, actor_name, kind) VALUES ('ev_c0000001', 'case_c0000001', 'System', 'case_shared')");
    await expect(db.run("UPDATE audit_events SET kind = 'x'")).rejects.toThrow(/append-only/);
    await expect(db.run('DELETE FROM audit_events')).rejects.toThrow(/append-only/);
    await expect(db.run('TRUNCATE audit_events')).rejects.toThrow(/append-only/);
    // A failed transaction leaves nothing behind.
    await expect(db.tx(async (q) => { await q.run("INSERT INTO cases (id, label, owner_id) VALUES ('case_c0000002', 'Rolled back', 'usr_c0000001')"); throw new Error('abort'); })).rejects.toThrow('abort');
    expect(await db.get("SELECT 1 FROM cases WHERE id = 'case_c0000002'")).toBeUndefined();
    await db.close();
  });

  it('translates placeholders and connection strings safely', () => {
    expect(toPgPlaceholders("SELECT ? , '?' , ? WHERE a ILIKE ? ESCAPE '\\'")).toBe("SELECT $1 , '?' , $2 WHERE a ILIKE $3 ESCAPE '\\'");
    // libpq-style provider URLs (e.g. Neon) → verified TLS; channel_binding becomes a driver option, not a server parameter.
    const c = pgConfigFromUrl('postgresql://u:p@ep-x.example.tech/db?sslmode=require&channel_binding=require');
    expect(c.connectionString).toBe('postgresql://u:p@ep-x.example.tech/db?sslmode=verify-full');
    expect(c.enableChannelBinding).toBe(true);
    expect(() => pgConfigFromUrl('mysql://u@h/db')).toThrow(/postgres/);
    expect(() => pgConfigFromUrl('not a url')).toThrow(/valid/);
  });
});

describe('database errors and configuration guards', () => {
  it('reports an unreachable database as DbUnavailableError without leaking the URL', async () => {
    const err = await openDb({ url: 'postgres://medguard:not-a-secret@127.0.0.1:1/none' }).catch((e) => e);
    expect(err).toBeInstanceOf(DbUnavailableError);
    expect(String(err.message)).not.toContain('not-a-secret');
  });

  it('refuses to start on an ephemeral disk when an external database is required', async () => {
    const cfg = { ...loadConfig({ MEDGUARD_REQUIRE_DATABASE_URL: 'true' }) };
    expect(cfg.databaseUrl).toBeNull();
    await expect(openConfiguredDb(cfg)).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it('answers 503 (not 500) while the database is down, and readiness reports not ready', async () => {
    const real = await openDb(await newDatabase());
    let down = false;
    const guard = <T extends (...a: any[]) => Promise<any>>(fn: T) => ((...a: any[]) => (down ? Promise.reject(new DbUnavailableError()) : fn(...a))) as T;
    const flaky: Db = { ...real, all: guard(real.all), get: guard(real.get), run: guard(real.run), exec: guard(real.exec), tx: guard(real.tx), storage: real.storage, close: real.close };
    const { app, api } = await start(flaky);
    const token = (await api('/api/auth/register', { body: { email: 'down@example.test', password: 'correct-horse-battery', displayName: 'D' } })).json.token;
    expect((await api('/api/ready')).status).toBe(200);
    down = true;
    const r = await api('/api/cases', { token });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('database_unavailable');
    expect((await api('/api/ready')).json.code).toBe('not_ready');
    expect((await api('/api/health')).status).toBe(200); // liveness does not depend on the database
    down = false;
    expect((await api('/api/cases', { token })).status).toBe(200);
    await app.close();
  });
});

describe('API: health, readiness and documentation', () => {
  it('reports liveness and readiness; readiness fails with 503 on an unmigrated database', async () => {
    const { app, api } = await start(await newDatabase());
    expect((await api('/health')).json).toMatchObject({ ok: true, service: 'medguard-api' });
    expect((await api('/api/health')).status).toBe(200);
    const ready = await api('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.json.database).toEqual({ reachable: true, engine: 'postgresql', storage: REAL_PG ? 'external' : 'embedded', schemaVersion: SCHEMA_VERSION, expectedSchemaVersion: SCHEMA_VERSION });
    expect((await api('/ready')).status).toBe(200);
    expect(JSON.stringify(ready.json)).not.toMatch(/postgres:|password|token/i);
    await app.close();

    const old = await start(await openDb({ ...(await newDatabase()), upTo: 1 }));
    const nr = await old.api('/api/ready');
    expect(nr.status).toBe(503);
    expect(nr.json.code).toBe('not_ready');
    await old.app.close();
  });

  it('documents exactly the routes the server registers', async () => {
    const { app, api } = await start(await newDatabase());
    const doc = (await api('/api/openapi.json')).json;
    expect(doc.openapi).toBe('3.1.0');
    const norm = (p: string) => p.replace(/\\\//g, '/').replace(/\{[^}]+\}/g, '*').replace(/\(\[\^\/\]\+\)/g, '*');
    const documented = Object.entries(OPENAPI.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${norm(p)}`)).sort();
    const registered = app.routes.map((r) => { const [m, p] = r.split(' '); return `${m} ${norm(p)}`; }).sort();
    expect(documented).toEqual(registered);
    await app.close();
  });
});

describe('API: cases, documents, findings, evidence, reviews and activity', () => {
  let target: OpenDbOptions;
  let s: Awaited<ReturnType<typeof start>>;
  let owner = '', reviewer = '', viewer = '', outsider = '';
  let caseId = '';
  let findings: any[] = [];

  const register = async (email: string, name: string) => {
    const r = await s.api('/api/auth/register', { body: { email, password: 'correct-horse-battery', displayName: name } });
    expect(r.status).toBe(200);
    return r.json.token as string;
  };

  beforeAll(async () => {
    target = await newDatabase({ onDisk: true });
    s = await start(target);
    owner = await register('owner@example.test', 'Olivia Owner');
    reviewer = await register('rev@example.test', 'Ravi Reviewer');
    viewer = await register('view@example.test', 'Vera Viewer');
    outsider = await register('out@example.test', 'Oscar Outsider');
  });
  afterAll(() => s.app.close());

  it('creates, retrieves and lists cases with pagination and search; rejects invalid input', async () => {
    const created = await s.api('/api/cases', { token: owner, body: { label: 'SYN-0001 · synthetic' } });
    expect(created.status).toBe(200);
    caseId = created.json.case.id;
    expect(created.json.case.archivedAt).toBeNull();
    for (const l of ['SYN-0002 · synthetic', 'OTHER-0003 · synthetic']) expect((await s.api('/api/cases', { token: owner, body: { label: l } })).status).toBe(200);
    expect((await s.api(`/api/cases/${caseId}`, { token: owner })).json.case.label).toBe('SYN-0001 · synthetic');

    const page1 = await s.api('/api/cases?limit=2', { token: owner });
    expect(page1.json).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(page1.json.cases).toHaveLength(2);
    expect((await s.api('/api/cases?limit=2&offset=2', { token: owner })).json.cases).toHaveLength(1);
    expect((await s.api('/api/cases?q=SYN-', { token: owner })).json.total).toBe(2);
    expect((await s.api('/api/cases?q=%25', { token: owner })).json.total).toBe(0); // "%" is matched literally
    expect((await s.api('/api/cases?limit=0', { token: owner })).status).toBe(400);
    expect((await s.api('/api/cases?limit=abc', { token: owner })).status).toBe(400);

    const bad = await s.api('/api/cases', { token: owner, body: { label: '' } });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('validation');
    expect((await s.api('/api/cases', { token: owner, rawBody: '{not json' })).status).toBe(400);
    expect((await s.api('/api/cases', { body: { label: 'x' } })).status).toBe(401);
    expect((await s.api('/api/cases/case_doesnotexist1', { token: owner })).status).toBe(404);
    expect((await s.api('/api/nope', { token: owner })).status).toBe(404);

    for (const [email, role] of [['rev@example.test', 'reviewer'], ['view@example.test', 'viewer']]) {
      expect((await s.api(`/api/cases/${caseId}/members`, { token: owner, body: { email, role } })).status).toBe(200);
    }
  });

  it('registers documents with findings via a verified snapshot, and serves document metadata', async () => {
    const snap = buildSnapshot(caseId);
    expect(snap.findings.length).toBeGreaterThanOrEqual(2);
    const r = await s.api(`/api/cases/${caseId}/snapshot`, { method: 'PUT', token: owner, body: snap });
    expect(r.status).toBe(200);
    findings = r.json.findings;

    const list = await s.api(`/api/cases/${caseId}/documents`, { token: viewer });
    expect(list.json.documents).toHaveLength(2);
    expect(list.json.documents[0]).not.toHaveProperty('extractedText');
    expect(list.json.documents[0].textLength).toBeGreaterThan(10);
    expect(list.json.documents[0].hasServerFile).toBe(false); // metadata only — no original file was uploaded
    const one = await s.api(`/api/cases/${caseId}/documents/doc_backendA01?include=text`, { token: viewer });
    expect(one.json.document.extractedText).toBe(TEXT_A);
    expect((await s.api(`/api/cases/${caseId}/documents/doc_backendA01`, { token: outsider })).status).toBe(404);
    expect((await s.api(`/api/cases/${caseId}/documents/doc_missing0001`, { token: viewer })).status).toBe(404);
  });

  it('lists and filters findings and returns verified evidence references', async () => {
    const all = await s.api(`/api/cases/${caseId}/findings`, { token: viewer });
    expect(all.json.findings.map((f: any) => f.id).sort()).toEqual(findings.map((f) => f.id).sort());
    expect(all.json.findings.every((f: any) => f.caseId === caseId && f.reviewStatus === 'unreviewed')).toBe(true);
    expect((await s.api(`/api/cases/${caseId}/findings?status=confirmed`, { token: viewer })).json.findings).toHaveLength(0);
    expect((await s.api(`/api/cases/${caseId}/findings?category=allergy`, { token: viewer })).json.findings.every((f: any) => f.category === 'allergy')).toBe(true);
    expect((await s.api(`/api/cases/${caseId}/findings?status=bogus`, { token: viewer })).status).toBe(400);
    expect((await s.api(`/api/cases/${caseId}/findings?type=bogus`, { token: viewer })).status).toBe(400);

    const f = findings[0];
    expect((await s.api(`/api/findings/${f.id}`, { token: viewer })).json.finding.title).toBe(f.title);
    const ev = await s.api(`/api/findings/${f.id}/evidence`, { token: viewer });
    expect(ev.json.evidence.length).toBeGreaterThanOrEqual(2);
    for (const e of ev.json.evidence) {
      expect(e.documentAvailable).toBe(true);
      expect(e.verified).toBe(true);
      expect([TEXT_A, TEXT_B]).toContain([TEXT_A, TEXT_B].find((t) => t.includes(e.quote)));
    }
    for (const p of [`/api/findings/${f.id}`, `/api/findings/${f.id}/evidence`, `/api/findings/${f.id}/history`]) expect((await s.api(p, { token: outsider })).status).toBe(404);
    expect((await s.api('/api/findings/fd_missing00001', { token: viewer })).status).toBe(404);
  });

  it('persists the full review-outcome set with validated transitions, reasons and history', async () => {
    const f = findings.find((x) => x.concept === 'medication:furosemide') ?? findings[0];
    const t = (to: string, reason?: string, token = reviewer) => s.api(`/api/findings/${f.id}/transition`, { token, body: { to, reason } });
    expect((await t('needs_info')).status).toBe(422); // must go through "in review" first
    expect((await t('in_review', undefined, viewer)).status).toBe(403);
    expect((await t('in_review')).status).toBe(200);
    expect((await t('needs_info')).status).toBe(200); // rationale optional
    expect((await s.api(`/api/findings/${f.id}/notes`, { token: reviewer, body: { note: 'Awaiting the current prescription (synthetic).' } })).status).toBe(200);
    expect((await s.api(`/api/findings/${f.id}/notes`, { token: reviewer, body: { note: '   ' } })).status).toBe(400);
    expect((await t('expected_change')).status).toBe(422); // reason required
    expect((await t('expected_change', 'Dose reduced at the later visit (synthetic).')).status).toBe(200);
    expect((await t('confirmed')).status).toBe(422); // closed: must be reopened first

    const hist = await s.api(`/api/findings/${f.id}/history`, { token: viewer });
    expect(hist.json.reviewStatus).toBe('expected_change');
    const moves = hist.json.history.filter((e: any) => e.kind === 'status_changed').map((e: any) => `${e.fromStatus}>${e.toStatus}`);
    expect(moves).toEqual(['unreviewed>in_review', 'in_review>needs_info', 'needs_info>expected_change']);
    expect(hist.json.history.find((e: any) => e.kind === 'note_added').actor).toContain('Ravi Reviewer');
    expect((await s.api(`/api/cases/${caseId}/findings?status=expected_change`, { token: viewer })).json.findings.map((x: any) => x.id)).toEqual([f.id]);
  });

  it('updates and archives cases (owner only, audited); archived cases are read-only', async () => {
    expect((await s.api(`/api/cases/${caseId}`, { method: 'PATCH', token: reviewer, body: { label: 'Hijack' } })).status).toBe(403);
    expect((await s.api(`/api/cases/${caseId}`, { method: 'PATCH', token: owner, body: {} })).status).toBe(400);
    const renamed = await s.api(`/api/cases/${caseId}`, { method: 'PATCH', token: owner, body: { label: 'SYN-0001 · renamed' } });
    expect(renamed.json.case.label).toBe('SYN-0001 · renamed');
    const archived = await s.api(`/api/cases/${caseId}`, { method: 'PATCH', token: owner, body: { archived: true } });
    expect(archived.json.case.archivedAt).toBeTruthy();
    expect((await s.api('/api/cases', { token: owner })).json.cases.map((c: any) => c.id)).not.toContain(caseId);
    expect((await s.api('/api/cases?includeArchived=true', { token: owner })).json.cases.map((c: any) => c.id)).toContain(caseId);
    const f = findings[1] ?? findings[0];
    const blocked = await s.api(`/api/findings/${f.id}/notes`, { token: reviewer, body: { note: 'x' } });
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe('archived');
    expect((await s.api(`/api/cases/${caseId}/snapshot`, { method: 'PUT', token: owner, body: buildSnapshot(caseId) })).status).toBe(409);
    expect((await s.api(`/api/cases/${caseId}/findings`, { token: viewer })).status).toBe(200); // still readable
    expect((await s.api(`/api/cases/${caseId}`, { method: 'PATCH', token: owner, body: { archived: false } })).json.case.archivedAt).toBeNull();
  });

  it('returns case activity newest first with pagination, and activity across cases', async () => {
    const page = await s.api(`/api/cases/${caseId}/activity?limit=3`, { token: viewer });
    expect(page.json.events).toHaveLength(3);
    expect(page.json.events[0].seq).toBeGreaterThan(page.json.events[1].seq);
    expect(page.json.events[0]).toMatchObject({ kind: 'case_updated', detail: 'Case restored from archive' });
    const next = await s.api(`/api/cases/${caseId}/activity?limit=3&before=${page.json.nextBefore}`, { token: viewer });
    expect(next.json.events[0].seq).toBeLessThan(page.json.events[2].seq);
    expect((await s.api(`/api/cases/${caseId}/activity?before=-1`, { token: viewer })).status).toBe(400);
    expect((await s.api(`/api/cases/${caseId}/activity`, { token: outsider })).status).toBe(404);
    const mine = await s.api('/api/activity?limit=200', { token: owner });
    expect(mine.json.events.some((e: any) => e.caseId === caseId)).toBe(true);
    expect((await s.api('/api/activity', { token: outsider })).json.events).toHaveLength(0);
    expect(JSON.stringify(mine.json)).not.toMatch(/password|token_hash/i);
  });

  it('isolates cases: identifiers of another case can be neither overwritten nor read', async () => {
    const other = (await s.api('/api/cases', { token: outsider, body: { label: 'OUT-0001 · synthetic' } })).json.case.id;
    const mine = buildSnapshot(caseId);
    // The outsider re-uses this case's document id: rejected, and the original document is untouched.
    const forged = { ...buildSnapshot(other), documents: [{ ...mine.documents[0], caseId: other }], statements: [], findings: [] };
    expect((await s.api(`/api/cases/${other}/snapshot`, { method: 'PUT', token: outsider, body: forged })).status).toBe(409);
    // ... and this case's statement ids, attached to a document of their own: rejected as well.
    const ownDoc = { ...mine.documents[0], id: 'doc_outsider001', caseId: other };
    const stolen = mine.statements.filter((x: any) => x.documentId === mine.documents[0].id).map((x: any) => ({ ...x, caseId: other, documentId: ownDoc.id }));
    expect((await s.api(`/api/cases/${other}/snapshot`, { method: 'PUT', token: outsider, body: { documents: [ownDoc], statements: stolen, findings: [] } })).status).toBe(409);
    const still = (await s.api(`/api/cases/${caseId}`, { token: owner })).json;
    expect(still.documents.find((d: any) => d.id === mine.documents[0].id).extractedText).toBe(TEXT_A);
    expect(still.statements.length).toBe(mine.statements.length);
    expect((await s.api(`/api/cases/${caseId}/documents/${mine.documents[0].id}/file`, { token: outsider })).status).toBe(404);
  });

  it('stores original files in the database, members only', async () => {
    const put = await s.api(`/api/cases/${caseId}/documents/doc_backendA01/file`, { method: 'PUT', token: owner, rawBody: '%PDF-1.4 synthetic original' });
    expect(put.json).toEqual({ ok: true, size: 27 });
    expect((await s.api(`/api/cases/${caseId}/documents/doc_backendA01`, { token: viewer })).json.document).toMatchObject({ hasServerFile: true, serverFileSize: 27 });
    expect((await s.api(`/api/cases/${caseId}/documents/doc_backendA01/file`, { method: 'PUT', token: viewer, rawBody: 'x' })).status).toBe(403);
  });

  it('keeps all data after the server restarts on the same database', async () => {
    const before = (await s.api(`/api/cases/${caseId}`, { token: owner })).json;
    await s.app.close(); // closes the HTTP server and every database connection
    s = await start(target); // a new server with a fresh connection to the same database
    const login = await s.api('/api/auth/login', { body: { email: 'owner@example.test', password: 'correct-horse-battery' } });
    expect(login.status).toBe(200);
    owner = login.json.token;
    const after = (await s.api(`/api/cases/${caseId}`, { token: owner })).json;
    expect(after.case.label).toBe('SYN-0001 · renamed');
    expect(after.findings.map((f: any) => [f.id, f.reviewStatus]).sort()).toEqual(before.findings.map((f: any) => [f.id, f.reviewStatus]).sort());
    expect(after.events.length).toBe(before.events.length);
    expect(after.documents.map((d: any) => d.id).sort()).toEqual(['doc_backendA01', 'doc_backendB01']);
    expect(after.documents.find((d: any) => d.id === 'doc_backendA01').hasServerFile).toBe(true);
    expect(after.statements.length).toBe(before.statements.length);
    const file = (await s.api(`/api/cases/${caseId}/documents/doc_backendA01/file`, { token: owner })).json;
    expect(file).toBe('%PDF-1.4 synthetic original'); // the original file survived the restart too
  });
});
