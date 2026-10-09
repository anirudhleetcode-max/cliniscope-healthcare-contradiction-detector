// Transparent, rules-based cross-document contradiction detection.
// Pipeline: group comparable statements (same case, same normalized concept)
// → compare polarity / values → weigh dates and temporality → classify →
// attach verified evidence → explain. No finding is created unless every
// evidence quotation can be re-located in the source document's text.
import { daysBetween, formatDate } from './dates';
import { doseToMg, hashId } from './statements';
import type {
  Category, ClinicalStatement, DocumentRecord, EvidenceQuality, EvidenceRef, Finding, FindingType,
  ReviewPriority,
} from './types';
import { CATEGORY_LABEL } from './types';

export const DETECTION_METHOD = 'Deterministic rules v1 (concept normalization + polarity/value/date comparison)';

export interface DraftFinding extends Omit<Finding, 'id' | 'reviewStatus' | 'stale' | 'createdAt' | 'updatedAt' | 'isSeededDemo'> {}

export interface DetectionResult {
  findings: DraftFinding[];
  comparisonsEvaluated: number;
  consistentComparisons: number;
  temporallyExplainedComparisons: number;
}

interface Ctx {
  caseId: string;
  docs: Map<string, DocumentRecord>;
  out: DraftFinding[];
  stats: { evaluated: number; consistent: number; temporal: number };
}

const SIGNIFICANT_CATEGORIES: Category[] = ['allergy', 'medication'];

/** Verifies that a statement's quote still exists at its offsets in the source document. */
export function verifyStatement(s: ClinicalStatement, doc: DocumentRecord | undefined): boolean {
  if (!doc || doc.caseId !== s.caseId) return false;
  return doc.extractedText.slice(s.charStart, s.charEnd) === s.originalText && s.originalText.length > 0;
}

function evidenceFor(s: ClinicalStatement, doc: DocumentRecord, side: 'A' | 'B'): EvidenceRef {
  return {
    statementId: s.id,
    documentId: doc.id,
    side,
    quote: s.originalText,
    charStart: s.charStart,
    charEnd: s.charEnd,
    page: s.sourcePage,
    section: s.sourceSection,
    line: s.sourceLine,
    paragraph: s.sourceParagraph,
    documentTitle: doc.title,
    documentDate: doc.documentDate,
    extractionMethod: doc.extractionMethod,
  };
}

function docDate(ctx: Ctx, s: ClinicalStatement): string | null {
  return ctx.docs.get(s.documentId)?.documentDate ?? null;
}

function latestDate(ctx: Ctx, list: ClinicalStatement[]): string | null {
  const ds = list.map((s) => docDate(ctx, s)).filter(Boolean) as string[];
  return ds.sort().pop() ?? null;
}

function docTitles(ctx: Ctx, list: ClinicalStatement[]): string {
  const titles = [...new Set(list.map((s) => ctx.docs.get(s.documentId)?.title ?? 'Unknown document'))];
  return titles.join(', ');
}

function quality(ctx: Ctx, all: ClinicalStatement[], type: FindingType): { q: EvidenceQuality; reason: string } {
  const docs = all.map((s) => ctx.docs.get(s.documentId)!);
  if (type === 'insufficient_evidence') {
    return {
      q: 'limited',
      reason: 'Quotes were located in the source text, but at least one statement is hedged or incomplete, so a reliable comparison is not possible.',
    };
  }
  if (all.some((s) => s.extractionConfidence === 'low') || docs.some((d) => d.status === 'needs_attention')) {
    return { q: 'limited', reason: 'Quotes were located in the source text, but one source has incomplete context or extraction warnings.' };
  }
  if (docs.some((d) => !d.documentDate)) {
    return { q: 'moderate', reason: 'Quotes were located at verified offsets, but at least one document has no recorded document date.' };
  }
  if (all.some((s) => s.extractionConfidence === 'moderate')) {
    return { q: 'moderate', reason: 'Quotes were located at verified offsets; at least one statement was found outside a matching section heading.' };
  }
  return {
    q: 'high',
    reason: 'Both sides were extracted directly from readable source text and their locations were re-verified against the document.',
  };
}

