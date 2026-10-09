# CLINISCOPE

**Evidence-first healthcare record contradiction detection and clinical review.** Built for problem statement **PS-11R3: Healthcare Record Contradiction Detector**.

> **Every flagged discrepancy comes with evidence you can inspect.**
> From fragmented medical records to traceable, human-verified clinical review.

**Live demo:** https://anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector/
Every push builds, tests and publishes `dist/` to the `gh-pages` branch. **One-time setup:** a repository admin must enable *Settings → Pages → Deploy from a branch → `gh-pages` / (root)*. The workflow token is not allowed to change that setting. After that, the `verify-production` job runs the full end-to-end suite against the live URL on every deploy.

> ⚠️ **Hackathon prototype. Review-support tool, not a diagnostic system.** CLINISCOPE flags *possible* inconsistencies and shows the source evidence for each. It never decides which statement is medically correct. It has no regulatory certification and no compliance attestation (HIPAA or other), and it has no authentication. Use **synthetic data only**.

---

## The problem

Clinical information is spread across discharge summaries, intake forms, medication reconciliations, lab reports and notes. These documents can contradict each other, for example *"Penicillin allergy documented"* in one record and *"No known drug allergies"* in another. Reviewers need to find these conflicts, see exactly where each statement came from, understand the dates involved, and record what they decided.

## What CLINISCOPE does

1. **Ingests** PDF (text layer), TXT and DOCX files into a *case*.
2. **Extracts text** in the browser, keeping page spans (PDF), character offsets and line or paragraph positions.
3. **Extracts clinical statements** (allergies, medications with dose, frequency and route, diagnoses, lab results with specimen dates, procedures, smoking status) with transparent, deterministic rules. It handles negation ("no history of…"), hedging ("possible…, not verified"), historical language ("resolved", "as a child") and documented changes ("increased from 10 mg").
4. **Compares statements across documents in the same case only**, considering polarity, normalized values (1 g = 1000 mg), units, document dates and specimen dates.
5. **Classifies** each difference as an *explicit text conflict*, *potential value discrepancy*, *temporal inconsistency*, *historical/contextual difference* or *insufficient evidence*. Consistent records are not flagged.
6. **Attaches verified evidence**. A finding is created only if every quotation can be found again at its exact offsets in the extracted text.
7. **Supports human review**: an explicit state machine with required reasons, reviewer notes, and an append-only audit log.
8. **Persists everything** in the browser's IndexedDB. It survives page reloads.

### The five differentiators

| | |
|---|---|
| Evidence-first detection | Each finding shows verbatim quotes, the document, the document date, a verified page (PDF only), the section heading (only when present) and character offsets. **View in source** highlights the passage in the extracted text. |
| Context-aware comparison | Dates, specimen dates, historical status and documented dose changes change the classification. For example, HbA1c values from different months are not flagged. |
| Transparent uncertainty | Every finding has a rules-generated explanation (labelled as interpretation, separate from quoted evidence), the comparison rule used, temporal caveats and alternative explanations. Evidence quality describes extraction reliability, never clinical truth. |
| Human verification | Begin review → Confirm discrepancy / Resolve / Dismiss. A reason is required to resolve, dismiss or reopen. |
| Auditable workflow | Append-only events for uploads, extraction, analysis runs, finding creation or supersession, status changes and notes, each with a timestamp and actor. |

## Application areas

- **Overview**: metrics derived from stored data (documents, statements, findings, awaiting review, closed, last analysis), the last analysis summary (comparisons, consistent, explained by dates), charts by category, type and status, recent activity, and case records.
- **Review queue**: quick filters (All, Unreviewed, Explicit, Potential, Historical/contextual, Insufficient, Resolved, Dismissed), search over titles, categories and evidence text, category, evidence-quality and date-range filters, and sorting. Filters are kept in the URL.
- **Finding detail**: the evidence investigation workspace (side A vs side B, provenance, verification state, caveats, alternatives, decision controls, notes, audit history).
- **Document library**: drag-and-drop upload with per-file metadata (title, type, document date), validation, processing status, statement and finding counts, deletion with confirmation. The document viewer shows extracted text with verified page markers, line numbers and highlighting, the extracted statements, and the original file.
- **Case timeline**: clinical document dates shown separately from upload, analysis and review timestamps.
- **Cases**: create pseudonymous cases, switch between them, reset the demo case (other cases are not touched).
- **About & settings**: methods, limitations, data handling, supported formats, demo reviewer identity.
- **Run Interactive Demo**: a 12-step guided tour that resumes after a page reload.

