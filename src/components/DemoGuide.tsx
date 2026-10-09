import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, PlayCircle, RefreshCw, X } from 'lucide-react';
import { useApp, useCaseData } from '../app/state';
import { cx } from './ui';
import type { AuditEvent, CaseRecord, Finding } from '../lib/types';

const LS_KEY = 'cliniscope.demoGuide';

interface GuideState { open: boolean; step: number }

function load(): GuideState {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? '');
    if (typeof v.step === 'number' && typeof v.open === 'boolean') return v;
  } catch { /* ignore */ }
  return { open: false, step: 0 };
}
function save(s: GuideState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function useDemoGuide() {
  const [state, setState] = useState<GuideState>(load);
  const { cases, setCaseId } = useApp();
  const update = useCallback((s: GuideState) => { setState(s); save(s); }, []);
  const start = useCallback(() => {
    const demo = cases?.find((c) => c.isDemo);
    if (demo) setCaseId(demo.id);
    update({ open: true, step: 0 });
  }, [cases, setCaseId, update]);
  return { state, update, start };
}

interface Ctx { c: CaseRecord | undefined; findings: Finding[]; events: AuditEvent[]; byConcept: (k: string) => Finding | undefined }

interface Step {
  title: string;
  body: string;
  go?: (ctx: Ctx) => string | null;
  goLabel?: string;
  done?: (ctx: Ctx) => boolean;
  reload?: boolean;
}

const STEPS: Step[] = [
  { title: 'Open the fictional patient case', body: 'The demo case DEMO-0042 is synthetic. Note the banner at the top of the screen. The overview shows the case status.', go: () => '/', goLabel: 'Open overview' },
  { title: 'Inspect the uploaded medical records', body: 'Five fictional records were ingested through the real pipeline: two digital PDFs, one DOCX, one TXT and a SCANNED discharge letter read with on-device OCR. Open the scanned letter to compare its OCR text with the original page.', go: () => '/documents', goLabel: 'Open document library' },
  { title: 'Start document analysis', body: 'Click "Analyze documents". The rules engine compares statements across documents in this case only.', go: () => '/documents', goLabel: 'Go to Analyze', done: (x) => !!x.c?.lastAnalyzedAt },
  { title: 'View the analysis summary', body: 'The overview now shows counts derived from stored records: statements, comparisons, consistent results, and findings.', go: () => '/', goLabel: 'Open overview', done: (x) => !!x.c?.lastAnalyzedAt },
  { title: 'Open the allergy documentation conflict', body: 'The discharge summary records a penicillin allergy; the intake form says "No known drug allergies".', go: (x) => { const f = x.byConcept('allergy:penicillin'); return f ? `/findings/${f.id}` : null; }, goLabel: 'Open allergy finding' },
  { title: 'Inspect the exact evidence', body: 'Each side shows the verbatim quote, the document, its date, and a page number only when it is verified. Click "View in source" to see the passage highlighted in the extracted text.', go: (x) => { const f = x.byConcept('allergy:penicillin'); return f ? `/findings/${f.id}` : null; }, goLabel: 'Show evidence' },
  { title: 'Review the medication dose discrepancy', body: 'Metformin 500 mg twice daily (14 March) vs. 1000 mg twice daily (15 March). The system does not decide which dose is correct.', go: (x) => { const f = x.byConcept('medication:metformin'); return f ? `/findings/${f.id}` : null; }, goLabel: 'Open metformin finding' },
  { title: 'See how dates change interpretation', body: 'Lisinopril 10 mg → 20 mg is classified as a historical/contextual difference, because the later record documents the increase. HbA1c values from different dates are not flagged at all.', go: (x) => { const f = x.byConcept('medication:lisinopril'); return f ? `/findings/${f.id}` : null; }, goLabel: 'Open lisinopril finding' },
  { title: 'Add a reviewer note', body: 'On any finding, write a note in the review panel and save it. Notes are appended to the audit trail.', go: (x) => { const f = x.byConcept('medication:metformin'); return f ? `/findings/${f.id}#review` : null; }, goLabel: 'Open review panel', done: (x) => x.events.some((e) => e.kind === 'note_added') },
  { title: 'Resolve or dismiss with an explanation', body: 'Click "Begin review", then "Mark as resolved" or "Dismiss". A reason is required, and the decision is recorded with a timestamp.', go: (x) => { const f = x.byConcept('medication:metformin'); return f ? `/findings/${f.id}#review` : null; }, goLabel: 'Open review panel', done: (x) => x.events.some((e) => e.kind === 'status_changed' && (e.toStatus === 'resolved' || e.toStatus === 'dismissed')) },
  { title: 'Refresh the application', body: 'Reload the page. Data is read back from this browser\'s IndexedDB, so nothing is kept only in memory.', reload: true },
  { title: 'Verify the decision and audit history', body: 'The decision, the reason, and your note are still present after the reload. The case timeline lists every event with its timestamp.', go: () => '/timeline', goLabel: 'Open timeline', done: (x) => x.events.some((e) => e.kind === 'status_changed' && (e.toStatus === 'resolved' || e.toStatus === 'dismissed')) },
];

export function DemoGuide({ guide }: { guide: ReturnType<typeof useDemoGuide> }) {
  const { state, update } = guide;
  const { currentCase, caseId } = useApp();
  const { findings, events } = useCaseData(caseId);
  const navigate = useNavigate();
  const [minimized, setMinimized] = useState(false);
  useEffect(() => { if (state.open) setMinimized(false); }, [state.open]);
  if (!state.open) return null;
  const ctx: Ctx = {
    c: currentCase, findings: findings ?? [], events: events ?? [],
    byConcept: (k) => (findings ?? []).find((f) => f.concept === k && !f.stale),
  };
  const step = STEPS[Math.min(state.step, STEPS.length - 1)];
  const target = step.go?.(ctx) ?? null;
  const isDone = step.done?.(ctx);
  const needsAnalysis = !!step.go && !target && !currentCase?.lastAnalyzedAt;

  if (minimized) {
    return (
      <button className="btn-primary fixed bottom-4 left-4 z-40 shadow-lg" onClick={() => setMinimized(false)}>
        <PlayCircle size={16} />Demo step {state.step + 1}/{STEPS.length}
      </button>
    );
  }

  return (
    <aside className="fixed bottom-3 left-3 right-3 z-40 animate-fade-up rounded-xl border border-brand/20 bg-white shadow-2xl sm:left-auto sm:right-4 sm:bottom-4 sm:w-[380px] lg:left-[17rem] lg:right-auto" aria-label="Interactive demo guide" data-testid="demo-guide">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="eyebrow text-brand">Interactive demo · step {state.step + 1} of {STEPS.length}</div>
        <div className="flex gap-1">
          <button className="btn-ghost px-1.5 py-1 text-xs" onClick={() => setMinimized(true)} aria-label="Minimize guide">–</button>
          <button className="btn-ghost px-1.5 py-1" onClick={() => update({ ...state, open: false })} aria-label="Close demo guide"><X size={15} /></button>
        </div>
      </div>
      <div className="flex gap-1 px-4 pt-3" aria-hidden>
        {STEPS.map((_, i) => <span key={i} className={cx('h-1 flex-1 rounded-full', i <= state.step ? 'bg-brand' : 'bg-slate-200')} />)}
      </div>
      <div className="px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {isDone ? <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ok text-white"><Check size={11} /></span> : null}
          {step.title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{step.body}</p>
        {needsAnalysis ? <p className="mt-2 text-xs font-medium text-warn">Run the analysis first (step 3) so the findings exist.</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {target ? <button className="btn-secondary py-1.5" onClick={() => navigate(target)}>{step.goLabel}</button> : null}
          {step.reload ? <button className="btn-secondary py-1.5" onClick={() => { update({ open: true, step: state.step + 1 }); window.location.reload(); }}><RefreshCw size={14} />Refresh page now</button> : null}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
        <button className="btn-ghost px-2 py-1" disabled={state.step === 0} onClick={() => update({ ...state, step: state.step - 1 })}><ChevronLeft size={15} />Back</button>
        {state.step < STEPS.length - 1 ? (
          <button className="btn-primary py-1.5" onClick={() => update({ ...state, step: state.step + 1 })}>Next<ChevronRight size={15} /></button>
        ) : (
          <button className="btn-primary py-1.5" onClick={() => update({ open: false, step: 0 })}><Check size={15} />Finish</button>
        )}
      </div>
    </aside>
  );
}
