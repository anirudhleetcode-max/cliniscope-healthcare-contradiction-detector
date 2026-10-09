# CLINISCOPE: Code Flayer 2.0 presentation content (PS-11R3)

This is the final text of all eight slides in `CLINISCOPE_PS11R3_Hackathon_Presentation.pptx`.

**Template use:** the deck is a strict fill of the supplied Code Flayer 2.0 template.
- Every template shape keeps its original position, size, colour and font size. Only placeholder text was replaced.
- The one added object is a QR code on slide 8. The template's closing line asks for one ("Demo or GitHub link / QR code").
- Items in square brackets are deliberate placeholders. The team details are not in the repository.

**How the claims were checked (9 Oct 2026, merged with the base branch at 347a066):**
- Sources read: source code, `package.json`, README, `docs/` and the CI workflow.
- Local test run: typecheck passed, 68/68 Vitest tests passed and 12/12 Playwright end-to-end tests passed. These include the OCR, two-user shared-workspace and AI-pipeline specs.
- Live site: base-branch CI run #17 deployed the frontend and checked it with the e2e suite.

**Feature status as presented:**
| Feature | Status |
|---|---|
| On-device OCR (Tesseract.js) | Implemented and tested; live in the deployed frontend |
| Optional Node 22 + SQLite API (accounts, roles, shared cases) | Implemented and tested locally; **not publicly hosted** |
| AI-assisted reasoning (Anthropic API, quote-verified) | Pipeline implemented and tested with a local fake provider; **not yet tried on a live model** |

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

- **01 The problem:** Patient information is spread across digital and scanned documents. Allergies, doses, diagnoses and lab results can differ, and spotting that by hand is slow.
- **02 Target users:** Intended users are clinicians reviewing records, medical-records (HIM) teams, clinical quality and patient-safety reviewers, and authorized staff reconciling records.
- **03 Current challenges:**
  - Fragmented: statements sit in separate files.
  - Context: dates, negation and dose changes can make a difference look like a conflict.
  - Traceability: each conflict needs its source.
- **04 The gap / impact:** A warning is not enough. Reviewers need the original evidence, its context (dates, history) and a controlled way to record their decision.
- **One-line problem:** How can reviewers find and investigate conflicts across medical records with clear source evidence and human oversight?

## Slide 3: Proposed Solution

*An evidence-first review prototype: documents in, traceable findings out, decisions made by people.*

- **Solution overview:** CLINISCOPE reads PDF, scanned, image, TXT and DOCX records (OCR for scans) and finds clinical statements with rules. It compares them across a case and flags potential conflicts with verified source quotes for human review.
- **Unique value / USP:** Every finding links to an exact source quote, with OCR confidence shown. AI suggestions must verify too, and people make the final call.
- **01 Document ingestion:** PDF, scans (on-device OCR), images, TXT and DOCX, read in the browser.
- **02 Evidence detection:** Rules flag conflicts with quotes; optional AI ideas are quote-checked.
- **03 Review & audit:** Reasons required, audit log, optional shared cases with roles.
- **Expected benefit:** Conflicts become easier to find and investigate, with evidence and human judgment kept.

## Slide 4: Technical Approach & Architecture

*Browser app with on-device OCR. An optional Node API adds shared cases and AI (not yet publicly hosted).*

User input (PDF · scans · DOCX) → Frontend (React + TypeScript) → **Optional API** (Node + SQLite) → Processing (OCR · rules · AI) → Output (Evidence findings)

- **System components:** OCR (Tesseract.js), pdf.js, mammoth → statement rules → detection → optional AI → quote check → review, stored in IndexedDB or SQLite.
- **Data flow & validation:** Uploads are type- and size-checked. Any finding, AI included, is kept only if its quotes match the source; low OCR confidence lowers evidence.
- **Architecture note:** Works fully in the browser; the server and AI are optional, separately tested add-ons.

## Slide 5: Technology Stack

*Technologies verified in package.json and the CI workflow, and the role each one plays.*

| Template card | Content |
|---|---|
| Frontend | React 18, TypeScript, Vite and Tailwind CSS for the review UI. |
| Backend | Optional Node 22 API for accounts, roles and case sharing. |
| Database | IndexedDB (Dexie) in the browser; SQLite on the server. |
| AI / core logic | Deterministic rules; optional Anthropic API, quote-verified. |
| Integrations | Tesseract.js OCR, pdf.js and mammoth run on-device. |
| Deployment & tools | GitHub Actions CI, GitHub Pages; Docker/Render for the API. |

**Why this stack?** The browser app works on its own, so the demo needs no server. The API and AI layer are optional and add sharing and AI only where configured.

## Slide 6: Feasibility & Viability

*A working, tested prototype today, with a staged and cautious path toward real-world use.*

**Technical feasibility**
- Required tools and skills: React, TypeScript, Node, SQLite, Tesseract.js, Vitest, Playwright.
- Data / infrastructure: synthetic records only. Frontend is live; the API is not hosted yet.
- Prototype status: 68 unit and 12 end-to-end tests pass. AI not yet tried on a live model.
- Risk + mitigation: OCR or AI errors → quote checks, confidence labels, human review.

**Business / operational viability**
- Target users and value: authorized reviewers who need evidence, not just alerts.
- Adoption plan: synthetic prototype → test set → clinician feedback → approved pilot.
- Cost and maintenance: API hosting, storage, AI usage per analysis, testing.
- Revenue (future only): institutional licensing or integration. No partners today.

**Key takeaway:** A working prototype with a practical, validation-first path to evidence-based review.

## Slide 7: Sustainability, Scalability & Impact

*Scalability items are planned next steps. Impact is a goal to be measured in evaluation.*

- **Long-term sustainability:** Modular engine, regression tests in CI, versioned migrations, and low-confidence OCR flagged, never guessed.
- **Scalability:** Planned: host the API, test AI on a live model, more formats and vocabulary, record-system integration.
- **Expected impact:** Aims to reduce manual searching, make investigations traceable and record review decisions consistently.
- **Future roadmap (template stages):** 01 Prototype → 02 Pilot testing → 03 Improve → 04 Deploy & scale
- **Success metric:** Precision/recall, OCR error rate on labelled scans, % findings with evidence.

## Slide 8: Conclusion

- **Summary:** CLINISCOPE helps reviewers find potential conflicts across digital and scanned healthcare records, trace each one to source evidence, and record decisions with human oversight.
- **Closing line:** Find the conflict. Trace the evidence. Keep humans in control.
- THANK YOU
- [Add team email] • github.com/anirudhleetcode-max/cliniscope-healthcare-contradiction-detector
- Live demo: anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector (scan QR)
- The QR code links to the live demo URL. It was decoded successfully from the rendered slide.

---

## Deliberately not claimed

- That the API or shared workspace is publicly available. It runs locally or via the included Docker/Render config only.
- That AI has been validated on a live model.
- Encryption, regulatory compliance, clinical validation, healthcare statistics, accuracy figures, customers or partners.

## Rebuilding

Run `python3 presentation/source/build_presentation.py presentation/source/Code_Flayer_2.0_PPT_TEMPLATE.pptx presentation/CLINISCOPE_PS11R3_Hackathon_Presentation.pptx presentation/source/qr_live_demo.png`. It requires `python-pptx`.