function priority(category: Category, type: FindingType): ReviewPriority {
  if (type === 'context_dependent') return 'low';
  if (SIGNIFICANT_CATEGORIES.includes(category) && (type === 'explicit_conflict' || type === 'potential_discrepancy' || type === 'temporal_inconsistency')) return 'prompt';
  return 'routine';
}

interface Spec {
  category: Category;
  concept: string;
  type: FindingType;
  title: string;
  sideA: ClinicalStatement[];
  sideB: ClinicalStatement[];
  sideALabel: string;
  sideBLabel: string;
  explanation: string;
  comparisonReason: string;
  caveats: string[];
  alternatives: string[];
}

function emit(ctx: Ctx, spec: Spec): void {
  // Enforce case separation and evidence verification.
  const ok = (s: ClinicalStatement) => s.caseId === ctx.caseId && verifyStatement(s, ctx.docs.get(s.documentId));
  // Stable evidence order: chronological by document date, then by position.
  const order = (x: ClinicalStatement, y: ClinicalStatement) =>
    (docDate(ctx, x) ?? '9999').localeCompare(docDate(ctx, y) ?? '9999') || x.documentId.localeCompare(y.documentId) || x.charStart - y.charStart;
  const A = spec.sideA.filter(ok).sort(order);
  const B = spec.sideB.filter(ok).sort(order);
  if (!A.length || !B.length) return;
  const docIdsA = new Set(A.map((s) => s.documentId));
  const docIdsB = new Set(B.map((s) => s.documentId));
  // Cross-document only: at least one document on each side must differ.
  if ([...docIdsA].every((d) => docIdsB.has(d)) && [...docIdsB].every((d) => docIdsA.has(d))) return;
  const all = [...A, ...B];
  const statementIds = [...new Set(all.map((s) => s.id))].sort();
  const fingerprint = hashId(`${ctx.caseId}|${spec.concept}|${statementIds.join(',')}`);
  if (ctx.out.some((f) => f.fingerprint === fingerprint)) return;
  const q = quality(ctx, all, spec.type);
  const evidence = [
    ...A.map((s) => evidenceFor(s, ctx.docs.get(s.documentId)!, 'A')),
    ...B.map((s) => evidenceFor(s, ctx.docs.get(s.documentId)!, 'B')),
  ];
  const dates = new Set<string>();
  for (const s of all) {
    const d = docDate(ctx, s);
    if (d) dates.add(d);
    if (s.eventDate) dates.add(s.eventDate);
  }
  ctx.out.push({
    caseId: ctx.caseId,
    fingerprint,
    displayId: 'CS-' + fingerprint.slice(0, 4).toUpperCase(),
    category: spec.category,
    concept: spec.concept,
    title: spec.title,
    findingType: spec.type,
    statementIds,
    sourceDocumentIds: [...new Set(all.map((s) => s.documentId))],
    evidence,
    sideALabel: spec.sideALabel,
    sideBLabel: spec.sideBLabel,
    explanation: spec.explanation,
    comparisonReason: spec.comparisonReason,
    contextualCaveats: spec.caveats,
    alternativeExplanations: spec.alternatives,
    evidenceQuality: q.q,
    evidenceQualityReason: q.reason,
    reviewPriority: priority(spec.category, spec.type),
    detectionMethod: DETECTION_METHOD,
    relevantDates: [...dates].sort(),
  });
}

