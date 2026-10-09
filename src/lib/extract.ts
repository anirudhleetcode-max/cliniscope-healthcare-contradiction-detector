// Document text extraction. Pure functions: the PDF and DOCX parsers are
// injected so the same code runs in the browser and in Node-based tests.
import type { ExtractionMethod, FileKind, PageSpan } from './types';

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
}

export class UploadValidationError extends Error {}

const EXT_KIND: Record<string, FileKind> = { pdf: 'pdf', txt: 'txt', docx: 'docx' };
const ALLOWED_MIME: Record<FileKind, string[]> = {
  pdf: ['application/pdf', 'application/x-pdf'],
  txt: ['text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
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
      `Unsupported file type ".${ext}". Supported formats: PDF, TXT and DOCX.`,
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
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; disableFontFace?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
      destroy?: () => Promise<void>;
    }>;
  };
}

const MIN_CHARS_PER_PAGE = 20;

export async function extractPdf(
  bytes: Uint8Array,
  pdfjs: PdfJsLike,
  timeoutMs = 30000,
): Promise<ExtractionResult> {
  const work = async (): Promise<ExtractionResult> => {
    let doc;
    try {
      // Copy: pdf.js may transfer/detach the buffer it is given.
      doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true }).promise;
    } catch {
      return result({
        method: 'pdf-text-layer',
        errors: ['The PDF could not be opened. It may be corrupt, encrypted or not a PDF.'],
      });
    }
    let text = '';
    const spans: PageSpan[] = [];
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
      if (text) text += '\n\n';
      const start = text.length;
      text += pageText;
      spans.push({ page: p, start, end: text.length });
    }
    await doc.destroy?.();
    const warnings: string[] = [];
    if (!text.replace(/\s/g, '').length) {
      return result({
        method: 'pdf-text-layer',
        pageCount: doc.numPages,
        pageSpans: spans,
        needsAttention: true,
        errors: [
          'No selectable text was found. The PDF is probably a scanned image. OCR is not available in this build, so no statements were extracted. Upload a text-based PDF, a TXT/DOCX transcription, or run OCR before uploading.',
        ],
      });
    }
    if (thinPages.length) {
      warnings.push(
        `Page(s) ${thinPages.join(', ')} contain little or no selectable text and may be scanned images. Text on those pages was not extracted (OCR not available).`,
      );
    }
    return result({
      ok: true,
      text,
      method: 'pdf-text-layer',
      pageCount: doc.numPages,
      pageSpans: spans,
      warnings,
      needsAttention: thinPages.length > 0,
    });
  };
  return withTimeout(work(), timeoutMs, () =>
    result({ method: 'pdf-text-layer', errors: [`PDF extraction timed out after ${timeoutMs / 1000}s.`] }),
  );
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
