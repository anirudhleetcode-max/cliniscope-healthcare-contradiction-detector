import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { MedguardDB } from '../../src/lib/db';
import {
  addReviewerNote, analyzeCase, createCase, decideFinding, seedDemoWorkspace, transitionFinding, uploadDocument, type Extractor,
} from '../../src/lib/services';
import { LOCAL_TRANSITIONS, ReviewError, TRANSITIONS, reasonRequired, validateTransition } from '../../src/lib/review';
import { EXTRA_DEMO_CASES } from '../../src/lib/demoWorkspace';
import { natureOf, severityOf, splitLabel, summarizeCase, workspaceMetrics } from '../../src/lib/metrics';
import { demoPath, extractFile } from './helpers';

const extractor: Extractor = (kind, bytes) => extractFile(`x.${kind}`, bytes);
const enc = (s: string) => new TextEncoder().encode(s);
let n = 0;
let db: MedguardDB;
beforeEach(() => { db = new MedguardDB(`ws-${++n}`); });

async function primaryFiles() {
  const { DEMO_MANIFEST } = await import('../../scripts/demo-content.mjs');
  return DEMO_MANIFEST.map((meta: any) => ({ meta, bytes: new Uint8Array(readFileSync(demoPath(meta.file))) }));
}

describe('review state machine', () => {
  it('keeps the shared (server) table unchanged and adds local-only outcomes', () => {
    expect(TRANSITIONS.in_review).toEqual(['confirmed', 'resolved', 'dismissed']);
    expect(() => validateTransition('in_review', 'needs_info', 'Waiting for records.')).toThrow(ReviewError);
    expect(() => validateTransition('in_review', 'needs_info', undefined, 'local')).not.toThrow();
    expect(LOCAL_TRANSITIONS.needs_info).toContain('confirmed');
    expect(() => validateTransition('unreviewed', 'confirmed', undefined, 'local')).toThrow(ReviewError);
  });
  it('requires a reason for closing or uncertain outcomes and for reopening', () => {
    expect(reasonRequired('in_review', 'expected_change')).toBe(true);
    expect(reasonRequired('in_review', 'undetermined')).toBe(true);
    expect(reasonRequired('in_review', 'needs_info')).toBe(false);
    expect(reasonRequired('in_review', 'confirmed')).toBe(false);
    expect(reasonRequired('expected_change', 'in_review')).toBe(true);
    expect(() => validateTransition('in_review', 'expected_change', 'no', 'local')).toThrow(/reason/);
  });
  it('decideFinding moves an unreviewed finding through "in review" with two audited transitions', async () => {
    const c = await createCase(db, 'Case D');
    await uploadDocument(db, extractor, c.id, { name: 'a.txt', mime: 'text/plain', bytes: enc('MEDICATIONS\nFurosemide 40 mg once daily.') }, { documentDate: '2026-02-01' });
    await uploadDocument(db, extractor, c.id, { name: 'b.txt', mime: 'text/plain', bytes: enc('MEDICATIONS\nFurosemide 20 mg once daily.') }, { documentDate: '2026-02-02' });
    await analyzeCase(db, c.id);
    const [f] = await db.findings.where('caseId').equals(c.id).toArray();
    await decideFinding(db, f.id, 'needs_info');
    expect((await db.findings.get(f.id))!.reviewStatus).toBe('needs_info');
    const moves = (await db.events.where('findingId').equals(f.id).sortBy('at')).filter((e) => e.kind === 'status_changed');
    expect(moves.map((e) => `${e.fromStatus}>${e.toStatus}`)).toEqual(['unreviewed>in_review', 'in_review>needs_info']);
    await decideFinding(db, f.id, 'expected_change', { reason: 'Dose reduced at the later visit.' });
    expect((await db.findings.get(f.id))!.reviewStatus).toBe('expected_change');
  });
  it('a shared (server-backed) case is limited to the shared statuses', async () => {
    const c = await createCase(db, 'Shared');
    await db.cases.update(c.id, { remote: { serverUrl: 'http://x', role: 'owner', owner: 'a', syncedAt: null } });
    await uploadDocument(db, extractor, c.id, { name: 'a.txt', mime: 'text/plain', bytes: enc('MEDICATIONS\nFurosemide 40 mg once daily.') }, { documentDate: '2026-02-01' });
    await uploadDocument(db, extractor, c.id, { name: 'b.txt', mime: 'text/plain', bytes: enc('MEDICATIONS\nFurosemide 20 mg once daily.') }, { documentDate: '2026-02-02' });
    await analyzeCase(db, c.id);
    const [f] = await db.findings.where('caseId').equals(c.id).toArray();
    await transitionFinding(db, f.id, 'in_review');
    await expect(transitionFinding(db, f.id, 'needs_info')).rejects.toThrow(ReviewError);
  });
});