## Architecture

```
Browser (single static app: Vite + React + TypeScript + Tailwind)
│
├── UI (src/pages, src/components) ── HashRouter, live queries (dexie-react-hooks)
│
├── Service layer (src/lib/services.ts)
│     uploadDocument → validate → SHA-256 dedupe → store original file → extract → statements → audit
│     analyzeCase    → detect → reconcile findings by fingerprint (keep review state, mark stale) → audit
│     transitionFinding / addReviewerNote → state machine (src/lib/review.ts) → audit
│
├── Extraction (src/lib/extract.ts)         pdf.js text layer | UTF-8 TXT | mammoth DOCX
├── Statement rules (src/lib/statements.ts, lexicon.ts, dates.ts)
├── Detection engine (src/lib/detect.ts)    per-case grouping → comparison → classification → evidence verification
│
└── Persistence (src/lib/db.ts): IndexedDB via Dexie
      cases · documents · files (original blobs) · statements · findings · events (append-only)
```

There is **no backend**. No hosting credentials or managed database were available in the build environment, so the most reliable public deployment was a static app with in-browser processing and storage. A side effect is that documents never leave the reviewer's machine.

### What uses AI vs deterministic rules

**No AI or LLM model is used anywhere.** Statement extraction, normalization, contradiction detection and explanations are all deterministic rules and templates, and the UI says so. An LLM could be added server-side later for normalization, but evidence would still have to be verified against the source text.

## Evidence provenance design

- `ClinicalStatement.originalText === document.extractedText.slice(charStart, charEnd)` always holds. Unit tests check it, and the detection engine re-verifies it before it creates a finding.
- **Page numbers** come only from pdf.js page boundaries (`pageSpans`). TXT and DOCX sources show "Not a paged format". A PDF offset outside the verified spans shows "Source location unavailable".
- **Sections** are recorded only when a heading actually appears in the text.
- Document date (clinical) and upload time are stored and displayed separately. Upload time is never used as a clinical date.
- Resolved findings keep their evidence. If a source document is deleted, its findings keep the quotation recorded at analysis time, are marked *superseded* at the next analysis, and show "Source document unavailable".

## Synthetic demo case

`DEMO-0042 · Synthetic Patient SP-0042`. All data is fictional and labelled *DEMO CASE — SYNTHETIC DATA — NOT A REAL PATIENT*. The files in `public/demo/` are real PDF, DOCX and TXT files generated by `npm run demo:generate` from `scripts/demo-content.mjs`. They go through **the same pipeline as user uploads**. Findings are not precomputed.

| Document | Format | Date |
|---|---|---|
| Discharge Summary (2 pages) | PDF | 12 Mar 2026 |
| Medication Reconciliation Record | TXT | 14 Mar 2026 |
| Patient Intake Form | DOCX | 15 Mar 2026 |
| Laboratory Report | PDF | 11 Mar 2026 |

Expected results (asserted in tests):

| Scenario | Result |
|---|---|
| A: Penicillin allergy (discharge summary p.2, med rec) vs "No known drug allergies" (intake) | Explicit text conflict |
| B: Metformin 500 mg BID (14 Mar) vs 1000 mg BID (15 Mar) | Potential value discrepancy, does not blame either dose |
| C: Lisinopril 10 mg → 20 mg with "increased from 10 mg on 13 March" | Historical / contextual difference, low priority |
| C2: HbA1c 8.2% (Dec 2025) vs 7.4% (11 Mar 2026) | Not flagged (different specimen dates) |
| D: Atorvastatin 20 mg nightly, hypertension, diabetes, creatinine 1.4 | Consistent, not flagged |
| E: "Possible reaction to sulfa… patient unsure, not verified" vs NKDA | Insufficient evidence |
| Extra | CKD documented vs "No history of kidney disease"; potassium 5.4 vs 4.4 mmol/L for the same specimen date; former vs never smoker |

Sample files for trying uploads: `public/demo/sample-follow-up-note-2026-03-20.txt` (adds new findings) and `public/demo/sample-scanned-no-text-layer.pdf` (flagged as *Needs attention*; no OCR is run).

