import { describe, expect, it } from 'vitest';
import { detectContradictions } from '../../src/lib/detect';
import { extractStatements } from '../../src/lib/statements';
import { loadDemoDocs, makeDoc } from './helpers';
import type { DocumentRecord } from '../../src/lib/types';

function run(caseId: string, docs: DocumentRecord[]) {
  const statements = docs.flatMap((d) => extractStatements(d));
  return { statements, ...detectContradictions(caseId, statements, docs) };
}

describe('contradiction detection engine', () => {
  it('TEST 1: penicillin allergy vs no known drug allergies yields an explicit conflict', () => {
    const a = makeDoc('c1', 'ALLERGIES\nPenicillin allergy documented.', { documentDate: '2026-03-12', title: 'Discharge Summary' });
    const b = makeDoc('c1', 'Allergies: No known drug allergies.', { documentDate: '2026-03-15', title: 'Intake Form' });
    const r = run('c1', [a, b]);
    const f = r.findings.find((x) => x.concept === 'allergy:penicillin');
    expect(f).toBeDefined();
    expect(f!.findingType).toBe('explicit_conflict');
    expect(f!.explanation).toMatch(/cannot determine which statement is correct/);
    expect(f!.evidence.find((e) => e.side === 'A')!.quote).toBe('Penicillin allergy documented.');
    expect(f!.evidence.find((e) => e.side === 'B')!.quote).toBe('No known drug allergies.');
  });

  it('TEST 2: matching statements do not generate a contradiction', () => {
    const a = makeDoc('c1', 'MEDICATIONS\nAtorvastatin 20 mg at night.\nDIAGNOSES\nHypertension.');
    const b = makeDoc('c1', 'MEDICATIONS\nAtorvastatin 20 mg nightly.\nPROBLEM LIST\nHypertension.');
    const r = run('c1', [a, b]);
    expect(r.findings).toHaveLength(0);
    expect(r.consistentComparisons).toBeGreaterThanOrEqual(2);
  });

  it('TEST 3: statements in different cases are never compared', () => {
    const a = makeDoc('case-A', 'Penicillin allergy documented.');
    const b = makeDoc('case-B', 'No known drug allergies.');
    const all = [a, b];
    const statements = all.flatMap((d) => extractStatements(d));
    expect(detectContradictions('case-A', statements, all).findings).toHaveLength(0);
    expect(detectContradictions('case-B', statements, all).findings).toHaveLength(0);
    // Even if a foreign statement is smuggled in with a matching documentId it is ignored.
    const forged = statements.map((s) => ({ ...s, documentId: a.id }));
    expect(detectContradictions('case-A', forged, all).findings).toHaveLength(0);
  });

  it('TEST 4: a documented dose change is classified as a historical/contextual difference', () => {
    const a = makeDoc('c1', 'DISCHARGE MEDICATIONS\nLisinopril 10 mg once daily.', { documentDate: '2026-03-12' });
    const b = makeDoc('c1', 'ACTIVE MEDICATIONS\nLisinopril 20 mg once daily (increased from 10 mg on 13 March 2026).', { documentDate: '2026-03-14' });
    const r = run('c1', [a, b]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].findingType).toBe('context_dependent');
    expect(r.findings[0].reviewPriority).toBe('low');
    expect(r.findings[0].contextualCaveats.join(' ')).toMatch(/2 days apart/);
  });

  it('TEST 4b: lab values from different specimen dates are not flagged', () => {
    const a = makeDoc('c1', 'Most recent HbA1c 8.2% in December 2025.');
    const b = makeDoc('c1', 'Specimen collected: 11 March 2026\nCHEMISTRY\nHbA1c 7.4 %');
    const r = run('c1', [a, b]);
    expect(r.findings).toHaveLength(0);
    expect(r.temporallyExplainedComparisons).toBe(1);
  });

  it('TEST 5: different medication doses generate a potential discrepancy that does not blame either dose', () => {
    const a = makeDoc('c1', 'MEDICATIONS\nMetformin 500 mg twice daily.', { documentDate: '2026-03-14' });
    const b = makeDoc('c1', 'MEDICATIONS\nMetformin 1000 mg twice daily.', { documentDate: '2026-03-15' });
    const r = run('c1', [a, b]);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.findingType).toBe('potential_discrepancy');
    expect(f.title).toContain('500 mg vs 1000 mg');
    expect(f.explanation).toMatch(/does not claim that either dose is wrong/);
    expect(f.explanation).toMatch(/treatment change/);
  });

  it('treats 1 g and 1000 mg as the same dose', () => {
    const a = makeDoc('c1', 'MEDICATIONS\nMetformin 1 g twice daily.');
    const b = makeDoc('c1', 'MEDICATIONS\nMetformin 1000 mg twice daily.');
    expect(run('c1', [a, b]).findings).toHaveLength(0);
  });

  it('TEST 6: hedged/ambiguous evidence produces an insufficient-evidence finding, not a definitive conflict', () => {
    const a = makeDoc('c1', 'ALLERGIES\nPossible reaction to sulfa antibiotics as a child, patient unsure, not verified.');
    const b = makeDoc('c1', 'Allergies: No known drug allergies.');
    const r = run('c1', [a, b]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].findingType).toBe('insufficient_evidence');
    expect(r.findings[0].evidenceQuality).toBe('limited');
  });

  it('TEST 6b: no finding is created when evidence cannot be re-located in the source text', () => {
    const a = makeDoc('c1', 'Penicillin allergy documented.');
    const b = makeDoc('c1', 'No known drug allergies.');
    const statements = [a, b].flatMap((d) => extractStatements(d));
    const tampered = { ...a, extractedText: 'Text changed after extraction.' };
    expect(detectContradictions('c1', statements, [tampered, b]).findings).toHaveLength(0);
  });

  it('ignores family history (not about the patient)', () => {
    const a = makeDoc('c1', 'FAMILY HISTORY\nMother with chronic kidney disease.');
    const b = makeDoc('c1', 'No history of kidney disease.');
    expect(run('c1', [a, b]).findings).toHaveLength(0);
  });

  it('detects diagnosis negation conflicts and historical (resolved) context', () => {
    const a = makeDoc('c1', 'DIAGNOSES\nChronic kidney disease stage 3a.\nPneumonia, treated and resolved.');
    const b = makeDoc('c1', 'Medical history: No history of kidney disease. No pneumonia.');
    const r = run('c1', [a, b]);
    expect(r.findings.find((f) => f.concept === 'diagnosis:chronic-kidney-disease')?.findingType).toBe('explicit_conflict');
    expect(r.findings.find((f) => f.concept === 'diagnosis:pneumonia')?.findingType).toBe('context_dependent');
  });

  it('flags a medication listed active after a documented discontinuation', () => {
    const a = makeDoc('c1', 'MEDICATIONS\nWarfarin 5 mg daily discontinued on 2 March 2026.', { documentDate: '2026-03-02' });
    const b = makeDoc('c1', 'MEDICATIONS\nWarfarin 5 mg daily.', { documentDate: '2026-03-20' });
    const r = run('c1', [a, b]);
    expect(r.findings.some((f) => f.findingType === 'temporal_inconsistency')).toBe(true);
  });
});