describe('synthetic demonstration workspace', () => {
  it('seeds six coherent cases whose findings come from the rules engine with valid evidence', async () => {
    const primary = await seedDemoWorkspace(db, extractor, await primaryFiles());
    const cases = await db.cases.toArray();
    expect(cases).toHaveLength(1 + EXTRA_DEMO_CASES.length);
    expect(cases.every((c) => c.isDemo && c.demoKey && c.seededAt)).toBe(true);
    expect(primary.demoKey).toBe('DEMO-0042');
    expect(primary.lastAnalyzedAt).toBeNull(); // the primary case is analysed live during the demo

    const docs = await db.documents.toArray();
    const findings = await db.findings.toArray();
    expect(docs).toHaveLength(5 + EXTRA_DEMO_CASES.reduce((s, c) => s + c.documents.length, 0));
    expect(findings).toHaveLength(10);
    for (const f of findings) {
      expect(cases.some((c) => c.id === f.caseId)).toBe(true);
      for (const e of f.evidence) {
        const d = docs.find((x) => x.id === e.documentId)!;
        expect(d.caseId).toBe(f.caseId);
        expect(d.extractedText.slice(e.charStart, e.charEnd)).toBe(e.quote);
      }
    }
    const byConcept = (k: string) => findings.find((f) => f.concept === k)!;
    expect(byConcept('medication:warfarin').findingType).toBe('temporal_inconsistency');
    expect(byConcept('medication:levothyroxine').findingType).toBe('context_dependent');
    expect(byConcept('medication:levothyroxine').reviewStatus).toBe('expected_change');
    expect(byConcept('medication:insulin-glargine').findingType).toBe('insufficient_evidence');
    expect(byConcept('demographic:date-of-birth').reviewStatus).toBe('in_review');
    expect(byConcept('lab:inr').reviewStatus).toBe('undetermined');
    expect(byConcept('medication:furosemide').reviewStatus).toBe('needs_info');
    expect(byConcept('allergy:codeine').reviewStatus).toBe('confirmed');
    expect(natureOf(byConcept('medication:levothyroxine'))).toBe('temporal');
    expect(natureOf(byConcept('allergy:iodinated-contrast'))).toBe('missing');

    // Seeded events are all at or before the case's seededAt mark; later actions are not.
    const c107 = cases.find((c) => c.demoKey === 'DEMO-0107')!;
    const evs = await db.events.where('caseId').equals(c107.id).toArray();
    expect(evs.every((e) => e.at <= c107.seededAt!)).toBe(true);
    const ev = await addReviewerNote(db, byConcept('medication:warfarin').id, 'Live note');
    expect(ev.at > c107.seededAt!).toBe(true);

    // Re-seeding replaces only demo cases.
    const mine = await createCase(db, 'MY-CASE');
    await seedDemoWorkspace(db, extractor, await primaryFiles());
    expect(await db.cases.get(mine.id)).toBeTruthy();
    expect((await db.cases.toArray()).filter((c) => c.isDemo)).toHaveLength(6);
  }, 120000);

  it('derives dashboard metrics and case summaries from stored records', async () => {
    await seedDemoWorkspace(db, extractor, await primaryFiles());
    const cases = await db.cases.toArray();
    const docs = await db.documents.toArray();
    const findings = await db.findings.toArray();
    const m = workspaceMetrics(cases, docs, findings);
    expect(m.caseCount).toBe(6);
    expect(m.documentCount).toBe(docs.length);
    expect(m.pendingReviews).toBe(findings.filter((f) => ['unreviewed', 'in_review', 'needs_info'].includes(f.reviewStatus)).length);
    expect(m.openContradictions).toBe(findings.filter((f) => !['resolved', 'dismissed', 'expected_change'].includes(f.reviewStatus)).length);
    expect([...m.byCategory.values()].reduce((a, b) => a + b, 0)).toBe(findings.length);
    const primary = summarizeCase(cases.find((c) => c.demoKey === 'DEMO-0042')!, docs, findings);
    expect(primary.state).toBe('awaiting_analysis');
    expect(primary.documentCount).toBe(5);
    const c118 = summarizeCase(cases.find((c) => c.demoKey === 'DEMO-0118')!, docs, findings);
    expect(c118.state).toBe('reviewed');
    expect(splitLabel('DEMO-0118 · Synthetic Patient SP-0118')).toEqual({ displayId: 'DEMO-0118', alias: 'Synthetic Patient SP-0118' });
    expect(severityOf({ reviewPriority: 'prompt' })).toBe('high');
  }, 120000);
});
