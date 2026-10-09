# CLINISCOPE

**Evidence-first healthcare record contradiction detection and clinical review.** Built for problem statement **PS-11R3: Healthcare Record Contradiction Detector**.

> **Every flagged discrepancy comes with evidence you can inspect.**
> From fragmented medical records, digital or scanned, to traceable, human-verified clinical review.

**Live demo (static frontend):** https://anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector/

> ⚠️ **Hackathon research prototype. Review-support tool, not a diagnostic system.** CLINISCOPE flags *possible* inconsistencies and shows the source evidence for each. It never decides which statement is medically correct. It has no regulatory certification and no compliance attestation (HIPAA or other). Use **fictional demonstration data only**: *not for clinical use*.

---

## What is implemented (and what is optional)

| Capability | Status | Where it runs |
|---|---|---|
| PDF / TXT / DOCX ingestion, validation, provenance | Implemented and tested | Browser |
| **OCR of scanned PDFs, mixed PDFs and PNG/JPEG scans** (Tesseract.js) | Implemented and tested (unit tests in Node, e2e in Chromium, production e2e via CI) | Browser, assets self-hosted |
| Deterministic statement extraction and contradiction detection | Implemented and tested | Browser |
| Evidence verification, source highlighting, original-page comparison | Implemented and tested | Browser |
| Review workflow (state machine, required reasons, notes, audit) | Implemented and tested | Browser (local) or server (shared) |
| Dashboard metrics, document search/filter, original-file download | Implemented and tested | Browser |
| Exports: JSON case report, findings CSV, full backup + validated restore | Implemented and tested | Browser |
| Offline use after first load (service worker) | Implemented and tested (e2e reload while offline) | Browser |
| **Shared workspace**: accounts, case sharing, server-enforced roles, shared review state, append-only audit | Implemented and tested against a real local server (integration and two-browser e2e). **Not deployed publicly**: no hosting account was available | `server/` (Node + SQLite) |
| **AI-assisted reasoning** with schema validation and quote verification | Pipeline implemented and tested with a local fake provider. **Live model calls have not been tested**: no API key was available | `server/` (key never in the browser) |

Without a server the app runs in **local demo mode**, and data stays in the browser's IndexedDB. The UI always shows which mode a case is in.

## Frontend workspace

| Screen | Route | What it does |
|---|---|---|
| Clinical Overview | `#/` | Workspace metrics (cases reviewed, open contradictions, pending reviews, documents processed), category chart, review-status chart, open contradictions, recent activity |
| Clinical Cases | `#/cases` | Searchable, filterable, sortable case table; create, restore from backup |
| Case workspace | `#/cases/:id` | Three columns: case summary, documents and findings · evidence comparison · review decision and history |
| Contradictions | `#/contradictions` | All findings with type tabs, severity/category/case/status filters, chips, sorting and a quick-preview drawer |
| Finding detail | `#/findings/:id` | Explanation, certainty note, suggested review question (template), evidence, caveats, decision, history |
| Documents | `#/documents` | Per-case import (validated), extraction status, search/filter, viewer and original download |
| Review Queue | `#/queue` | Pending findings with status counts and a review workspace |
| Activity | `#/activity` | Local activity log, filterable by type, case and origin (seeded example vs local action) |
| Settings / Help | `#/settings`, `#/help` | Storage stats, appearance, capability status, demo reset; workflow and definitions |

Global search: **Ctrl/Cmd+K** (or `/`). Review outcomes: *Confirmed discrepancy*, *Dismissed — not a contradiction*, *Needs more information*, *Temporal difference / expected change*, *Unable to determine*, *Resolved*. The last three new outcomes exist only for local cases; the optional server keeps its original five-state machine.

Design system: [`docs/FIGMA_DESIGN_SYSTEM.md`](docs/FIGMA_DESIGN_SYSTEM.md) (tokens live in `src/index.css`). Three-minute script: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

## Local mode (the default — no backend, no login, no API key)

The complete review workflow runs in the browser. Nothing in this list needs a server, a database, a paid API or an AI service:

