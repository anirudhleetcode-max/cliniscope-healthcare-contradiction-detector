import { describe, expect, it } from 'vitest';
import { AiOutputError, corroborates, locateQuote, verifyAiOutput, type AiOutput } from '../../src/lib/ai';
import { detectContradictions } from '../../src/lib/detect';
import { extractStatements } from '../../src/lib/statements';
import { makeDoc } from './helpers';
import type { Finding } from '../../src/lib/types';

const a = makeDoc('c1', 'DISCHARGE MEDICATIONS\nMetformin 500 mg twice daily.', { id: 'doc_aaaaaaa1', title: 'Discharge', documentDate: '2026-03-12' });
const b = makeDoc('c1', 'Metformin increased to 1000 mg twice daily on 20 May 2026.', { id: 'doc_bbbbbbb2', title: 'Clinic letter', documentDate: '2026-05-20' });
const pdf = makeDoc('c1', 'Page one text.\n\nAllergies: none known.', { id: 'doc_ccccccc3', title: 'Scan', fileKind: 'pdf', pageSpans: [{ page: 1, start: 0, end: 14 }, { page: 2, start: 16, end: 38 }] });
const other = makeDoc('c2', 'Penicillin allergy.', { id: 'doc_ddddddd4', title: 'Other case' });
const docs = [a, b, pdf, other];

const f = (over: Partial<AiOutput['findings'][number]>): AiOutput['findings'][number] => ({
  title: 'T', category: 'potential_discrepancy', clinical_topic: 'medication', explanation: 'e', reason_for_human_review: 'r', uncertainty: '', relevant_dates: [], evidence: [], ...over,
});

describe('AI output verification (evidence-first)', () => {
  it('accepts verified quotes, takes quote text from the source and maps a documented change to historical/contextual', () => {
    const r = verifyAiOutput('c1', { findings: [f({
      category: 'historical_or_contextual', relevant_dates: ['2026-05-20', '2030-01-01'],
      evidence: [{ document_id: a.id, side: 'A', quote: 'Metformin 500 mg twice daily.' }, { document_id: b.id, side: 'B', quote: 'Metformin increased to 1000 mg   twice daily' }],
    })] }, docs, 'test-model');
    expect(r.accepted).toHaveLength(1);
    const x = r.accepted[0];
    expect(x.findingType).toBe('context_dependent');
    expect(x.origin).toBe('ai');
    for (const e of x.evidence) expect(docs.find((d) => d.id === e.documentId)!.extractedText.slice(e.charStart, e.charEnd)).toBe(e.quote);
    expect(x.relevantDates).toEqual(['2026-03-12', '2026-05-20']); // invented 2030 date dropped
    expect(x.contextualCaveats.join(' ')).toMatch(/normalizing whitespace/);
    expect(x.detectionMethod).toMatch(/AI-assisted \(test-model\)/);
  });

  it('rejects fabricated quotes, unknown documents and documents from other cases', () => {
    const r = verifyAiOutput('c1', { findings: [
      f({ evidence: [{ document_id: a.id, side: 'A', quote: 'Metformin 850 mg daily.' }] }),
      f({ evidence: [{ document_id: 'doc_madeup', side: 'A', quote: 'Metformin 500 mg twice daily.' }] }),
      f({ evidence: [{ document_id: other.id, side: 'A', quote: 'Penicillin allergy.' }] }),
    ] }, docs, 'm');
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(3);
    expect(r.rejected[1].reason).toMatch(/unknown document/);
  });

  it('downgrades a one-sided "conflict" to insufficient evidence and never fabricates page numbers', () => {
    const r = verifyAiOutput('c1', { findings: [f({ category: 'explicit_conflict', clinical_topic: 'allergy', evidence: [
      { document_id: pdf.id, side: 'A', quote: 'Allergies: none known.' },
      { document_id: a.id, side: 'B', quote: 'Penicillin anaphylaxis.' },
    ] })] }, docs, 'm');
    const x = r.accepted[0];
    expect(x.findingType).toBe('insufficient_evidence');
    expect(x.contextualCaveats[0]).toMatch(/Unsupported comparison/);
    expect(x.evidence[0].page).toBe(2); // from verified PDF page spans
    const txt = verifyAiOutput('c1', { findings: [f({ category: 'insufficient_evidence', evidence: [{ document_id: a.id, side: 'A', quote: 'Metformin 500 mg twice daily.' }] })] }, docs, 'm');
    expect(txt.accepted[0].evidence[0].page).toBeNull(); // TXT has no pages
  });

  it('rejects schema-invalid output and ignores "consistent" items as findings', () => {
    expect(() => verifyAiOutput('c1', { findings: [{ title: 1 }] }, docs, 'm')).toThrow(AiOutputError);
    expect(() => verifyAiOutput('c1', 'free text answer', docs, 'm')).toThrow(AiOutputError);
    const r = verifyAiOutput('c1', { findings: [f({ category: 'consistent', evidence: [] })] }, docs, 'm');
    expect(r.accepted).toHaveLength(0);
    expect(r.consistent).toHaveLength(1);
  });

  it('locates quotes exactly or with whitespace tolerance only', () => {
    expect(locateQuote('a  b\nc', 'a b c')).toMatchObject({ exact: false });
    expect(locateQuote('Metformin 500 mg', 'Metformin 50 mg')).toBeNull();
  });

  it('recognises when an AI finding merely corroborates an existing rules finding', () => {
    const c = makeDoc('c1', 'MEDICATIONS\nMetformin 1000 mg twice daily.', { id: 'doc_eeeeeee5', documentDate: '2026-03-15' });
    const st = [a, c].flatMap((d) => extractStatements(d));
    const rules = detectContradictions('c1', st, [a, c]).findings.map((x) => ({ ...x, id: 'fd_1', reviewStatus: 'unreviewed', stale: false, createdAt: '', updatedAt: '', isSeededDemo: false })) as Finding[];
    const r = verifyAiOutput('c1', { findings: [f({ evidence: [{ document_id: a.id, side: 'A', quote: 'Metformin 500 mg' }, { document_id: c.id, side: 'B', quote: 'Metformin 1000 mg' }] })] }, [a, c], 'm');
    expect(corroborates(r.accepted[0], rules)?.id).toBe('fd_1');
  });
});
