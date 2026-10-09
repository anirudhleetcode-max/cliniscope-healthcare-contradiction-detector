# MEDGAURD architecture notes

> v1.1 adds OCR, an optional shared-workspace API server and AI-assisted reasoning; see the sections at the end.

## Data model (IndexedDB, `src/lib/db.ts`)

| Table | Key fields |
|---|---|
| `cases` | id, label, isDemo, createdAt, updatedAt, lastAnalyzedAt |
| `documents` | id, caseId, originalFilename, title, documentType, documentDate, uploadedAt, status, fileKind, extractionMethod, extractedText, pageCount, pageSpans, extractionErrors, extractionWarnings, contentHash, statementCount |
| `files` | id (= document id), caseId, blob. The original upload, stored separately from the derived text. |
| `statements` | ClinicalStatement: category, concept, originalText, polarity, value, unit, frequency, route, previousValue, temporality, status, eventDate, sourcePage, sourceSection, sourceLine, sourceParagraph, charStart, charEnd, extractionMethod, extractionConfidence |
| `findings` | fingerprint, category, title, findingType, statementIds, sourceDocumentIds, evidence[], explanation, comparisonReason, contextualCaveats, alternativeExplanations, evidenceQuality, reviewPriority, detectionMethod, reviewStatus, stale |
| `events` | append-only audit log: kind, at, actor, findingId?, documentId?, fromStatus?, toStatus?, reason?, note?, detail? |

## Processing statuses

`uploaded → extracting → extracted | needs_attention | failed → analyzing → analyzed`.
A document is marked `analyzed` only after the analysis transaction commits. If analysis fails, the previous status is restored and an `analysis_failed` event is written.

## Review state machine (`src/lib/review.ts`)

```
unreviewed → in_review
in_review  → confirmed | resolved* | dismissed*
confirmed  → resolved* | in_review*
resolved   → in_review*      (* reason of ≥ 5 characters required)
dismissed  → in_review*
```

## Re-analysis and reconciliation

The finding fingerprint is `hash(caseId | concept | sorted statementIds)`. Statement IDs are deterministic (`hash(case, document, offsets, concept)`). When a case is re-analyzed:

- A finding with the same fingerprint is updated in place and keeps its review status and history.
- A new fingerprint creates a new finding and a `finding_created` event.
- A finding that is no longer produced is marked `stale` (superseded) with a `finding_superseded` event. It is never deleted.

Concurrent analysis requests for the same case share one in-flight promise.

## OCR provenance (v1.1)

`DocumentRecord.pageSpans[i]` carries `method: 'text-layer' | 'ocr'` and `ocrConfidence` (Tesseract mean, 0-100).
`ocrRegions` lists the character spans produced by OCR. `ocrLowConfidence` lists every OCR word below 70% as `{start, end, confidence, text}`.

A statement whose quote lies in an OCR region gets these fields:
- `ocrDerived: true`, with confidence capped at *moderate*;
- `ocrMinConfidence`, the lowest flagged word inside the quote;
- `ocrLowConfidence: true` when such a word exists.

Detection rules for OCR-derived evidence:
- (a) Never rate evidence availability above *moderate* when a quote is OCR-derived.
- (b) Turn any explicit, potential or temporal finding touching a low-confidence word into *insufficient evidence*.
- (c) Report `valueUnreadable` medication statements (a unit without a number) as *insufficient evidence* instead of comparing values.

## Shared workspace sync model

- The **server is authoritative** for shared cases. The browser keeps a cache in IndexedDB (`CaseRecord.remote` marks such cases).
- **Upload and analysis** run in the browser: OCR, rules, and AI verification. Then `PUT /api/cases/:id/snapshot` sends documents, statements and findings. The server:
  - re-verifies every statement and evidence quote against the document text in the same request;
  - reconciles findings by fingerprint, keeping existing IDs and review status;
  - marks missing findings as superseded;
  - writes audit events.
  Original files are then uploaded to `PUT …/documents/:docId/file`.
- **Review actions** call `POST /api/findings/:id/transition`, which takes `expectedStatus` for optimistic concurrency, and `POST …/notes`. The response is the new snapshot, which replaces the cache.
- **Refresh** is a pull every 15 s and on window focus. It is skipped while local work is in progress, so unsynchronized uploads are not overwritten.
- **Authorization** is checked per request from `case_members`:
  - viewer: read;
  - reviewer: also sync, upload, transition and add notes;
  - owner: also manage members.
  Non-members receive 404.

## AI-assisted reasoning contract

`POST /api/ai/analyze` (authenticated, rate-limited) receives the case's extracted documents. The server calls the provider with structured output (`AiOutputSchema`), verifies the result with `verifyAiOutput()`, and returns the validated raw output plus a summary. The browser runs `verifyAiOutput()` again against its own document text, drops AI findings that only corroborate existing rules findings, and stores the rest as `origin: 'ai'` findings with status *unreviewed*. Rules re-analysis never supersedes AI findings.
