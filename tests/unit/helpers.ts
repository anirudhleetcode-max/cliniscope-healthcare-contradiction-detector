import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { extractDocx, extractPdf, extractTxt, type ExtractionResult, type PdfJsLike } from '../../src/lib/extract';
import { extractStatements } from '../../src/lib/statements';
import type { DocumentRecord, DocumentType, FileKind } from '../../src/lib/types';

// Node's mammoth build reads a Buffer; the browser build reads an ArrayBuffer.
export const nodeMammoth = {
  extractRawText: ({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) => mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) }),
};

export const demoPath = (f: string) => new URL(`../../public/demo/${f}`, import.meta.url);

export async function extractFile(name: string, bytes: Uint8Array): Promise<ExtractionResult> {
  if (name.endsWith('.pdf')) return extractPdf(bytes, pdfjs as unknown as PdfJsLike);
  if (name.endsWith('.docx')) return extractDocx(bytes, nodeMammoth);
  return extractTxt(bytes);
}

let n = 0;
export function makeDoc(caseId: string, text: string, opts: Partial<DocumentRecord> = {}): DocumentRecord {
  n++;
  return {
    id: opts.id ?? `doc_${n}`,
    caseId,
    originalFilename: `doc${n}.txt`,
    title: opts.title ?? `Document ${n}`,
    documentType: (opts.documentType ?? 'other') as DocumentType,
    documentDate: opts.documentDate === undefined ? '2026-03-1' + (n % 10) : opts.documentDate,
    uploadedAt: new Date().toISOString(),
    status: 'extracted',
    fileKind: (opts.fileKind ?? 'txt') as FileKind,
    mimeType: 'text/plain',
    sizeBytes: text.length,
    extractionMethod: 'plain-text',
    extractedText: text,
    pageCount: null,
    pageSpans: opts.pageSpans ?? [],
    extractionErrors: [],
    extractionWarnings: [],
    contentHash: `h${n}`,
    statementCount: 0,
    isSeededDemo: false,
    ...opts,
  };
}

export async function loadDemoDocs(caseId = 'case_demo') {
  const { DEMO_MANIFEST } = await import('../../scripts/demo-content.mjs');
  const docs: DocumentRecord[] = [];
  for (const m of DEMO_MANIFEST) {
    const bytes = new Uint8Array(readFileSync(demoPath(m.file)));
    const r = await extractFile(m.file, bytes);
    if (!r.ok) throw new Error(`extract failed ${m.file}: ${r.errors.join()}`);
    docs.push(makeDoc(caseId, r.text, {
      id: `demo_${m.documentType}`,
      title: m.title,
      documentType: m.documentType,
      documentDate: m.documentDate,
      fileKind: m.file.split('.').pop() as FileKind,
      extractionMethod: r.method,
      pageSpans: r.pageSpans,
      pageCount: r.pageCount,
    }));
  }
  const statements = docs.flatMap((d) => extractStatements(d));
  return { docs, statements };
}
