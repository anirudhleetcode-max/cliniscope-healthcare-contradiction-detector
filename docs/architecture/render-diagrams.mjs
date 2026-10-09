// Renders docs/architecture/*.mmd to SVG + PNG with Mermaid in headless Chromium.
// Requires: npm install --no-save mermaid@11.4.1 (in this folder or a scratch folder next to it), and the repo's Playwright.
// Usage: node docs/architecture/render-diagrams.mjs docs/architecture
// Render every .mmd in a directory to SVG + PNG using local mermaid in headless Chromium.
import { chromium } from 'playwright';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const mermaidJs = readFileSync(process.env.MERMAID_JS ?? new URL('./node_modules/mermaid/dist/mermaid.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
await page.setContent(`<html><body style="margin:0;background:#fff"><div id="c"></div></body></html>`);
await page.addScriptTag({ content: mermaidJs });
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'base',
  fontFamily: 'Arial, Helvetica, sans-serif',
  themeVariables: { primaryColor: '#EAF2FF', primaryBorderColor: '#4C8DFF', primaryTextColor: '#172033', lineColor: '#526176',
    secondaryColor: '#E3F6F3', tertiaryColor: '#F7FAFC', clusterBkg: '#F7FAFC', clusterBorder: '#B8C4D6', fontSize: '16px',
    actorBkg: '#EAF2FF', actorBorder: '#4C8DFF', noteBkgColor: '#FDF1E4', noteBorderColor: '#C9873A' },
  flowchart: { htmlLabels: true, curve: 'basis', padding: 12 }, sequence: { mirrorActors: false } }));
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mmd')).sort()) {
  const src = readFileSync(join(dir, f), 'utf8');
  const { svg: rawSvg } = await page.evaluate(async (s) => window.mermaid.render('g' + Math.random().toString(36).slice(2), s), src);
  // Mermaid serialises HTML labels with void tags (<br>); make the standalone SVG valid XML.
  const svg = rawSvg.replace(/<br\s*>/g, '<br/>').replace(/<img([^>]*[^/])>/g, '<img$1/>')
    // Let the embedding page decide the display width (Mermaid caps it with an inline max-width).
    .replace(/^<svg([^>]*?) style="max-width: ([\d.]+)px;"/, (m, a, w) => `<svg${a} data-natural-width="${w}"`);
  const base = join(dir, f.replace(/\.mmd$/, ''));
  writeFileSync(base + '.svg', svg);
  await page.setContent(`<html><body style="margin:0;background:#fff;display:inline-block;padding:16px">${svg}</body></html>`);
  await page.evaluate(() => { const s = document.querySelector('svg'); s.style.width = (s.dataset.naturalWidth ? s.dataset.naturalWidth + 'px' : null) || s.style.maxWidth || s.getAttribute('width'); s.style.maxWidth = 'none'; });
  const el = await page.$('svg');
  await el.screenshot({ path: base + '.png' });
  await page.setContent(`<html><body><div id="c"></div></body></html>`);
  await page.addScriptTag({ content: mermaidJs });
  await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, theme: 'base', fontFamily: 'Arial, Helvetica, sans-serif',
    themeVariables: { primaryColor: '#EAF2FF', primaryBorderColor: '#4C8DFF', primaryTextColor: '#172033', lineColor: '#526176',
      secondaryColor: '#E3F6F3', tertiaryColor: '#F7FAFC', clusterBkg: '#F7FAFC', clusterBorder: '#B8C4D6', fontSize: '16px',
      actorBkg: '#EAF2FF', actorBorder: '#4C8DFF', noteBkgColor: '#FDF1E4', noteBorderColor: '#C9873A' },
    flowchart: { htmlLabels: true, curve: 'basis', padding: 12 }, sequence: { mirrorActors: false } }));
  console.log('rendered', f);
}
await browser.close();
