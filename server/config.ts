// Server configuration from environment variables. Secrets are read here only
// and never sent to clients or written to logs.
export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  /** postgres:// URL of an external PostgreSQL database (secret). Null = embedded database in dataDir. */
  databaseUrl: string | null;
  /** Refuse to start without databaseUrl (set on hosts whose local disk is wiped on restart). */
  requireDatabaseUrl: boolean;
  allowedOrigins: string[];
  allowRegistration: boolean;
  sessionTtlHours: number;
  maxUploadBytes: number;
  maxJsonBytes: number;
  anthropicApiKey: string | null;
  anthropicBaseUrl: string;
  aiModel: string;
  aiTimeoutMs: number;
  aiFallbacks: boolean;
  /** Google sign-in (OpenID Connect, authorization code + PKCE). Enabled only when all three are set. */
  google: { clientId: string; clientSecret: string; callbackUrl: string; authUrl: string; tokenUrl: string; jwksUrl: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.MEDGUARD_DATA_DIR ?? './data',
    databaseUrl: env.DATABASE_URL?.trim() || null,
    requireDatabaseUrl: (env.MEDGUARD_REQUIRE_DATABASE_URL ?? 'false') === 'true',
    allowedOrigins: (env.MEDGUARD_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
      .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
    allowRegistration: (env.MEDGUARD_ALLOW_REGISTRATION ?? 'false') === 'true',
    sessionTtlHours: Number(env.MEDGUARD_SESSION_TTL_HOURS ?? 8),
    maxUploadBytes: Number(env.MEDGUARD_MAX_UPLOAD_MB ?? 10) * 1048576,
    maxJsonBytes: 25 * 1048576,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    // Explicit default so an unrelated ANTHROPIC_BASE_URL in the host environment is never picked up implicitly.
    anthropicBaseUrl: env.MEDGUARD_ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
    aiModel: env.MEDGUARD_AI_MODEL?.trim() || 'claude-opus-5-5',
    aiTimeoutMs: Number(env.MEDGUARD_AI_TIMEOUT_MS ?? 120000),
    aiFallbacks: (env.MEDGUARD_AI_FALLBACKS ?? 'true') === 'true',
    google: env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim() && env.GOOGLE_CALLBACK_URL?.trim()
      ? {
        clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET.trim(), callbackUrl: env.GOOGLE_CALLBACK_URL.trim(),
        // Endpoint overrides exist for tests against a local fake provider; production uses Google's defaults.
        authUrl: env.MEDGUARD_GOOGLE_AUTH_URL?.trim() || 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: env.MEDGUARD_GOOGLE_TOKEN_URL?.trim() || 'https://oauth2.googleapis.com/token',
        jwksUrl: env.MEDGUARD_GOOGLE_JWKS_URL?.trim() || 'https://www.googleapis.com/oauth2/v3/certs',
      }
      : null,
  };
}
