// Clinical review building blocks shared by the finding page, the review queue,
// the case workspace and the contradictions drawer.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertOctagon, AlertTriangle, BadgeCheck, CheckCircle2, CircleDot, CircleHelp, ExternalLink, FileText, GitCompareArrows, History,
  MessageSquarePlus, RotateCcw, XCircle,
} from 'lucide-react';
import { db, useApp } from '../../app/state';
import { useReviewActions, useWorkspace } from '../../app/workspace';
import { Badge, cx, Modal, StatusBadge } from '../ui';
import { formatDate, formatDateTime } from '../../lib/dates';
import { MIN_REASON_LENGTH, reasonRequired, transitionsFor } from '../../lib/review';
import type { AuditEvent, CaseRecord, DocumentRecord, EvidenceRef, Finding, ReviewStatus } from '../../lib/types';
import { DOCUMENT_TYPE_LABEL, EXTRACTION_METHOD_LABEL, REVIEW_STATUS_LABEL } from '../../lib/types';

// ------------------------------------------------------------ evidence
/** Splits a quote so the concept phrase is highlighted (only the relevant words, never the whole paragraph). */
function highlight(quote: string, terms: string[]): ReactNode {
  const words = terms.flatMap((t) => t.toLowerCase().split(/[\s/()]+/)).filter((w) => w.length > 2);
  if (!words.length) return quote;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return quote.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded-sm bg-[#FFE7A3] px-0.5 text-ink">{part}</mark> : part));
}

export function EvidenceComparison({ finding, docs, compact }: { finding: Finding; docs: Map<string, DocumentRecord>; compact?: boolean }) {
  const sideA = finding.evidence.filter((e) => e.side === 'A');
  const sideB = finding.evidence.filter((e) => e.side === 'B');
  const terms = [finding.concept.split(':')[1]?.replace(/-/g, ' ') ?? '', ...(finding.title.match(/^[A-Z][a-z]+/) ?? [])];
  return (
    <section aria-label="Source evidence" data-testid="evidence-comparison">
      <div className={cx('grid gap-4', !compact && 'md:grid-cols-2')}>
        <EvidenceColumn side="A" label={finding.sideALabel} refs={sideA} docs={docs} terms={terms} compact={compact} />
        <EvidenceColumn side="B" label={finding.sideBLabel} refs={sideB} docs={docs} terms={terms} compact={compact} />
      </div>
      <p className="mt-2.5 text-xs text-muted">{finding.evidenceQualityReason}</p>
    </section>
  );
}

function EvidenceColumn({ side, label, refs, docs, terms, compact }: { side: 'A' | 'B'; label: string; refs: EvidenceRef[]; docs: Map<string, DocumentRecord>; terms: string[]; compact?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid={`evidence-side-${side}`}>
      <div className="flex items-center gap-2">
        <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white', side === 'A' ? 'bg-brand' : 'bg-ink')} aria-hidden>{side}</span>
        <span className="text-[13.5px] font-semibold">{label}</span>
      </div>
      {refs.map((r) => <EvidenceCard key={r.statementId} ev={r} doc={docs.get(r.documentId)} side={side} terms={terms} compact={compact} />)}
    </div>
  );
}

export function EvidenceCard({ ev, doc, side, terms, compact }: { ev: EvidenceRef; doc: DocumentRecord | undefined; side: 'A' | 'B'; terms: string[]; compact?: boolean }) {
  const verified = !!doc && doc.extractedText.slice(ev.charStart, ev.charEnd) === ev.quote;
  const location = ev.page != null ? `Page ${ev.page} (verified PDF page${ev.ocrDerived ? ', OCR' : ''})` : null;
  return (
    <article className={cx('card overflow-hidden border-l-[3px]', side === 'A' ? 'border-l-brand' : 'border-l-ink')}>
      <div className="px-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="eyebrow">Source {side}</div>
            {doc ? (
              <Link to={`/documents/${doc.id}`} className="mt-0.5 inline-flex items-center gap-1.5 text-[14px] font-semibold hover:text-brand"><FileText size={15} className="shrink-0 text-faint" aria-hidden /><span className="truncate">{ev.documentTitle}</span></Link>
            ) : <div className="mt-0.5 text-[14px] font-semibold">{ev.documentTitle}</div>}
          </div>
          {ev.ocrDerived ? <Badge tone="warn" testId="ocr-badge" title="This quotation was produced by OCR from a scanned image">OCR text{ev.ocrMinConfidence != null ? ` · min ${Math.round(ev.ocrMinConfidence)}%` : ''}</Badge> : null}
        </div>
      </div>
      <blockquote className="mx-4 my-3 rounded-lg border border-[#F3E2B5] bg-[#FFFBEF] px-3.5 py-2.5 text-[14px] leading-relaxed text-ink" data-testid="evidence-quote">
        “{highlight(ev.quote, terms)}”
      </blockquote>
      {ev.ocrDerived ? <p className="mx-4 -mt-1 mb-3 text-xs text-warn">OCR text requires review: characters, decimal points and units may be misread. Compare with the original page.</p> : null}
      <dl className={cx('mx-4 mb-3 grid gap-x-3 gap-y-1 text-xs', compact ? 'grid-cols-[auto,1fr]' : 'grid-cols-[auto,1fr]')}>
        <dt className="text-muted">Document date</dt><dd className="font-medium">{formatDate(ev.documentDate)}</dd>
        {doc ? <><dt className="text-muted">Type</dt><dd>{DOCUMENT_TYPE_LABEL[doc.documentType]} · {doc.fileKind.toUpperCase()}</dd></> : null}
        <dt className="text-muted">Location</dt>
        <dd data-testid="evidence-location">
          {location ?? <span className="text-muted">{doc?.fileKind === 'pdf' ? 'Source location unavailable' : 'Not a paged format'}</span>}
          {ev.line != null ? <span className="text-muted"> · line {ev.line} of extracted text</span> : null}
        </dd>
        <dt className="text-muted">Section</dt><dd>{ev.section ?? <span className="text-muted">No section heading identified</span>}</dd>
        {!compact ? <><dt className="text-muted">Extraction</dt><dd>{ev.extractionMethod ? EXTRACTION_METHOD_LABEL[ev.extractionMethod] : 'Unknown'}</dd></> : null}
        {!compact ? <><dt className="text-muted">Offsets</dt><dd className="font-mono">chars {ev.charStart}–{ev.charEnd}</dd></> : null}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-subtle px-4 py-2">
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

/** Loads a finding's source documents. */
export function useFindingDocs(finding: Finding | undefined) {
  const docs = useLiveQuery(async () => (finding ? db.documents.bulkGet(finding.sourceDocumentIds) : []), [finding?.id, finding?.updatedAt]);
  return docs === undefined ? undefined : new Map((docs.filter(Boolean) as DocumentRecord[]).map((d) => [d.id, d]));
}

// ------------------------------------------------------------- decisions
export const ACTION_META: Record<ReviewStatus, { label: string; icon: typeof CircleDot; help: string; tone: 'primary' | 'secondary' | 'danger' }> = {
  in_review: { label: 'Begin review', icon: CircleDot, tone: 'primary', help: 'Mark this finding as under active review.' },
  confirmed: { label: 'Confirm discrepancy', icon: AlertOctagon, tone: 'secondary', help: 'Records that the documents genuinely disagree (a confirmed contradiction). It does not establish which statement is medically correct.' },
  dismissed: { label: 'Dismiss — not a contradiction', icon: XCircle, tone: 'secondary', help: 'The flagged statements do not actually conflict. A reason is required.' },
  needs_info: { label: 'Needs more information', icon: CircleHelp, tone: 'secondary', help: 'The evidence is not sufficient to decide yet. The finding stays pending; describe what is needed (optional).' },
  expected_change: { label: 'Temporal difference / expected change', icon: History, tone: 'secondary', help: 'The difference is explained by time or a documented change (for example, a dose adjustment). A reason is required.' },
  undetermined: { label: 'Unable to determine', icon: CircleHelp, tone: 'secondary', help: 'After review, the available records do not allow a determination. A reason is required.' },
  resolved: { label: 'Mark as resolved', icon: CheckCircle2, tone: 'secondary', help: 'The discrepancy has been reconciled (e.g. record corrected). A reason is required.' },
  unreviewed: { label: 'Unreviewed', icon: CircleDot, tone: 'secondary', help: '' },
};

/** Allowed actions for the current status. From "unreviewed" (local cases) every outcome is offered; choosing one first moves the finding to "in review". */
export function allowedActions(f: Finding, c: CaseRecord | undefined): ReviewStatus[] {
  const table = transitionsFor(c?.remote ? 'shared' : 'local');
  if (f.reviewStatus === 'unreviewed') return c?.remote ? table.unreviewed : ['in_review', ...table.in_review];
  return table[f.reviewStatus];
}

export function ReviewPanel({ finding, caseRec, onSaved, testId }: { finding: Finding; caseRec: CaseRecord | undefined; onSaved?: () => void; testId?: string }) {
  const { reviewer, toast } = useApp();
  const ws = useWorkspace();
  const actions = useReviewActions();
  const [pending, setPending] = useState<ReviewStatus | null>(null);
  const viewer = caseRec?.remote?.role === 'viewer';
  const allowed = allowedActions(finding, caseRec);

  const doDecide = async (to: ReviewStatus, reason?: string) => {
    try {
      await actions.decide(finding, caseRec, to, reason);
      toast('success', `${finding.displayId} → ${REVIEW_STATUS_LABEL[to]}. ${caseRec?.remote ? 'Saved to the shared workspace and recorded in its audit trail.' : "Saved in this browser and recorded in the local activity log."}`);
      setPending(null);
      onSaved?.();
      return true;
    } catch (e) {
      toast('error', `${e instanceof Error ? e.message : 'Could not save the decision.'} Your input has been kept.`);
      return false;
    }
  };

  return (
    <section id="review" className="card scroll-mt-24" aria-labelledby="review-h" data-testid={testId}>
      <div className="card-header">
        <h2 id="review-h" className="card-title">Review decision</h2>
        <StatusBadge status={finding.reviewStatus} />
      </div>
      <div className="p-5">
        {caseRec?.remote ? (
          <p className="mb-3 text-xs text-muted">Shared case · {ws.session ? <>signed in as <span className="font-medium text-ink">{ws.session.user.displayName}</span> ({caseRec.remote.role}). Decisions are saved on the server.</> : <span className="text-warn">sign in (Settings → Shared workspace) to record decisions.</span>}</p>
        ) : (
          <p className="mb-3 text-xs text-muted">Local demonstration · reviewing as <span className="font-medium text-ink">{reviewer}</span>. Decisions are stored in this browser only and are not shared with anyone.</p>
        )}
        {viewer ? <p className="mb-2 rounded-md bg-subtle px-3 py-2 text-xs text-muted" data-testid="viewer-readonly">You have read-only (viewer) access to this case.</p> : null}
        <div className={cx('flex flex-col gap-2', viewer && 'hidden')} data-testid="review-actions">
          {allowed.map((to) => {
            const m = ACTION_META[to];
            const reopen = to === 'in_review' && finding.reviewStatus !== 'unreviewed' && finding.reviewStatus !== 'needs_info';
            const label = reopen ? 'Mark as unresolved (reopen)' : to === 'in_review' && finding.reviewStatus === 'needs_info' ? 'Resume review' : m.label;
            const Icon = reopen ? RotateCcw : m.icon;
            const direct = to === 'in_review' && !reasonRequired(finding.reviewStatus, to);
            return (
              <button key={to} className={cx(m.tone === 'primary' ? 'btn-primary' : 'btn-secondary', 'h-auto min-h-9 justify-start whitespace-normal py-2 text-left')} title={m.help}
                onClick={() => (direct ? void doDecide(to) : setPending(to))}>
                <Icon size={16} aria-hidden className="shrink-0" />{label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">A decision records the reviewer's judgement about the documentation. It does not establish which statement is medically correct.</p>
        {viewer ? null : <NoteForm finding={finding} caseRec={caseRec} />}
      </div>
      <ReasonModal status={pending} from={finding.reviewStatus} onClose={() => setPending(null)} onSubmit={(reason) => doDecide(pending!, reason)} />
    </section>
  );
}

function ReasonModal({ status, from, onClose, onSubmit }: { status: ReviewStatus | null; from: ReviewStatus; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setTouched(false); }, [status]);
  if (!status) return null;
  const required = reasonRequired(from === 'unreviewed' ? 'in_review' : from, status);
  const invalid = required && reason.trim().length < MIN_REASON_LENGTH;
  const reopen = status === 'in_review';
  const title = reopen ? 'Reopen finding' : ACTION_META[status].label;
  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    await onSubmit(reason); // on failure the modal stays open and the text is preserved
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={title} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className={status === 'dismissed' ? 'btn-danger' : 'btn-primary'} onClick={submit} disabled={busy} data-testid="confirm-decision">{busy ? 'Saving…' : 'Record decision'}</button>
    </>}>
      <p className="mb-3 text-[13.5px] text-muted">{reopen ? 'Explain why this finding needs further review (for example, new evidence emerged).' : ACTION_META[status].help}</p>
      <label htmlFor="reason" className="label">{status === 'needs_info' ? 'What information is needed?' : 'Rationale'} {required ? <span className="text-crit">(required)</span> : <span className="font-normal">(optional)</span>}</label>
      <textarea id="reason" className={cx('input min-h-[110px]', touched && invalid && 'border-crit focus:border-crit focus:ring-crit/20')} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} placeholder="e.g. Verified with the prescribing clinician; intake form updated." maxLength={2000} aria-invalid={touched && invalid} aria-describedby="reason-err" data-testid="reason-input" />
      {touched && invalid ? <p id="reason-err" className="mt-1 text-xs font-medium text-crit" role="alert">A reason of at least {MIN_REASON_LENGTH} characters is required for this decision.</p> : null}
    </Modal>
  );
}

function NoteForm({ finding, caseRec }: { finding: Finding; caseRec: CaseRecord | undefined }) {
  const { toast } = useApp();
  const actions = useReviewActions();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNote(''); }, [finding.id]);
  const save = async () => {
    if (!note.trim()) { toast('error', 'Write a note before saving.'); return; }
    setBusy(true);
    try {
      await actions.note(finding, caseRec, note);
      setNote('');
      toast('success', 'Note saved to the review history.');
    } catch (e) {
      toast('error', `${e instanceof Error ? e.message : 'Could not save the note.'} Your note has been kept.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5 border-t border-line pt-4">
      <label htmlFor={`note-${finding.id}`} className="label">Reviewer note</label>
      <textarea id={`note-${finding.id}`} className="input min-h-[84px]" placeholder="Add context, a verification step, or who was contacted…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} data-testid="note-input" />
      <button className="btn-secondary mt-2 w-full" onClick={save} disabled={busy || !note.trim()} data-testid="save-note"><MessageSquarePlus size={16} aria-hidden />{busy ? 'Saving…' : 'Add note'}</button>
    </div>
  );
}

// --------------------------------------------------------------- history
export function DecisionHistory({ finding, events }: { finding: Finding; events: AuditEvent[] }) {
  return (
    <section className="card" aria-labelledby="audit-h">
      <div className="card-header"><h2 id="audit-h" className="card-title flex items-center gap-2"><BadgeCheck size={16} className="text-brand" aria-hidden />Decision history</h2><span className="text-xs text-faint">{events.length} entr{events.length === 1 ? 'y' : 'ies'}</span></div>
      <ol className="space-y-0 px-5 py-4" data-testid="finding-audit">
        {[...events].reverse().map((e, i, arr) => (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < arr.length - 1 ? <span className="absolute left-[7px] top-4 h-full w-px bg-line" aria-hidden /> : null}
            <span className={cx('relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 bg-surface', e.kind === 'status_changed' ? 'border-brand' : e.kind === 'note_added' ? 'border-info' : 'border-line-strong')} aria-hidden />
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium">{e.kind === 'status_changed' ? <>{REVIEW_STATUS_LABEL[e.fromStatus!]} → {REVIEW_STATUS_LABEL[e.toStatus!]}</> : e.kind === 'note_added' ? 'Note added' : e.kind === 'finding_created' ? 'Finding created by analysis' : e.kind === 'finding_superseded' ? 'Superseded by a later analysis' : e.kind.replace(/_/g, ' ')}</div>
              {e.reason ? <p className="mt-0.5 text-[13px] text-ink/80"><span className="font-medium">Reason:</span> {e.reason}</p> : null}
              {e.note ? <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-ink/80">{e.note}</p> : null}
              <div className="mt-0.5 text-xs text-faint">{formatDateTime(e.at)} · {e.actor}</div>
            </div>
          </li>
        ))}
        {!events.length ? <li className="text-[13px] text-muted">No history yet for {finding.displayId}.</li> : null}
      </ol>
    </section>
  );
}

export function useFindingEvents(id: string | undefined) {
  return useLiveQuery(() => db.events.where('findingId').equals(id ?? '').sortBy('at'), [id]);
}

export function EvidenceHeading() {
  return <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><GitCompareArrows size={17} className="text-brand" aria-hidden />Evidence comparison <span className="text-xs font-normal text-muted">— exact quotations from extracted document text</span></h2>;
}