function dateGapCaveat(ctx: Ctx, a: ClinicalStatement[], b: ClinicalStatement[]): string[] {
  const da = latestDate(ctx, a);
  const db = latestDate(ctx, b);
  const caveats: string[] = [];
  if (!da || !db) {
    caveats.push('At least one document has no recorded document date, so the order of these statements cannot be established.');
  } else {
    const gap = Math.abs(daysBetween(da, db) ?? 0);
    caveats.push(
      gap === 0
        ? `Both documents are dated ${formatDate(da)}.`
        : `The documents are dated ${formatDate(da)} and ${formatDate(db)} (${gap} day${gap === 1 ? '' : 's'} apart). A change during that interval could explain the difference.`,
    );
  }
  return caveats;
}

const NEEDS_REVIEW = 'The system cannot determine which statement is correct. Professional verification against the primary record or the patient is required.';

// ---------------------------------------------------------------- allergies
function compareAllergies(ctx: Ctx, list: ClinicalStatement[]): void {
  const nkda = list.filter((s) => s.concept === 'allergy:any-drug' && s.status !== 'uncertain');
  const byAllergen = new Map<string, ClinicalStatement[]>();
  for (const s of list) {
    if (s.concept === 'allergy:any-drug') continue;
    byAllergen.set(s.concept, [...(byAllergen.get(s.concept) ?? []), s]);
  }
  for (const [concept, stmts] of byAllergen) {
    const label = stmts[0].conceptLabel;
    const positives = stmts.filter((s) => s.polarity === 'positive');
    const specificNegatives = stmts.filter((s) => s.polarity === 'negative');
    const negatives = [...nkda, ...specificNegatives];
    if (!positives.length) continue;
    const posDocs = new Set(positives.map((s) => s.documentId));
    if (!negatives.length) {
      if (posDocs.size > 1) { ctx.stats.evaluated++; ctx.stats.consistent++; }
      continue;
    }
    const negOther = negatives.filter((n) => positives.some((p) => p.documentId !== n.documentId));
    if (!negOther.length) continue;
    ctx.stats.evaluated++;
    const certain = positives.filter((s) => s.status === 'active');
    const historical = positives.filter((s) => s.status === 'resolved');
    const uncertain = positives.filter((s) => s.status === 'uncertain');
    const negLabel = nkda.length && !specificNegatives.length ? 'No known drug allergies recorded' : `No ${label.toLowerCase()} allergy recorded`;
    if (certain.length) {
      emit(ctx, {
        category: 'allergy', concept, type: 'explicit_conflict',
        title: `${label} allergy documented in one record, absent in another`,
        sideA: certain, sideB: negOther,
        sideALabel: `${label} allergy recorded`, sideBLabel: negLabel,
        explanation: `These documents contain inconsistent statements about the patient's allergy history. ${docTitles(ctx, certain)} records a ${label.toLowerCase()} allergy, while ${docTitles(ctx, negOther)} states that no such allergy is known. ${NEEDS_REVIEW} The difference may reflect a documentation error, an unrecorded update, or a genuine change in the patient's recorded history.`,
        comparisonReason: `Same patient case, same concept (drug allergy). One side asserts a ${label.toLowerCase()} allergy (positive polarity); the other explicitly negates drug allergies (negative polarity).`,
        caveats: [
          ...dateGapCaveat(ctx, certain, negOther),
          '"No known drug allergies" records what was known or reported when the document was written; it does not prove the absence of an allergy.',
        ],
        alternatives: [
          'The intake form may have been completed from patient recall without access to prior records.',
          'The allergy may have been entered in error in one record.',
          'The allergy may have been de-labelled after formal testing, without the record being updated.',
        ],
      });
    } else if (historical.length) {
      emit(ctx, {
        category: 'allergy', concept, type: 'context_dependent',
        title: `Historical ${label.toLowerCase()} reaction vs. no known drug allergies`,
        sideA: historical, sideB: negOther,
        sideALabel: `Historical / resolved ${label.toLowerCase()} reaction`, sideBLabel: negLabel,
        explanation: `One document describes a ${label.toLowerCase()} reaction as historical or resolved, and another records no known drug allergies. These may both be accurate for their time. Confirm whether the historical reaction should remain on the allergy list.`,
        comparisonReason: 'Positive allergy mention qualified by historical language (e.g. "as a child", "outgrown") compared with a negative allergy statement.',
        caveats: dateGapCaveat(ctx, historical, negOther),
        alternatives: ['The reaction may have been outgrown or de-labelled.', 'The negative statement may have omitted a historical reaction.'],
      });
    } else if (uncertain.length) {
      emit(ctx, {
        category: 'allergy', concept, type: 'insufficient_evidence',
        title: `Unverified ${label.toLowerCase()} reaction — insufficient evidence to compare`,
        sideA: uncertain, sideB: negOther,
        sideALabel: `Possible ${label.toLowerCase()} reaction (hedged)`, sideBLabel: negLabel,
        explanation: `One document mentions a possible or unverified ${label.toLowerCase()} reaction using hedged language, while another records no known drug allergies. The available text does not support a definitive conflict; it is surfaced so a reviewer can clarify the allergy history.`,
        comparisonReason: 'Positive mention is qualified by uncertainty terms ("possible", "unsure", "not verified"), so the system does not treat it as an asserted allergy.',
        caveats: ['The hedged statement does not establish that an allergy exists.', ...dateGapCaveat(ctx, uncertain, negOther)],
        alternatives: ['The reaction may have been a side effect rather than an allergy.', 'The patient may not recall the details.'],
      });
    }
  }
}

