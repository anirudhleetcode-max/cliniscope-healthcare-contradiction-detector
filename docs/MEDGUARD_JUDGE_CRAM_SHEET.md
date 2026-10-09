---
title: "MEDGUARD — 30-Minute Judge Cram Sheet"
subtitle: "The short version of the 87-page dossier · PS-11R3 · Healthcare Record Contradiction Detector"
date: "9 October 2026 · includes the 16:20 UTC website update"
---

::: {.callout .key}
**How to use these 30 minutes**

1. **Minutes 0–5:** read §1 (the facts) and say the pitch in §2 out loud twice.
2. **Minutes 5–12:** §3 (how it works), §4 (the stack) and §5 (what makes it different).
3. **Minutes 12–15:** §6, the honesty rules. These protect you from the hardest questions.
4. **Minutes 15–27:** §7, the top 30 questions. Cover the answer, say it, then check.
5. **Minutes 27–30:** walk through the demo in §8 once.
:::

# 1 · The facts to memorise {#facts}

| | |
|---|---|
| **What it is** | Finds *possible* contradictions across a patient's documents, shows the exact source quote behind every flag, and leaves the decision to a human. |
| **Live website** | **<https://medguard-sigma.vercel.app/>**: public, no login, verified 9 Oct 2026. The GitHub Pages copy is still live as a mirror. |
| **Backend API** | <https://medguard-api-duti.onrender.com>: Render, free tier; sleeps after 15 idle minutes. |
| **Database** | PostgreSQL on **Neon** (free tier, Singapore). PGlite (embedded PostgreSQL) for local development and tests. |
| **Detection** | **Deterministic rules**, not AI. OCR (Tesseract) is the only neural part. An optional LLM layer exists but is **switched off**. |
| **Tests** | **106/106** Vitest · **25/25** Playwright · CI green · live two-user browser tests **3/3** passed. |
| **Vocabulary** | About 26 drugs · 14 allergens · 12 diagnoses · 10 labs · 7 procedures. |
| **Finding types (5)** | Explicit conflict · potential discrepancy · temporal inconsistency · historical/contextual difference · insufficient evidence. |
| **NOT done** | Accuracy (precision/recall) not measured · no clinical validation · no real users or hospitals · no compliance (HIPAA/GDPR/DPDP) · synthetic data only. |

::: {.callout .warn}
**Never say:** "medguard.vercel.app" (that name belongs to another Vercel account) · any accuracy % · "AI-powered detection" · "HIPAA compliant" · "used by hospitals".
:::

# 2 · The pitch (say it out loud) {#pitch}

> **One line:** "MEDGUARD finds possible contradictions across a patient's healthcare documents, shows the exact source quote behind every flag, and leaves the decision to a human reviewer."

> **30 seconds:** "Patient information is copied across discharge summaries, intake forms, medication lists and lab reports, and the copies don't always agree. One says penicillin allergy, another says no known drug allergies. MEDGUARD reads the documents, including scanned ones, compares the clinical statements and flags possible conflicts. Every flag shows the exact quote, page and date it came from, so a reviewer can verify it in seconds and record a decision. It doesn't diagnose and it doesn't decide who's right. It makes the disagreement visible and traceable."

# 3 · How it works (6 steps) {#how}

1. **Upload:** PDF, scanned PDF, PNG/JPEG, DOCX or TXT, grouped into a *case*. Files are checked for type, magic bytes, size and duplicates.
2. **Extract text in the browser:** pdf.js for PDFs, mammoth for Word, **Tesseract OCR** for scans (used when a page has fewer than 20 characters of text).
3. **Pull out statements:** rules find allergies, medications and doses, diagnoses, labs, procedures, smoking status and date of birth. Each keeps its **exact character offsets**.
4. **Compare across the case, with context:**
    * **Negation:** looks up to 40 characters back for "no", "denies", "ruled out".
    * **History and hedging:** "as a child", "possible, not verified". Family history is excluded.
    * **Documented changes:** "increased from 10 mg" becomes a contextual difference, not a conflict.
    * **Units and dates:** doses are normalised to mg (1 g = 1000 mg). Labs are compared **only when they share a specimen date**.
5. **Verify the evidence:** a finding exists **only if** its quotes exactly match the source at the stored offsets. OCR confidence below 70% downgrades a finding to *insufficient evidence*.
6. **Human review:** confirm, dismiss or ask for more information. A **reason is mandatory**. Every decision goes into an **append-only** history, and results can be exported.

**Two modes:**

