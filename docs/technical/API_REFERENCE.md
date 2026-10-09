# MEDGUARD — API Reference

> Source of truth: `server/app.ts` (route table, lines 119-366) and `src/lib/remote.ts` (browser client, `remoteApi`, lines 77-95).
> API version constant: `API_VERSION = '1.1.0'` (`server/app.ts:15`).
>
> **v1.2 is merged:** PR #3 (`38e3a54`) raises the API to v1.2 with 29 routes: readiness, OpenAPI, read endpoints for documents, findings, evidence, history and activity, case rename/archive, and the eight-outcome review machine. The table below covers the v1.1 routes. The full v1.2 list is in [`docs/backend/API_REFERENCE.md`](../backend/API_REFERENCE.md) and at `GET /api/openapi.json`. See also [README_TECHNICAL_OVERVIEW.md §7](README_TECHNICAL_OVERVIEW.md#7-backend-v12-pr-3-merged-as-38e3a54).

## 0. When this API is used

The default application **does not use any API**. In *local demo mode*, everything runs in the browser and stores data in IndexedDB:

- upload, text extraction, OCR, rules analysis;
- review decisions and notes;
- exports, backup and restore.

None of these make a network request, except loading the app's own static files (including `./demo/*`).

The API below exists only in the **optional shared-workspace server** (`server/`). The browser calls it only after a user enters a server URL under **Settings → Shared workspace** (stored in `localStorage` key `medguard.serverUrl`), or when the frontend was built with `VITE_API_BASE_URL`. The server is **not deployed publicly** (see `DEPLOYMENT_AND_CI_CD.md`).

## 1. Conventions

| Aspect | Behaviour | Evidence |
|---|---|---|
| Style | REST-like JSON over HTTP(S) | `server/app.ts` |
| Request body | `application/json`, max 25 MB (`maxJsonBytes`). File upload: raw `application/octet-stream`, max `MEDGUARD_MAX_UPLOAD_MB` (default 10 MB) | `server/config.ts`, `server/app.ts:385-399` |
| Authentication | `Authorization: Bearer <opaque token>` from `/api/auth/login` or `/api/auth/register` | `server/app.ts:419-422` |
| Error format | `{ "error": "<human message>", "code": "<machine code>" }` with an HTTP status | `server/app.ts:433-436` |
| Validation errors | HTTP 400, `code: "validation"`, first three Zod issues | `server/app.ts:435` |
| Unknown errors | HTTP 500, `code: "internal"`. Only the error *name* is logged | `server/app.ts:436` |
| Security headers | `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` | `server/app.ts:403-405` |
| CORS | Exact-match allow-list (`MEDGUARD_ALLOWED_ORIGINS`). Disallowed browser origins get 403 `cors`. Requests without an `Origin` header (non-browser) are allowed | `server/app.ts:371-383` |
| Request log | `METHOD path status ms`, with no bodies | `server/app.ts:438` |
| Client timeout | 30 s default. 8 s for health. 60 s for snapshot/file. 180 s for AI | `src/lib/remote.ts:48-95` |
| Client retries | **None** (no automatic retry in `apiFetch`) | `src/lib/remote.ts:48-75` |

**Roles** are per case, from `case_members.role`: `viewer` < `reviewer` < `owner` (`server/app.ts:22`). A non-member gets **404**, the same response as for a missing case, so case IDs cannot be probed (`server/app.ts:50-57`).

## 2. Endpoints

