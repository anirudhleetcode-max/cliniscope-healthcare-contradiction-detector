# MEDGUARD — Security, Privacy and Limitations

> MEDGUARD is a **hackathon prototype** (`BUILD_LABEL = 'Hackathon prototype (PS-11R3)'`, `src/lib/version.ts`). It holds **no** HIPAA, GDPR, ISO 27001, SOC 2, medical-device or other compliance attestation, and it has not had an independent security review. It must not be used with real patient records. The Settings page says the same (`src/pages/About.tsx:26`).

## 1. Synthetic data vs real clinical data

- All bundled records are fictional. Examples: "Synthetic Patient SP-0042", "NORTHFIELD GENERAL (FICTIONAL)", and each file is bannered `DEMO CASE — SYNTHETIC DATA — NOT A REAL PATIENT` (`scripts/demo-content.mjs`, `src/lib/demoWorkspace.ts`).
- The UI labels demo content with a top banner, a "Demo environment" card and "Synthetic demo data" badges. Exports of demo cases carry `SYNTHETIC DEMONSTRATION DATA — NOT A REAL PATIENT RECORD` and a `-SYNTHETIC` filename suffix (`src/lib/exportCase.ts:12, 224-227`).
- Nothing technical prevents a user from uploading real records. Case creation asks for a *pseudonymous* label (`services.ts:51`), but this is guidance only.

## 2. Security controls

| Area | Implemented control | Evidence | Gaps / notes |
|---|---|---|---|
| Secret management | `ANTHROPIC_API_KEY` is read only on the server and never returned by any endpoint (`/api/health` reports only `configured`, `provider`, `model`). The browser never imports the SDK. `.env*`, `*.pem` and `*.key` are git-ignored | `server/config.ts`, `server/app.ts:119-123`, `.gitignore` | No secret manager integration; relies on host env vars |
| Frontend env vars | `VITE_*` are documented as public | `.env.example` | n/a |
| Content Security Policy | `<meta>` CSP: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'none'`; `frame-src blob:`; `worker-src 'self' blob:` | `index.html` | Delivered as a meta tag (GitHub Pages cannot set headers). `style-src 'unsafe-inline'`. `connect-src` allows **any** `https:` origin plus localhost, so the user can point the app at any API server |
| XSS | Rendering goes through React, with no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in `src/` or `server/` (grep-verified). Uploaded originals open through object URLs with a fixed MIME type per validated file kind, never as HTML | `src/pages/DocumentViewer.tsx:52-60`, `src/lib/remote.ts:208` | Bearer token in `sessionStorage` would be exposed by any same-origin XSS |
| Upload validation | Extension whitelist, MIME/extension match, size limit, empty-file check, magic-byte check (PDF/DOCX/PNG/JPEG), filename sanitization, duplicate detection | `src/lib/extract.ts:23-90`, `services.ts:90-98` | No malware scanning. Parsing happens in the browser (pdf.js with `isEvalSupported: false`) |
| Prompt injection | System prompt says documents are untrusted data and instructions inside them must be ignored. Model output is schema-validated and every quote re-verified, so the model cannot inject evidence that is not in the text | `src/lib/ai.ts:51-65, 118-227` | The model's free-text explanation is shown (clipped to 1500 chars) and labelled as AI-assisted |
| Authentication (server) | scrypt password hashing (N=16384, r=8, p=1, per-user salt, timing-safe compare); opaque 256-bit tokens; only SHA-256 token hashes stored; sessions expire (default 8 h); logout revokes; constant-work login for unknown emails | `server/auth.ts`, `server/app.ts:135-146` | No MFA, SSO, password reset, email verification or account lockout beyond rate limiting |
| Authentication (local mode) | **None.** The reviewer name is free text, labelled "not authenticated" | `src/app/state.tsx`, `AppShell.tsx` user menu | Anyone using the browser profile can see and edit local data |
| Authorization (server) | Per-request role check from `case_members` (viewer < reviewer < owner). Non-members get 404 to prevent ID probing. Only the owner manages members | `server/app.ts:46-57` | No global admin role. No case deletion endpoint |
| CORS | Exact-origin allow-list. Disallowed browser origins get 403 | `server/app.ts:371-383` | Requests without `Origin` (curl, scripts) are allowed by design. Auth still applies |
| Input validation (server) | Zod schemas on every JSON body, size caps (JSON 25 MB, files 10 MB default), ID regex, evidence re-verification against document text | `server/app.ts:84-111, 201-241` | n/a |
| Path traversal | Case and document IDs must match `^[a-z]+_[A-Za-z0-9]{6,40}$` before use in file paths. Files are written with mode `0600` | `server/app.ts:21, 288-299` | n/a |
| Rate limiting | Login: 10 per 15 min per email+IP. AI: 10 per 10 min per user. Fixed window, **in memory, per process** | `server/auth.ts` `RateLimiter`, `server/app.ts:33-34` | Resets on restart; not shared across instances; no general API rate limit |
| Response headers | `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. File downloads are `attachment` + `octet-stream` | `server/app.ts:301-309, 403-405` | No HSTS (TLS termination is left to the host) |
| Logging | Request line (method, path, status, ms); AI calls log user id and counts; errors log only the exception *name*. No bodies, passwords, tokens or document text | `server/app.ts:364, 436, 438`, `server/index.ts` | No structured or centralized logging |
| Audit trail | Every state change writes an event (browser `events.add()`; server `audit_events`). SQLite triggers make server audit rows append-only | `services.ts:42-46`, `server/db.ts` | Not cryptographically tamper-evident. In local mode the user controls their own IndexedDB and can delete a case, including its events |
| Concurrency | Optimistic `expectedStatus` check and conditional `UPDATE` in a transaction (409 on conflict). Sync merges, never replaces | `server/app.ts:312-329`, `src/lib/remote.ts` | Document-metadata edits are last-writer-wins |
| AI data sharing | Explicit consent modal naming the server URL, provider and model before any text is sent. Only extracted text is sent, not original files. The server persists nothing from the AI call | `src/components/AiPanel.tsx`, `server/app.ts:341-366` | Provider-side retention is **UNKNOWN** and depends on the operator's account |
| Offline cache | The service worker caches only same-origin GETs; it never caches the API | `public/sw.js` | Cached demo files and app shell persist until the cache is cleared |
| Data deletion | Local: delete a document, delete a case, reset demo cases (user cases untouched). Server: remove a document via snapshot | `services.ts:195-205, 347-356`, `server/app.ts:252-260` | No server-side case or user deletion. No retention policy |
| Backup / recovery | Local: manual JSON backup (including originals) and a validated restore as a new case (schema, quote and SHA-256 checks) | `src/lib/exportCase.ts:111-211` | No automatic backups. Server-volume backup is not implemented |
| Encryption | HTTPS in transit when the host provides it | n/a | **No encryption at rest** in IndexedDB or SQLite beyond the OS or browser |

