// Browser extractor: lazily loads pdf.js and mammoth so the initial bundle stays small.
import { extractDocx, extractImage, extractPdf, extractTxt, type MammothLike, type PdfJsLike } from './extract';
import { browserOcr } from './browserOcr';
import type { Extractor } from './services';

let pdfjsPromise: Promise<PdfJsLike> | null = null;
function loadPdfJs(): Promise<PdfJsLike> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Copied to public/ at build time (scripts/copy-pdf-worker.mjs) as a .js file.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', document.baseURI).href;
      return pdfjs as unknown as PdfJsLike;
    })();
  }
  return pdfjsPromise;
}

async function loadMammoth(): Promise<MammothLike> {
  const m = await import('mammoth');
  return ((m as unknown as { default?: MammothLike }).default ?? m) as MammothLike;
}

export const browserExtractor: Extractor = async (kind, bytes, onProgress) => {
  if (kind === 'txt') return extractTxt(bytes);
  if (kind === 'pdf') return extractPdf(bytes, await loadPdfJs(), { ocr: browserOcr, onProgress });
  if (kind === 'image') return extractImage(bytes, browserOcr, onProgress);
  return extractDocx(bytes, await loadMammoth());
};
