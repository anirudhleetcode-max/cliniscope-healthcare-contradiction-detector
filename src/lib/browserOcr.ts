// Browser OCR engine (Tesseract.js, LSTM, English). All assets are served from
// this app's own origin (public/ocr/, copied at build time). Pages are rendered
// one at a time and their canvases are released immediately after recognition.
import type { OcrEngine, OcrPageResult, PdfPageLike } from './extract';

type TesseractWorker = {
  recognize(image: unknown, opts?: object, output?: object): Promise<{ data: { confidence: number; blocks: { paragraphs: { lines: { words: { text: string; confidence: number }[] }[] }[] }[] | null } }>;
  terminate(): Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      return createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: assetUrl('./ocr/worker.min.js'),
        corePath: assetUrl('./ocr/'),
        langPath: assetUrl('./ocr/lang'),
        gzip: true,
        workerBlobURL: false,
        cacheMethod: 'none',
      }) as unknown as Promise<TesseractWorker>;
    })();
    // A failed initialisation must not poison later attempts.
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

function toResult(data: Awaited<ReturnType<TesseractWorker['recognize']>>['data']): OcrPageResult {
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => ({
    words: l.words.map((w) => ({ text: w.text, confidence: w.confidence })),
  }))));
  return { lines, confidence: data.confidence };
}

async function recognize(image: unknown): Promise<OcrPageResult> {
  const w = await getWorker();
  const r = await w.recognize(image, {}, { blocks: true, text: false });
  return toResult(r.data);
}

interface RenderablePage extends PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}

export const browserOcr: OcrEngine = {
  async recognizePdfPage(page) {
    const p = page as RenderablePage;
    const base = p.getViewport({ scale: 1 });
    // ~200 DPI for an A4 page, capped to keep memory bounded.
    const scale = Math.min(2.8, 2400 / Math.max(base.width, base.height));
    const viewport = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: ctx, viewport }).promise;
      return await recognize(canvas);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  },
  async recognizeImage(bytes) {
    const type = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
    return recognize(new Blob([bytes], { type }));
  },
};
