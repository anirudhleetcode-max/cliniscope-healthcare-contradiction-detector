import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractTxt, sanitizeFilename, validateUpload, UploadValidationError } from '../../src/lib/extract';
import { demoPath, extractFile } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);

describe('upload validation', () => {
  it('TEST 16: rejects unsupported file types', () => {
    expect(() => validateUpload('scan.png', 'image/png', enc('x'))).toThrow(UploadValidationError);
    expect(() => validateUpload('macro.exe', '', enc('x'))).toThrow(/Unsupported/);
    expect(() => validateUpload('noextension', '', enc('x'))).toThrow(/Unsupported/);
  });
  it('TEST 17: rejects empty files', () => {
    expect(() => validateUpload('empty.txt', 'text/plain', new Uint8Array())).toThrow(/empty/);
    const r = extractTxt(enc('   \n\n  '));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/no readable text/);
  });
  it('rejects oversized files, mismatched MIME types and fake PDFs', () => {
    expect(() => validateUpload('big.txt', 'text/plain', new Uint8Array(11 * 1024 * 1024))).toThrow(/limit/);
    expect(() => validateUpload('a.txt', 'application/pdf', enc('hello'))).toThrow(/MIME/);
    expect(() => validateUpload('fake.pdf', 'application/pdf', enc('not a pdf'))).toThrow(/not a valid PDF/);
  });
  it('sanitizes malicious filenames', () => {
    expect(sanitizeFilename('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFilename('..\\..\\evil<script>.txt')).toBe('evilscript.txt');
  });
});

describe('text extraction', () => {
  it('TEST 14 (extraction part): TXT preserves paragraphs and normalizes newlines', () => {
    const r = extractTxt(enc('﻿Line one\r\nLine two\r\n\r\n\r\n\r\nPara two'));
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Line one\nLine two\n\nPara two');
  });
  it('TEST 15 (extraction part): extracts a readable PDF with verified page spans', async () => {
    const r = await extractFile('d.pdf', new Uint8Array(readFileSync(demoPath('discharge-summary-2026-03-12.pdf'))));
    expect(r.ok).toBe(true);
    expect(r.method).toBe('pdf-text-layer');
    expect(r.pageCount).toBe(2);
    expect(r.pageSpans).toHaveLength(2);
    const p2 = r.text.slice(r.pageSpans[1].start, r.pageSpans[1].end);
    expect(p2).toContain('Penicillin allergy documented.');
  });
  it('reports a scanned PDF (no text layer) as needing attention instead of pretending OCR ran', async () => {
    const r = await extractFile('s.pdf', new Uint8Array(readFileSync(demoPath('sample-scanned-no-text-layer.pdf'))), { ocr: false });
    expect(r.ok).toBe(false);
    expect(r.needsAttention).toBe(true);
    expect(r.errors[0]).toMatch(/OCR is not available/);
  });
  it('reports a corrupt PDF as a failure', async () => {
    const bytes = enc('%PDF-1.7\n garbage garbage');
    const r = await extractFile('c.pdf', bytes);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/could not be opened/);
  });
  it('extracts DOCX paragraphs', async () => {
    const r = await extractFile('i.docx', new Uint8Array(readFileSync(demoPath('patient-intake-form-2026-03-15.docx'))));
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Allergies: No known drug allergies.');
  });
  it('extracts a freshly generated PDF', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('Metformin 850 mg twice daily.', { x: 50, y: 700, size: 12, font });
    const r = await extractFile('g.pdf', await pdf.save());
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Metformin 850 mg twice daily.');
  });
});
