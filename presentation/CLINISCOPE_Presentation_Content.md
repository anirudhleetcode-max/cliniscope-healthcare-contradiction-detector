# CLINISCOPE: Code Flayer 2.0 presentation content (PS-11R3)

Final text of all eight slides in `CLINISCOPE_PS11R3_Hackathon_Presentation.pptx`, built on the official Code Flayer 2.0 template.
Items in square brackets are deliberate placeholders for team details that are not in the repository.

**How the claims were checked (9 Oct 2026):** source code, `package.json`, README, `docs/ARCHITECTURE.md` and the CI workflow were read. Locally, typecheck passed, 34/34 Vitest tests passed and 8/8 Playwright end-to-end tests passed. GitHub Actions run #7 (`CI and deploy`) shows the `verify-production` job ran the e2e suite against the live GitHub Pages URL and passed. The sandbox could not open github.io directly because the proxy blocks it.

---

## Slide 1: Introduction

- CODE FLAYER 2.0 • PROJECT PRESENTATION • PS-11R3
- **CLINISCOPE**
- **Healthcare Record Contradiction Detector**
- *Find the conflict. Trace the evidence. Keep humans in control.*
- TEAM [Add official team name]
- Team leader: [Add team leader]
- Team members: [Add member names]
- Domain: Healthcare | Problem statement PS-11R3 | Vishnu Institute of Technology, Bhimavaram
- 01 / INTRODUCTION

## Slide 2: Problem Statement

*PS-11R3 · Healthcare Record Contradiction Detector. The framing below is our own interpretation of the problem.*

**01 The problem.** Patient information is spread across discharge summaries, intake forms, medication lists and lab reports. Allergies, doses, diagnoses and lab values can differ between records, and finding those differences by hand is slow.

**02 Target users (intended)**
- **Clinicians** reviewing patient records
- **Medical-records / HIM teams**
- **Clinical quality & patient-safety** reviewers
- **Authorized staff** reconciling records

**03 Current challenges**
- **Fragmented:** related statements sit in separate documents
- **Context-sensitive:** dates, negation and dose changes blur conflicts
- **Hard to trace:** each discrepancy needs its original source

**04 The gap / impact.** A warning alone is not enough. Reviewers need the original evidence, the context (dates, history) to judge it, and a controlled way to record their final decision.

**One-line problem:** How might we help healthcare reviewers identify and investigate inconsistencies across medical documents, with clear source evidence and human oversight?

## Slide 3: Proposed Solution

*An evidence-first review prototype: documents in, traceable findings out, decisions made by people.*

**Solution overview.** CLINISCOPE extracts text from PDF, TXT and DOCX records. It uses deterministic rules to identify allergy, medication, diagnosis, lab, procedure and smoking statements, then compares them across the documents of one case. It flags potential discrepancies with verified source quotations for human review.

**Unique value / USP.** Every finding is traceable: it is created only if each quote is found again at its exact source offsets. Dated or documented changes are separated from true conflicts, and the final decision stays with the reviewer.

Feature flow (with arrows: 01 → 02 → 03):
- **01 Ingest documents:** PDF (text layer), TXT and DOCX are validated, de-duplicated and extracted in the browser.
- **02 Detect with evidence:** rules compare statements and label each difference by type, backed by quoted evidence.
- **03 Review & audit:** confirm, resolve or dismiss with a required reason. Every action lands in an audit log.

**Expected benefit:** Potential inconsistencies become easier to locate and investigate, while evidence traceability and human judgment are preserved.

## Slide 4: Technical Approach & Architecture

*The whole pipeline runs in the reviewer's browser: there is no backend server, no AI/LLM and no OCR in the current build.*

Five-stage flow: **User input** (PDF text layer · TXT · DOCX · synthetic records) → **Frontend** (React + TypeScript · library · queue · finding detail) → **Client services** (validate · dedupe · analyze · review · IndexedDB/Dexie) → **Processing** (statement rules · conflict rules · evidence check) → **Output** (classified findings · quoted evidence · review + audit log)

**System components**
1. Extraction: pdf.js, mammoth, UTF-8 text with offsets
2. Statements: negation, hedging, history, dose changes
3. Detection: per-case comparison, units & dates
4. Evidence: quotes re-verified; View in source
5. Review: state machine, notes, audit log

**Data flow & validation**
- Uploads: type, magic-byte and size checks; dedupe
- Findings: only if every quote matches its source
- Dates: specimen dates and dose changes reclassify
- Scanned PDFs: flagged; every decision needs a reason

**Architecture note:** Extraction, statement rules, detection and review are separate TypeScript modules with unit tests, so each stage can be tested and replaced independently.

