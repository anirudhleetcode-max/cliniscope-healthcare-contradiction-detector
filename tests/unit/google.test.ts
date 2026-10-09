// Google sign-in against a local fake provider: real RS256 signatures, real token-endpoint calls.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createApp } from '../../server/app';
import { openDb } from '../../server/db';
import { loadConfig } from '../../server/config';
import { newDatabase } from './testDb';

const ORIGIN = 'http://localhost:4173';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
let app: Awaited<ReturnType<typeof createApp>>;
let base = '';
let google: Server;
let gbase = '';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

// What the fake token endpoint returns next: a function of the nonce Google would echo back.
let tokenResponse: (nonce: string, code: string) => { status: number; body: unknown } = () => ({ status: 500, body: {} });
let lastNonce = '';
let tokenRequests: URLSearchParams[] = [];

function idToken(claims: Record<string, unknown>, key: KeyObject = privateKey, kid = 'k1') {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}
const now = () => Math.floor(Date.now() / 1000);
const goodClaims = (nonce: string, over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'g-sub-1', email: 'gina@example.test', email_verified: true,
  name: 'Gina Google', iat: now(), exp: now() + 600, nonce, ...over,
});

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'), redirect: 'manual',
    headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

/** Runs start → (fake Google) → callback and returns the parameters MedGuard put in the redirect fragment. */
async function signInWithGoogle(claims: (nonce: string) => Record<string, unknown>, opts: { token?: string; link?: boolean; query?: (state: string) => string } = {}) {
  const s = await api('/api/auth/google/start', { body: { returnTo: `${ORIGIN}/`, ...(opts.link ? { link: true } : {}) }, token: opts.token });
  expect(s.status).toBe(200);
  const u = new URL(s.json.url);
  const state = u.searchParams.get('state')!;
  lastNonce = u.searchParams.get('nonce')!;
  tokenResponse = (n) => ({ status: 200, body: { id_token: idToken(claims(n)) } });
  const cb = await api(`/api/auth/google/callback?${opts.query ? opts.query(state) : `code=auth-code-1&state=${encodeURIComponent(state)}`}`);
  expect(cb.status).toBe(302);
  const loc = cb.headers.get('location')!;
  expect(loc.startsWith(`${ORIGIN}/#/auth/google?`)).toBe(true);
  return new URLSearchParams(loc.split('#/auth/google?')[1]);
}

beforeAll(async () => {
  google = createServer(async (req, res) => {
    if (req.url === '/jwks') { res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] })); return; }
    if (req.url === '/token') {
      let body = ''; for await (const ch of req) body += ch;
      tokenRequests.push(new URLSearchParams(body));
      const params = new URLSearchParams(body);
      const r = tokenResponse(lastNonce, params.get('code') ?? '');
      res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.body)); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => google.listen(0, '127.0.0.1', () => r()));
  gbase = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
  const config = {
    ...loadConfig({}), allowRegistration: true, allowedOrigins: [ORIGIN], anthropicApiKey: null,
    google: { clientId: CLIENT_ID, clientSecret: 'test-secret', callbackUrl: 'http://api.test/api/auth/google/callback', authUrl: `${gbase}/auth`, tokenUrl: `${gbase}/token`, jwksUrl: `${gbase}/jwks` },
  };
  app = await createApp({ config, db: await openDb(await newDatabase()), log: () => {} });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await new Promise<void>((r) => google.close(() => r())); });