* **Local (default):** everything runs in the browser and is stored in IndexedDB. Nothing leaves the laptop.
* **Shared workspace (optional):** a Node API with PostgreSQL, multiple reviewers, and per-case roles (owner, reviewer, viewer).

# 4 · The stack in one table {#stack}

| Layer | Technology | One-line reason |
|---|---|---|
| Frontend | React 18 · TypeScript · Vite · Tailwind | Builds to a static site that runs anywhere |
| In-browser processing | pdf.js · Tesseract.js · mammoth · zod | Extraction, OCR and validation on the device |
| Local storage | Dexie / IndexedDB (6 tables) | Works offline; no server needed |
| Backend | Node 22 built-in `http`, no framework | Few dependencies; shares TypeScript with the frontend |
| Database | PostgreSQL on Neon · PGlite locally | Transactions, row locks, and **triggers that make the audit log append-only** |
| Security | scrypt passwords · SHA-256 session tokens (8 h) · rate limits · CORS allow-list · CSP | Standard controls |
| Hosting | **Vercel** (frontend) · GitHub Pages (mirror) · Render + Docker (API) | Free tiers |
| CI/CD and tests | GitHub Actions · Vitest · Playwright | Tests on every push; live site re-tested after each deploy |
| Optional AI | `@anthropic-ai/sdk`: **off**; its output must pass the same quote check | Can't invent evidence |


# 5 · What makes it different {#different}

**Three things together:**

1. **Verified evidence:** no exact quote match means no finding. This applies to AI suggestions too.
2. **Typed contradictions with temporal context:** intentional changes and labs from different dates aren't flagged as conflicts.
3. **Accountable review:** a mandatory reason and an append-only audit trail. On top of that, it runs **fully in the browser**, OCR included.

**Closest competitors:**

* **DigitalOwl, Wisedocs:** record review with citations, aimed at insurance and legal work.
* **Solventum 360 Encompass CDI:** flags documentation issues for specialists to resolve.
* **DrFirst MedHx:** medication history from structured data, not documents.
* **Amazon Comprehend Medical, Microsoft Text Analytics for health:** clinical NLP that extracts entities but doesn't detect contradictions.
* **The real incumbent:** manual review.

**Be humble:** "Established products beat us on validated accuracy, scale, integration and certification. We're narrower: transparent rules, guaranteed evidence, a decision trail, and near-zero cost to try."

# 6 · Honesty rules (these win hard questions) {#honesty}

::: {.callout .note}
**The answer pattern:** "That hasn't been measured yet → here's how we'd measure it → until then we don't claim a number."
:::

| If asked about… | Say |
|---|---|
| Accuracy | "Not measured. We'd use an expert-labelled set and report precision, recall and F1 by category." |
| Is it AI? | "Detection is rule-based on purpose, for transparency. OCR is neural. An optional LLM layer exists, is evidence-checked, and is off." |
| Real users or hospitals | "None. It's a prototype on synthetic data." |
| Compliance or regulation | "No HIPAA, GDPR or DPDP claims. Technical controls exist, but no formal assessment has been done." |
| Would you use it on patients? | "No. I'd approve only a supervised evaluation on de-identified data with ethics approval." |
| Capacity or load | "Not load-tested. The most we've run is two simultaneous reviewers live." |
| "No findings" | "It means none were found by the available rules, never 'safe'." |
| Biggest risk | "That it isn't accurate enough on real records to save time. Everything else is solvable engineering." |

# 7 · Top 30 judge questions, short answers {#questions}

## Basics
**Q1. What is it?** It reads a patient's documents, digital or scanned, finds statements that disagree, and shows the exact quote behind each flag for a human to decide.

**Q2. Who needs it?** Pharmacists doing medication reconciliation, clinicians at admission and discharge, and documentation and quality reviewers. *(These are intended users; no user research has been done.)*

**Q3. Main use case?** Medication and allergy reconciliation. For example, a drug stopped in the discharge summary but active in the medication list.

**Q4. Status?** A working prototype, live on Vercel, with an optional shared workspace on Render + Neon. Tests pass. Not clinically validated.

**Q5. Biggest limitation?** Accuracy on real records is unknown, and the vocabulary is fixed.

**Q6. Why does it matter?** Medication reconciliation is a **Joint Commission National Patient Safety Goal (NPSG.03.06.01)**. Discrepancies at care transitions are a recognised safety issue.

**Q7. Inconsistency vs medical error?** An inconsistency means two records disagree. An error means something is clinically wrong. A dose change can be intentional. We flag the disagreement; a professional decides.

## Technical
**Q8. Why no backend framework?** Node's built-in `http` with zod keeps dependencies minimal, and it reuses the same TypeScript review logic as the browser.

