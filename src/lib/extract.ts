// Document text extraction. Pure functions: the PDF and DOCX parsers are
// injected so the same code runs in the browser and in Node-based tests.
import type { ExtractionMethod, FileKind, OcrSpan, PageSpan } from './types';

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface ExtractionResult {
  ok: boolean;
  text: string;
  method: ExtractionMethod | null;
  pageCount: number | null;
  pageSpans: PageSpan[];
  errors: string[];
  warnings: string[];
  /** True when the text layer exists but is too thin to be trusted (likely scanned). */
  needsAttention: boolean;
  ocrLowConfidence?: OcrSpan[];
  ocrRegions?: { start: number; end: number; confidence: number | null }[];
}

export class UploadValidationError extends Error {}

const EXT_KIND: Record<string, FileKind> = { pdf: 'pdf', txt: 'txt', docx: 'docx', png: 'image', jpg: 'image', jpeg: 'image' };
const ALLOWED_MIME: Record<FileKind, string[]> = {
  pdf: ['application/pdf', 'application/x-pdf'],
  txt: ['text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  image: ['image/png', 'image/jpeg'],
};

/** Strip path components and unsafe characters from a user-supplied filename. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 160);
  return cleaned || 'document';
}

/**
 * Validates extension, MIME type (when provided), size and emptiness.
 * Also checks file signatures so a renamed binary is not treated as a PDF/DOCX.
 */
export function validateUpload(
  name: string,
  mime: string,
  bytes: Uint8Array,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
): FileKind {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const kind = EXT_KIND[ext];
  if (!kind || !name.includes('.')) {
    throw new UploadValidationError(
      `Unsupported file type ".${ext}". Supported formats: PDF, TXT, DOCX, PNG and JPEG.`,
    );
  }
  if (mime && mime !== 'application/octet-stream' && !ALLOWED_MIME[kind].includes(mime)) {
    throw new UploadValidationError(
      `The file's MIME type (${mime}) does not match its .${ext} extension.`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new UploadValidationError('The file is empty (0 bytes). Choose a file that contains text.');
  }
  if (bytes.byteLength > maxBytes) {
    throw new UploadValidationError(
      `The file is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${(maxBytes / 1048576).toFixed(0)} MB.`,
    );
  }
  if (kind === 'pdf' && !startsWith(bytes, '%PDF-')) {
    throw new UploadValidationError('The file has a .pdf extension but is not a valid PDF (missing %PDF header).');
  }
  if (kind === 'docx' && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new UploadValidationError('The file has a .docx extension but is not a valid DOCX (ZIP) archive.');
  }
  if (kind === 'image') {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpg) throw new UploadValidationError('The file has an image extension but is not a valid PNG or JPEG image.');
  }
  return kind;
}

function startsWith(bytes: Uint8Array, sig: string): boolean {
  // Allow a little leading whitespace/garbage as many PDF readers do.
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  return head.includes(sig);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Normalizes newlines and removes control characters while keeping paragraph breaks. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function result(partial: Partial<ExtractionResult>): ExtractionResult {
  return {
    ok: false,
    text: '',
    method: null,
    pageCount: null,
    pageSpans: [],
    errors: [],
    warnings: [],
    needsAttention: false,
    ...partial,
  };
}

export function extractTxt(bytes: Uint8Array): ExtractionResult {
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return result({
      method: 'plain-text',
      errors: ['The text file is not valid UTF-8. Re-save it as UTF-8 and upload again.'],
    });
  }
  const text = normalizeText(raw);
  if (!text.trim()) {
    return result({
      method: 'plain-text',
      errors: ['The text file contains no readable text.'],
    });
  }
  return result({ ok: true, text, method: 'plain-text' });
}

// Minimal structural typing for the subset of pdf.js we use.
interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
  height?: number;
}
export interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
}
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; disableFontFace?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<PdfPageLike>;
      destroy?: () => Promise<void>;
    }>;
  };
}

// ------------------------------------------------------------------ OCR
export interface OcrWord { text: string; confidence: number }
export interface OcrLine { words: OcrWord[] }
export interface OcrPageResult {
  lines: OcrLine[];
  /** Engine-reported mean confidence (0-100). */
  confidence: number;
}
/** OCR engine abstraction. The browser implementation uses Tesseract.js. */
export interface OcrEngine {
  recognizePdfPage(page: PdfPageLike, pageNumber: number): Promise<OcrPageResult>;
  recognizeImage(bytes: Uint8Array): Promise<OcrPageResult>;
}
export type ProgressFn = (stage: string) => void;

/** Words below this engine-reported confidence are marked "OCR text requires review". */
export const OCR_LOW_CONFIDENCE = 70;
/** Pages whose mean OCR confidence is below this produce a document-level warning. */
export const OCR_PAGE_WARN_CONFIDENCE = 75;

