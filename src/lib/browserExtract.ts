// Browser extractor: lazily loads pdf.js and mammoth so the initial bundle stays small.
import { extractDocx, extractPdf, extractTxt, type MammothLike, type PdfJsLike } from './extract';
import type { Extractor } from './services';

let pdfjsPromise: Promise<PdfJsLike> | null = null;
function loadPdfJs(): Promise<PdfJsLike> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      return pdfjs as unknown as PdfJsLike;
    })();
  }
  return pdfjsPromise;
}

async function loadMammoth(): Promise<MammothLike> {
  const m = await import('mammoth');
  return ((m as unknown as { default?: MammothLike }).default ?? m) as MammothLike;
}

export const browserExtractor: Extractor = async (kind, bytes) => {
  if (kind === 'txt') return extractTxt(bytes);
  if (kind === 'pdf') return extractPdf(bytes, await loadPdfJs());
  return extractDocx(bytes, await loadMammoth());
};
