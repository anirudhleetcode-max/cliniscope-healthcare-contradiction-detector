# MEDGUARD — API Reference

> **Source of truth:**
> - `server/app.ts` — route table at lines 134–498, `API_VERSION = '1.2.0'` at line 16;
> - `server/openapi.ts` — the OpenAPI 3.1 document served at `GET /api/openapi.json`;
> - `src/lib/remote.ts` — the browser client `remoteApi`, lines 77–95.
>
> `tests/unit/backend.test.ts` ("documents exactly the routes the server registers") fails if the OpenAPI document and the registered routes ever differ.
>
> **Audit basis:** branch `claude/medguard-technical-docs`, built on `claude/medguard-backend` @ `5a6400a` (draft PR #3). The backend routes marked **v1.2** exist only on that branch until PR #3 is merged.

## 0. When this API is used

The default application **does not use any API**. In *local demo mode*, everything runs in the browser and stores data in IndexedDB:
- upload, text extraction, OCR and rules analysis;
- review decisions and notes;
- exports, backup and restore.

None of these make a network request, apart from loading the app's own static files (including `./demo/*`).

The API below exists only in the **optional shared-workspace server** (`server/`). The browser calls it only in two situations:
- a user has entered a server URL under **Settings → Shared workspace**, stored in `localStorage` under the key `medguard.serverUrl` (`src/lib/remote.ts:33`);
- the frontend was built with `VITE_API_BASE_URL`.

The server is **not deployed publicly** (see [DEPLOYMENT_AND_CI_CD.md](DEPLOYMENT_AND_CI_CD.md)).

## 1. Conventions

| Aspect | Behaviour | Evidence |
|---|---|---|
| Style | REST-style JSON over HTTP(S), plain `node:http` with no framework | `server/app.ts:3` |
| Request body | `application/json`, max 25 MB (`maxJsonBytes`). File upload: raw `application/octet-stream`, max `MEDGUARD_MAX_UPLOAD_MB` (default 10 MB) | `server/config.ts`, `server/app.ts:542-583` |
| Authentication | `Authorization: Bearer <opaque token>` from `/api/auth/login` or `/api/auth/register` | `server/app.ts` (request handler), `server/auth.ts` |
| Error format | `{ "error": "<human message>", "code": "<machine code>" }` with an HTTP status | `server/app.ts:591` |
| Validation errors | HTTP 400, `code: "validation"`, first three Zod issues. Malformed integer query parameters also return 400 (`intParam`) | `server/app.ts:25-31, 592` |
| Unknown errors | HTTP 500, `code: "internal"`. Only the error *name* is logged | `server/app.ts:593` |
| Security headers | `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` | `server/app.ts:560-562` |
| CORS | Exact-match allow-list (`MEDGUARD_ALLOWED_ORIGINS`). Disallowed browser origins get 403 `cors`. Requests without an `Origin` header (non-browser clients) are allowed | `server/app.ts:528-540` |
| Request log | `METHOD path status ms` only, with no bodies, tokens or clinical text | `server/app.ts:595` |
| Client timeout | 30 s default; 8 s for health; 60 s for snapshot and file transfers; 180 s for AI | `src/lib/remote.ts:48-95` |
| Client retries | **None.** `apiFetch` does not retry automatically | `src/lib/remote.ts:48-75` |

**Roles** are per case, from `case_members.role`: `viewer` < `reviewer` < `owner` (`server/app.ts:32`).
- **Non-members:** get **404**, the same as a missing case, so case IDs cannot be probed.
- **Archived cases (v1.2):** reject every write with **409 `archived`**, except the owner's archive/restore request (`requireRole`, `server/app.ts:60-73`).

## 2. Endpoints

| Method | Endpoint | Auth / min role | Purpose | Input | Output | Evidence |
|---|---|---|---|---|---|---|
| GET | `/api/health` (+ alias `/health`, v1.2) | none | Liveness and capabilities | — | `{ ok, service: "medguard-api", version, time, ai: { configured, provider, model }, registration }`. Never includes secrets | `app.ts:134, 151` |
| GET | `/api/ready` (+ alias `/ready`) **v1.2** | none | Readiness: the DB answers a query and is at the expected schema version | — | `{ ok, database: { reachable, schemaVersion, expectedSchemaVersion }, time }`, or **503 `not_ready`** | `app.ts:141-150` |
| GET | `/api/openapi.json` **v1.2** | none | OpenAPI 3.1 document | — | JSON | `app.ts:152`, `server/openapi.ts` |
| POST | `/api/auth/register` | none. Only if `MEDGUARD_ALLOW_REGISTRATION=true`, otherwise 403 | Create an account and sign in | `{ email, password (10-200), displayName (1-80) }` | `{ token, expiresAt, user }`. 409 if the email exists | `app.ts:154` |
| POST | `/api/auth/login` | none. Rate-limited to 10 attempts per 15 min per email+IP | Sign in | `{ email, password }` | `{ token, expiresAt, user }`. 401 `invalid_credentials`; 429 | `app.ts:164` |
| POST | `/api/auth/logout` | bearer | Revoke the current session | — | `{ ok: true }` | `app.ts:175` |
| GET | `/api/auth/me` | bearer | Current user | — | `{ user }` | `app.ts:176` |
| GET | `/api/cases` | bearer | Cases the user is a member of. **v1.2:** `limit` (1–100, default 50), `offset`, `q` (label contains; `%`/`_` matched literally), `includeArchived` | query | `{ cases: [{ id, label, updatedAt, lastAnalyzedAt, archivedAt, role, owner, documents, findings }], total, limit, offset }` | `app.ts:178` |
| POST | `/api/cases` | bearer | Create a shared case; the caller becomes owner | `{ id?: "case_…", label (1-80) }` | Case snapshot (§3). 409 if the id exists | `app.ts:197` |
| GET | `/api/cases/:id` | viewer | Full case snapshot | — | Case snapshot | `app.ts:209` |
| PATCH | `/api/cases/:id` **v1.2** | owner | Rename, archive or restore. Each change is a `case_updated` audit event | `{ label?, archived? }` (at least one) | Case snapshot. 400 if empty | `app.ts:383` |
| POST | `/api/cases/:id/members` | owner | Add or update a collaborator | `{ email, role: "reviewer" \| "viewer" }` | Case snapshot. 404 if the user is unknown | `app.ts:211` |
| DELETE | `/api/cases/:id/members/:userId` | owner | Remove a collaborator (the owner cannot be removed) | — | Case snapshot | `app.ts:226` |
| PUT | `/api/cases/:id/snapshot` | reviewer | Merge-sync the documents, statements and findings computed in the browser | `{ documents[] (≤200), statements[] (≤20000), findings[] (≤2000), removedDocumentIds?[], analyzed?, detail? }` | Case snapshot. 422 if any statement or evidence quote does not match its document text | `app.ts:241-326` |
| GET | `/api/cases/:id/documents` **v1.2** | viewer | Document metadata. The extracted text is omitted; `textLength`, `hasServerFile` and `serverFileSize` are returned instead | — | `{ documents: [...] }` | `app.ts:402-411` |
| GET | `/api/cases/:id/documents/:docId` **v1.2** | viewer | One document's metadata; `?include=text` adds `extractedText` | query | `{ document }`. 404 if the document is not in this case | `app.ts:412` |
| PUT | `/api/cases/:id/documents/:docId/file` | reviewer | Store the original file privately | raw bytes | `{ ok: true, size }` | `app.ts:328` |
| GET | `/api/cases/:id/documents/:docId/file` | viewer | Download the original file | — | `application/octet-stream`, `Content-Disposition: attachment`, `X-Content-Mime` header | `app.ts:341` |
| GET | `/api/cases/:id/findings` **v1.2** | viewer | Findings, filterable by `status` (8 values), `type`, `category`, `includeStale` | query | `{ findings: [...] }`. 400 for an unknown status or type | `app.ts:430` |
| GET | `/api/findings/:id` **v1.2** | viewer | One finding | — | `{ finding }` | `app.ts:446` |
| GET | `/api/findings/:id/evidence` **v1.2** | viewer | Evidence references, each quote re-verified against the stored document text | — | `{ findingId, evidence: [{ ...EvidenceRef, documentAvailable, verified }] }` | `app.ts:452` |
| GET | `/api/findings/:id/history` **v1.2** | viewer | Decisions and notes, oldest first | — | `{ findingId, reviewStatus, history: [event] }` | `app.ts:470` |
| POST | `/api/findings/:id/transition` | reviewer | Record a review decision. **v1.2:** the full eight-outcome machine (`LOCAL_TRANSITIONS`); v1.1 accepted only five statuses | `{ to, reason?, expectedStatus? }` | Case snapshot. 409 `conflict` if `expectedStatus` is stale. 422 `invalid_transition` | `app.ts:352-369` |
| POST | `/api/findings/:id/notes` | reviewer | Append a reviewer note to the audit log | `{ note (1-4000, not blank) }` | Case snapshot | `app.ts:371` |
| GET | `/api/cases/:id/activity` **v1.2** | viewer | Case activity, newest first. `limit` 1–200; `before=<seq>` for paging | query | `{ events: [...], nextBefore }` | `app.ts:477-491` |
| GET | `/api/activity` **v1.2** | bearer | Recent activity across all of the caller's cases | `limit` | `{ events: [...] }` | `app.ts:492` |
| POST | `/api/ai/analyze` | bearer. Rate-limited to 10 requests per 10 min per user | AI-assisted proposal of findings. Nothing is persisted server-side | `{ caseId, documents[1..15] (extracted text ≤400k chars each, ≤600k total), existing[] }` | `{ provider, model, raw, summary: { accepted, rejected[], consistent[], downgraded } }`. 503 `not_configured` without a key | `app.ts:498` |

The browser client (`remoteApi`) calls `health`, the auth routes, cases (list, create, get), members, snapshot, file upload and download, transition, notes and AI. **It does not yet call the v1.2 read endpoints or `PATCH`.** It uses the full snapshot instead ([DATA_FLOW_AND_WORKFLOW.md §6](DATA_FLOW_AND_WORKFLOW.md)).

## 3. Case snapshot shape

`snapshot()` (`server/app.ts:77-101`) is returned by most case and finding endpoints. Its TypeScript type is `RemoteSnapshot` in `src/lib/remote.ts`.

```json
{
  "case": { "id": "case_…", "label": "…", "createdAt": "…", "updatedAt": "…", "lastAnalyzedAt": null, "archivedAt": null, "owner": "Name <email>" },
  "role": "owner | reviewer | viewer",
  "members": [{ "userId": "usr_…", "email": "…", "displayName": "…", "role": "…" }],
  "documents": [{ "...DocumentRecord": "...", "hasServerFile": true }],
  "statements": [ "ClinicalStatement" ],
  "findings": [ "Finding with server-side id, reviewStatus, stale" ],
  "events": [ "AuditEvent" ],
  "serverTime": "ISO-8601"
}
```

Domain types are defined once in `src/lib/types.ts` and shared by the browser and the server.

## 4. Server-side guarantees

- **Review status is never accepted from a snapshot.** Status changes only through `/transition`.
- **Evidence re-verification.** Every statement's `originalText` and every finding's evidence `quote` must equal `extractedText.slice(charStart, charEnd)` of its document. This is checked when a snapshot is accepted (`server/app.ts:261-281`) and again on every `GET …/evidence` read.
- **Merge, not replace.** Documents missing from a snapshot are *not* deleted; deletion requires `removedDocumentIds`.
- **Server-derived MIME type.** The stored MIME type comes from the validated `fileKind`, never from the client.
- **No path traversal.** Case and document IDs must match `^[a-z]+_[A-Za-z0-9]{6,40}$` (`server/app.ts:22`) before they are used in a file path.
- **Optimistic concurrency.** The update runs `UPDATE … WHERE review_status = <previous>` inside a transaction, and a concurrent change returns 409 (`server/app.ts:363`).
- **Append-only audit.** SQLite triggers abort any `UPDATE` or `DELETE` on `audit_events` (`server/db.ts`, migration 1). This is tested in `backend.test.ts`.
- **Archived cases are read-only (v1.2).** Writes return 409 `archived`; reads keep working.

## 5. Review state machine (server, v1.2)

The server calls `validateTransition(from, to, reason, 'local')` (`server/app.ts:361`), so it enforces `LOCAL_TRANSITIONS` from `src/lib/review.ts`. These are the same eight outcomes the frontend uses in local mode.

| From | Allowed next statuses |
|---|---|
| `unreviewed` | `in_review` |
| `in_review` | `confirmed`, `dismissed`, `needs_info`, `expected_change`, `undetermined`, `resolved` |
| `needs_info` | the decisions above, or back to `in_review` |
| `confirmed` | `resolved`, `in_review` |
| `resolved`, `dismissed`, `expected_change`, `undetermined` | `in_review` (reopen) |

- **Reason required** (≥ 5 characters): `resolved`, `dismissed`, `expected_change`, `undetermined`, and reopening a decided finding (`reasonRequired`).
- **Database check:** after migration v2, a `CHECK` constraint on `findings.review_status` accepts exactly these eight values.

## 6. AI provider contract (server → Anthropic)

Defined in `server/aiProvider.ts` and exercised **only against a local fake** in tests (`tests/unit/server.test.ts`, `tests/e2e/fake-anthropic.mjs`).

- **Call:** `client.beta.messages.parse({ model, max_tokens: 16000, output_config: { format: betaZodOutputFormat(AiOutputSchema), effort: 'medium' }, system: AI_SYSTEM_PROMPT, messages: [...] })`.
- **Fallbacks:** an optional server-side fallback beta flag, used when `MEDGUARD_AI_FALLBACKS=true` (the default).
- **Client options:**
  - `timeout = MEDGUARD_AI_TIMEOUT_MS` (default 120 000 ms);
  - `maxRetries: 1`;
  - `baseURL = MEDGUARD_ANTHROPIC_BASE_URL`, or `https://api.anthropic.com` by default.
- **Default model id:** `claude-opus-5-5` (`server/config.ts`), overridable with `MEDGUARD_AI_MODEL`.
- **Error mapping** (`mapError`):

| Provider failure | Code | HTTP status |
|---|---|---|
| Timeout | `timeout` | 504 |
| Authentication or permission error | `provider_auth` | 502 |
| Rate limit | `rate_limited` | 429 |
| Bad request | `bad_request` | 502 |
| Connection error | `unavailable` | 503 |
| Refusal, truncation, parse failure | `refused` / `malformed_output` | 502 |

## 7. CLI command

`create-user` creates an account directly in SQLite (`server/index.ts:11-23`):

```bash
MEDGUARD_NEW_USER_PASSWORD='…' node dist-server/server.mjs create-user <email> <display name>
```

The password must be at least 10 characters.

## 8. What does not exist

- No GraphQL, WebSocket, Server-Sent Events or webhooks.
- No public unauthenticated data endpoint.
- No password-reset, email-verification or admin endpoints.
- No endpoint to hard-delete a case or a user account. Cases can be archived (v1.2).
