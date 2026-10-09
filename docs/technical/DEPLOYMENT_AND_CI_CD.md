# MEDGUARD — Deployment and CI/CD

> Evidence: `.github/workflows/ci-deploy.yml`, `vite.config.ts`, `Dockerfile`, `.dockerignore`, `render.yaml`, `.env.example`, `package.json` scripts. Run status is taken from the GitHub Actions API for this repository, as read on 2026-10-09.

## 1. Deployment summary

| Component | Hosting / runtime | Build command | Start command | Configuration | Status |
|---|---|---|---|---|---|
| Frontend (static SPA) | **GitHub Pages**, served from the `gh-pages` branch | `npm ci && npm run build` (= `copy-pdf-worker` → `tsc --noEmit` → `vite build`) → `dist/` | none (static files) | `vite.config.ts` `base: process.env.VITE_BASE_PATH \|\| './'`; `HashRouter`; `dist/.nojekyll` | **VERIFIED via CI:** run #30 (`a77a427`) deployed `gh-pages` commit `d89580f`; "pages build and deployment" #16 succeeded; `verify-production` passed. Direct access from the audit sandbox was blocked by its egress proxy, so the live site was **not opened by the auditor** |
| API server (optional) | Docker container (`node:22-slim`) | `docker build -t medguard-api .` (inside: `npm ci --ignore-scripts` → `npm run server:build`, esbuild bundle) | `node server.mjs` (container CMD). Locally: `npm run server` or `npm run server:start` | `Dockerfile` (non-root `node` user, `VOLUME /data`, `EXPOSE 8787`, `HEALTHCHECK` on `/api/health`) | **Built and health-checked in CI** (`docker-api` job succeeded on `a77a427`). **Not published to any registry. Not deployed** |
| API on Render | Render web service `medguard-api` (Docker runtime, `starter` plan, 1 GB disk at `/data`, `healthCheckPath: /api/health`) | Render builds the Dockerfile | Container CMD | `render.yaml` | **CONFIGURED BUT NOT VERIFIED.** The README states the blueprint has never been run. No Render URL appears anywhere in the repo |
| Database (optional) | SQLite file inside the API container volume (`/data/medguard.db`) | n/a | Created and migrated on server start | `MEDGUARD_DATA_DIR` | Exists only where the API runs. **No managed or external database** |
| External AI (optional) | Anthropic Messages API | n/a | n/a | `ANTHROPIC_API_KEY`, `MEDGUARD_AI_MODEL` (default `claude-opus-5-5`) | **Not configured in any deployment. Live calls never verified.** CI tests use a local fake (`tests/e2e/fake-anthropic.mjs`) and a dummy key `sk-fixture-not-real` |

**Live URL:** `https://<owner>.github.io/<repository>/` (the GitHub Pages pattern used by the workflow; the repository keeps its original name).

**Vercel (configured outside the repository).** The Vercel GitHub app is connected to this repository: a Vercel project named `medguard` posts preview deployments (status "Ready") on pull requests, including this one. GitHub deployment records also show a **Production** deployment of `16ebafa` created by `vercel[bot]` with status `success`, so Vercel deploys the default branch to production. The production domain is configured in Vercel (Project → Settings → Domains), not in the code, and is **UNKNOWN** here. The repository contains no `vercel.json` or other Vercel configuration, so Vercel's build settings are **UNKNOWN** from the code. The auditor did not open the preview or the production deployment (the audit sandbox cannot reach `vercel.app`). Because the app uses relative asset paths and hash routing, it is expected to work at a Vercel root URL as well. **This is an inference; it has not been verified.**

The URL is built in the workflow as `https://<owner>.github.io/<repo>/`. It keeps the original repository name: the repository has **not** been renamed. Internal identifiers were renamed to `medguard` in `16ebafa` (see §4); only the repository name, and therefore this URL, keeps the original name.

## 2. Base path and asset paths (GitHub Pages sub-path)