**Q9. Why PostgreSQL?** Transactions, row locks, constraints and **triggers that enforce an append-only audit log**. We moved from SQLite because free hosts have no persistent disk.

**Q10. Where's the detection logic?** In the browser: `statements.ts` (extraction), `lexicon.ts` (vocabulary), `detect.ts` (comparison). The server re-verifies the quotes.

**Q11. What happens during a request?** CORS check → token looked up by SHA-256 hash → role check for the case → zod validation → transaction → audit event.

**Q12. How is a contradiction defined?** Two statements about the same concept in the same case that can't both be true: opposite polarity, different values, or a status mismatch.

**Q13. Negation?** It looks up to 40 characters back for cues. "No history of kidney disease" conflicts with "Chronic kidney disease".

**Q14. Units and dates?** Doses are normalised to mg. Labs are compared only when they share a specimen date. Ambiguous dates like 03/07 are deliberately not parsed.

**Q15. False positives?** Temporal and context rules reduce them, and reviewers dismiss with a reason. **The rate isn't measured.**

**Q16. False negatives?** That's the weak side of rules: anything outside the vocabulary is missed. Recall isn't measured.

**Q17. How would you evaluate it?** A few hundred labelled cases reviewed by two clinicians. Report precision, recall and F1, inter-reviewer agreement, and assisted vs manual review time.

**Q18. Deployment?** A push to the main branch triggers CI tests → build → deploy → re-test against the live site. The API is a Docker image on Render, with the Neon connection string stored as a secret.

## Security and privacy
**Q19. User isolation?** Every request checks the caller's role in that case. **Non-members get 404**, so they can't tell a case exists. Verified live.

**Q20. Error codes?** No token: 401. Not a member: 404. Wrong role: 403. Stale view: 409. Database down: 503.

**Q21. Secrets?** Kept only in Render's environment variables. The repository has placeholders; nothing secret is in the frontend.

**Q22. Uploads?** Treated as untrusted: type, magic-byte and size checks, pdf.js with eval disabled, text rendering only, strict CSP.

**Q23. Before real patient data?** A privacy assessment, data processing agreements, MFA/SSO, encryption at rest, retention rules, backups, monitoring, a penetration test, and governance approval.

## Market and scale
**Q24. Similar products?** In part: clinical NLP APIs extract entities, record-review tools cite sources, and CDI tools route issues. We haven't seen this exact combination. **We don't claim to be first.**

**Q25. What stops someone copying it?** Nothing technical; it's MIT-licensed. Defensibility would come from labelled data, validation and partnerships.

**Q26. Who pays?** Hospital pharmacy, quality or documentation departments. *That's a hypothesis; we haven't spoken to buyers.*

**Q27. First bottleneck?** The single free API instance and its 5-connection database pool. The API (Oregon) and database (Singapore) are in different regions, which adds latency.

**Q28. Scaling plan?** Paid always-on instances in the same region as the database, object storage for files, background job workers, a shared rate limiter, incremental sync.

**Q29. If the backend goes offline?** Local mode doesn't need it. Shared mode keeps your work, shows "unsynced changes", pauses polling and offers Retry sync.

**Q30. In five years?** If evaluation supports it: FHIR integration, standard terminologies (RxNorm/SNOMED), rules plus evidence-checked LLMs, and hospital deployment. If not, it stays a research tool.

# 8 · The 2-minute demo {#demo}

::: {.callout .warn}
**Before you start:**

* Open the live site once ~30 s early so the OCR data caches.
* **Settings → Reset Demonstration.**
* Don't demo AI (it's off).
* Don't demo the shared workspace unless the API was woken a few minutes earlier.
:::

1. **Clinical Overview:** "Every number is counted from stored records."
2. **Analyze documents** on DEMO-0042: "It compares 44 statements across five documents."
3. **Open Demo Case** → *Discharge Letter (scanned copy)*: "Read by OCR in the browser; nothing left the laptop."
4. **Contradictions** → *Penicillin allergy*: "Each quote is re-checked against the source."
5. **View in source:** "One click to the original context."
6. **Review Queue** → *Warfarin listed as active after discontinuation* → save **without** a reason (rejected), then with one: "It never decides; it requires a reason."
7. **Activity**, then reload: "Append-only history, and it persists."

**If the site fails:** run the local build (`npm run build && npm run preview`). If that fails too, show screenshots and say the live deployment was verified by automated checks today.

**Closing line:** "Next, an expert-labelled evaluation to measure precision and recall, then terminology mapping and a supervised pilot on de-identified data."
