// SQLite persistence (node:sqlite). Schema is migrated on start-up.
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

// Loaded via require so bundlers/test runners that do not know the (newer) node:sqlite builtin leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;
import { dirname } from 'node:path';

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     display_name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     expires_at TEXT NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE cases (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     owner_id TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     last_analyzed_at TEXT
   );
   CREATE TABLE case_members (
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('owner','reviewer','viewer')),
     added_by TEXT REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     PRIMARY KEY (case_id, user_id)
   );
   CREATE TABLE documents (
     id TEXT PRIMARY KEY,
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     data_json TEXT NOT NULL,
     file_path TEXT,
     file_size INTEGER,
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
     review_status TEXT NOT NULL CHECK (review_status IN ('unreviewed','in_review','confirmed','resolved','dismissed')),
     stale INTEGER NOT NULL DEFAULT 0,
     data_json TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     UNIQUE (case_id, fingerprint)
   );
   CREATE TABLE audit_events (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
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
     at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE INDEX audit_case ON audit_events(case_id, seq);
   -- Append-only at the database level: ordinary SQL cannot rewrite or delete history.
   CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
   CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;`,
];

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  let v = row.v ?? 0;
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    v++;
  }
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
