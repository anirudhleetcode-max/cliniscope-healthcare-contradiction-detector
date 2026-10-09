# MEDGUARD — Technology Stack

> **Database update (after this audit):** the optional server now uses **PostgreSQL** instead of SQLite: an external server via `DATABASE_URL` (a free Neon project in the prepared deployment), or embedded PGlite for local use. Original files are stored in the database (`document_files`, schema v3). Where this page says SQLite, `node:sqlite`, `medguard.db` or a files directory, read PostgreSQL / `document_files`; the tables, constraints, roles and append-only triggers are otherwise unchanged. Current sources: [`docs/backend/DATABASE_ARCHITECTURE.md`](../backend/DATABASE_ARCHITECTURE.md) and [`docs/backend/DEPLOYMENT.md`](../backend/DEPLOYMENT.md).

> Audit basis: branch `claude/optimistic-tesla-466st5` at commit `a77a427`. Versions are the exact versions resolved in `package-lock.json`. The range declared in `package.json` is shown in parentheses where it matters.

**Status labels.** These labels are used throughout `docs/technical/`:

| Label | Meaning |
|---|---|
| VERIFIED | Observed working in this audit, or in a recorded CI run for this commit |
| IMPLEMENTED | Code exists and is exercised by automated tests |
| CONFIGURED BUT NOT VERIFIED | Configuration exists, but nothing shows it running in production |
| NOT IMPLEMENTED | Absent from the repository |
| UNKNOWN | Cannot be determined from the repository |

## 1. Master stack table

### 1.1 Frontend (browser application)

| Layer | Technology | Version | Purpose in MEDGUARD | Direct / transitive | Evidence |
|---|---|---|---|---|---|
| Language | TypeScript | 5.6.3 | All application, server and test code (`strict: true`) | Direct (dev) | `tsconfig.json`, `package.json` |
| UI framework | React + React DOM | 18.3.1 | Component UI, rendered with `createRoot` in `StrictMode` | Direct | `src/main.tsx` |
| Routing | react-router-dom (`HashRouter`) | 6.28.0 | Client-side routes under `#/…`, so the app works on a static host under any sub-path | Direct | `src/main.tsx:43-63` |
| Build tool / dev server | Vite + `@vitejs/plugin-react` | 5.4.21 / 4.3.4 | Dev server, production bundle, `base` path from `VITE_BASE_PATH` (default `./`) | Direct (dev) | `vite.config.ts` |
| Styling | Tailwind CSS + PostCSS + Autoprefixer | 3.4.17 / 8.4.49 / 10.4.20 | Utility classes. Colours map to CSS variables in `src/index.css` | Direct (dev) | `tailwind.config.js`, `postcss.config.js`, `src/index.css` |
| Font | `@fontsource-variable/inter` (Inter Variable) | 5.3.0 | Bundled web font, served from the app origin (no Google Fonts) | Direct | `src/index.css:1`, `tailwind.config.js` |
| Icons | lucide-react | 0.460.0 | All UI icons | Direct | e.g. `src/components/shell/AppShell.tsx` |
| Client persistence | Dexie (IndexedDB wrapper) | 4.0.10 | Browser database `medguard` with 6 tables | Direct | `src/lib/db.ts` |
| Reactive queries | dexie-react-hooks (`useLiveQuery`) | 1.1.7 | UI re-renders automatically on every IndexedDB write | Direct | `src/app/state.tsx` |
| PDF text extraction / page rendering | pdfjs-dist (pdf.js) | 4.10.38 | Text layer per page, and page rendering for OCR and original-page preview. Worker self-hosted as `pdf.worker.min.js` | Direct | `src/lib/browserExtract.ts`, `src/pages/DocumentViewer.tsx`, `scripts/copy-pdf-worker.mjs` |
| DOCX text extraction | mammoth | 1.8.0 | `extractRawText` for `.docx` uploads | Direct | `src/lib/extract.ts:361`, `src/lib/browserExtract.ts` |
| OCR | tesseract.js (LSTM, English) | 6.0.1 (core 6.1.2 transitive) | OCR of scanned PDF pages and PNG/JPEG images, in the browser | Direct | `src/lib/browserOcr.ts` |
| OCR language data | `@tesseract.js-data/eng` (`4.0.0_best_int`) | 1.0.0 | English traineddata, copied to `public/ocr/lang` at build time | Direct (dev) | `scripts/copy-pdf-worker.mjs` |
| Schema validation | zod | 4.6.5 | AI output schema, backup-file schema (browser). Request validation (server) | Direct | `src/lib/ai.ts`, `src/lib/exportCase.ts`, `server/app.ts` |
| Charts | Custom SVG/HTML components | n/a | Bar list, donut, stacked bar. No chart library is used | n/a | `src/components/charts.tsx` ("dependency-free charts") |
| Offline | Hand-written service worker | n/a | Caches same-origin GET responses for offline use | n/a | `public/sw.js`, `src/main.tsx:72-85` |
| HTTP client | Browser `fetch` + `AbortController` | n/a | Optional shared-workspace API calls. Axios is **not** used | n/a | `src/lib/remote.ts:48` |

**Not detected in the frontend:** Next.js, Vue, Redux, Zustand, MobX, React Query, Axios, Formik / React Hook Form, Material UI, Chakra, Bootstrap, Chart.js / Recharts / D3, WebSockets, Server-Sent Events, GraphQL, ESLint and Prettier configuration.

