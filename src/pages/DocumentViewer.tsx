import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ExternalLink, Pencil, Save, ScanLine } from 'lucide-react';
import { db, useApp } from '../app/state';
import { Callout, EmptyState, Modal, PageSkeleton, ProcessingBadge, StatusBadge, cx } from '../components/ui';
import { formatDate, formatDateTime, isValidIsoDate } from '../lib/dates';
import { updateDocumentMeta } from '../lib/services';
import { getOriginalBlob, type RemoteSession } from '../lib/remote';
import { useWorkspace } from '../app/workspace';
import type { DocumentType, OcrSpan, PageSpan } from '../lib/types';
import { CATEGORY_LABEL, DOCUMENT_TYPE_LABEL, EXTRACTION_METHOD_LABEL } from '../lib/types';

export function DocumentViewer() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { toast } = useApp();
  const ws = useWorkspace();
  const doc = useLiveQuery(() => db.documents.get(id ?? '').then((d) => d ?? null), [id]);
  const statements = useLiveQuery(() => db.statements.where('documentId').equals(id ?? '').toArray(), [id]);
  const findings = useLiveQuery(() => (doc ? db.findings.where('caseId').equals(doc.caseId).toArray() : []), [doc?.caseId]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', documentType: 'other' as DocumentType, documentDate: '' });
  const markRef = useRef<HTMLElement | null>(null);
  const [previewPage, setPreviewPage] = useState<number | null>(null);

  const hl = useMemo(() => {
    const m = /^(\d+)-(\d+)$/.exec(params.get('hl') ?? '');
    return m ? { start: +m[1], end: +m[2] } : null;
  }, [params]);

  const textRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hl || !markRef.current || !textRef.current) return;
    const box = textRef.current;
    const mark = markRef.current;
    // Bring the text panel into view, then centre the highlighted passage inside it.
    const top = box.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    box.scrollTop = Math.max(0, mark.offsetTop - box.clientHeight / 2);
  }, [hl, doc?.id, doc?.extractedText, statements === undefined, findings === undefined]);

  if (doc === undefined || statements === undefined || findings === undefined) return <PageSkeleton />;
  if (doc === null) {
    return <EmptyState title="Document unavailable" body="This document has been removed or does not exist in this browser. Findings that referenced it keep the quotation recorded at analysis time." action={<Link className="btn-primary" to="/documents">Back to document library</Link>} />;
  }
  const validHl = hl && hl.start >= 0 && hl.end <= doc.extractedText.length && hl.start < hl.end ? hl : null;
  const related = findings.filter((f) => f.sourceDocumentIds.includes(doc.id) && !f.stale);

  const openOriginal = async () => {
    const blob = await getOriginalBlob(db, doc.id, ws.session);
    if (!blob) { toast('error', 'The original file is not available (not stored locally or on the shared workspace).'); return; }
    // Object URL is local to this browser session; there is no public URL.
    const url = URL.createObjectURL(blob);
    if (doc.fileKind === 'pdf') window.open(url, '_blank', 'noopener');
    else { const a = document.createElement('a'); a.href = url; a.download = doc.originalFilename; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const startEdit = () => { setForm({ title: doc.title, documentType: doc.documentType, documentDate: doc.documentDate ?? '' }); setEditing(true); };
  const saveEdit = async () => {
    if (form.documentDate && !isValidIsoDate(form.documentDate)) { toast('error', 'Enter a valid document date.'); return; }
    try {
      await updateDocumentMeta(db, doc.id, { title: form.title, documentType: form.documentType, documentDate: form.documentDate || null });
      setEditing(false);
      toast('success', 'Document details saved. Re-run analysis so findings reflect the change.');
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Save failed'); }
  };

  return (
    <div className="animate-fade-up">
      <Link to="/documents" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand"><ArrowLeft size={15} />Document library</Link>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <aside className="order-2 space-y-4 lg:order-2">
          <section className="card p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h1 className="text-lg font-semibold leading-snug" data-testid="doc-title">{doc.title}</h1>
              {!editing ? <button className="btn-ghost px-2 py-1" onClick={startEdit} aria-label="Edit document details"><Pencil size={15} /></button> : null}
            </div>
            {editing ? (
              <div className="space-y-3">
                <div><label className="label" htmlFor="e-title">Title</label><input id="e-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                <div><label className="label" htmlFor="e-type">Type</label><select id="e-type" className="input" value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as DocumentType })}>{(Object.keys(DOCUMENT_TYPE_LABEL) as DocumentType[]).map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABEL[t]}</option>)}</select></div>
                <div><label className="label" htmlFor="e-date">Document date</label><input id="e-date" type="date" className="input" value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} /></div>
                <div className="flex gap-2"><button className="btn-primary" onClick={saveEdit}><Save size={15} />Save</button><button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button></div>
              </div>
            ) : (
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted">Document ID</dt><dd className="break-all font-mono text-xs">{doc.id}</dd>
                <dt className="text-muted">Type</dt><dd>{DOCUMENT_TYPE_LABEL[doc.documentType]}</dd>
                <dt className="text-muted">Document date</dt><dd className="font-medium">{doc.documentDate ? formatDate(doc.documentDate) : <span className="text-warn">Not recorded</span>}</dd>
                <dt className="text-muted">Uploaded</dt><dd>{formatDateTime(doc.uploadedAt)}</dd>
                <dt className="text-muted">File</dt><dd className="break-all">{doc.originalFilename} · {(doc.sizeBytes / 1024).toFixed(1)} KB</dd>
                <dt className="text-muted">Status</dt><dd><ProcessingBadge status={doc.status} /></dd>
                <dt className="text-muted">Extraction</dt><dd>{doc.extractionMethod ? EXTRACTION_METHOD_LABEL[doc.extractionMethod] : '—'}</dd>
                <dt className="text-muted">Pages</dt><dd>{doc.pageCount ?? (doc.fileKind === 'image' ? 'Single image' : 'Not a paged format')}</dd>
                <dt className="text-muted">SHA-256</dt><dd className="truncate font-mono text-xs" title={doc.contentHash}>{doc.contentHash.slice(0, 16)}…</dd>
              </dl>
            )}
            {doc.fileKind === 'image' || doc.pageSpans.some((p) => p.method === 'ocr') ? <button className="btn-secondary mt-4 w-full" onClick={() => setPreviewPage(doc.pageSpans.find((p) => p.method === 'ocr')?.page ?? 1)} data-testid="compare-original"><ScanLine size={15} />Compare OCR text with original</button> : null}
            <button className="btn-secondary mt-2 w-full" onClick={openOriginal}><ExternalLink size={15} />{doc.fileKind === 'pdf' ? 'Open original PDF' : 'Download original file'}</button>
          </section>

          {doc.extractionErrors.map((e, i) => <Callout key={i} tone="warn" title="Extraction problem">{e}</Callout>)}
          {doc.extractionWarnings.map((e, i) => <Callout key={i} tone="warn" title="Extraction warning">{e}</Callout>)}

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">Extracted statements ({statements.length})</h2>
            <p className="mb-3 text-xs text-muted">Produced by deterministic rules. Select one to highlight its source text.</p>
            {statements.length === 0 ? <p className="text-sm text-muted">No clinical statements were identified.</p> : (
              <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {[...statements].sort((a, b) => a.charStart - b.charStart).map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setParams({ hl: `${s.charStart}-${s.charEnd}` }, { replace: true })} className={cx('w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors', validHl?.start === s.charStart && validHl?.end === s.charEnd ? 'border-brand bg-brand-50' : 'border-line hover:bg-soft')}>
                      <span className="font-semibold">{CATEGORY_LABEL[s.category]}</span> · {s.conceptLabel}{s.value ? `: ${s.value}` : ''}{s.polarity === 'negative' ? ' (negated)' : ''}{s.status === 'uncertain' ? ' (hedged)' : ''}{s.temporality === 'historical' ? ' (historical)' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">Associated findings ({related.length})</h2>
            {related.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="space-y-2">{related.map((f) => <li key={f.id}><Link to={`/findings/${f.id}`} className="block rounded-md border border-line p-2 text-sm hover:bg-soft"><span className="font-mono text-xs text-muted">{f.displayId}</span> {f.title}<div className="mt-1"><StatusBadge status={f.reviewStatus} /></div></Link></li>)}</ul>
            )}
          </section>
        </aside>

        <section className="card overflow-hidden lg:order-1 lg:col-span-2" aria-label="Extracted text">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-soft/50 px-5 py-3">
            <h2 className="text-sm font-semibold">Extracted text <span className="font-normal text-muted">(rendered as plain text; never as HTML)</span></h2>
            {validHl ? <span className="text-xs text-muted">Highlighting characters {validHl.start}–{validHl.end}</span> : null}
          </div>
          {!doc.extractedText ? (
            <div className="p-5"><EmptyState title="No extracted text" body={doc.extractionErrors[0] ?? 'Text could not be extracted from this file.'} /></div>
          ) : (
            <div ref={textRef} className="relative max-h-[75vh] overflow-auto py-3 font-mono text-[12.5px] leading-6" data-testid="doc-text">
              <ExtractedText text={doc.extractedText} pageSpans={doc.fileKind === 'pdf' ? doc.pageSpans : []} lowConf={doc.ocrLowConfidence ?? []} hl={validHl} markRef={markRef} onPreview={doc.fileKind === 'pdf' ? setPreviewPage : undefined} />
            </div>
          )}
        </section>
      </div>
      {previewPage != null ? <OriginalPreview docId={doc.id} fileKind={doc.fileKind} page={previewPage} session={ws.session} onClose={() => setPreviewPage(null)} /> : null}
    </div>
  );
}

function ExtractedText({ text, pageSpans, lowConf, hl, markRef, onPreview }: {
  text: string;
  pageSpans: PageSpan[];
  lowConf: OcrSpan[];
  hl: { start: number; end: number } | null;
  markRef: React.MutableRefObject<HTMLElement | null>;
  onPreview?: (page: number) => void;
}) {
  // Build line rows with global offsets, inserting verified page markers for PDFs.
  const rows: ReactNode[] = [];
  let offset = 0;
  let lineNo = 1;
  const pageStarts = new Map(pageSpans.map((p) => [p.start, p]));
  let firstMark = true;
  for (const line of text.split('\n')) {
    const start = offset;
    const end = start + line.length;
    const ps = pageStarts.get(start);
    if (ps) {
      rows.push(
        <div key={`p${start}`} className="my-2 flex items-center gap-2 px-5 font-sans text-[11px] font-semibold uppercase tracking-wider text-brand">
          <span className="h-px flex-1 bg-brand/20" />
          Page {ps.page} (verified){ps.method === 'ocr' ? <span className="chip bg-warn-50 normal-case tracking-normal text-warn">OCR{ps.ocrConfidence != null ? ` · mean confidence ${ps.ocrConfidence}%` : ''}</span> : null}
          {onPreview ? <button className="normal-case tracking-normal text-brand underline-offset-2 hover:underline" onClick={() => onPreview(ps.page)}>compare with original</button> : null}
          <span className="h-px flex-1 bg-brand/20" />
        </div>,
      );
    }
    // Split the line at highlight and low-confidence-word boundaries.
    const cuts = new Set<number>([start, end]);
    const inHl = hl && hl.start < end && hl.end > start;
    if (inHl) { cuts.add(Math.max(hl!.start, start)); cuts.add(Math.min(hl!.end, end)); }
    const lows = lowConf.filter((w) => w.start < end && w.end > start);
    for (const w of lows) { cuts.add(Math.max(w.start, start)); cuts.add(Math.min(w.end, end)); }
    const pts = [...cuts].sort((a, b) => a - b);
    const pieces: ReactNode[] = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      if (a === b) continue;
      let node: ReactNode = text.slice(a, b);
      const low = lows.find((w) => w.start <= a && w.end >= b);
      if (low) node = <span className="underline decoration-warn decoration-dotted decoration-2 underline-offset-4" title={`OCR confidence ${Math.round(low.confidence)}% — requires review`} data-testid="ocr-low">{node}</span>;
      if (inHl && a >= hl!.start && b <= hl!.end) {
        const isFirst = firstMark;
        firstMark = false;
        node = <mark key={a} className="evidence-hl active" ref={isFirst ? (el) => { markRef.current = el; } : undefined} data-testid="evidence-highlight">{node}</mark>;
      }
      pieces.push(<span key={a}>{node}</span>);
    }
    rows.push(
      <div key={start} className={cx('grid grid-cols-[3.5rem,1fr] px-2', inHl && 'bg-[#FFFBEB]')}>
        <span className="select-none pr-3 text-right text-slate-400">{lineNo}</span>
        <span className="whitespace-pre-wrap break-words pr-4">{line ? pieces : '\u00a0'}</span>
      </div>,
    );
    offset = end + 1;
    lineNo++;
  }
  return <>{rows}</>;
}

/** Renders the original page (PDF) or image so OCR text can be compared with the source. */
function OriginalPreview({ docId, fileKind, page, onClose, session }: { docId: string; fileKind: string; page: number; onClose: () => void; session: RemoteSession | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      const blob = await getOriginalBlob(db, docId, session);
      if (!blob) { setError('The original file is not available.'); return; }
      if (fileKind === 'image') { url = URL.createObjectURL(blob); setImgUrl(url); return; }
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', document.baseURI).href;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
      const pg = await pdf.getPage(page);
      const vp = pg.getViewport({ scale: 1.4 });
      const c = ref.current;
      if (!c || cancelled) return;
      c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      await pdf.destroy();
    })().catch(() => setError('The original page could not be rendered.'));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [docId, fileKind, page, session]);
  return (
    <Modal open onClose={onClose} title={fileKind === 'image' ? 'Original image' : `Original page ${page}`} wide>
      {error ? <p className="text-sm text-crit">{error}</p> : null}
      <div className="max-h-[70vh] overflow-auto rounded border border-line bg-slate-50" data-testid="original-preview">
        {fileKind === 'image' ? (imgUrl ? <img src={imgUrl} alt="Original scanned image" className="w-full" /> : null) : <canvas ref={ref} className="h-auto w-full" />}
      </div>
      <p className="mt-2 text-xs text-muted">Rendered locally from the stored original file. Compare it with the OCR text to verify characters, decimal points and units.</p>
    </Modal>
  );
}
