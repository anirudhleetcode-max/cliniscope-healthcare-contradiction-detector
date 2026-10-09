// Regression tests for shared-workspace sync safety (review findings #1-#5, #9, #11, #12).
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { openDb } from '../../server/db';
import { newDatabase } from './testDb';
import { MedguardDB } from '../../src/lib/db';
import { applySnapshot, markUnsynced, pullCase, pushCase, remoteApi, type RemoteSession } from '../../src/lib/remote';
import { analyzeCase, createCase, deleteDocument, uploadDocument, type Extractor } from '../../src/lib/services';
import { extractTxt } from '../../src/lib/extract';
import { findAllDates } from '../../src/lib/dates';
import { verifyAiOutput } from '../../src/lib/ai';
import { extractStatements } from '../../src/lib/statements';
import { makeDoc } from './helpers';

const extractor: Extractor = async (_k, bytes) => extractTxt(bytes);
const enc = (s: string) => new TextEncoder().encode(s);
let base = '';
let app: Awaited<ReturnType<typeof createApp>>;
let n = 0;

async function session(name: string): Promise<RemoteSession> {
  const email = `${name}-${++n}@example.test`;
  const r = await remoteApi.register(base, email, 'correct-horse-battery', name);
  return { serverUrl: base, ...r };
}

