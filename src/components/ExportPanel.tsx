import { useState } from 'react';
import { Download, FileJson, FileSpreadsheet, Archive } from 'lucide-react';
import { db, useApp } from '../app/state';
import { buildBackup, buildCaseReport, buildFindingsCsv, downloadText, exportFilename } from '../lib/exportCase';
import type { CaseRecord } from '../lib/types';

/** Local exports. Everything is built in the browser from IndexedDB; nothing is uploaded. */
export function ExportPanel({ c }: { c: CaseRecord }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } catch (e) { toast('error', `Export failed: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  return (
    <section className="card p-5" aria-label="Export" data-testid="export-panel">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Download size={17} className="text-brand" aria-hidden />Export &amp; backup</h2>
      <p className="mb-3 text-xs text-muted">Generated locally from this browser's data{c.isDemo ? '; files are labelled SYNTHETIC' : ''}. Nothing is sent anywhere.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <button className="btn-secondary justify-start" disabled={!!busy} data-testid="export-report" onClick={() => run('report', async () => {
          const r = await buildCaseReport(db, c.id);
          downloadText(exportFilename(c, 'report', 'json'), JSON.stringify(r, null, 2), 'application/json');
          toast('success', `Case report exported: ${r.findings.length} findings with evidence, decisions and history.`);
        })}><FileJson size={15} />Case report (JSON)</button>
        <button className="btn-secondary justify-start" disabled={!!busy} data-testid="export-csv" onClick={() => run('csv', async () => {
          downloadText(exportFilename(c, 'findings', 'csv'), await buildFindingsCsv(db, c.id), 'text/csv;charset=utf-8');
          toast('success', 'Findings exported as CSV.');
        })}><FileSpreadsheet size={15} />Findings (CSV)</button>
        <button className="btn-secondary justify-start" disabled={!!busy} data-testid="export-backup" onClick={() => run('backup', async () => {
          const b = await buildBackup(db, c.id);
          downloadText(exportFilename(c, 'backup', 'json'), JSON.stringify(b), 'application/json');
          toast('success', `Backup exported (${b.documents.length} documents incl. ${b.files.length} original files). Restore it from Cases.`);
        })}><Archive size={15} />Full backup</button>
      </div>
      <p className="mt-2 text-[11px] text-muted">The report and CSV contain findings, source quotes, review decisions, notes and history. The backup also contains extracted text and original files and can be restored as a new case.</p>
    </section>
  );
}
