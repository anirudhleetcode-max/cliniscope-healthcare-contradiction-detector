# CLINISCOPE: presentation content (PS-11R3)

This is the final content of `CLINISCOPE_PS11R3_Hackathon_Presentation.pptx`, a full visual redesign of the Code Flayer 2.0 template.
- **Structure:** the template's 8-slide order and 16:9 canvas are unchanged.
- **Editability:** every slide is built from native, editable PowerPoint shapes and text. The one image is the QR code on slide 8.
- **Speaker notes:** each slide has notes for the presenter.

## Design system

| Token | Value | Use |
|---|---|---|
| Deep clinical navy | `#0B1220` | Dark slides (1, 4, 8) and the "principle" statement band |
| Dark slate | `#111C2E` | Cards on dark slides |
| Soft clinical white | `#F7FAFC` | Light slides (2, 3, 5, 6, 7) |
| Teal | `#19B6A4` | Progression, completed stages, section labels |
| Healthcare blue | `#4C8DFF` | Sources, information, system components |
| Evidence blue | `#82B7FF` | Evidence and quotes |
| Amber | `#F2A65A` | Potential contradictions only |
| Text | `#172033` / `#526176` on light, `#F8FAFC` / `#B8C4D6` on dark | |

**Typography:** Arial throughout. Arial ships with Office and renders identically in the QA renderer.
- Titles: 28 pt (36 pt on the closing slide; 58 pt for the cover wordmark).
- Body text: 12–17 pt.
- Small labels and sample-document mockups: 8–9.5 pt.

**Recurring motifs:**
- Document cards with a highlighted evidence row, linked by an amber evidence line.
- Numbered circular badges.
- A navy "principle" band carrying each slide's key message.
- A dashed outline for anything optional or not yet deployed.

## How the claims were verified (9 Oct 2026, code at base commit 467b9af)

- **Sources read:** source code, `package.json`, README, `docs/` and the CI workflow.
- **Local test run:** typecheck passed, **75/75** Vitest unit/integration tests passed and **12/12** Playwright end-to-end tests passed.
- **Live site:** CI run #21 deployed it to GitHub Pages and re-ran the end-to-end suite against the live URL, which passed. The sandbox itself cannot open github.io.

**Feature status as presented:**
| Feature | Status |
|---|---|
| PDF / scanned PDF / PNG / JPEG / TXT / DOCX ingestion, on-device OCR (Tesseract.js) | Implemented, tested, live |
| Deterministic statement extraction and contradiction detection | Implemented, tested, live |
| Evidence verification, source view, review workflow, audit log (browser) | Implemented, tested, live |
| Shared-workspace API (Node 22 + SQLite: accounts, roles, shared review, audit) | Implemented and tested locally; **not publicly deployed** |
| AI-assisted reasoning (Anthropic API via server, quotes re-verified) | Implemented and tested with a stand-in provider; **not yet run on a live model** |
| Clinical validation | **None** |

---

## Slide 1: Introduction (dark)
- **Eyebrow:** CODE FLAYER 2.0 · PS-11R3
- **Wordmark:** CLINISCOPE
- **Subtitle:** Healthcare Record Contradiction Detector
- **Tagline:** Find the conflict. Trace the evidence. Keep humans in control.
- **Supporting sentence:** Helping reviewers identify potentially conflicting information across healthcare records and trace the evidence behind each finding.
- **Metadata:**
  - Team: **[TEAM NAME]**
  - Members: **[MEMBER NAMES]**
  - Institution: Vishnu Institute of Technology, Bhimavaram (as provided by you)
- **Visual:** two synthetic document cards with highlighted rows: Discharge summary, "Allergy: penicillin"; and Intake form, "No known drug allergies". They are linked by an amber evidence line, followed by the chips "POTENTIAL CONFLICT · 2 VERIFIED SOURCES" and "SENT TO HUMAN REVIEW". The visual is captioned "Illustration · synthetic data" and mirrors the real demo case.

## Slide 2: The challenge: conflicting information across clinical records
- **01 Fragmented information:** Relevant information may be spread across multiple records.
- **02 Conflicting statements:** Two records may disagree about the same clinical fact.
- **03 Manual comparison:** Reviewers may have to read and compare documents by hand.
- **04 Limited traceability:** A useful finding must point to the exact source statements.
- **Illustration:** labelled **ILLUSTRATIVE EXAMPLE · SYNTHETIC**.
  - Record A (Discharge summary) reads "Medication status: active".
  - Record B (Medication list) reads "Medication status: discontinued".
  - An amber line with a ≠ marker links the two.
  - A flow follows: MULTIPLE RECORDS → INCONSISTENT STATEMENTS → REVIEW REQUIRED.
- **Caption:** "A difference is not always an error: dates and context may explain it. A qualified reviewer decides."

## Slide 3: CLINISCOPE turns discrepancies into reviewable evidence
1. **Ingest:** PDF, scanned PDF, PNG/JPEG, TXT and DOCX, validated and de-duplicated.
2. **Extract:** pdf.js text layer, on-device OCR for scans, mammoth for DOCX.
3. **Analyze (amber):** Deterministic rules compare statements within a case. Optional AI suggestions*.
4. **Trace:** Verbatim quotes re-verified at exact offsets, with page and OCR confidence.
5. **Review (teal):** A person confirms, resolves or dismisses. A reason is required and audited.