- **Demonstration case**: seeded on first load. **About & settings → Demonstration** (and the Cases page) has **Load Demonstration Case** and **Reset Demonstration**. Reset asks for confirmation and removes and rebuilds *only* the synthetic demo case; your own cases are untouched.
- **Documents**: upload (PDF, scanned PDF, PNG/JPEG, TXT, DOCX), search by title or file name, filter by processing status, and download the original file.
- **Detection**: deterministic rules (`src/lib/statements.ts`, `src/lib/detect.ts`). Every finding stores verbatim quotes with document, page, section and character offsets, and each quote is re-verified against the extracted text before it is shown. When nothing is flagged the queue says *"No potential contradictions were detected by the available rules."*, not "no contradictions exist".
- **Review**: Unreviewed → In review → Confirmed / Dismissed / Resolved. Dismiss, resolve and reopen need a reason. Notes and every transition go to an append-only history.
- **Dashboard**: every number on the Overview is counted from the stored documents and findings.
- **Status panel** (About & settings → Application status): mode, persistence (a real IndexedDB write/read probe plus storage usage), OCR (with a self-test button), AI (shows *Unavailable* unless a server reports a configured provider), sync and data classification. Nothing is shown as working unless it has been checked.
- **Exports** (Overview → Export & backup): JSON case report, findings CSV (spreadsheet-formula-safe), and a full backup containing originals, extracted text, findings and review history. File names carry `-SYNTHETIC` for the demo case.
- **Restore** (Cases → Restore from backup): the file is schema-validated, file hashes and evidence quotes are re-checked, and it is always restored **as a new case**. Nothing existing is overwritten; an invalid file changes nothing.
- **Offline**: a service worker (`public/sw.js`) caches the app shell, the OCR engine and language data, pdf.js and the demo files, so after one online visit the app reloads and works with no network.

Local data lives in this browser profile only. Clearing site data deletes it, so use **Full backup** to keep a copy.

## Workflow

```
Upload (PDF · scanned PDF · PNG/JPEG · TXT · DOCX)
  → validate (extension, MIME, magic bytes, size, duplicates)
  → extract text (pdf.js text layer · OCR for pages without one · mammoth · UTF-8)
  → extract clinical statements (deterministic rules, exact character offsets)
  → compare across documents of the SAME case (polarity, values, units, dates, history, documented changes)
  → [optional] AI-assisted reasoning via the server → schema-validated → quotes re-verified
  → findings in the Review Queue (explicit conflict · potential discrepancy · historical/contextual · insufficient evidence)
  → evidence inspection (verbatim quotes, verified pages, OCR confidence, original page)
  → reviewer decision + reason (+ notes)
  → persisted locally, or on the shared workspace for authorised collaborators
  → audit history and case timeline
```

## Feature details

### OCR for scanned records
- Each PDF page is first read from its text layer. Pages with fewer than 20 non-space characters are rendered with pdf.js, one page at a time (about 200 DPI, canvas released afterwards), and read by **Tesseract.js 6** (LSTM, English, `eng` best-int model).
- The worker, WASM core and language data are copied into `public/ocr/` at build time and served from the app's own origin, with no CDN at runtime.
- Provenance kept for every OCR page: page number, `method: 'ocr'`, the engine's mean confidence, and the character span of every word below **70%** confidence.
- Uncertainty handling:
  - OCR quotes are labelled "OCR text" with the lowest word confidence.
  - Evidence from OCR is never rated above *moderate* availability.
  - A finding that depends on a low-confidence word is downgraded to **insufficient evidence** ("OCR text requires review").
  - A medication line with a unit but no readable number (e.g. a smudged dose) is reported as *unable to determine the value reliably*. The value is never guessed.
- Reviewers can open **Compare OCR text with original**, which renders the stored page next to the text. Low-confidence words are underlined in the text view.
- Statuses: Uploaded → Extracting → *Running OCR (page n of m)* → Extracted / Needs attention / Failed. Failures, timeouts and blank scans are reported, not hidden.
- The confidence values are the ones reported by Tesseract. None are invented.

### Deterministic analysis (unchanged core, still the default)
Rules for allergies (incl. NKDA), medications (dose, unit normalization, frequency, route, discontinuation, documented changes), diagnoses (negation, history, hedging), labs (same-specimen-date comparison only), procedures and smoking status. Family history is excluded. A finding is created only when every quotation re-verifies at its exact offsets.