// --------------------------------------------------------------- medications
function doseKey(s: ClinicalStatement): string | null {
  if (s.numericValue == null) return null;
  const mg = doseToMg(s.numericValue, s.unit);
  return mg != null ? `${mg}mg` : `${s.numericValue}${s.unit ?? ''}`;
}

function compareMedications(ctx: Ctx, list: ClinicalStatement[]): void {
  const label = list[0].conceptLabel;
  const concept = list[0].concept;
  const active = list.filter((s) => s.status === 'active' && s.polarity === 'positive' && s.numericValue != null);
  const discontinued = list.filter((s) => s.status === 'discontinued');
  if (new Set(list.map((s) => s.documentId)).size < 2) return;

  // Dose comparison.
  const groups = new Map<string, ClinicalStatement[]>();
  for (const s of active) {
    const k = doseKey(s)!;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  if (new Set(active.map((s) => s.documentId)).size > 1) {
    ctx.stats.evaluated++;
    const keys = [...groups.keys()];
    if (keys.length === 1) {
      // Same dose: compare frequency.
      const freqs = new Map<string, ClinicalStatement[]>();
      for (const s of active) if (s.frequency) freqs.set(s.frequency, [...(freqs.get(s.frequency) ?? []), s]);
      const fk = [...freqs.keys()];
      if (fk.length > 1) {
        const [A, B] = [freqs.get(fk[0])!, freqs.get(fk[1])!];
        emit(ctx, {
          category: 'medication', concept, type: 'potential_discrepancy',
          title: `${label}: different dosing frequency recorded (${fk[0]} vs ${fk[1]})`,
          sideA: A, sideB: B, sideALabel: `${label} ${fk[0]}`, sideBLabel: `${label} ${fk[1]}`,
          explanation: `The documents record the same ${label.toLowerCase()} dose but a different frequency. The system does not determine which regimen is current. ${NEEDS_REVIEW}`,
          comparisonReason: 'Same medication and dose; normalized frequency differs.',
          caveats: dateGapCaveat(ctx, A, B),
          alternatives: ['A regimen change may have occurred between documents.', 'One record may contain a transcription error.'],
        });
      } else {
        ctx.stats.consistent++;
      }
    }
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        let A = groups.get(keys[i])!;
        let B = groups.get(keys[j])!;
        // Order sides chronologically (earlier record on side A) when dates are known.
        if ((latestDate(ctx, A) ?? '') > (latestDate(ctx, B) ?? '')) [A, B] = [B, A];
        const aMg = doseToMg(A[0].numericValue!, A[0].unit);
        const bMg = doseToMg(B[0].numericValue!, B[0].unit);
        const aVal = A[0].value!;
        const bVal = B[0].value!;
        if (aMg == null || bMg == null) {
          if ((A[0].unit ?? '') !== (B[0].unit ?? '')) {
            emit(ctx, {
              category: 'medication', concept, type: 'insufficient_evidence',
              title: `${label}: doses recorded in units that cannot be compared (${aVal} vs ${bVal})`,
              sideA: A, sideB: B, sideALabel: `${label} ${aVal}`, sideBLabel: `${label} ${bVal}`,
              explanation: `The documents record ${label.toLowerCase()} using different, non-convertible units. The system cannot compare these doses without additional information.`,
              comparisonReason: 'Same medication; dose units are not mass units and differ between documents.',
              caveats: dateGapCaveat(ctx, A, B), alternatives: ['Different formulations or concentrations may be in use.'],
            });
            continue;
          }
        }
        const explained = [...A, ...B].find((s) => s.temporality === 'changed' && s.previousValue != null && (s.previousValue === aMg || s.previousValue === bMg));
        if (explained) {
          ctx.stats.temporal++;
          emit(ctx, {
            category: 'medication', concept, type: 'context_dependent',
            title: `${label} dose change documented between records (${aVal} → ${bVal})`,
            sideA: A, sideB: B,
            sideALabel: `Earlier record: ${label} ${aVal}`, sideBLabel: `Later record: ${label} ${bVal}`,
            explanation: `The doses differ, but one record explicitly documents a dose change ("${explained.originalText}"). This is likely a legitimate treatment change rather than a contradiction. It is shown so a reviewer can confirm that all current records reflect the new dose.`,
            comparisonReason: 'Different normalized doses for the same medication, where one statement contains change language ("increased/decreased … from") whose prior value matches the other record.',
            caveats: [
              ...dateGapCaveat(ctx, A, B),
              'Temporal context matters: each statement may be correct as of its own document date.',
            ],
            alternatives: ['The earlier record reflects the dose before the documented change.'],
          });
        } else {
          emit(ctx, {
            category: 'medication', concept, type: 'potential_discrepancy',
            title: `Different ${label.toLowerCase()} doses recorded (${aVal} vs ${bVal})`,
            sideA: A, sideB: B,
            sideALabel: `${label} ${aVal}${A[0].frequency ? ' ' + A[0].frequency : ''}`,
            sideBLabel: `${label} ${bVal}${B[0].frequency ? ' ' + B[0].frequency : ''}`,
            explanation: `The documents record different doses for the same medication. The system does not claim that either dose is wrong: the difference could reflect a treatment change, a patient-reported versus prescribed dose, or a documentation inconsistency. No record in the case documents a dose change. ${NEEDS_REVIEW}`,
            comparisonReason: `Same case and normalized medication concept (${label.toLowerCase()}); normalized doses differ (${aMg ?? aVal} mg vs ${bMg ?? bVal} mg) and no change language links them.`,
            caveats: dateGapCaveat(ctx, A, B),
            alternatives: [
              'The dose may have been changed without the change being documented in these records.',
              'A patient-reported medication list may differ from the prescribed regimen.',
              'One record may contain a transcription error.',
            ],
          });
        }
      }
    }
  }

  // Discontinued vs active.
  for (const d of discontinued) {
    const dDate = docDate(ctx, d);
    const laterActive = active.filter((a) => a.documentId !== d.documentId && dDate && docDate(ctx, a) && docDate(ctx, a)! > dDate);
    const earlierActive = active.filter((a) => a.documentId !== d.documentId && dDate && docDate(ctx, a) && docDate(ctx, a)! < dDate);
    if (earlierActive.length) { ctx.stats.evaluated++; ctx.stats.temporal++; }
    if (laterActive.length) {
      ctx.stats.evaluated++;
      emit(ctx, {
        category: 'medication', concept, type: 'temporal_inconsistency',
        title: `${label} listed as active after a documented discontinuation`,
        sideA: [d], sideB: laterActive,
        sideALabel: `${label} discontinued (${formatDate(dDate)})`, sideBLabel: `${label} listed as active (later record)`,
        explanation: `An earlier record documents that ${label.toLowerCase()} was discontinued, but a later record lists it as an active medication. The medication may have been restarted, or the later list may be outdated. ${NEEDS_REVIEW}`,
        comparisonReason: 'Discontinuation statement dated before an active-medication statement for the same concept.',
        caveats: dateGapCaveat(ctx, [d], laterActive),
        alternatives: ['The medication may have been intentionally restarted.', 'The later list may have been copied forward from an older record.'],
      });
    }
  }
}

