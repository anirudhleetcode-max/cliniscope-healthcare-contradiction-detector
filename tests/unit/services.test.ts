import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { MedguardDB } from '../../src/lib/db';
import {
  addReviewerNote, analyzeCase, createCase, deleteDocument, seedDemoCase, transitionFinding, uploadDocument,
  type Extractor,
} from '../../src/lib/services';
import { ReviewError } from '../../src/lib/review';
import { UploadValidationError } from '../../src/lib/extract';
import { demoPath, extractFile } from './helpers';

const extractor: Extractor = (kind, bytes) => extractFile(`x.${kind}`, bytes);
const enc = (s: string) => new TextEncoder().encode(s);
let dbName = 0;
let db: MedguardDB;

beforeEach(() => {
  db = new MedguardDB(`test-${++dbName}`);
});

async function demo() {
  const { DEMO_MANIFEST } = await import('../../scripts/demo-content.mjs');
  const files = DEMO_MANIFEST.map((meta: any) => ({ meta, bytes: new Uint8Array(readFileSync(demoPath(meta.file))) }));
  const c = await seedDemoCase(db, extractor, files);
  await analyzeCase(db, c.id);
  return c;
}

describe('ingestion and analysis service', () => {
  it('TEST 14: a TXT document can be uploaded and analyzed', async () => {
    const c = await createCase(db, 'Case T');
    await uploadDocument(db, extractor, c.id, { name: 'a.txt', mime: 'text/plain', bytes: enc('MEDICATIONS\nMetformin 500 mg twice daily.') }, { documentDate: '2026-03-14' });
    await uploadDocument(db, extractor, c.id, { name: 'b.txt', mime: 'text/plain', bytes: enc('MEDICATIONS\nMetformin 1000 mg twice daily.') }, { documentDate: '2026-03-15' });
    const s = await analyzeCase(db, c.id);
    expect(s.findingsCreated).toBe(1);
    const docs = await db.documents.where('caseId').equals(c.id).toArray();
    expect(docs.every((d) => d.status === 'analyzed')).toBe(true);
  });

  it('TEST 15: a readable PDF can be uploaded, extracted and analyzed', async () => {
    const c = await createCase(db, 'Case P');
    const pdf = new Uint8Array(readFileSync(demoPath('discharge-summary-2026-03-12.pdf')));
    const d = await uploadDocument(db, extractor, c.id, { name: 'ds.pdf', mime: 'application/pdf', bytes: pdf }, { documentDate: '2026-03-12' });
    expect(d.status).toBe('extracted');
    expect(d.statementCount).toBeGreaterThan(5);
    await uploadDocument(db, extractor, c.id, { name: 'i.txt', mime: 'text/plain', bytes: enc('Allergies: No known drug allergies.') }, { documentDate: '2026-03-15' });
    await analyzeCase(db, c.id);
    const f = (await db.findings.where('caseId').equals(c.id).toArray()).find((x) => x.concept === 'allergy:penicillin')!;
    expect(f.evidence.find((e) => e.side === 'A')!.page).toBe(2);
  });

  it('rejects duplicates, empty and unsupported files, and invalid dates', async () => {
    const c = await createCase(db, 'Case D');
    const file = { name: 'a.txt', mime: 'text/plain', bytes: enc('Hypertension.') };
    await uploadDocument(db, extractor, c.id, file);
    await expect(uploadDocument(db, extractor, c.id, file)).rejects.toThrow(/identical/);
    await expect(uploadDocument(db, extractor, c.id, { name: 'e.txt', mime: 'text/plain', bytes: new Uint8Array() })).rejects.toThrow(UploadValidationError);
    await expect(uploadDocument(db, extractor, c.id, { name: 'x.exe', mime: '', bytes: enc('x') })).rejects.toThrow(/Unsupported/);
    await expect(uploadDocument(db, extractor, c.id, { name: 'b.txt', mime: 'text/plain', bytes: enc('x y z') }, { documentDate: '2026-02-30' })).rejects.toThrow(/valid document date/);
  });

  it('a blank scan (no text even after OCR) needs attention and yields no statements', async () => {
    const c = await createCase(db, 'Case S');
    const d = await uploadDocument(db, extractor, c.id, { name: 's.pdf', mime: 'application/pdf', bytes: new Uint8Array(readFileSync(demoPath('sample-scanned-no-text-layer.pdf'))) });
    expect(d.status).toBe('needs_attention');
    expect(d.statementCount).toBe(0);
    await expect(analyzeCase(db, c.id)).rejects.toThrow(/no documents with extracted text/);
  });
});

