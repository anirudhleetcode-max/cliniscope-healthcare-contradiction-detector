import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app';
import { openDb } from '../../server/db';
import { newDatabase } from './testDb';
import { loadConfig } from '../../server/config';
import { AnthropicProvider, AiProviderError, type AiProvider } from '../../server/aiProvider';
import { detectContradictions } from '../../src/lib/detect';
import { loadDemoDocs } from './helpers';
import { terminateOcr } from './nodeOcr';
import type { AiOutput } from '../../src/lib/ai';

const ORIGIN = 'http://localhost:4173';
let base = '';
let app: Awaited<ReturnType<typeof createApp>>;
let aiBehaviour: 'ok' | 'malformed' | 'fail' = 'ok';
let aiPayload: unknown = null;

const mockAi: AiProvider = {
  name: 'mock', model: 'mock-model',
  async analyze() {
    if (aiBehaviour === 'fail') throw new AiProviderError('rate_limited', 'rate limited', 429);
    if (aiBehaviour === 'malformed') return { nope: true };
    return aiPayload;
  },
};

async function api(path: string, opts: { method?: string; token?: string; body?: unknown; raw?: Buffer; origin?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body || opts.raw ? 'POST' : 'GET'),
    headers: {
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.origin ? { Origin: opts.origin } : {}),
    },
    body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

