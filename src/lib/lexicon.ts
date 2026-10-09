// Deterministic vocabulary used by the rules-based statement extractor.
// Each entry maps a normalized concept key to the surface forms that are
// recognised in text. Matching is case-insensitive and on word boundaries.

export interface LexEntry {
  key: string;
  label: string;
  terms: string[];
}

export const ALLERGENS: LexEntry[] = [
  { key: 'penicillin', label: 'Penicillin', terms: ['penicillins', 'penicillin', 'pcn'] },
  { key: 'amoxicillin', label: 'Amoxicillin', terms: ['amoxicillin'] },
  { key: 'sulfonamide', label: 'Sulfa (sulfonamide)', terms: ['sulfonamides', 'sulfonamide', 'sulfamethoxazole', 'sulfa'] },
  { key: 'cephalosporin', label: 'Cephalosporins', terms: ['cephalosporins', 'cephalexin', 'cefazolin'] },
  { key: 'aspirin', label: 'Aspirin', terms: ['aspirin'] },
  { key: 'nsaid', label: 'NSAIDs', terms: ['nsaids', 'ibuprofen', 'naproxen'] },
  { key: 'codeine', label: 'Codeine', terms: ['codeine'] },
  { key: 'morphine', label: 'Morphine', terms: ['morphine'] },
  { key: 'erythromycin', label: 'Erythromycin', terms: ['erythromycin'] },
  { key: 'tetracycline', label: 'Tetracycline', terms: ['tetracycline', 'doxycycline'] },
  { key: 'iodinated-contrast', label: 'Iodinated contrast', terms: ['iodinated contrast', 'contrast dye', 'iodine'] },
  { key: 'latex', label: 'Latex', terms: ['latex'] },
  { key: 'peanut', label: 'Peanut', terms: ['peanuts', 'peanut'] },
  { key: 'shellfish', label: 'Shellfish', terms: ['shellfish'] },
];

export const MEDICATIONS: LexEntry[] = [
  { key: 'metformin', label: 'Metformin', terms: ['metformin', 'glucophage'] },
  { key: 'lisinopril', label: 'Lisinopril', terms: ['lisinopril'] },
  { key: 'atorvastatin', label: 'Atorvastatin', terms: ['atorvastatin', 'lipitor'] },
  { key: 'rosuvastatin', label: 'Rosuvastatin', terms: ['rosuvastatin'] },
  { key: 'simvastatin', label: 'Simvastatin', terms: ['simvastatin'] },
  { key: 'amlodipine', label: 'Amlodipine', terms: ['amlodipine'] },
  { key: 'aspirin', label: 'Aspirin', terms: ['aspirin'] },
  { key: 'insulin-glargine', label: 'Insulin glargine', terms: ['insulin glargine', 'lantus'] },
  { key: 'levothyroxine', label: 'Levothyroxine', terms: ['levothyroxine'] },
  { key: 'metoprolol', label: 'Metoprolol', terms: ['metoprolol succinate', 'metoprolol tartrate', 'metoprolol'] },
  { key: 'carvedilol', label: 'Carvedilol', terms: ['carvedilol'] },
  { key: 'omeprazole', label: 'Omeprazole', terms: ['omeprazole'] },
  { key: 'pantoprazole', label: 'Pantoprazole', terms: ['pantoprazole'] },
  { key: 'warfarin', label: 'Warfarin', terms: ['warfarin'] },
  { key: 'apixaban', label: 'Apixaban', terms: ['apixaban'] },
  { key: 'clopidogrel', label: 'Clopidogrel', terms: ['clopidogrel'] },
  { key: 'losartan', label: 'Losartan', terms: ['losartan'] },
  { key: 'hydrochlorothiazide', label: 'Hydrochlorothiazide', terms: ['hydrochlorothiazide', 'hctz'] },
  { key: 'furosemide', label: 'Furosemide', terms: ['furosemide'] },
  { key: 'spironolactone', label: 'Spironolactone', terms: ['spironolactone'] },
  { key: 'empagliflozin', label: 'Empagliflozin', terms: ['empagliflozin'] },
  { key: 'gabapentin', label: 'Gabapentin', terms: ['gabapentin'] },
  { key: 'sertraline', label: 'Sertraline', terms: ['sertraline'] },
  { key: 'prednisone', label: 'Prednisone', terms: ['prednisone'] },
  { key: 'albuterol', label: 'Albuterol', terms: ['albuterol', 'salbutamol'] },
  { key: 'amoxicillin', label: 'Amoxicillin', terms: ['amoxicillin'] },
];

