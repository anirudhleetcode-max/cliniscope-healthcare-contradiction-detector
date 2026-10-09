// Deterministic, rules-based clinical statement extraction.
// No machine-learning model is used here: every statement is produced by a
// transparent pattern rule, and every statement's originalText is an exact
// slice of the extracted document text (charStart..charEnd).
import { findDate } from './dates';
import { lineForOffset, pageForOffset, paragraphForOffset } from './extract';
import {
  ALLERGENS, DIAGNOSES, LABS, MEDICATIONS, PROCEDURES, SECTION_HINTS, buildMatcher,
  type LabEntry, type SectionHint,
} from './lexicon';
import type { Category, ClinicalStatement, DocumentRecord, Polarity, StatementStatus, Temporality } from './types';

export interface Segment {
  start: number;
  end: number;
  text: string;
  section: string | null;
  hint: SectionHint;
}

const ALLERGEN_M = buildMatcher(ALLERGENS);
const MED_M = buildMatcher(MEDICATIONS);
const DX_M = buildMatcher(DIAGNOSES);
const LAB_M = buildMatcher(LABS);
const PROC_M = buildMatcher(PROCEDURES);

/** FNV-1a based short deterministic hash (hex). */
export function hashId(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function classifyHeading(heading: string): SectionHint {
  const h = heading.trim();
  for (const s of SECTION_HINTS) if (s.pattern.test(h)) return s.hint;
  return 'none';
}

/**
 * Splits text into sentence-like segments with exact offsets and tracks the
 * section heading each segment falls under (only when a heading is genuinely
 * present in the text).
 */
export function segment(text: string): Segment[] {
  const out: Segment[] = [];
  let section: string | null = null;
  let hint: SectionHint = 'none';
  const lineRe = /[^\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(text))) {
    if (m[0].length === 0) {
      lineRe.lastIndex++;
      if (lineRe.lastIndex > text.length) break;
      continue;
    }
    const lineStart = m.index;
    const line = m[0];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Stand-alone heading: "ALLERGIES", "Current Medications:"
    const isColonHeading = /^[A-Za-z][A-Za-z0-9 /&()'-]{1,48}:$/.test(trimmed);
    const isCapsHeading = /^[A-Z][A-Z0-9 /&()'-]{2,48}$/.test(trimmed) && /[A-Z]{3}/.test(trimmed);
    if (isColonHeading || isCapsHeading) {
      section = trimmed.replace(/:$/, '').trim();
      hint = classifyHeading(section);
      continue;
    }

    // Inline heading: "Allergies: No known drug allergies."
    let segSection = section;
    let segHint = hint;
    let bodyOffset = 0;
    const inline = /^\s*([A-Za-z][A-Za-z /&()-]{2,40}):\s+(?=\S)/.exec(line);
    if (inline) {
      const h = classifyHeading(inline[1]);
      if (h !== 'none') {
        segSection = inline[1].trim();
        segHint = h;
        bodyOffset = inline[0].length;
        // An inline heading also opens a section for following lines.
        section = segSection;
        hint = h;
      }
    }

    // Split the line body into sentences on ". " / "; " boundaries.
    const body = line.slice(bodyOffset);
    const splitRe = /[^;]+?(?:\.(?=\s+[A-Z(])|;|$)/g;
    let s: RegExpExecArray | null;
    while ((s = splitRe.exec(body))) {
      if (s[0].length === 0) {
        splitRe.lastIndex++;
        if (splitRe.lastIndex > body.length) break;
        continue;
      }
      let a = lineStart + bodyOffset + s.index;
      let b = a + s[0].length;
      // Trim bullets / numbering / whitespace / trailing semicolons from the span.
      const lead = /^[\s\-•*·]*(\d+[.)]\s+)?/.exec(text.slice(a, b));
      if (lead) a += lead[0].length;
      while (b > a && /[\s;]/.test(text[b - 1])) b--;
      if (b - a < 3) continue;
      out.push({ start: a, end: b, text: text.slice(a, b), section: segSection, hint: segHint });
    }
  }
  return out;
}

const NKDA_RE = /\b(no known (drug |medication )?allerg(y|ies)|nkda|nka|no (drug |medication )?allergies|denies (any )?(known )?(drug |medication )?allerg(y|ies)|allergies:\s*none|none known)\b/i;
const UNCERTAIN_RE = /\b(possible|possibly|suspected|unclear|unsure|uncertain|unknown|unverified|not verified|not confirmed|questionable|probable|query|rule out|r\/o)\b|\?/i;
const ALLERGY_HISTORICAL_RE = /\b(as a child|childhood|outgrown|no longer|resolved|tolerated .* since|previously)\b/i;
const NEGATION_BEFORE_RE = /\b(no|not|denies|denied|negative for|without|ruled out|free of|never)\b[^.;]{0,40}$/i;
const DX_HISTORICAL_RE = /\b(history of|h\/o|previous|prior|past|remote|resolved|treated in \d{4})\b/i;
const DX_RESOLVED_RE = /\b(resolved|treated and resolved|in remission|no longer)\b/i;
const FAMILY_RE = /\b(mother|father|sister|brother|sibling|grandmother|grandfather|family history|fhx|aunt|uncle)\b/i;
const MED_DISCONTINUED_RE = /\b(discontinued|stopped|ceased|held|no longer taking|d\/c'?d|was taken off)\b/i;
const MED_CHANGE_RE = /\b(increased|decreased|reduced|changed|titrated|adjusted|uptitrated)\b[^.;]*?\bfrom\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g)\b/i;
const DOSE_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|units?|iu|ml)\b/i;
const ROUTE_RE = /\b(po|by mouth|orally|oral|iv|intravenous(?:ly)?|sc|subcutaneous(?:ly)?|inhaled|topical(?:ly)?)\b/i;

const FREQUENCIES: [RegExp, string][] = [
  [/\b(twice (a )?daily|twice a day|bid|b\.i\.d\.?|every 12 hours|q12h)\b/i, 'twice daily'],
  [/\b(three times (a )?daily|three times a day|tid|t\.i\.d\.?|every 8 hours|q8h)\b/i, 'three times daily'],
  [/\b(four times (a )?daily|qid|q\.i\.d\.?|every 6 hours|q6h)\b/i, 'four times daily'],
  [/\b(at night|nightly|at bedtime|qhs|every evening|in the evening)\b/i, 'once daily (evening)'],
  [/\b(once (a )?daily|once a day|daily|qd|q\.d\.?|every morning|each morning|in the morning)\b/i, 'once daily'],
  [/\b(weekly|once a week)\b/i, 'weekly'],
  [/\b(as needed|prn|p\.r\.n\.?)\b/i, 'as needed'],
];

function frequencyOf(s: string): string | null {
  for (const [re, label] of FREQUENCIES) if (re.test(s)) return label;
  return null;
}

function normalizeRoute(r: string | null): string | null {
  if (!r) return null;
  const x = r.toLowerCase();
  if (['po', 'by mouth', 'orally', 'oral'].includes(x)) return 'oral';
  if (x.startsWith('iv') || x.startsWith('intravenous')) return 'intravenous';
  if (x === 'sc' || x.startsWith('subcutaneous')) return 'subcutaneous';
  if (x.startsWith('topical')) return 'topical';
  return x;
}

/** Converts a mass dose to mg so 1 g and 1000 mg compare equal. Returns null for non-mass units. */
export function doseToMg(value: number, unit: string | null): number | null {
  if (!unit) return null;
  const u = unit.toLowerCase();
  if (u === 'mg') return value;
  if (u === 'g') return value * 1000;
  if (u === 'mcg' || u === 'µg') return value / 1000;
  return null;
}

interface Draft {
  category: Category;
  concept: string;
  conceptLabel: string;
  polarity: Polarity;
  value?: string | null;
  numericValue?: number | null;
  unit?: string | null;
  frequency?: string | null;
  route?: string | null;
  previousValue?: number | null;
  temporality: Temporality;
  status: StatementStatus;
  eventDate?: string | null;
  confidence: 'high' | 'moderate' | 'low';
}

function negatedBefore(seg: string, termIndex: number): boolean {
  const before = seg.slice(Math.max(0, termIndex - 60), termIndex);
  if (/\bno longer\b[^.;]*$/i.test(before)) return false;
  return NEGATION_BEFORE_RE.test(before);
}

function extractAllergies(seg: Segment): Draft[] {
  const t = seg.text;
  const allergyContext = seg.hint === 'allergy' || /\b(allerg|nkda|nka|adverse reaction|intoleran|anaphyla)/i.test(t);
  if (!allergyContext) return [];
  const drafts: Draft[] = [];
  const uncertain = UNCERTAIN_RE.test(t);
  const historical = ALLERGY_HISTORICAL_RE.test(t);
  if (NKDA_RE.test(t)) {
    drafts.push({
      category: 'allergy', concept: 'allergy:any-drug', conceptLabel: 'Drug allergies (none reported)',
      polarity: 'negative', value: 'no known drug allergies', temporality: 'current',
      status: uncertain ? 'uncertain' : 'none', confidence: uncertain ? 'low' : 'high',
    });
    return drafts;
  }
  const seen = new Set<string>();
  ALLERGEN_M.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALLERGEN_M.re.exec(t))) {
    const e = ALLERGEN_M.lookup.get(m[1].toLowerCase())!;
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    const negative = negatedBefore(t, m.index);
    drafts.push({
      category: 'allergy', concept: `allergy:${e.key}`, conceptLabel: e.label,
      polarity: negative ? 'negative' : 'positive',
      value: negative ? `no ${e.label.toLowerCase()} allergy` : `${e.label.toLowerCase()} allergy`,
      temporality: historical ? 'historical' : 'current',
      status: uncertain ? 'uncertain' : historical ? 'resolved' : 'active',
      confidence: uncertain ? 'low' : seg.hint === 'allergy' ? 'high' : 'moderate',
    });
  }
  return drafts;
}

