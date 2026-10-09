// Read-only smoke checks of a deployed MEDGUARD API (safe for production).
//   node --import tsx tests/live/smoke-readonly.mts <apiUrl> [allowedOrigin ...]
// Every request goes through readOnlyFetch, which refuses any method other than GET/HEAD/OPTIONS
// and any request body, so this script cannot create accounts, sessions, cases or files.
// Output: checks and status codes only (no tokens, no record contents).
import { readOnlyFetch } from '../support/targets';

const [rawApi, ...origins] = process.argv.slice(2);
const API = (rawApi ?? '').trim().replace(/\/+$/, '');
if (!/^https?:\/\//.test(API)) { console.error('usage: smoke-readonly.mts <api-url> [allowed-origin ...]'); process.exit(2); }

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };
const get = async (path: string, headers: Record<string, string> = {}) => {
  const r = await readOnlyFetch(API + path, { headers, signal: AbortSignal.timeout(180_000) });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
};

const health = await get('/api/health');
check('GET /api/health → 200', health.status === 200, `version ${health.json?.version}`);
const ready = await get('/api/ready');
const db = ready.json?.database ?? {};
check('GET /api/ready → 200, PostgreSQL reachable', ready.status === 200 && db.reachable === true && db.engine === 'postgresql');
check('database storage is external (DATABASE_URL)', db.storage === 'external');
check('schema at the expected version', db.schemaVersion === db.expectedSchemaVersion, `v${db.schemaVersion} of v${db.expectedSchemaVersion}`);
check('health/ready expose no secrets', !/postgres(ql)?:\/\/|password|sk-ant|secret/i.test(health.text + ready.text));
check('GET / → 200 service description', (await get('/')).status === 200);
check('unknown path → 404', (await get('/no-such-path')).status === 404);

for (const path of ['/api/overview', '/api/cases', '/api/activity', '/api/auth/me']) {
  check(`${path} without a session → 401`, (await get(path)).status === 401);
  check(`${path} with an invalid token → 401`, (await get(path, { authorization: 'Bearer invalid-read-only-probe' })).status === 401);
}

for (const origin of origins) {
  const pre = await readOnlyFetch(API + '/api/cases', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  check(`CORS preflight from ${origin} allowed`, pre.status === 204 && pre.headers.get('access-control-allow-origin') === origin, String(pre.status));
}
const evil = await readOnlyFetch(API + '/api/cases', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
check('CORS preflight from an unknown origin refused', evil.headers.get('access-control-allow-origin') === null, String(evil.status));

console.log(failures ? `${failures} check(s) failed` : 'All read-only checks passed');
process.exit(failures ? 1 : 0);