### AI-assisted reasoning (optional)
- **Server-side only.** `server/aiProvider.ts` uses the official `@anthropic-ai/sdk` with structured outputs (`betaZodOutputFormat`), model `claude-opus-5-5` by default, adaptive effort `medium`, server-side refusal fallback, a 120 s timeout and one retry. The API key is read from `ANTHROPIC_API_KEY` on the server and never reaches the browser.
- **The model only proposes.** `src/lib/ai.ts` validates the schema, then:
  - keeps a quotation only if it is found verbatim in the supplied document text (whitespace-tolerant match is flagged);
  - takes the quote text from the source, not from the model;
  - rejects findings with no verifiable quote;
  - downgrades one-sided conflicts to insufficient evidence;
  - drops dates that do not appear in the quotes or document dates;
  - derives page numbers only from verified PDF page spans;
  - skips "consistent" items and AI findings that merely corroborate a rules finding.
- The browser re-runs the same verification against its own copy of the text before storing anything.
- AI findings are labelled **AI-assisted**, their explanation is marked "AI-generated interpretation — not evidence", and they always start *unreviewed*.
- Errors map to clear messages without exposing secrets: not configured (503), provider rate limit (429), timeout (504), auth failure, refusal, malformed output. The deterministic analysis is always unaffected.
- A consent dialog explains what is sent and to whom before any text leaves the browser.

### Shared workspace (multi-user)
- `server/` is a dependency-light Node 22 API on built-in `node:sqlite`:
  - **Accounts:** scrypt password hashes; opaque bearer tokens stored only as SHA-256 hashes, with expiry (default 8 h).
  - **Roles:** owner, reviewer and viewer per case, enforced on every request. Non-members get 404, so case IDs can't be probed; insufficient roles get 403.
  - **Sharing:** the owner adds registered users by email.
  - **Snapshot sync (merge):** documents, statements and findings are re-verified against the stored text on the server, so tampered evidence is rejected with 422. Evidence for a removed document must equal what is already stored. Documents are deleted only when explicitly listed, and findings are superseded only when explicitly marked stale, so a stale client cannot erase another reviewer's work. MIME types are derived server-side from a whitelisted file kind. Review status is never taken from a snapshot.
  - **Review transitions:** use the same state machine as the browser, with **optimistic concurrency**. A decision made on a stale view returns 409 and the client refreshes.
  - **Original files:** stored privately on disk under validated IDs (no path traversal) and served only to members.
  - **Audit log:** append-only, enforced by SQLite triggers that reject `UPDATE`/`DELETE`. Timestamps are generated by the server.
  - **Hardening:** CORS allow-list, body-size limits, login and AI rate limits, no stack traces in responses, no document contents in logs.
- The browser treats the server as the source of truth for shared cases. Its IndexedDB copy is a cache, refreshed by **polling every 15 s** and on window focus. This is not real-time push.
- Background refresh pauses during local uploads and analysis, and stays paused while a case has **unsynced local changes** (for example after a failed push). The UI then shows "unsynced changes" with a **Retry sync** button, so local work is never overwritten.

## Architecture

```
┌────────────────────────── Browser (static SPA, GitHub Pages) ───────────────────────────┐
│ React + TypeScript + Tailwind                                                            │
│ Ingestion: pdf.js · Tesseract.js OCR (self-hosted) · mammoth · UTF-8                      │
│ Rules engine (src/lib/statements.ts, detect.ts) · AI verifier (src/lib/ai.ts)             │
│ IndexedDB (Dexie): local cases + cache of shared cases                                    │
└───────────────┬─────────────────────────────────────────────────────────────────────────┘
                │ HTTPS + Bearer token (only when a workspace server is configured)
┌───────────────▼──────────── server/ (Node 22, node:http, node:sqlite) ──────────────────┐
│ /api/auth/*  /api/cases/*  /api/findings/*/transition|notes  /api/ai/analyze  /health    │
│ SQLite: users · sessions · cases · case_members · documents · statements · findings ·     │
│         audit_events (append-only triggers) · private files dir                           │
│ AI adapter → Anthropic Messages API (structured outputs), key from env                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model, state machine and sync design.

## Running locally

Requires Node.js 22.13 or later (for `node:sqlite`).

```bash
npm ci
npm run dev                       # frontend at http://localhost:5173 (local demo mode)
npm run build && npm run preview  # production build at http://localhost:4173 (service worker active)
npm test                          # unit + integration tests (Vitest)
npm run test:e2e                  # browser tests (Playwright; builds the app first)

# optional shared workspace + AI
CLINISCOPE_ALLOW_REGISTRATION=true \
CLINISCOPE_ALLOWED_ORIGINS=http://localhost:5173 \
ANTHROPIC_API_KEY=<your key, optional> \
npm run server                    # API at http://localhost:8787
```

Then open **About & settings → Shared workspace**, enter `http://localhost:8787`, click **Connect**, and create an account.

