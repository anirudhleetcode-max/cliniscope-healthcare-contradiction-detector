import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MedguardDB } from '../../src/lib/db';
import { BackupError, buildBackup, buildCaseReport, buildFindingsCsv, restoreBackup } from '../../src/lib/exportCase';
import { addReviewerNote, analyzeCase, createCase, seedDemoCase, transitionFinding, uploadDocument, type Extractor } from '../../src/lib/services';
import { demoPath, extractFile } from './helpers';
import { terminateOcr } from './nodeOcr';
import { afterAll } from 'vitest';

afterAll(() => terminateOcr());
const extractor: Extractor = (kind, bytes) => extractFile(`x.${kind}`, bytes);
let n = 0;

async function reviewedDemo() {
  const db = new MedguardDB(`export-${++n}`);
  const { DEMO_MANIFEST } = await import('../../scripts/demo-content.mjs');
  const c = await seedDemoCase(db, extractor, DEMO_MANIFEST.map((meta: any) => ({ meta, bytes: new Uint8Array(readFileSync(demoPath(meta.file))) })));
  await analyzeCase(db, c.id);
  const findings = await db.findings.where('caseId').equals(c.id).toArray();
  const pen = findings.find((f) => f.concept === 'allergy:penicillin')!;
  await transitionFinding(db, pen.id, 'in_review', { reviewer: 'Dr. Synthetic A' });
  await addReviewerNote(db, pen.id, 'Checked with patient: hives in 2019.', 'Dr. Synthetic A');
  await transitionFinding(db, pen.id, 'confirmed', { reason: 'Records genuinely disagree.', reviewer: 'Dr. Synthetic A' });
  return { db, c, pen };
}

describe('local exports', () => {
  it('JSON case report contains findings, evidence, decisions, notes, history, mode and classification', async () => {
    const { db, c, pen } = await reviewedDemo();
    const r = await buildCaseReport(db, c.id);
    expect(r.format).toBe('medguard-case-report');
    expect(r.dataClassification).toMatch(/SYNTHETIC DEMONSTRATION DATA/);
    expect(r.mode.kind).toBe('local-demo-mode');
    expect(r.documents).toHaveLength(5);
    expect(r.findings).toHaveLength(10);
    const f = r.findings.find((x) => x.id === pen.id)!;
    expect(f.reviewStatus).toBe('confirmed');
    expect(f.reviewerNotes[0]).toMatchObject({ by: 'Dr. Synthetic A', note: 'Checked with patient: hives in 2019.' });
    expect(f.reviewHistory.map((h) => h.event)).toEqual(['finding_created', 'status_changed', 'note_added', 'status_changed']);
    expect(f.evidence.some((e) => e.documentTitle === 'Discharge Summary' && e.page === 2)).toBe(true);
    expect(r.summary.byStatus.confirmed).toBe(1);
    expect(JSON.stringify(r)).not.toContain('extractedText'); // report carries metadata and quotes, not full documents
  }, 60000);

  it('CSV lists every finding with status, decision reason, notes and source documents; neutralises formulas', async () => {
    const { db, c, pen } = await reviewedDemo();
    await addReviewerNote(db, pen.id, '=HYPERLINK("http://evil")', 'Dr. Synthetic A');
    const csv = await buildFindingsCsv(db, c.id);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toMatch(/SYNTHETIC/);
    expect(lines).toHaveLength(3 + 10);
    const row = lines.find((l) => l.includes(pen.displayId))!;
    expect(row).toContain('Confirmed discrepancy');
    expect(row).toContain('Records genuinely disagree.');
    expect(row).toContain('Discharge Summary');
    expect(csv).not.toMatch(/"=HYPERLINK/);
  }, 60000);
});

describe('backup and restore', () => {
  it('restores as a NEW case with reassigned IDs, intact review state, history and original files', async () => {
    const { db, c, pen } = await reviewedDemo();
    const backup = JSON.parse(JSON.stringify(await buildBackup(db, c.id)));
    const restored = await restoreBackup(db, backup);
    expect(restored.id).not.toBe(c.id);
    expect(await db.cases.get(c.id)).toBeDefined(); // original untouched
    const fs = await db.findings.where('caseId').equals(restored.id).toArray();
    expect(fs).toHaveLength(10);
    const rp = fs.find((f) => f.displayId === pen.displayId)!;
    expect(rp.id).not.toBe(pen.id);
    expect(rp.reviewStatus).toBe('confirmed');
    const docs = await db.documents.where('caseId').equals(restored.id).toArray();
    for (const e of rp.evidence) expect(docs.find((d) => d.id === e.documentId)!.extractedText.slice(e.charStart, e.charEnd)).toBe(e.quote);
    const ev = await db.events.where('findingId').equals(rp.id).toArray();
    expect(ev.some((e) => e.kind === 'note_added' && e.note === 'Checked with patient: hives in 2019.')).toBe(true);
    expect(await db.files.where('caseId').equals(restored.id).count()).toBe(5);
  }, 60000);

  it('rejects invalid, edited or corrupted backups without writing anything', async () => {
    const { db, c } = await reviewedDemo();
    const good = JSON.parse(JSON.stringify(await buildBackup(db, c.id)));
    const before = await db.cases.count();
    await expect(restoreBackup(db, { hello: 'world' })).rejects.toThrow(BackupError);
    const editedQuote = structuredClone(good);
    editedQuote.findings[0].evidence[0].quote = 'Patient has no allergies at all.';
    await expect(restoreBackup(db, editedQuote)).rejects.toThrow(/does not match its source/);
    const editedFile = structuredClone(good);
    editedFile.files[0].base64 = btoa('tampered');
    await expect(restoreBackup(db, editedFile)).rejects.toThrow(/SHA-256/);
    const editedStatement = structuredClone(good);
    editedStatement.statements[0].originalText = 'invented';
    await expect(restoreBackup(db, editedStatement)).rejects.toThrow(/statement/);
    expect(await db.cases.count()).toBe(before);
  }, 60000);

  it('round-trips a user case with a TXT upload', async () => {
    const db = new MedguardDB(`export-txt-${++n}`);
    const c = await createCase(db, 'User case');
    await uploadDocument(db, extractor, c.id, { name: 'a.txt', mime: 'text/plain', bytes: new TextEncoder().encode('Hypertension.') });
    const r = await restoreBackup(db, JSON.parse(JSON.stringify(await buildBackup(db, c.id))));
    expect((await db.documents.where('caseId').equals(r.id).first())!.extractedText).toBe('Hypertension.');
    expect((await buildCaseReport(db, c.id)).dataClassification).toMatch(/User-provided/);
  });
});
