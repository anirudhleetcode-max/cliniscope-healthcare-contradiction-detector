# MEDGUARD — Technical Overview

> **Database update (after this audit):** the optional server now uses **PostgreSQL** instead of SQLite: an external server via `DATABASE_URL` (a free Neon project in the prepared deployment), or embedded PGlite for local use. Original files are stored in the database (`document_files`, schema v3). Where this page says SQLite, `node:sqlite`, `medguard.db` or a files directory, read PostgreSQL / `document_files`; the tables, constraints, roles and append-only triggers are otherwise unchanged. Current sources: [`docs/backend/DATABASE_ARCHITECTURE.md`](../backend/DATABASE_ARCHITECTURE.md) and [`docs/backend/DEPLOYMENT.md`](../backend/DEPLOYMENT.md).

**Healthcare Record Contradiction Detector** · *Find contradictions. Preserve clinical context. Support better decisions.*

> **Audit basis:** branch `claude/optimistic-tesla-466st5`; code audited at commit `a77a427` on 2026-10-09. The identifier renames from base commit `16ebafa` were merged in afterwards and are reflected below; checks were re-run on the merged tree (see §5). Every claim below cites repository files. Anything not verifiable from the repository is labelled **UNKNOWN** or **INFERENCE**.
> **Naming:** the product name rendered by the application is **MEDGUARD** (`index.html`, `AppShell.tsx`, `BrandMark.tsx`). Internal identifiers also use `medguard` / `MEDGUARD_*` since commit `16ebafa`. Only the GitHub repository name, and therefore the Pages URL, keeps the original `cliniscope-healthcare-contradiction-detector`.

## Documentation map

| Document | Contents |
|---|---|
| [TECHNOLOGY_STACK.md](TECHNOLOGY_STACK.md) | Master stack table with exact versions, direct vs transitive dependencies, evidence |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component responsibilities, five Mermaid diagrams, storage schemas |
| [DATA_FLOW_AND_WORKFLOW.md](DATA_FLOW_AND_WORKFLOW.md) | Execution modes, detection pipeline, storage matrix, user journey, review lifecycle |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, typography, components, responsive behaviour, accessibility, screenshots |
| [DEPLOYMENT_AND_CI_CD.md](DEPLOYMENT_AND_CI_CD.md) | Hosting, CI jobs, environment variables, verification status |
| [SECURITY_AND_LIMITATIONS.md](SECURITY_AND_LIMITATIONS.md) | Controls, privacy boundaries, gaps, limitations |
| [API_REFERENCE.md](API_REFERENCE.md) | Every route of the optional API server |
| [TECHNICAL_PRESENTATION_OUTLINE.md](TECHNICAL_PRESENTATION_OUTLINE.md) | Ten-slide outline for a technical presentation |
| [diagrams/](diagrams/) | Editable `.mmd` sources: `architecture`, `data_flow`, `deployment`, `detection_pipeline` |
| [screenshots/](screenshots/) | 18 screenshots (9 screens × desktop 1440×900 and mobile 390×844), captured in this audit |

## 1. Executive summary

MEDGUARD helps a human reviewer find **statements that disagree across several clinical documents of the same (synthetic) patient**. It shows the exact source evidence for each disagreement and records an auditable review decision.

It is a **browser-first React + TypeScript single-page app** that runs entirely on the client in its default mode. Here is what happens to a document:

1. Uploaded files (PDF, DOCX, TXT, PNG/JPEG) are parsed in the browser with pdf.js, mammoth and Tesseract.js OCR.
2. A **deterministic, rules-based engine** turns the text into structured clinical statements, each with exact character offsets.
3. The engine compares those statements across documents and classifies each difference: explicit conflict, potential discrepancy, temporal inconsistency, historical/contextual difference, or insufficient evidence.
4. Every finding carries verbatim, re-verifiable quotations.
5. A reviewer records a decision (a reason is required where appropriate). Each change is appended to an audit log.
6. All data lives in the browser's **IndexedDB**.

Two **optional** capabilities exist in code and tests but are **not deployed**:

- A **Node 22 + SQLite API server** for multi-user shared review with roles.
- **AI-assisted reasoning** through the Anthropic API. The server holds the key, and every AI-proposed quote is re-verified against the source text.

The system does not diagnose and does not decide which record is correct.

## 2. Stack at a glance

