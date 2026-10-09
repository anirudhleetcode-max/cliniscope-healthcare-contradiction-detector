// Renders synthetic records to raster images in Chromium (simulating a paper
// scan: slight rotation, grain, uneven toner) and wraps them in PDFs with NO
// text layer. Run: npm run demo:generate
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { SCANNED_DISCHARGE_LINES, MIXED_PAGE1_LINES, MIXED_PAGE2_LINES } from './demo-content.mjs';

const out = new URL('../public/demo/', import.meta.url);
mkdirSync(out, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function html(lines) {
  const body = lines.map((l) => {
    if (!l) return '<div class="gap"></div>';
    const heading = /^[A-Z0-9 ()\-—/]+$/.test(l) && l.length < 60;
    const line = esc(l).replace(/\{SMUDGE:([^}]+)\}/g, '<span class="smudge">$1</span>');
    return `<div class="${heading ? 'h' : 'l'}">${line}</div>`;
  }).join('');
  return `<!doctype html><html><head><style>
    html,body{margin:0;background:#f4f1ea}
    .page{width:1240px;height:1754px;padding:130px 140px;box-sizing:border-box;transform:rotate(-0.6deg);
      font-family:"DejaVu Serif","Liberation Serif",serif;color:#1d1d1d;font-size:33px;line-height:1.5;
      background:radial-gradient(circle at 70% 20%,#f7f4ee,#ece7dc)}
    .h{font-weight:bold;margin-top:6px;letter-spacing:1px}
    .l{opacity:.92}
    .gap{height:26px}
    .smudge{filter:blur(2.6px);opacity:.55;background:rgba(80,70,60,.18);border-radius:8px;padding:0 3px}
    .grain{position:fixed;inset:0;pointer-events:none;opacity:.10;
      background-image:radial-gradient(#000 0.6px,transparent 0.7px);background-size:5px 5px}
  </style></head><body><div class="page">${body}</div><div class="grain"></div></body></html>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
async function render(lines) {
  await page.setContent(html(lines));
  return page.screenshot({ type: 'png' });
}

async function imagePdf(pngs, { textPages = {} } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Synthetic scanned record');
  pdf.setCreationDate(new Date('2026-03-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-03-01T00:00:00Z'));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pngs.length; i++) {
    const p = pdf.addPage([595, 842]);
    if (textPages[i]) {
      let y = 790;
      for (const line of textPages[i]) { if (line) p.drawText(line, { x: 56, y, size: 11, font, color: rgb(0.1, 0.15, 0.3) }); y -= 18; }
      continue;
    }
    const img = await pdf.embedPng(pngs[i]);
    p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  return pdf.save();
}

const scan = await render(SCANNED_DISCHARGE_LINES);
writeFileSync(new URL('scanned-discharge-letter-2025-11-20.pdf', out), await imagePdf([scan]));
writeFileSync(new URL('scanned-discharge-letter-2025-11-20.png', out), scan);
const page2 = await render(MIXED_PAGE2_LINES);
writeFileSync(new URL('sample-mixed-text-and-scan-2026-03-22.pdf', out), await imagePdf([null, page2], { textPages: { 0: MIXED_PAGE1_LINES } }));
await browser.close();
console.log('Scanned demo documents written to public/demo/');