describe('Google sign-in', () => {
  it('is reported as configured and starts with state, nonce, PKCE and minimal scopes', async () => {
    expect((await api('/api/health')).json.googleSignIn).toBe(true);
    const s = await api('/api/auth/google/start', { body: { returnTo: `${ORIGIN}/?x=1#/cases` } });
    const u = new URL(s.json.url);
    expect(u.origin + u.pathname).toBe(`${gbase}/auth`);
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')!.length).toBeGreaterThan(30);
    expect(u.searchParams.get('nonce')!.length).toBeGreaterThan(30);
    expect(s.json.url).not.toContain('test-secret');
  });

  it('rejects return addresses outside the allowed frontends, and link requests without a session', async () => {
    expect((await api('/api/auth/google/start', { body: { returnTo: 'https://evil.example/' } })).status).toBe(400);
    expect((await api('/api/auth/google/start', { body: { returnTo: `${ORIGIN}/`, extra: 1 } })).status).toBe(400);
    expect((await api('/api/auth/google/start', { body: { returnTo: `${ORIGIN}/`, link: true } })).status).toBe(401);
  });

  it('rejects an unknown or reused state', async () => {
    expect((await api('/api/auth/google/callback?code=x&state=forged')).status).toBe(400);
    expect((await api('/api/auth/google/callback?code=x')).status).toBe(400);
    const s = await api('/api/auth/google/start', { body: { returnTo: `${ORIGIN}/` } });
    const state = new URL(s.json.url).searchParams.get('state')!;
    tokenResponse = () => ({ status: 400, body: { error: 'invalid_grant' } });
    expect((await api(`/api/auth/google/callback?code=x&state=${state}`)).status).toBe(302);
    expect((await api(`/api/auth/google/callback?code=x&state=${state}`)).status).toBe(400); // single use
  });

  it('maps cancellation and failed code exchange to safe errors', async () => {
    expect((await signInWithGoogle(goodClaims, { query: (st) => `error=access_denied&state=${st}` })).get('error')).toBe('cancelled');
    const s = await api('/api/auth/google/start', { body: { returnTo: `${ORIGIN}/` } });
    tokenResponse = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const cb = await api(`/api/auth/google/callback?code=bad&state=${new URL(s.json.url).searchParams.get('state')}`);
    expect(cb.headers.get('location')).toContain('error=verification_failed');
  });

  it('rejects ID tokens with a wrong audience, issuer, nonce, expiry, signature or unverified email', async () => {
    const bad: Record<string, (n: string) => Record<string, unknown>> = {
      audience: (n) => goodClaims(n, { aud: 'someone-else' }),
      issuer: (n) => goodClaims(n, { iss: 'https://evil.example' }),
      nonce: () => goodClaims('not-the-nonce'),
      expired: (n) => goodClaims(n, { exp: now() - 3600 }),
    };
    for (const [, claims] of Object.entries(bad)) expect((await signInWithGoogle(claims)).get('error')).toBe('verification_failed');
    // Signed with a key Google did not publish.
    const s = await api('/api/auth/google/start', { body: { returnTo: `${ORIGIN}/` } });
    const u = new URL(s.json.url);
    tokenResponse = (n) => ({ status: 200, body: { id_token: idToken(goodClaims(u.searchParams.get('nonce')! || n), other.privateKey) } });
    const cb = await api(`/api/auth/google/callback?code=x&state=${u.searchParams.get('state')}`);
    expect(cb.headers.get('location')).toContain('error=verification_failed');
    expect((await signInWithGoogle((n) => goodClaims(n, { email_verified: false }))).get('error')).toBe('email_unverified');
    // None of these created an account.
    const p = await signInWithGoogle(goodClaims);
    expect(p.get('handoff')).toBeTruthy(); // the first genuine sign-in creates it
  });

  it('creates an account once, signs in again to the same account, and the hand-off code is single use', async () => {
    const claims = (n: string) => goodClaims(n, { sub: 'g-sub-new', email: 'Nina@Example.test', name: 'Nina New' });
    const first = await signInWithGoogle(claims);
    const ex = await api('/api/auth/google/exchange', { body: { handoff: first.get('handoff') } });
    expect(ex.status).toBe(200);
    expect(ex.json.user).toMatchObject({ email: 'nina@example.test', displayName: 'Nina New' });
    expect((await api('/api/auth/google/exchange', { body: { handoff: first.get('handoff') } })).status).toBe(401);
    const me = await api('/api/auth/me', { token: ex.json.token });
    expect(me.json.user.id).toBe(ex.json.user.id);
    const second = await api('/api/auth/google/exchange', { body: { handoff: (await signInWithGoogle(claims)).get('handoff') } });
    expect(second.json.user.id).toBe(ex.json.user.id);
    // Google-only accounts cannot be entered with a password, and the attempt fails cleanly.
    expect((await api('/api/auth/login', { body: { email: 'nina@example.test', password: 'anything-at-all' } })).status).toBe(401);
    // Session works for the rest of the API and logout revokes it.
    expect((await api('/api/overview', { token: ex.json.token })).json.totals.cases).toBe(0);
    await api('/api/auth/logout', { method: 'POST', token: ex.json.token });
    expect((await api('/api/auth/me', { token: ex.json.token })).status).toBe(401);
  });

  it('never takes over an existing password account by email; linking needs both proofs', async () => {
    const reg = await api('/api/auth/register', { body: { email: 'pat@example.test', password: 'correct-horse-battery', displayName: 'Pat Password' } });
    const claims = (n: string) => goodClaims(n, { sub: 'g-sub-pat', email: 'pat@example.test' });
    expect((await signInWithGoogle(claims)).get('error')).toBe('account_exists');
    // Signed in with the password, Pat links the Google account explicitly.
    const linked = await signInWithGoogle(claims, { token: reg.json.token, link: true });
    const ex = await api('/api/auth/google/exchange', { body: { handoff: linked.get('handoff') } });
    expect(ex.json.user.id).toBe(reg.json.user.id);
    // From now on Google signs Pat in; the password still works too.
    const viaGoogle = await api('/api/auth/google/exchange', { body: { handoff: (await signInWithGoogle(claims)).get('handoff') } });
    expect(viaGoogle.json.user.id).toBe(reg.json.user.id);
    expect((await api('/api/auth/login', { body: { email: 'pat@example.test', password: 'correct-horse-battery' } })).status).toBe(200);
    // That Google account cannot be linked to a second MedGuard account.
    const other2 = await api('/api/auth/register', { body: { email: 'quinn@example.test', password: 'correct-horse-battery', displayName: 'Quinn' } });
    expect((await signInWithGoogle(claims, { token: other2.json.token, link: true })).get('error')).toBe('google_in_use');
  });

  it('two concurrent first sign-ins for the same Google account create one user', async () => {
    const claims = (n: string) => goodClaims(n, { sub: 'g-sub-race', email: 'rae@example.test' });
    const starts = await Promise.all([0, 1].map(() => api('/api/auth/google/start', { body: { returnTo: `${ORIGIN}/` } })));
    const flows = starts.map((s) => new URL(s.json.url)).map((u) => ({ state: u.searchParams.get('state')!, nonce: u.searchParams.get('nonce')! }));
    // The fake provider answers each flow from its own code (here: the flow's nonce).
    tokenResponse = (_n, code) => ({ status: 200, body: { id_token: idToken(claims(code)) } });
    const results = await Promise.all(flows.map((f) => api(`/api/auth/google/callback?code=${f.nonce}&state=${f.state}`)));
    const ids = new Set<string>();
    for (const r of results) {
      const h = new URLSearchParams(r.headers.get('location')!.split('?')[1]).get('handoff');
      expect(h).toBeTruthy();
      ids.add((await api('/api/auth/google/exchange', { body: { handoff: h } })).json.user.id);
    }
    expect(ids.size).toBe(1);
    expect(tokenRequests.every((p) => p.get('code_verifier') && p.get('client_secret') === 'test-secret')).toBe(true);
  });
});

describe('Google sign-in when not configured', () => {
  it('reports it as unavailable and refuses the endpoints', async () => {
    const plain = await createApp({ config: { ...loadConfig({}), allowedOrigins: [ORIGIN], google: null }, db: await openDb(await newDatabase()), log: () => {} });
    await new Promise<void>((r) => plain.server.listen(0, '127.0.0.1', () => r()));
    const b = `http://127.0.0.1:${(plain.server.address() as AddressInfo).port}`;
    expect((await (await fetch(`${b}/api/health`)).json()).googleSignIn).toBe(false);
    const r = await fetch(`${b}/api/auth/google/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnTo: `${ORIGIN}/` }) });
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('google_not_configured');
    await plain.close();
  });
});
