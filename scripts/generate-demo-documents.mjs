// Generates the synthetic demo documents into public/demo/.
// Run: npm run demo:generate
import { writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import {
  DISCHARGE_SUMMARY_PAGES, INTAKE_FORM_PARAGRAPHS, MED_REC_TEXT, LAB_REPORT_LINES, FOLLOW_UP_NOTE_TEXT, BANNER,
} from './demo-content.mjs';

const out = new URL('../public/demo/', import.meta.url);
mkdirSync(out, { recursive: true });

async function makePdf(pages, { title }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor('MEDGAURD synthetic demo generator');
  pdf.setCreationDate(new Date('2026-03-12T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-03-12T00:00:00Z'));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    let y = 790;
    for (const line of lines) {
      if (!line) { y -= 14; continue; }
      const isHeading = /^[A-Z0-9 /()—-]+$/.test(line) && line.length < 60;
      const isBanner = line === BANNER;
      page.drawText(line, {
        x: 56, y, size: isBanner ? 9 : 11, font: isHeading || isBanner ? bold : font,
        color: isBanner ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.15, 0.3),
      });
      y -= isHeading ? 20 : 17;
    }
  }
  return pdf.save({ useObjectStreams: false });
}

async function makeScannedPdf() {
  // A PDF with no text layer (only vector shapes), used to demonstrate
  // honest "no extractable text" handling. OCR is not performed.
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  for (let i = 0; i < 18; i++) page.drawRectangle({ x: 56, y: 760 - i * 30, width: 300 + (i % 4) * 40, height: 8, color: rgb(0.75, 0.75, 0.75) });
  return pdf.save();
}

writeFileSync(new URL('discharge-summary-2026-03-12.pdf', out), await makePdf(DISCHARGE_SUMMARY_PAGES, { title: 'Discharge Summary (synthetic)' }));
writeFileSync(new URL('laboratory-report-2026-03-11.pdf', out), await makePdf([LAB_REPORT_LINES], { title: 'Laboratory Report (synthetic)' }));
writeFileSync(new URL('medication-reconciliation-2026-03-14.txt', out), MED_REC_TEXT);
writeFileSync(new URL('sample-follow-up-note-2026-03-20.txt', out), FOLLOW_UP_NOTE_TEXT);
writeFileSync(new URL('sample-scanned-no-text-layer.pdf', out), await makeScannedPdf());

const doc = new Document({
  creator: 'MEDGAURD synthetic demo generator',
  title: 'Patient Intake Form (synthetic)',
  sections: [{ children: INTAKE_FORM_PARAGRAPHS.map((t) => new Paragraph({ children: [new TextRun({ text: t, bold: t === BANNER })] })) }],
});
writeFileSync(new URL('patient-intake-form-2026-03-15.docx', out), await Packer.toBuffer(doc));
console.log('Demo documents written to public/demo/');
