# CLINISCOPE — three-minute judge demonstration

**Before the session:**
- Open the live app once so the demo case is seeded; OCR of the scanned letter takes a few seconds on first load.
- For the collaboration segment you need a running API server (see README → Running locally). Open two browser profiles, A and B, each signed in as a different account, with B added to a shared case by A.
- Skip the collaboration segment if no server is running. Never present local mode as multi-user.

## 0:00 – 0:20 · The problem
"Medical records disagree: discharge summaries, intake forms, medication lists, lab reports and scanned letters. Comparing them by hand is slow and error-prone. CLINISCOPE finds possible contradictions, shows exactly where each statement came from, and leaves the decision to a professional."

## 0:20 – 0:50 · Ingestion, including OCR
1. **Document library**: five fictional records. Point at the **OCR** chip on *Discharge Letter (scanned copy)*.
2. Open that letter:
   - the page marker shows `OCR · mean confidence ~94%`;
   - click **Compare OCR text with original** to show the scan beside its text.
3. Optional live upload: drag `sample-mixed-text-and-scan-2026-03-22.pdf`. The status shows *Running OCR on page 2* and the result says *OCR on page 2*.

## 0:50 – 1:30 · Evidence-first contradiction detection
1. Click **Analyze documents**. The summary shows statements, comparisons, consistent results, results explained by dates, and findings.
2. **Review queue** → *Penicillin allergy documented in one record, absent in another*.
3. Show side A (Discharge Summary, **page 2 verified**, section ALLERGIES, plus the **OCR text** card from the scan) against side B (*"No known drug allergies."*).
4. Click **View in source** to show the highlighted passage. "The system does not decide which record is right."

## 1:30 – 2:00 · Context and uncertainty
- **Metformin 500 vs 1000 mg**: a potential discrepancy; "no dose is called wrong".
- **Lisinopril 10 → 20 mg**: a *historical / contextual difference*, because the later record documents the increase.
- **Atorvastatin**: the dose on the scan is unreadable, so it is *insufficient evidence*. The value is never guessed.
- **AI panel** (Overview):
  - If a server with an API key is connected, run it, accept the consent dialog, and show an **AI-assisted** finding with verified quotes.
  - Otherwise say: "AI is optional and not configured here; the deterministic engine is fully functional." The panel states this honestly.

## 2:00 – 2:40 · Human review and collaboration (shared workspace only)
1. Profile A on the penicillin finding: **Begin review** → add a note → **Mark as resolved**.
2. Show that an empty reason is rejected, then enter a reason.
3. Profile B: **Cases → Open shared case** → the same finding shows *Resolved by reviewer*, the reason, the note and *Alice* in the audit history.
4. **Case timeline**: collaborator added, decisions, all with server timestamps.

For local mode only, use a page reload to show that the decision persists in the browser.

## 2:40 – 3:00 · Close
"Source-level evidence for every flag, OCR for scanned records with honest confidence, rules first with optional AI that is re-verified, human-controlled decisions, and an auditable shared workspace. A research prototype with synthetic data, not for clinical use."