State management uses React Context (`AppProvider`, `WorkspaceProvider`) plus Dexie live queries. Forms are plain controlled React inputs.

### 1.2 Backend (optional shared-workspace API server)

| Layer | Technology | Version | Purpose | Direct / transitive | Evidence |
|---|---|---|---|---|---|
| Runtime | Node.js | 22 (CI and Docker: `node:22-slim`). Audit machine: v22.22.0 | Runs the API server | Platform | `Dockerfile`, `.github/workflows/ci-deploy.yml` |
| HTTP server | `node:http` (no framework) | built-in | Hand-written regex router, JSON bodies, CORS, security headers | Built-in | `server/app.ts:1-3, 113-117, 401-440` |
| Database | SQLite via `node:sqlite` (`DatabaseSync`) | built-in (experimental in Node 22) | Users, sessions, cases, members, documents, statements, findings, audit events | Built-in | `server/db.ts` |
| Password hashing / tokens | `node:crypto` (scrypt, SHA-256, randomBytes) | built-in | Password hashes, opaque bearer tokens stored as SHA-256 | Built-in | `server/auth.ts` |
| Validation | zod | 4.6.5 | Request body schemas | Direct | `server/app.ts:84-111` |
| AI SDK | `@anthropic-ai/sdk` | 0.132.1 | `client.beta.messages.parse` with Zod structured output. **Server only**; the browser never imports it | Direct | `server/aiProvider.ts` |
| Dev runner | tsx | 4.23.15 | `npm run server` runs TypeScript directly | Direct (dev) | `package.json` scripts |
| Bundler (server) | esbuild (pulled in through Vite) | transitive | `npm run server:build` produces one self-contained `dist-server/server.mjs` | Transitive | `package.json` `server:build` |

**Not detected in the backend:** Express, Fastify, NestJS, an ORM (Prisma, TypeORM, Sequelize, Drizzle), PostgreSQL, MySQL, MongoDB, Redis, message queues, background job workers, JWT libraries, OAuth / SSO, Python.

### 1.3 Testing and tooling

| Tool | Version | Purpose | Evidence |
|---|---|---|---|
| Vitest | 2.1.8 | Unit and integration tests (`tests/unit/**/*.test.ts`, Node environment) | `vite.config.ts` `test` block |
| fake-indexeddb | 6.0.0 | In-memory IndexedDB for Node-based service tests | `tests/unit/services.test.ts`, `sync.test.ts`, `export.test.ts`, `workspace.test.ts` |
| Playwright (`@playwright/test`) | 1.56.1 | Browser E2E: `desktop` (Desktop Chrome 1440×900) and `mobile` (Pixel 7) projects | `playwright.config.ts` |
| pdf-lib, docx | 1.17.1, 9.0.3 | Generate the synthetic demo PDF/DOCX files (scripts only) | `scripts/generate-demo-documents.mjs`, `scripts/generate-scans.mjs` |
| TypeScript compiler | 5.6.3 | `npm run typecheck` (`tsc --noEmit`), also run before every build | `package.json` |

**Not configured:** ESLint, Prettier, a coverage reporter, Storybook, component tests (React Testing Library), accessibility scanners (axe).

### 1.4 Infrastructure

| Component | Technology | Status | Evidence |
|---|---|---|---|
| CI/CD | GitHub Actions, workflow "CI and deploy" | VERIFIED (run 30 for `a77a427`: all 4 jobs succeeded) | `.github/workflows/ci-deploy.yml` |
| Frontend hosting | GitHub Pages (from the `gh-pages` branch, via `peaceiris/actions-gh-pages@v4`) | VERIFIED by CI (`verify-production` job passed for `a77a427`). Not directly reachable from the audit sandbox | workflow `deploy` and `verify-production` jobs |
| Frontend hosting (second) | Vercel (project `medguard`, via the Vercel GitHub app) | Production deployment of `16ebafa` recorded as `success`; previews on PRs. No Vercel config in the repo; domain and settings UNKNOWN | GitHub Deployments API, PR bot comments |
| API container | Docker (`node:22-slim`, multi-stage) | Image built and health-checked in CI. **Not pushed to any registry, not deployed** | `Dockerfile`, workflow `docker-api` job |
| API hosting | Render Blueprint | CONFIGURED BUT NOT VERIFIED (never run, per README) | `render.yaml` |
| External AI | Anthropic Messages API, default model id `claude-opus-5-5` | Integration tested only against a local fake (`tests/e2e/fake-anthropic.mjs`). **Live calls not verified** | `server/aiProvider.ts`, `server/config.ts` |

## 2. Dependencies installed but not used by the browser bundle

- `@anthropic-ai/sdk` is listed under `dependencies` but is imported only by `server/aiProvider.ts`. It is not part of the static frontend.
- `docx` and `pdf-lib` are dev-only and used only by the demo-document generator scripts.

## 3. Package manager and scripts

- Package manager: **npm** (`package-lock.json`, `lockfileVersion: 3`). CI uses `npm ci`.
- Key scripts (`package.json`): `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `typecheck`, `test`, `test:e2e`, `smoke`, `server`, `server:build`, `server:start`, `demo:generate`. `predev`/`prebuild` run `scripts/copy-pdf-worker.mjs`.
