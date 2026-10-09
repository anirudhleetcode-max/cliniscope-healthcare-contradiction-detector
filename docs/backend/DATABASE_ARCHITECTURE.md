# MEDGUARD database architecture

**Engine:** SQLite through Node's built-in `node:sqlite` (Node ≥ 22.13), in WAL mode with `foreign_keys=ON` and `busy_timeout=5000`.
- **File:** `$MEDGUARD_DATA_DIR/medguard.db`. Original uploaded files are stored in `$MEDGUARD_DATA_DIR/files/`.
- **Why SQLite:** it is genuine on-disk persistence, has no external service to provision, and suits a single-instance deployment with a persistent volume. No PostgreSQL hosting or credentials were available.
- **Moving to PostgreSQL:** the data-access code uses parameterized SQL with portable types, so it could be ported. That has not been done or tested.

## Tables
| Table | Purpose | Keys and constraints |
|---|---|---|
| `users` | Accounts | PK `id`; `email` UNIQUE (case-insensitive); scrypt `password_hash` |
| `sessions` | Bearer sessions | PK `token_hash` (SHA-256 of token); FK `user_id` → users ON DELETE CASCADE; `expires_at` |
| `cases` | Clinical cases | PK `id`; FK `owner_id` → users; `archived_at` (v2, soft archive) |
| `case_members` | Per-case roles | PK (`case_id`,`user_id`); FKs cascade; CHECK role ∈ owner/reviewer/viewer |
| `documents` | Document record (metadata + extracted text, JSON) | PK `id`; FK `case_id` → cases CASCADE; `file_path`, `file_size` for stored originals |
| `statements` | Extracted clinical statements (JSON, exact offsets) | PK `id`; FK `case_id` CASCADE |
| `findings` | Contradiction findings with evidence references (JSON) and current review status | PK `id`; FK `case_id` CASCADE; UNIQUE (`case_id`,`fingerprint`); CHECK `review_status` ∈ the 8 statuses (v2) |
| `audit_events` | Activity history: creation, decisions (from → to, reason), notes, sharing, sync, updates | PK `seq` AUTOINCREMENT; `id` UNIQUE; triggers abort every UPDATE and DELETE |
| `schema_version` | Applied migration versions | — |

**Relationships:**
- A case has members, documents, statements, findings and events.
- A finding's `evidence[]` holds `documentId`, character offsets and the verbatim quote. These are checked against the stored document text when the snapshot is accepted, and again on every `GET /api/findings/{id}/evidence`.
- Review decisions are the current `findings.review_status` plus one `status_changed` row in `audit_events` per decision (who, when, from, to, reason). Notes are `note_added` rows.

**Indexes:** `documents_case`, `statements_case`, `findings_case_status` (case_id, review_status), `audit_case` (case_id, seq), `audit_finding` (finding_id, seq), `case_members_user`, `sessions_user`.

## Migrations
`server/db.ts`, the `MIGRATIONS` array, is applied in order at start-up. Each version runs in its own transaction and is recorded in `schema_version`.
- **v1:** initial schema.
- **v2:** adds `cases.archived_at`; rebuilds `findings` with the 8-status CHECK, copying every row unchanged; adds indexes.

Tests cover a clean database, a v1 → v2 upgrade that keeps all rows, and re-opening being a no-op. **Back up `medguard.db` before upgrading a production database.** SQLite's online backup, or copying the file while the server is stopped, are both fine.

## Transactions
- A snapshot merge, a case creation with its owner membership, a review transition with its audit row, a note, and a case update each run in a single `BEGIN IMMEDIATE` transaction.
- A transition also re-checks the current status (compare-and-set), so concurrent decisions return 409 instead of overwriting each other.

## Deletion semantics
- Cases are **archived**, not deleted. Their data is retained and becomes read-only; the owner can restore them.
- Documents can be removed through the snapshot `removedDocumentIds`. Findings are never deleted: they become `stale` (superseded) and keep their recorded evidence.
- Activity rows cannot be updated or deleted through SQL; the database triggers enforce this. This is application-level append-only behaviour, **not** a cryptographically tamper-evident or regulator-grade audit trail. Anyone with file access can still replace the database.

## What is persisted and where
| Data | Shared workspace (this server) | Local demo mode (browser) |
|---|---|---|
| Cases, documents, statements, findings, decisions, notes, activity | SQLite file | IndexedDB in that browser only |
| Original files | `files/` directory | IndexedDB |
| Sessions | SQLite (`token_hash` only) | — |

Persistence was verified two ways:
- A test restarts the server on the same database file.
- A manual run killed the server process, confirmed it was down, started a new process, and read back the case, its rename and its activity history.

The CI Docker job checks readiness before and after a container restart.