beforeAll(async () => {
  app = await createApp({ config: { ...loadConfig({}), allowRegistration: true, allowedOrigins: [] }, db: await openDb(await newDatabase()), ai: null, log: () => {} });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(() => app.close());

async function sharedCaseWithDoc(owner: RemoteSession, db: MedguardDB, text: string) {
  const c = await createCase(db, 'Shared sync test');
  await remoteApi.createCase(owner, c.id, c.label);
  await uploadDocument(db, extractor, c.id, { name: 'a.txt', mime: 'text/plain', bytes: enc(text) }, { documentDate: '2026-03-12' });
  await pushCase(db, owner, c.id);
  return c;
}

describe('shared-workspace sync safety', () => {
  it('a stale client push never deletes documents it has not seen (merge, not replace); deletions are explicit', async () => {
    const alice = await session('alice');
    const bob = await session('bob');
    const dbA = new MedguardDB(`sync-a-${n}`);
    const dbB = new MedguardDB(`sync-b-${n}`);
    const c = await sharedCaseWithDoc(alice, dbA, 'ALLERGIES\nPenicillin allergy documented.');
    await remoteApi.addMember(alice, c.id, bob.user.email, 'reviewer');
    await pullCase(dbB, bob, c.id);
    // Alice adds a second document; Bob, still on the old cache, uploads his own and pushes.
    await uploadDocument(dbA, extractor, c.id, { name: 'b.txt', mime: 'text/plain', bytes: enc('Allergies: No known drug allergies.') }, { documentDate: '2026-03-15' });
    await pushCase(dbA, alice, c.id);
    await uploadDocument(dbB, extractor, c.id, { name: 'c.txt', mime: 'text/plain', bytes: enc('Hypertension.') }, { documentDate: '2026-03-16' });
    const after = await pushCase(dbB, bob, c.id);
    expect(after.documents).toHaveLength(3); // Alice's document survived Bob's stale push
    expect((await dbB.documents.where('caseId').equals(c.id).count())).toBe(3); // and Bob's cache now has it
    // Explicit deletion removes it on the server.
    const victim = after.documents.find((d) => d.originalFilename === 'c.txt')!;
    await deleteDocument(dbB, victim.id);
    await markUnsynced(dbB, c.id, victim.id);
    const del = await pushCase(dbB, bob, c.id);
    expect(del.documents.map((d) => d.id)).not.toContain(victim.id);
    expect((await dbB.cases.get(c.id))!.remote!.unsynced).toBeFalsy();
  });

  it('while a case has unsynced changes, background pulls and other snapshots do not drop local work', async () => {
    const alice = await session('alice');
    const db = new MedguardDB(`sync-u-${n}`);
    const c = await sharedCaseWithDoc(alice, db, 'Hypertension.');
    const local = await uploadDocument(db, extractor, c.id, { name: 'local.txt', mime: 'text/plain', bytes: enc('Asthma.') });
    await markUnsynced(db, c.id);
    expect(await pullCase(db, alice, c.id)).toBeNull(); // pull suspended
    // A snapshot arriving from another action (e.g. a review transition) merges instead of replacing.
    await applySnapshot(db, base, await remoteApi.getCase(alice, c.id));
    expect(await db.documents.get(local.id)).toBeDefined();
    expect(await db.files.get(local.id)).toBeDefined();
    expect((await db.cases.get(c.id))!.remote!.unsynced).toBe(true);
    await pushCase(db, alice, c.id);
    expect((await remoteApi.getCase(alice, c.id)).documents.map((d) => d.id)).toContain(local.id);
  });

  it('original files download as blobs (not cached on error) and MIME types are derived server-side', async () => {
    const alice = await session('alice');
    const db = new MedguardDB(`sync-f-${n}`);
    const c = await sharedCaseWithDoc(alice, db, 'Hypertension.');
    const snap = await remoteApi.getCase(alice, c.id);
    const doc = snap.documents[0];
    const blob = await remoteApi.downloadFile(alice, c.id, doc.id);
    expect(await blob.text()).toBe('Hypertension.');
    await expect(remoteApi.downloadFile(alice, c.id, 'doc_doesnotexist1')).rejects.toMatchObject({ status: 404 });
    // A client claiming text/html for a document cannot make the server store it.
    const evil = { ...doc, mimeType: 'text/html' };
    const r = await remoteApi.snapshot(alice, c.id, { documents: [evil], statements: [], findings: [] });
    expect(r.documents[0].mimeType).toBe('text/plain');
    await expect(remoteApi.snapshot(alice, c.id, { documents: [{ ...doc, fileKind: 'html' as never }], statements: [], findings: [] })).rejects.toMatchObject({ status: 422 });
  });

  it('evidence citing a missing document cannot replace the evidence stored for an existing finding', async () => {
    const alice = await session('alice');
    const db = new MedguardDB(`sync-e-${n}`);
    const c = await sharedCaseWithDoc(alice, db, 'ALLERGIES\nPenicillin allergy documented.');
    await uploadDocument(db, extractor, c.id, { name: 'b.txt', mime: 'text/plain', bytes: enc('Allergies: No known drug allergies.') });
    await analyzeCase(db, c.id);
    const snap = await pushCase(db, alice, c.id);
    const f = snap.findings[0];
    const forged = { ...f, evidence: [{ ...f.evidence[0], documentId: 'doc_zzzzzzzzzzzz', quote: 'FABRICATED QUOTE' }] };
    await expect(remoteApi.snapshot(alice, c.id, { documents: [], statements: [], findings: [forged] })).rejects.toMatchObject({ status: 422 });
    expect((await remoteApi.getCase(alice, c.id)).findings[0].evidence[0].quote).not.toBe('FABRICATED QUOTE');
  });

  it('AI findings are superseded when a source document is removed', async () => {
    const db = new MedguardDB(`sync-ai-${n}`);
    const c = await createCase(db, 'AI stale');
    const a = await uploadDocument(db, extractor, c.id, { name: 'a.txt', mime: 'text/plain', bytes: enc('Patient reports shortness of breath.') });
    const b = await uploadDocument(db, extractor, c.id, { name: 'b.txt', mime: 'text/plain', bytes: enc('Denies shortness of breath.') });
    const docs = await db.documents.where('caseId').equals(c.id).toArray();
    const v = verifyAiOutput(c.id, { findings: [{ title: 'SOB', category: 'explicit_conflict', clinical_topic: 'history', explanation: 'x', reason_for_human_review: 'y', uncertainty: '', relevant_dates: [],
      evidence: [{ document_id: a.id, side: 'A', quote: 'Patient reports shortness of breath.' }, { document_id: b.id, side: 'B', quote: 'Denies shortness of breath.' }] }] }, docs, 'm');
    const { addAiFindings } = await import('../../src/lib/services');
    await addAiFindings(db, c.id, v.accepted, { model: 'm', actor: 't', rejected: 0, corroborated: [], consistent: 0, downgraded: 0 });
    await deleteDocument(db, b.id);
    await analyzeCase(db, c.id);
    expect((await db.findings.where('caseId').equals(c.id).first())!.stale).toBe(true);
  });
});

describe('date and OCR provenance helpers', () => {
  it('findAllDates returns every date in a quote', () => {
    expect(findAllDates('dose increased on 2024-03-01 (previously 2023-11-02)')).toEqual(['2024-03-01', '2023-11-02']);
    expect(findAllDates('HbA1c 8.2% in December 2025; repeat 11 March 2026')).toEqual(['2025-12', '2026-03-11']);
  });
  it('a quote that starts in text-layer text and runs into OCR text is marked OCR-derived', () => {
    const text = 'Page one line\n\nOCR words here.';
    const doc = makeDoc('c1', text, { id: 'doc_ocrmixed01', fileKind: 'pdf', pageSpans: [{ page: 1, start: 0, end: 13 }, { page: 2, start: 15, end: text.length }], ocrRegions: [{ start: 15, end: text.length, confidence: 90 }] });
    const v = verifyAiOutput('c1', { findings: [{ title: 't', category: 'insufficient_evidence', clinical_topic: 'other', explanation: '', reason_for_human_review: '', uncertainty: '', relevant_dates: [], evidence: [{ document_id: doc.id, side: 'A', quote: 'line\n\nOCR words' }] }] }, [doc], 'm');
    expect(v.accepted[0].evidence[0].ocrDerived).toBe(true);
    expect(extractStatements(doc)).toBeDefined();
  });
});
