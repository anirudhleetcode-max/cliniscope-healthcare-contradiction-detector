// Browser side of AI-assisted reasoning: sends the case text to the
// configured CLINISCOPE server (which holds the provider key), then
// re-verifies the returned structured output against the LOCAL copy of the
// documents before anything is stored.
import type { CliniscopeDB } from './db';
import { corroborates, verifyAiOutput } from './ai';
import { remoteApi, type RemoteSession } from './remote';
import { addAiFindings, logAiFailure } from './services';

export interface AiRunSummary { model: string; created: number; retained: number; corroborated: string[]; rejected: { title: string; reason: string }[]; downgraded: number; consistent: number }

export async function runAiAnalysis(db: CliniscopeDB, session: RemoteSession, caseId: string, actor: string): Promise<AiRunSummary> {
  const docs = (await db.documents.where('caseId').equals(caseId).toArray()).filter((d) => d.extractedText && d.status !== 'failed');
  if (!docs.length) throw new Error('There are no documents with extracted text to analyse.');
  const existing = (await db.findings.where('caseId').equals(caseId).toArray()).filter((f) => !f.stale);
  try {
    const res = await remoteApi.aiAnalyze(session, {
      caseId,
      documents: docs.map((d) => ({
        id: d.id, caseId: d.caseId, title: d.title, documentType: d.documentType, documentDate: d.documentDate, extractedText: d.extractedText,
        pageSpans: d.pageSpans, fileKind: d.fileKind, extractionMethod: d.extractionMethod, ocrRegions: d.ocrRegions ?? [], ocrLowConfidence: d.ocrLowConfidence ?? [],
      })),
      existing: existing.map((f) => ({ title: f.title, type: f.findingType })),
    });
    // Independent re-verification against the local document text.
    const v = verifyAiOutput(caseId, res.raw, docs, res.model);
    const corroborated: string[] = [];
    const fresh = v.accepted.filter((d) => {
      const hit = corroborates(d, existing);
      if (hit) corroborated.push(hit.displayId);
      return !hit;
    });
    const stored = await addAiFindings(db, caseId, fresh, { model: res.model, actor, rejected: v.rejected.length, corroborated, consistent: v.consistent.length, downgraded: v.downgraded });
    return { model: res.model, ...stored, corroborated, rejected: v.rejected, downgraded: v.downgraded, consistent: v.consistent.length };
  } catch (e) {
    await logAiFailure(db, caseId, actor, (e as Error).message).catch(() => {});
    throw e;
  }
}
