# MEDGUARD backend — deployment

**Status: not deployed.** No hosting account or credentials were available. The backend runs locally and in CI only:
- the `test` job runs the integration tests and end-to-end tests against real API processes;
- the `docker-api` job builds the image and checks `/api/health`, then `/api/ready` before and after a container restart.

Nothing on this page has been run against a cloud provider.

## What a host must provide
- A long-running Node 22.13+ process or container. Serverless platforms do not fit, because SQLite needs a local disk.
- A **persistent volume** mounted at `MEDGUARD_DATA_DIR` (container default `/data`). Without one, the database is lost on every redeploy.
- HTTPS termination: the browser frontend only calls HTTPS APIs, except localhost.
- A single instance. SQLite does not support multiple writers across machines.

## Configuration (server-side environment only)
| Variable | Required | Notes |
|---|---|---|
| `MEDGUARD_ALLOWED_ORIGINS` | yes | Exact frontend origin(s), comma-separated, e.g. `https://<your-frontend-host>` |
| `MEDGUARD_DATA_DIR` | yes | Persistent volume path (`/data` in the image) |
| `MEDGUARD_ALLOW_REGISTRATION` | no | `false` (default) + `create-user` for controlled access |
| `MEDGUARD_SESSION_TTL_HOURS`, `MEDGUARD_MAX_UPLOAD_MB`, `PORT`, `HOST` | no | Defaults 8, 10, 8787, 0.0.0.0 |
| `ANTHROPIC_API_KEY` | no | Enables AI-assisted analysis; keep it in the host's secret store |

Never put any of these in `VITE_*` variables: frontend build variables are public.

## Ready-made manifests
- **`Dockerfile`:** a multi-stage build; the runtime is the single bundled server file plus `node:sqlite`. Its `HEALTHCHECK` uses `/api/ready`.
- **`render.yaml`:** a Render Blueprint with a Docker web service, a 1 GB disk at `/data` and the health check on `/api/ready`. Set `MEDGUARD_ALLOWED_ORIGINS` and `ANTHROPIC_API_KEY` in the dashboard.

## Release checklist
1. Back up the existing `medguard.db`. Migrations run automatically at start-up and are tested on clean and v1 databases.
2. Deploy, then confirm `GET /api/ready` returns `{"ok":true, "database":{"schemaVersion":N, "expectedSchemaVersion":N}}`.
3. Sign in from the frontend: **Settings → Shared workspace → server URL → Connect**.
4. Only then consider changing the frontend's default mode (see `FRONTEND_INTEGRATION.md`).
