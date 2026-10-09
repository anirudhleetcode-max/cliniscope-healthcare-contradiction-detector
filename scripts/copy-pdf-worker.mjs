// Copies the pdf.js worker into public/ with a .js extension so every static
// host serves it with a JavaScript MIME type (.mjs is often misconfigured).
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
copyFileSync(new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), new URL('../public/pdf.worker.min.js', import.meta.url));
