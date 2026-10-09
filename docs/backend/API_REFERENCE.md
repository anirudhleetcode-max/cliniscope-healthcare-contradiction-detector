# MEDGUARD API reference

Source: `server/app.ts`. The machine-readable OpenAPI 3.1 document is served at `GET /api/openapi.json` (`server/openapi.ts`). `tests/unit/backend.test.ts` fails if the document and the registered routes ever differ.

## Conventions
- JSON in and out. Errors are always `{"error": "<message>", "code": "<code>"}`.
- **Authentication:** `Authorization: Bearer <token>` from `/api/auth/login` or `/api/auth/register`. Tokens are opaque; only their SHA-256 hash is stored.
- **Authorization:** per case, from `case_members`.
  - Roles are `viewer` < `reviewer` < `owner`.
  - A case you are not a member of returns **404**, the same as a missing case, so IDs cannot be probed.
- **CORS:** only the exact origins in `MEDGUARD_ALLOWED_ORIGINS`. Any other browser origin gets 403.
- **Archived cases** are read-only: writes return `409 archived` until the owner restores the case.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `validation` / `error` | Invalid body, query or JSON |
| 401 | `unauthenticated`, `invalid_credentials` | Missing, expired or invalid session |
| 403 | `forbidden`, `cors` | Role too low, or origin not allowed |
| 404 | `not_found` | Missing, or not visible to you |
| 409 | `conflict`, `archived` | Concurrent change (including identifier clashes with another case), or archived case |
| 413 | | Body or file too large |
| 422 | `invalid_transition` / `error` | Review rule violated, or evidence does not match the source text |
| 429 | | Rate limited (login, AI) |
| 503 | `not_ready`, `database_unavailable` | Readiness: database unreachable or not migrated. Any other route: the database is temporarily unreachable (retry) |

## Endpoints

| Method | Path | Purpose | Auth / role |
|---|---|---|---|
| GET | `/health`, `/api/health` | Liveness; version; AI/registration flags (no secrets) | none |
| GET | `/ready`, `/api/ready` | Readiness: DB answers and schema = expected version, else 503. Reports `engine` and `storage` (`external` = `DATABASE_URL`, `embedded` = local PGlite) | none |
| GET | `/api/openapi.json` | OpenAPI document | none |
| POST | `/api/auth/register` | Create account (only if `MEDGUARD_ALLOW_REGISTRATION=true`) | none |
| POST | `/api/auth/login` · `/api/auth/logout` | Session start / revoke | none / bearer |
| GET | `/api/auth/me` | Current user | bearer |
| GET | `/api/cases?limit&offset&q&includeArchived` | Your cases, newest activity first; `{cases,total,limit,offset}` | bearer |
| POST | `/api/cases` | Create case `{label, id?}`; creator becomes owner | bearer |
| GET | `/api/cases/{caseId}` | Full snapshot: case, members, documents, statements, findings, events | viewer |
| PATCH | `/api/cases/{caseId}` | `{label?, archived?}`, audited as `case_updated` | owner |
| POST / DELETE | `/api/cases/{caseId}/members[/{userId}]` | Add / remove collaborator | owner |
| PUT | `/api/cases/{caseId}/snapshot` | Register documents, statements and findings (merge); every quote re-verified | reviewer |
| GET | `/api/cases/{caseId}/documents` | Document metadata (`textLength`, `hasServerFile`; no text) | viewer |
| GET | `/api/cases/{caseId}/documents/{documentId}?include=text` | One document; extracted text only on request | viewer |
| PUT / GET | `/api/cases/{caseId}/documents/{documentId}/file` | Store / download the original bytes (size-limited) | reviewer / viewer |
| GET | `/api/cases/{caseId}/findings?status&type&category&includeStale` | Findings (unknown status/type → 400) | viewer |
| GET | `/api/findings/{findingId}` | One finding | viewer |
| GET | `/api/findings/{findingId}/evidence` | Evidence references with `verified` / `documentAvailable` | viewer |
| GET | `/api/findings/{findingId}/history` | Decisions and notes, oldest first | viewer |
| POST | `/api/findings/{findingId}/transition` | Review decision `{to, reason?, expectedStatus?}` | reviewer |
| POST | `/api/findings/{findingId}/notes` | Reviewer note `{note}` (1–4000 chars) | reviewer |
| GET | `/api/cases/{caseId}/activity?limit&before` | Case activity, newest first; `nextBefore` for paging | viewer |
| GET | `/api/activity?limit` | Recent activity across your cases | bearer |
| POST | `/api/ai/analyze` | Optional AI pass (server-side key, client consent) | reviewer |

### Review decisions
Statuses: `unreviewed`, `in_review`, `confirmed`, `resolved`, `dismissed`, `needs_info`, `expected_change`, `undetermined`. These are the same as the frontend (`src/lib/review.ts`, `LOCAL_TRANSITIONS`).

| From | Allowed next statuses |
|---|---|
| `unreviewed` | `in_review` |
| `in_review` | `confirmed`, `dismissed`, `needs_info`, `expected_change`, `undetermined`, `resolved` |
| `needs_info` | the decisions above, or back to `in_review` |
| `confirmed` | `resolved`, `in_review` |
| `resolved`, `dismissed`, `expected_change`, `undetermined` | `in_review` (reopen) |

- **Reason required** (≥ 5 characters): `resolved`, `dismissed`, `expected_change`, `undetermined`, and reopening a decided finding.
- **Concurrency:** send `expectedStatus` to get **409** instead of overwriting another reviewer's decision.

### Examples
```bash
B=http://localhost:8787
T=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.test","password":"correct-horse-battery"}' | jq -r .token)
curl -s "$B/api/cases?limit=10" -H "Authorization: Bearer $T"
curl -s -X PATCH "$B/api/cases/case_abc123def456" -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"label":"CASE-0201 · renamed"}'
curl -s "$B/api/findings/fd_abc123def456/evidence" -H "Authorization: Bearer $T"
curl -s -X POST "$B/api/findings/fd_abc123def456/transition" -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"to":"needs_info","expectedStatus":"in_review"}'
```
Example error: `{"error":"A reason of at least 5 characters is required for this decision.","code":"invalid_transition"}`
