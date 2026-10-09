# MEDGUARD — Deployment and CI/CD

> **Evidence:** `.github/workflows/ci-deploy.yml`, `vite.config.ts`, `Dockerfile`, `.dockerignore`, `render.yaml`, `.env.example` and the `package.json` scripts.
> Run and deployment status comes from the GitHub Actions API and the repository's GitHub deployment records, read on 2026-10-09.
> The audit sandbox **cannot open** `github.io` or `vercel.app` URLs: its egress proxy rejects them. So nothing below states that a live site was opened by the auditor.

## 1. Deployment summary

| Component | Hosting / runtime | Build command | Start command | Configuration | Status |
|---|---|---|---|---|---|
| Frontend (static SPA) — GitHub Pages | **GitHub Pages**, served from the `gh-pages` branch | `npm ci && npm run build` (`copy-pdf-worker` → `tsc --noEmit` → `vite build`) → `dist/` | none (static files) | `vite.config.ts` `base: process.env.VITE_BASE_PATH \|\| './'`; `HashRouter`; `dist/.nojekyll` | **VERIFIED via CI** (detail below) |
| Frontend (static SPA) — Vercel | Vercel project **`medguard`**, connected through the Vercel GitHub app | Set in the Vercel dashboard. **No `vercel.json`** in the repository | none (static) | Outside the repository | **VERIFIED via deployment records** (detail below) |
| API server (optional) | Docker container (`node:22-slim`) | `docker build -t medguard-api .` (inside: `npm ci --ignore-scripts` → `npm run server:build`, an esbuild bundle) | `node server.mjs` (container CMD). Locally: `npm run server` or `npm run server:start` | `Dockerfile`: non-root `node` user, `VOLUME /data`, `EXPOSE 8787`, `HEALTHCHECK` on `/api/ready` (v1.2) | **Built and health-checked in CI. Not published to any registry. Not deployed** |
| API on Render | Render web service `medguard-api`: Docker runtime, `starter` plan, 1 GB disk at `/data`, `healthCheckPath: /api/ready` (v1.2) | Render builds the Dockerfile | Container CMD | `render.yaml`. `MEDGUARD_ALLOWED_ORIGINS` and `ANTHROPIC_API_KEY` are set in the dashboard (`sync: false`) | **CONFIGURED BUT NOT VERIFIED.** The blueprint has never been run, and no Render URL exists |
| Database (optional) | SQLite file in the API's data volume (`/data/medguard.db`) | n/a | Created and migrated on server start | `MEDGUARD_DATA_DIR` | Exists only where the API runs. **No managed or external database** |
| External AI (optional) | Anthropic Messages API | n/a | n/a | `ANTHROPIC_API_KEY`, `MEDGUARD_AI_MODEL` (default `claude-opus-5-5`) | **Not configured in any deployment. Live calls never verified.** CI uses a local fake (`tests/e2e/fake-anthropic.mjs`) and the dummy key `sk-fixture-not-real` |

**GitHub Pages evidence:**
- run "CI and deploy" **#31** (commit `16ebafa`) passed every job, including `deploy` and `verify-production`;
- it published `gh-pages` commit `c9080d5`;
- "pages build and deployment" **#17** then succeeded.

**Vercel evidence:** the repository's GitHub deployment records show:
- a **Production** deployment of `16ebafa`, created by `vercel[bot]`, with status `success`;
- **Preview** deployments for PR #2 and PR #3, which the Vercel bot reported as "Ready".

The production domain and build settings are not stored in the repository. Treat them as **UNKNOWN** until checked under Vercel → Project → Settings → Domains.

**Live URLs:**
- **GitHub Pages:** the workflow builds the URL as `https://<owner>.github.io/<repository>/`. The repository still has its original name; the MEDGUARD rename changed the product name, not the repository.
- **Vercel:** served at the domain root.

Both work because the build uses relative asset paths and hash routing (§2).

## 2. Base path and asset paths

