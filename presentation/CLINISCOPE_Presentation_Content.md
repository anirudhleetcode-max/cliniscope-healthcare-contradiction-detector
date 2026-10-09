# CLINISCOPE: Code Flayer 2.0 presentation content (PS-11R3)

Final text of all eight slides in `CLINISCOPE_PS11R3_Hackathon_Presentation.pptx`.

**Template use.** This is the supplied Code Flayer 2.0 template, filled strictly. Every template shape keeps its original position, size, colour and font size; only the placeholder text was replaced. The only added object is a QR code on slide 8, which the template's closing line asks for ("Demo or GitHub link / QR code").

Items in square brackets are deliberate placeholders for team details that are not in the repository.

**How the claims were checked (9 Oct 2026):**
- Read the source code, `package.json`, README, `docs/ARCHITECTURE.md` and the CI workflow.
- Locally, typecheck passed, 34/34 Vitest tests passed and 8/8 Playwright end-to-end tests passed.
- GitHub Actions confirms the `verify-production` job ran the e2e suite against the live GitHub Pages URL and passed.

---

## Slide 1: Introduction

- CODE FLAYER 2.0 • PROJECT PRESENTATION
- **CLINISCOPE**
- Healthcare Record Contradiction Detector
- Find the conflict. Trace the evidence. Keep humans in control.
- TEAM [Add official team name]
- Team leader: [Add team leader]
- Team members: [Add member names]
- Healthcare • PS-11R3 | Vishnu Institute of Technology, Bhimavaram

## Slide 2: Problem Statement

*PS-11R3: Healthcare Record Contradiction Detector. The framing below is the team's interpretation.*

- **01 The problem:** Patient information is spread across many documents. Allergies, doses, diagnoses and lab results can differ, and spotting that by hand is slow.
- **02 Target users:** Intended users: clinicians reviewing records, medical-records (HIM) teams, clinical quality and patient-safety reviewers, and authorized staff reconciling records.
- **03 Current challenges:**
  - Fragmented: statements sit in separate files
  - Context: dates, negation, dose changes
  - Traceability: each conflict needs its source
- **04 The gap / impact:** A warning is not enough. Reviewers need the original evidence, its context (dates, history) and a controlled way to record their decision.
- **One-line problem:** How can reviewers find and investigate conflicts across medical records with clear source evidence and human oversight?

## Slide 3: Proposed Solution

*An evidence-first review prototype: documents in, traceable findings out, decisions made by people.*

- **Solution overview:** CLINISCOPE extracts text from PDF, TXT and DOCX records, finds allergy, medication, diagnosis and lab statements with rules, compares them across a case and flags potential conflicts with verified source quotes for human review.
- **Unique value / USP:** Every finding is traceable to an exact source quote. Dated or documented changes are separated from true conflicts, and people make the final call.
- **01 Document ingestion:** PDF (text layer), TXT and DOCX are validated and extracted in the browser.
- **02 Evidence detection:** Rule-based comparison flags potential conflicts with source quotes.
- **03 Review & audit:** Decisions need a reason; every action is kept in an audit log.
- **Expected benefit:** Conflicts become easier to find and investigate, with evidence and human judgment kept.

## Slide 4: Technical Approach & Architecture

*Everything runs in the reviewer's browser: no backend server, no AI/LLM and no OCR in the current build.*

User input (PDF · TXT · DOCX) → Frontend (React + TypeScript) → **Client services** (IndexedDB (Dexie)) → Processing (Rule-based engine) → Output (Evidence findings)

- **System components:** Extraction (pdf.js, mammoth) → statement rules → contradiction detection → evidence check → review workflow, stored with Dexie.
- **Data flow & validation:** Uploads are type- and size-checked. A finding is kept only if its quotes match the source text; dates can reclassify it.
- **Architecture note:** Extraction, detection and review are separate, unit-tested modules.

## Slide 5: Technology Stack

*Technologies verified in package.json and the CI workflow, and the role each one plays.*

| Template card | Content |
|---|---|
| Frontend | React 18, TypeScript, Vite and Tailwind CSS for the review UI. |
| Backend | None: a browser-side TypeScript service layer runs the workflow. |
| Database | IndexedDB via Dexie: cases, files, findings and audit events. |
| AI / core logic | No AI/LLM: deterministic TypeScript rules for detection. |
| Integrations | No external APIs. pdfjs-dist (PDF) and mammoth (DOCX) run locally. |
| Deployment & tools | Git, GitHub Actions (Vitest, Playwright) and GitHub Pages. |

**Why this stack?** A light, testable static web app: records are processed and stored in the browser, so no server is needed. OCR, AI or a backend would be added only when required.

## Slide 6: Feasibility & Viability

*A working, tested prototype today, with a staged and cautious path toward real-world use.*

**Technical feasibility**
- Required tools and skills: React, TypeScript, rule design, pdf.js, mammoth, Vitest, Playwright.
- Data / infrastructure: synthetic records and browser storage only; no real patient data.
- Prototype status: deployed; 34 unit and 8 end-to-end tests pass. No OCR or login yet.
- Risk + mitigation: false positives → verified quotes, uncertainty labels, human review.

**Business / operational viability**
- Target users and value: authorized reviewers who need evidence, not just alerts.
- Adoption plan: synthetic prototype → test set → clinician feedback → approved pilot.
- Cost and maintenance: hosting, processing, future storage or AI APIs, testing.
- Revenue (future only): institutional licensing or integration. No partners today.

**Key takeaway:** A working prototype with a practical, validation-first path to evidence-based review.

## Slide 7: Sustainability, Scalability & Impact

*Scalability items are planned, not built. Impact is a goal to be measured in evaluation.*

- **Long-term sustainability:** Modular engine, regression tests in CI, versioned schema, and unsupported files flagged openly rather than guessed.
- **Scalability:** Planned: OCR for scans, more formats, evidence-checked AI help, secure backend with login and multi-user review.
- **Expected impact:** Aims to reduce manual searching, make investigations traceable and record review decisions consistently.
- **Future roadmap (template stages):** 01 Prototype → 02 Pilot testing → 03 Improve → 04 Deploy & scale
- **Success metric:** Precision/recall on labelled records, % findings with evidence, reviewer agreement.

## Slide 8: Conclusion

- **Conclusion:** CLINISCOPE helps reviewers find potential conflicts across healthcare records, trace each one to source evidence, and record decisions with human oversight.
- **Closing line:** Find the conflict. Trace the evidence. Keep humans in control.
- THANK YOU
- [Add team email] • github.com/anirudhleetcode-max/cliniscope-healthcare-contradiction-detector
- Live demo: anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector (scan QR)
- **QR code:** links to the live demo URL. It was decoded successfully from the rendered slide.

---

## Deliberately left out (not implemented in the current code)

- OCR (scanned PDFs are only flagged)
- Any AI/LLM model
- A backend server, authentication, or multi-user collaboration
- Encryption or compliance claims
- Healthcare statistics, accuracy figures, customers or partners

## Rebuilding

`python3 presentation/source/build_presentation.py presentation/source/Code_Flayer_2.0_PPT_TEMPLATE.pptx presentation/CLINISCOPE_PS11R3_Hackathon_Presentation.pptx presentation/source/qr_live_demo.png` (requires `python-pptx`).
