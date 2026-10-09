# MEDGUARD backend — local setup

Requirements: Node.js **22 or later**. No database server is needed: without `DATABASE_URL` the server uses an embedded PostgreSQL (PGlite) stored in `MEDGUARD_DATA_DIR/pgdata`.

```bash
npm ci                                   # one install for frontend and backend
cp .env.example .env                     # optional; the server reads process env, not .env, so export what you need:
export MEDGUARD_DATA_DIR=./data          # embedded database directory (created automatically)
# export DATABASE_URL=postgresql://...   # optional: use a PostgreSQL server instead (secret; never commit it)
export MEDGUARD_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173
export MEDGUARD_ALLOW_REGISTRATION=true  # demo only; use create-user for controlled access
npm run server                           # http://localhost:8787 (migrations run automatically at start-up)
```

- **Check it is up:** `curl localhost:8787/api/health` and `curl localhost:8787/api/ready`.
- **API documentation:** `curl localhost:8787/api/openapi.json`, which you can paste into any OpenAPI viewer, plus `docs/backend/API_REFERENCE.md`.
- **Create an account** when registration is disabled:
  ```bash
  MEDGUARD_NEW_USER_PASSWORD='at-least-10-chars' npx tsx server/index.ts create-user alice@example.test "Alice Reviewer"
  ```
- **Production bundle**, a single file; it needs `node_modules/@electric-sql/pglite` only when `DATABASE_URL` is empty:
  ```bash
  npm run server:build && npm run server:start
  ```
- **Docker:**
  ```bash
  docker build -t medguard-api . && docker run -p 8787:8787 -v medguard-data:/data -e MEDGUARD_ALLOWED_ORIGINS=http://localhost:4173 medguard-api
  ```

## Tests
```bash
npx vitest run tests/unit/backend.test.ts tests/unit/server.test.ts tests/unit/sync.test.ts   # backend + database
npm test                                                                                        # all unit/integration tests
npm run test:e2e                                                                                # browser tests; starts real API servers itself
```

- Every backend test creates its own throw-away database: embedded in memory, or in a temporary directory when it restarts the server. Tests never touch `./data`.
- To run the API and database tests against a real PostgreSQL server too, as CI does, point `TEST_DATABASE_URL` at a server where the tests may create databases. Each test creates a fresh `medguard_t_*` database:
  ```bash
  TEST_DATABASE_URL=postgres://postgres:<password>@localhost:5432/postgres npx vitest run tests/unit/backend.test.ts tests/unit/server.test.ts tests/unit/sync.test.ts
  ```
  **Never** point it at a database that holds real data.

## Resetting local data
Stop the server and delete `$MEDGUARD_DATA_DIR`. The schema is recreated on the next start. With `DATABASE_URL`, drop and recreate that database instead.