// ---------------------------------------------------------------- diagnoses
function comparePolarityConcept(ctx: Ctx, list: ClinicalStatement[], category: Category): void {
  const label = list[0].conceptLabel;
  const concept = list[0].concept;
  const negatives = list.filter((s) => s.polarity === 'negative');
  const positives = list.filter((s) => s.polarity === 'positive');
  if (new Set(list.map((s) => s.documentId)).size < 2) return;
  if (!negatives.length) {
    if (new Set(positives.map((s) => s.documentId)).size > 1) { ctx.stats.evaluated++; ctx.stats.consistent++; }
    return;
  }
  if (!positives.length) return;
  const negOther = negatives.filter((n) => positives.some((p) => p.documentId !== n.documentId));
  if (!negOther.length) return;
  ctx.stats.evaluated++;
  const certain = positives.filter((s) => s.status === 'active');
  const resolved = positives.filter((s) => s.status === 'resolved');
  const uncertain = positives.filter((s) => s.status === 'uncertain');
  const noun = CATEGORY_LABEL[category].toLowerCase();
  if (certain.length) {
    emit(ctx, {
      category, concept, type: 'explicit_conflict',
      title: `${label}: documented in one record, explicitly negated in another`,
      sideA: certain, sideB: negOther,
      sideALabel: `${label} documented`, sideBLabel: `${label} explicitly negated`,
      explanation: `${docTitles(ctx, certain)} documents ${label.toLowerCase()}, while ${docTitles(ctx, negOther)} explicitly states it is absent. ${NEEDS_REVIEW}`,
      comparisonReason: `Same case and normalized ${noun} concept; one statement is affirmative and the other contains explicit negation ("no", "denies", "no history of").`,
      caveats: [
        ...dateGapCaveat(ctx, certain, negOther),
        'A negative statement on a patient-completed form may reflect patient awareness rather than clinical status.',
      ],
      alternatives: ['The patient may be unaware of the diagnosis.', 'One record may contain a documentation error.', 'The condition may have been newly diagnosed between documents.'],
    });
  } else if (resolved.length) {
    ctx.stats.temporal++;
    emit(ctx, {
      category, concept, type: 'context_dependent',
      title: `${label}: historical/resolved in one record, absent in another`,
      sideA: resolved, sideB: negOther,
      sideALabel: `${label} — historical / resolved`, sideBLabel: `${label} not present`,
      explanation: `One record describes ${label.toLowerCase()} as historical or resolved; another states it is not present. Both can be true at the same time, depending on whether the negative statement refers to current status. Shown for context.`,
      comparisonReason: 'Affirmative statement qualified by historical/resolved language compared with a negative statement.',
      caveats: ['A documented past condition does not contradict a statement that the condition is not currently present.', ...dateGapCaveat(ctx, resolved, negOther)],
      alternatives: ['The negative statement may refer to current status only.'],
    });
  } else if (uncertain.length) {
    emit(ctx, {
      category, concept, type: 'insufficient_evidence',
      title: `${label}: hedged mention vs. negative statement — insufficient evidence`,
      sideA: uncertain, sideB: negOther,
      sideALabel: `Possible ${label.toLowerCase()} (hedged)`, sideBLabel: `${label} negated`,
      explanation: `One record mentions ${label.toLowerCase()} only with uncertainty (e.g. "possible", "rule out"). The evidence does not support a definitive conflict.`,
      comparisonReason: 'Affirmative mention is hedged; not treated as an assertion.',
      caveats: dateGapCaveat(ctx, uncertain, negOther), alternatives: ['The work-up may have been completed after the hedged note.'],
    });
  }
}

