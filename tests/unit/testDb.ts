// Test databases for the API tests.
// Default: PGlite (embedded PostgreSQL), in memory, or in a temporary directory when a test reopens it.
// With TEST_DATABASE_URL set to a PostgreSQL server on which the tests may create databases, every call
// creates a fresh, empty database on that server instead, so the same tests exercise the node-postgres
// driver used in production (CI runs both).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { OpenDbOptions } from '../../server/db';

export const REAL_PG = process.env.TEST_DATABASE_URL?.trim() || null;

export async function newDatabase(opts: { onDisk?: boolean } = {}): Promise<OpenDbOptions> {
  if (REAL_PG) {
    const name = `medguard_t_${randomBytes(6).toString('hex')}`;
    const { default: pg } = await import('pg');
    const admin = new pg.Client({ connectionString: REAL_PG });
    await admin.connect();
    try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
    const u = new URL(REAL_PG);
    u.pathname = `/${name}`;
    return { url: u.toString() };
  }
  return { dir: opts.onDisk ? mkdtempSync(join(tmpdir(), 'mg-pg-')) : null };
}