- **Relative assets:** `vite.config.ts` uses `base: './'`, so `dist/index.html` references `./assets/…` and `./favicon.svg` (VERIFIED in this audit's build).
- **Hash routes:** routes look like `#/cases/…`, so the host never needs SPA rewrites. Deep links work under a repository sub-path (Pages) and at a root (Vercel).
- **Self-hosted workers and assets:** the pdf.js worker, OCR worker, WASM and language data resolve with `new URL('./…', document.baseURI)` (`browserExtract.ts`, `browserOcr.ts`). Demo files use `fetch('./demo/…')`. The service worker registers as `./sw.js`.

## 3. CI/CD pipeline (`.github/workflows/ci-deploy.yml`, workflow "CI and deploy")

**Triggers:** `push` to any branch, `pull_request`, `workflow_dispatch`.
**Permissions:** `contents: write`, `pages: write`, `id-token: write`.
**Concurrency:** one run per ref; a newer run cancels the older one.

| Order | Job | Steps actually implemented | Runs when |
|---|---|---|---|
| 1 | `test` | checkout → Node 22 (npm cache) → `npm ci` → `npm run typecheck` → `npm test` (Vitest) → `npm run build` → `npx playwright install --with-deps chromium` → `npx playwright test` → upload the `dist` artifact (7 days). The Playwright run uses the desktop and mobile projects and starts a real API server on 8787, a fake Anthropic API on 8788 and an AI-configured API server on 8789 | Every trigger |
| 1 (parallel) | `docker-api` | `docker build -t medguard-api .` → run the container → poll `/api/health` (30 × 2 s). **v1.2 adds:** assert `/api/ready` returns `"ok":true` → `docker restart api` → wait for `/api/ready` again (migrations are idempotent on the existing database file) | Every trigger |
| 2 | `deploy` (needs `test`) | download `dist` → `touch dist/.nojekyll` → `peaceiris/actions-gh-pages@v4` (`publish_branch: gh-pages`, `force_orphan: true`) | Not on pull requests; only for the **default branch** or `main` |
| 3 | `verify-production` (needs `deploy`) | Query or enable the Pages API (`gh api …/pages`) → poll the live URL until the HTML contains `MEDGUARD` (30 × 10 s), otherwise warn → `npm ci` → install Chromium → `BASE_URL=<live URL> npx playwright test --project=desktop --project=mobile` | After `deploy` |

In the production run, the shared-workspace and AI e2e specs **skip themselves** (`test.skip(!API, …)`), so production verification covers the static app only. Earlier production runs logged **21 passed, 3 skipped**.

**Vercel** runs entirely outside this workflow, through its own GitHub integration.

### 3.1 Developer-to-production flow (as implemented)

1. A developer pushes any branch, or opens a PR.
2. `test` and `docker-api` run in parallel. Vercel independently builds a preview for the branch.
3. Inside `test`: the type check, the unit and integration tests (**100** on `claude/medguard-backend`), the production build and the **24** Playwright tests run.
4. On the default branch only, `deploy` publishes `dist/` to `gh-pages`, and GitHub's "pages build and deployment" workflow serves it.
5. Vercel deploys the default branch to production through its own integration.
6. The backend is **not** deployed by any workflow.
7. **Health checks:** the container's `/api/health` and `/api/ready` are checked in `docker-api` (CI only). The live Pages frontend is checked by HTML polling and then the browser tests in `verify-production`.

There is no staging environment, release tagging, manual approval gate, rollback automation, secret-scanning or SAST step, or dependency-audit step.

### 3.2 Recent run evidence (GitHub Actions API)

| Run | Branch / commit | Result |
|---|---|---|
| CI and deploy #36 / #37 (push / PR) | `claude/medguard-backend` `5a6400a` | success. `test` ✓, `docker-api` ✓, `deploy` and `verify-production` skipped (not the default branch) |
| CI and deploy #31 | `claude/fervent-euler-bsgy2t` `16ebafa` | success. All 4 jobs ✓ |
| pages build and deployment #17 | `gh-pages` `c9080d5` (deploy of `16ebafa`) | success |
| CI and deploy #34 / #35 | `claude/optimistic-tesla-466st5` `3c51efa` (PR #2) | success |

**Default branch:** `claude/fervent-euler-bsgy2t`. This is an **inference** from deploy behaviour: the `deploy` job runs only for the default branch or `main`, it ran for this branch, and no `main` branch exists.

## 4. Environment variables (names only; never commit values)

Sources: `.env.example`, `server/config.ts`, `vite.config.ts`, `playwright.config.ts`, `tests/e2e/*.spec.ts`.

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

**Naming history.** Commit `16ebafa` renamed every internal identifier from the earlier CLINISCOPE name to MEDGUARD: the env prefix, the IndexedDB name `medguard`, the `medguard.*` storage keys, the cache `medguard-v1`, the backup format `medguard-backup`, the Docker image and the SQLite file. **Consequences:**
- Browser data saved under the old database name is not migrated; the demo workspace reseeds automatically.
- Backups exported before that commit are rejected by restore, because the format ID differs.

**Secrets.** No secrets are stored in the repository:
- `.env`, `.env.*`, `*.pem` and `*.key` are git-ignored;
- `.env.example` contains placeholders only;
- `render.yaml` marks `ANTHROPIC_API_KEY` and `MEDGUARD_ALLOWED_ORIGINS` as `sync: false`.

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

Backend setup details: [`../backend/LOCAL_SETUP.md`](../backend/LOCAL_SETUP.md) and [`../backend/DEPLOYMENT.md`](../backend/DEPLOYMENT.md).

## 6. Verification status

| Item | Status |
|---|---|
| Local production build | VERIFIED in this audit (exit 0) |
| `dist/index.html` uses relative asset paths | VERIFIED |
| Local e2e against `vite preview` + local API servers | VERIFIED (24/24, this audit) |
| GitHub Actions for `16ebafa` (default branch) and `5a6400a` (backend branch) | VERIFIED via the Actions API |
| GitHub Pages serving `16ebafa` | VERIFIED by CI (`deploy` + `verify-production`). Not opened from the audit sandbox |
| Vercel production of `16ebafa` | Deployment record `success`. Domain UNKNOWN; not opened from the audit sandbox |
| API deployed anywhere public | NOT DEPLOYED |
| Render blueprint | CONFIGURED BUT NOT VERIFIED |
| Live Anthropic integration | NOT VERIFIED |