// --------------------------------------------------------------------- labs
function compareLabs(ctx: Ctx, list: ClinicalStatement[]): void {
  const label = list[0].conceptLabel;
  const concept = list[0].concept;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.documentId === b.documentId || a.numericValue == null || b.numericValue == null) continue;
      ctx.stats.evaluated++;
      const sameSpecimen = !!a.eventDate && a.eventDate === b.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(a.eventDate);
      if (!sameSpecimen) {
        // Different or unknown specimen dates: a different value is expected over time — not flagged.
        ctx.stats.temporal++;
        continue;
      }
      if (a.unit && b.unit && a.unit.toLowerCase() !== b.unit.toLowerCase()) {
        emit(ctx, {
          category: 'lab', concept, type: 'insufficient_evidence',
          title: `${label}: same specimen date reported in different units`,
          sideA: [a], sideB: [b], sideALabel: `${label} ${a.value}`, sideBLabel: `${label} ${b.value}`,
          explanation: `Both documents report ${label} for the same specimen date but in different units, so the values cannot be compared without conversion information.`,
          comparisonReason: 'Same test and specimen date; units differ.',
          caveats: [`Specimen date: ${formatDate(a.eventDate)}.`], alternatives: ['Different laboratories may report in different units.'],
        });
        continue;
      }
      if (Math.abs(a.numericValue - b.numericValue) < 1e-9) { ctx.stats.consistent++; continue; }
      emit(ctx, {
        category: 'lab', concept, type: 'potential_discrepancy',
        title: `${label}: different values reported for the same specimen date (${a.value} vs ${b.value})`,
        sideA: [a], sideB: [b], sideALabel: `${label} ${a.value}`, sideBLabel: `${label} ${b.value}`,
        explanation: `Two documents report different ${label} results for what appears to be the same specimen date (${formatDate(a.eventDate)}). The system does not interpret the values clinically and cannot tell which transcription is accurate. Verify against the original laboratory report.`,
        comparisonReason: 'Same test, same specimen/event date, different numeric value.',
        caveats: ['More than one specimen may have been drawn on the same day.', 'A value may have been transcribed into a narrative document incorrectly.'],
        alternatives: ['Repeat test on the same day.', 'Transcription error in a summary document.'],
      });
    }
  }
}

