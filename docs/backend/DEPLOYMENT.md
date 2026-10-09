# MEDGUARD backend — free deployment (₹0)

**Status (verified 2026-10-09):** the API is **deployed** at `https://medguard-api-duti.onrender.com` on a Render free web service, with its data in a Neon free PostgreSQL database. The live GitHub Pages frontend works with it. The run that verified this is described in [Live verification](#live-verification) below.

## Live verification
The workflow **Verify live deployment** (`.github/workflows/verify-live.yml`, script `tests/live/verify-api.mts`) runs on GitHub's runners with synthetic `@example.test` data only. It runs on pull requests that change it, and on demand via **Actions → Verify live deployment → Run workflow**.

Run of 2026-10-09 against the deployed API (commit `bb83038`), all steps passed:

| Check | Evidence |
|---|---|
| Health | `GET /api/health` → 200, version 1.3.0 |
| Readiness and database | `GET /api/ready` → 200, `{"reachable":true,"engine":"postgresql","storage":"external","schemaVersion":3,"expectedSchemaVersion":3}` |
| CORS | Preflight from the GitHub Pages origin → 204 with a matching `Access-Control-Allow-Origin`; another origin → 403 |
| Authentication | Register two accounts; duplicate → 409; wrong password → 401; login → token; no token → 401 |
| Records and detection | 4 synthetic documents through the real extraction and rules engine → 37 statements, **9 findings**; the server re-verified every quote, stored all 9, and the evidence endpoint verified them |
| Review and notes | `unreviewed → in_review`; closing without a reason → 422; `→ needs_info` with a reason; note saved |
| Files | 705-byte original uploaded and downloaded byte-identical |
| Isolation | A signed-in non-member gets 404 for the case, a finding, the file, a status change and the activity log; overwriting another case's document → 409; the case is not in their list |
| Audit log | Case, upload, detection, decision and note entries present |
| Error handling | Invalid input → 400 with a readable message; unknown finding → 404; no internals in either |
| Live browser | Two-user shared-workspace browser tests on the **live GitHub Pages site** against the live API: 2/2 |
| Persistence after a restart | After 17 idle minutes the first request took **22.3 s** (the free instance had stopped and cold-started). Login, the case, 4/37/9 documents/statements/findings, the `needs_info` decision, the note and the original file all read back |

**Not covered by the live run:**
- The append-only database triggers: the API has no route that edits the audit log. They are tested against PostgreSQL 16 in CI.
- AI analysis: no `ANTHROPIC_API_KEY` is configured, so it is off.
- Free-plan status of the two dashboards: only the account owner can check those (see step 7).

**Test data left behind:** each run creates two synthetic accounts (`live-owner-…@example.test`, `live-outsider-…@example.test`) and cases labelled `SYNTHETIC live check …` / `SYNTHETIC outsider …`. The two-user browser test also creates `alice-…`/`bob-…@example.test` accounts and a `SHARED-… · synthetic` case. The API has no delete route for cases or accounts by design (cases are archived), so they stay. They are small (kilobytes per run) and contain only synthetic text.

**Latency:** with the API and the database in different regions, every database round trip costs about 180 ms. A case action took 2–3 s, and the first sync of a 4-document case took 11.5 s. Creating the Render service in the same region as the Neon project (for example both in Singapore) removes most of this. Case snapshots now issue their reads in parallel (API 1.3.1).

## Architecture

| Part | Where it runs | Plan | Why |
|---|---|---|---|
| Frontend (static) | GitHub Pages, unchanged: `https://<your-github-username>.github.io/<repository>/` | Free | Already deployed by CI |
| API (`server/`, Docker) | **Render** web service, from this repository's `Dockerfile` / `render.yaml` | **Free** instance | Runs the existing Node server unchanged. Free instances have **no persistent disk**, so nothing is stored on the instance |
| Database | **Neon** serverless PostgreSQL, reached through `DATABASE_URL` | **Free** plan | All persistent data, including original uploaded files (`document_files`), lives here and survives every restart and redeploy of the API |

```
Browser ── HTTPS ──► GitHub Pages (static app; local demo mode needs nothing else)
   │
   └── HTTPS (only after you connect a server in Settings → Shared workspace)
         ──► Render free web service (MEDGUARD API) ── TLS ──► Neon free PostgreSQL
```

### Free-tier terms that matter
These were checked against provider pages and 2026 sources on 2026-10-09. They can change, so re-check before you rely on them.

| | Render free web service | Neon free plan |
|---|---|---|
| Cost | $0 (750 instance-hours per workspace per month: enough for one service running all month) | $0 |
| Payment method | Render says its free tier needs no credit card. **Caveat:** Render staff have said that some accounts are asked to verify with a card (a $1 authorisation that is immediately cancelled) to prevent abuse. If Render asks you for a card, stop: see "If a provider asks for a card" below | No credit card (all sources agree) |
| Sleep | Stops after **15 minutes** without traffic; the next request wakes it in about **1 minute** | Compute scales to zero after ~5 minutes idle and resumes automatically in well under a second |
| Storage | Ephemeral filesystem: everything on the instance is lost on restart, redeploy or sleep. **Not used for data.** | About 0.5 GB per project (some 2026 sources report 1 GB). Check **Usage** in the Neon console |
| Other limits | One instance; no disks; not intended for production use | About 100 compute-hours per project per month (≈400 h at the smallest size) |
| At the limit | Services are suspended until the next month (no bill without a payment method) | Compute is suspended until the next month (no bill on the Free plan) |

### Options considered and rejected
| Option | Reason rejected |
|---|---|
| Render free + its own SQLite disk | Persistent disks are not available on free instances |
| Render free PostgreSQL | Expires after 30 days on the free plan |
| Turso (SQLite-compatible) | Free-plan databases are archived after 10 days without activity and must be unarchived by hand: unreliable for a demo that sits idle |
| Cloudflare Workers + D1 | Free Workers allow ~10 ms CPU per request; password hashing (scrypt) alone exceeds it. Would also need a rewrite of the server |
| Koyeb free | Now reported to require a card (pre-authorisation) |
| Hugging Face Docker Spaces | Reported to need a paid plan to create; disk wiped on restart |
| Fly.io, Railway | No ongoing free plan without a card |
| Supabase free | Works, but projects pause after 7 days without activity |

## What changed in the code to make this possible
- The database layer (`server/db.ts`) uses **PostgreSQL**:
  - `DATABASE_URL` set: node-postgres connects to an external server (Neon).
  - `DATABASE_URL` unset: **PGlite**, an embedded PostgreSQL, is stored in `MEDGUARD_DATA_DIR/pgdata`. This is used for local development, tests and self-hosting on a volume.
  - Both use one SQL dialect and the same migrations (v1–v3).
- Original uploaded files are stored **in the database**, not on disk.
- `MEDGUARD_REQUIRE_DATABASE_URL=true` (set in `render.yaml`) makes the server **refuse to start** without `DATABASE_URL`, so it can never silently write to the ephemeral disk.
- `/api/ready` reports `"storage":"external"` when the data is in the external database.
- The frontend waits up to 90 s for a sleeping server to wake, and says so.

## Step by step

### 1. Create the free database (Neon) — *manual, needs your account*
1. Open **https://neon.com** and sign up with GitHub or email. Choose the **Free** plan; do not add a payment method.
2. Create a project. Name: `medguard`. PostgreSQL version: the default (16 or 17). **Region:** pick the one closest to you, and remember it. For India, choose **AWS Asia Pacific (Singapore)**.
3. Open **Connect** (or **Connection details**) on the project dashboard and copy the connection string. It looks like:
   `postgresql://<user>:<password>@ep-<name>-pooler.<region>.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
   - This is a **secret**. Do not paste it into GitHub, issues, chat or any `VITE_*` variable.
   - The pooled ("-pooler") and direct strings both work.
   - MEDGUARD creates its tables itself on first start; you do not run any SQL.

### 2. Create the free API service (Render) — *manual, needs your account*
1. Open **https://render.com** and sign up with GitHub. Do not add a payment method.
2. Choose **New → Blueprint**, connect your GitHub account, and select this repository. The default branch already contains `render.yaml` once this change is merged.
3. Render reads `render.yaml`: one **web service** named `medguard-api`, runtime **Docker**, plan **Free**, health check `/api/ready`. It asks for the values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | The Neon connection string from step 1.3 |
   | `MEDGUARD_ALLOWED_ORIGINS` | `https://<your-github-username>.github.io`: scheme and host only, **no path and no trailing slash** |
   | `ANTHROPIC_API_KEY` | Leave **empty**. AI-assisted analysis stays off and costs nothing |

   `MEDGUARD_REQUIRE_DATABASE_URL=true` and `MEDGUARD_ALLOW_REGISTRATION=true` are set by the blueprint.
4. If you can choose a region, pick the one closest to your Neon region (e.g. **Singapore**). Confirm the instance type shows **Free**, then apply.
5. Wait for the first build and deploy to finish (several minutes). Builds count against Render's monthly free build allowance; to save it, set the service's **Auto-Deploy** to deploy only after CI checks pass, or off. The service's public URL is shown at the top of its page, e.g. `https://medguard-api-xxxx.onrender.com`. **This is your backend URL.**

### 3. Verify the backend
```bash
API=https://medguard-api-xxxx.onrender.com     # your URL from step 2.5
curl -s $API/api/health    # → {"ok":true,"service":"medguard-api",...}
curl -s $API/api/ready     # → {"ok":true,"database":{"reachable":true,"engine":"postgresql","storage":"external","schemaVersion":3,"expectedSchemaVersion":3},...}
```
- `"storage":"external"` proves the data goes to Neon.
- The first call after 15 idle minutes can take about a minute; that is the free instance waking up.
- If `/api/ready` returns 503, or the service does not start, open the service's **Logs** in Render. The log says `the database could not be reached (check DATABASE_URL)` when the connection string is wrong. It never prints the string itself.

### 4. Connect the live frontend
1. Open the live site, then **Settings → Shared workspace**.
2. Paste the backend URL and choose **Connect**. "Connecting…" can last up to a minute while the server wakes; then it shows **Reachable · API v1.3.1** (or later).
3. **Create account** with a made-up name and an `@example.test` address. Use synthetic data only.

The URL is stored in that browser only. Local demo mode stays the default for every other visitor.

### 5. Test a synthetic case end to end
1. Signed in: **Clinical Cases → New case → Create shared case**. Upload two or more of the synthetic demo files (from `public/demo/` in the repository).
2. Run the analysis and open a finding. Its evidence quotes are highlighted in the source text.
3. **Review** the finding: set *Needs more information*, add a note, then reload the page. The status and note must still be there.

Optionally, let CI run the shared-workspace browser tests against the deployed API on every deployment:
- In GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**, name `MEDGUARD_API_URL`, value = the backend URL. This is not a secret.
- The `verify-production` job then wakes the API and runs the two shared-workspace e2e tests against it. They use synthetic `@example.test` accounts.
- The AI e2e test stays skipped unless an AI key is configured.

### 6. Verify persistence
1. Note the case from step 5.
2. In Render: open the service, then **Manual Deploy → Deploy latest commit**, or **Restart service**. This replaces the instance and its disk. Alternatively, wait more than 15 minutes for it to sleep.
3. Reload the frontend and sign in again. The case, its documents, the decision, the note and the activity history must all be there.
4. Optionally, in the Neon console open **Tables**. `cases`, `findings` and `audit_events` contain the rows.

### 7. Confirm the cost is ₹0
- **Render:** the service shows instance type **Free**. **Billing** shows no payment method and $0 usage.
- **Neon:** **Billing** (or Plan) shows **Free**, with no payment method.
- **GitHub Pages and GitHub Actions** are free for public repositories.
- **AI:** with `ANTHROPIC_API_KEY` empty, no AI requests are made.

### If a provider asks for a card
Do not enter one if your requirement is "no payment method at all". Stop there; nothing has been charged.
- The database part (Neon) needs no card.
- For the API host, every alternative checked on 2026-10-09 either needed a card (Koyeb, Fly.io, Railway), a paid plan (Hugging Face Docker Spaces), or a rewrite (Cloudflare Workers).
- A remaining no-card option is running the API as a Vercel serverless function. It is **not implemented**. It would cap uploads at about 4.5 MB, weaken the in-memory login rate limit, and the Vercel Hobby plan is for non-commercial use.

## Data, persistence and limits
- **Persists** (in Neon): accounts (scrypt hashes), sessions (SHA-256 hashes), cases, members, documents and extracted text, statements, findings, review decisions, notes, the append-only activity log, and original uploaded files.
- **Not persisted:** login and AI rate-limit counters (in memory; reset when the instance restarts).
- **Backups:** the free plan's restore window is short. Export regularly if the data matters: `pg_dump "$DATABASE_URL" > medguard.sql`. The data is synthetic by policy.
- **Size:** keep within Neon's free storage. Original files count towards it (up to `MEDGUARD_MAX_UPLOAD_MB`, default 10 MB each).
- **Not suitable for real patient data.** Free tiers, no compliance assessment (HIPAA or other), and no clinical validation.

## Other ways to run it
- **Self-hosting with a persistent volume, no external database:**
  `docker run -p 8787:8787 -v medguard-data:/data -e MEDGUARD_ALLOWED_ORIGINS=https://<frontend-host> medguard-api`
  This uses the embedded PostgreSQL in `/data/pgdata`.
- **Any PostgreSQL 14+ server:** set `DATABASE_URL` and `MEDGUARD_REQUIRE_DATABASE_URL=true`.

## How this was tested (before any cloud deployment)
- 106 unit and integration tests on embedded PGlite.
- The API and database tests (44) again against a real **PostgreSQL 16** server through the production driver. CI does the same with a `postgres:16` service.
- A real-process check: the bundled server ran against external PostgreSQL. A synthetic case with 4 documents (37 statements, 9 findings, a decision, a note and a 705-byte original file) was written. The process was killed and a new one started; everything read back unchanged.
- The CI `docker-api` job builds the image and, with an external `postgres:16` and **no volume**, writes data, removes the container, starts a new one, and reads the data back. It also checks the start-up guard and the embedded mode.
- **Not tested:** Render and Neon themselves. Nothing has been deployed to either provider from this repository yet.