function extractMedications(seg: Segment): Draft[] {
  if (seg.hint === 'allergy' || /\ballerg/i.test(seg.text)) return [];
  const t = seg.text;
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  MED_M.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MED_M.re.exec(t))) {
    const e = MED_M.lookup.get(m[1].toLowerCase())!;
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    // Look at the text after the drug name up to the next drug mention.
    MED_M.re.lastIndex = m.index + m[0].length;
    const next = MED_M.re.exec(t);
    MED_M.re.lastIndex = m.index + m[0].length;
    const tail = t.slice(m.index + m[0].length, next ? next.index : undefined);
    const dose = DOSE_RE.exec(tail);
    const discontinued = MED_DISCONTINUED_RE.test(t);
    const change = MED_CHANGE_RE.exec(t);
    const negative = negatedBefore(t, m.index) && !discontinued;
    if (!dose && !discontinued && seg.hint !== 'medication') continue;
    const unit = dose ? dose[2].toLowerCase().replace(/^units?$/, 'units').replace('µg', 'mcg') : null;
    const num = dose ? parseFloat(dose[1]) : null;
    drafts.push({
      category: 'medication', concept: `medication:${e.key}`, conceptLabel: e.label,
      polarity: negative ? 'negative' : 'positive',
      value: dose ? `${dose[1]} ${unit}` : null,
      numericValue: num, unit,
      frequency: frequencyOf(tail),
      route: normalizeRoute(ROUTE_RE.exec(tail)?.[1] ?? null),
      previousValue: change ? doseToMg(parseFloat(change[2]), change[3]) : null,
      temporality: discontinued ? 'historical' : change ? 'changed' : 'current',
      status: discontinued ? 'discontinued' : 'active',
      eventDate: findDate(t),
      confidence: dose && seg.hint === 'medication' ? 'high' : dose ? 'moderate' : 'low',
    });
  }
  return drafts;
}