| Method | Endpoint | Auth / min role | Purpose | Input | Output | Evidence |
|---|---|---|---|---|---|---|
| GET | `/api/health` | none | Liveness and capabilities | none | `{ ok, service: "medguard-api", version, time, ai: { configured, provider, model }, registration }`. Never includes secrets | `app.ts:119` |
| POST | `/api/auth/register` | none. Only if `MEDGUARD_ALLOW_REGISTRATION=true`, otherwise 403 | Create an account and sign in | `{ email, password (10-200), displayName (1-80) }` | `{ token, expiresAt, user }`. 409 if the email exists | `app.ts:125` |
| POST | `/api/auth/login` | none. Rate-limited to 10 attempts per 15 min per email+IP | Sign in | `{ email, password }` | `{ token, expiresAt, user }`. 401 `invalid_credentials`. 429 | `app.ts:135` |
| POST | `/api/auth/logout` | bearer | Revoke the current session | none | `{ ok: true }` | `app.ts:146` |
| GET | `/api/auth/me` | bearer | Current user | none | `{ user }` | `app.ts:147` |
| GET | `/api/cases` | bearer | Cases the user is a member of | none | `{ cases: [{ id, label, updatedAt, lastAnalyzedAt, role, owner, documents, findings }] }` | `app.ts:149` |
| POST | `/api/cases` | bearer | Create a shared case. The caller becomes owner | `{ id?: "case_…", label (1-80) }` | Case snapshot (see §3). 409 if the id exists | `app.ts:157` |
| GET | `/api/cases/:id` | viewer | Full case snapshot | none | Case snapshot | `app.ts:169` |
| POST | `/api/cases/:id/members` | owner | Add or update a collaborator | `{ email, role: "reviewer" \| "viewer" }` | Case snapshot. 404 if the user is unknown | `app.ts:171` |
| DELETE | `/api/cases/:id/members/:userId` | owner | Remove a collaborator (the owner cannot be removed) | none | Case snapshot | `app.ts:186` |
| PUT | `/api/cases/:id/snapshot` | reviewer | Merge-sync documents, statements and findings computed in the browser | `{ documents[] (≤200), statements[] (≤20000), findings[] (≤2000), removedDocumentIds?[], analyzed?, detail? }` | Case snapshot. 422 if any statement or evidence quote does not match its document text | `app.ts:201-286` |
| PUT | `/api/cases/:id/documents/:docId/file` | reviewer | Store the original file privately | raw bytes | `{ ok: true, size }` | `app.ts:288` |
| GET | `/api/cases/:id/documents/:docId/file` | viewer | Download the original file | none | `application/octet-stream`, `Content-Disposition: attachment`, `X-Content-Mime` header | `app.ts:301` |
| POST | `/api/findings/:id/transition` | reviewer | Change review status (five-state machine) | `{ to, reason?, expectedStatus? }` | Case snapshot. 409 `conflict` if `expectedStatus` is stale. 422 `invalid_transition` | `app.ts:312` |
| POST | `/api/findings/:id/notes` | reviewer | Append a reviewer note to the audit log | `{ note (1-4000) }` | Case snapshot | `app.ts:331` |
| POST | `/api/ai/analyze` | bearer. Rate-limited to 10 requests per 10 min per user | AI-assisted proposal of findings (nothing is persisted server-side) | `{ caseId, documents[1..15] (extracted text ≤400k chars each, ≤600k total), existing[] }` | `{ provider, model, raw, summary: { accepted, rejected[], consistent[], downgraded } }`. 503 `not_configured` without a key | `app.ts:341` |

## 3. Case snapshot shape

Returned by most case and finding endpoints (`snapshot()`, `server/app.ts:62-81`; TypeScript type `RemoteSnapshot` in `src/lib/remote.ts`):

```json
{
  "case": { "id": "case_…", "label": "…", "createdAt": "…", "updatedAt": "…", "lastAnalyzedAt": null, "owner": "Name <email>" },
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

## 4. Server-side guarantees worth knowing

- **Review status is never accepted from a snapshot.** Status changes only through `/transition` (`server/app.ts:199-200, 268`).
- **Evidence re-verification.** Every statement's `originalText` and every finding's evidence `quote` must equal `extractedText.slice(charStart, charEnd)` of its document (`server/app.ts:221-241`).
- **Merge, not replace.** Documents missing from a snapshot are *not* deleted. Deletion requires `removedDocumentIds` (`server/app.ts:94-95, 213`).
- **Server-derived MIME type.** The stored MIME type comes from the validated `fileKind`, never from the client (`server/app.ts:247-248`).
- **No path traversal.** Case and document IDs must match `^[a-z]+_[A-Za-z0-9]{6,40}$` before they are used in a file path (`server/app.ts:21, 294`).
- **Optimistic concurrency.** `UPDATE … WHERE review_status = <previous>` inside a transaction. A concurrent change returns 409 (`server/app.ts:318-326`).
- **Append-only audit.** SQLite triggers abort any `UPDATE` or `DELETE` on `audit_events` (`server/db.ts`, migration 1).

## 5. AI provider contract (server → Anthropic)

Defined in `server/aiProvider.ts`. Exercised only against a local fake in tests.

- Call: `client.beta.messages.parse({ model, max_tokens: 16000, output_config: { format: betaZodOutputFormat(AiOutputSchema), effort: 'medium' }, system: AI_SYSTEM_PROMPT, messages: [...] })`.
- Optional beta flag `server-side-fallback-2026-07-01` with `fallbacks: 'default'` when `MEDGUARD_AI_FALLBACKS=true` (the default).
- Client options: `timeout = MEDGUARD_AI_TIMEOUT_MS` (default 120 000 ms), `maxRetries: 1`, `baseURL = MEDGUARD_ANTHROPIC_BASE_URL` or `https://api.anthropic.com`.
- Error mapping (`mapError`):

| Provider failure | Code | HTTP status |
|---|---|---|
| Timeout | `timeout` | 504 |
| Authentication or permission error | `provider_auth` | 502 |
| Rate limit | `rate_limited` | 429 |
| Bad request | `bad_request` | 502 |
| Connection error | `unavailable` | 503 |
| Refusal, truncation, parse failure | `refused` / `malformed_output` | 502 |

## 6. CLI command

`node dist-server/server.mjs create-user <email> <display name>`, with the password taken from `MEDGUARD_NEW_USER_PASSWORD` (minimum 10 characters). It creates an account directly in SQLite (`server/index.ts:11-23`).

## 7. What does not exist

No GraphQL, WebSocket, Server-Sent Events, webhook or public unauthenticated data endpoint. There are no password-reset, email-verification or admin endpoints, and no endpoint to delete a shared case or a user account.
