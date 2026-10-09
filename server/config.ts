// Server configuration from environment variables. Secrets are read here only
// and never sent to clients or written to logs.
export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.CLINISCOPE_DATA_DIR ?? './data',
    allowedOrigins: (env.CLINISCOPE_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
      .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
    allowRegistration: (env.CLINISCOPE_ALLOW_REGISTRATION ?? 'false') === 'true',
    sessionTtlHours: Number(env.CLINISCOPE_SESSION_TTL_HOURS ?? 8),
    maxUploadBytes: Number(env.CLINISCOPE_MAX_UPLOAD_MB ?? 10) * 1048576,
    maxJsonBytes: 25 * 1048576,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    // Explicit default so an unrelated ANTHROPIC_BASE_URL in the host environment is never picked up implicitly.
    anthropicBaseUrl: env.CLINISCOPE_ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
    aiModel: env.CLINISCOPE_AI_MODEL?.trim() || 'claude-opus-5-5',
    aiTimeoutMs: Number(env.CLINISCOPE_AI_TIMEOUT_MS ?? 120000),
    aiFallbacks: (env.CLINISCOPE_AI_FALLBACKS ?? 'true') === 'true',
  };
}
