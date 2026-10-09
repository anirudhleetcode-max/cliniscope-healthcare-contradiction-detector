import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, FileText, FileUp, Loader2, Trash2, UploadCloud, X, XCircle } from 'lucide-react';
import { db, extractor, useApp, useCaseData } from '../app/state';
import { AnalyzeButton } from '../components/AnalyzeButton';
import { Callout, EmptyState, Modal, PageHeader, PageSkeleton, ProcessingBadge, cx } from '../components/ui';
import { findDate, formatDate, formatDateTime, isValidIsoDate } from '../lib/dates';
import { DEFAULT_MAX_UPLOAD_BYTES } from '../lib/extract';
import { analyzeCase, deleteDocument, uploadDocument } from '../lib/services';
import { markUnsynced, withLocalWork } from '../lib/remote';
import { useWorkspace } from '../app/workspace';
import type { AnalysisSummary, DocumentRecord, DocumentType } from '../lib/types';
import { DOCUMENT_TYPE_LABEL } from '../lib/types';

const MAX_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB) || DEFAULT_MAX_UPLOAD_BYTES / 1048576;

interface Staged {
  key: string;
  file: File;
  title: string;
  documentType: DocumentType;
  documentDate: string;
  state: 'ready' | 'working' | 'done' | 'error';
  message?: string;
}

function guessType(name: string): DocumentType {
  const n = name.toLowerCase();
  if (n.includes('discharge')) return 'discharge_summary';
  if (n.includes('intake')) return 'intake_form';
  if (n.includes('reconcil')) return 'medication_reconciliation';
  if (n.includes('lab')) return 'lab_report';
  if (n.includes('prescri') || n.includes('rx')) return 'prescription';
  if (n.includes('allerg')) return 'allergy_record';
  if (n.includes('note')) return 'clinical_note';
  return 'other';
}

function guessDate(name: string): string {
  const d = findDate(name.replace(/_/g, '-'));
  return d && isValidIsoDate(d) ? d : '';
}