/** Builds plain text from OCR lines while recording each word's exact character span. */
export function ocrToText(r: OcrPageResult, base = 0): { text: string; words: OcrSpan[] } {
  let text = '';
  const words: OcrSpan[] = [];
  for (const line of r.lines) {
    const ws = line.words.filter((w) => w.text.trim());
    if (!ws.length) continue;
    if (text) text += '\n';
    ws.forEach((w, i) => {
      if (i) text += ' ';
      const clean = w.text.replace(/[\u0000-\u001f]/g, '');
      words.push({ start: base + text.length, end: base + text.length + clean.length, confidence: w.confidence, text: clean });
      text += clean;
    });
  }
  return { text, words };
}

const MIN_CHARS_PER_PAGE = 20;

interface PageOut { text: string; method: 'text-layer' | 'ocr'; confidence: number | null; words: OcrSpan[] }

export async function extractPdf(
  bytes: Uint8Array,
  pdfjs: PdfJsLike,
  timeoutOrOpts: number | { timeoutMs?: number; ocr?: OcrEngine; onProgress?: ProgressFn; ocrPageTimeoutMs?: number } = 30000,
): Promise<ExtractionResult> {
  const opts = typeof timeoutOrOpts === 'number' ? { timeoutMs: timeoutOrOpts } : timeoutOrOpts;
  const ocr = opts.ocr;
  const timeoutMs = opts.timeoutMs ?? (ocr ? 180000 : 30000);
  const progress = opts.onProgress ?? (() => {});
  const work = async (): Promise<ExtractionResult> => {
    let doc;
    try {
      progress('Extracting text layer');
      // Copy: pdf.js may transfer/detach the buffer it is given.
      doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true }).promise;
    } catch {
      return result({
        method: 'pdf-text-layer',
        errors: ['The PDF could not be opened. It may be corrupt, encrypted or not a PDF.'],
      });
    }
    const pages: PageOut[] = [];
    const thinPages: number[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let pageText = '';
      let lastY: number | null = null;
      let lastHeight = 10;
      for (const raw of content.items) {
        const item = raw as PdfTextItem;
        if (typeof item.str !== 'string') continue;
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 1) {
          const gap = Math.abs(y - lastY);
          if (!pageText.endsWith('\n')) pageText += '\n';
          if (gap > lastHeight * 2.2 && !pageText.endsWith('\n\n')) pageText += '\n';
        }
        pageText += item.str;
        if (item.hasEOL && !pageText.endsWith('\n')) pageText += '\n';
        if (y !== null) lastY = y;
        if (item.height) lastHeight = item.height;
      }
      pageText = normalizeText(pageText).trim();
      if (pageText.replace(/\s/g, '').length < MIN_CHARS_PER_PAGE) thinPages.push(p);
      pages.push({ text: pageText, method: 'text-layer', confidence: null, words: [] });
    }

    const warnings: string[] = [];
    const ocrFailed: number[] = [];
    const ocrEmpty: number[] = [];
    if (thinPages.length && ocr) {
      // OCR pages one at a time so only one rendered page is in memory.
      for (const [i, p] of thinPages.entries()) {
        progress(`Running OCR on page ${p} (${i + 1} of ${thinPages.length} scanned page${thinPages.length > 1 ? 's' : ''})`);
        try {
          const page = await doc.getPage(p);
          const r = await withTimeout(ocr.recognizePdfPage(page, p), opts.ocrPageTimeoutMs ?? 90000, () => null);
          if (!r) { ocrFailed.push(p); continue; }
          const built = ocrToText(r);
          if (built.text.replace(/\s/g, '').length < MIN_CHARS_PER_PAGE) { ocrEmpty.push(p); continue; }
          pages[p - 1] = { text: built.text, method: 'ocr', confidence: Math.round(r.confidence), words: built.words };
          if (r.confidence < OCR_PAGE_WARN_CONFIDENCE) warnings.push(`OCR confidence on page ${p} is low (${Math.round(r.confidence)}%). Verify the extracted text against the original page.`);
        } catch {
          ocrFailed.push(p);
        }
      }
    }
    await doc.destroy?.();

    // Assemble the document text with verified page spans.
    let text = '';
    const spans: PageSpan[] = [];
    const lowConf: OcrSpan[] = [];
    const regions: { start: number; end: number; confidence: number | null }[] = [];
    pages.forEach((pg, idx) => {
      if (text) text += '\n\n';
      const start = text.length;
      text += pg.text;
      spans.push({ page: idx + 1, start, end: text.length, method: pg.method, ocrConfidence: pg.confidence });
      if (pg.method === 'ocr') {
        regions.push({ start, end: text.length, confidence: pg.confidence });
        for (const w of pg.words) if (w.confidence < OCR_LOW_CONFIDENCE) lowConf.push({ ...w, start: w.start + start, end: w.end + start });
      }
    });
    const ocrPages = pages.map((p, i) => (p.method === 'ocr' ? i + 1 : 0)).filter(Boolean);
    const unread = thinPages.filter((p) => !ocrPages.includes(p));
    const method: ExtractionMethod = ocrPages.length === 0 ? 'pdf-text-layer' : ocrPages.length === pages.length ? 'pdf-ocr' : 'pdf-text-layer+ocr';
    if (ocrPages.length) warnings.unshift(`Page(s) ${ocrPages.join(', ')} were read with OCR. OCR text can contain character, decimal-point and unit errors and requires review against the original.`);
    if (lowConf.length) warnings.push(`${lowConf.length} OCR word(s) fell below ${OCR_LOW_CONFIDENCE}% confidence and are marked for review.`);
    if (ocrFailed.length) warnings.push(`OCR failed or timed out on page(s) ${ocrFailed.join(', ')}; their text is missing.`);
    if (ocrEmpty.length) warnings.push(`OCR found no readable text on page(s) ${ocrEmpty.join(', ')}.`);

    if (!text.replace(/\s/g, '').length) {
      return result({
        method: ocr ? 'pdf-ocr' : 'pdf-text-layer',
        pageCount: pages.length,
        pageSpans: spans,
        needsAttention: true,
        errors: [
          ocr
            ? 'No readable text was found, even after OCR. The scan may be blank, too faint or handwritten. Upload a clearer scan or a typed transcription.'
            : 'No selectable text was found. The PDF is probably a scanned image and OCR is not available here, so no statements were extracted.',
        ],
        warnings,
      });
    }
    if (unread.length && !ocr) {
      warnings.push(`Page(s) ${unread.join(', ')} contain little or no selectable text and may be scanned images. OCR was not run, so their text was not extracted.`);
    }
    return result({
      ok: true,
      text,
      method,
      pageCount: pages.length,
      pageSpans: spans,
      warnings,
      needsAttention: unread.length > 0 || lowConf.length > 0 || ocrFailed.length > 0,
      ocrLowConfidence: lowConf,
      ocrRegions: regions,
    });
  };
  return withTimeout(work(), timeoutMs, () =>
    result({ method: 'pdf-text-layer', errors: [`PDF extraction timed out after ${timeoutMs / 1000}s.`] }),
  );
}