function extractDiagnoses(seg: Segment): Draft[] {
  if (seg.hint === 'allergy' || seg.hint === 'lab' || /\ballerg/i.test(seg.text)) return [];
  const t = seg.text;
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  DX_M.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DX_M.re.exec(t))) {
    const e = DX_M.lookup.get(m[1].toLowerCase())!;
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    // "Metformin for type 2 diabetes" in a medication list is not a diagnosis statement.
    if (seg.hint === 'medication' && !/\b(diagnos|history)/i.test(t)) continue;
    const negative = negatedBefore(t, m.index);
    const uncertain = UNCERTAIN_RE.test(t);
    const resolved = DX_RESOLVED_RE.test(t);
    const historical = DX_HISTORICAL_RE.test(t.slice(0, m.index + m[0].length + 30));
    drafts.push({
      category: 'diagnosis', concept: `diagnosis:${e.key}`, conceptLabel: e.label,
      polarity: negative ? 'negative' : 'positive',
      value: negative ? `no ${e.label.toLowerCase()}` : e.label.toLowerCase(),
      temporality: resolved || historical ? 'historical' : 'current',
      status: uncertain ? 'uncertain' : resolved ? 'resolved' : negative ? 'none' : 'active',
      eventDate: findDate(t),
      confidence: uncertain ? 'low' : seg.hint === 'diagnosis' ? 'high' : 'moderate',
    });
  }
  return drafts;
}

