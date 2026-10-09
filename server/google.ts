// Google sign-in: OpenID Connect authorization-code flow with PKCE, state and nonce.
// The ID token is verified here (RS256 signature against Google's published keys, issuer,
// audience, expiry, nonce, verified email) before any account decision is made.
import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const b64url = (b: Buffer) => b.toString('base64url');
export const randomToken = () => b64url(randomBytes(32));
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

export class GoogleAuthError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface GoogleIdentity { sub: string; email: string; name: string | null }

let jwksCache: { url: string; keys: (JsonWebKey & { kid?: string })[]; at: number } | null = null;

async function jwks(url: string, refresh = false) {
  if (!refresh && jwksCache && jwksCache.url === url && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new GoogleAuthError('jwks_unavailable', 'Google signing keys could not be fetched.');
  const keys = ((await r.json()) as { keys?: (JsonWebKey & { kid?: string })[] }).keys ?? [];
  jwksCache = { url, keys, at: Date.now() };
  return keys;
}

/** Verifies a Google ID token and returns the identity it asserts. Throws GoogleAuthError otherwise. */
export async function verifyGoogleIdToken(idToken: string, opts: { clientId: string; nonce: string; jwksUrl: string; now?: number }): Promise<GoogleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new GoogleAuthError('invalid_token', 'Malformed ID token.');
  let header: { alg?: string; kid?: string }; let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new GoogleAuthError('invalid_token', 'Malformed ID token.'); }
  if (header.alg !== 'RS256' || !header.kid) throw new GoogleAuthError('invalid_token', 'Unexpected ID token algorithm.');
  let key = (await jwks(opts.jwksUrl)).find((k) => k.kid === header.kid);
  if (!key) key = (await jwks(opts.jwksUrl, true)).find((k) => k.kid === header.kid); // keys rotate
  if (!key) throw new GoogleAuthError('invalid_token', 'ID token signed with an unknown key.');
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new GoogleAuthError('invalid_token', 'ID token signature is invalid.');
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) throw new GoogleAuthError('invalid_token', 'ID token issuer is not Google.');
  const aud = claims.aud;
  if (!(aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId)))) throw new GoogleAuthError('invalid_token', 'ID token was issued for a different application.');
  if (typeof claims.exp !== 'number' || claims.exp + 60 < now) throw new GoogleAuthError('invalid_token', 'ID token has expired.');
  if (typeof claims.iat === 'number' && claims.iat - 300 > now) throw new GoogleAuthError('invalid_token', 'ID token is not valid yet.');
  if (claims.nonce !== opts.nonce) throw new GoogleAuthError('invalid_token', 'ID token nonce does not match this sign-in.');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new GoogleAuthError('invalid_token', 'ID token has no subject.');
  if (claims.email_verified !== true || typeof claims.email !== 'string') throw new GoogleAuthError('email_unverified', 'Your Google account email is not verified.');
  return { sub: claims.sub, email: claims.email.trim().toLowerCase(), name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 80) || null : null };
}