## 3. Browser-storage risks (local mode)

- IndexedDB holds full extracted text and original files, unencrypted, readable by anyone with access to the browser profile or device.
- Data is per browser profile. Clearing site data deletes it irreversibly unless a backup was exported.
- `localStorage` holds only preferences, the current case id, the reviewer display name and the server URL. The bearer token is in `sessionStorage` and is cleared when the tab closes.

## 4. Limitations

### 4.1 Implemented

- Ingestion of PDF/TXT/DOCX/PNG/JPEG, with OCR for scans.
- Deterministic extraction and cross-document detection, with verified evidence.
- The review workflow with required reasons, and the audit trail.
- Dashboards, search, exports, backup and restore.
- Offline use after the first load.
- The optional shared-workspace server, with roles.
- The optional AI pass with evidence verification.

All of these are covered by 88 unit tests and 24 e2e tests (see `README_TECHNICAL_OVERVIEW.md`).

### 4.2 Partially implemented

| Area | What is missing |
|---|---|
| Shared workspace | Implemented and tested locally, but **not deployed**. Refresh is by polling, not real-time. No case deletion. Metadata edits are last-writer-wins |
| AI-assisted reasoning | Pipeline tested only against a local fake provider. Real model behaviour, precision and cost are unmeasured |
| Accessibility | Labels, focus ring, reduced motion and text-plus-icon badges exist. **Defect found in this audit:** the "Skip to content" link navigates to the 404 page under `HashRouter` (`AppShell.tsx:62`). Two colour pairs are slightly below 4.5:1 (see `DESIGN_SYSTEM.md`). No automated a11y testing |
| Local review outcomes | `needs_info`, `expected_change` and `undetermined` exist only in local mode. The server state machine has 5 states |

### 4.3 Not implemented

- SSO, MFA, password reset, email verification, admin console.
- Encryption at rest, key management, data retention policies, automatic backups.
- Server deployment, monitoring, alerting, centralized logs.
- Clinical terminology systems (SNOMED CT, RxNorm, LOINC, ICD), FHIR or HL7 import, EHR integration.
- NLP or ML models in the core engine; handwriting OCR; non-English OCR.
- Linting, a coverage reporter, SAST, dependency auditing in CI.
- A web app manifest (PWA install), dark mode.

### 4.4 Requires future validation

- **Clinical validity.** The rules use a fixed vocabulary: 14 allergens, 26 medications, 14 diagnoses, 10 lab tests and 7 procedures (130 surface terms in total), plus smoking status and date of birth. Precision and recall on real records are **unknown**; the system has only been evaluated on synthetic documents written for it.
- OCR accuracy on real-world scans; performance on large documents and cases.
- Security review and penetration test of the API server.
- Legal and regulatory assessment before any use with real patient data.