- **Principle band:** "Detection is the beginning. Evidence and human review are essential."
- **Footnote:** \*AI-assisted reasoning runs through the optional server. It is implemented and tested with a stand-in provider, not yet with a live model. CLINISCOPE never diagnoses or recommends treatment.

## Slide 4: A traceable pipeline from documents to human review (dark)
- **Pipeline** (layer tags in brackets): Document input (Input) → Extraction (Processing) → Normalization (Processing) → Contradiction detection (Processing, amber) → Evidence association (Evidence) → Review interface (Interface).
- **Persistence bar:** IndexedDB via Dexie, in the browser. It stores cases, original files, statements, findings and append-only audit events.
- **Dashed region**, labelled "Optional server layer · implemented and tested, not publicly deployed":
  - Shared workspace API: Node 22 + SQLite.
  - AI-assisted reasoning: Anthropic API, quotes re-verified, not yet run on a live model.
- **Note, "Why traceability":** Each finding stores the quotes, document, date and verified page behind it, so a reviewer can see why it was raised and check it in the source.

## Slide 5: Technology chosen for a practical, extensible implementation
- **Subtitle:** Verified in package.json, source imports and the CI workflow.

| Category | Technologies | Role |
|---|---|---|
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS | Single-page review interface with hash routing for static hosting. |
| Document processing | pdfjs-dist · Tesseract.js 6 · mammoth | PDF text layer, on-device OCR and DOCX extraction in the browser. |
| Data & persistence | Dexie · IndexedDB | Local cases, original files, findings and an append-only audit log. |
| Testing | Vitest · Playwright · fake-indexeddb | Unit, integration and end-to-end tests, including OCR and two-user flows. |
| Build & delivery | GitHub Actions · GitHub Pages | Each push type-checks, tests, builds, deploys and re-tests the live site. |

- **Dashed band, "Optional server layer · not publicly deployed":** Node 22 · node:sqlite · Anthropic SDK + Zod · Docker / Render config. Adds sharing and AI only where configured.

## Slide 6: A practical foundation with a clear path to extension
- **IMPLEMENTED** (in code today):
  - Ingestion of PDF, scans, images, TXT and DOCX
  - Rules engine for statements and contradictions
  - Evidence-linked findings with source view
  - Review: queue, reasons, audit log
  - Optional shared-workspace API and AI layer
- **VALIDATED** (by automated tests only):
  - 75 unit and integration tests pass
  - 12 end-to-end tests pass (Playwright)
  - Type-check and build pass in CI
  - Live site re-tested after deploy
  - No clinical validation yet
- **PLANNED** (next steps):
  - Evaluate on carefully reviewed examples
  - Measure false positives and misses
  - Run AI against a live model
  - Host the API with secure access
  - Improve complex and tabular documents
- **Key point band:** "Present in code is not tested, and tested is not clinically validated."

## Slide 7: Designed to grow responsibly with clinical review needs
1. **Current foundation** (Implemented):
   - Conflicting statements in one queue
   - Navigation to the exact source
   - Findings organized for investigation
   - Audited reviewer decisions
2. **Validation & extension** (Future work):
   - Evaluation on curated test sets
   - Live-model AI with evidence checks
   - Hosted, secure multi-user review
   - More formats and vocabulary
3. **Potential broader adoption** (Only if evaluation supports it):
   - Integration with record systems
   - Pilots after required approvals
   - Monitored use with oversight

- **"Responsible scaling requires" tags:** Privacy · Access control · Data protection · Auditability · Clinical evaluation · Human oversight · Uncertainty handling · Error monitoring
- **Impact band:** "Potential impact must be demonstrated through evaluation, not assumed."

## Slide 8: From scattered records to traceable contradictions (dark)
1. **Identify:** Surface potentially conflicting statements.
2. **Trace:** Connect findings to their source evidence.
3. **Review:** Help humans investigate and decide.

- **Closing line:** Find the conflict. Trace the evidence. Keep humans in control.
- **Name line:** CLINISCOPE · PS-11R3 · Healthcare Record Contradiction Detector
- **Code:** github.com/anirudhleetcode-max/cliniscope-healthcare-contradiction-detector
- **Live demo:** anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector (static browser version)
- **QR code:** links to the live demo. It was decoded successfully from the rendered slide.
- **Visual:** a smaller copy of the cover's evidence graphic.

---

## Claims deliberately not made
- No statistics on error rates, costs, outcomes or adoption.
- No accuracy or performance figures, no clinical validation, no customers or partners.
- Not described as production-ready, and not described as diagnosing anything or replacing clinicians.
- The shared workspace and AI are not presented as publicly available.

## Rebuilding
Run `python3 presentation/source/build_presentation.py presentation/source/Code_Flayer_2.0_PPT_TEMPLATE.pptx presentation/CLINISCOPE_PS11R3_Hackathon_Presentation.pptx presentation/source/qr_live_demo.png 75 12`. It requires `python-pptx` and `lxml`. The last two arguments are the unit and end-to-end test counts shown on slide 6.
