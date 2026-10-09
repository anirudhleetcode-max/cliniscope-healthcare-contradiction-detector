# MEDGUARD — Technical Presentation Outline (10 slides)

> Every point is backed by the documents in this folder. Keep the "status" wording intact when presenting.

## Slide 1 — MEDGUARD overview
- MEDGUARD: Healthcare Record Contradiction Detector. *Find contradictions. Preserve clinical context. Support better decisions.*
- Compares statements across one patient's documents and shows **verbatim, re-verifiable evidence** for every difference.
- A human records each decision. The system never diagnoses or picks the "correct" record.
- Runs fully in the browser on synthetic data. Live on GitHub Pages (CI verifies the deployment); Vercel also reports a successful production deployment.

## Slide 2 — Problem and motivation
- The same patient's records (discharge summary, intake form, medication reconciliation, labs, scanned letters) disagree: allergies, doses, medication status, dates of birth.
- Reviewers need to see *where* each claim came from and whether a difference is a real conflict, a documented change, or just unreadable.
- Demo case DEMO-0042 has 5 documents in 5 formats (including an OCR'd scan) and produces 10 findings, each asserted in tests.

## Slide 3 — Frontend technology stack
- React 18.3.1 + TypeScript 5.6.3 + Vite 5.4.21; `HashRouter` (react-router-dom 6.28.0).
- Tailwind CSS 3.4.17 over CSS-variable tokens (teal `#176B67`); Inter Variable; lucide-react icons; dependency-free SVG charts.
- State: React Context + Dexie live queries. No Redux, no Axios.
- Documents: pdf.js 4.10.38, mammoth 1.8.0, Tesseract.js 6.0.1 OCR, all self-hosted (strict CSP, works offline).

## Slide 4 — Backend and API architecture
- **Default: no backend.** The local demo mode makes no API calls.
- **Optional server:** Node 22 `node:http` (no framework), 29 REST/JSON routes (v1.2, PR #3) with an OpenAPI 3.1 document, readiness check, bearer sessions (scrypt, SHA-256 token hashes), per-case roles (owner, reviewer, viewer), CORS allow-list, Zod validation.
- The server re-verifies every quotation it receives (and again on every evidence read), owns the review state with all eight outcomes (optimistic concurrency, 409 on conflict), and supports archiving instead of deletion.
- Status: implemented and tested locally (integration + two-browser e2e). **Not deployed publicly.**

## Slide 5 — Database and persistence
- Browser: IndexedDB `medguard` with 6 tables (cases, documents, files, statements, findings, events). Survives reload; per device; no encryption.
- Optional server: SQLite (`node:sqlite`, WAL), two versioned migrations (upgrade tested with existing rows), **append-only `audit_events` enforced by DB triggers**; data verified to survive a server restart.
- Backup: manual JSON export including originals; restore re-checks every quote and SHA-256.
- Not a production database. No external or managed DB.

## Slide 6 — Contradiction-detection engine
- Deterministic rules, **not ML**: section-aware segmentation → lexicons (14 allergens, 26 medications, 14 diagnoses, 10 labs, 7 procedures) → negation, hedging, temporality, doses (normalized to mg), specimen dates.
- Seven comparators produce 5 finding types: explicit conflict, potential discrepancy, temporal inconsistency, historical/contextual, insufficient evidence.
- Safety rules:
  - no finding unless every quote is re-located at its offsets;
  - low-confidence OCR is downgraded to insufficient evidence;
  - unreadable values are never guessed;
  - lab values from different dates are not flagged.
- Optional AI pass: model proposals are kept only if their quotes are found verbatim, and are labelled `AI-XXXX`. Tested with a fake provider only.

## Slide 7 — Architecture diagram
- Show Diagram A from `ARCHITECTURE.md` (source: `diagrams/architecture.mmd`).
- Message: the whole product sits in the browser box; the server and AI are dotted, optional extensions.

## Slide 8 — User workflow
- Open the app → synthetic workspace auto-seeds → Overview metrics → open DEMO-0042 → **Analyze documents** → open "Penicillin allergy documented in one record, absent in another" → compare side A and side B quotes → "View in source" → decide (confirm, dismiss, needs info, expected change, unable to determine, resolve) with a reason → add a note → the queue, dashboard and Activity update live → reload: everything persists → export a JSON, CSV or backup.

## Slide 9 — Deployment and CI/CD
- GitHub Actions "CI and deploy" on every push: typecheck → 100 unit/integration tests → build → 24 Playwright tests (with real local API + fake AI) ∥ Docker image build + `/api/health` and `/api/ready` checks, including after a container restart.
- On the default branch: publish `dist/` to `gh-pages`, then run e2e **against the live Pages URL**.
- Run #31 (`16ebafa`, default branch): all four jobs green. Runs #36/#37 (`5a6400a`, backend PR): test and Docker jobs green. API image is not pushed or hosted; the Render blueprint has never been run.

## Slide 10 — Security, testing and limitations
- Implemented:
  - strict CSP;
  - no `innerHTML`;
  - upload magic-byte checks;
  - server-only AI key with an explicit consent dialog;
  - prompt-injection guard + quote verification;
  - append-only audit;
  - role checks with 404 for non-members.
- Tested: 100 unit/integration + 24 e2e passing in this audit; 0 px overflow on 9 screens at desktop and mobile sizes.
- Limits:
  - synthetic data only, no compliance claims;
  - no SSO/MFA or encryption at rest;
  - rules vocabulary is fixed and clinically unvalidated;
  - AI not tested against a live model;
  - shared server not deployed;
  - the skip link has a known routing defect.
