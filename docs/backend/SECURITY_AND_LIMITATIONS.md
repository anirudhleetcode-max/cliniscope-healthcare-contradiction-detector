# Backend security and limitations

## Implemented
- **Secrets:**
  - read only from server environment variables (`server/config.ts`);
  - `.env` files are not committed, and `.env.example` has placeholders only;
  - `/api/health` reports whether AI is configured, never the key;
  - request logs record method, path, status and duration only, never bodies, tokens or clinical text.
- **Passwords and sessions:**
  - passwords use scrypt (N=16384) with a per-user salt;
  - sessions are 256-bit random bearer tokens, stored as SHA-256 hashes, with an expiry (default 8 h) and revoked on logout;
  - login is rate-limited (10 per 15 min per email and IP).
- **Authorization:**
  - every case-scoped route checks `case_members` (viewer / reviewer / owner);
  - non-members get 404, so case IDs cannot be probed;
  - archived cases are read-only.
- **Input validation:**
  - zod schemas for request bodies, plus strict ID patterns;
  - integer query parameters are range-checked (400 when invalid, never silently clamped);
  - enums are checked for status and type filters;
  - size limits on JSON (25 MB), files (`MEDGUARD_MAX_UPLOAD_MB`) and document text.
- **SQL:** parameterized statements only. `LIKE` searches escape `%`, `_` and `\`.
- **Evidence integrity:**
  - snapshots are rejected (422) unless every statement and evidence quote equals the stored document text at its offsets;
  - review status is never taken from a client snapshot;
  - the evidence endpoint re-verifies quotes on every read.
- **CORS:** an exact-origin allow-list; other origins get 403. No credentials cookies are used, because the bearer token is sent in a header.
- **Headers:** `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. Original files are served as `application/octet-stream` attachments.

## Limitations
- **Not hosted.** The live site is not connected to a backend.
- **SQLite:** a single instance with no encryption at rest beyond the host disk. Backups are the operator's responsibility.
- **Accounts:** no SSO, MFA, password reset, email verification or account deletion.
- **Rate limiting** is in memory and per process.
- **Activity log:** append-only through SQL triggers only. It is not tamper-evident and not a compliance-grade audit trail.
- **Server-side analysis:** documents are not analysed on the server. Text extraction and detection run in the browser, and the server verifies and stores the results. Registering a document stores its metadata and text; the original file is stored only if it is uploaded separately (`hasServerFile`).
- **Compliance:** no regulatory assessment (HIPAA, GDPR, MDR or other). **Use synthetic data only.** MEDGUARD flags possible documentation inconsistencies for human review. It does not diagnose and is not clinically validated.