describe('seeded demo case (real PDF/DOCX/TXT/scanned files through the real pipeline incl. OCR)', () => {
  it('TEST 19: demo evidence is internally consistent with the source documents', async () => {
    const { docs, statements } = await loadDemoDocs();
    const r = detectContradictions('case_demo', statements, docs);
    const byDoc = new Map(docs.map((d) => [d.id, d]));
    // TEST 7: every quotation matches the extracted document text exactly.
    for (const f of r.findings) {
      for (const e of f.evidence) {
        const d = byDoc.get(e.documentId)!;
        expect(d.extractedText.slice(e.charStart, e.charEnd)).toBe(e.quote);
        expect(e.documentDate).toBe(d.documentDate);
      }
    }
    const types = Object.fromEntries(r.findings.map((f) => [f.concept, f.findingType]));
    expect(types['allergy:penicillin']).toBe('explicit_conflict'); // Scenario A
    expect(types['medication:metformin']).toBe('potential_discrepancy'); // Scenario B
    expect(types['medication:lisinopril']).toBe('context_dependent'); // Scenario C
    // Atorvastatin 20 mg agrees in the typed records; the scanned letter's smudged dose is unreadable → insufficient evidence, not a conflict.
    expect(types['medication:atorvastatin']).toBe('insufficient_evidence');
    expect(types['diagnosis:hypertension']).toBeUndefined(); // Scenario D (consistent)
    expect(types['allergy:sulfonamide']).toBe('insufficient_evidence'); // Scenario E
    expect(types['lab:potassium']).toBe('potential_discrepancy');
    expect(types['lab:hba1c']).toBeUndefined();
    expect(types['diagnosis:diabetes-mellitus']).toBeUndefined(); // consistent incl. OCR'd scan
    expect(types['lab:potassium']).toBe('potential_discrepancy'); // same-day values only; Nov 2025 value not flagged
    expect(r.findings).toHaveLength(8);
  });

  it('TEST 8: page numbers are present only for PDF sources with verified page spans', async () => {
    const { docs, statements } = await loadDemoDocs();
    for (const s of statements) {
      const d = docs.find((x) => x.id === s.documentId)!;
      if (d.fileKind === 'pdf') {
        const span = d.pageSpans.find((p) => p.page === s.sourcePage)!;
        expect(span).toBeDefined();
        expect(s.charStart).toBeGreaterThanOrEqual(span.start);
        expect(s.charEnd).toBeLessThanOrEqual(span.end);
      } else {
        expect(s.sourcePage).toBeNull();
      }
    }
    const pen = statements.find((s) => s.concept === 'allergy:penicillin' && s.documentId === 'demo_discharge_summary')!;
    expect(pen.sourcePage).toBe(2);
    expect(pen.sourceSection).toBe('ALLERGIES');
  });
});
