# MEDGUARD — Technical Overview

**Healthcare Record Contradiction Detector** · *Find contradictions. Preserve clinical context. Support better decisions.*

> **Audit basis.**
> - Branch `claude/medguard-technical-docs`, built on `claude/medguard-backend` @ `5a6400a` (draft PR #3).
> - That branch contains the current default-branch frontend (`16ebafa`) plus the backend v1.2 extension.
> - Audited 2026-10-09. This revision updates the original audit package (PR #2, written at `a77a427`).
> - Every claim cites repository files, test runs or GitHub records. Anything not verifiable is labelled **UNKNOWN** or **INFERENCE**.
>
> **Naming.**
> - The product is **MEDGUARD** (`index.html`, `AppShell.tsx`, `BrandMark.tsx`). It was formerly CLINISCOPE; the request for this audit spells it "MEDGAURD", and the code uses MEDGUARD.
> - Since commit `16ebafa`, internal identifiers also use `medguard` / `MEDGUARD_*`. Only the GitHub repository name, and therefore the GitHub Pages URL path, still carry the former name.

## Documentation map

| Document | Contents |
|---|---|
| [TECHNOLOGY_STACK.md](TECHNOLOGY_STACK.md) | Master stack table with exact versions, direct vs transitive dependencies, evidence |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component responsibilities, five Mermaid diagrams, storage schemas |
| [DATA_FLOW_AND_WORKFLOW.md](DATA_FLOW_AND_WORKFLOW.md) | Execution modes, detection pipeline, storage matrix, user journey, review lifecycle |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, typography, components, responsive behaviour, accessibility, screenshots |
| [DEPLOYMENT_AND_CI_CD.md](DEPLOYMENT_AND_CI_CD.md) | Hosting (GitHub Pages, Vercel), CI jobs, environment variables, verification status |
| [SECURITY_AND_LIMITATIONS.md](SECURITY_AND_LIMITATIONS.md) | Controls, privacy boundaries, gaps, limitations |
| [API_REFERENCE.md](API_REFERENCE.md) | All 29 routes of the optional API server |
| [TECHNICAL_PRESENTATION_OUTLINE.md](TECHNICAL_PRESENTATION_OUTLINE.md) | Ten-slide outline for a technical presentation |
| [diagrams/](diagrams/) | Editable `.mmd` sources: `architecture`, `data_flow`, `deployment`, `detection_pipeline` (identical to the blocks in the documents above) |
| [screenshots/](screenshots/) | 18 screenshots (9 screens × desktop 1440×900 and mobile 390×844) |
| [`../backend/`](../backend/) | Backend operator docs: API reference, database architecture, local setup, deployment, frontend integration, security |

## 1. Executive summary

MEDGUARD helps a human reviewer find **statements that disagree across several clinical documents of the same (synthetic) patient**. It shows the exact source evidence for each disagreement and records an auditable review decision.

It is a **browser-first React + TypeScript single-page app** that runs entirely on the client in its default mode. Here is what happens to a document:

1. Uploaded files (PDF, DOCX, TXT, PNG/JPEG) are parsed in the browser with pdf.js, mammoth and Tesseract.js OCR.
2. A **deterministic, rules-based engine** turns the text into clinical statements, each with exact character offsets.
3. The engine compares those statements across documents and classifies each difference: explicit conflict, potential discrepancy, temporal inconsistency, historical/contextual difference, or insufficient evidence.
4. Every finding carries verbatim, re-verifiable quotations.
5. A reviewer records one of eight review outcomes (a reason is required where appropriate), and each change is appended to an audit log.
6. All data lives in the browser's **IndexedDB**.

Two **optional** capabilities exist in code and tests but are **not deployed**:

- A **Node 22 + SQLite API server** for multi-user shared review: accounts, roles, 29 routes, readiness check, OpenAPI document and versioned migrations.
- **AI-assisted reasoning** through the Anthropic API. The server holds the key, and every AI-proposed quote is re-verified against the source text.

MEDGUARD does not diagnose patients and does not decide which record is correct.

## 2. Stack at a glance

| Layer | Technology (exact version) | Status |
|---|---|---|
| Frontend framework | React 18.3.1, TypeScript 5.6.3 | IMPLEMENTED, VERIFIED |
| Build tool | Vite 5.4.21 (`@vitejs/plugin-react` 4.3.4); npm | VERIFIED (local build exit 0) |
| Routing | react-router-dom 6.28.0, `HashRouter` | IMPLEMENTED |
| Styling | Tailwind CSS 3.4.17 over CSS-variable design tokens; Inter Variable 5.3.0; lucide-react 0.460.0 icons | IMPLEMENTED |
| State | React Context + Dexie live queries (`dexie-react-hooks` 1.1.7). No Redux | IMPLEMENTED |
| Browser storage | IndexedDB `medguard` via Dexie 4.0.10; localStorage and sessionStorage for settings and the session token | IMPLEMENTED |
| Document processing | pdfjs-dist 4.10.38, mammoth 1.8.0, tesseract.js 6.0.1 (English, self-hosted assets) | IMPLEMENTED |
| Detection | Deterministic rules: lexicons + regular expressions + structured comparison (`src/lib/statements.ts`, `detect.ts`) | IMPLEMENTED. **Not ML** |
| AI (optional) | `@anthropic-ai/sdk` 0.132.1; structured outputs validated with zod 4.6.5; default model id `claude-opus-5-5` | IMPLEMENTED against a fake provider; **live calls NOT VERIFIED** |
| Backend (optional) | Node.js 22, `node:http` (no framework), `node:sqlite`, `node:crypto` scrypt; API v1.2 | IMPLEMENTED and tested locally and in CI; **NOT DEPLOYED** |
| Database | Browser: IndexedDB. Optional server: SQLite file (schema v2). No PostgreSQL, MongoDB or managed DB | IMPLEMENTED |
| Frontend hosting | GitHub Pages (`gh-pages` branch) | VERIFIED via CI `deploy` + `verify-production` (run #31) |
| Frontend hosting (second) | Vercel project `medguard` (GitHub app, configured outside the repo) | Production deployment record `success` for `16ebafa`; domain UNKNOWN |
| API hosting | Dockerfile (built and health/readiness-checked in CI); `render.yaml` | CONFIGURED BUT NOT VERIFIED |
| CI/CD | GitHub Actions "CI and deploy": test, docker-api, deploy, verify-production | VERIFIED |
| Testing | Vitest 2.1.8 (100 tests), Playwright 1.56.1 (24 tests) | VERIFIED in this audit |

## 3. Frontend, backend, database and deployment breakdown

- **Frontend.**
  - 11 page modules and 14 routes (plus a 404) under `src/pages`.
  - Shell, review and UI primitives under `src/components`.
  - Domain logic under `src/lib`, as pure TypeScript shared with tests and the server.
  - Entry point: `src/main.tsx`.
- **Backend** (optional; the default demo never contacts it):
  - `server/index.ts`: entry point and `create-user` CLI;
  - `server/app.ts`: 29 routes, auth, CORS, validation, authorization, audit, readiness;
  - `server/db.ts`: SQLite schema and two migrations;
  - `server/openapi.ts`, `server/auth.ts`, `server/aiProvider.ts`.
- **Database.**
  - Browser: IndexedDB database `medguard` with six tables (cases, documents, files, statements, findings, events).
  - Optional server: SQLite `medguard.db` with eight tables plus `schema_version`, and append-only triggers on `audit_events`.
- **Deployment.**
  - GitHub Actions publishes the static `dist/` to GitHub Pages from the default branch, then runs Playwright against the production site.
  - Vercel's GitHub integration also deploys the frontend.
  - The API container is only built and checked in CI.

## 4. Implementation status

| Capability | Status |
|---|---|
| Upload validation, PDF/DOCX/TXT extraction, OCR for scanned PDFs and images | IMPLEMENTED, VERIFIED (unit + e2e) |
| Rules-based statement extraction and cross-document detection | IMPLEMENTED, VERIFIED |
| Evidence verification (exact offsets; re-checked on analysis, sync, restore, AI, evidence reads) | IMPLEMENTED, VERIFIED |
| Review state machine with required reasons, notes, append-only audit | IMPLEMENTED, VERIFIED |
| Dashboard, Contradictions explorer, Review Queue, Documents, Activity, Ctrl+K search | IMPLEMENTED, VERIFIED (e2e) |
| Exports (JSON report, CSV, full backup) and validated restore | IMPLEMENTED, VERIFIED |
| Offline use after first load (service worker) | IMPLEMENTED, VERIFIED (e2e offline reload) |
| Synthetic demo workspace (6 cases, 16 records, 20 findings after analysis) | IMPLEMENTED, VERIFIED |
| Shared workspace (accounts, roles, sync, two-reviewer audit) | IMPLEMENTED, VERIFIED locally and in CI; NOT DEPLOYED |
| Backend v1.2 (readiness, OpenAPI, read endpoints, archive, 8-outcome machine, migration v2) | IMPLEMENTED, VERIFIED by `backend.test.ts`; frontend does not call the new read endpoints yet |
| AI-assisted reasoning | IMPLEMENTED with a fake provider; live model NOT VERIFIED |
| SSO, MFA, encryption at rest, clinical terminologies, FHIR, EHR integration | NOT IMPLEMENTED |
| Clinical validation of detection accuracy | NOT DONE (precision and recall UNKNOWN) |

## 5. Checks run in this audit (2026-10-09, on this branch)

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | exit 0 |
| Unit / integration | `npx vitest run` | **100 passed / 100**, 10 files |
| Production build | `npm run build` | exit 0. Assets referenced as `./assets/…` |
| Browser E2E | `npx playwright test` | **24 passed / 24**, 1.8 min (includes real API servers and a fake AI provider) |
| Responsive QA | Playwright overflow script, 9 viewports × 9 routes (earlier in this session) | No horizontal overflow |
| Lint | n/a | **Not configured** (no ESLint/Prettier config in the repo) |
| Coverage | n/a | **Not configured.** No coverage claim is made |
| CI | GitHub Actions API | #31 (`16ebafa`) all jobs ✓; #36/#37 (`5a6400a`) test + docker-api ✓ |

### What the tests cover

| Suite | Tests | Covers |
|---|---|---|
| `tests/unit/server.test.ts` | 19 | API auth, CORS, size limits, roles, snapshot verification, two-user review, unknown-status rejection, append-only audit, private files, AI endpoint, Anthropic SDK against a local fake |
| `detect.test.ts` | 16 | Detection rules, case isolation, dose normalization, hedging, family history, discontinuation, date of birth; DEMO-0042 evidence consistency |
| `backend.test.ts` | 12 | Migrations (clean, v1→v2 upgrade with rows preserved), FK/CHECK/UNIQUE and append-only triggers, readiness 503, OpenAPI = registered routes, pagination/search, documents, findings filters, verified evidence, 8-outcome transitions, archive read-only, activity paging, authorization, persistence across restart |
| `extract.test.ts` | 10 | Upload validation, TXT/PDF/DOCX extraction, corrupt and scanned PDFs |
| `services.test.ts` | 10 | Ingestion, analysis, review transitions, audit, reload persistence, re-analysis, demo reset, search |
| `ocr.test.ts` | 9 | Real Tesseract.js: scanned, mixed and blank PDFs; PNG; low-confidence downgrade; unreadable dose |
| `sync.test.ts` | 7 | Merge-not-replace sync, unsynced protection, MIME derivation, AI supersede |
| `ai.test.ts` | 6 | AI output verification, fabricated-quote rejection, downgrades, corroboration |
| `workspace.test.ts` | 6 | Local state machine, seeded workspace coherence, dashboard metrics |
| `export.test.ts` | 5 | Report, CSV (formula neutralisation), backup and restore round trip, corrupted-backup rejection |
| `tests/e2e/*.spec.ts` | 24 | Journey (6), workflow (6), workspace (6), shared (2), mobile (2 viewports), AI (1), OCR (1) |

**Not tested:**
- live Anthropic calls;
- any hosted backend (Render or otherwise);
- real clinical records;
- automated accessibility checks (axe);
- load and performance;
- browsers other than Chromium;
- component-level React tests.

## 6. Open questions and items not verifiable from the repository

1. **Product-name spelling.** The code says **MEDGUARD**; this request spells it "MEDGAURD". The documentation follows the code.
2. **Live sites.** The GitHub Pages and Vercel URLs cannot be opened from the audit sandbox (egress proxy). Their status rests on CI's `verify-production` result and on GitHub deployment records.
3. **Vercel settings.** The production domain, build command and production branch are configured outside the repository and are **UNKNOWN**.
4. **Default branch.** It is inferred to be `claude/fervent-euler-bsgy2t` from deploy-job behaviour.
5. **Pending PR.** Backend v1.2 is on `claude/medguard-backend` (draft PR #3) and is not yet merged into the default branch.
6. **AI data retention.** Provider retention is UNKNOWN. Render blueprint behaviour, cost and plan are unverified.
7. **Clinical accuracy** on real data is unknown.