/** OCR of a PNG/JPEG image. */
export async function extractImage(bytes: Uint8Array, ocr: OcrEngine | undefined, onProgress?: ProgressFn, timeoutMs = 90000): Promise<ExtractionResult> {
  if (!ocr) return result({ method: 'image-ocr', errors: ['OCR is not available in this environment, so images cannot be read.'] });
  onProgress?.('Running OCR on image');
  let r: OcrPageResult | null;
  try {
    r = await withTimeout(ocr.recognizeImage(bytes), timeoutMs, () => null);
  } catch {
    r = null;
  }
  if (!r) return result({ method: 'image-ocr', errors: ['OCR failed or timed out on this image.'] });
  const built = ocrToText(r);
  if (built.text.replace(/\s/g, '').length < MIN_CHARS_PER_PAGE) {
    return result({ method: 'image-ocr', needsAttention: true, errors: ['OCR found no readable text in this image.'] });
  }
  const low = built.words.filter((w) => w.confidence < OCR_LOW_CONFIDENCE);
  const warnings = ['This text was read with OCR. It can contain character, decimal-point and unit errors and requires review against the original image.'];
  if (r.confidence < OCR_PAGE_WARN_CONFIDENCE) warnings.push(`OCR confidence is low (${Math.round(r.confidence)}%).`);
  if (low.length) warnings.push(`${low.length} OCR word(s) fell below ${OCR_LOW_CONFIDENCE}% confidence and are marked for review.`);
  return result({
    ok: true, text: built.text, method: 'image-ocr', warnings, needsAttention: low.length > 0,
    ocrLowConfidence: low, ocrRegions: [{ start: 0, end: built.text.length, confidence: Math.round(r.confidence) }],
  });
}

export interface MammothLike {
  extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: { message: string }[] }>;
}

export async function extractDocx(bytes: Uint8Array, mammoth: MammothLike): Promise<ExtractionResult> {
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const out = await mammoth.extractRawText({ arrayBuffer: buf });
    const text = normalizeText(out.value).trim();
    if (!text) {
      return result({ method: 'docx-raw-text', errors: ['The DOCX file contains no readable text.'] });
    }
    return result({
      ok: true,
      text,
      method: 'docx-raw-text',
      warnings: out.messages.slice(0, 3).map((m) => `DOCX parser: ${m.message}`),
    });
  } catch {
    return result({
      method: 'docx-raw-text',
      errors: ['The DOCX file could not be read. It may be corrupt or password-protected.'],
    });
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the 1-based PDF page that contains a character offset, or null if not verifiable. */
export function pageForOffset(spans: PageSpan[], offset: number): number | null {
  for (const s of spans) if (offset >= s.start && offset <= s.end) return s.page;
  return null;
}

/** 1-based line number of an offset in the extracted text. */
export function lineForOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** 1-based paragraph index (blocks separated by blank lines). */
export function paragraphForOffset(text: string, offset: number): number {
  const before = text.slice(0, offset);
  const m = before.match(/\n\s*\n/g);
  return (m ? m.length : 0) + 1;
}