async function register(email: string, name: string) {
  const r = await api('/api/auth/register', { body: { email, password: 'correct-horse-battery', displayName: name } });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

beforeAll(async () => {
  const config = { ...loadConfig({}), allowRegistration: true, allowedOrigins: [ORIGIN], anthropicApiKey: null };
  app = await createApp({ config, db: await openDb(await newDatabase()), ai: mockAi, log: () => {} });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await terminateOcr(); });

describe('shared workspace API: authentication', () => {
  it('reports health and AI configuration without secrets', async () => {
    const r = await api('/api/health');
    expect(r.json).toMatchObject({ ok: true, ai: { configured: true, provider: 'mock' }, registration: true });
    expect(JSON.stringify(r.json)).not.toMatch(/key/i);
  });

  it('registers, signs in, rejects bad credentials, missing/invalid/expired sessions, and signs out', async () => {
    const token = await register('dana@example.test', 'Dana Reviewer');
    expect((await api('/api/auth/me', { token })).json.user.email).toBe('dana@example.test');
    expect((await api('/api/auth/register', { body: { email: 'dana@example.test', password: 'correct-horse-battery', displayName: 'X' } })).status).toBe(409);
    expect((await api('/api/auth/login', { body: { email: 'dana@example.test', password: 'wrong-password-123' } })).status).toBe(401);
    const login = await api('/api/auth/login', { body: { email: 'DANA@example.test', password: 'correct-horse-battery' } });
    expect(login.status).toBe(200);
    expect((await api('/api/cases')).status).toBe(401);
    expect((await api('/api/cases', { token: 'forged-token' })).status).toBe(401);
    // Expire the session in the database → rejected with a clear message.
    await app.db.run("UPDATE sessions SET expires_at = '2000-01-01T00:00:00Z'");
    const expired = await api('/api/auth/me', { token });
    expect(expired.status).toBe(401);
    expect(expired.json.error).toMatch(/expired/);
    const t2 = (await api('/api/auth/login', { body: { email: 'dana@example.test', password: 'correct-horse-battery' } })).json.token;
    expect((await api('/api/auth/logout', { token: t2, method: 'POST' })).status).toBe(200);
    expect((await api('/api/auth/me', { token: t2 })).status).toBe(401);
    // Passwords are stored as scrypt hashes, never in plain text.
    const row = (await app.db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'dana@example.test'"))!;
    expect(row.password_hash).toMatch(/^scrypt\$/);
  });

  it('enforces CORS allow-list and request size limits', async () => {
    const bad = await api('/api/health', { origin: 'https://evil.example' });
    expect(bad.status).toBe(403);
    const ok = await api('/api/health', { origin: ORIGIN });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    // Exact origin match only: another scheme, port or a look-alike host is refused.
    for (const o of ['https://localhost:4173', 'http://localhost:4174', 'http://localhost:4173.evil.example']) expect((await api('/api/health', { origin: o })).status).toBe(403);
    // Preflight for every method the API uses, including PATCH (case rename/archive).
    const pre = await fetch(base + '/api/cases/case_x', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PATCH' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('PATCH');
    const big = await api('/api/auth/login', { raw: Buffer.alloc(26 * 1048576, 32) });
    expect(big.status).toBe(413);
    expect((await api('/api/auth/login', { raw: Buffer.from('{not json') })).status).toBe(400);
  });
});

describe('shared workspace API: cases, permissions and two-user review', () => {
  let alice = '', bob = '', carol = '', mallory = '';
  let caseId = '';
  let findings: any[] = [];

  beforeAll(async () => {
    alice = await register('alice@example.test', 'Alice Owner');
    bob = await register('bob@example.test', 'Bob Reviewer');
    carol = await register('carol@example.test', 'Carol Viewer');
    mallory = await register('mallory@example.test', 'Mallory Outsider');
  });

  it('creates a case owned by the creator; non-members cannot see it', async () => {
    const r = await api('/api/cases', { token: alice, body: { label: 'SHARED-0042 · synthetic' } });
    expect(r.status).toBe(200);
    caseId = r.json.case.id;
    expect(r.json.role).toBe('owner');
    expect((await api(`/api/cases/${caseId}`, { token: mallory })).status).toBe(404);
    expect((await api('/api/cases', { token: mallory })).json.cases).toHaveLength(0);
  });

  it('only the owner can add collaborators; unknown emails are rejected', async () => {
    expect((await api(`/api/cases/${caseId}/members`, { token: bob, body: { email: 'bob@example.test', role: 'reviewer' } })).status).toBe(404);
    expect((await api(`/api/cases/${caseId}/members`, { token: alice, body: { email: 'nobody@example.test', role: 'reviewer' } })).status).toBe(404);
    expect((await api(`/api/cases/${caseId}/members`, { token: alice, body: { email: 'bob@example.test', role: 'reviewer' } })).status).toBe(200);
    const r = await api(`/api/cases/${caseId}/members`, { token: alice, body: { email: 'carol@example.test', role: 'viewer' } });
    expect(r.json.members.map((m: any) => m.role)).toEqual(['owner', 'reviewer', 'viewer']);
    expect((await api(`/api/cases/${caseId}/members`, { token: bob, body: { email: 'mallory@example.test', role: 'viewer' } })).status).toBe(403);
  });

  it('accepts a verified analysis snapshot and rejects tampered evidence', async () => {
    const { docs, statements } = await loadDemoDocs(caseId);
    const ids = new Map(docs.map((d, i) => [d.id, `doc_shared${i}abcdef`]));
    const sdocs = docs.map((d) => ({ ...d, id: ids.get(d.id)! }));
    const sstmts = statements.map((s) => ({ ...s, documentId: ids.get(s.documentId)! }));
    const det = detectContradictions(caseId, sstmts, sdocs);
    const sfind = det.findings.map((f, i) => ({ ...f, id: `fd_local${i}abcdef`, reviewStatus: 'resolved', stale: false, createdAt: '', updatedAt: '' }));
    const tampered = sfind.map((f, i) => (i === 0 ? { ...f, evidence: [{ ...f.evidence[0], quote: 'Patient is allergic to everything.' }] } : f));
    expect((await api(`/api/cases/${caseId}/snapshot`, { method: 'PUT', token: alice, body: { documents: sdocs, statements: sstmts, findings: tampered } })).status).toBe(422);
    expect((await api(`/api/cases/${caseId}/snapshot`, { method: 'PUT', token: carol, body: { documents: sdocs, statements: sstmts, findings: sfind } })).status).toBe(403);
    const ok = await api(`/api/cases/${caseId}/snapshot`, { method: 'PUT', token: alice, body: { documents: sdocs, statements: sstmts, findings: sfind, analyzed: true } });
    expect(ok.status).toBe(200);
    findings = ok.json.findings;
    expect(findings).toHaveLength(10);
    // Client-supplied review status is ignored: everything starts unreviewed.
    expect(findings.every((f) => f.reviewStatus === 'unreviewed')).toBe(true);
    // Re-syncing the same snapshot is idempotent.
    const again = await api(`/api/cases/${caseId}/snapshot`, { method: 'PUT', token: bob, body: { documents: sdocs, statements: sstmts, findings: sfind } });
    expect(again.json.findings.map((f: any) => f.id).sort()).toEqual(findings.map((f) => f.id).sort());
  }, 60000);

  it('User A records a decision; User B sees the same state and audit trail', async () => {
    const pen = findings.find((f) => f.concept === 'allergy:penicillin');
    expect((await api(`/api/findings/${pen.id}/transition`, { token: alice, body: { to: 'resolved', reason: 'skip ahead' } })).status).toBe(422);
    expect((await api(`/api/findings/${pen.id}/transition`, { token: alice, body: { to: 'in_review', expectedStatus: 'unreviewed' } })).status).toBe(200);
    expect((await api(`/api/findings/${pen.id}/notes`, { token: alice, body: { note: 'Called the patient: confirms hives with penicillin in 2019.' } })).status).toBe(200);
    expect((await api(`/api/findings/${pen.id}/transition`, { token: alice, body: { to: 'resolved', reason: '' } })).status).toBe(422);
    // Unknown statuses are rejected; outcomes that close or leave a finding undetermined still need a reason.
    for (const to of ['approved', 'deleted', '']) {
      expect((await api(`/api/findings/${pen.id}/transition`, { token: alice, body: { to, reason: 'Not a real outcome.' } })).status).toBe(422);
    }
    for (const to of ['expected_change', 'undetermined']) {
      expect((await api(`/api/findings/${pen.id}/transition`, { token: alice, body: { to } })).status).toBe(422);
    }
    expect((await api(`/api/findings/${pen.id}/transition`, { token: alice, body: { to: 'confirmed', reason: 'Records genuinely disagree.' } })).status).toBe(200);
    // Bob acting on a stale view gets a conflict instead of silently overwriting.
    const stale = await api(`/api/findings/${pen.id}/transition`, { token: bob, body: { to: 'dismissed', reason: 'Looks fine to me', expectedStatus: 'in_review' } });
    expect(stale.status).toBe(409);
    const bobView = await api(`/api/cases/${caseId}`, { token: bob });
    expect(bobView.json.findings.find((f: any) => f.id === pen.id).reviewStatus).toBe('confirmed');
    const trail = bobView.json.events.filter((e: any) => e.findingId === pen.id);
    expect(trail.map((e: any) => e.kind)).toEqual(['finding_created', 'status_changed', 'note_added', 'status_changed']);
    expect(trail[3]).toMatchObject({ fromStatus: 'in_review', toStatus: 'confirmed', reason: 'Records genuinely disagree.' });
    expect(trail[3].actor).toContain('Alice Owner');
    // Bob (reviewer) can resolve; Carol (viewer) can read but not act.
    expect((await api(`/api/findings/${pen.id}/transition`, { token: bob, body: { to: 'resolved', reason: 'Intake form corrected after verification.', expectedStatus: 'confirmed' } })).status).toBe(200);
    expect((await api(`/api/cases/${caseId}`, { token: carol })).json.findings.find((f: any) => f.id === pen.id).reviewStatus).toBe('resolved');
    expect((await api(`/api/findings/${pen.id}/transition`, { token: carol, body: { to: 'in_review', reason: 'reopen please' } })).status).toBe(403);
    expect((await api(`/api/findings/${pen.id}/notes`, { token: carol, body: { note: 'hi' } })).status).toBe(403);
    expect((await api(`/api/findings/${pen.id}/transition`, { token: mallory, body: { to: 'in_review', reason: 'reopen please' } })).status).toBe(404);
  });

  it('the audit log is append-only at the database level', async () => {
    await expect(app.db.run("UPDATE audit_events SET reason = 'rewritten'")).rejects.toThrow(/append-only/);
    await expect(app.db.run('DELETE FROM audit_events')).rejects.toThrow(/append-only/);
  });

  it('stores original files privately: members only, no path traversal', async () => {
    const docId = (await api(`/api/cases/${caseId}`, { token: alice })).json.documents[0].id;
    expect((await api(`/api/cases/${caseId}/documents/${docId}/file`, { method: 'PUT', token: alice, raw: Buffer.from('%PDF-1.4 synthetic') })).status).toBe(200);
    const got = await fetch(`${base}/api/cases/${caseId}/documents/${docId}/file`, { headers: { Authorization: `Bearer ${bob}` } });
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).toString()).toBe('%PDF-1.4 synthetic');
    expect((await api(`/api/cases/${caseId}/documents/${docId}/file`, { token: mallory })).status).toBe(404);
    expect((await api(`/api/cases/${caseId}/documents/..%2F..%2Fmedguard.db/file`, { token: alice })).status).toBe(404);
  });
});

describe('AI endpoint (mock provider for error paths; real verification logic)', () => {
  let token = '';
  const doc = { id: 'doc_aiabcdef1', caseId: 'case_localabc123', title: 'Note A', documentType: 'clinical_note', documentDate: '2026-03-12', extractedText: 'Allergies: Penicillin allergy documented.', pageSpans: [], fileKind: 'txt', extractionMethod: 'plain-text' };
  const doc2 = { ...doc, id: 'doc_aiabcdef2', title: 'Note B', documentDate: '2026-03-15', extractedText: 'Allergies: No known drug allergies.' };
  beforeAll(async () => { token = await register('ai-user@example.test', 'AI User'); });

  it('requires authentication', async () => {
    expect((await api('/api/ai/analyze', { body: { caseId: doc.caseId, documents: [doc], existing: [] } })).status).toBe(401);
  });

  it('returns validated output and reports rejected (fabricated) evidence', async () => {
    aiBehaviour = 'ok';
    aiPayload = {
      findings: [
        { title: 'Allergy conflict', category: 'explicit_conflict', clinical_topic: 'allergy', explanation: 'x', reason_for_human_review: 'y', uncertainty: '', relevant_dates: ['2026-03-12', '1999-01-01'],
          evidence: [{ document_id: doc.id, side: 'A', quote: 'Penicillin allergy documented.' }, { document_id: doc2.id, side: 'B', quote: 'No known drug allergies.' }] },
        { title: 'Invented', category: 'potential_discrepancy', clinical_topic: 'medication', explanation: 'x', reason_for_human_review: 'y', uncertainty: '', relevant_dates: [],
          evidence: [{ document_id: doc.id, side: 'A', quote: 'Warfarin 5 mg daily.' }] },
      ],
    } satisfies AiOutput;
    const r = await api('/api/ai/analyze', { token, body: { caseId: doc.caseId, documents: [doc, doc2], existing: [] } });
    expect(r.status).toBe(200);
    expect(r.json.summary.accepted).toBe(1);
    expect(r.json.summary.rejected[0].reason).toMatch(/No quotation could be verified/);
  });

  it('maps malformed output and provider errors to safe responses', async () => {
    aiBehaviour = 'malformed';
    expect((await api('/api/ai/analyze', { token, body: { caseId: doc.caseId, documents: [doc], existing: [] } })).status).toBe(502);
    aiBehaviour = 'fail';
    const r = await api('/api/ai/analyze', { token, body: { caseId: doc.caseId, documents: [doc], existing: [] } });
    expect(r.status).toBe(429);
    expect(r.json.code).toBe('rate_limited');
  });
});

describe('Anthropic provider adapter against a local fake Messages API (real SDK, no network)', () => {
  let fake: Server;
  let fakeUrl = '';
  let mode: 'ok' | '401' | '429' | '529' | 'hang' | 'garbage' | 'refusal' = 'ok';
  const seen: any[] = [];
  beforeAll(async () => {
    fake = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
        const err = (status: number, type: string) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type, message: 'synthetic' } })); };
        if (mode === '401') return err(401, 'authentication_error');
        if (mode === '429') return err(429, 'rate_limit_error');
        if (mode === '529') return err(529, 'overloaded_error');
        if (mode === 'hang') return; // never answers → client timeout
        const text = mode === 'garbage' ? 'not json at all' : JSON.stringify({ findings: [] });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
          content: [{ type: 'text', text }], stop_reason: mode === 'refusal' ? 'refusal' : 'end_turn', stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }));
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  });
  afterAll(() => fake.close());
  const provider = (timeout = 5000) => new AnthropicProvider({ anthropicApiKey: 'sk-test-not-a-real-key', anthropicBaseUrl: fakeUrl, aiModel: 'claude-opus-5-5', aiTimeoutMs: timeout, aiFallbacks: true });
  const docs = [{ id: 'doc_x1', title: 'A', documentType: 'other', documentDate: null, text: 'Hypertension.' }];

  it('sends a structured-output request with the key only in headers and parses the result', async () => {
    mode = 'ok';
    const out = await provider().analyze(docs, []);
    expect(out).toEqual({ findings: [] });
    const req = seen.at(-1);
    expect(req.url).toMatch(/\/v1\/messages/);
    expect(req.headers['x-api-key']).toBe('sk-test-not-a-real-key');
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body.output_config.format.type).toBe('json_schema');
    expect(req.body.fallbacks).toBe('default');
    expect(JSON.stringify(req.body)).not.toContain('sk-test');
  });

  it.each([
    ['401', 'provider_auth'], ['429', 'rate_limited'], ['529', 'unavailable'], ['garbage', 'malformed_output'], ['refusal', 'refused'],
  ] as const)('maps %s to %s', async (m, code) => {
    mode = m;
    await expect(provider().analyze(docs, [])).rejects.toMatchObject({ code });
  }, 20000);

  it('maps a hung provider to a timeout', async () => {
    mode = 'hang';
    await expect(provider(400).analyze(docs, [])).rejects.toMatchObject({ code: 'timeout' });
  }, 20000);
});
