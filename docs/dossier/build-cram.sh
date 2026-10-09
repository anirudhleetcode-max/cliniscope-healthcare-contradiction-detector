#!/usr/bin/env bash
# Builds docs/MEDGUARD_JUDGE_CRAM_SHEET.pdf (the 30-minute short version) from its Markdown source.
# Same requirements as build.sh.
set -euo pipefail
cd "$(dirname "$0")/.."            # docs/
MD=MEDGUARD_JUDGE_CRAM_SHEET.md
HTML=.cram-build.html
pandoc "$MD" --from markdown --to html5 --standalone \
  --css dossier/dossier.css --css dossier/cram.css --metadata pagetitle="MEDGUARD Judge Cram Sheet" -o "$HTML"
DOC_FOOTER="MEDGUARD · 30-Minute Judge Cram Sheet · PS-11R3" node dossier/render-pdf.mjs "$HTML" MEDGUARD_JUDGE_CRAM_SHEET.pdf
rm -f "$HTML"
pdfinfo MEDGUARD_JUDGE_CRAM_SHEET.pdf | grep -E '^Pages'
