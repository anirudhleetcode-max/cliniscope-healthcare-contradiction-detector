import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractImage, extractPdf, ocrToText, validateUpload, type OcrEngine, type PdfJsLike } from '../../src/lib/extract';
import { extractStatements } from '../../src/lib/statements';
import { detectContradictions } from '../../src/lib/detect';
import { demoPath, extractFile, makeDoc } from './helpers';
import { nodeOcr, terminateOcr } from './nodeOcr';

afterAll(() => terminateOcr());
const read = (f: string) => new Uint8Array(readFileSync(demoPath(f)));

describe('OCR (real Tesseract.js, no mocks)', () => {
  it('detects a scanned PDF, runs OCR and preserves page provenance and confidence', async () => {
    const r = await extractFile('s.pdf', read('scanned-discharge-letter-2025-11-20.pdf'));
    expect(r.ok).toBe(true);
    expect(r.method).toBe('pdf-ocr');
    expect(r.pageSpans[0]).toMatchObject({ page: 1, method: 'ocr' });
    expect(r.pageSpans[0].ocrConfidence).toBeGreaterThan(80);
    expect(r.text).toContain('Penicillin allergy - urticaria.');
    expect(r.text).toContain('Metformin 500 mg twice daily.');
    expect(r.warnings[0]).toMatch(/read with OCR/);
  }, 60000);

  it('without an OCR engine the same scan is reported honestly as unreadable', async () => {
    const r = await extractFile('s.pdf', read('scanned-discharge-letter-2025-11-20.pdf'), { ocr: false });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/OCR is not available/);
  });

  it('mixed PDF: page 1 from the text layer, page 2 by OCR', async () => {
    const r = await extractFile('m.pdf', read('sample-mixed-text-and-scan-2026-03-22.pdf'));
    expect(r.method).toBe('pdf-text-layer+ocr');
    expect(r.pageSpans.map((p) => p.method)).toEqual(['text-layer', 'ocr']);
    const p1 = r.text.slice(r.pageSpans[0].start, r.pageSpans[0].end);
    const p2 = r.text.slice(r.pageSpans[1].start, r.pageSpans[1].end);
    expect(p1).toContain('Lisinopril 20 mg once daily.');
    expect(p2).toContain('No known drug allergies.');
  }, 60000);

  it('OCR text from a scan flows through statement extraction and detection with OCR provenance', async () => {
    const r = await extractFile('s.pdf', read('scanned-discharge-letter-2025-11-20.pdf'));
    const scan = makeDoc('c1', r.text, { fileKind: 'pdf', pageSpans: r.pageSpans, extractionMethod: r.method, ocrRegions: r.ocrRegions, ocrLowConfidence: r.ocrLowConfidence, documentDate: '2025-11-20', title: 'Scan' });
    const intake = makeDoc('c1', 'Allergies: No known drug allergies.', { documentDate: '2026-03-15', title: 'Intake' });
    const st = [scan, intake].flatMap((d) => extractStatements(d));
    const pen = st.find((s) => s.concept === 'allergy:penicillin')!;
    expect(pen.ocrDerived).toBe(true);
    expect(pen.sourcePage).toBe(1);
    expect(pen.extractionConfidence).not.toBe('high');
    expect(r.text.slice(pen.charStart, pen.charEnd)).toBe(pen.originalText);
    const f = detectContradictions('c1', st, [scan, intake]).findings.find((x) => x.concept === 'allergy:penicillin')!;
    expect(f.findingType).toBe('explicit_conflict');
    expect(f.evidenceQuality).toBe('moderate'); // never "high" when a side is OCR-derived
    expect(f.evidence.find((e) => e.side === 'A')!.ocrDerived).toBe(true);
    expect(f.contextualCaveats.join(' ')).toMatch(/produced by OCR/);
  }, 60000);

  it('a smudged dose that OCR cannot read is flagged "unable to determine", never guessed', async () => {
    const r = await extractFile('s.pdf', read('scanned-discharge-letter-2025-11-20.pdf'));
    const scan = makeDoc('c1', r.text, { fileKind: 'pdf', pageSpans: r.pageSpans, ocrRegions: r.ocrRegions, ocrLowConfidence: r.ocrLowConfidence, documentDate: '2025-11-20' });
    const typed = makeDoc('c1', 'MEDICATIONS\nAtorvastatin 20 mg at night.', { documentDate: '2026-03-12' });
    const st = [scan, typed].flatMap((d) => extractStatements(d));
    const ator = st.find((s) => s.concept === 'medication:atorvastatin' && s.documentId === scan.id)!;
    expect(ator.valueUnreadable).toBe(true);
    expect(ator.value).toBeNull();
    const f = detectContradictions('c1', st, [scan, typed]).findings;
    expect(f).toHaveLength(1);
    expect(f[0].findingType).toBe('insufficient_evidence');
    expect(f[0].contextualCaveats.join(' ')).toMatch(/Unable to determine the value reliably/);
  }, 60000);

  it('low-confidence OCR words downgrade a would-be conflict to insufficient evidence', () => {
    // Synthetic OCR engine output (structure only) to exercise the confidence rule deterministically.
    const built = ocrToText({ confidence: 60, lines: [{ words: [{ text: 'Metformin', confidence: 91 }, { text: '850', confidence: 41 }, { text: 'mg', confidence: 88 }, { text: 'twice', confidence: 90 }, { text: 'daily.', confidence: 90 }] }] });
    expect(built.text).toBe('Metformin 850 mg twice daily.');
    const low = built.words.filter((w) => w.confidence < 70);
    const scan = makeDoc('c1', 'MEDICATIONS\n' + built.text, {
      fileKind: 'image', ocrRegions: [{ start: 12, end: 12 + built.text.length, confidence: 60 }],
      ocrLowConfidence: low.map((w) => ({ ...w, start: w.start + 12, end: w.end + 12 })),
    });
    const typed = makeDoc('c1', 'MEDICATIONS\nMetformin 500 mg twice daily.');
    const st = [scan, typed].flatMap((d) => extractStatements(d));
    const s = st.find((x) => x.documentId === scan.id)!;
    expect(s.ocrLowConfidence).toBe(true);
    expect(s.ocrMinConfidence).toBe(41);
    const f = detectContradictions('c1', st, [scan, typed]).findings[0];
    expect(f.findingType).toBe('insufficient_evidence');
    expect(f.title).toMatch(/^OCR text requires review/);
    expect(f.evidenceQuality).toBe('limited');
  });

  it('image upload (PNG) is validated and OCR-read', async () => {
    const png = read('scanned-discharge-letter-2025-11-20.png');
    expect(validateUpload('scan.png', 'image/png', png)).toBe('image');
    expect(() => validateUpload('fake.png', 'image/png', new TextEncoder().encode('not an image'))).toThrow(/not a valid PNG or JPEG/);
    const r = await extractImage(png, nodeOcr);
    expect(r.ok).toBe(true);
    expect(r.method).toBe('image-ocr');
    expect(r.text).toContain('Type 2 diabetes mellitus.');
    expect(r.pageSpans).toEqual([]); // no fabricated page number for a single image
  }, 60000);

  it('blank scan and OCR engine failure/timeouts are reported, not hidden', async () => {
    const blank = await extractFile('b.pdf', read('sample-scanned-no-text-layer.pdf'));
    expect(blank.ok).toBe(false);
    expect(blank.errors[0]).toMatch(/even after OCR/);
    const failing: OcrEngine = { recognizeImage: async () => { throw new Error('boom'); }, recognizePdfPage: async () => { throw new Error('worker crashed'); } };
    const r = await extractPdf(read('sample-mixed-text-and-scan-2026-03-22.pdf'), pdfjs as unknown as PdfJsLike, { ocr: failing });
    expect(r.ok).toBe(true); // page 1 text layer survives
    expect(r.warnings.join(' ')).toMatch(/OCR failed or timed out on page\(s\) 2/);
    expect(r.needsAttention).toBe(true);
    const hanging: OcrEngine = { recognizeImage: () => new Promise(() => {}), recognizePdfPage: () => new Promise(() => {}) };
    const t = await extractPdf(read('sample-mixed-text-and-scan-2026-03-22.pdf'), pdfjs as unknown as PdfJsLike, { ocr: hanging, ocrPageTimeoutMs: 300 });
    expect(t.warnings.join(' ')).toMatch(/timed out on page\(s\) 2/);
    expect((await extractImage(read('scanned-discharge-letter-2025-11-20.png'), failing)).errors[0]).toMatch(/OCR failed/);
  }, 60000);

  it('a corrupt PDF still fails safely with OCR enabled', async () => {
    const r = await extractFile('c.pdf', new TextEncoder().encode('%PDF-1.7\n garbage'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/could not be opened/);
    // A valid but empty PDF (0 pages of text) is handled too.
    const empty = await PDFDocument.create();
    empty.addPage();
    const e = await extractFile('e.pdf', await empty.save());
    expect(e.ok).toBe(false);
  }, 60000);
});