| Layer | Technology (exact version) | Status |
|---|---|---|
| Frontend framework | React 18.3.1, TypeScript 5.6.3 | IMPLEMENTED, VERIFIED |
| Build tool | Vite 5.4.21 (`@vitejs/plugin-react` 4.3.4); npm | VERIFIED (local build exit 0) |
| Routing | react-router-dom 6.28.0, `HashRouter` | IMPLEMENTED |
| Styling | Tailwind CSS 3.4.17 over CSS-variable design tokens; Inter Variable 5.3.0; lucide-react 0.460.0 icons | IMPLEMENTED |
| State | React Context + Dexie live queries (`dexie-react-hooks` 1.1.7). No Redux | IMPLEMENTED |
| Browser storage | IndexedDB via Dexie 4.0.10; localStorage and sessionStorage for small settings and the session token | IMPLEMENTED |
| Document processing | pdfjs-dist 4.10.38, mammoth 1.8.0, tesseract.js 6.0.1 (English, self-hosted assets) | IMPLEMENTED |
| Detection | Deterministic rules: lexicons + regular expressions + structured comparison (`src/lib/statements.ts`, `detect.ts`) | IMPLEMENTED. Not ML |
| AI (optional) | `@anthropic-ai/sdk` 0.132.1, structured outputs validated with zod 4.6.5; default model id `claude-opus-5-5` | IMPLEMENTED against a fake provider; **live calls NOT VERIFIED** |
| Backend (optional) | Node.js 22, `node:http` (no framework), `node:sqlite`, `node:crypto` scrypt | IMPLEMENTED and tested locally; **NOT DEPLOYED** |
| Database | Browser: IndexedDB. Optional server: SQLite file. No PostgreSQL, MongoDB or managed DB | IMPLEMENTED |
| Frontend hosting | GitHub Pages (`gh-pages` branch) | VERIFIED via CI `verify-production` |
| Frontend hosting (second) | Vercel project `medguard` (GitHub app, configured outside the repo; no `vercel.json`) | Production deployment of `16ebafa` recorded as `success`; previews on PRs. Domain and settings UNKNOWN |
| API hosting | Dockerfile (built and health-checked in CI); `render.yaml` | CONFIGURED BUT NOT VERIFIED |
| CI/CD | GitHub Actions "CI and deploy": test, docker-api, deploy, verify-production | VERIFIED (run #30 green) |
| Testing | Vitest 2.1.8 (88 tests), Playwright 1.56.1 (24 tests) | VERIFIED in this audit |

## 3. Frontend, backend, database and deployment breakdown

- **Frontend.** About 11 pages and 14 routes under `src/pages`. Shell, review and UI primitives under `src/components`. Domain logic under `src/lib`, as pure TypeScript shared with tests and the server. Entry point: `src/main.tsx`.
- **Backend.** `server/index.ts` (entry and `create-user` CLI), `server/app.ts` (16 routes, auth, CORS, validation, authorization, audit), `server/db.ts` (SQLite schema and migrations), `server/auth.ts`, `server/aiProvider.ts`. **Optional.** The default demo never contacts it.
- **Database.** IndexedDB database `medguard` with six tables: cases, documents, files, statements, findings, events. The optional server adds a SQLite `medguard.db` with eight tables plus append-only triggers on `audit_events`.
- **Deployment.** The static `dist/` is published to GitHub Pages from the default branch by GitHub Actions, then smoke-tested in production with Playwright. The API container is only built and health-checked in CI.

## 4. Implementation status

| Capability | Status |
|---|---|
| Upload validation, PDF/DOCX/TXT extraction, OCR for scanned PDFs and images | IMPLEMENTED, VERIFIED (unit + e2e) |
| Rules-based statement extraction and cross-document detection | IMPLEMENTED, VERIFIED |
| Evidence verification (exact character offsets; re-checked on analysis, sync, restore, AI) | IMPLEMENTED, VERIFIED |
| Review state machine with required reasons, notes, append-only audit | IMPLEMENTED, VERIFIED |
| Dashboard, Contradictions explorer, Review Queue, Documents, Activity, Ctrl+K search | IMPLEMENTED, VERIFIED (e2e) |
| Exports (JSON report, CSV, full backup) and validated restore | IMPLEMENTED, VERIFIED |
| Offline use after first load (service worker) | IMPLEMENTED, VERIFIED (e2e offline reload) |
| Synthetic demo workspace (6 cases, 16 records) | IMPLEMENTED, VERIFIED |
| Shared workspace (accounts, roles, sync, two-reviewer audit) | IMPLEMENTED, VERIFIED locally; NOT DEPLOYED |
| AI-assisted reasoning | IMPLEMENTED with a fake provider; live model NOT VERIFIED |
| SSO, MFA, encryption at rest, clinical terminologies, FHIR, EHR integration | NOT IMPLEMENTED |
| Clinical validation of detection accuracy | NOT DONE (precision and recall UNKNOWN) |

## 5. Checks run in this audit (2026-10-09)

| Check | Command | Result |
|---|---|---|
| Dependency install | `npm ci` | exit 0 |
| Type check | `npm run typecheck` | exit 0 |
| Unit / integration | `npm test` | **88 passed / 88**, 9 files |
| Production build | `npm run build` | exit 0. Assets referenced as `./assets/…` |
| Browser E2E | `npx playwright test` (Chromium, `CHROMIUM_PATH=/opt/pw-browsers/chromium`) | **24 passed / 24** (23 desktop + 1 mobile), 2.6 min |
| Responsive QA | Custom Playwright script, 9 screens × 2 viewports | 0 px horizontal overflow on all 18 |
| Lint | n/a | **Not configured** (no ESLint/Prettier config in the repo) |
| Coverage | n/a | **Not configured.** No coverage claim is made |
| CI for `a77a427` | GitHub Actions API | All 4 jobs succeeded |

### What the tests cover

| Suite | Tests | Covers |
|---|---|---|
| `tests/unit/detect.test.ts` | 16 | Detection rules, case isolation, dose normalization, hedging, family history, discontinuation, date of birth; DEMO-0042 evidence consistency; page numbers only for PDFs |
| `extract.test.ts` | 10 | Upload validation, TXT/PDF/DOCX extraction, corrupt and scanned PDFs |
| `ocr.test.ts` | 9 | Real Tesseract.js: scanned, mixed and blank PDFs; PNG; low-confidence downgrade; unreadable dose |
| `services.test.ts` | 10 | Ingestion, analysis, review transitions, audit, reload persistence, re-analysis, demo reset, search |
| `server.test.ts` | 19 | API auth, CORS, size limits, roles, snapshot verification, two-user review, append-only audit, private files, AI endpoint, Anthropic SDK against a local fake |
| `sync.test.ts` | 7 | Merge-not-replace sync, unsynced protection, MIME derivation, AI supersede |
| `ai.test.ts` | 6 | AI output verification, fabricated-quote rejection, downgrades, corroboration |
| `export.test.ts` | 5 | Report, CSV (formula neutralisation), backup and restore round trip, corrupted-backup rejection |
| `workspace.test.ts` | 6 | Local state machine, seeded workspace coherence, dashboard metrics |
| `tests/e2e/*.spec.ts` | 23 + 1 | Judge journey, offline, empty states, reset, backup/restore, document search, navigation without console errors, Ctrl+K, filters, queue decisions, OCR in browser, two-reviewer shared case, outsider access, AI consent/verification, mobile overflow |

**Not tested:** live Anthropic calls; the Render deployment; real clinical records; automated accessibility (axe); load and performance; browsers other than Chromium; component-level React tests.

## 6. Open questions / not verifiable from the repository

1. **Product-name spelling.** The code says **MEDGUARD** (commit `a77a427` changed MEDGAURD → MEDGUARD). The request for this audit uses both "MEDGuard" and "MEDGAURD". The documentation follows the code.
2. **Live site.** The GitHub Pages URL could not be opened from the audit sandbox (egress proxy 403). Its status relies on CI's `verify-production` result.
3. **Default branch** is `claude/fervent-euler-bsgy2t` (confirmed from repository metadata).
4. **Provider data retention** for the AI path is UNKNOWN.
5. **Render** blueprint behaviour, cost and plan are unverified.
6. **Clinical accuracy** on real data is unknown.
7. **Vercel.** A `medguard` Vercel project deploys this repository (production: `16ebafa`, `success`; previews on PRs). Its production domain and settings are not in the code.
8. **Backend v1.2.** PR #3 was merged into the default branch as `38e3a54`. It extends the API; see §7.

## 7. Backend v1.2 (PR #3, merged as `38e3a54`)

Sections 1–6 were audited against API v1.1: 16 routes, 88 unit tests and a five-status server state machine.

PR #3 (`claude/medguard-backend`), merged into the default branch as `38e3a54`, extends the optional server. Where the sections above give v1.1 figures, these supersede them:

| Change | Detail |
|---|---|
| Readiness and API description | `GET /api/ready` (503 unless the database is reachable and migrated); `/health` and `/ready` aliases; `GET /api/openapi.json`, which a test checks against the registered routes |
| New read endpoints | Document metadata, findings with filters, one finding, evidence (each quote re-verified), decision history, case and cross-case activity |
| Case management | `PATCH /api/cases/:id` to rename, archive or restore; archived cases are read-only (409); paginated and searchable case list |
| Review outcomes | The server accepts all **eight** outcomes; the database CHECK is widened by migration v2, which preserves existing rows |
| Route count | 29 routes in total |
| Tests | 12 backend tests added (100 in total): migrations, constraints, persistence across a restart, authorization. Docker CI also checks `/api/ready` before and after a container restart |
| Docs | Operator docs in `docs/backend/` |

The backend is still **not hosted** anywhere: no hosting-provider credentials are available to this project's automation. See `DEPLOYMENT_AND_CI_CD.md`.

## 8. Free deployment architecture (database moved to PostgreSQL)

Free hosting tiers have no persistent disk, so the server's SQLite file and files directory could not survive there. The server was therefore moved to PostgreSQL:

| Item | Now |
|---|---|
| Database driver | node-postgres when `DATABASE_URL` is set; embedded PGlite otherwise (`server/db.ts`) |
| Schema | v1–v3 in PostgreSQL dialect. v3 adds `document_files` (original files in the database) |
| Start-up guard | `MEDGUARD_REQUIRE_DATABASE_URL=true` refuses to start without an external database |
| API version | 1.3.0. `/api/ready` reports `engine` and `storage` (`external` / `embedded`). 503 `database_unavailable` when the database is down |
| Prepared hosting | Render **free** web service (`render.yaml`) + Neon **free** PostgreSQL: ₹0, no disk needed |
| Status | **Not deployed**: needs the owner's two free accounts ([guide](../backend/DEPLOYMENT.md)) |
| Tests | 106 unit and integration tests on PGlite. The 44 API and database tests also run against a real PostgreSQL 16 (locally and in CI). The CI Docker job proves data survives replacing the container when no volume is used |