const LAB_VALUE_RE = /^[^\d\n]{0,24}?(\d+(?:\.\d+)?)\s*(%|mg\/dl|mmol\/l|µmol\/l|umol\/l|ml\/min\/1\.73\s?m(?:2|²)|ml\/min|g\/dl|g\/l|miu\/l|mu\/l)?/i;

function extractLabs(seg: Segment, specimenDate: string | null): Draft[] {
  if (seg.hint === 'allergy' || seg.hint === 'medication') return [];
  const t = seg.text;
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  LAB_M.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LAB_M.re.exec(t))) {
    const e = LAB_M.lookup.get(m[1].toLowerCase()) as LabEntry;
    if (seen.has(e.key)) continue;
    const tail = t.slice(m.index + m[0].length);
    const v = LAB_VALUE_RE.exec(tail);
    if (!v) continue;
    seen.add(e.key);
    const unit = v[2] ? v[2].replace(/\s/g, '').replace('²', '2') : null;
    drafts.push({
      category: 'lab', concept: `lab:${e.key}`, conceptLabel: e.label, polarity: 'positive',
      value: `${v[1]}${unit ? (unit === '%' ? '%' : ' ' + unit) : ''}`,
      numericValue: parseFloat(v[1]), unit,
      temporality: 'current', status: 'active',
      eventDate: findDate(t) ?? specimenDate,
      confidence: unit ? 'high' : 'moderate',
    });
  }
  return drafts;
}

const SMOKING: [RegExp, string][] = [
  [/\b(never smoker|never smoked|has never smoked|lifelong non-?smoker|non-?smoker|smoking status:\s*never|smok\w*:\s*(never|no|none))\b/i, 'never'],
  [/\b(former smoker|ex-?smoker|quit smoking|stopped smoking|smoking status:\s*former|smok\w*:\s*former)\b/i, 'former'],
  [/\b(current smoker|currently smokes|smokes \d+|active smoker|smoking status:\s*current|smok\w*:\s*(current|yes))\b/i, 'current'],
];

