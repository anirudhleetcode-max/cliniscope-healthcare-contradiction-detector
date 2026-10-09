"""Fill the Code Flayer 2.0 template with CLINISCOPE content.

Strict template fill: every template shape keeps its position, size, colour and
font size. Only placeholder text is replaced (each new paragraph clones the
template run's formatting). The single addition is the QR code that the
template's closing slide asks for ("[Demo or GitHub link / QR code]").

Usage: python3 build_presentation.py TEMPLATE.pptx OUTPUT.pptx QR.png
"""
import copy
import sys

from pptx import Presentation
from pptx.oxml.ns import qn
from pptx.util import Inches

SRC, OUT, QR = sys.argv[1], sys.argv[2], sys.argv[3]
SITE = "https://anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector/"

prs = Presentation(SRC)
slides = list(prs.slides)


def put(slide, name, *paras):
    """Replace the text of template shape `name` with `paras`, keeping its formatting."""
    shape = next(s for s in slide.shapes if s.name == name)
    tx = shape.text_frame._txBody
    p0 = tx.find(qn("a:p"))
    ppr, rpr = p0.find(qn("a:pPr")), p0.find(qn("a:r")).find(qn("a:rPr"))
    for p in tx.findall(qn("a:p")):
        tx.remove(p)
    for text in paras:
        p = tx.makeelement(qn("a:p"), {})
        if ppr is not None:
            p.append(copy.deepcopy(ppr))
        r = p.makeelement(qn("a:r"), {})
        r.append(copy.deepcopy(rpr))
        t = r.makeelement(qn("a:t"), {})
        t.text = text
        r.append(t)
        p.append(r)
        tx.append(p)


FOOTER = "CODE FLAYER 2.0  •  CLINISCOPE  •  PS-11R3"

# ---------------------------------------------------------------- 1 Introduction
s = slides[0]
put(s, "TextBox 5", "CODE FLAYER 2.0  •  PROJECT PRESENTATION")
put(s, "TextBox 6", "CLINISCOPE")
put(s, "TextBox 7", "Healthcare Record Contradiction Detector",
    "Find the conflict. Trace the evidence. Keep humans in control.")
put(s, "TextBox 9", "TEAM  [Add official team name]")
put(s, "TextBox 10", "Team leader: [Add team leader]",
    "Team members: [Add member names]")
put(s, "TextBox 11", "Healthcare  •  PS-11R3     |     Vishnu Institute of Technology, Bhimavaram")

# ---------------------------------------------------------------- 2 Problem
s = slides[1]
put(s, "TextBox 3", "PS-11R3: Healthcare Record Contradiction Detector. The framing below is the team's interpretation.")
put(s, "TextBox 10", "Patient information is spread across many documents. Allergies, "
                     "doses, diagnoses and lab results can differ, and spotting "
                     "that by hand is slow.")
put(s, "TextBox 14", "Intended users: clinicians reviewing records, medical-records "
                     "(HIM) teams, clinical quality and patient-safety reviewers, and "
                     "authorized staff reconciling records.")
put(s, "TextBox 18", "• Fragmented: statements sit in separate files",
                     "• Context: dates, negation, dose changes",
                     "• Traceability: each conflict needs its source")
put(s, "TextBox 22", "A warning is not enough. Reviewers need the original evidence, "
                     "its context (dates, history) and a controlled way to record "
                     "their decision.")
put(s, "TextBox 23", "ONE-LINE PROBLEM:  How can reviewers find and investigate conflicts "
                     "across medical records with clear source evidence and human oversight?")
put(s, "TextBox 24", FOOTER)

# ---------------------------------------------------------------- 3 Solution
s = slides[2]
put(s, "TextBox 3", "An evidence-first review prototype: documents in, traceable findings out, decisions made by people.")
put(s, "TextBox 10", "CLINISCOPE extracts text from PDF, TXT and DOCX records, finds "
                     "allergy, medication, diagnosis and lab statements with rules, "
                     "compares them across a case and flags potential conflicts "
                     "with verified source quotes for human review.")
put(s, "TextBox 14", "Every finding is traceable to an exact source quote. Dated or "
                     "documented changes are separated from true conflicts, and "
                     "people make the final call.")
put(s, "TextBox 17", "01  DOCUMENT INGESTION")
put(s, "TextBox 18", "PDF (text layer), TXT and DOCX are validated and extracted in the browser.")
put(s, "TextBox 21", "02  EVIDENCE DETECTION")
put(s, "TextBox 22", "Rule-based comparison flags potential conflicts with source quotes.")
put(s, "TextBox 25", "03  REVIEW & AUDIT")
put(s, "TextBox 26", "Decisions need a reason; every action is kept in an audit log.")
put(s, "TextBox 27", "EXPECTED BENEFIT:  Conflicts become easier to find and investigate, with evidence and human judgment kept.")
put(s, "TextBox 28", FOOTER)