export const DIAGNOSES: LexEntry[] = [
  {
    key: 'diabetes-mellitus',
    label: 'Diabetes mellitus',
    terms: ['type 2 diabetes mellitus', 'type 2 diabetes', 'diabetes mellitus type 2', 'type ii diabetes', 't2dm', 'diabetes mellitus', 'diabetes'],
  },
  { key: 'hypertension', label: 'Hypertension', terms: ['hypertension', 'htn', 'high blood pressure'] },
  {
    key: 'chronic-kidney-disease',
    label: 'Chronic kidney disease',
    terms: ['chronic kidney disease', 'ckd', 'kidney disease', 'renal disease', 'renal insufficiency'],
  },
  { key: 'atrial-fibrillation', label: 'Atrial fibrillation', terms: ['atrial fibrillation', 'afib'] },
  { key: 'asthma', label: 'Asthma', terms: ['asthma'] },
  { key: 'copd', label: 'COPD', terms: ['chronic obstructive pulmonary disease', 'copd'] },
  { key: 'heart-failure', label: 'Heart failure', terms: ['congestive heart failure', 'heart failure', 'chf'] },
  { key: 'hypothyroidism', label: 'Hypothyroidism', terms: ['hypothyroidism'] },
  { key: 'hyperlipidemia', label: 'Hyperlipidemia', terms: ['hyperlipidemia', 'dyslipidemia', 'high cholesterol'] },
  { key: 'coronary-artery-disease', label: 'Coronary artery disease', terms: ['coronary artery disease'] },
  { key: 'depression', label: 'Depression', terms: ['major depressive disorder', 'depression'] },
  { key: 'gerd', label: 'GERD', terms: ['gastroesophageal reflux disease', 'gerd'] },
  { key: 'pneumonia', label: 'Pneumonia', terms: ['community-acquired pneumonia', 'pneumonia'] },
  { key: 'stroke', label: 'Stroke', terms: ['stroke', 'cerebrovascular accident'] },
];

export interface LabEntry extends LexEntry {
  defaultUnit: string;
}

export const LABS: LabEntry[] = [
  { key: 'hba1c', label: 'HbA1c', terms: ['hemoglobin a1c', 'haemoglobin a1c', 'glycated hemoglobin', 'hba1c', 'a1c', 'hbalc' /* common OCR confusion of 1 and l */], defaultUnit: '%' },
  { key: 'creatinine', label: 'Creatinine', terms: ['serum creatinine', 'creatinine'], defaultUnit: 'mg/dL' },
  { key: 'egfr', label: 'eGFR', terms: ['egfr'], defaultUnit: 'mL/min/1.73m2' },
  { key: 'potassium', label: 'Potassium', terms: ['potassium'], defaultUnit: 'mmol/L' },
  { key: 'sodium', label: 'Sodium', terms: ['sodium'], defaultUnit: 'mmol/L' },
  { key: 'glucose', label: 'Glucose', terms: ['fasting glucose', 'blood glucose', 'glucose'], defaultUnit: 'mg/dL' },
  { key: 'hemoglobin', label: 'Hemoglobin', terms: ['hemoglobin', 'haemoglobin', 'hgb'], defaultUnit: 'g/dL' },
  { key: 'ldl', label: 'LDL cholesterol', terms: ['ldl cholesterol', 'ldl-c', 'ldl'], defaultUnit: 'mg/dL' },
  { key: 'tsh', label: 'TSH', terms: ['tsh'], defaultUnit: 'mIU/L' },
  { key: 'inr', label: 'INR', terms: ['inr'], defaultUnit: '' },
];

export const PROCEDURES: LexEntry[] = [
  { key: 'appendectomy', label: 'Appendectomy', terms: ['appendectomy'] },
  { key: 'cholecystectomy', label: 'Cholecystectomy', terms: ['laparoscopic cholecystectomy', 'cholecystectomy'] },
  { key: 'cabg', label: 'Coronary artery bypass graft', terms: ['coronary artery bypass graft', 'cabg'] },
  { key: 'knee-replacement', label: 'Knee replacement', terms: ['total knee replacement', 'knee replacement', 'knee arthroplasty'] },
  { key: 'hysterectomy', label: 'Hysterectomy', terms: ['hysterectomy'] },
  { key: 'pci', label: 'Coronary stent / PCI', terms: ['percutaneous coronary intervention', 'coronary stent'] },
  { key: 'colonoscopy', label: 'Colonoscopy', terms: ['colonoscopy'] },
];

/** Section headings recognised in documents, mapped to the category they imply. */
export const SECTION_HINTS: { pattern: RegExp; hint: SectionHint }[] = [
  { pattern: /^(drug\s+)?allerg(y|ies)(\s*(\/|and)\s*(adverse\s+)?(reactions|intolerances))?$|^adverse (drug )?reactions$/i, hint: 'allergy' },
  { pattern: /medication|prescri|drug list|current meds|home meds/i, hint: 'medication' },
  { pattern: /family history/i, hint: 'family' },
  { pattern: /social history|lifestyle|tobacco|smoking/i, hint: 'social' },
  { pattern: /surgical history|procedures?|operations?/i, hint: 'procedure' },
  { pattern: /lab|result|investigation|chemistry|panel/i, hint: 'lab' },
  { pattern: /diagnos|problem list|assessment|impression|medical history|past history|history|conditions/i, hint: 'diagnosis' },
];

export type SectionHint = 'allergy' | 'medication' | 'family' | 'social' | 'procedure' | 'lab' | 'diagnosis' | 'none';

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a single alternation regex with longest terms first so "type 2 diabetes" wins over "diabetes". */
export function buildMatcher(entries: LexEntry[]): { re: RegExp; lookup: Map<string, LexEntry> } {
  const lookup = new Map<string, LexEntry>();
  const terms: string[] = [];
  for (const e of entries) for (const t of e.terms) {
    lookup.set(t.toLowerCase(), e);
    terms.push(t);
  }
  terms.sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${terms.map(escapeRe).join('|')})\\b`, 'gi');
  return { re, lookup };
}
