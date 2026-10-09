# MEDGUARD — three-minute demonstration script

Everything runs in the browser with **synthetic data only**: no backend, login, API key or AI service.

**Before you present:**
1. Open the app once while online and wait about 30 seconds so the offline cache fills.
2. Go to **Settings → Reset Demonstration** so every case starts in its seeded state.
3. If anything goes wrong during the demo, run **Reset Demonstration** again. It rebuilds only the six synthetic cases.

## 0:00 – 0:20 · The problem
"Patient records disagree: discharge summaries, intake forms, pharmacy lists, lab reports and scanned letters. Finding those disagreements by hand is slow. MEDGUARD flags *potential* contradictions, links each one to the exact source sentence, and leaves the decision to a human reviewer. Everything you see is synthetic data."

## 0:20 – 0:45 · Dashboard
1. **Clinical Overview**: point at the **LOCAL DEMO** badge and the four metrics (cases reviewed, open contradictions, pending reviews, documents processed). Every number is counted from the stored records.
2. The callout says DEMO-0042 has *documents ready for analysis*. Click **Analyze documents**. The rules engine compares 44 statements and the metrics and category chart update live.
3. Point out the category chart and the review-status donut. Clicking a bar filters the contradictions.

## 0:45 – 1:15 · A case and its documents
1. Click **Open Demo Case**. The three-column workspace shows the case summary and documents on the left, evidence in the centre, and the decision panel on the right.
2. Select **Discharge Letter (scanned copy)** in the documents list: it is a scan read by on-device OCR. Its extracted text appears in the centre.
3. Press **Ctrl+K**, type `DEMO-0107` and press Enter to show global search across cases, findings and documents.

## 1:15 – 1:50 · A potential contradiction and its evidence
1. **Contradictions** → *Penicillin allergy documented in one record, absent in another*.
2. Source A quotes the discharge documents (including the OCR'd scan, with its confidence). Source B reads *"No known drug allergies."* Each card shows the document, date, section and a **verified** quote.
3. Click **View in source** to see the passage highlighted in the document text.
4. Point out the *Suggested review question* (a template, not advice) and the certainty note. "The system never says which record is right."

## 1:50 – 2:20 · Human decision
1. Open the **Review Queue** and select a pending item, for example *Warfarin listed as active after a documented discontinuation* (DEMO-0107).
2. Show the five outcomes: confirmed, not a contradiction, needs more information, temporal difference / expected change, unable to determine.
3. Choose **Temporal difference / expected change**, try to save without a reason (it is rejected), then enter a reason and save. Add a reviewer note.

## 2:20 – 2:40 · Everything updates
1. The item leaves the pending list.
2. **Overview**: *Pending Reviews* has gone down by one.
3. **Activity**, filtered to *Local actions*: the decision and note appear with timestamps, separate from the *seeded examples*.
4. Reload the page: the decision is still there (IndexedDB).

## 2:40 – 3:00 · Scope and next steps
"This is the frontend demonstration build: deterministic rules, on-device OCR, and local browser storage. The data layer sits behind a service boundary, and an optional shared-workspace server and an AI-assisted pass already exist in the repository but are not used here. Next steps are connecting that backend for multi-user review and validating the rules on real, consented data. MEDGUARD is not clinically validated and is not for clinical use."
