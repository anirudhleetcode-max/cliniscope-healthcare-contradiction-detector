# MEDGUARD — Software Architecture

> Editable diagram sources live in [`diagrams/`](diagrams/). The diagrams below are copies of those files. Earlier, shorter notes are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## 1. System overview

MEDGUARD is a **static, browser-first single-page application**. All core work runs inside the reviewer's browser:

- document ingestion, text extraction, OCR;
- rules-based contradiction detection;
- the review workflow;
- the audit log.

All state is stored in **IndexedDB**. This is the default *local demo mode*, which needs no server, login or API key.

Two **optional** extensions exist and are off by default:

1. **Shared-workspace API server** (`server/`). Node 22 + `node:http` + SQLite. It adds accounts, case sharing with roles, a server-authoritative review state and an append-only audit log.
2. **AI-assisted reasoning.** The server forwards the extracted case text to the Anthropic Messages API, after explicit user consent. Both the server and the browser re-verify every returned quotation against the source text before anything is stored.

## 2. Component responsibilities

| Component | Responsibility | Main files |
|---|---|---|
| App bootstrap and routes | `HashRouter` with 14 routes plus a 404, error boundary, service worker registration | `src/main.tsx` |
| App shell | Sidebar, mobile drawer, header, breadcrumbs, Ctrl/Cmd+K search, notifications, toasts, mode chip | `src/components/shell/AppShell.tsx`, `CommandPalette.tsx`, `BrandMark.tsx` |
| Pages | Overview, Cases, Case workspace, Contradictions, Review Queue, Documents, Document viewer, Finding detail, Activity, Settings/About, Help | `src/pages/*.tsx` |
| Review UI | Side-by-side evidence, allowed actions, required-reason dialog, decision history | `src/components/review/Review.tsx` |
| App state | Current case, reviewer name, prefs, toasts, demo seeding, live-query hooks | `src/app/state.tsx` |
| Workspace state | Server URL, health, session, push/pull/publish, local-vs-server review actions | `src/app/workspace.tsx` |
| Service layer | Every write, each paired with an audit event: create case, upload, analyze, transition, notes, delete, demo seeding, AI findings | `src/lib/services.ts` |
| Extraction | Upload validation, TXT/DOCX/PDF/image extraction, OCR orchestration, offset helpers | `src/lib/extract.ts`, `browserExtract.ts`, `browserOcr.ts` |
| Statement extraction | Segmenting, lexicon matching, negation, temporality, doses, labs, dates | `src/lib/statements.ts`, `lexicon.ts`, `dates.ts` |
| Detection engine | Cross-document comparison, classification, evidence verification, explanations | `src/lib/detect.ts` |
| Review state machine | Allowed transitions (shared 5-state and local 8-state), reason rules | `src/lib/review.ts` |
| AI contract | Output schema, system prompt, quote verification, corroboration | `src/lib/ai.ts`, `aiClient.ts` |
| Remote client | `fetch` wrapper, session storage, snapshot apply/push/pull | `src/lib/remote.ts` |
| Exports | JSON report, CSV, backup, validated restore | `src/lib/exportCase.ts` |
| Metrics / queries | Dashboard numbers, filters, sorting | `src/lib/metrics.ts`, `query.ts` |
| Browser DB | Dexie schema (`medguard`, version 1) | `src/lib/db.ts` |
| API server | Routing, auth, CORS, validation, authorization, audit | `server/app.ts`, `auth.ts`, `config.ts`, `index.ts` |
| Server DB | SQLite schema + migrations + transactions | `server/db.ts` |
| AI provider | Anthropic SDK adapter + error mapping | `server/aiProvider.ts` |

## 3. Diagram A: high-level component architecture

Solid arrows are always present. Dotted arrows exist only when the optional server (and, for AI, an API key) is configured.