Other commands:

| Command | Purpose |
|---|---|
| `npm run build` | type-check, copy OCR/pdf.js assets, production build to `dist/` |
| `npm test` | Vitest: engine, extraction, **real OCR**, AI verification, API integration tests |
| `npm run test:e2e` | Playwright: builds the app and starts two real API servers plus a local fake AI provider |
| `BASE_URL=<live url> npm run smoke` | e2e suite against a deployed frontend (shared/AI specs skip without an API URL) |
| `npm run server:build && npm run server:start` | self-contained production server bundle (`dist-server/server.mjs`, no node_modules needed) |
| `CLINISCOPE_NEW_USER_PASSWORD=… npx tsx server/index.ts create-user alice@example.org "Alice"` | create an account when registration is disabled |
| `npm run demo:generate` | regenerate synthetic documents, including the rendered scans |

### Environment variables
See [`.env.example`](.env.example). It contains placeholders only. Frontend `VITE_*` values are public. Server variables: `PORT`, `CLINISCOPE_DATA_DIR`, `CLINISCOPE_ALLOWED_ORIGINS`, `CLINISCOPE_ALLOW_REGISTRATION`, `CLINISCOPE_SESSION_TTL_HOURS`, `CLINISCOPE_MAX_UPLOAD_MB`, `ANTHROPIC_API_KEY`, `CLINISCOPE_AI_MODEL`, `CLINISCOPE_AI_TIMEOUT_MS`, `CLINISCOPE_AI_FALLBACKS`.

### Database and migrations
The server creates `CLINISCOPE_DATA_DIR/cliniscope.db` and applies versioned migrations at start-up (`server/db.ts`). Mount the data directory on a persistent volume in production.

## Deployment

- **Frontend:** `.github/workflows/ci-deploy.yml` runs on every push: type-check, unit tests, build, then the full Playwright suite including OCR, two-user and AI-pipeline tests. It then publishes `dist/` to `gh-pages`, and finally runs the e2e suite against the live GitHub Pages URL (`verify-production`).
- **API server:** not deployed. No hosting credentials were available, and GitHub Pages cannot run a server. Two ready-to-use options:
  - `Dockerfile`: `docker build -t cliniscope-api . && docker run -p 8787:8787 -v cliniscope-data:/data -e CLINISCOPE_ALLOWED_ORIGINS=https://anirudhleetcode-max.github.io cliniscope-api`
  - `render.yaml`: a Render Blueprint (Docker service with a persistent disk). Set `ANTHROPIC_API_KEY` in the dashboard to enable AI.

  The self-contained bundle (`npm run server:build`) was verified to start and serve `/api/health` without `node_modules`. The Docker image is built and its container health-checked in CI on every push (`docker-api` job). The Render blueprint has not been run. Once deployed, enter its HTTPS URL in the live app (About & settings), or set `VITE_API_BASE_URL` at build time.

## Synthetic demonstration workspace
Six fictional cases (16 records). **DEMO-0042** is ingested but not analysed, so the analysis can be shown live. The other five are ingested and analysed on first load by the same rules engine, and a few carry clearly labelled *seeded* review decisions:

| Case | Demonstrates | Findings (from the rules) |
|---|---|---|
| DEMO-0107 | warfarin listed as active after a documented switch; codeine allergy vs "no known drug allergies"; atrial fibrillation documented vs denied | 3 |
| DEMO-0118 | documented levothyroxine dose increase (harmless temporal change) | 1 |
| DEMO-0125 | insulin dose illegible on a fax; unverified contrast reaction (missing / uncertain information) | 2 |
| DEMO-0131 | date of birth 7 Mar vs 3 Jul 1958 (day/month swap); two INR values for one specimen date | 2 |
| DEMO-0144 | heart failure documented vs denied; furosemide 40 mg vs 20 mg | 2 |

Their texts are in `src/lib/demoWorkspace.ts`, and `tests/unit/workspace.test.ts` asserts each expected finding and that every quote matches its document text.

### DEMO-0042
`DEMO-0042 · Synthetic Patient SP-0042`, labelled *DEMO CASE — SYNTHETIC DATA — NOT A REAL PATIENT* and *Fictional demonstration data. Not for clinical use.* All five files in `public/demo/` go through the real pipeline:

