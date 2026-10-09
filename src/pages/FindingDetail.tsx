import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowLeft, BadgeCheck, BookMarked, Bot, CheckCircle2, CircleDot, ExternalLink, FileText, GitCompare,
  History, Lightbulb, MessageSquarePlus, RotateCcw, ShieldAlert, XCircle,
} from 'lucide-react';
import { db, useApp } from '../app/state';
import { Callout, EmptyState, Modal, PageSkeleton, PriorityTag, QualityIndicator, StatusBadge, TypeBadge, cx } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/dates';
import { MIN_REASON_LENGTH, TRANSITIONS, reasonRequired } from '../lib/review';
import { useReviewActions, useWorkspace } from '../app/workspace';
import { useLiveQuery as useLive } from 'dexie-react-hooks';
import type { DocumentRecord, EvidenceRef, Finding, ReviewStatus } from '../lib/types';
import { CATEGORY_LABEL, DOCUMENT_TYPE_LABEL, EXTRACTION_METHOD_LABEL, REVIEW_STATUS_LABEL } from '../lib/types';
import { describeEvent } from './Timeline';

const ACTION_META: Record<ReviewStatus, { label: string; icon: typeof CircleDot; cls: string; help: string }> = {
  in_review: { label: 'Begin review', icon: CircleDot, cls: 'btn-primary', help: 'Mark this finding as under active review.' },
  confirmed: { label: 'Confirm discrepancy', icon: AlertTriangle, cls: 'btn-secondary', help: 'Records that the documents genuinely disagree. It does not establish which statement is medically correct.' },
  resolved: { label: 'Mark as resolved', icon: CheckCircle2, cls: 'btn-secondary', help: 'The discrepancy has been reconciled (e.g. record corrected). A reason is required.' },
  dismissed: { label: 'Dismiss — not a contradiction', icon: XCircle, cls: 'btn-secondary', help: 'The flagged statements do not actually conflict. A reason is required.' },
  unreviewed: { label: 'Unreviewed', icon: CircleDot, cls: 'btn-secondary', help: '' },
};