describe('review workflow and audit trail', () => {
  it('TEST 9/10/12: a finding can be inspected, transitioned, and each transition is audited', async () => {
    const c = await demo();
    const findings = await db.findings.where('caseId').equals(c.id).toArray();
    expect(findings).toHaveLength(10);
    const pen = findings.find((f) => f.concept === 'allergy:penicillin')!;
    expect(pen.evidence.length).toBeGreaterThanOrEqual(2);
    await transitionFinding(db, pen.id, 'in_review');
    const confirmed = await transitionFinding(db, pen.id, 'confirmed', { reason: 'Verified with patient' });
    expect(confirmed.reviewStatus).toBe('confirmed');
    const events = await db.events.where('findingId').equals(pen.id).sortBy('at');
    const changes = events.filter((e) => e.kind === 'status_changed');
    expect(changes.map((e) => `${e.fromStatus}->${e.toStatus}`)).toEqual(['unreviewed->in_review', 'in_review->confirmed']);
  });

  it('TEST 11: resolving or dismissing without a reason is rejected; invalid transitions are rejected', async () => {
    const c = await demo();
    const f = (await db.findings.where('caseId').equals(c.id).first())!;
    await expect(transitionFinding(db, f.id, 'resolved', { reason: 'ok fine' })).rejects.toThrow(ReviewError); // unreviewed -> resolved not allowed
    await transitionFinding(db, f.id, 'in_review');
    await expect(transitionFinding(db, f.id, 'resolved', { reason: '' })).rejects.toThrow(/reason/);
    await expect(transitionFinding(db, f.id, 'dismissed', { reason: '   ' })).rejects.toThrow(/reason/);
    await expect(transitionFinding(db, f.id, 'bogus' as any, { reason: 'whatever' })).rejects.toThrow(/Unknown review status/);
    expect((await db.findings.get(f.id))!.reviewStatus).toBe('in_review');
  });

  it('TEST 13: review decisions, notes and audit history survive a reload (new connection)', async () => {
    const c = await demo();
    const f = (await db.findings.where('caseId').equals(c.id).toArray()).find((x) => x.concept === 'medication:metformin')!;
    await transitionFinding(db, f.id, 'in_review');
    await addReviewerNote(db, f.id, 'Called prescriber; awaiting confirmation.');
    await transitionFinding(db, f.id, 'resolved', { reason: 'Prescriber confirmed 1000 mg is current; reconciliation record outdated.' });
    const name = db.name;
    db.close();
    const reopened = new MedguardDB(name);
    const again = (await reopened.findings.get(f.id))!;
    expect(again.reviewStatus).toBe('resolved');
    const evs = await reopened.events.where('findingId').equals(f.id).sortBy('at');
    expect(evs.map((e) => e.kind)).toEqual(['finding_created', 'status_changed', 'note_added', 'status_changed']);
    expect(evs[3].reason).toMatch(/Prescriber confirmed/);
    // Original evidence is preserved after resolution.
    expect(again.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('re-analysis preserves review status and marks removed-source findings stale (not deleted)', async () => {
    const c = await demo();
    const f = (await db.findings.where('caseId').equals(c.id).toArray()).find((x) => x.concept === 'other:smoking-status')!;
    await transitionFinding(db, f.id, 'in_review');
    const again = await analyzeCase(db, c.id);
    expect(again.findingsCreated).toBe(0);
    expect(again.findingsRetained).toBe(10);
    expect((await db.findings.get(f.id))!.reviewStatus).toBe('in_review');
    const intake = (await db.documents.where('caseId').equals(c.id).toArray()).find((d) => d.documentType === 'intake_form')!;
    await deleteDocument(db, intake.id);
    const after = await analyzeCase(db, c.id);
    expect(after.findingsSuperseded).toBeGreaterThan(0);
    const stale = await db.findings.get(f.id);
    expect(stale!.stale).toBe(true);
    expect(stale!.reviewStatus).toBe('in_review');
  });

  it('resetting the demo does not delete user-created cases', async () => {
    const mine = await createCase(db, 'My case');
    await demo();
    await demo();
    expect(await db.cases.get(mine.id)).toBeDefined();
    expect((await db.cases.toArray()).filter((c) => c.isDemo)).toHaveLength(1);
  });

  it('TEST 18 (data layer): search over findings uses real evidence text', async () => {
    const c = await demo();
    const { filterFindings } = await import('../../src/lib/query');
    const all = await db.findings.where('caseId').equals(c.id).toArray();
    expect(filterFindings(all, { search: 'no known drug allergies' }).map((f) => f.concept).sort()).toEqual(['allergy:penicillin', 'allergy:sulfonamide']);
    expect(filterFindings(all, { type: 'context_dependent' })).toHaveLength(1);
    expect(filterFindings(all, { category: 'lab' })).toHaveLength(1);
    expect(filterFindings(all, { status: 'unreviewed' })).toHaveLength(10);
    expect(filterFindings(all, { quality: 'limited' })).toHaveLength(2);
  });
});
