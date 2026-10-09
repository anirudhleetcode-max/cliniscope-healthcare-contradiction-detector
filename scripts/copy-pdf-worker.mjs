// Copies runtime assets into public/ so every static host can serve them from
// the app's own origin (no third-party CDN at runtime):
//  - pdf.js worker as .js (.mjs is often served with a wrong MIME type)
//  - Tesseract.js worker, WASM core (LSTM builds) and English language data
import { copyFileSync, mkdirSync } from 'node:fs';
const nm = (p) => new URL(`../node_modules/${p}`, import.meta.url);
const pub = (p) => new URL(`../public/${p}`, import.meta.url);
mkdirSync(pub('ocr/lang/'), { recursive: true });
copyFileSync(nm('pdfjs-dist/build/pdf.worker.min.mjs'), pub('pdf.worker.min.js'));
copyFileSync(nm('tesseract.js/dist/worker.min.js'), pub('ocr/worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) copyFileSync(nm(`tesseract.js-core/${f}`), pub(`ocr/${f}`));
copyFileSync(nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), pub('ocr/lang/eng.traineddata.gz'));