export function FindingDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { caseId, reviewer, toast, setCaseId } = useApp();
  const ws = useWorkspace();
  const actions = useReviewActions();
  const finding = useLiveQuery(() => db.findings.get(id ?? ''), [id]);
  const caseRec = useLive(() => (finding ? db.cases.get(finding.caseId) : undefined), [finding?.caseId]);
  const docs = useLiveQuery(async () => (finding ? db.documents.bulkGet(finding.sourceDocumentIds) : []), [finding?.id, finding?.updatedAt]);
  const events = useLiveQuery(() => db.events.where('findingId').equals(id ?? '').sortBy('at'), [id]);
  const [pending, setPending] = useState<ReviewStatus | null>(null);

  useEffect(() => {
    // Opening a finding from another case (e.g. a bookmarked link) switches to that case.
    if (finding && finding.caseId !== caseId) setCaseId(finding.caseId);
  }, [finding, caseId, setCaseId]);
  useEffect(() => {
    if (location.hash === '#review' && finding) document.getElementById('review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, finding?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (finding === undefined || docs === undefined || events === undefined) {
    if (finding === undefined && docs !== undefined) {
      return <EmptyState icon={<ShieldAlert size={20} />} title="Finding not found" body="This finding does not exist in this browser's records. It may belong to a reset demo case." action={<Link className="btn-primary" to="/queue">Back to review queue</Link>} />;
    }
    return <PageSkeleton />;
  }
  const docMap = new Map((docs.filter(Boolean) as DocumentRecord[]).map((d) => [d.id, d]));
  const sideA = finding.evidence.filter((e) => e.side === 'A');
  const sideB = finding.evidence.filter((e) => e.side === 'B');
  const allowed = TRANSITIONS[finding.reviewStatus];

  const doTransition = async (to: ReviewStatus, reason?: string) => {
    try {
      await actions.transition(finding, caseRec, to, reason);
      toast('success', `${finding.displayId} → ${REVIEW_STATUS_LABEL[to]}. ${caseRec?.remote ? 'Saved to the shared workspace and recorded in its audit trail.' : "Saved to this browser's database and recorded in the audit trail."}`);
      setPending(null);
      return true;
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not save the decision.');
      return false;
    }
  };

  return (
    <div className="animate-fade-up" data-testid="finding-detail">
      <Link to="/queue" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand"><ArrowLeft size={15} />Review queue</Link>

      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{finding.displayId}</span>
          <span className="chip bg-soft text-ink">{CATEGORY_LABEL[finding.category]}</span>
          <TypeBadge type={finding.findingType} />
          <StatusBadge status={finding.reviewStatus} />
          {finding.isSeededDemo ? <span className="chip bg-ink text-white">Synthetic demo data</span> : null}
          {finding.origin === 'ai' ? <span className="chip bg-brand-50 text-brand-700 ring-1 ring-brand/20" data-testid="ai-badge">AI-assisted · quotes verified</span> : null}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="finding-title">{finding.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
          <QualityIndicator quality={finding.evidenceQuality} />
          <PriorityTag priority={finding.reviewPriority} />
          <span className="inline-flex items-center gap-1"><Bot size={13} aria-hidden />Detection: {finding.detectionMethod}</span>
          <span>Detected {formatDateTime(finding.createdAt)}</span>
        </div>
      </header>

      {finding.stale ? <div className="mb-4"><Callout tone="warn" title="Superseded finding">The latest analysis no longer produces this finding (a source document may have been removed or changed). The original evidence and review history below are preserved.</Callout></div> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card overflow-hidden" aria-labelledby="why">
            <div className="border-b border-line bg-soft/50 px-5 py-3">
              <h2 id="why" className="flex items-center gap-2 text-sm font-semibold"><Lightbulb size={16} className="text-brand" aria-hidden />Why this was flagged</h2>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <div className="eyebrow mb-1">{finding.origin === 'ai' ? <>AI-generated interpretation <span className="normal-case tracking-normal text-slate-400">· written by {finding.aiModel}; this explanation is not evidence — only the verified quotes below are</span></> : <>System explanation <span className="normal-case tracking-normal text-slate-400">· interpretation generated from a rules template, not quoted evidence</span></>}</div>
                <p className="text-[15px] leading-relaxed">{finding.explanation}</p>
              </div>
              <div className="rounded-lg bg-soft/60 px-3 py-2 text-sm"><span className="font-semibold">Comparison rule: </span><span className="text-ink/80">{finding.comparisonReason}</span></div>
            </div>
          </section>

          <section aria-labelledby="evidence" id="evidence">
            <h2 id="evidence" className="mb-3 flex items-center gap-2 text-base font-semibold"><GitCompare size={17} className="text-brand" aria-hidden />Source evidence <span className="text-xs font-normal text-muted">— exact quotations from extracted document text</span></h2>
            <div className="grid gap-4 md:grid-cols-2">
              <EvidenceColumn side="A" label={finding.sideALabel} refs={sideA} docs={docMap} />
              <EvidenceColumn side="B" label={finding.sideBLabel} refs={sideB} docs={docMap} />
            </div>
            <p className="mt-2 text-xs text-muted">{finding.evidenceQualityReason}</p>
          </section>

          <section className="card grid gap-5 p-5 md:grid-cols-2" aria-label="Context">
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History size={15} className="text-brand" aria-hidden />Temporal & contextual caveats</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink/85">{finding.contextualCaveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><BookMarked size={15} className="text-brand" aria-hidden />Alternative explanations to consider</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink/85">{finding.alternativeExplanations.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section id="review" className="card scroll-mt-20 p-5" aria-labelledby="review-h">
            <h2 id="review-h" className="mb-1 text-base font-semibold">Reviewer decision</h2>
            {caseRec?.remote ? (
              <p className="mb-3 text-xs text-muted">Shared case · {ws.session ? <>signed in as <span className="font-medium text-ink">{ws.session.user.displayName}</span> ({caseRec.remote.role}). Decisions are saved on the server with a server timestamp.</> : <span className="text-warn">sign in (About &amp; settings) to record decisions.</span>}</p>
            ) : (
              <p className="mb-3 text-xs text-muted">Local demo mode · reviewing as <span className="font-medium text-ink">{reviewer}</span> (self-declared, not authenticated).</p>
            )}
            <div className="mb-4 flex items-center gap-2 text-sm">Current status: <StatusBadge status={finding.reviewStatus} /></div>
            {caseRec?.remote?.role === 'viewer' ? <p className="mb-2 rounded-md bg-soft px-3 py-2 text-xs text-muted" data-testid="viewer-readonly">You have read-only (viewer) access to this case.</p> : null}
            <div className={cx('flex flex-col gap-2', caseRec?.remote?.role === 'viewer' && 'hidden')} data-testid="review-actions">
              {allowed.map((to) => {
                const m = ACTION_META[to];
                const label = to === 'in_review' && finding.reviewStatus !== 'unreviewed' ? 'Mark as unresolved (reopen)' : m.label;
                const Icon = to === 'in_review' && finding.reviewStatus !== 'unreviewed' ? RotateCcw : m.icon;
                return (
                  <button key={to} className={cx(m.cls, 'justify-start')} title={m.help} onClick={() => (reasonRequired(finding.reviewStatus, to) || to === 'confirmed' ? setPending(to) : void doTransition(to))}>
                    <Icon size={16} aria-hidden />{label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">Confirming a discrepancy records that the documents disagree. It does not establish which statement is medically correct.</p>
            {caseRec?.remote?.role === 'viewer' ? null : <NoteForm finding={finding} />}
          </section>

          <section className="card p-5" aria-labelledby="audit-h">
            <h2 id="audit-h" className="mb-3 flex items-center gap-2 text-base font-semibold"><BadgeCheck size={16} className="text-brand" aria-hidden />Audit history</h2>
            <ol className="space-y-3" data-testid="finding-audit">
              {[...events].reverse().map((e) => {
                const d = describeEvent(e, [finding], []);
                return (
                  <li key={e.id} className="animate-fade-up border-l-2 border-line pl-3">
                    <div className="text-sm font-medium">{e.kind === 'status_changed' ? <>{REVIEW_STATUS_LABEL[e.fromStatus!]} → {REVIEW_STATUS_LABEL[e.toStatus!]}</> : e.kind === 'note_added' ? 'Note added' : d.title}</div>
                    {e.reason ? <p className="mt-0.5 text-sm text-ink/80"><span className="font-medium">Reason:</span> {e.reason}</p> : null}
                    {e.note ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink/80">{e.note}</p> : null}
                    <div className="mt-0.5 text-xs text-muted">{formatDateTime(e.at)} · {e.actor}</div>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>

      <ReasonModal status={pending} from={finding.reviewStatus} onClose={() => setPending(null)} onSubmit={(reason) => doTransition(pending!, reason)} />
    </div>
  );
}

function EvidenceColumn({ side, label, refs, docs }: { side: 'A' | 'B'; label: string; refs: EvidenceRef[]; docs: Map<string, DocumentRecord> }) {
  return (
    <div className="flex flex-col gap-3" data-testid={`evidence-side-${side}`}>
      <div className="flex items-center gap-2">
        <span className={cx('flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white', side === 'A' ? 'bg-brand' : 'bg-ink')}>{side}</span>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      {refs.map((r) => <EvidenceCard key={r.statementId} ev={r} doc={docs.get(r.documentId)} side={side} />)}
    </div>
  );
}

function EvidenceCard({ ev, doc, side }: { ev: EvidenceRef; doc: DocumentRecord | undefined; side: 'A' | 'B' }) {
  const verified = !!doc && doc.extractedText.slice(ev.charStart, ev.charEnd) === ev.quote;
  const location = ev.page != null ? `Page ${ev.page} (verified PDF page${ev.ocrDerived ? ', OCR' : ''})` : null;
  return (
    <article className={cx('card animate-fade-up overflow-hidden border-t-4', side === 'A' ? 'border-t-brand' : 'border-t-ink')}>
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between gap-2"><span className="eyebrow">Source {side}</span>{ev.ocrDerived ? <span className="chip bg-warn-50 text-warn" data-testid="ocr-badge" title="This quotation was produced by OCR from a scanned image">OCR text{ev.ocrMinConfidence != null ? ` · min ${Math.round(ev.ocrMinConfidence)}%` : ''}</span> : null}</div>
        {doc ? (
          <Link to={`/documents/${doc.id}`} className="mt-0.5 inline-flex items-center gap-1.5 font-semibold hover:text-brand"><FileText size={15} aria-hidden />{ev.documentTitle}</Link>
        ) : (
          <div className="mt-0.5 font-semibold">{ev.documentTitle}</div>
        )}
        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Document date</dt><dd className="font-medium">{formatDate(ev.documentDate)}</dd>
          {doc ? <><dt className="text-muted">Uploaded</dt><dd>{formatDateTime(doc.uploadedAt)} <span className="text-slate-400">(not a clinical date)</span></dd></> : null}
          {doc ? <><dt className="text-muted">Type</dt><dd>{DOCUMENT_TYPE_LABEL[doc.documentType]} · {doc.fileKind.toUpperCase()}</dd></> : null}
          <dt className="text-muted">Location</dt>
          <dd data-testid="evidence-location">
            {location ?? <span className="text-muted">{doc?.fileKind === 'pdf' ? 'Source location unavailable' : 'Not a paged format'}</span>}
            {ev.line != null ? <span className="text-muted"> · line {ev.line} of extracted text</span> : null}
            {ev.paragraph != null ? <span className="text-muted"> · paragraph {ev.paragraph}</span> : null}
          </dd>
          <dt className="text-muted">Section</dt><dd>{ev.section ?? <span className="text-muted">No section heading identified</span>}</dd>
          <dt className="text-muted">Extraction</dt><dd>{ev.extractionMethod ? EXTRACTION_METHOD_LABEL[ev.extractionMethod] : 'Unknown'}</dd>
          <dt className="text-muted">Offsets</dt><dd className="font-mono">chars {ev.charStart}–{ev.charEnd}</dd>
        </dl>
      </div>
      <blockquote className="mx-4 my-3 rounded-lg border-l-4 border-warn bg-[#FFFBEB] px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink" data-testid="evidence-quote">
        “{ev.quote}”
      </blockquote>
      {ev.ocrDerived ? <p className="mx-4 -mt-1 mb-3 text-xs text-warn">OCR text requires review: characters, decimal points and units may be misread. Compare with the original page.</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-soft/40 px-4 py-2">
        {verified ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle2 size={13} aria-hidden />Quote verified against document text</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-warn"><AlertTriangle size={13} aria-hidden />{doc ? 'Document text has changed since analysis' : 'Source document unavailable (removed) — quotation preserved from analysis'}</span>
        )}
        {doc ? <Link to={`/documents/${doc.id}?hl=${ev.charStart}-${ev.charEnd}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline" data-testid="view-in-source">View in source<ExternalLink size={12} aria-hidden /></Link> : null}
      </div>
    </article>
  );
}

function ReasonModal({ status, from, onClose, onSubmit }: { status: ReviewStatus | null; from: ReviewStatus; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setTouched(false); }, [status]);
  if (!status) return null;
  const required = reasonRequired(from, status);
  const invalid = required && reason.trim().length < MIN_REASON_LENGTH;
  const title = status === 'in_review' ? 'Reopen finding' : ACTION_META[status].label;
  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    await onSubmit(reason);
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={title} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className={status === 'dismissed' ? 'btn-danger' : 'btn-primary'} onClick={submit} disabled={busy} data-testid="confirm-decision">{busy ? 'Saving…' : 'Record decision'}</button>
    </>}>
      <p className="mb-3 text-sm text-muted">{status === 'in_review' ? 'Explain why this finding needs further review (for example, new evidence emerged).' : ACTION_META[status].help}</p>
      <label htmlFor="reason" className="label">Reason {required ? <span className="text-crit">(required)</span> : <span className="normal-case tracking-normal">(optional)</span>}</label>
      <textarea id="reason" className={cx('input min-h-[110px]', touched && invalid && 'border-crit focus:border-crit focus:ring-crit/20')} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} placeholder="e.g. Verified with the prescribing clinician; intake form updated." maxLength={2000} aria-invalid={touched && invalid} aria-describedby="reason-err" data-testid="reason-input" />
      {touched && invalid ? <p id="reason-err" className="mt-1 text-xs font-medium text-crit" role="alert">A reason of at least {MIN_REASON_LENGTH} characters is required for this decision.</p> : null}
    </Modal>
  );
}

function NoteForm({ finding }: { finding: Finding }) {
  const { toast } = useApp();
  const actions = useReviewActions();
  const caseRec = useLive(() => db.cases.get(finding.caseId), [finding.caseId]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!note.trim()) { toast('error', 'Write a note before saving.'); return; }
    setBusy(true);
    try {
      await actions.note(finding, caseRec, note);
      setNote('');
      toast('success', 'Note saved to the audit trail.');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not save the note.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5 border-t border-line pt-4">
      <label htmlFor="note" className="label">Reviewer note</label>
      <textarea id="note" className="input min-h-[80px]" placeholder="Add context, a verification step, or who was contacted…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} data-testid="note-input" />
      <button className="btn-secondary mt-2 w-full" onClick={save} disabled={busy || !note.trim()} data-testid="save-note"><MessageSquarePlus size={16} aria-hidden />{busy ? 'Saving…' : 'Add note'}</button>
    </div>
  );
}