export function Documents() {
  const { caseId, currentCase, reviewer, toast } = useApp();
  const ws = useWorkspace();
  const { documents, findings, loading } = useCaseData(caseId);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [processing, setProcessing] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [toDelete, setToDelete] = useState<DocumentRecord | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!currentCase || loading) return <PageSkeleton />;

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 20).map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\d{4} \d{2} \d{2}\b/, '').trim().slice(0, 120) || file.name,
      documentType: guessType(file.name),
      documentDate: guessDate(file.name),
      state: 'ready' as const,
    }));
    setStaged((s) => [...s, ...list]);
    setSummary(null);
  };

  const patch = (key: string, p: Partial<Staged>) => setStaged((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const process = async () => {
    if (!caseId) return;
    if (currentCase?.remote) {
      try { ws.requireSession(); } catch (e) { toast('error', (e as Error).message); return; }
    }
    setProcessing(true);
    await withLocalWork(() => processInner(caseId));
    setProcessing(false);
  };

  const processInner = async (caseId: string) => {
    setSummary(null);
    let ok = 0;
    for (const s of staged.filter((x) => x.state === 'ready' || x.state === 'error')) {
      if (s.documentDate && !isValidIsoDate(s.documentDate)) { patch(s.key, { state: 'error', message: 'Invalid document date.' }); continue; }
      patch(s.key, { state: 'working', message: 'Reading file and extracting text…' });
      try {
        const bytes = new Uint8Array(await s.file.arrayBuffer());
        const doc = await uploadDocument(db, extractor, caseId, { name: s.file.name, mime: s.file.type, bytes }, { title: s.title, documentType: s.documentType, documentDate: s.documentDate || null }, { actor: reviewer, maxBytes: MAX_MB * 1048576, onProgress: (stage) => patch(s.key, { message: `${stage}…` }) });
        if (doc.status === 'failed' || (doc.status === 'needs_attention' && !doc.extractedText)) {
          patch(s.key, { state: 'error', message: doc.extractionErrors[0] ?? 'Extraction failed.' });
        } else {
          ok++;
          const ocrPages = doc.pageSpans.filter((p) => p.method === 'ocr').map((p) => p.page);
          const ocrNote = doc.extractionMethod === 'image-ocr' ? ' via OCR' : ocrPages.length ? ` (OCR on page${ocrPages.length > 1 ? 's' : ''} ${ocrPages.join(', ')})` : '';
          patch(s.key, { state: 'done', message: `${doc.statementCount} statement(s) extracted${doc.pageCount ? ` from ${doc.pageCount} page(s)` : ''}${ocrNote}${doc.extractionWarnings.length ? ' — completed with warnings: ' + doc.extractionWarnings[0] : ''}` });
        }
      } catch (e) {
        patch(s.key, { state: 'error', message: e instanceof Error ? e.message : 'Upload failed.' });
      }
    }
    if (ok && autoAnalyze) {
      try {
        const sum = await analyzeCase(db, caseId, ws.session?.user.displayName ?? reviewer);
        setSummary(sum);
        toast('success', `Analysis complete: ${sum.findingsTotalActive} finding(s), ${sum.findingsCreated} new.`);
      } catch (e) {
        toast('error', `Analysis failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    } else if (ok) {
      toast('success', `${ok} document(s) uploaded. Run analysis to compare them.`);
    }
    if (ok && currentCase?.remote) {
      try {
        await ws.push(caseId, { analyzed: autoAnalyze, detail: `${ok} document(s) uploaded${autoAnalyze ? ' and analysed' : ''} by ${ws.session?.user.displayName}` });
        toast('success', 'Documents, extracted text, findings and original files synchronized to the shared workspace.');
      } catch (e) {
        toast('error', `Saved locally, but synchronization failed: ${(e as Error).message}`);
      }
    }
  };

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };
  const findingCount = (docId: string) => findings!.filter((f) => !f.stale && f.sourceDocumentIds.includes(docId)).length;
  const pendingCount = staged.filter((s) => s.state === 'ready' || s.state === 'error').length;

  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow="Document library" title="Case records" description="Original files are stored separately from their extracted text and the statements derived from it. Uploaded content is treated as untrusted data and is never executed or rendered as HTML." actions={<AnalyzeButton disabled={!documents!.length} onDone={setSummary} />} />

      <section className="card mb-6 p-5" aria-label="Upload documents">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cx('flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors', drag ? 'border-brand bg-brand-50' : 'border-line bg-soft/40')}
        >
          <UploadCloud size={28} className="text-brand" aria-hidden />
          <p className="mt-2 text-sm font-medium">Drag and drop files here, or</p>
          <button className="btn-primary mt-2" onClick={() => input.current?.click()} data-testid="choose-files"><FileUp size={16} aria-hidden />Choose files</button>
          <input ref={input} type="file" multiple accept=".pdf,.txt,.docx,.png,.jpg,.jpeg,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg" className="sr-only" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} data-testid="file-input" aria-label="Choose files to upload" />
          <p className="mt-3 text-xs text-muted">PDF (digital or scanned), PNG/JPEG scans, TXT (UTF-8) or DOCX · up to {MAX_MB} MB each · scanned pages are read with on-device OCR (Tesseract.js); OCR text is marked for review</p>
          <p className="mt-1 text-xs text-muted">Synthetic test files: <a className="font-medium text-brand hover:underline" href="./demo/sample-follow-up-note-2026-03-20.txt" download>follow-up note (TXT)</a> · <a className="font-medium text-brand hover:underline" href="./demo/sample-mixed-text-and-scan-2026-03-22.pdf" download>mixed digital + scanned PDF</a> · <a className="font-medium text-brand hover:underline" href="./demo/sample-scanned-no-text-layer.pdf" download>blank scan (no readable text)</a></p>
        </div>

        {staged.length ? (
          <div className="mt-4">
            <ul className="space-y-3" data-testid="staged-list">
              {staged.map((s) => (
                <li key={s.key} className="rounded-lg border border-line p-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 text-muted">{s.state === 'working' ? <Loader2 size={18} className="animate-spin text-brand" /> : s.state === 'done' ? <CheckCircle2 size={18} className="text-ok" /> : s.state === 'error' ? <XCircle size={18} className="text-crit" /> : <FileText size={18} />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{s.file.name} <span className="text-xs font-normal text-muted">({(s.file.size / 1024).toFixed(1)} KB)</span></span>
                        {s.state !== 'working' && s.state !== 'done' ? <button className="btn-ghost px-1.5 py-1" onClick={() => setStaged((x) => x.filter((y) => y.key !== s.key))} aria-label={`Remove ${s.file.name}`}><X size={15} /></button> : null}
                      </div>
                      {s.state === 'ready' || s.state === 'error' ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <div><label className="label" htmlFor={`t-${s.key}`}>Title</label><input id={`t-${s.key}`} className="input" value={s.title} maxLength={120} onChange={(e) => patch(s.key, { title: e.target.value })} /></div>
                          <div><label className="label" htmlFor={`ty-${s.key}`}>Document type</label><select id={`ty-${s.key}`} className="input" value={s.documentType} onChange={(e) => patch(s.key, { documentType: e.target.value as DocumentType })}>{(Object.keys(DOCUMENT_TYPE_LABEL) as DocumentType[]).map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABEL[t]}</option>)}</select></div>
                          <div><label className="label" htmlFor={`d-${s.key}`}>Document date</label><input id={`d-${s.key}`} type="date" className="input" value={s.documentDate} onChange={(e) => patch(s.key, { documentDate: e.target.value })} data-testid="staged-date" /></div>
                        </div>
                      ) : null}
                      {s.message ? <p className={cx('mt-1.5 text-xs', s.state === 'error' ? 'font-medium text-crit' : 'text-muted')} role={s.state === 'error' ? 'alert' : undefined}>{s.message}</p> : null}
                      {s.state === 'ready' && !s.documentDate ? <p className="mt-1 text-xs text-warn">No document date entered. The upload time will not be used as a clinical date; temporal comparisons will be limited.</p> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} />Analyze the case after upload</label>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setStaged([])} disabled={processing}>Clear list</button>
                <button className="btn-primary" onClick={process} disabled={processing || pendingCount === 0} data-testid="upload-submit">{processing ? <><Loader2 size={16} className="animate-spin" />Processing…</> : <><UploadCloud size={16} />Upload & extract {pendingCount ? `(${pendingCount})` : ''}</>}</button>
              </div>
            </div>
          </div>
        ) : null}

        {summary ? (
          <div className="mt-4 animate-fade-up" data-testid="upload-summary">
            <Callout tone="safe" title="Analysis complete">
              {summary.documentsAnalyzed} documents · {summary.statementsExtracted} statements · {summary.comparisonsEvaluated} comparisons evaluated · {summary.consistentComparisons} consistent · {summary.temporallyExplainedComparisons} explained by dates · <strong>{summary.findingsTotalActive} findings</strong> ({summary.findingsCreated} new{summary.findingsSuperseded ? `, ${summary.findingsSuperseded} superseded` : ''}). <Link to="/queue" className="font-semibold text-brand hover:underline">Open the review queue →</Link>
            </Callout>
          </div>
        ) : null}
      </section>

      {documents!.length === 0 ? (
        <EmptyState title="No documents in this case" body="Upload discharge summaries, intake forms, medication lists or lab reports to compare them." />
      ) : (
        <section className="card overflow-hidden" aria-label="Documents">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm" data-testid="documents-table">
              <thead className="border-b border-line bg-soft/60 text-xs uppercase tracking-wide text-muted">
                <tr>
                  {['Document', 'Document date', 'Uploaded', 'Status', 'Extracted text', 'Statements', 'Findings', ''].map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...documents!].sort((a, b) => (a.documentDate ?? '').localeCompare(b.documentDate ?? '')).map((d) => (
                  <tr key={d.id} className="align-top hover:bg-soft/30">
                    <td className="px-4 py-3">
                      <Link to={`/documents/${d.id}`} className="font-medium hover:text-brand">{d.title}</Link>
                      <div className="text-xs text-muted">{DOCUMENT_TYPE_LABEL[d.documentType]} · <span className="font-mono uppercase">{d.fileKind}</span> · {(d.sizeBytes / 1024).toFixed(1)} KB</div>
                      {d.extractionErrors.length ? <div className="mt-1 max-w-sm text-xs text-crit">{d.extractionErrors[0]}</div> : null}
                      {d.extractionWarnings.length ? <div className="mt-1 max-w-sm text-xs text-warn">{d.extractionWarnings[0]}</div> : null}
                    </td>
                    <td className="px-4 py-3">{d.documentDate ? formatDate(d.documentDate) : <span className="text-warn">Not recorded</span>}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDateTime(d.uploadedAt)}</td>
                    <td className="px-4 py-3"><ProcessingBadge status={d.status} /></td>
                    <td className="px-4 py-3 text-xs">{d.extractedText ? <span className="text-ok">{d.extractedText.length.toLocaleString()} chars{d.pageCount ? ` · ${d.pageCount} pp` : ''}</span> : <span className="text-crit">None</span>}{d.extractionMethod && /ocr/.test(d.extractionMethod) ? <div className="mt-1"><span className="chip bg-warn-50 text-warn" title="Text produced by OCR — verify against the original">OCR{d.ocrLowConfidence?.length ? ` · ${d.ocrLowConfidence.length} low-confidence` : ''}</span></div> : null}</td>
                    <td className="px-4 py-3 tabular-nums">{d.statementCount}</td>
                    <td className="px-4 py-3 tabular-nums">{findingCount(d.id)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Link to={`/documents/${d.id}`} className="btn-ghost px-2 py-1 text-xs">Inspect</Link>
                        <button className="btn-ghost px-2 py-1 text-crit" onClick={() => setToDelete(d)} aria-label={`Delete ${d.title}`}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Remove document?" footer={<>
        <button className="btn-secondary" onClick={() => setToDelete(null)}>Cancel</button>
        <button className="btn-danger" data-testid="confirm-delete" onClick={async () => {
          if (!toDelete) return;
          try {
            await withLocalWork(async () => {
              await deleteDocument(db, toDelete.id, reviewer);
              if (currentCase?.remote) {
                await markUnsynced(db, toDelete.caseId, toDelete.id);
                await ws.push(toDelete.caseId, { detail: `${toDelete.title} removed` });
              }
            });
            toast('success', `${toDelete.title} removed. Re-run analysis to reconcile findings.`);
          } catch (e) { toast('error', e instanceof Error ? e.message : 'Delete failed'); }
          setToDelete(null);
        }}><Trash2 size={15} />Remove</button>
      </>}>
        <p className="text-sm">This removes <strong>{toDelete?.title}</strong>, its stored file and its extracted statements from this case. Existing findings keep the evidence quotations recorded at analysis time and are marked superseded at the next analysis. The audit log keeps a record of the removal.</p>
      </Modal>
      <p className="mt-4 inline-flex items-center gap-1 text-xs text-muted"><Download size={12} aria-hidden />Files are stored only in this browser (IndexedDB). They are not uploaded to any server and have no public URL.</p>
    </div>
  );
}