// ----------------------------------------------------------------- smoking
function compareSmoking(ctx: Ctx, list: ClinicalStatement[]): void {
  const byVal = new Map<string, ClinicalStatement[]>();
  for (const s of list) byVal.set(s.value!, [...(byVal.get(s.value!) ?? []), s]);
  if (new Set(list.map((s) => s.documentId)).size < 2) return;
  ctx.stats.evaluated++;
  if (byVal.size === 1) { ctx.stats.consistent++; return; }
  const pairs: [string, string, FindingType][] = [
    ['never', 'current', 'explicit_conflict'],
    ['never', 'former', 'explicit_conflict'],
    ['former', 'current', 'context_dependent'],
  ];
  for (const [x, y, type] of pairs) {
    const A = byVal.get(x);
    const B = byVal.get(y);
    if (!A || !B) continue;
    emit(ctx, {
      category: 'other', concept: 'other:smoking-status', type,
      title: type === 'context_dependent' ? `Smoking status differs: ${x} vs ${y} smoker` : `Smoking status conflict: "${x} smoker" vs "${y} smoker"`,
      sideA: A, sideB: B, sideALabel: `${x[0].toUpperCase() + x.slice(1)} smoker`, sideBLabel: `${y[0].toUpperCase() + y.slice(1)} smoker`,
      explanation: type === 'context_dependent'
        ? 'Smoking status may legitimately change over time (e.g. relapse or quitting). Confirm the current status.'
        : `One record states the patient has never smoked, while another records ${y} smoking. These cannot both be accurate. ${NEEDS_REVIEW}`,
      comparisonReason: 'Normalized smoking status values differ across documents.',
      caveats: dateGapCaveat(ctx, A, B),
      alternatives: ['Different definitions of "smoker" may have been used (e.g. minimal past use).', 'Patient-reported history may vary between encounters.'],
    });
  }
}

