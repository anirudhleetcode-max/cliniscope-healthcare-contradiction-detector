// Renders the dossier HTML to an A4 PDF with headless Chromium (Playwright).
// Two passes: pass 1 places an invisible marker in every TOC target and question heading,
// the markers are located in the PDF text to learn their page numbers, and pass 2 writes
// those page numbers into the table of contents and the question index.
//
// Usage: node docs/dossier/render-pdf.mjs <input.html> <output.pdf>
// Env:   CHROMIUM_PATH (optional) — Chromium executable for Playwright.
//        DOC_FOOTER (optional) — left-hand footer text.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: render-pdf.mjs <input.html> <output.pdf>'); process.exit(2); }

const FOOTER = `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#526176;padding:0 16mm;display:flex;justify-content:space-between">
  <span>${process.env.DOC_FOOTER || 'MEDGUARD · Hackathon Judge Preparation Dossier · PS-11R3'}</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
const HEADER = `<div style="width:100%;font-family:Arial,sans-serif;font-size:7pt;color:#8A96A8;padding:0 16mm;text-align:right">Evidence collected 9 Oct 2026 · synthetic data only · not for clinical use</div>`;

// Runs in the page: builds the question index and (pass 1) inserts markers or (pass 2) page numbers.
function prepare({ pages, markers }) {
  const qs = [...document.querySelectorAll('h3.q')];
  const tocLinks = [...document.querySelectorAll('nav#TOC a')];
  const targets = [
    ...tocLinks.map((a) => document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))),
    ...qs,
  ];
  // Question index, grouped by category heading.
  const list = document.getElementById('qindex-list');
  if (list && !list.dataset.built) {
    list.dataset.built = '1';
    // Walk h2 (category) and h3.q (question) headings in document order.
    for (const h of document.querySelectorAll('#questions ~ h2, h3.q')) {
      if (h.tagName === 'H2') {
        if (!/^Category/.test(h.textContent)) continue;
        const d = document.createElement('div'); d.className = 'cat'; d.textContent = h.textContent; list.appendChild(d);
        continue;
      }
      const a = document.createElement('a'); a.href = '#' + h.id;
      a.innerHTML = `<span class="lbl"></span><span class="pg"></span>`;
      a.querySelector('.lbl').textContent = h.textContent.replace(/\s+/g, ' ').trim();
      list.appendChild(a);
    }
  }
  for (const a of tocLinks) {
    if (!a.querySelector('.lbl')) { const t = a.textContent; a.innerHTML = `<span class="lbl"></span><span class="pg"></span>`; a.querySelector('.lbl').textContent = t; }
  }
  const qLinks = list ? [...list.querySelectorAll('a')] : [];
  const pgEls = [...tocLinks, ...qLinks].map((a) => a.querySelector('.pg'));
  document.querySelectorAll('.pdfmark').forEach((m) => m.remove());
  targets.forEach((el, i) => {
    if (!el) return;
    if (markers) {
      const m = document.createElement('span'); m.className = 'pdfmark';
      m.style.cssText = 'position:absolute;left:0;top:0;font-size:1px;line-height:1px;white-space:nowrap;pointer-events:none';
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      m.textContent = `ZQMARK${String(i).padStart(4, '0')}Z`;
      el.appendChild(m);
    }
  });
  if (pages) pgEls.forEach((p, i) => { if (p) p.textContent = pages[i] ?? ''; });
  return targets.length;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const url = pathToFileURL(resolve(input)).href;
const pdfOpts = { format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: HEADER, footerTemplate: FOOTER,
  preferCSSPageSize: true, outline: true, tagged: true };

const tmp = mkdtempSync(join(tmpdir(), 'dossier-'));
try {
  // Iterate: render with markers (and the page numbers found so far) until the numbers stop changing.
  let pages = null;
  for (let pass = 1; pass <= 4; pass++) {
    await page.goto(url, { waitUntil: 'networkidle' });
    const n = await page.evaluate(prepare, { pages, markers: true });
    const file = join(tmp, `pass${pass}.pdf`);
    await page.pdf({ ...pdfOpts, path: file });
    const pageCount = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file]).toString())[1]);
    const found = new Array(n).fill('');
    for (let p = 1; p <= pageCount; p++) {
      const text = execFileSync('pdftotext', ['-f', String(p), '-l', String(p), file, '-']).toString().replace(/\s+/g, '');
      for (const m of text.matchAll(/ZQMARK(\d{4})Z/g)) { const i = Number(m[1]); if (!found[i]) found[i] = String(p); }
    }
    const stable = pages && found.every((v, i) => v === pages[i]);
    console.log(`pass ${pass}: markers ${n}, located ${found.filter(Boolean).length}, pages ${pageCount}${stable ? ' (stable)' : ''}`);
    pages = found;
    if (stable) break;
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(prepare, { pages, markers: false });
  await page.pdf({ ...pdfOpts, path: output });
} finally {
  rmSync(tmp, { recursive: true, force: true });
  await browser.close();
}