# ---------------------------------------------------------------- 4 Architecture
s = slides[3]
put(s, "TextBox 3", "Everything runs in the reviewer's browser: no backend server, no AI/LLM and no OCR in the current build.")
put(s, "TextBox 9", "PDF · TXT · DOCX")
put(s, "TextBox 13", "React + TypeScript")
put(s, "TextBox 16", "CLIENT SERVICES")
put(s, "TextBox 17", "IndexedDB (Dexie)")
put(s, "TextBox 21", "Rule-based engine")
put(s, "TextBox 25", "Evidence findings")
put(s, "TextBox 29", "Extraction (pdf.js, mammoth) → statement rules → "
                     "contradiction detection → evidence check → review "
                     "workflow, stored with Dexie.")
put(s, "TextBox 33", "Uploads are type- and size-checked. A finding is kept only if "
                     "its quotes match the source text; dates can reclassify it.")
put(s, "TextBox 34", "ARCHITECTURE NOTE:  Extraction, detection and review are separate, unit-tested modules.")
put(s, "TextBox 35", FOOTER)

# ---------------------------------------------------------------- 5 Tech stack
s = slides[4]
put(s, "TextBox 3", "Technologies verified in package.json and the CI workflow, and the role each one plays.")
put(s, "TextBox 10", "React 18, TypeScript, Vite and Tailwind CSS for the review UI.")
put(s, "TextBox 14", "None: a browser-side TypeScript service layer runs the workflow.")
put(s, "TextBox 18", "IndexedDB via Dexie: cases, files, findings and audit events.")
put(s, "TextBox 22", "No AI/LLM: deterministic TypeScript rules for detection.")
put(s, "TextBox 26", "No external APIs. pdfjs-dist (PDF) and mammoth (DOCX) run locally.")
put(s, "TextBox 30", "Git, GitHub Actions (Vitest, Playwright) and GitHub Pages.")
put(s, "TextBox 31", "WHY THIS STACK?  A light, testable static web app: records are processed and stored in the "
                     "browser, so no server is needed. OCR, AI or a backend would be added only when required.")
put(s, "TextBox 32", FOOTER)

# ---------------------------------------------------------------- 6 Feasibility
s = slides[5]
put(s, "TextBox 3", "A working, tested prototype today, with a staged and cautious path toward real-world use.")
put(s, "TextBox 13",
    "• Required tools and skills: React, TypeScript, rule design, pdf.js, mammoth, Vitest, Playwright.", "",
    "• Data / infrastructure: synthetic records and browser storage only; no real patient data.", "",
    "• Prototype status: deployed; 34 unit and 8 end-to-end tests pass. No OCR or login yet.", "",
    "• Risk + mitigation: false positives → verified quotes, uncertainty labels, human review.")
put(s, "TextBox 14",
    "• Target users and value: authorized reviewers who need evidence, not just alerts.", "",
    "• Adoption plan: synthetic prototype → test set → clinician feedback → approved pilot.", "",
    "• Cost and maintenance: hosting, processing, future storage or AI APIs, testing.", "",
    "• Revenue (future only): institutional licensing or integration. No partners today.")
put(s, "TextBox 16", "KEY TAKEAWAY:  A working prototype with a practical, validation-first path to evidence-based review.")
put(s, "TextBox 17", FOOTER)

# ---------------------------------------------------------------- 7 Sustainability
s = slides[6]
put(s, "TextBox 3", "Scalability items are planned, not built. Impact is a goal to be measured in evaluation.")
put(s, "TextBox 10", "Modular engine, regression tests in CI, versioned schema, and "
                     "unsupported files flagged openly rather than guessed.")
put(s, "TextBox 14", "Planned: OCR for scans, more formats, evidence-checked AI help, "
                     "secure backend with login and multi-user review.")
put(s, "TextBox 18", "Aims to reduce manual searching, make investigations traceable "
                     "and record review decisions consistently.")
put(s, "TextBox 29", "SUCCESS METRIC:  Precision/recall on labelled records, % findings with evidence, reviewer agreement.")
put(s, "TextBox 30", FOOTER)

# ---------------------------------------------------------------- 8 Conclusion
s = slides[7]
put(s, "TextBox 4", "CLINISCOPE helps reviewers find potential conflicts across "
                    "healthcare records, trace each one to source evidence, and "
                    "record decisions with human oversight.")
put(s, "TextBox 6", "Find the conflict. Trace the evidence. Keep humans in control.")
put(s, "TextBox 8", "[Add team email]  •  github.com/anirudhleetcode-max/cliniscope-healthcare-contradiction-detector",
                    "Live demo: anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector  (scan QR)")
put(s, "TextBox 11", "CLINISCOPE")
# QR code in the empty lower part of the right panel; template shapes are untouched
pic = s.shapes.add_picture(QR, Inches(10.35), Inches(4.95), Inches(1.5), Inches(1.5))
pic.name = "QR Live Demo"
pic._element.nvPicPr.cNvPr.set("descr", "QR code linking to the CLINISCOPE live demo: " + SITE)

prs.save(OUT)
print("saved", OUT)