```mermaid
flowchart TD
    U["Reviewer (browser user)"]

    subgraph Browser["Browser: static React SPA (GitHub Pages or vite preview)"]
        UI["Presentation layer<br/>src/pages/*, src/components/*<br/>React 18 + Tailwind CSS"]
        ST["Client state<br/>src/app/state.tsx (AppProvider)<br/>src/app/workspace.tsx (WorkspaceProvider)"]
        SV["Service layer<br/>src/lib/services.ts<br/>upload, analyze, review, audit"]
        EX["Text extraction<br/>src/lib/extract.ts + browserExtract.ts<br/>pdf.js, mammoth, UTF-8 decode"]
        OCR["OCR engine<br/>src/lib/browserOcr.ts<br/>Tesseract.js (self-hosted assets)"]
        RULES["Rules engine<br/>statements.ts + lexicon.ts + detect.ts"]
        AIV["AI output verifier<br/>src/lib/ai.ts verifyAiOutput()"]
        IDB[("IndexedDB 'medguard'<br/>Dexie: cases, documents, files,<br/>statements, findings, events")]
        LS[("localStorage / sessionStorage<br/>preferences, server URL, session token")]
        SW["Service worker<br/>public/sw.js (offline cache)"]
    end

    subgraph Server["Optional API server: server/ (Node 22, node:http)"]
        API["HTTP router + auth + CORS<br/>server/app.ts"]
        SQL[("SQLite via node:sqlite<br/>DATA_DIR/medguard.db")]
        FS[("Private file store<br/>DATA_DIR/files/caseId/docId")]
        PROV["AI provider adapter<br/>server/aiProvider.ts"]
    end

    ANT["Anthropic Messages API<br/>(external, only if ANTHROPIC_API_KEY is set)"]

    U -->|"clicks, uploads, review decisions"| UI
    UI -->|"reads live data, calls actions"| ST
    ST -->|"invokes"| SV
    SV -->|"bytes in, text + page spans out"| EX
    EX -->|"thin or scanned pages, images"| OCR
    SV -->|"extractStatements(), detectContradictions()"| RULES
    SV -->|"Dexie transactions + append-only events"| IDB
    ST -->|"useLiveQuery() subscriptions"| IDB
    ST -->|"prefs, current case, reviewer name"| LS
    SW -.->|"caches same-origin GET responses"| UI

    ST -.->|"HTTPS JSON + Bearer token (fetch)"| API
    API -.->|"SQL, migrations, transactions"| SQL
    API -.->|"original uploads (mode 0600)"| FS
    API -.->|"POST /api/ai/analyze"| PROV
    PROV -.->|"structured-output request (server-side key)"| ANT
    ST -.->|"re-verify returned AI output locally"| AIV
    AIV -.->|"addAiFindings()"| SV
```

**Reading it.** The browser box is the whole product in its default configuration. Note that there is **no** arrow from the browser to any database server: IndexedDB is a browser-local store. The detection engine is browser code too. In shared mode it is still the browser that extracts and analyzes; the server only verifies and persists what it receives.

## 4. Diagram B: frontend-to-backend communication (shared mode only)

```mermaid
sequenceDiagram
    autonumber
    participant R as Reviewer
    participant B as Browser (React + IndexedDB)
    participant S as server/app.ts
    participant D as SQLite + files
    participant A as Anthropic API

    R->>B: Settings, enter server URL, Connect
    B->>S: GET /api/health
    S-->>B: ok, version, ai.configured, registration
    R->>B: Sign in
    B->>S: POST /api/auth/login (email, password)
    S->>D: verify scrypt hash, insert session (SHA-256 of token)
    S-->>B: token, expiresAt, user (token kept in sessionStorage)
    R->>B: Publish case / upload + analyze
    Note over B: Extraction, OCR and rules analysis run in the browser
    B->>S: PUT /api/cases/:id/snapshot (documents, statements, findings)
    S->>S: re-verify every quote against document text
    S->>D: merge by fingerprint, append audit events (transaction)
    S-->>B: case snapshot
    B->>S: PUT /api/cases/:id/documents/:docId/file (raw bytes)
    R->>B: Review decision
    B->>S: POST /api/findings/:id/transition (to, reason, expectedStatus)
    S->>D: UPDATE ... WHERE review_status = expected, then audit event
    S-->>B: case snapshot (409 if another reviewer changed it)
    loop every 15 s and on window focus
        B->>S: GET /api/cases/:id
        S-->>B: case snapshot (skipped while local work is unsynced)
    end
    opt AI-assisted analysis (consent dialog accepted)
        B->>S: POST /api/ai/analyze (extracted text only)
        S->>A: messages.parse with structured output
        A-->>S: findings JSON
        S->>S: verifyAiOutput()
        S-->>B: raw output + summary
        B->>B: verifyAiOutput() again on local text, store origin ai
    end
```

**Reading it.** Communication is plain `fetch` over HTTP(S) with JSON bodies and a bearer token. There are no WebSockets or server push. Shared cases refresh by **polling** (`src/app/workspace.tsx`, 15 000 ms interval plus a `focus` listener).

## 5. Diagram C: data-storage architecture

```mermaid
flowchart LR
    subgraph BrowserStorage["Browser (per device, per browser profile)"]
        IDB[("IndexedDB database 'medguard'<br/>cases | documents | files (Blob)<br/>statements | findings | events")]
        LSt[("localStorage<br/>medguard.currentCase<br/>medguard.reviewer<br/>medguard.prefs<br/>medguard.serverUrl<br/>medguard.demoGuide")]
        SSt[("sessionStorage<br/>medguard.session (bearer token)")]
        CS[("Cache Storage 'medguard-v1'<br/>app shell, assets, OCR, demo files")]
        MEM["React state (memory only)<br/>toasts, dialogs, filters, drafts"]
    end
    subgraph ServerStorage["Optional server (DATA_DIR volume)"]
        SQ[("medguard.db (SQLite, WAL)<br/>users, sessions, cases, case_members,<br/>documents, statements, findings,<br/>audit_events, schema_version")]
        FL[("files/caseId/docId<br/>original uploads, mode 0600")]
    end
    IDB -->|"PUT snapshot (shared cases only)"| SQ
    SQ -->|"GET snapshot replaces local cache"| IDB
    IDB -->|"PUT file"| FL
    FL -->|"GET file, then cached into files table"| IDB
```

