"""Checks the judge-preparation PDF: page count, 100 questions each with a spoken answer,
question-index page numbers, required URLs, broken glyphs. Usage: python3 docs/dossier/validate-pdf.py <pdf>"""
import re, subprocess, sys

pdf = sys.argv[1]
info = subprocess.check_output(['pdfinfo', pdf]).decode()
n = int(re.search(r'Pages:\s+(\d+)', info).group(1))
pages = [subprocess.check_output(['pdftotext', '-f', str(p), '-l', str(p), pdf, '-']).decode() for p in range(1, n + 1)]
print(f'pages: {n}')

# Body question headings: "Qn. ..." followed (on the same or next page) by "Say it:" before the next question.
heads = {}
for i, t in enumerate(pages):
    for m in re.finditer(r'(?m)^Q(\d{1,3})\. (.+)$', t):
        rest = t[m.end():] + (pages[i + 1] if i + 1 < n else '')
        nxt = re.search(r'(?m)^Q\d{1,3}\. ', rest)
        seg = rest[: nxt.start()] if nxt else rest
        if 'Say it:' in seg:
            heads.setdefault(int(m.group(1)), i + 1)
missing = [q for q in range(1, 101) if q not in heads]
print(f'questions with a "Say it" answer: {len(heads)} / 100; missing: {missing}')

# Question index: lines "Qn. title" with a page number; find the pages that hold it.
idx = [i for i, t in enumerate(pages) if 'Page numbers link to each question' in t]
bad = checked = 0
if idx:
    start = idx[0]
    text = '\n'.join(pages[start:start + 3])
    for m in re.finditer(r'(?m)^Q(\d{1,3})\. [^\n]*\n(?:[^\n]*\n)??(\d{1,3})$', text):
        q, pg = int(m.group(1)), int(m.group(2))
        checked += 1
        if heads.get(q) != pg:
            bad += 1
            print(f'  index Q{q} says page {pg}, heading is on page {heads.get(q)}')
print(f'index entries parsed: {checked}, mismatches: {bad}')

alltext = ''.join(pages)
flat = re.sub(r'\s+', '', alltext)
print('replacement glyphs (U+FFFD):', alltext.count('�'))
for s in ['https://anirudhleetcode-max.github.io/cliniscope-healthcare-contradiction-detector/',
          'https://medguard-api-duti.onrender.com', 'NOT VERIFIED', 'PostgreSQL', 'Neon', 'PLANNED OR PROPOSED']:
    print(f'contains {s!r}: {re.sub(chr(32), "", s) in flat}')
