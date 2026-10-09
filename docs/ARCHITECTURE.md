# CLINISCOPE architecture notes

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