| Document | Format | Date | Notes |
|---|---|---|---|
| Discharge Letter (scanned copy) | **image-only PDF → OCR** | 20 Nov 2025 | earlier admission; the atorvastatin dose is deliberately smudged |
| Laboratory Report | PDF | 11 Mar 2026 | |
| Discharge Summary (2 pages) | PDF | 12 Mar 2026 | |
| Medication Reconciliation | TXT | 14 Mar 2026 | |
| Patient Intake Form | DOCX | 15 Mar 2026 | |

The pipeline produces 10 findings. Each expectation below is asserted in the tests:
- **Penicillin allergy vs "No known drug allergies":** explicit conflict, with quotes from the discharge summary (page 2), the medication reconciliation and the **OCR'd scan**.
- **Metformin 500 mg vs 1000 mg:** potential discrepancy; neither dose is called wrong.
- **Lisinopril 10 → 20 mg with "increased from 10 mg":** historical/contextual difference.
- **Atorvastatin dose unreadable on the scan:** insufficient evidence. The value is not guessed.
- **Sulfa reaction "possible… not verified":** insufficient evidence.
- **Chronic kidney disease documented vs "No history of kidney disease":** explicit conflict.
- **Potassium 5.4 vs 4.4 mmol/L on the same specimen date:** potential discrepancy. The potassium 4.2 from Nov 2025 and HbA1c values from different dates are **not** flagged.
- **Former vs never smoker:** explicit conflict.
- **Aspirin discontinued (discharge summary, 12 Mar) but listed as active (medication reconciliation, 14 Mar):** temporal inconsistency (medication status).
- **Date of birth 14 Feb 1961 vs 4 Feb 1961:** explicit conflict (demographic).
- Diabetes, hypertension, creatinine and the typed atorvastatin entries agree and are not flagged.

Extra samples for uploads: `sample-follow-up-note-2026-03-20.txt`, `sample-mixed-text-and-scan-2026-03-22.pdf` (page 1 digital, page 2 scanned), `scanned-discharge-letter-2025-11-20.png`, `sample-scanned-no-text-layer.pdf` (blank scan).

## Judge demo
See [`docs/JUDGE_DEMO.md`](docs/JUDGE_DEMO.md) for the three-minute script.

## Security & privacy
- Uploaded content is untrusted and rendered only as text, never as HTML. The Content-Security-Policy is strict; `connect-src` permits HTTPS API servers and localhost.
- In local mode, original files never leave the browser and get only temporary object URLs. In shared mode they are stored privately on the server and served only to case members.
- The AI key is server-only. Documents are sent to the external provider only after explicit consent, and only synthetic data should be used. Provider data retention depends on the operator's account and is not verified by CLINISCOPE.
- **Limitations:**
  - no SSO, MFA, password reset or email verification;
  - bearer tokens are kept in `sessionStorage`, which is vulnerable to XSS on the same origin (mitigated by the CSP);
  - no encryption at rest beyond the host's disk;
  - the audit log is append-only at the database level but not cryptographically tamper-evident;
  - rate limiting is in memory, per process.

  Not suitable for real patient data.

## Known limitations
- Local mode is single-user and per browser. It is not collaboration, and nothing is encrypted beyond what the browser provides.
- The detection rules are a fixed vocabulary, not clinical NLP. They have not been clinically validated, and precision and recall on real records are unknown.
- Offline mode needs one complete online visit first. The OCR engine and English language data (about 7 MB) are cached in the background, so offline OCR works only once that has finished.
- Rules vocabulary is limited (about 25 drugs, 14 allergens, 14 diagnoses, 10 lab tests). OCR is English only, with no handwriting, and takes a few seconds per page in the browser.
- AI-assisted reasoning has not been validated against a live model in this build, so its real-world precision is unknown.
- Shared state refreshes by polling, not real-time push. The API server is not publicly deployed.
- Shared-case sync merges by document and finding. Deletions are explicit, so a stale client never removes data it has not seen. Two reviewers editing the same document's metadata at once is still last-writer-wins.
- The local cache is per browser profile, not per signed-in user. Two accounts in tabs of the **same** browser profile share one cache, so use separate browser profiles or a private window for the second reviewer.
- Creating a shared case with a client-chosen ID that already exists returns 409, which reveals that the ID exists. IDs are 64-bit random values.
- Publishing a local case that already has review decisions or notes is refused, because that history cannot be imported into the server's audit trail.

License: MIT.
