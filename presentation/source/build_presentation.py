"""Build the CLINISCOPE PS-11R3 deck: a full visual redesign of the Code Flayer 2.0 template.

The template file supplies the 8-slide sequence, the 16:9 canvas and the package;
every slide is then rebuilt from native, editable PowerPoint shapes in the
CLINISCOPE design system (no images except the QR code on the closing slide).

Usage: python3 build_presentation.py TEMPLATE.pptx OUTPUT.pptx QR.png [UNIT_TESTS] [E2E_TESTS]
"""
import sys

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

SRC, OUT, QR = sys.argv[1], sys.argv[2], sys.argv[3]
UNIT = sys.argv[4] if len(sys.argv) > 4 else "75"
E2E = sys.argv[5] if len(sys.argv) > 5 else "12"

REPO = "github.com/anirudhleetcode-max/cliniscope-healthcare-contradiction-detector"
SITE = "anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector"

# ------------------------------------------------------------------ design tokens
NAVY, SLATE, PAPER = "0B1220", "111C2E", "F7FAFC"
ON_DARK, ON_DARK_2 = "F8FAFC", "B8C4D6"
INK, INK_2 = "172033", "526176"
TEAL, BLUE, EVID, AMBER = "19B6A4", "4C8DFF", "82B7FF", "F2A65A"
BORDER_DARK, BORDER_LIGHT, CARD = "27364A", "DCE3EC", "FFFFFF"
TINT_BLUE, TINT_TEAL, TINT_AMBER = "EAF2FF", "E3F6F3", "FDF1E4"
FONT = "Arial"

W, H = 13.333, 7.5
M = 0.7            # side margin
CW = W - 2 * M     # content width (11.933")

prs = Presentation(SRC)
slides = list(prs.slides)
assert len(slides) == 8, "template must have 8 slides"


# ------------------------------------------------------------------ primitives
def rgb(h):
    return RGBColor.from_string(h)


def clear(slide, bg):
    for shp in list(slide.shapes):
        shp._element.getparent().remove(shp._element)
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = rgb(bg)


def _unstyle(shape):
    """Drop the theme style reference so shapes carry no inherited shadow or effects."""
    st = shape._element.find(qn("p:style"))
    if st is not None:
        shape._element.remove(st)


def box(slide, x, y, w, h, fill=None, line=None, lw=0.75, radius=None, dash=False,
        alpha=None, name=None, shape=None):
    kind = shape or (MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE)
    s = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    if radius and kind == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = min(0.5, radius / min(w, h))
    if fill:
        s.fill.solid()
        s.fill.fore_color.rgb = rgb(fill)
        if alpha is not None:
            srgb = s.fill._xPr.find(qn("a:solidFill")).find(qn("a:srgbClr"))
            etree.SubElement(srgb, qn("a:alpha")).set("val", str(int(alpha * 1000)))
    else:
        s.fill.background()
    if line:
        s.line.color.rgb = rgb(line)
        s.line.width = Pt(lw)
        if dash:
            ln = s.line._get_or_add_ln()
            etree.SubElement(ln, qn("a:prstDash")).set("val", "dash")
    else:
        s.line.fill.background()
    _unstyle(s)
    s.text_frame.text = ""
    if name:
        s.name = name
    return s


def text(slide, x, y, w, h, paras, size=14, color=INK, bold=False, align=PP_ALIGN.LEFT,
         anchor=MSO_ANCHOR.TOP, spacing=None, after=0, line=None, italic=False, name=None, shape=None):
    """paras: str | list of paragraphs; a paragraph is str or list of (text, {opts}) runs.
    opts: size, color, bold, italic, spc (character spacing, 1/100 pt)."""
    if shape is None:
        shape = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = shape.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(tf, side, 0)
    tf.vertical_anchor = anchor
    if isinstance(paras, str):
        paras = [paras]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(after)
        if line:
            p.line_spacing = line
        runs = [(para, {})] if isinstance(para, str) else para
        for t, o in runs:
            r = p.add_run()
            r.text = t
            f = r.font
            f.name = FONT
            f.size = Pt(o.get("size", size))
            f.bold = o.get("bold", bold)
            f.italic = o.get("italic", italic)
            f.color.rgb = rgb(o.get("color", color))
            sp = o.get("spc", spacing)
            if sp:
                r._r.get_or_add_rPr().set("spc", str(sp))
    if name:
        shape.name = name
    return shape