function extractOther(seg: Segment): Draft[] {
  for (const [re, value] of SMOKING) {
    if (re.test(seg.text)) {
      return [{
        category: 'other', concept: 'other:smoking-status', conceptLabel: 'Smoking status', polarity: 'positive',
        value, temporality: value === 'former' ? 'historical' : 'current', status: 'active',
        eventDate: findDate(seg.text), confidence: 'high',
      }];
    }
  }
  return [];
}

const NO_SURGERY_RE = /\b(no (prior |previous |past )?(surgeries|surgery|operations|surgical history|procedures)|denies (any )?(prior |previous )?surger(y|ies)|surgical history:\s*none)\b/i;

function extractProcedures(seg: Segment): Draft[] {
  const t = seg.text;
  if (NO_SURGERY_RE.test(t)) {
    return [{
      category: 'procedure', concept: 'procedure:any', conceptLabel: 'Prior surgical procedures (none reported)',
      polarity: 'negative', value: 'no prior surgery', temporality: 'historical', status: 'none', confidence: 'high',
    }];
  }
  const drafts: Draft[] = [];
  PROC_M.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROC_M.re.exec(t))) {
    const e = PROC_M.lookup.get(m[1].toLowerCase())!;
    const negative = negatedBefore(t, m.index);
    drafts.push({
      category: 'procedure', concept: `procedure:${e.key}`, conceptLabel: e.label,
      polarity: negative ? 'negative' : 'positive', value: e.label.toLowerCase(),
      temporality: 'historical', status: negative ? 'none' : 'resolved', eventDate: findDate(t),
      confidence: UNCERTAIN_RE.test(t) ? 'low' : 'moderate',
    });
  }
  return drafts;
}

/** Extracts structured clinical statements from one document's extracted text. */
export function extractStatements(doc: Pick<DocumentRecord, 'id' | 'caseId' | 'extractedText' | 'pageSpans' | 'fileKind'>): ClinicalStatement[] {
  const text = doc.extractedText;
  const segments = segment(text);
  const out: ClinicalStatement[] = [];
  const seen = new Set<string>();
  let specimenDate: string | null = null;
  for (const seg of segments) {
    if (seg.hint === 'family' || FAMILY_RE.test(seg.text)) continue; // not about the patient
    if (/\b(collected|specimen|sample (date|taken)|drawn)\b/i.test(seg.text)) {
      const d = findDate(seg.text);
      if (d) specimenDate = d;
    }
    const drafts = [
      ...extractAllergies(seg),
      ...extractMedications(seg),
      ...extractDiagnoses(seg),
      ...extractLabs(seg, seg.hint === 'lab' || specimenDate ? specimenDate : null),
      ...extractOther(seg),
      ...extractProcedures(seg),
    ];
    for (const d of drafts) {
      const id = 'st_' + hashId(`${doc.caseId}|${doc.id}|${seg.start}|${seg.end}|${d.concept}`);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        caseId: doc.caseId,
        documentId: doc.id,
        category: d.category,
        concept: d.concept,
        conceptLabel: d.conceptLabel,
        originalText: text.slice(seg.start, seg.end),
        subject: 'patient',
        polarity: d.polarity,
        value: d.value ?? null,
        numericValue: d.numericValue ?? null,
        unit: d.unit ?? null,
        frequency: d.frequency ?? null,
        route: d.route ?? null,
        previousValue: d.previousValue ?? null,
        temporality: d.temporality,
        status: d.status,
        eventDate: d.eventDate ?? null,
        sourcePage: doc.fileKind === 'pdf' ? pageForOffset(doc.pageSpans, seg.start) : null,
        sourceSection: seg.section,
        sourceLine: doc.fileKind === 'docx' ? null : lineForOffset(text, seg.start),
        sourceParagraph: doc.fileKind === 'docx' ? paragraphForOffset(text, seg.start) : null,
        charStart: seg.start,
        charEnd: seg.end,
        extractionMethod: 'deterministic-rules',
        extractionConfidence: d.confidence,
      });
    }
  }
  return out;
}
