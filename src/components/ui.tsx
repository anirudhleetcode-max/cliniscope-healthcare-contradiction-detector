import { useEffect, useRef, type ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleDashed, CircleDot, Clock, FileQuestion, Info, Loader2, ShieldCheck, X, XCircle,
} from 'lucide-react';
import type { EvidenceQuality, FindingType, ProcessingStatus, ReviewPriority, ReviewStatus } from '../lib/types';
import { EVIDENCE_QUALITY_LABEL, FINDING_TYPE_LABEL, REVIEW_PRIORITY_LABEL, REVIEW_STATUS_LABEL } from '../lib/types';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

const STATUS_STYLE: Record<ReviewStatus, { cls: string; icon: ReactNode }> = {
  unreviewed: { cls: 'bg-slate-100 text-slate-700', icon: <CircleDashed size={12} aria-hidden /> },
  in_review: { cls: 'bg-brand-50 text-brand-700', icon: <CircleDot size={12} aria-hidden /> },
  confirmed: { cls: 'bg-crit-50 text-crit', icon: <AlertTriangle size={12} aria-hidden /> },
  resolved: { cls: 'bg-ok-50 text-ok', icon: <CheckCircle2 size={12} aria-hidden /> },
  dismissed: { cls: 'bg-slate-100 text-slate-500', icon: <XCircle size={12} aria-hidden /> },
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  const s = STATUS_STYLE[status];
  return <span className={cx('chip', s.cls)} data-testid="status-badge">{s.icon}{REVIEW_STATUS_LABEL[status]}</span>;
}

const TYPE_STYLE: Record<FindingType, string> = {
  explicit_conflict: 'bg-crit-50 text-crit ring-1 ring-crit/15',
  potential_discrepancy: 'bg-warn-50 text-warn ring-1 ring-warn/15',
  temporal_inconsistency: 'bg-warn-50 text-warn ring-1 ring-warn/15',
  context_dependent: 'bg-soft text-ink ring-1 ring-line',
  insufficient_evidence: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200',
};

export function TypeBadge({ type }: { type: FindingType }) {
  return <span className={cx('chip', TYPE_STYLE[type])}>{FINDING_TYPE_LABEL[type]}</span>;
}

const QUALITY_BARS: Record<EvidenceQuality, number> = { high: 3, moderate: 2, limited: 1, insufficient: 0 };

export function QualityIndicator({ quality, compact }: { quality: EvidenceQuality; compact?: boolean }) {
  const n = QUALITY_BARS[quality];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={`${EVIDENCE_QUALITY_LABEL[quality]} — describes source availability and extraction reliability, not clinical correctness.`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx('w-[4px] rounded-sm', i < n ? 'bg-brand' : 'bg-slate-200')} style={{ height: 6 + i * 3 }} />
        ))}
      </span>
      {compact ? quality[0].toUpperCase() + quality.slice(1) : EVIDENCE_QUALITY_LABEL[quality]}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: ReviewPriority }) {
  const cls = priority === 'prompt' ? 'text-crit' : priority === 'routine' ? 'text-ink' : 'text-muted';
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-medium', cls)} title="Workflow prioritization suggestion based on category and finding type. It is not a clinical risk score and requires professional judgment.">
      <Clock size={12} aria-hidden />{REVIEW_PRIORITY_LABEL[priority]}
    </span>
  );
}

const PROC_STYLE: Record<ProcessingStatus, [string, string]> = {
  uploaded: ['bg-slate-100 text-slate-700', 'Uploaded'],
  extracting: ['bg-brand-50 text-brand-700', 'Extracting'],
  extracted: ['bg-soft text-ink', 'Extracted'],
  analyzing: ['bg-brand-50 text-brand-700', 'Analyzing'],
  analyzed: ['bg-ok-50 text-ok', 'Analyzed'],
  needs_attention: ['bg-warn-50 text-warn', 'Needs attention'],
  failed: ['bg-crit-50 text-crit', 'Failed'],
};

export function ProcessingBadge({ status }: { status: ProcessingStatus }) {
  const [cls, label] = PROC_STYLE[status];
  const busy = status === 'extracting' || status === 'analyzing';
  return <span className={cx('chip', cls)}>{busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}{label}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 size={16} className="animate-spin text-brand" aria-hidden />{label ?? 'Loading…'}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-soft text-brand">{icon ?? <FileQuestion size={20} aria-hidden />}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-1 max-w-md text-sm text-muted">{body}</div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'safe'; title?: string; children: ReactNode }) {
  const map = {
    info: ['bg-soft border-brand/15', <Info key="i" size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />],
    warn: ['bg-warn-50 border-warn/20', <AlertTriangle key="w" size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />],
    safe: ['bg-ok-50 border-ok/20', <ShieldCheck key="s" size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />],
  } as const;
  const [cls, icon] = map[tone];
  return (
    <div className={cx('flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm', cls)}>
      {icon}
      <div className="min-w-0">{title ? <div className="font-semibold">{title}</div> : null}<div className="text-ink/80">{children}</div></div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('textarea, input, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg animate-fade-up rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'crit' | 'ok' | 'brand'; icon?: ReactNode }) {
  const color = tone === 'crit' ? 'text-crit' : tone === 'ok' ? 'text-ok' : tone === 'brand' ? 'text-brand' : 'text-ink';
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between"><span className="eyebrow">{label}</span><span className="text-slate-400">{icon}</span></div>
      <div className={cx('mt-2 text-3xl font-semibold tabular-nums tracking-tight', color)}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
