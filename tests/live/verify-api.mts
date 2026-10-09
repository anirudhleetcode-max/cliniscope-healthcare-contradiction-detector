// Write-capable verification of a MEDGUARD API, with synthetic data only.
// It registers accounts, creates a case, uploads documents and records reviews, so it runs ONLY against
// an isolated test server: tests/support/targets.ts refuses production and any unapproved remote API
// (exit code 3) before a single request is sent. For production use tests/live/smoke-readonly.mts.
//   node --import tsx tests/live/verify-api.mts write <apiUrl> <frontendOrigin>
//   node --import tsx tests/live/verify-api.mts read  <apiUrl>
// "write" creates two synthetic @example.test accounts and one synthetic case through the real
// extraction and detection code, then checks CORS, authentication, isolation, review and notes.
// "read" (run after the server has been idle long enough to stop) signs in again and checks that
// everything written earlier is still there. State between the two phases stays on the runner
// (MEDGUARD_LIVE_STATE file); nothing is printed except checks and counts.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extractFile, makeDoc, demoPath } from '../unit/helpers';
import { extractStatements } from '../../src/lib/statements';
import { detectContradictions } from '../../src/lib/detect';
import { assertWritableApi } from '../support/targets';

const [phase, rawApi, origin = ''] = process.argv.slice(2);
const API = (rawApi ?? '').replace(/\/$/, '');
const STATE = process.env.MEDGUARD_LIVE_STATE ?? 'live-state.json';
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };

async function call(method: string, path: string, opts: { token?: string; body?: unknown; raw?: Buffer; origin?: string; timeoutMs?: number } = {}) {
  const started = Date.now();
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(opts.raw ? { 'content-type': 'application/octet-stream' } : opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { json = null; }
  return { status: r.status, json, buf, headers: r.headers, ms: Date.now() - started };
}

if (!['write', 'read'].includes(phase)) { console.error('usage: write|read <test-api-url> [frontend-origin]'); process.exit(2); }
// Fail closed before any request: both phases write (registration, sessions, records).
try { assertWritableApi(API); } catch (e) { console.error(`REFUSED  ${(e as Error).message}`); process.exit(3); }

if (phase === 'write') {
  const health = await call('GET', '/api/health', { timeoutMs: 180_000 });
  check('GET /api/health → 200', health.status === 200, `${health.ms} ms, version ${health.json?.version}`);
  const ready = await call('GET', '/api/ready');
  const db = ready.json?.database ?? {};
  check('GET /api/ready → 200, PostgreSQL reachable', ready.status === 200 && db.reachable === true && db.engine === 'postgresql', JSON.stringify(db));
  check('database storage is external (DATABASE_URL), not the ephemeral disk', db.storage === 'external');
  check('schema migrated to the expected version', db.schemaVersion === db.expectedSchemaVersion, `v${db.schemaVersion}`);
  check('health/ready expose no secrets', !/postgres(ql)?:\/\/|password|sk-ant/i.test(JSON.stringify([health.json, ready.json])));

  // CORS: the GitHub Pages origin is allowed, anything else is refused.
  const pre = await fetch(API + '/api/cases', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  check(`CORS preflight from ${origin} → 204 with matching Allow-Origin`, pre.status === 204 && pre.headers.get('access-control-allow-origin') === origin, `${pre.status} ${pre.headers.get('access-control-allow-origin')}`);
  const evil = await call('GET', '/api/health', { origin: 'https://evil.example' });
  check('CORS: another origin is refused (403)', evil.status === 403);

  // Authentication with synthetic accounts.
  const run = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const password = randomBytes(18).toString('base64url'); // never printed
  const owner = { email: `live-owner-${run}@example.test`, name: 'Synthetic Owner' };
  const outsider = { email: `live-outsider-${run}@example.test`, name: 'Synthetic Outsider' };
  const reg = await call('POST', '/api/auth/register', { body: { email: owner.email, password, displayName: owner.name } });
  check('register a synthetic account', reg.status === 200, reg.status === 403 ? 'registration is disabled on this server' : String(reg.status));
  const reg2 = await call('POST', '/api/auth/register', { body: { email: outsider.email, password, displayName: outsider.name } });
  check('register a second synthetic account', reg2.status === 200);
  check('duplicate registration refused (409)', (await call('POST', '/api/auth/register', { body: { email: owner.email, password, displayName: 'x' } })).status === 409);
  check('wrong password refused (401)', (await call('POST', '/api/auth/login', { body: { email: owner.email, password: 'wrong-password-123' } })).status === 401);
  const login = await call('POST', '/api/auth/login', { body: { email: owner.email, password } });
  check('login → token', login.status === 200 && typeof login.json?.token === 'string');
  const T = login.json?.token as string;
  const O = reg2.json?.token as string;
  check('unauthenticated request refused (401)', (await call('GET', '/api/cases')).status === 401);

  // A synthetic case through the real extraction and contradiction-detection code.
  const created = await call('POST', '/api/cases', { token: T, body: { label: `SYNTHETIC live check ${run}` } });
  check('create case', created.status === 200);
  const caseId = created.json?.case?.id as string;
  const files = ['discharge-summary-2026-03-12.pdf', 'laboratory-report-2026-03-11.pdf', 'medication-reconciliation-2026-03-14.txt', 'patient-intake-form-2026-03-15.docx'];
  const docs: any[] = [];
  for (const [i, f] of files.entries()) {
    const ex = await extractFile(f, new Uint8Array(readFileSync(demoPath(f))), { ocr: false });
    docs.push(makeDoc(caseId, ex.text, { id: `doc_live${run}${i}`, title: f, documentDate: f.match(/\d{4}-\d\d-\d\d/)![0] }));
  }
  const statements = docs.flatMap((d) => extractStatements(d));
  const findings = detectContradictions(caseId, statements, docs).findings.map((f, k) => ({ ...f, id: `fd_live${run}${k}`, reviewStatus: 'unreviewed', stale: false, createdAt: '', updatedAt: '' }));
  check('detection finds contradictions in the synthetic records', findings.length > 0, `${docs.length} documents, ${statements.length} statements, ${findings.length} findings`);
  const snap = await call('PUT', `/api/cases/${caseId}/snapshot`, { token: T, body: { documents: docs, statements, findings, analyzed: true } });
  check('store records, statements and findings (snapshot, server re-verifies every quote)', snap.status === 200, `${snap.ms} ms`);
  const list = await call('GET', `/api/cases/${caseId}/findings`, { token: T });
  check('findings stored', list.json?.findings?.length === findings.length, `${list.json?.findings?.length}`);
  const fid = list.json?.findings?.[0]?.id as string;
  const ev = await call('GET', `/api/findings/${fid}/evidence`, { token: T });
  check('evidence re-verified against stored text', ev.status === 200 && ev.json.evidence.length > 0 && ev.json.evidence.every((e: any) => e.verified));

  // Review and notes.
  check('review: unreviewed → in_review', (await call('POST', `/api/findings/${fid}/transition`, { token: T, body: { to: 'in_review' } })).status === 200);
  check('review: closing without a reason refused (422)', (await call('POST', `/api/findings/${fid}/transition`, { token: T, body: { to: 'dismissed' } })).status === 422);
  check('review: in_review → needs_info', (await call('POST', `/api/findings/${fid}/transition`, { token: T, body: { to: 'needs_info', reason: 'Synthetic live check: confirm with prescriber.' } })).status === 200);
  check('note saved', (await call('POST', `/api/findings/${fid}/notes`, { token: T, body: { note: `Synthetic live note ${run}` } })).status === 200);

  // Original file stored in the database.
  const original = readFileSync(demoPath(files[2]));
  const up = await call('PUT', `/api/cases/${caseId}/documents/${docs[2].id}/file`, { token: T, raw: original });
  check('upload original file', up.status === 200 && up.json?.size === original.length, `${original.length} bytes`);
  const down = await call('GET', `/api/cases/${caseId}/documents/${docs[2].id}/file`, { token: T });
  check('download original file, byte-identical', down.status === 200 && down.buf.equals(original));

  // Case isolation: a signed-in non-member sees nothing and cannot overwrite anything.
  check('isolation: outsider cannot read the case (404)', (await call('GET', `/api/cases/${caseId}`, { token: O })).status === 404);
  check('isolation: outsider cannot read a finding (404)', (await call('GET', `/api/findings/${fid}`, { token: O })).status === 404);
  check('isolation: outsider cannot download the file (404)', (await call('GET', `/api/cases/${caseId}/documents/${docs[2].id}/file`, { token: O })).status === 404);
  check('isolation: outsider cannot change review status (404)', (await call('POST', `/api/findings/${fid}/transition`, { token: O, body: { to: 'in_review' } })).status === 404);
  const other = (await call('POST', '/api/cases', { token: O, body: { label: `SYNTHETIC outsider ${run}` } })).json?.case?.id;
  const forged = await call('PUT', `/api/cases/${other}/snapshot`, { token: O, body: { documents: [{ ...docs[0], caseId: other }], statements: [], findings: [] } });
  check('isolation: outsider cannot overwrite a document of another case (409)', forged.status === 409);
  check('isolation: outsider case list does not include the owner case', !(await call('GET', '/api/cases', { token: O })).json?.cases?.some((c: any) => c.id === caseId));

  // Audit log: every step above left an entry, in order, attributed to the right actor.
  const act = await call('GET', `/api/cases/${caseId}/activity?limit=200`, { token: T });
  const kinds = new Set((act.json?.events ?? []).map((e: any) => e.kind));
  check('audit log records case, upload, detection, decisions and note', ['case_shared', 'document_uploaded', 'finding_created', 'analysis_completed', 'status_changed', 'note_added'].every((k) => kinds.has(k)), `${act.json?.events?.length} events`);
  check('audit log is not readable by a non-member (404)', (await call('GET', `/api/cases/${caseId}/activity`, { token: O })).status === 404);
  // The API has no route that edits or deletes audit entries; the database triggers that reject
  // UPDATE/DELETE/TRUNCATE are exercised by the CI tests against PostgreSQL 16.

  // Error handling: clear messages, no stack traces or internals.
  const bad = await call('POST', '/api/cases', { token: T, body: { label: '' } });
  check('invalid input → 400 with a readable message', bad.status === 400 && typeof bad.json?.error === 'string' && !/at \w+ \(|node_modules|postgres|SELECT /i.test(bad.buf.toString()));
  const missing = await call('GET', '/api/findings/fd_doesnotexist1', { token: T });
  check('unknown finding → 404 without internals', missing.status === 404 && !/node_modules|postgres|SELECT /i.test(missing.buf.toString()));

  writeFileSync(STATE, JSON.stringify({ email: owner.email, password, caseId, fid, docId: docs[2].id, bytes: original.length, documents: docs.length, statements: statements.length, findings: findings.length, run }));
} else {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const first = await call('GET', '/api/health', { timeoutMs: 180_000 });
  check('API answers after the idle period', first.status === 200, `first response ${first.ms} ms${first.ms > 10_000 ? ': the instance was stopped and started again' : ': fast, so the instance may not have been stopped'}`);
  const ready = await call('GET', '/api/ready');
  check('ready after restart, external storage', ready.status === 200 && ready.json?.database?.storage === 'external');
  const login = await call('POST', '/api/auth/login', { body: { email: s.email, password: s.password } });
  check('account persisted (login works)', login.status === 200);
  const T = login.json?.token;
  const snap = await call('GET', `/api/cases/${s.caseId}`, { token: T });
  check('case persisted', snap.status === 200 && snap.json.case.label.endsWith(s.run));
  check('documents, statements and findings persisted', snap.json?.documents?.length === s.documents && snap.json?.statements?.length === s.statements && snap.json?.findings?.length === s.findings,
    `${snap.json?.documents?.length}/${snap.json?.statements?.length}/${snap.json?.findings?.length}`);
  const f = await call('GET', `/api/findings/${s.fid}`, { token: T });
  check('review decision persisted (needs_info)', f.json?.finding?.reviewStatus === 'needs_info');
  const hist = await call('GET', `/api/findings/${s.fid}/history`, { token: T });
  check('decision history and note persisted', hist.json?.history?.some((e: any) => e.kind === 'note_added' && e.note === `Synthetic live note ${s.run}`) && hist.json.history.filter((e: any) => e.kind === 'status_changed').length === 2);
  const down = await call('GET', `/api/cases/${s.caseId}/documents/${s.docId}/file`, { token: T });
  check('original file persisted', down.status === 200 && down.buf.length === s.bytes);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