## Two-minute judge demo

1. Open the site. The synthetic demo case loads automatically. Click **Run Interactive Demo** (sidebar), or follow these steps.
2. **Document library**: four records (PDF, DOCX, TXT) with their extracted text.
3. Click **Analyze documents**. A summary appears (statements, comparisons, consistent, explained by dates, findings).
4. **Open Review Queue** → *Penicillin allergy documented in one record, absent in another*.
5. Compare Source A (Discharge Summary, 12 Mar 2026, **Page 2**, section ALLERGIES) with Source B (Intake Form, 15 Mar 2026). Click **View in source** to see the passage highlighted.
6. Open the **metformin** finding (500 mg vs 1000 mg), then the **lisinopril** finding (documented dose change, historical/contextual).
7. On metformin: **Begin review** → add a note → **Mark as resolved** (an empty reason is rejected) → enter a reason.
8. **Reload the page.** The status, reason and note are still there. Check the **Case timeline**.

## Running locally

Requires Node.js 20+ (tested with 22).

```bash
npm ci
npm run dev          # http://localhost:5173
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build on :4173
```

### Tests

```bash
npm test             # Vitest unit/integration tests (engine, extraction, services with fake-indexeddb)
npm run test:e2e     # Playwright end-to-end tests (builds and serves the app automatically)
BASE_URL=https://anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector/ npm run smoke   # same e2e suite against production
```

If Playwright's bundled Chromium isn't installed, set `CHROMIUM_PATH=/path/to/chromium`.

### Environment variables

None are required. See `.env.example`: `VITE_BASE_PATH` (default `./`) and `VITE_MAX_UPLOAD_MB` (default 10). There are no secrets.

### Database setup

None. IndexedDB (`cliniscope` database) is created automatically in the browser. The schema is defined in `src/lib/db.ts` (Dexie versioned schema). **Reset the demo** from *Cases → Reset demo case*. This deletes only the demo case.

### Deployment

`.github/workflows/ci-deploy.yml` runs type-checking, unit tests, the production build and Playwright e2e tests on every push. On the default branch it publishes `dist/` to the `gh-pages` branch, which GitHub Pages serves. The app uses relative asset paths and hash routing, so it works under the `/<repo>/` sub-path and on any static host (Netlify, Vercel, S3, etc.) without configuration.

## Security & privacy

- Uploaded content is untrusted. It is rendered only as React text nodes, never as HTML, and never executed. A strict Content-Security-Policy is set in `index.html`.
- Uploads are validated by extension, MIME type, magic bytes (`%PDF`, ZIP header), size limit and emptiness. Duplicates (SHA-256) are rejected. Filenames are sanitized against path traversal and control characters.
- pdf.js runs with `isEvalSupported: false`. Extraction has a timeout.
- Original files are stored as blobs in IndexedDB and opened only through temporary local object URLs. There are **no public file URLs**.
- Every query is scoped to a case, and the detection engine ignores statements and documents from other cases (tested).
- **Limitations:** no authentication (the reviewer name is a self-declared demo identity), no encryption at rest beyond the browser profile, no server-side backup, and data is per-browser and per-device. Clearing site data deletes it. This is not suitable for real patient data.

## Known detection limitations

- The vocabulary is limited (about 25 drugs, 14 allergens, 14 diagnoses, 10 lab tests, 7 procedures, smoking status). Anything else is not extracted.
- Negation and hedging rules are pattern-based. Multi-column or tabular PDFs can lose line order. Scanned PDFs are detected but not OCR'd.
- Type 1 and type 2 diabetes share one concept. Formulations (e.g. ER vs IR) are not distinguished. DD/MM vs MM/DD numeric dates are deliberately not parsed.

## Project structure

```
src/lib/        extraction, statement rules, detection engine, review state machine, services, persistence
src/pages/      Overview, Queue, FindingDetail, Documents, DocumentViewer, Timeline, Cases, About
src/components/ layout, demo guide, UI primitives
scripts/        synthetic demo content + document generator
public/demo/    generated synthetic PDF/DOCX/TXT records
tests/unit/     Vitest tests;  tests/e2e/  Playwright tests
docs/           architecture notes
```

License: MIT.