- `vite.config.ts` uses `base: './'`, so the built `dist/index.html` references `./assets/…`, `./favicon.svg` (verified in this audit's build output).
- Routes are hash-based (`#/cases/…`), so the server never needs SPA rewrites and deep links work under `/cliniscope-healthcare-contradiction-detector/`.
- The pdf.js worker, OCR worker, WASM and traineddata resolve with `new URL('./…', document.baseURI)` (`browserExtract.ts`, `browserOcr.ts`). Demo files use `fetch('./demo/…')`. The service worker registers as `./sw.js`.
- Result: the same build works at `/`, at `/<repo>/`, or from `vite preview`. The production e2e run against the live sub-path URL (`verify-production`) passed.

## 3. CI/CD pipeline (`.github/workflows/ci-deploy.yml`, workflow "CI and deploy")

**Triggers:** `push` to any branch, `pull_request`, `workflow_dispatch`.
**Permissions:** `contents: write`, `pages: write`, `id-token: write`.
**Concurrency:** one run per ref; a newer run cancels the older one.

| Order | Job | Steps actually implemented | Runs when |
|---|---|---|---|
| 1 | `test` | checkout → Node 22 (npm cache) → `npm ci` → `npm run typecheck` → `npm test` (Vitest) → `npm run build` → `npx playwright install --with-deps chromium` → `npx playwright test` (desktop + mobile projects; also starts a real API server on 8787, a fake Anthropic API on 8788 and an AI-configured API server on 8789) → upload `dist` artifact (7 days) | Every trigger |
| 1 (parallel) | `docker-api` | `docker build -t medguard-api .` → run the container with `MEDGUARD_ALLOWED_ORIGINS` → poll `curl -sf /api/health` up to 30 × 2 s | Every trigger |
| 2 | `deploy` (needs `test`) | download `dist` → `touch dist/.nojekyll` → `peaceiris/actions-gh-pages@v4` (`publish_branch: gh-pages`, `force_orphan: true`) | Not on pull requests, and only for the **default branch** or `main` |
| 3 | `verify-production` (needs `deploy`) | Query or enable the Pages API (`gh api …/pages`) → poll the live URL until the HTML contains `MEDGUARD` (30 × 10 s), otherwise emit a warning → `npm ci` → install Chromium → `BASE_URL=<live URL> npx playwright test --project=desktop --project=mobile` | After `deploy` |

In the production run, the shared-workspace and AI e2e specs **skip themselves**: `test.skip(!API, …)` when `BASE_URL` is set and no `API_URL` is given. So production verification covers the static app only.

### 3.1 The developer-to-production flow (as implemented)

1. A developer changes code and pushes any branch (or opens a PR).
2. `test` and `docker-api` run in parallel.
3. Inside `test`: the type check, 88 unit tests, the production build and 24 Playwright tests run.
4. The frontend `dist/` is built once in `test` and passed on as an artifact.
5. On the default branch only, `deploy` publishes `dist/` to `gh-pages`. GitHub's own "pages build and deployment" workflow then serves it.
6. The backend is **not** deployed by any workflow.
7. Health checks: the container's `/api/health` is checked in `docker-api` (CI only). The live frontend is checked by HTML polling.
8. Browser tests run against the deployed site in `verify-production`.

There is no staging environment, no release tagging, no manual approval gate, no rollback automation, no secret scanning or SAST step, and no dependency audit step.

### 3.2 Recent run evidence

| Run | Commit | Jobs | Conclusion |
|---|---|---|---|
| CI and deploy #30 | `a77a427` "Rename MEDGAURD to MEDGUARD" | test ✓, docker-api ✓, deploy ✓, verify-production ✓ | success |
| pages build and deployment #16 | `gh-pages` `d89580f` ("deploy: a77a427…") | n/a | success |
| CI and deploy #29 | `fd824f0` | n/a | success |
| CI and deploy #27 | `4d5a0b1` (a WIP redesign commit) | n/a | failure (e2e specs not yet updated, per its commit message) |

The default branch of the repository is `claude/fervent-euler-bsgy2t` (VERIFIED via the GitHub repository metadata). Pushes to other branches (including the documentation branch for this audit) run `test` and `docker-api` but do not deploy.

## 4. Environment variables (names only; never commit values)

From `.env.example`, `server/config.ts`, `vite.config.ts`, `playwright.config.ts`, `tests/e2e/*.spec.ts`.

| Name | Scope | Default | Purpose |
|---|---|---|---|
| `VITE_BASE_PATH` | Frontend build (public) | `./` | Vite `base` |
| `VITE_MAX_UPLOAD_MB` | Frontend build (public) | `10` | Upload limit shown and enforced in the browser |
| `VITE_API_BASE_URL` | Frontend build (public) | empty | Pre-filled shared-workspace URL |
| `PORT`, `HOST` | Server | `8787`, `0.0.0.0` | Listen address |
| `MEDGUARD_DATA_DIR` | Server | `./data` (`/data` in Docker) | SQLite file and private files |
| `MEDGUARD_ALLOWED_ORIGINS` | Server | `http://localhost:5173,http://localhost:4173` | CORS allow-list (exact match) |
| `MEDGUARD_ALLOW_REGISTRATION` | Server | `false` | Self-service sign-up |
| `MEDGUARD_SESSION_TTL_HOURS` | Server | `8` | Session lifetime |
| `MEDGUARD_MAX_UPLOAD_MB` | Server | `10` | File upload limit |
| `MEDGUARD_NEW_USER_PASSWORD` | Server CLI | none | Password for `create-user` |
| `ANTHROPIC_API_KEY` | Server, **secret** | empty → AI disabled | Provider key, read only in `server/config.ts` |
| `MEDGUARD_AI_MODEL` | Server | `claude-opus-5-5` | Model id |
| `MEDGUARD_AI_TIMEOUT_MS` | Server | `120000` | SDK timeout |
| `MEDGUARD_AI_FALLBACKS` | Server | `true` | Server-side fallback beta flag |
| `MEDGUARD_ANTHROPIC_BASE_URL` | Server (testing) | `https://api.anthropic.com` | Point the SDK at a local fake |
| `BASE_URL`, `API_URL`, `CHROMIUM_PATH` | Tests | none | Run e2e against a deployed URL or API; custom Chromium |
| `SITE_URL`, `GH_TOKEN` | CI only | from GitHub context / `secrets.GITHUB_TOKEN` | Production verification |

Since commit `16ebafa` (on the base branch, merged into this branch), all internal identifiers use the MEDGUARD name: the `MEDGUARD_*` server variables, `medguard-api`, `medguard-data`, `medguard.db`, the IndexedDB name `medguard`, the `medguard.*` storage keys, the `medguard-v1` offline cache and the `medguard-backup` / `medguard-case-report` formats. **Compatibility consequences (per that commit; not separately tested here):** browser data stored under the old IndexedDB name `cliniscope` is not migrated (the demo workspace reseeds), servers configured with the old `CLINISCOPE_*` variables must be reconfigured, and backups exported in the old `cliniscope-backup` format no longer pass the restore schema (`z.literal('medguard-backup')` in `src/lib/exportCase.ts`). Only the repository name, and therefore the Pages URL, still contains `cliniscope`.

No secrets are stored in the repository. `.env`, `.env.*`, `*.pem` and `*.key` are git-ignored. `render.yaml` marks `ANTHROPIC_API_KEY` as `sync: false`, so it must be entered in the Render dashboard.

## 5. Running locally

```bash
npm ci
npm run dev                         # http://localhost:5173 (local demo mode)
npm run build && npm run preview    # http://localhost:4173 (production build, service worker active)
npm test                            # Vitest unit/integration
npx playwright test                 # builds, starts preview + API servers + fake AI, runs 24 tests
# optional API
MEDGUARD_ALLOW_REGISTRATION=true MEDGUARD_ALLOWED_ORIGINS=http://localhost:5173 npm run server
```

## 6. Verification status in this audit

| Item | Status |
|---|---|
| Local production build | VERIFIED (exit 0) |
| `dist/index.html` uses relative asset paths | VERIFIED |
| Local e2e against `vite preview` + local API servers | VERIFIED (24/24) |
| GitHub Actions for `a77a427` | VERIFIED via the Actions API (all jobs succeeded) |
| Live GitHub Pages site reachable | Verified by CI's `verify-production`. **Not reachable from the audit sandbox** (egress proxy returned 403) |
| API deployed anywhere public | NOT DEPLOYED |
| Render blueprint | CONFIGURED BUT NOT VERIFIED |
| Live Anthropic integration | NOT VERIFIED |
