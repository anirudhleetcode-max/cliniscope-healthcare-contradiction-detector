// PostgreSQL persistence. One SQL dialect, two drivers:
//  - DATABASE_URL set   → node-postgres pool against an external PostgreSQL server (e.g. a free Neon database).
//  - DATABASE_URL unset → PGlite, an embedded PostgreSQL build, stored in MEDGUARD_DATA_DIR/pgdata
//                         (or in memory for tests). Zero-setup local development and CI.
// The schema is migrated on start-up, inside a transaction guarded by an advisory lock so
// several instances starting at once cannot apply the same migration twice.
import { mkdirSync } from 'node:fs';

export type Row = Record<string, unknown>;

/** A connection or transaction that can run parameterised SQL. Placeholders are written as `?`. */
export interface Queryable {
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Runs one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** 'external' = a PostgreSQL server reached through DATABASE_URL; 'embedded' = PGlite on the local disk or in memory. */
  readonly storage: 'external' | 'embedded';
  /** Runs fn in one transaction; every query inside it must use the Queryable it receives. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The database cannot be reached (network, credentials, server restarting). Mapped to HTTP 503. */
export class DbUnavailableError extends Error {
  constructor(public cause?: unknown) { super('Database unavailable'); this.name = 'DbUnavailableError'; }
}
/** A uniqueness constraint was violated, usually by a concurrent request. Mapped to HTTP 409. */
export class DbConflictError extends Error {
  constructor(public cause?: unknown) { super('Database conflict'); this.name = 'DbConflictError'; }
}

// ISO-8601 UTC with milliseconds, the same text format the API has always stored and returned.
const NOW = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const APPEND_ONLY = `CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;`;

const MIGRATIONS: string[] = [
  // v1: accounts, sessions, cases, membership, documents, statements, findings, append-only audit log.
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
     display_name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT ${NOW}
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL DEFAULT ${NOW},
     expires_at TEXT NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE cases (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     owner_id TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT ${NOW},
     updated_at TEXT NOT NULL DEFAULT ${NOW},
     last_analyzed_at TEXT
   );
   CREATE TABLE case_members (
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('owner','reviewer','viewer')),
     added_by TEXT REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT ${NOW},
     PRIMARY KEY (case_id, user_id)
   );
   CREATE TABLE documents (
     id TEXT PRIMARY KEY,
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     data_json TEXT NOT NULL,
     file_path TEXT,
     file_size INTEGER,
     updated_at TEXT NOT NULL DEFAULT ${NOW}
   );
   CREATE INDEX documents_case ON documents(case_id);
   CREATE TABLE statements (
     id TEXT PRIMARY KEY,
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     document_id TEXT NOT NULL,
     data_json TEXT NOT NULL
   );
   CREATE INDEX statements_case ON statements(case_id);
   CREATE TABLE findings (
     id TEXT PRIMARY KEY,
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     fingerprint TEXT NOT NULL,
     review_status TEXT NOT NULL CONSTRAINT findings_review_status_check CHECK (review_status IN ('unreviewed','in_review','confirmed','resolved','dismissed')),
     stale INTEGER NOT NULL DEFAULT 0,
     data_json TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT ${NOW},
     updated_at TEXT NOT NULL DEFAULT ${NOW},
     UNIQUE (case_id, fingerprint)
   );
   CREATE TABLE audit_events (
     seq INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     case_id TEXT NOT NULL,
     actor_id TEXT,
     actor_name TEXT NOT NULL,
     kind TEXT NOT NULL,
     entity_type TEXT,
     entity_id TEXT,
     finding_id TEXT,
     document_id TEXT,
     from_status TEXT,
     to_status TEXT,
     reason TEXT,
     note TEXT,
     detail TEXT,
     at TEXT NOT NULL DEFAULT ${NOW}
   );
   CREATE INDEX audit_case ON audit_events(case_id, seq);
   -- Append-only at the database level: ordinary SQL cannot rewrite, delete or truncate history.
   ${APPEND_ONLY}
   CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_append_only();
   CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_append_only();
   CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();`,

  // v2: soft archiving of cases; the full MEDGUARD review-outcome set (needs_info, expected_change,
  // undetermined) is accepted by the database; lookup indexes. Existing rows are untouched.
  `ALTER TABLE cases ADD COLUMN archived_at TEXT;
   ALTER TABLE findings DROP CONSTRAINT findings_review_status_check;
   ALTER TABLE findings ADD CONSTRAINT findings_review_status_check
     CHECK (review_status IN ('unreviewed','in_review','confirmed','resolved','dismissed','needs_info','expected_change','undetermined'));
   CREATE INDEX findings_case_status ON findings(case_id, review_status);
   CREATE INDEX audit_finding ON audit_events(finding_id, seq);
   CREATE INDEX case_members_user ON case_members(user_id);`,

  // v3: original files are stored in the database instead of on the local disk, so a host with an
  // ephemeral filesystem (free hosting tiers) loses nothing on restart. Deleting a document deletes its file.
  `CREATE TABLE document_files (
     document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
     data BYTEA NOT NULL,
     size INTEGER NOT NULL CHECK (size > 0),
     updated_at TEXT NOT NULL DEFAULT ${NOW}
   );
   ALTER TABLE documents DROP COLUMN file_path;
   ALTER TABLE documents DROP COLUMN file_size;`,
  // v4: Google sign-in. A user is linked to Google by Google's stable subject id (never by email alone);
  // Google-only accounts have no password. OAuth state and the one-time hand-off codes are single-use rows.
  `ALTER TABLE users ADD COLUMN google_sub TEXT UNIQUE;
   ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
   CREATE TABLE oauth_states (
     state_hash TEXT PRIMARY KEY,
     code_verifier TEXT NOT NULL,
     nonce TEXT NOT NULL,
     return_to TEXT NOT NULL,
     link_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL
   );
   CREATE TABLE oauth_handoffs (
     code_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL
   );`,
];

/** Latest schema version this build migrates to. */
export const SCHEMA_VERSION = MIGRATIONS.length;
const MIGRATION_LOCK = 4_711_042; // arbitrary constant for pg_advisory_xact_lock

export async function schemaVersion(q: Queryable): Promise<number> {
  const r = await q.get<{ v: number | null }>('SELECT MAX(version)::int AS v FROM schema_version');
  return r?.v ?? 0;
}

/** Converts `?` placeholders (outside string literals) to PostgreSQL `$1, $2, …`. */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let inStr = false;
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    out += !inStr && ch === '?' ? `$${++n}` : ch;
  }
  return out;
}

// node-postgres and PGlite error codes that mean "the database is not reachable right now".
const UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', '57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006', '28P01', '3D000']);
function mapError(e: unknown): unknown {
  const code = (e as { code?: string })?.code;
  const msg = String((e as Error)?.message ?? '');
  if (code === '23505' || code === '23503') return new DbConflictError(e); // unique / foreign-key race with a concurrent request
  if ((code && UNAVAILABLE_CODES.has(code)) || /timeout exceeded when trying to connect|Connection terminated|connect ECONNREFUSED|getaddrinfo/i.test(msg)) return new DbUnavailableError(e);
  return e;
}

interface RawConn { query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null; affectedRows?: number }>; exec?(sql: string): Promise<unknown> }

function wrap(conn: RawConn): Queryable {
  const q = async (sql: string, params: unknown[] = []) => {
    try { return await conn.query(toPgPlaceholders(sql), params.map((p) => (p === undefined ? null : p))); } catch (e) { throw mapError(e); }
  };
  return {
    all: async <T>(sql: string, params?: unknown[]) => (await q(sql, params)).rows as T[],
    get: async <T>(sql: string, params?: unknown[]) => (await q(sql, params)).rows[0] as T | undefined,
    run: async (sql: string, params?: unknown[]) => { const r = await q(sql, params); return { changes: r.rowCount ?? r.affectedRows ?? 0 }; },
    exec: async (sql: string) => {
      try { if (conn.exec) await conn.exec(sql); else await conn.query(sql); } catch (e) { throw mapError(e); }
    },
  };
}

/**
 * Normalises a provider connection string for node-postgres: libpq-style `sslmode=require` becomes a
 * fully verified TLS connection, and `channel_binding` (a libpq-only parameter) is turned into the
 * driver option instead of being sent to the server.
 */
export function pgConfigFromUrl(url: string): { connectionString: string; enableChannelBinding?: boolean } {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('DATABASE_URL is not a valid postgres:// URL.'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
  const cb = u.searchParams.get('channel_binding');
  u.searchParams.delete('channel_binding');
  const mode = u.searchParams.get('sslmode');
  if (mode && ['prefer', 'require', 'verify-ca'].includes(mode)) u.searchParams.set('sslmode', 'verify-full');
  return { connectionString: u.toString(), ...(cb === 'require' ? { enableChannelBinding: true } : {}) };
}

async function openPostgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ ...pgConfigFromUrl(url), max: 5, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 30_000 });
  // An idle client losing its connection (e.g. a serverless database scaling to zero) must not crash the process.
  pool.on('error', () => {});
  const base = wrap(pool as unknown as RawConn);
  return {
    ...base,
    storage: 'external',
    async tx(fn) {
      let client: import('pg').PoolClient;
      try { client = await pool.connect(); } catch (e) { throw mapError(e); }
      let broken: unknown = undefined;
      try {
        await client.query('BEGIN');
        const r = await fn(wrap(client as unknown as RawConn));
        await client.query('COMMIT');
        return r;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (re) { broken = re; }
        throw mapError(e);
      } finally {
        client.release(broken as Error | undefined);
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) mkdirSync(dir, { recursive: true });
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  const base = wrap(pg as unknown as RawConn);
  return {
    ...base,
    storage: 'embedded',
    async tx(fn) {
      try { return await pg.transaction((t) => fn(wrap(t as unknown as RawConn))); } catch (e) { throw mapError(e); }
    },
    close: () => pg.close(),
  };
}

export interface OpenDbOptions {
  /** postgres:// connection string. When absent, the embedded database is used. */
  url?: string | null;
  /** Directory for the embedded database; null = in memory (tests). */
  dir?: string | null;
  /** Migrate only up to this version (tests of the upgrade path). */
  upTo?: number;
}

export async function migrate(db: Db, upTo = MIGRATIONS.length): Promise<number> {
  for (;;) {
    const applied = await db.tx(async (q) => {
      await q.get('SELECT pg_advisory_xact_lock(?)', [MIGRATION_LOCK]);
      await q.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
      const v = await schemaVersion(q);
      if (v >= upTo) return false;
      await q.exec(MIGRATIONS[v]);
      await q.run('INSERT INTO schema_version (version) VALUES (?)', [v + 1]);
      return true;
    });
    if (!applied) return schemaVersion(db);
  }
}

export async function openDb(opts: OpenDbOptions = {}): Promise<Db> {
  const db = opts.url ? await openPostgres(opts.url) : await openPglite(opts.dir ?? null);
  try {
    await migrate(db, opts.upTo);
  } catch (e) {
    await db.close().catch(() => {});
    throw e;
  }
  return db;
}
