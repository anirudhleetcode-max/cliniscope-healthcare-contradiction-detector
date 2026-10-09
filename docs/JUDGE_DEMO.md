# MEDGAURD — three-minute judge demonstration

> The current screen-by-screen script for the redesigned workspace is [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md). This page keeps the offline preparation and backup instructions; where it says *Review queue*, findings are now listed under **Contradictions**, and the case-level buttons (Analyze, Export) are on the case workspace.

Runs entirely in **local mode**: no server, login, API key or AI service. Every record is synthetic.

## Before the session (5 minutes)
1. Open the live app (or `npm run build && npm run preview`) **once while online**. Leave it open for about 30 seconds so the service worker caches the OCR engine. After that the demo works with Wi-Fi off.
2. Go to **About & settings**:
   - click **Reset Demonstration** → confirm, so the case starts unreviewed;
   - check the **Application status** card: *Local demo mode*, *IndexedDB working*, and *AI: Unavailable — no server configured* (this is expected and honest);
   - optionally click **Run OCR self-test**.
3. **Backup plan:**
   - If anything breaks, click **Reset Demonstration**, which rebuilds the case from the bundled files.
   - If extraction itself fails on the demo machine, restore a known-good backup: before the session, click **Analyze documents** → Overview → **Full backup** and keep the `.json` file. On the day, use **Cases → Restore from backup**; it opens as a new case with the findings already there.
   - Keep screenshots of the queue and of one finding as a last resort.

## 0:00 – 0:20 · The problem
"Medical records disagree: discharge summaries, intake forms, medication lists, lab reports and scanned letters. Checking them by hand is slow and error-prone. MEDGAURD flags *potential* contradictions, shows exactly where each statement came from, and leaves the decision to a professional."

## 0:20 – 0:45 · Records, including a scan
1. **Document library**: five records in five formats.
2. Type `scan` in the search box: *Discharge Letter (scanned copy)* with an **OCR** chip. Clear the search.
3. Open the letter, show `OCR · mean confidence`, then **Open original PDF** (the stored, unmodified file).

## 0:45 – 1:30 · Detection with traceable evidence
1. **Overview → Analyze documents**. The tiles now read *10 potential findings*, all awaiting review, and every count comes from the stored data.
2. **Review queue** → **Penicillin allergy** (allergy contradiction):
   - side A is the discharge summary, *page 2 verified*, plus the OCR'd scan;
   - side B reads *"No known drug allergies."*
   - Click **View in source** to show the highlighted passage.
3. Back → **Aspirin listed as active after a documented discontinuation** (medication status): the discharge summary says discontinued on 12 Mar, while the 14 Mar medication list still lists it.
4. **Date of birth differs** (demographic): 14 Feb 1961 vs 4 Feb 1961.

"The system never says which record is right."

## 1:30 – 1:55 · Context and uncertainty
- **Lisinopril 10 → 20 mg**: *historical / contextual difference*, because the later record documents the increase.
- **Atorvastatin**: the dose on the scan is unreadable, so it is *insufficient evidence*; the value is never guessed.
- Agreeing statements (diabetes, hypertension, creatinine) are **not** flagged.

## 1:55 – 2:30 · Human review
1. On the penicillin finding:
   - **Begin review** → add a note;
   - **Mark as resolved** with an empty reason, and show that it is rejected;
   - enter a reason and confirm.
2. Show the **review history** on the finding.
3. Reload the page: the decision is still there (IndexedDB).
4. The Overview tiles update: *Awaiting review 9*, *Dismissed / resolved 1*.

## 2:30 – 2:50 · Export and offline
1. **Overview → Export & backup**: **Case report (JSON)** and **Findings (CSV)**. Both are labelled SYNTHETIC and include quotes, decisions and history.
2. Optional: turn Wi-Fi off and reload; the app still works.

## 2:50 – 3:00 · Close
"Evidence for every flag, OCR for scanned records, deterministic and explainable rules, decisions made by people with a full history. It runs offline with nothing to install or pay for. AI and multi-user sync exist as optional server features, but they are not used in this demo. Research prototype, synthetic data, not for clinical use."

---

### Optional: shared workspace / AI (only with a running server)
See README → *Running locally*. Use two **separate browser profiles** for two reviewers. Never present local mode as multi-user, and never show AI as working unless the status panel reports a configured provider.
