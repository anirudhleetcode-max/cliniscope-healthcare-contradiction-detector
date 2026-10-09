// Additional fictional, synthetic demonstration cases. NOT REAL PATIENT DATA.
//
// These plain-text records are ingested through the normal upload pipeline
// (validation → extraction → statement extraction) and analysed by the same
// deterministic rules as any uploaded file. No finding is hand-written: every
// finding shown for these cases is produced by the rules engine from the text
// below, and every quotation points at a character range in that text.
import type { DocumentType, ReviewStatus } from './types';

const BANNER = 'DEMO CASE — SYNTHETIC DATA — NOT A REAL PATIENT';

export interface DemoTextDoc {
  file: string;
  title: string;
  documentType: DocumentType;
  documentDate: string;
  text: string;
}

/** A review decision applied after seeding, so the workspace shows several review states. Clearly labelled as seeded. */
export interface SeededDecision {
  /** Concept key of the finding the decision applies to (e.g. "medication:warfarin"). */
  concept: string;
  /** Statuses applied in order; each step is a real, validated state-machine transition. */
  path: ReviewStatus[];
  reason?: string;
  note?: string;
}

export interface DemoCaseSpec {
  key: string;
  label: string;
  /** Short description of what the case demonstrates. */
  scenario: string;
  documents: DemoTextDoc[];
  decisions: SeededDecision[];
}

const lines = (...l: string[]) => [BANNER, ...l, '', 'Fictional record for demonstration only.'].join('\n');

