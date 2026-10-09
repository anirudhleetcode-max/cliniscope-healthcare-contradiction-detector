// Real OCR for Node-based tests: extracts the scanned image embedded in a PDF
// page via pdf.js, encodes it as PNG and runs Tesseract.js on it. No mocking.
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createWorker, type Worker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { OcrEngine, OcrPageResult, PdfPageLike } from '../../src/lib/extract';

const LANG = new URL('../../node_modules/@tesseract.js-data/eng/4.0.0_best_int', import.meta.url).pathname;
let workerP: Promise<Worker> | null = null;
const cache = new Map<string, OcrPageResult>();

function worker(): Promise<Worker> {
  workerP ??= createWorker('eng', 1, { langPath: LANG, gzip: true, cachePath: '/tmp/medguard-tess-cache' });
  return workerP;
}

export async function terminateOcr(): Promise<void> {
  if (workerP) (await workerP).terminate();
  workerP = null;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Minimal PNG encoder for RGB/RGBA/grey raw pixels. */
export function encodePng(width: number, height: number, data: Uint8Array | Uint8ClampedArray, channels: 1 | 3 | 4): Buffer {
  const colorType = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType;
  const row = width * channels;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * row, row).copy(raw, y * (row + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function recognize(bytes: Uint8Array): Promise<OcrPageResult> {
  const key = createHash('sha1').update(bytes).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const w = await worker();
  const r = await w.recognize(Buffer.from(bytes), {}, { blocks: true, text: true });
  const lines = (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => ({ words: l.words.map((wd) => ({ text: wd.text, confidence: wd.confidence })) }))));
  const out = { lines, confidence: r.data.confidence };
  cache.set(key, out);
  return out;
}

export const nodeOcr: OcrEngine = {
  recognizeImage: recognize,
  async recognizePdfPage(page: PdfPageLike): Promise<OcrPageResult> {
    const p = page as unknown as { getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>; objs: { get(n: string, cb: (o: any) => void): void } };
    const ops = await p.getOperatorList();
    const idx = ops.fnArray.findIndex((f) => f === pdfjs.OPS.paintImageXObject);
    if (idx < 0) return { lines: [], confidence: 0 };
    const name = ops.argsArray[idx][0] as string;
    const img: any = await new Promise((res) => p.objs.get(name, res));
    const channels = img.kind === 3 ? 4 : img.kind === 2 ? 3 : 1;
    return recognize(encodePng(img.width, img.height, img.data, channels as 1 | 3 | 4));
  },
};
