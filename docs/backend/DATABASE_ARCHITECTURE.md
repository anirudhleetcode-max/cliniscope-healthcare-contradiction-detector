# MEDGUARD database architecture

**Engine:** PostgreSQL, with one SQL dialect and two drivers (`server/db.ts`):
- **External server:** when `DATABASE_URL` is set, node-postgres uses a small pool (5 connections, 15 s connect timeout) and TLS as the URL requires. libpq-style `sslmode=require` is upgraded to fully verified TLS. This is the free deployment's mode: Neon (see `DEPLOYMENT.md`).
- **Embedded:** when `DATABASE_URL` is empty, **PGlite** (PostgreSQL compiled to WebAssembly) runs in the server process.
  - Its data is stored in `$MEDGUARD_DATA_DIR/pgdata`, or in memory in unit tests.
  - Used for local development, tests and self-hosting on a persistent volume.
  - On hosts whose disk is wiped on restart, set `MEDGUARD_REQUIRE_DATABASE_URL=true`; the server then refuses to start without an external database.
- **Why PostgreSQL:** free hosting tiers have no persistent disk, so the data must live in a managed database. PostgreSQL has a genuine no-card free tier (Neon), and PGlite keeps local development dependency-free.
- **Earlier versions** (API 1.2.0 and earlier) used SQLite through `node:sqlite`. No SQLite deployment ever existed outside local development and CI, so there is no data to migrate. The table layout, constraints and semantics are carried over unchanged.

## Tables
| Table | Purpose | Keys and constraints |
|---|---|---|
| `users` | Accounts | PK `id`; `email` UNIQUE and CHECK lower-case (the API lower-cases every address); scrypt `password_hash` |
| `sessions` | Bearer sessions | PK `token_hash` (SHA-256 of token); FK `user_id` → users ON DELETE CASCADE; `expires_at` |
| `cases` | Clinical cases | PK `id`; FK `owner_id` → users; `archived_at` (v2, soft archive) |
| `case_members` | Per-case roles | PK (`case_id`,`user_id`); FKs cascade; CHECK role ∈ owner/reviewer/viewer |
| `documents` | Document record (metadata + extracted text, JSON) | PK `id`; FK `case_id` → cases CASCADE |
| `document_files` | Original uploaded file bytes (v3) | PK/FK `document_id` → documents ON DELETE CASCADE; `data` BYTEA; `size` > 0 |
| `statements` | Extracted clinical statements (JSON, exact offsets) | PK `id`; FK `case_id` CASCADE. An id belonging to another case is never overwritten (409) |
| `findings` | Contradiction findings with evidence references (JSON) and current review status | PK `id`; FK `case_id` CASCADE; UNIQUE (`case_id`,`fingerprint`); CHECK `review_status` ∈ the 8 statuses (v2) |
| `audit_events` | Activity history: creation, decisions (from → to, reason), notes, sharing, sync, updates | PK `seq` (identity); `id` UNIQUE; triggers reject every UPDATE, DELETE and TRUNCATE |
| `schema_version` | Applied migration versions | — |

**Relationships:**
- A case has members, documents, statements, findings and events.
- A finding's `evidence[]` holds `documentId`, character offsets and the verbatim quote. These are checked against the stored document text when the snapshot is accepted, and again on every `GET /api/findings/{id}/evidence`.
- Review decisions are the current `findings.review_status` plus one `status_changed` row in `audit_events` per decision (who, when, from, to, reason). Notes are `note_added` rows.

**Indexes:** `documents_case`, `statements_case`, `findings_case_status` (case_id, review_status), `audit_case` (case_id, seq), `audit_finding` (finding_id, seq), `case_members_user`, `sessions_user`.

## Migrations
`server/db.ts`, the `MIGRATIONS` array, is applied in order at start-up.
- Each version runs in its own transaction while holding a PostgreSQL advisory lock, so two instances starting together cannot apply a step twice.
- Each applied version is recorded in `schema_version`.

| Version | Change |
|---|---|
| v1 | Initial schema |
| v2 | Adds `cases.archived_at`; widens the `findings` status CHECK to the 8 outcomes (existing rows untouched); adds indexes |
| v3 | Adds `document_files`, so original files live in the database (no local disk needed); removes the old `file_path` / `file_size` columns |

Tests cover a clean database, a v1 → v3 upgrade that keeps every row, and re-opening being a no-op. They run on PGlite and on a real PostgreSQL 16 server. Back up before upgrading a database that holds data you care about: `pg_dump "$DATABASE_URL" > backup.sql`.

## Transactions and concurrency
- A snapshot merge, a case creation with its owner membership, a review transition with its audit row, a note, a member change and a case update each run in one transaction.
- Writes that change a whole case (snapshot merge, case update) first take a row lock on the case (`SELECT … FOR UPDATE`). Writers of the same case are serialised, as SQLite's single writer did before; other cases are unaffected.
- A transition is a compare-and-set (`UPDATE … WHERE review_status = <previous>`), so concurrent decisions get 409 instead of overwriting each other.
- If a uniqueness or foreign-key race still occurs, the API answers **409 `conflict`**.
- If the database is unreachable, it answers **503 `database_unavailable`**, never 500. Readiness also turns 503.

## Deletion semantics
- Cases are **archived**, not deleted. Their data is retained and becomes read-only; the owner can restore them.
- Documents can be removed through the snapshot `removedDocumentIds`. Findings are never deleted: they become `stale` (superseded) and keep their recorded evidence.
- Activity rows cannot be updated, deleted or truncated through SQL; database triggers enforce this. This is application-level append-only behaviour, **not** a cryptographically tamper-evident or regulator-grade audit trail. The database owner can still drop the triggers.

## What is persisted and where
| Data | Shared workspace (this server) | Local demo mode (browser) |
|---|---|---|
| Cases, documents, statements, findings, decisions, notes, activity | PostgreSQL (Neon in the free deployment) | IndexedDB in that browser only |
| Original files | PostgreSQL (`document_files`) | IndexedDB |
| Sessions | PostgreSQL (`token_hash` only) | — |

Persistence is verified in four ways:
- **Tests:** a test restarts the API on the same database (embedded and real PostgreSQL), including a stored original file.
- **Real process restart:** a manual run killed the bundled server process (external PostgreSQL 16), confirmed it was down, started a new process, and read everything back.
- **CI `docker-api`:** writes through the container, **removes** it (no volume), starts a new one and reads the data back.
- **Not yet verified on Neon/Render:** that check needs the deployment in `DEPLOYMENT.md` (step 6 there).