export const EXTRA_DEMO_CASES: DemoCaseSpec[] = [
  {
    key: 'DEMO-0107',
    label: 'DEMO-0107 · Synthetic Patient SP-0107',
    scenario: 'Anticoagulant status, a documented allergy absent elsewhere, and a diagnosis recorded in one source and denied in another.',
    documents: [
      {
        file: 'cardiology-clinic-letter-2026-01-09.txt',
        title: 'Cardiology Clinic Letter',
        documentType: 'clinical_note',
        documentDate: '2026-01-09',
        text: lines(
          'CARDIOLOGY CLINIC LETTER (fictional outpatient service)',
          'Patient: Synthetic Patient SP-0107',
          'Clinic date: 9 January 2026',
          '',
          'DIAGNOSES',
          'Atrial fibrillation, paroxysmal.',
          'Hypertension.',
          '',
          'MEDICATIONS',
          'Warfarin discontinued on 9 January 2026; switched to apixaban.',
          'Apixaban 5 mg twice daily.',
          'Metoprolol 50 mg once daily.',
          '',
          'ALLERGIES',
          'Codeine allergy documented (nausea and vomiting).',
        ),
      },
      {
        file: 'emergency-triage-note-2026-02-21.txt',
        title: 'Emergency Department Triage Note',
        documentType: 'clinical_note',
        documentDate: '2026-02-21',
        text: lines(
          'EMERGENCY DEPARTMENT TRIAGE NOTE (fictional)',
          'Patient: Synthetic Patient SP-0107',
          'Attendance date: 21 February 2026',
          '',
          'ALLERGIES',
          'No known drug allergies.',
          '',
          'PAST MEDICAL HISTORY',
          'Hypertension.',
          'No history of atrial fibrillation.',
          '',
          'CURRENT MEDICATIONS',
          'Warfarin 5 mg once daily.',
          'Metoprolol 50 mg once daily.',
        ),
      },
      {
        file: 'pharmacy-medication-list-2026-02-24.txt',
        title: 'Community Pharmacy Medication List',
        documentType: 'medication_reconciliation',
        documentDate: '2026-02-24',
        text: lines(
          'COMMUNITY PHARMACY MEDICATION LIST (fictional)',
          'Patient: Synthetic Patient SP-0107',
          'List date: 24 February 2026',
          '',
          'ACTIVE MEDICATIONS',
          'Apixaban 5 mg twice daily.',
          'Metoprolol 50 mg once daily.',
        ),
      },
    ],
    decisions: [
      { concept: 'allergy:codeine', path: ['in_review', 'confirmed'], note: 'Seeded example: triage note records no known drug allergies while the clinic letter documents codeine intolerance.' },
      { concept: 'diagnosis:atrial-fibrillation', path: ['in_review'], note: 'Seeded example: awaiting the cardiology record for confirmation.' },
    ],
  },
  {
    key: 'DEMO-0118',
    label: 'DEMO-0118 · Synthetic Patient SP-0118',
    scenario: 'A documented dose change that is an expected, harmless temporal difference.',
    documents: [
      {
        file: 'endocrine-review-2025-11-04.txt',
        title: 'Endocrinology Review',
        documentType: 'clinical_note',
        documentDate: '2025-11-04',
        text: lines(
          'ENDOCRINOLOGY REVIEW (fictional)',
          'Patient: Synthetic Patient SP-0118',
          'Review date: 4 November 2025',
          '',
          'DIAGNOSES',
          'Hypothyroidism.',
          '',
          'MEDICATIONS',
          'Levothyroxine 50 mcg once daily.',
          '',
          'RESULTS',
          'TSH 6.8 mIU/L on 2 November 2025.',
        ),
      },
      {
        file: 'primary-care-note-2026-02-10.txt',
        title: 'Primary Care Note',
        documentType: 'clinical_note',
        documentDate: '2026-02-10',
        text: lines(
          'PRIMARY CARE NOTE (fictional)',
          'Patient: Synthetic Patient SP-0118',
          'Visit date: 10 February 2026',
          '',
          'PROBLEM LIST',
          'Hypothyroidism.',
          '',
          'MEDICATIONS',
          'Levothyroxine 75 mcg once daily (increased from 50 mcg on 12 November 2025).',
          '',
          'RESULTS',
          'TSH 2.1 mIU/L on 6 February 2026.',
        ),
      },
    ],
    decisions: [
      { concept: 'medication:levothyroxine', path: ['in_review', 'expected_change'], reason: 'Seeded example: the later note documents the dose increase, so the difference is an expected change, not a contradiction.' },
    ],
  },
  {
    key: 'DEMO-0125',
    label: 'DEMO-0125 · Synthetic Patient SP-0125',
    scenario: 'Missing and uncertain information: a dose that cannot be read and an unverified reaction.',
    documents: [
      {
        file: 'faxed-medication-summary-2026-03-02.txt',
        title: 'Faxed Medication Summary (transcribed)',
        documentType: 'medication_reconciliation',
        documentDate: '2026-03-02',
        text: lines(
          'FAXED MEDICATION SUMMARY — TRANSCRIBED (fictional)',
          'Patient: Synthetic Patient SP-0125',
          'Fax received: 2 March 2026',
          '',
          'MEDICATIONS',
          'Insulin glargine units at bedtime (dose illegible on fax).',
          'Empagliflozin 10 mg once daily.',
          '',
          'ALLERGIES',
          'Possible reaction to iodinated contrast in 2019, not verified.',
        ),
      },
      {
        file: 'endocrine-clinic-note-2026-03-05.txt',
        title: 'Endocrine Clinic Note',
        documentType: 'clinical_note',
        documentDate: '2026-03-05',
        text: lines(
          'ENDOCRINE CLINIC NOTE (fictional)',
          'Patient: Synthetic Patient SP-0125',
          'Clinic date: 5 March 2026',
          '',
          'DIAGNOSES',
          'Type 2 diabetes mellitus.',
          '',
          'MEDICATIONS',
          'Insulin glargine 18 units at bedtime.',
          'Empagliflozin 10 mg once daily.',
          '',
          'ALLERGIES',
          'No known allergies.',
        ),
      },
    ],
    decisions: [],
  },
  {
    key: 'DEMO-0131',
    label: 'DEMO-0131 · Synthetic Patient SP-0131',
    scenario: 'Conflicting dates: a day/month swap in the date of birth and two INR results for the same specimen date.',
    documents: [
      {
        file: 'anticoagulation-clinic-2026-01-15.txt',
        title: 'Anticoagulation Clinic Record',
        documentType: 'clinical_note',
        documentDate: '2026-01-15',
        text: lines(
          'ANTICOAGULATION CLINIC RECORD (fictional)',
          'Patient: Synthetic Patient SP-0131',
          'Date of birth: 7 March 1958',
          'Clinic date: 15 January 2026',
          '',
          'RESULTS',
          'INR 2.4 on 14 January 2026.',
          '',
          'MEDICATIONS',
          'Warfarin 3 mg once daily.',
        ),
      },
      {
        file: 'laboratory-report-2026-01-14.txt',
        title: 'Laboratory Report',
        documentType: 'lab_report',
        documentDate: '2026-01-14',
        text: lines(
          'LABORATORY REPORT (fictional laboratory)',
          'Patient: Synthetic Patient SP-0131',
          'Date of birth: 3 July 1958',
          'Specimen collected: 14 January 2026',
          '',
          'COAGULATION',
          'INR 3.1 (target range 2.0-3.0)',
        ),
      },
    ],
    decisions: [
      { concept: 'demographic:date-of-birth', path: ['in_review'], note: 'Seeded example: possible day/month transposition; registration record requested.' },
      { concept: 'lab:inr', path: ['in_review', 'undetermined'], reason: 'Seeded example: without the laboratory accession record it cannot be determined which result belongs to the 14 January specimen.' },
    ],
  },
  {
    key: 'DEMO-0144',
    label: 'DEMO-0144 · Synthetic Patient SP-0144',
    scenario: 'Clinical status: a diagnosis recorded in one record and denied in another, and two different diuretic doses.',
    documents: [
      {
        file: 'cardiac-outpatient-letter-2026-02-03.txt',
        title: 'Cardiac Outpatient Letter',
        documentType: 'clinical_note',
        documentDate: '2026-02-03',
        text: lines(
          'CARDIAC OUTPATIENT LETTER (fictional)',
          'Patient: Synthetic Patient SP-0144',
          'Clinic date: 3 February 2026',
          '',
          'DIAGNOSES',
          'Heart failure with reduced ejection fraction.',
          'Hypertension.',
          '',
          'MEDICATIONS',
          'Furosemide 40 mg once daily.',
          'Carvedilol 6.25 mg twice daily.',
        ),
      },
      {
        file: 'pre-operative-assessment-2026-02-12.txt',
        title: 'Pre-operative Assessment',
        documentType: 'intake_form',
        documentDate: '2026-02-12',
        text: lines(
          'PRE-OPERATIVE ASSESSMENT (fictional)',
          'Patient: Synthetic Patient SP-0144',
          'Assessment date: 12 February 2026',
          '',
          'MEDICAL HISTORY',
          'Hypertension.',
          'No history of heart failure.',
          '',
          'MEDICATIONS',
          'Furosemide 20 mg once daily.',
          'Carvedilol 6.25 mg twice daily.',
        ),
      },
    ],
    decisions: [
      { concept: 'diagnosis:heart-failure', path: ['in_review', 'confirmed'], note: 'Seeded example: pre-operative form disagrees with the specialist letter; flagged to the assessing team.' },
      { concept: 'medication:furosemide', path: ['in_review', 'needs_info'], note: 'Seeded example: dose may have changed between visits; awaiting the current prescription.' },
    ],
  },
];

export const SEEDED_REVIEWER = 'Seeded demo reviewer (synthetic)';
