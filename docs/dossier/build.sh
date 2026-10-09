#!/usr/bin/env bash
# Builds docs/MEDGUARD_HACKATHON_JUDGE_PREPARATION.pdf from the Markdown source.
# Requires: pandoc (3.x), Node 22 with the repository's Playwright install, poppler-utils (pdfinfo, pdftotext).
# Optional: CHROMIUM_PATH=/path/to/chromium if Playwright's bundled browser is not installed.
set -euo pipefail
cd "$(dirname "$0")/.."            # docs/
MD=MEDGUARD_HACKATHON_JUDGE_PREPARATION.md
HTML=.dossier-build.html
pandoc "$MD" --from markdown --to html5 --standalone --toc --toc-depth=2 \
  --css dossier/dossier.css --metadata pagetitle="MEDGUARD Judge Preparation Dossier" -o "$HTML"
node dossier/render-pdf.mjs "$HTML" MEDGUARD_HACKATHON_JUDGE_PREPARATION.pdf
rm -f "$HTML"
pdfinfo MEDGUARD_HACKATHON_JUDGE_PREPARATION.pdf | grep -E '^Pages'