## Slide 5: Technology Stack

*Verified against package.json and the CI workflow. No Python, server framework, cloud database, OCR or LLM provider is used.*

| Card | Content |
|---|---|
| Frontend | React 18 + TypeScript, built with Vite and styled with Tailwind CSS. |
| Backend: none | A TypeScript service layer in the browser runs upload, analysis and review. |
| Storage | IndexedDB via Dexie: cases, documents, original files, findings and audit events. |
| Core logic (rules) | Deterministic TypeScript rules: vocabulary, negation, units and date handling. |
| Document processing | pdfjs-dist reads PDF text layers, mammoth reads DOCX; TXT is read as UTF-8. |
| Testing & deployment | Vitest + Playwright in GitHub Actions; static build hosted on GitHub Pages. |

**Why this stack?** A lightweight, testable static web app: documents are processed and stored in the reviewer's own browser, so no server or credentials are needed. A backend, OCR or AI service would be added only when the implementation requires it.

## Slide 6: Feasibility & Viability

*A working, tested prototype today, with a staged and cautious path toward real-world evaluation.*

**Technical feasibility**
- **Tools & skills:** React, TypeScript, rule design, pdf.js / mammoth, Vitest and Playwright, all in use today.
- **Data & infrastructure:** synthetic demo records and browser storage only; no hospital systems or real patient data.
- **Status & constraints:** deployed prototype; 34 unit + 8 end-to-end tests pass. Limited vocabulary, no OCR, no login.
- **Risk → mitigation:** mis-extraction and context false positives → offset-verified quotes, uncertainty labels, human review, regression tests.

**Business / operational viability**
- **Users & value:** authorized reviewers who reconcile records and need evidence, not just alerts.
- **Adoption path:** synthetic prototype → representative test set → clinical reviewer feedback → security & privacy review → approved limited pilot.
- **Cost drivers:** hosting (static today), document processing, future storage or AI APIs, testing and maintenance.
- **Possible model (future):** institutional licensing or record-system integration via pilot partners. No partners or customers today.

**Key takeaway:** CLINISCOPE builds on a working software prototype and offers a practical path toward evaluated, evidence-based record review, subject to further validation and secure deployment.

## Slide 7: Sustainability, Scalability & Impact

*Scalability items and roadmap stages 02–04 are planned, not built; impact is a goal to be measured in evaluation.*

**Long-term sustainability:** modular engine in src/lib · regression tests run in CI · versioned DB schema · unsupported files flagged openly · synthetic, governed test data

**Scalability (planned):** OCR for scanned records · more formats and vocabulary · evidence-checked AI assistance · secure backend, login, multi-user · record-system integration

**Expected impact (goals):** aims to cut manual searching · more traceable investigations · clearer view of source evidence · structured review records · better awareness of uncertainty

**Future roadmap**
1. **Prototype (now):** synthetic records: ingestion, evidence, review
2. **Pilot testing:** measure extraction, accuracy and usability
3. **Improve:** OCR, context, evidence checks, security
4. **Deploy & scale:** only after accuracy, privacy and approvals

**Success metrics (to be measured):** detection precision & recall on a labelled set • % of findings with verifiable evidence • false-positive rate • reviewer agreement • median time per finding • extraction success rate

## Slide 8: Conclusion

- **Conclusion.** CLINISCOPE helps reviewers identify potential inconsistencies across healthcare documents, trace every finding to verified source evidence, and record decisions with human oversight.
- **Find the conflict. Trace the evidence. Keep humans in control.**
- THANK YOU
- PS-11R3: Healthcare Record Contradiction Detector
- Live demo: https://anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector/
- Code: https://github.com/anirudhleetcode-max/cliniscope-healthcare-contradiction-detector
- Contact: [Add team email]
- QR code ("Scan for live demo"): encodes the live demo URL. It was decoded successfully from the rendered slide.

---

## Deliberately left out (not implemented in the current code)

- OCR (scanned PDFs are detected and flagged, not read)
- Any AI/LLM model (all extraction and detection are deterministic rules)
- A backend server, authentication, shared cases or multi-user collaboration
- Encryption beyond the browser profile, and any regulatory compliance claim
- Any healthcare statistics, accuracy figures, customers or partnerships

## Rebuilding

`python3 presentation/source/build_presentation.py presentation/source/Code_Flayer_2.0_PPT_TEMPLATE.pptx presentation/CLINISCOPE_PS11R3_Hackathon_Presentation.pptx presentation/source/qr_live_demo.png` (requires `python-pptx`).
