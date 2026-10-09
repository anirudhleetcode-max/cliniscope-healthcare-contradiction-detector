// Fictional, synthetic demonstration records. NOT REAL PATIENT DATA.
// These texts are rendered into real PDF / DOCX / TXT files by
// generate-demo-documents.mjs and are then processed by the same
// ingestion + analysis pipeline as any uploaded file.

export const BANNER = 'DEMO CASE — SYNTHETIC DATA — NOT A REAL PATIENT';

export const DISCHARGE_SUMMARY_PAGES = [
  [
    BANNER,
    'NORTHFIELD GENERAL (FICTIONAL) — DISCHARGE SUMMARY',
    'Patient: Synthetic Patient SP-0042',
    'Date of birth: 14 February 1961',
    'Admission date: 8 March 2026',
    'Discharge date: 12 March 2026',
    '',
    'DIAGNOSES',
    'Community-acquired pneumonia, treated and resolved.',
    'Type 2 diabetes mellitus.',
    'Hypertension.',
    'Chronic kidney disease stage 3a.',
    '',
    'HOSPITAL COURSE',
    'Admitted with fever and productive cough. Treated with intravenous antibiotics and improved.',
    'Admission labs (11 March 2026): potassium 5.4 mmol/L, creatinine 1.4 mg/dL.',
    'Most recent HbA1c 8.2% in December 2025.',
  ],
  [
    BANNER,
    'DISCHARGE SUMMARY — PAGE 2',
    '',
    'ALLERGIES',
    'Penicillin allergy documented.',
    'Reaction recorded as urticarial rash.',
    '',
    'DISCHARGE MEDICATIONS',
    'Metformin 500 mg twice daily by mouth.',
    'Lisinopril 10 mg once daily.',
    'Atorvastatin 20 mg at night.',
    'Aspirin 81 mg once daily discontinued on admission.',
    '',
    'SOCIAL HISTORY',
    'Former smoker, quit in 2015.',
    '',
    'FAMILY HISTORY',
    'Mother with type 2 diabetes. Father with hypertension.',
    '',
    'FOLLOW-UP',
    'Medication reconciliation with primary care within one week.',
  ],
];

export const INTAKE_FORM_PARAGRAPHS = [
  BANNER,
  'Patient Intake Form (fictional community clinic)',
  'Patient: Synthetic Patient SP-0042',
  'Date of birth: 14 February 1961',
  'Visit date: 15 March 2026',
  'Allergies: No known drug allergies.',
  'Current medications (patient reported):',
  'Metformin 1000 mg twice daily.',
  'Atorvastatin 20 mg at night.',
  'Medical history: Type 2 diabetes, high blood pressure.',
  'No history of kidney disease.',
  'Surgical history: Appendectomy in 2004.',
  'Smoking status: Never smoker.',
  'Family history: Father had a stroke.',
];

export const MED_REC_TEXT = `${BANNER}
MEDICATION RECONCILIATION RECORD (fictional pharmacy service)
Patient: Synthetic Patient SP-0042
Date of birth: 4 February 1961
Reconciliation date: 14 March 2026
Reconciled by: Demo pharmacist (synthetic identity)

ALLERGIES / INTOLERANCES
- Penicillin - hives (per discharge summary).
- Possible reaction to sulfa antibiotics as a child, patient unsure, not verified.

ACTIVE MEDICATIONS
1. Metformin 500 mg twice daily by mouth with meals.
2. Lisinopril 20 mg once daily (increased from 10 mg on 13 March 2026 by primary care).
3. Atorvastatin 20 mg at night.
4. Aspirin 81 mg once daily.

INDICATIONS ON FILE
Type 2 diabetes mellitus; hypertension.
`;

