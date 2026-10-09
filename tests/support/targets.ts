// Where write-capable tests may send requests. Imported by every script and spec that registers
// accounts, creates cases, uploads documents or changes memberships, so none of them can reach
// production, whatever the environment says.
//
// Rules (fail closed):
//   - no target configured  → error (never a silent fallback to a deployed API);
//   - a production origin    → always refused, with no override;
//   - a loopback address     → allowed (a throw-away server started by the test run itself);
//   - any other origin       → refused unless MEDGUARD_APPROVED_TEST_API names exactly that origin
//                              (reserved for a dedicated, isolated test deployment).

/** Origins of the production deployment. Write-capable tests never run against these. */
export const PRODUCTION_ORIGINS: readonly string[] = [
  'https://medguard-api-duti.onrender.com',
  'https://medguard-sigma.vercel.app',
  'https://anirudhleetcode-max.github.io',
];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

type Env = Record<string, string | undefined>;

export class UnsafeTargetError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsafeTargetError'; }
}

/** Lower-cased origin of a URL, or null when it is not an http(s) URL. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin.toLowerCase() : null;
  } catch { return null; }
}

export function isLoopback(url: string): boolean {
  try { return LOOPBACK_HOSTS.has(new URL(url.trim()).hostname.toLowerCase()); } catch { return false; }
}

/** True for a production host over any scheme or port (an http:// variant is still production). */
export function isProduction(url: string): boolean {
  let host: string;
  try { host = new URL(url.trim()).hostname.toLowerCase(); } catch { return false; }
  return PRODUCTION_ORIGINS.some((o) => new URL(o).hostname === host);
}

/**
 * Returns the normalized API base URL (no trailing slash) a write-capable test may use, or throws.
 * The error names the rule, never a credential: URLs here carry no secrets by construction.
 */
export function assertWritableApi(url: string | undefined, env: Env = process.env): string {
  const raw = (url ?? '').trim();
  if (!raw) throw new UnsafeTargetError('No test API is configured. Write-capable tests never fall back to a deployed API; start a local server or set an approved test API.');
  const origin = originOf(raw);
  if (!origin) throw new UnsafeTargetError('The test API must be an http(s) URL.');
  if (isProduction(raw)) throw new UnsafeTargetError(`Refusing to write test data to production (${origin}). Write-capable tests run only against an isolated test server.`);
  if (isLoopback(raw)) return raw.replace(/\/+$/, '');
  const approved = originOf(env.MEDGUARD_APPROVED_TEST_API ?? '');
  if (approved && approved === origin) return raw.replace(/\/+$/, '');
  throw new UnsafeTargetError(`Refusing to write test data to ${origin}: it is not a loopback server and MEDGUARD_APPROVED_TEST_API does not name it.`);
}

/**
 * API base URL for a browser spec that writes through the API.
 * - `configured` (e.g. API_URL) wins when set; otherwise `localDefault` (a server Playwright starts).
 * - Empty result → the spec skips, unless MEDGUARD_REQUIRE_API=1 (CI jobs that must run it), then it throws.
 * - Any non-empty target goes through assertWritableApi.
 */
export function e2eWriteApi(configured: string | undefined, localDefault: string, env: Env = process.env): string {
  const url = (configured ?? '').trim() || localDefault;
  if (!url) {
    if (env.MEDGUARD_REQUIRE_API === '1') throw new UnsafeTargetError('MEDGUARD_REQUIRE_API=1 but no test API is configured; these tests must not be skipped silently.');
    return '';
  }
  return assertWritableApi(url, env);
}

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** fetch() that refuses, before any network call, every method that could change server state. */
export function readOnlyFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (!READ_ONLY_METHODS.has(method)) return Promise.reject(new UnsafeTargetError(`Read-only checks may not send ${method} requests.`));
  if (init.body !== undefined && init.body !== null) return Promise.reject(new UnsafeTargetError('Read-only checks may not send a request body.'));
  return fetch(url, init);
}