**Reading it.** For a local case, IndexedDB is the system of record. For a shared case, SQLite is authoritative and IndexedDB is a cache; `applySnapshot()` replaces local rows with the server state. Details and persistence rules are in [`DATA_FLOW_AND_WORKFLOW.md`](DATA_FLOW_AND_WORKFLOW.md#4-data-storage-matrix).

### 5.1 IndexedDB schema (`src/lib/db.ts`, Dexie version 1)

| Table | Primary key | Indexes | Content |
|---|---|---|---|
| `cases` | `id` | `createdAt` | `CaseRecord` (label, demo flags, optional `remote` block) |
| `documents` | `id` | `caseId`, `[caseId+contentHash]` | `DocumentRecord` incl. full `extractedText`, page spans, OCR spans |
| `files` | `id` (= document id) | `caseId` | Original upload as `Blob` |
| `statements` | `id` | `caseId`, `documentId` | `ClinicalStatement` with exact char offsets |
| `findings` | `id` | `caseId`, `[caseId+fingerprint]` | `Finding` with evidence, classification, review status, `stale` |
| `events` | `id` | `caseId`, `findingId`, `at` | `AuditEvent`, written with `add()` only (never overwritten by the service layer) |

### 5.2 SQLite schema (`server/db.ts`, migration 1)

| Table | Key / constraints |
|---|---|
| `users` | `id` PK, `email` UNIQUE NOCASE, scrypt `password_hash` |
| `sessions` | `token_hash` PK (SHA-256), `user_id` FK with cascade delete, `expires_at` |
| `cases` | `id` PK, `owner_id` FK |
| `case_members` | PK `(case_id, user_id)`, `role` CHECK in `owner`, `reviewer`, `viewer` |
| `documents` | `id` PK, `case_id` FK with cascade delete, `data_json`, `file_path`, `file_size` |
| `statements` | `id` PK, `case_id` FK, `document_id`, `data_json` |
| `findings` | `id` PK, UNIQUE `(case_id, fingerprint)`, `review_status` CHECK in 5 shared statuses, `stale` |
| `audit_events` | `seq` autoincrement, triggers `audit_no_update` / `audit_no_delete` abort any change |

Pragmas: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`. Migrations are versioned in `schema_version` and applied in a transaction at start-up. Writes use `BEGIN IMMEDIATE` transactions (`tx()`).

## 6. Diagram D: deployment architecture

```mermaid
flowchart TD
    DEV["Developer push<br/>(any branch)"] --> GHA["GitHub Actions: 'CI and deploy'"]

    subgraph CI["Jobs"]
        T["test<br/>npm ci, typecheck, vitest,<br/>vite build, Playwright e2e,<br/>upload dist artifact"]
        DK["docker-api<br/>docker build, run container,<br/>curl /api/health"]
        DP["deploy<br/>default branch or main only;<br/>peaceiris/actions-gh-pages to gh-pages"]
        VP["verify-production<br/>wait for live HTML containing MEDGUARD,<br/>then Playwright against live URL"]
    end

    GHA --> T
    GHA --> DK
    T -->|"needs: test"| DP
    DP -->|"needs: deploy"| VP
    DP --> GHP["gh-pages branch"]
    GHP --> PAGES["GitHub Pages<br/>anirudhleetcode-max.github.io/<br/>cliniscope-healthcare-contradiction-detector/"]
    VP -->|"HTTPS"| PAGES

    PAGES --> BROWSER["User browser<br/>static SPA, HashRouter,<br/>relative asset paths"]

    DOCKER["Dockerfile<br/>node:22-slim, single bundled server.mjs,<br/>VOLUME /data, HEALTHCHECK"]
    RENDER["render.yaml<br/>Render web service 'medguard-api',<br/>1 GB disk at /data"]
    DK -.->|"image built and health-checked in CI only,<br/>not pushed to a registry"| DOCKER
    RENDER -.->|"blueprint present, never run"| DOCKER
    BROWSER -.->|"only if a server URL is entered in Settings"| DOCKER
```

**Reading it.** Only the static frontend is deployed. The API image is built and smoke-tested in CI, but it is not published or hosted. See [`DEPLOYMENT_AND_CI_CD.md`](DEPLOYMENT_AND_CI_CD.md).

## 7. Diagram E: contradiction-detection pipeline

```mermaid
flowchart TD
    A["File chosen in Documents page<br/>(PDF, TXT, DOCX, PNG, JPEG)"] --> B["validateUpload()<br/>extension, MIME, size, magic bytes"]
    B -->|"invalid"| BX["UploadValidationError shown to user<br/>nothing stored"]
    B -->|"valid"| C["sha256Hex() duplicate check<br/>per case"]
    C --> D["Store DocumentRecord + original Blob<br/>event: document_uploaded"]
    D --> E{"File kind"}
    E -->|"txt"| E1["extractTxt()<br/>strict UTF-8 decode"]
    E -->|"docx"| E2["extractDocx()<br/>mammoth.extractRawText"]
    E -->|"pdf"| E3["extractPdf()<br/>pdf.js text layer per page"]
    E -->|"image"| E4["extractImage()<br/>Tesseract.js OCR"]
    E3 -->|"page with fewer than 20 chars"| E5["OCR that page<br/>Tesseract.js, words below 70% flagged"]
    E1 --> F["normalizeText()<br/>newlines, control characters"]
    E2 --> F
    E3 --> F
    E4 --> F
    E5 --> F
    F --> G["extractStatements()<br/>segment() into sentences + section headings"]
    G --> H["Lexicon matching + regex rules<br/>allergy, medication, diagnosis, lab,<br/>procedure, smoking status, date of birth"]
    H --> I["ClinicalStatement<br/>concept, polarity, value, unit, temporality,<br/>status, charStart..charEnd, OCR provenance"]
    I --> J["Reviewer clicks Analyze<br/>analyzeCase()"]
    J --> K["detectContradictions(caseId)<br/>group by normalized concept, same case only"]
    K --> L["Category comparators<br/>compareAllergies, compareMedications,<br/>comparePolarityConcept, compareLabs,<br/>compareSmoking, compareProcedures,<br/>compareDemographic"]
    L --> M["emit(): re-verify every quote at its offsets,<br/>require two different documents,<br/>downgrade low-confidence OCR"]
    M -->|"quote not found"| MX["No finding created"]
    M --> N["DraftFinding<br/>findingType, evidenceQuality, reviewPriority,<br/>explanation, caveats, alternatives"]
    N --> O["Reconcile by fingerprint<br/>new: unreviewed; existing: keep status;<br/>missing: mark stale"]
    O --> P[("IndexedDB findings + events")]
    P --> Q["Review Queue / Contradictions / Finding detail<br/>human decision with required reason"]
```

**Reading it.** Every step is deterministic TypeScript; there is no trained model in this path. A step-by-step description is in [`DATA_FLOW_AND_WORKFLOW.md`](DATA_FLOW_AND_WORKFLOW.md#3-detection-pipeline-step-by-step).

## 8. Key architectural decisions (as implemented)

| Decision | Consequence | Evidence |
|---|---|---|
| Browser-first, no mandatory backend | Works on static hosting and offline. Data is per-browser and single-user in local mode | `src/lib/db.ts`, `public/sw.js` |
| `HashRouter` + `base: './'` | Deep links and assets work under the GitHub Pages sub-path `/cliniscope-healthcare-contradiction-detector/` with no server rewrites | `src/main.tsx`, `vite.config.ts`, built `dist/index.html` uses `./assets/...` |
| Self-hosted pdf.js worker, OCR worker, WASM and language data | No third-party CDN at runtime. Compatible with the strict CSP (`script-src 'self' 'wasm-unsafe-eval'`) | `scripts/copy-pdf-worker.mjs`, `index.html` CSP |
| Pure functions with injected parsers | The same extraction and detection code runs in the browser and in Node tests (real pdf.js, mammoth, Tesseract) | `src/lib/extract.ts` header comment, `tests/unit/*` |
| Evidence = exact character offsets | Every quote is re-verifiable (detection, server sync, backup restore, AI verification) | `detect.ts:35`, `app.ts:221-241`, `exportCase.ts:144`, `ai.ts:118` |
| Append-only audit | Each state change writes an event. On the server, DB triggers forbid edits | `services.ts:42-46`, `server/db.ts` |
| Fingerprint reconciliation | Re-analysis keeps review state. Findings that are no longer produced become `stale`, never deleted | `services.ts:229-298` |

> **Correction to the older notes.** `../ARCHITECTURE.md` says "Rules re-analysis never supersedes AI findings". The current code supersedes an AI finding (marks it `stale`) during a rules re-run when one of its source documents has been removed from the case (`services.ts:259-270`; covered by `tests/unit/sync.test.ts` "AI findings are superseded when a source document is removed"). Otherwise, AI findings are left untouched.
| Shared code between browser and server | `src/lib/types.ts`, `review.ts`, `ai.ts` are imported by `server/` | `server/app.ts:11-13` |