export const LAB_REPORT_LINES = [
  BANNER,
  'LABORATORY REPORT (fictional laboratory)',
  'Patient: Synthetic Patient SP-0042',
  'Specimen collected: 11 March 2026 07:40',
  'Report date: 11 March 2026',
  '',
  'CHEMISTRY PANEL',
  'Sodium 139 mmol/L (reference 135-145)',
  'Potassium 4.4 mmol/L (reference 3.5-5.1)',
  'Creatinine 1.4 mg/dL (reference 0.6-1.2)',
  'eGFR 52 mL/min/1.73m2',
  'HbA1c 7.4 % (reference below 5.7)',
  '',
  'Results are fictional and for demonstration only.',
];

// Extra sample file a judge can upload to watch new findings appear.
export const FOLLOW_UP_NOTE_TEXT = `${BANNER}
PRIMARY CARE FOLLOW-UP NOTE (fictional)
Patient: Synthetic Patient SP-0042
Visit date: 20 March 2026

CURRENT MEDICATIONS
Metformin 500 mg twice daily.
Lisinopril 20 mg once daily.
Atorvastatin 40 mg at night.

ALLERGIES
Penicillin allergy confirmed with patient today (hives in 2019).

SOCIAL HISTORY
Current smoker, smokes 5 cigarettes per day.
`;

export const DEMO_MANIFEST = [
  { file: 'discharge-summary-2026-03-12.pdf', title: 'Discharge Summary', documentType: 'discharge_summary', documentDate: '2026-03-12', mime: 'application/pdf' },
  { file: 'patient-intake-form-2026-03-15.docx', title: 'Patient Intake Form', documentType: 'intake_form', documentDate: '2026-03-15', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { file: 'medication-reconciliation-2026-03-14.txt', title: 'Medication Reconciliation Record', documentType: 'medication_reconciliation', documentDate: '2026-03-14', mime: 'text/plain' },
  { file: 'laboratory-report-2026-03-11.pdf', title: 'Laboratory Report', documentType: 'lab_report', documentDate: '2026-03-11', mime: 'application/pdf' },
  { file: 'scanned-discharge-letter-2025-11-20.pdf', title: 'Discharge Letter (scanned copy)', documentType: 'discharge_summary', documentDate: '2025-11-20', mime: 'application/pdf' },
];

export const FICTION_NOTICE = 'Fictional demonstration data. Not for clinical use.';

// Rendered to an IMAGE and embedded in a PDF with no text layer, so it can
// only be read through OCR. The atorvastatin dose is deliberately smudged to
// produce an ambiguous OCR value.
export const SCANNED_DISCHARGE_LINES = [
  BANNER,
  FICTION_NOTICE,
  'RIVERSIDE CLINIC (FICTIONAL) - DISCHARGE LETTER',
  'Scanned copy of previous admission',
  'Patient: Synthetic Patient SP-0042',
  'Discharge date: 20 November 2025',
  '',
  'DIAGNOSES',
  'Type 2 diabetes mellitus.',
  'Hypertension.',
  '',
  'ALLERGIES',
  'Penicillin allergy - urticaria.',
  '',
  'MEDICATIONS ON DISCHARGE',
  'Metformin 500 mg twice daily.',
  'Atorvastatin {SMUDGE:20} mg at night.',
  '',
  'LABORATORY RESULTS',
  'Potassium 4.2 mmol/L (18 November 2025).',
  'HbA1c 8.6% (18 November 2025).',
];

// Sample for the upload demo: page 1 has a text layer, page 2 is a scan.
export const MIXED_PAGE1_LINES = [
  BANNER,
  'CARDIOLOGY CLINIC NOTE (FICTIONAL) - PAGE 1 (DIGITAL)',
  'Patient: Synthetic Patient SP-0042',
  'Visit date: 22 March 2026',
  '',
  'CURRENT MEDICATIONS',
  'Lisinopril 20 mg once daily.',
  'Metformin 500 mg twice daily.',
];
export const MIXED_PAGE2_LINES = [
  BANNER,
  'CARDIOLOGY CLINIC NOTE - PAGE 2 (SCANNED ATTACHMENT)',
  '',
  'ALLERGIES',
  'No known drug allergies.',
  '',
  'SOCIAL HISTORY',
  'Never smoker.',
];