def label(slide, x, y, w, txt, color, size=10.5, align=PP_ALIGN.LEFT):
    """Small all-caps tracking label."""
    return text(slide, x, y, w, 0.25, txt.upper(), size=size, color=color, bold=True,
                spacing=120, align=align)


def arrow(slide, x1, y1, x2, y2, color, w=1.5, dash=False, head=True, elbow=False, name=None):
    kind = MSO_CONNECTOR.ELBOW if elbow else MSO_CONNECTOR.STRAIGHT
    c = slide.shapes.add_connector(kind, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    _unstyle(c)
    c.line.color.rgb = rgb(color)
    c.line.width = Pt(w)
    ln = c.line._get_or_add_ln()
    if dash:
        etree.SubElement(ln, qn("a:prstDash")).set("val", "dash")
    if head:
        t = etree.SubElement(ln, qn("a:tailEnd"))
        t.set("type", "triangle"); t.set("w", "med"); t.set("len", "med")
    if name:
        c.name = name
    return c


def dot(slide, cx, cy, d, fill, line=None, name=None):
    return box(slide, cx - d / 2, cy - d / 2, d, d, fill=fill, line=line, shape=MSO_SHAPE.OVAL, name=name)


def badge(slide, x, y, d, fill, glyph, glyph_color=ON_DARK, size=13, name=None):
    """Circular symbol: a filled circle with a short glyph (number or sign)."""
    s = dot(slide, x + d / 2, y + d / 2, d, fill, name=name)
    text(slide, 0, 0, 0, 0, glyph, size=size, color=glyph_color, bold=True,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, shape=s)
    return s


def pill(slide, x, y, w, txt, fill, color, h=0.32, size=11, line=None, bold=True, name=None):
    s = box(slide, x, y, w, h, fill=fill, line=line, radius=h / 2, name=name)
    text(slide, 0, 0, 0, 0, txt, size=size, color=color, bold=bold, align=PP_ALIGN.CENTER,
         anchor=MSO_ANCHOR.MIDDLE, shape=s)
    return s


def header(slide, num, section, title, dark=False, sub=None):
    label(slide, M, 0.5, 8, f"{num:02d}  ·  {section}", TEAL)
    text(slide, M, 0.82, CW, 0.6, title, size=28, bold=True, color=ON_DARK if dark else INK,
         name="Title")
    if sub:
        text(slide, M, 1.42, CW, 0.35, sub, size=14, color=ON_DARK_2 if dark else INK_2)


def footer(slide, num, dark=False):
    c = ON_DARK_2 if dark else INK_2
    text(slide, M, 7.0, 5, 0.22, [[("CLINISCOPE", {"bold": True, "spc": 100}),
                                   ("   |   PS-11R3", {"spc": 60})]], size=9.5, color=c)
    text(slide, W - M - 1.5, 7.0, 1.5, 0.22, f"{num:02d} / 08", size=9.5, color=c,
         align=PP_ALIGN.RIGHT, spacing=60)


def notes(slide, txt):
    slide.notes_slide.notes_text_frame.text = txt


def doc_card(slide, x, y, w, h, title, meta, rows, hi=None, hi_color=EVID, hi_text="",
             dark=True, faded=False):
    """Abstract clinical document: header, metadata and grey text lines; one row can be
    highlighted to show the statement used as evidence."""
    bg = SLATE if dark else CARD
    ln = BORDER_DARK if dark else BORDER_LIGHT
    bar = BORDER_DARK if dark else "E6EBF1"
    tcol = ON_DARK if dark else INK
    mcol = ON_DARK_2 if dark else INK_2
    box(slide, x, y, w, h, fill=bg, line=ln, radius=0.12, alpha=55 if faded else None)
    if faded:
        return None
    band = None
    label(slide, x + 0.2, y + 0.2, w - 0.4, title, tcol, size=9)
    text(slide, x + 0.2, y + 0.45, w - 0.4, 0.2, meta, size=8.5, color=mcol)
    ry = y + 0.85
    for i in range(rows):
        if hi is not None and i == hi:
            two = isinstance(hi_text, tuple)
            bh = 0.52 if two else 0.36
            box(slide, x + 0.14, ry - 0.07, w - 0.28, bh, fill=hi_color, radius=0.06,
                alpha=22 if dark else 25)
            box(slide, x + 0.14, ry - 0.07, 0.05, bh, fill=hi_color)
            paras = ([[(hi_text[0], {"size": 8, "bold": False, "color": mcol})], hi_text[1]]
                     if two else hi_text)
            text(slide, x + 0.28, ry - 0.07, w - 0.45, bh, paras, size=9.5, bold=True,
                 color=tcol, anchor=MSO_ANCHOR.MIDDLE)
            band = (x + 0.14, x + w - 0.14, ry - 0.07 + bh / 2)
            ry += bh - 0.36
        else:
            frac = (0.9, 0.72, 0.84, 0.6, 0.78, 0.66)[i % 6]
            box(slide, x + 0.2, ry + 0.06, (w - 0.4) * frac, 0.08, fill=bar, radius=0.04)
        ry += 0.38
    return band


def evidence_pair(slide, a, b, marker="", dark=True):
    """Link the highlighted rows of two doc cards (a left of b) with an amber evidence line."""
    x1, y1 = a[1], a[2]
    x2, y2 = b[0], b[2]
    arrow(slide, x1, y1, x2, y2, AMBER, w=2, head=False, name="Evidence line")
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    if marker:
        badge(slide, cx - 0.16, cy - 0.16, 0.32, AMBER, marker, glyph_color=CARD, size=12)
    else:
        dot(slide, cx, cy, 0.24, AMBER, line=NAVY if dark else CARD)


def principle(slide, x, y, w, h, tag, statement, size=20):
    """Navy statement band: the deck's recurring 'principle' motif."""
    box(slide, x, y, w, h, fill=NAVY, radius=0.14)
    dot(slide, x + 0.45, y + h / 2, 0.16, AMBER)
    label(slide, x + 0.75, y + h / 2 - 0.3, 3, tag, TEAL, size=9.5)
    text(slide, x + 0.75, y + h / 2 - 0.05, w - 1.1, 0.45, statement, size=size, bold=True,
         color=ON_DARK)


def bullet_list(slide, x, y, w, items, color=INK, marker=TEAL, size=13, gap=0.43, bold_lead=True):
    for lead, rest in items:
        box(slide, x, y + 0.08, 0.09, 0.09, fill=marker)
        runs = [(lead, {"bold": bold_lead}), (rest, {"bold": False, "color": INK_2})] if rest else [(lead, {})]
        text(slide, x + 0.25, y, w - 0.25, gap, [runs], size=size, color=color)
        y += gap
    return y


# ================================================================== SLIDE 1 · Introduction
s = slides[0]
clear(s, NAVY)
label(s, M, 0.62, 6, "Code Flayer 2.0   ·   PS-11R3", TEAL, size=11)
text(s, M, 1.25, 6.6, 1.0, "CLINISCOPE", size=58, bold=True, color=ON_DARK, spacing=300, name="Wordmark")
text(s, M, 2.3, 6.6, 0.45, "Healthcare Record Contradiction Detector", size=22, color=ON_DARK_2)
text(s, M, 3.15, 6.4, 0.9, [[("Find the conflict. ", {"color": AMBER}), ("Trace the evidence.", {"color": EVID})],
                            [("Keep humans in control.", {"color": TEAL})]], size=20, bold=True, line=1.15)
text(s, M, 4.05, 6.0, 0.8, "Helping reviewers identify potentially conflicting information across healthcare "
                           "records and trace the evidence behind each finding.", size=15, color=ON_DARK_2, line=1.2)
# metadata row
meta = [("Team", "[TEAM NAME]"), ("Members", "[MEMBER NAMES]"),
        ("Institution", "Vishnu Institute of Technology, Bhimavaram")]
mx = [M, M + 1.9, M + 3.8]
mw = [1.8, 1.8, 2.9]
box(s, M, 5.55, 6.6, 0.012, fill=BORDER_DARK)
for (k, v), x, w in zip(meta, mx, mw):
    label(s, x, 5.75, w, k, ON_DARK_2, size=9)
    text(s, x, 6.02, w, 0.5, v, size=12.5, color=ON_DARK, bold=True, line=1.1)
# evidence visual
doc_card(s, 7.9, 0.85, 2.15, 3.2, "", "", 0, faded=True)
a = doc_card(s, 7.55, 1.4, 2.35, 3.3, "Discharge summary", "12 Mar 2026 · page 2", 6, hi=2,
             hi_color=EVID, hi_text="Allergy: penicillin")
b = doc_card(s, 10.3, 2.1, 2.35, 3.3, "Intake form", "15 Mar 2026", 6, hi=3,
             hi_color=AMBER, hi_text="No known drug allergies")
evidence_pair(s, a, b)
pill(s, 8.15, 5.7, 3.9, "POTENTIAL CONFLICT  ·  2 VERIFIED SOURCES", SLATE, AMBER, line=AMBER, size=9.5)
pill(s, 8.7, 6.17, 2.8, "SENT TO HUMAN REVIEW", TEAL, NAVY, size=9.5)
text(s, 7.55, 6.65, 5.1, 0.25, "Illustration · synthetic data", size=9, color=ON_DARK_2, italic=True,
     align=PP_ALIGN.CENTER)
footer(s, 1, dark=True)
notes(s, "CLINISCOPE is a research prototype for PS-11R3. It surfaces potentially conflicting statements "
         "across healthcare records, attaches the exact source quotes, and leaves every decision to a person. "
         "The visual mirrors the real demo case: a penicillin allergy in one record versus 'No known drug "
         "allergies' in another (synthetic data). Fill in the team fields before presenting.")

# ================================================================== SLIDE 2 · Problem
s = slides[1]
clear(s, PAPER)
header(s, 2, "Problem statement", "The challenge: conflicting information across clinical records")
problems = [("01", "Fragmented information", "Relevant information may be spread across multiple records."),
            ("02", "Conflicting statements", "Two records may disagree about the same clinical fact."),
            ("03", "Manual comparison", "Reviewers may have to read and compare documents by hand."),
            ("04", "Limited traceability", "A useful finding must point to the exact source statements.")]
y = 1.85
for n, h_, d in problems:
    text(s, M, y, 0.6, 0.4, n, size=18, bold=True, color=BLUE)
    text(s, M + 0.7, y, 4.9, 0.35, h_, size=17, bold=True, color=INK)
    text(s, M + 0.7, y + 0.38, 4.9, 0.5, d, size=13.5, color=INK_2)
    if n != "04":
        box(s, M + 0.7, y + 1.0, 4.9, 0.012, fill=BORDER_LIGHT)
    y += 1.17
# illustration panel
px, py, pw, ph = 6.75, 1.75, 5.88, 4.95
box(s, px, py, pw, ph, fill=CARD, line=BORDER_LIGHT, radius=0.16)
pill(s, px + 0.3, py + 0.28, 2.75, "ILLUSTRATIVE EXAMPLE · SYNTHETIC", TINT_AMBER, "9A5A14", size=9)
a = doc_card(s, px + 0.3, py + 0.8, 2.4, 2.6, "Record A", "Discharge summary", 4, hi=1, hi_color=BLUE,
             hi_text=("Medication status", "active"), dark=False)
b = doc_card(s, px + 3.18, py + 0.8, 2.4, 2.6, "Record B", "Medication list", 4, hi=2, hi_color=BLUE,
             hi_text=("Medication status", "discontinued"), dark=False)
evidence_pair(s, a, b, marker="≠", dark=False)
# flow
fy = py + 3.62
steps = [("Multiple records", TINT_BLUE, "1F4E9C"), ("Inconsistent statements", TINT_AMBER, "9A5A14"),
         ("Review required", TINT_TEAL, "0E6E63")]
fx = px + 0.3
for i, (t, f, c) in enumerate(steps):
    wd = [1.45, 2.0, 1.55][i]
    pill(s, fx, fy, wd, t.upper(), f, c, h=0.36, size=8.5)
    fx += wd
    if i < 2:
        arrow(s, fx + 0.04, fy + 0.18, fx + 0.2, fy + 0.18, INK_2, w=1.25)
        fx += 0.24
text(s, px + 0.3, py + 4.2, pw - 0.6, 0.55, "A difference is not always an error: dates and context may explain it. "
                                            "A qualified reviewer decides.", size=11.5, color=INK_2, italic=True)
footer(s, 2)
notes(s, "Healthcare facts are recorded in many places: discharge summaries, intake forms, medication lists, "
         "lab reports and scanned letters. They can disagree. The example is illustrative and synthetic. "
         "Not every difference is an error; a dose may have been changed on purpose, so context and a human "
         "reviewer matter. No statistics are claimed.")

# ================================================================== SLIDE 3 · Solution
s = slides[2]
clear(s, PAPER)
header(s, 3, "Proposed solution", "CLINISCOPE turns discrepancies into reviewable evidence")
stages = [("01", "Ingest", BLUE, "PDF, scanned PDF, PNG/JPEG, TXT and DOCX, validated and de-duplicated."),
          ("02", "Extract", BLUE, "pdf.js text layer, on-device OCR for scans, mammoth for DOCX."),
          ("03", "Analyze", AMBER, "Deterministic rules compare statements within a case. Optional AI suggestions*."),
          ("04", "Trace", EVID, "Verbatim quotes re-verified at exact offsets, with page and OCR confidence."),
          ("05", "Review", TEAL, "A person confirms, resolves or dismisses. A reason is required and audited.")]
cw_, gap = 2.15, (CW - 5 * 2.15) / 4
for i, (n, t, c, d) in enumerate(stages):
    x = M + i * (cw_ + gap)
    box(s, x, 1.85, cw_, 2.85, fill=CARD, line=BORDER_LIGHT, radius=0.14)
    badge(s, x + 0.25, 2.1, 0.5, c, n, glyph_color=NAVY if c in (AMBER, EVID) else ON_DARK, size=12)
    text(s, x + 0.25, 2.8, cw_ - 0.4, 0.4, t.upper(), size=16, bold=True, color=INK, spacing=80)
    text(s, x + 0.25, 3.25, cw_ - 0.45, 1.4, d, size=12.5, color=INK_2, line=1.12)
    if i < 4:
        arrow(s, x + cw_ + 0.05, 3.27, x + cw_ + gap - 0.05, 3.27, TEAL, w=1.75)
principle(s, M, 5.0, CW, 1.15, "Principle", "Detection is the beginning. Evidence and human review are essential.")
text(s, M, 6.33, CW, 0.5, "* AI-assisted reasoning runs through the optional server. It is implemented and tested "
                          "with a stand-in provider, not yet with a live model. CLINISCOPE never diagnoses or "
                          "recommends treatment.", size=10.5, color=INK_2, line=1.1)
footer(s, 3)
notes(s, "Walk the five stages left to right. Amber marks where a potential contradiction appears; blue marks "
         "sources and evidence; teal marks progression to a human decision. Every finding must carry quotes "
         "that re-verify against the source text. AI is optional and its suggestions pass the same check.")

# ================================================================== SLIDE 4 · Architecture (dark)
s = slides[3]
clear(s, NAVY)
header(s, 4, "Technical approach", "A traceable pipeline from documents to human review", dark=True)
blocks = [("Input", BLUE, "Document input", "PDF · scan · image\nTXT · DOCX"),
          ("Processing", BLUE, "Extraction", "pdf.js · Tesseract.js\nOCR · mammoth"),
          ("Processing", BLUE, "Normalization", "negation, history,\nunits, dates"),
          ("Processing", AMBER, "Contradiction detection", "same-case rules,\ndeterministic"),
          ("Evidence", EVID, "Evidence association", "quotes re-verified\nat exact offsets"),
          ("Interface", TEAL, "Review interface", "queue · detail ·\ntimeline · audit")]
bw, bg_ = 1.78, (CW - 6 * 1.78) / 5
by, bh = 1.75, 1.85
for i, (layer, c, t, d) in enumerate(blocks):
    x = M + i * (bw + bg_)
    box(s, x, by, bw, bh, fill=SLATE, line=BORDER_DARK, radius=0.12)
    box(s, x + 0.2, by + 0.22, 0.32, 0.06, fill=c, radius=0.03)
    label(s, x + 0.2, by + 0.36, bw - 0.3, layer, c, size=8.5)
    text(s, x + 0.2, by + 0.62, bw - 0.35, 0.55, t, size=13, bold=True, color=ON_DARK, line=1.05)
    text(s, x + 0.2, by + 1.18, bw - 0.3, 0.6, d.split("\n"), size=10.5, color=ON_DARK_2)
    if i < 5:
        arrow(s, x + bw + 0.03, by + bh / 2, x + bw + bg_ - 0.03, by + bh / 2, TEAL, w=1.5)
# persistence bar
py_ = 4.05
for i in (0, 4, 5):
    x = M + i * (bw + bg_) + bw / 2
    arrow(s, x, by + bh, x, py_, BORDER_DARK, w=1.25, head=False)
box(s, M, py_, CW, 0.62, fill=SLATE, line=BORDER_DARK, radius=0.1)
label(s, M + 0.25, py_ + 0.19, 2.0, "Persistence", TEAL, size=9)
text(s, M + 1.75, py_ + 0.17, CW - 2.0, 0.3, "IndexedDB via Dexie, in the browser: cases · original files · "
     "statements · findings · append-only audit events", size=12, color=ON_DARK)
# optional server layer (dashed)
oy = 4.95
box(s, M, oy, 7.45, 1.8, fill=None, line=ON_DARK_2, lw=1, radius=0.12, dash=True)
label(s, M + 0.25, oy + 0.18, 7, "Optional server layer · implemented and tested, not publicly deployed",
      ON_DARK_2, size=8.5)
for j, (t, d) in enumerate([("Shared workspace API", "Node 22 + SQLite: accounts, case roles,\nshared review state, append-only audit"),
                            ("AI-assisted reasoning", "Anthropic API via the server; every quote\nre-verified. Not yet run on a live model")]):
    x = M + 0.25 + j * 3.6
    box(s, x, oy + 0.55, 3.4, 1.05, fill=SLATE, line=BORDER_DARK, radius=0.1)
    text(s, x + 0.2, oy + 0.66, 3.0, 0.3, t, size=12, bold=True, color=ON_DARK)
    text(s, x + 0.2, oy + 0.97, 3.1, 0.6, d.split("\n"), size=10, color=ON_DARK_2)
# technical note
nx = M + 7.7
box(s, nx, oy, CW - 7.7, 1.8, fill=SLATE, line=BORDER_DARK, radius=0.12)
label(s, nx + 0.25, oy + 0.18, 3.5, "Why traceability", EVID, size=9)
text(s, nx + 0.25, oy + 0.48, CW - 8.2, 1.25, "Each finding stores the quotes, document, date and verified page "
     "behind it, so a reviewer can see why it was raised and check it in the source.", size=12,
     color=ON_DARK, line=1.15)
footer(s, 4, dark=True)
notes(s, "Data flows left to right. Everything in the top row and the persistence bar runs in the browser, and "
         "the public demo uses only this. The dashed area is real code (server/ folder) with integration and "
         "end-to-end tests, but it is not hosted publicly and the AI path has only been tested with a stand-in "
         "provider. Scanned PDFs and images go through Tesseract.js OCR; low-confidence OCR text lowers the "
         "evidence rating.")

# ================================================================== SLIDE 5 · Technology stack
s = slides[4]
clear(s, PAPER)
header(s, 5, "Technology stack", "Technology chosen for a practical, extensible implementation",
       sub="Verified in package.json, source imports and the CI workflow.")
cats = [("Frontend", BLUE, ["React 18", "TypeScript", "Vite", "Tailwind CSS"],
         "Single-page review interface with hash routing for static hosting."),
        ("Document processing", EVID, ["pdfjs-dist", "Tesseract.js 6", "mammoth"],
         "PDF text layer, on-device OCR and DOCX extraction in the browser."),
        ("Data & persistence", TEAL, ["Dexie", "IndexedDB"],
         "Local cases, original files, findings and an append-only audit log."),
        ("Testing", AMBER, ["Vitest", "Playwright", "fake-indexeddb"],
         "Unit, integration and end-to-end tests, incl. OCR and two-user flows."),
        ("Build & delivery", INK_2, ["GitHub Actions", "GitHub Pages"],
         "Each push type-checks, tests, builds, deploys and re-tests the live site.")]
cw_, gap = 2.2, (CW - 5 * 2.2) / 4
for i, (t, c, chips, role) in enumerate(cats):
    x = M + i * (cw_ + gap)
    box(s, x, 2.0, cw_, 3.55, fill=CARD, line=BORDER_LIGHT, radius=0.14)
    box(s, x + 0.25, 2.27, 0.32, 0.06, fill=c, radius=0.03)
    label(s, x + 0.25, 2.42, cw_ - 0.4, t, INK, size=10)
    cy = 3.0
    for ch in chips:
        pill(s, x + 0.25, cy, cw_ - 0.5, ch, PAPER, INK, h=0.34, size=11, line=BORDER_LIGHT)
        cy += 0.42
    text(s, x + 0.25, 4.68, cw_ - 0.45, 0.85, role, size=11, color=INK_2, line=1.1)
box(s, M, 5.8, CW, 0.9, fill=None, line=INK_2, lw=1, radius=0.12, dash=True)
label(s, M + 0.3, 5.93, 6, "Optional server layer · not publicly deployed", INK_2, size=9)
text(s, M + 0.3, 6.2, CW - 0.6, 0.4, [[("Node 22  ·  node:sqlite  ·  Anthropic SDK + Zod  ·  Docker / Render config",
                                         {"bold": True, "color": INK}),
                                        ("   Adds sharing and AI only where configured.", {"color": INK_2})]],
     size=12.5)
footer(s, 5)
notes(s, "Only verified dependencies are shown. The browser app works on its own, which is why the public demo "
         "needs no server. The optional server bundles to a single file; its Docker image and Render blueprint "
         "have not been run.")

# ================================================================== SLIDE 6 · Feasibility
s = slides[5]
clear(s, PAPER)
header(s, 6, "Feasibility & viability", "A practical foundation with a clear path to extension")
cols = [("Implemented", "in code today", TEAL, TINT_TEAL, "0E6E63", False,
         [("Ingestion: ", "PDF, scans, images, TXT, DOCX"),
          ("Rules engine: ", "statements and contradictions"),
          ("Evidence-linked ", "findings with source view"),
          ("Review: ", "queue, reasons, audit log"),
          ("Optional ", "shared-workspace API and AI layer")]),
        ("Validated", "by automated tests only", BLUE, TINT_BLUE, "1F4E9C", False,
         [(f"{UNIT} unit and integration ", "tests pass"),
          (f"{E2E} end-to-end ", "tests pass (Playwright)"),
          ("Type-check and build ", "pass in CI"),
          ("Live site ", "re-tested after deploy"),
          ("No clinical validation ", "yet")]),
        ("Planned", "next steps", INK_2, "EEF1F5", INK_2, True,
         [("Evaluate ", "on carefully reviewed examples"),
          ("Measure ", "false positives and misses"),
          ("Run AI ", "against a live model"),
          ("Host the API ", "with secure access"),
          ("Improve ", "complex and tabular documents")])]
cw_, gap = 3.8, (CW - 3 * 3.8) / 2
for i, (t, sub, c, tint, tc, dashed, items) in enumerate(cols):
    x = M + i * (cw_ + gap)
    box(s, x, 1.75, cw_, 3.95, fill=CARD, line=c if dashed else BORDER_LIGHT, lw=1 if dashed else 0.75,
        radius=0.14, dash=dashed)
    pill(s, x + 0.3, 2.0, 1.55, t.upper(), tint, tc, size=9.5)
    text(s, x + 1.98, 2.04, cw_ - 2.1, 0.3, sub, size=10.5, color=INK_2, italic=True)
    bullet_list(s, x + 0.3, 2.62, cw_ - 0.5, items, marker=c, size=12.5, gap=0.6)
    if i < 2:
        arrow(s, x + cw_ + 0.07, 3.72, x + cw_ + gap - 0.07, 3.72, INK_2, w=1.25)
principle(s, M, 5.95, CW, 0.85, "Key point", "Present in code is not tested, and tested is not clinically validated.",
          size=17)
footer(s, 6)
notes(s, f"Counts are from a local run on the current code: {UNIT} Vitest tests and {E2E} Playwright tests passed, "
         "plus type-check. CI runs the same suite on every push and re-runs end-to-end tests against the live "
         "GitHub Pages site. None of this is clinical validation. No cost, revenue or adoption figures are claimed.")

# ================================================================== SLIDE 7 · Sustainability
s = slides[6]
clear(s, PAPER)
header(s, 7, "Sustainability, scalability & impact", "Designed to grow responsibly with clinical review needs")
stages7 = [("Current foundation", TEAL, False, "Implemented",
            ["Conflicting statements in one queue", "Navigation to the exact source", "Findings organized for investigation",
             "Audited reviewer decisions"]),
           ("Validation & extension", BLUE, False, "Future work",
            ["Evaluation on curated test sets", "Live-model AI with evidence checks", "Hosted, secure multi-user review",
             "More formats and vocabulary"]),
           ("Potential broader adoption", INK_2, True, "Only if evaluation supports it",
            ["Integration with record systems", "Pilots after required approvals", "Monitored use with oversight"])]
cw_, gap = 3.8, (CW - 3 * 3.8) / 2
for i, (t, c, dashed, tag, items) in enumerate(stages7):
    x = M + i * (cw_ + gap)
    box(s, x, 1.75, cw_, 2.85, fill=CARD, line=c if dashed else BORDER_LIGHT, lw=1 if dashed else 0.75,
        radius=0.14, dash=dashed)
    badge(s, x + 0.3, 1.98, 0.42, c, str(i + 1), size=12)
    text(s, x + 0.85, 1.98, cw_ - 1.0, 0.25, t, size=14.5, bold=True, color=INK)
    text(s, x + 0.85, 2.24, cw_ - 1.0, 0.25, tag.upper(), size=8.5, bold=True, color=c, spacing=100)
    yy = 2.72
    for it in items:
        box(s, x + 0.32, yy + 0.08, 0.08, 0.08, fill=c)
        text(s, x + 0.55, yy, cw_ - 0.75, 0.4, it, size=12, color=INK_2)
        yy += 0.42
    if i < 2:
        arrow(s, x + cw_ + 0.07, 3.17, x + cw_ + gap - 0.07, 3.17, INK_2, w=1.25)
label(s, M, 4.83, 6, "Responsible scaling requires", INK, size=10)
tags = ["Privacy", "Access control", "Data protection", "Auditability", "Clinical evaluation", "Human oversight",
        "Uncertainty handling", "Error monitoring"]
nat = [0.3 + 0.07 * len(t) for t in tags]
k = (CW - 0.1 * (len(tags) - 1)) / sum(nat)
tx = M
for t, n in zip(tags, nat):
    pill(s, tx, 5.15, n * k, t, CARD, INK, h=0.36, size=10, line=BORDER_LIGHT, bold=False)
    tx += n * k + 0.1
principle(s, M, 5.8, CW, 0.95, "Impact", "Potential impact must be demonstrated through evaluation, not assumed.",
          size=18)
footer(s, 7)
notes(s, "Column 1 is what exists. Column 2 is future work: note that role-based access and audit trails already "
         "exist in the optional server, but it is not hosted or security-reviewed. Column 3 depends on evaluation. "
         "CLINISCOPE is not used by any hospital and makes no outcome or cost claims; it supports, never replaces, "
         "a qualified clinician.")

# ================================================================== SLIDE 8 · Conclusion (dark)
s = slides[7]
clear(s, NAVY)
label(s, M, 0.62, 8, "08  ·  Conclusion", TEAL, size=11)
text(s, M, 1.0, 7.2, 1.4, "From scattered records to traceable contradictions", size=36, bold=True,
     color=ON_DARK, line=1.05, name="Title")
pts = [("Identify", AMBER, "1", "Surface potentially conflicting statements."),
       ("Trace", EVID, "2", "Connect findings to their source evidence."),
       ("Review", TEAL, "3", "Help humans investigate and decide.")]
for i, (t, c, g, d) in enumerate(pts):
    x = M + i * 2.42
    badge(s, x, 2.75, 0.46, c, g, glyph_color=NAVY, size=14)
    text(s, x, 3.35, 2.2, 0.4, t.upper(), size=17, bold=True, color=ON_DARK, spacing=100)
    text(s, x, 3.75, 2.2, 0.8, d, size=13, color=ON_DARK_2, line=1.12)
text(s, M, 4.9, 7.5, 0.5, [[("Find the conflict. ", {"color": AMBER}), ("Trace the evidence. ", {"color": EVID}),
                             ("Keep humans in control.", {"color": TEAL})]], size=18, bold=True)
box(s, M, 5.65, 7.0, 0.012, fill=BORDER_DARK)
text(s, M, 5.8, 7.2, 0.3, [[("CLINISCOPE", {"bold": True, "color": ON_DARK, "spc": 150}),
                            ("   PS-11R3 · Healthcare Record Contradiction Detector", {"color": ON_DARK_2})]], size=12)
text(s, M, 6.15, 7.4, 0.5, [[("Code   ", {"bold": True, "color": TEAL}), (REPO, {})],
                            [("Live demo   ", {"bold": True, "color": TEAL}), (SITE, {})]], size=10.5,
     color=ON_DARK_2, after=2)
# reprise of the cover visual
a = doc_card(s, 8.3, 1.15, 2.0, 2.85, "Record A", "Source 1", 5, hi=2, hi_color=EVID, hi_text="Statement A")
b = doc_card(s, 10.65, 1.75, 2.0, 2.85, "Record B", "Source 2", 5, hi=3, hi_color=AMBER, hi_text="Statement B")
evidence_pair(s, a, b)
pill(s, 8.92, 4.85, 3.1, "TRACEABLE FINDING  →  HUMAN REVIEW", TEAL, NAVY, size=9.5)
qr = s.shapes.add_picture(QR, Inches(11.45), Inches(5.3), Inches(1.2), Inches(1.2))
qr.name = "QR live demo"
qr._element.nvPicPr.cNvPr.set("descr", "QR code to the CLINISCOPE live demo: https://" + SITE + "/")
text(s, 8.4, 5.55, 2.9, 0.75, ["Scan for the live demo", "(static browser version)"], size=10.5,
     color=ON_DARK_2, align=PP_ALIGN.RIGHT)
footer(s, 8, dark=True)
notes(s, "Close on the three verbs. CLINISCOPE helps turn potential contradictions into traceable findings for "
         "human review. The live demo is the static browser version on GitHub Pages; its deployment was "
         "re-tested by CI. It runs on synthetic data and is not for clinical use.")

prs.save(OUT)
print("saved", OUT)
