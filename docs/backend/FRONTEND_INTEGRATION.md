# Frontend ↔ backend integration

The frontend has two modes. The **default is unchanged: local demo mode.**

| | Mode 1 — Local demo (default) | Mode 2 — Shared workspace (backend-connected) |
|---|---|---|
| How to enable | Nothing to do | Settings → Shared workspace → enter the API URL → Connect → sign in; then create or publish a case as shared. `VITE_API_BASE_URL` can pre-fill the URL at build time. |
| Data store | Browser IndexedDB | Server PostgreSQL. The browser keeps a cache, but the server copy is authoritative. |
| Writes | Local service layer (`src/lib/services.ts`) | `useReviewActions` / `remoteApi` (`src/app/workspace.tsx`, `src/lib/remote.ts`) call the API; the server's response replaces the local copy |
| Failures | Shown as an error toast | Shown as an error; the case is marked **unsynced** and background refresh pauses until **Retry sync** succeeds. Writes are never silently kept as local-only. |
| Mode indicator | Header chip "Local demo mode" | Header chip "Shared workspace · <role>" |

The service boundary is per case: `case.remote` decides whether an action goes to the server or the local database. Both modes can be open side by side.

## What is verified
- **Shared mode, end-to-end with a real server process** (`tests/e2e/shared.spec.ts`, runs in CI): two users, a shared case, uploads, verified snapshot sync, a decision and a note visible to the other user, a reopen, the outsider and signed-out cases, and the viewer's read-only state.
- **Sync safeguards:** `tests/unit/sync.test.ts`.
- **New read endpoints** (documents, findings, evidence, history, activity, case update and archive): covered by `tests/unit/backend.test.ts` at API level only. **The frontend does not call them yet.** It still uses the full snapshot (`GET /api/cases/{id}`), which already returns everything it shows.

## Known integration gaps (not done, by design)
- **New outcomes in shared mode:** the frontend's shared mode still offers only the original five statuses (`transitionsFor('shared')`). The server now accepts all eight. Enabling `needs_info`, `expected_change` and `undetermined` for shared cases is a one-line client change. It was left off so the live frontend's behaviour does not change without approval.
- **No archive or rename UI** for shared cases yet: there is no `PATCH` button.
- **Live site:** it opens in local demo mode. A visitor connects it to the deployed API under Settings → Shared workspace; this was verified with the live browser tests (`DEPLOYMENT.md`). A server on a free plan sleeps when idle, so the client waits up to 90 s for `/api/health` and shows "Connecting…" meanwhile.