// --------------------------------------------------------------- procedures
function compareProcedures(ctx: Ctx, list: ClinicalStatement[]): void {
  const none = list.filter((s) => s.concept === 'procedure:any');
  const byProc = new Map<string, ClinicalStatement[]>();
  for (const s of list) if (s.concept !== 'procedure:any') byProc.set(s.concept, [...(byProc.get(s.concept) ?? []), s]);
  for (const [concept, stmts] of byProc) {
    const pos = stmts.filter((s) => s.polarity === 'positive');
    const neg = [...none, ...stmts.filter((s) => s.polarity === 'negative')].filter((n) => pos.some((p) => p.documentId !== n.documentId));
    if (!pos.length || !neg.length) continue;
    ctx.stats.evaluated++;
    const label = pos[0].conceptLabel;
    emit(ctx, {
      category: 'procedure', concept, type: 'explicit_conflict',
      title: `${label} documented, but another record reports no prior surgery`,
      sideA: pos, sideB: neg, sideALabel: `${label} documented`, sideBLabel: 'No prior surgery reported',
      explanation: `${docTitles(ctx, pos)} documents a ${label.toLowerCase()}, while ${docTitles(ctx, neg)} reports no prior surgical procedures. ${NEEDS_REVIEW}`,
      comparisonReason: 'Specific procedure (positive) vs. a blanket negative surgical-history statement.',
      caveats: dateGapCaveat(ctx, pos, neg), alternatives: ['The patient may not consider some procedures to be surgery.'],
    });
  }
}

/**
 * Runs cross-document detection for a single case. Statements or documents
 * belonging to any other case are ignored, so records are never compared
 * across unrelated cases.
 */
export function detectContradictions(caseId: string, statements: ClinicalStatement[], documents: DocumentRecord[]): DetectionResult {
  const docs = new Map(documents.filter((d) => d.caseId === caseId).map((d) => [d.id, d]));
  const own = statements.filter((s) => s.caseId === caseId && docs.has(s.documentId));
  const ctx: Ctx = { caseId, docs, out: [], stats: { evaluated: 0, consistent: 0, temporal: 0 } };
  const byConcept = new Map<string, ClinicalStatement[]>();
  for (const s of own) byConcept.set(s.concept, [...(byConcept.get(s.concept) ?? []), s]);

  compareAllergies(ctx, own.filter((s) => s.category === 'allergy'));
  compareProcedures(ctx, own.filter((s) => s.category === 'procedure'));
  for (const [concept, list] of byConcept) {
    if (concept.startsWith('medication:')) compareMedications(ctx, list);
    else if (concept.startsWith('diagnosis:')) comparePolarityConcept(ctx, list, 'diagnosis');
    else if (concept.startsWith('lab:')) compareLabs(ctx, list);
    else if (concept === 'other:smoking-status') compareSmoking(ctx, list);
  }
  return {
    findings: ctx.out,
    comparisonsEvaluated: ctx.stats.evaluated,
    consistentComparisons: ctx.stats.consistent,
    temporallyExplainedComparisons: ctx.stats.temporal,
  };
}
