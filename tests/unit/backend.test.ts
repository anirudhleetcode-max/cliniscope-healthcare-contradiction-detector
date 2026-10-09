// Backend API and database tests. Every test runs against an isolated, throw-away
// SQLite database in a temporary directory — never against production data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { openDb, schemaVersion, SCHEMA_VERSION } from '../../server/db';
import { OPENAPI } from '../../server/openapi';
import { extractStatements } from '../../src/lib/statements';
import { detectContradictions } from '../../src/lib/detect';
import { makeDoc } from './helpers';

const ORIGIN = 'http://localhost:4173';
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

async function start(dataDir: string, db?: ReturnType<typeof openDb>) {
  const config = { ...loadConfig({}), dataDir, allowRegistration: true, allowedOrigins: [ORIGIN], anthropicApiKey: null };
  const app = createApp({ config, db, ai: null, log: () => {} });
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
  it('migrates a clean database to the current schema version', () => {
    const db = openDb(join(tmp('mg-clean-'), 'medguard.db'));
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['users', 'sessions', 'cases', 'case_members', 'documents', 'statements', 'findings', 'audit_events', 'schema_version']) expect(tables).toContain(t);
    db.close();
  });

  it('upgrades an existing v1 database without losing rows, and re-opening is a no-op', () => {
    const file = join(tmp('mg-upgrade-'), 'medguard.db');
    const v1 = openDb(file, { upTo: 1 });
    expect(schemaVersion(v1)).toBe(1);
    v1.prepare("INSERT INTO users (id, email, display_name, password_hash) VALUES ('usr_upgrade01', 'u@example.test', 'U', 'x')").run();
    v1.prepare("INSERT INTO cases (id, label, owner_id) VALUES ('case_upgrade01', 'Synthetic', 'usr_upgrade01')").run();
    v1.prepare("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_upgrade01', 'case_upgrade01', 'fp1', 'resolved', '{\"title\":\"t\"}')").run();
    v1.prepare("INSERT INTO audit_events (id, case_id, actor_name, kind) VALUES ('ev_upgrade01', 'case_upgrade01', 'System', 'finding_created')").run();
    // v1 rejects the newer outcomes.
    expect(() => v1.prepare("UPDATE findings SET review_status = 'needs_info'").run()).toThrow();
    v1.close();

    const v2 = openDb(file);
    expect(schemaVersion(v2)).toBe(SCHEMA_VERSION);
    expect(v2.prepare("SELECT review_status, data_json FROM findings WHERE id = 'fd_upgrade01'").get()).toEqual({ review_status: 'resolved', data_json: '{"title":"t"}' });
    expect((v2.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number }).n).toBe(1);
    expect((v2.prepare("SELECT archived_at FROM cases WHERE id = 'case_upgrade01'").get() as { archived_at: null }).archived_at).toBeNull();
    v2.prepare("UPDATE findings SET review_status = 'needs_info' WHERE id = 'fd_upgrade01'").run();
    v2.close();
    const again = openDb(file);
    expect((again.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number }).n).toBe(SCHEMA_VERSION);
    again.close();
  });

  it('enforces foreign keys, the status check and the append-only activity log', () => {
    const db = openDb(join(tmp('mg-constraints-'), 'medguard.db'));
    expect(() => db.prepare("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_orphan001', 'case_missing01', 'fp', 'unreviewed', '{}')").run()).toThrow(/FOREIGN KEY/);
    db.prepare("INSERT INTO users (id, email, display_name, password_hash) VALUES ('usr_c0000001', 'c@example.test', 'C', 'x')").run();
    db.prepare("INSERT INTO cases (id, label, owner_id) VALUES ('case_c0000001', 'Synthetic', 'usr_c0000001')").run();
    expect(() => db.prepare("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_c0000001', 'case_c0000001', 'fp', 'approved', '{}')").run()).toThrow(/CHECK/);
    db.prepare("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_c0000001', 'case_c0000001', 'fp', 'unreviewed', '{}')").run();
    expect(() => db.prepare("INSERT INTO findings (id, case_id, fingerprint, review_status, data_json) VALUES ('fd_c0000002', 'case_c0000001', 'fp', 'unreviewed', '{}')").run()).toThrow(/UNIQUE/);
    db.prepare("INSERT INTO audit_events (id, case_id, actor_name, kind) VALUES ('ev_c0000001', 'case_c0000001', 'System', 'case_shared')").run();
    expect(() => db.prepare("UPDATE audit_events SET kind = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/);
    db.close();
  });
});

describe('API: health, readiness and documentation', () => {
  it('reports liveness and readiness; readiness fails with 503 on an unmigrated database', async () => {
    const { app, api } = await start(tmp('mg-health-'));
    expect((await api('/health')).json).toMatchObject({ ok: true, service: 'medguard-api' });
    expect((await api('/api/health')).status).toBe(200);
    const ready = await api('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.json.database).toEqual({ reachable: true, schemaVersion: SCHEMA_VERSION, expectedSchemaVersion: SCHEMA_VERSION });
    expect((await api('/ready')).status).toBe(200);
    expect(JSON.stringify(ready.json)).not.toMatch(/\.db|password|token/i);
    app.close();

    const dir = tmp('mg-notready-');
    const old = await start(dir, openDb(join(dir, 'medguard.db'), { upTo: 1 }));
    const nr = await old.api('/api/ready');
    expect(nr.status).toBe(503);
    expect(nr.json.code).toBe('not_ready');
    old.app.close();
  });

  it('documents exactly the routes the server registers', async () => {
    const { app, api } = await start(tmp('mg-openapi-'));
    const doc = (await api('/api/openapi.json')).json;
    expect(doc.openapi).toBe('3.1.0');
    const norm = (p: string) => p.replace(/\\\//g, '/').replace(/\{[^}]+\}/g, '*').replace(/\(\[\^\/\]\+\)/g, '*');
    const documented = Object.entries(OPENAPI.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${norm(p)}`)).sort();
    const registered = app.routes.map((r) => { const [m, p] = r.split(' '); return `${m} ${norm(p)}`; }).sort();
    expect(documented).toEqual(registered);
    app.close();
  });
});

describe('API: cases, documents, findings, evidence, reviews and activity', () => {
  const dir = tmp('mg-api-');
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
    s = await start(dir);
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

  it('keeps all data after the server restarts on the same database', async () => {
    const before = (await s.api(`/api/cases/${caseId}`, { token: owner })).json;
    s.app.close();
    s = await start(dir); // new process-equivalent: new server and a fresh database connection
    const login = await s.api('/api/auth/login', { body: { email: 'owner@example.test', password: 'correct-horse-battery' } });
    expect(login.status).toBe(200);
    owner = login.json.token;
    const after = (await s.api(`/api/cases/${caseId}`, { token: owner })).json;
    expect(after.case.label).toBe('SYN-0001 · renamed');
    expect(after.findings.map((f: any) => [f.id, f.reviewStatus]).sort()).toEqual(before.findings.map((f: any) => [f.id, f.reviewStatus]).sort());
    expect(after.events.length).toBe(before.events.length);
    expect(after.documents.map((d: any) => d.id).sort()).toEqual(['doc_backendA01', 'doc_backendB01']);
  });
});
