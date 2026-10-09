// CLINISCOPE component library: primitives shared by every page.
// Visual rules live in docs/FIGMA_DESIGN_SYSTEM.md; tokens live in src/index.css.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, CircleDot, CircleHelp, Clock, FileQuestion,
  FlaskConical, History, Info, Loader2, RefreshCw, Search, ShieldCheck, X, XCircle,
} from 'lucide-react';
import type { Category, EvidenceQuality, FindingType, ProcessingStatus, ReviewPriority, ReviewStatus } from '../lib/types';
import { CATEGORY_LABEL, EVIDENCE_QUALITY_LABEL, FINDING_TYPE_LABEL, REVIEW_PRIORITY_LABEL, REVIEW_STATUS_LABEL } from '../lib/types';
import { NATURE_LABEL, SEVERITY_LABEL, type FindingNature, type Severity } from '../lib/metrics';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ badges
type Tone = 'neutral' | 'brand' | 'info' | 'warn' | 'crit' | 'ok' | 'dark';
const TONE: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted ring-1 ring-inset ring-line',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand/15',
  info: 'bg-info-50 text-info ring-1 ring-inset ring-info/15',
  warn: 'bg-warn-50 text-warn ring-1 ring-inset ring-warn/20',
  crit: 'bg-crit-50 text-crit ring-1 ring-inset ring-crit/15',
  ok: 'bg-ok-50 text-ok ring-1 ring-inset ring-ok/15',
  dark: 'bg-ink text-white',
};

export function Badge({ tone = 'neutral', icon, children, className, title, testId }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; title?: string; testId?: string }) {
  return <span className={cx('chip', TONE[tone], className)} title={title} data-testid={testId}>{icon}{children}</span>;
}

const STATUS_STYLE: Record<ReviewStatus, { tone: Tone; icon: ReactNode }> = {
  unreviewed: { tone: 'neutral', icon: <CircleDashed size={12} aria-hidden /> },
  in_review: { tone: 'info', icon: <CircleDot size={12} aria-hidden /> },
  needs_info: { tone: 'warn', icon: <CircleHelp size={12} aria-hidden /> },
  confirmed: { tone: 'crit', icon: <AlertOctagon size={12} aria-hidden /> },
  undetermined: { tone: 'warn', icon: <CircleHelp size={12} aria-hidden /> },
  expected_change: { tone: 'ok', icon: <History size={12} aria-hidden /> },
  resolved: { tone: 'ok', icon: <CheckCircle2 size={12} aria-hidden /> },
  dismissed: { tone: 'neutral', icon: <XCircle size={12} aria-hidden /> },
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  const s = STATUS_STYLE[status];
  return <Badge tone={s.tone} icon={s.icon} testId="status-badge">{REVIEW_STATUS_LABEL[status]}</Badge>;
}

const SEVERITY_STYLE: Record<Severity, { tone: Tone; icon: ReactNode }> = {
  high: { tone: 'crit', icon: <AlertTriangle size={12} aria-hidden /> },
  medium: { tone: 'warn', icon: <AlertTriangle size={12} aria-hidden /> },
  low: { tone: 'info', icon: <Info size={12} aria-hidden /> },
};

/** Review priority shown as severity. Always carries a text label and icon, never colour alone. */
export function SeverityBadge({ severity, compact }: { severity: Severity; compact?: boolean }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <Badge tone={s.tone} icon={s.icon} title="Workflow review priority from the rules engine (allergy and medication conflicts first). Not a clinical risk score." testId="severity-badge">
      {compact ? SEVERITY_LABEL[severity] : `${SEVERITY_LABEL[severity]}${severity === 'low' ? '' : ' priority'}`}
    </Badge>
  );
}

const TYPE_TONE: Record<FindingType, Tone> = {
  explicit_conflict: 'crit',
  potential_discrepancy: 'warn',
  temporal_inconsistency: 'warn',
  context_dependent: 'info',
  insufficient_evidence: 'neutral',
};

export function TypeBadge({ type }: { type: FindingType }) {
  return <Badge tone={TYPE_TONE[type]}>{FINDING_TYPE_LABEL[type]}</Badge>;
}

const NATURE_TONE: Record<FindingNature, Tone> = { potential: 'warn', temporal: 'info', missing: 'neutral', uncertain_extraction: 'neutral', confirmed: 'crit' };
export function NatureBadge({ nature }: { nature: FindingNature }) {
  return <Badge tone={NATURE_TONE[nature]}>{NATURE_LABEL[nature]}</Badge>;
}

export function CategoryTag({ category }: { category: Category }) {
  return <span className="text-[13px] text-muted">{CATEGORY_LABEL[category]}</span>;
}

export function SyntheticBadge({ label = 'Synthetic demo data' }: { label?: string }) {
  return <Badge tone="dark" icon={<FlaskConical size={12} aria-hidden />}>{label}</Badge>;
}

const QUALITY_BARS: Record<EvidenceQuality, number> = { high: 3, moderate: 2, limited: 1, insufficient: 0 };

export function QualityIndicator({ quality, compact }: { quality: EvidenceQuality; compact?: boolean }) {
  const n = QUALITY_BARS[quality];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={`${EVIDENCE_QUALITY_LABEL[quality]} — describes source availability and extraction reliability, not clinical correctness.`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className={cx('w-[4px] rounded-sm', i < n ? 'bg-brand' : 'bg-line-strong')} style={{ height: 6 + i * 3 }} />)}
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

const PROC_STYLE: Record<ProcessingStatus, [Tone, string]> = {
  uploaded: ['neutral', 'Uploaded'],
  extracting: ['info', 'Extracting'],
  ocr_running: ['info', 'Running OCR'],
  extracted: ['brand', 'Text extracted'],
  analyzing: ['info', 'Analyzing'],
  analyzed: ['ok', 'Analyzed'],
  needs_attention: ['warn', 'Needs attention'],
  failed: ['crit', 'Failed'],
};

export function ProcessingBadge({ status }: { status: ProcessingStatus }) {
  const [tone, label] = PROC_STYLE[status];
  const busy = status === 'extracting' || status === 'analyzing' || status === 'ocr_running';
  return <Badge tone={tone} icon={busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : undefined}>{label}</Badge>;
}

// ----------------------------------------------------------- loading/empty
export function Spinner({ label }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-sm text-muted" role="status"><Loader2 size={16} className="animate-spin text-brand" aria-hidden />{label ?? 'Loading…'}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-line/70', className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-72" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px]" />)}</div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function EmptyState({ icon, title, body, action, compact }: { icon?: ReactNode; title: string; body: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-surface/70 px-6 text-center', compact ? 'py-8' : 'py-14')}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand">{icon ?? <FileQuestion size={19} aria-hidden />}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <div className="mt-1 max-w-md text-[13.5px] text-muted">{body}</div>
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-crit/20 bg-crit-50/50 px-6 py-10 text-center" role="alert">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-crit-50 text-crit"><AlertTriangle size={19} aria-hidden /></div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <div className="mt-1 max-w-md text-[13.5px] text-muted">{body}</div>
      {onRetry ? <button className="btn-secondary mt-4" onClick={onRetry}><RefreshCw size={15} aria-hidden />Try again</button> : null}
    </div>
  );
}

// ------------------------------------------------------------------ layout
export function PageHeader({ eyebrow, title, description, actions, meta }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] md:text-[28px]">{title}</h1>
          {meta}
        </div>
        {description ? <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({ title, description, actions, children, className, bodyClassName, icon, id, testId }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; icon?: ReactNode; id?: string; testId?: string;
}) {
  const hid = useId();
  return (
    <section className={cx('card', className)} aria-labelledby={title ? hid : undefined} id={id} data-testid={testId}>
      {title ? (
        <div className="card-header">
          <div className="min-w-0">
            <h2 id={hid} className="card-title flex items-center gap-2">{icon ? <span className="text-brand">{icon}</span> : null}{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cx(bodyClassName ?? 'p-5')}>{children}</div>
    </section>
  );
}

export function Callout({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'safe' | 'crit'; title?: string; children: ReactNode; action?: ReactNode }) {
  const map = {
    info: ['bg-info-50/70 border-info/20', <Info key="i" size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />],
    warn: ['bg-warn-50 border-warn/25', <AlertTriangle key="w" size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />],
    safe: ['bg-ok-50 border-ok/20', <ShieldCheck key="s" size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />],
    crit: ['bg-crit-50 border-crit/20', <AlertOctagon key="c" size={16} className="mt-0.5 shrink-0 text-crit" aria-hidden />],
  } as const;
  const [cls, icon] = map[tone];
  return (
    <div className={cx('flex gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13.5px]', cls)}>
      {icon}
      <div className="min-w-0 flex-1">{title ? <div className="font-semibold text-ink">{title}</div> : null}<div className="text-ink/80">{children}</div></div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- metrics
export function MetricCard({ label, value, hint, tone, icon, to, testId, progress }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'crit' | 'ok' | 'brand' | 'warn'; icon?: ReactNode; to?: string; testId?: string; progress?: number;
}) {
  const color = tone === 'crit' ? 'text-crit' : tone === 'ok' ? 'text-ok' : tone === 'brand' ? 'text-brand' : tone === 'warn' ? 'text-warn' : 'text-ink';
  const body = (
    <>
      <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium text-muted">{label}</span><span className="text-faint">{icon}</span></div>
      <div className={cx('mt-2 text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em]', color)}>{value}</div>
      {progress != null ? <ProgressBar value={progress} className="mt-3" /> : null}
      {hint ? <div className="mt-2 text-xs text-muted">{hint}</div> : null}
    </>
  );
  return to ? (
    <Link to={to} className="card group block p-4 transition-shadow duration-150 hover:border-line-strong hover:shadow-raised md:p-5" data-testid={testId}>{body}</Link>
  ) : (
    <div className="card p-4 md:p-5" data-testid={testId}>{body}</div>
  );
}

/** Backwards-compatible alias. */
export const Stat = MetricCard;

export function ProgressBar({ value, className, tone = 'brand', label }: { value: number; className?: string; tone?: 'brand' | 'ok' | 'warn'; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const bar = tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-brand';
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-line/80', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Progress'}>
      <div className={cx('h-full rounded-full transition-[width] duration-300', bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------- forms
export function SearchInput({ value, onChange, placeholder, label, testId, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; testId?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
      <input type="search" className="input pl-9" placeholder={placeholder} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </div>
  );
}

export function SelectField({ value, onChange, label, options, testId, className, hideLabel = true }: {
  value: string; onChange: (v: string) => void; label: string; options: { value: string; label: string }[]; testId?: string; className?: string; hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx('relative min-w-0', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'label'}>{label}</label>
      <select id={id} className="input appearance-none" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={15} className={cx('pointer-events-none absolute right-2.5 text-faint', hideLabel ? 'top-1/2 -translate-y-1/2' : 'bottom-2.5')} aria-hidden />
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; testId?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0"><label htmlFor={id} className="text-[13.5px] font-medium text-ink">{label}</label>{description ? <p className="text-xs text-muted">{description}</p> : null}</div>
      <button id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId}
        className={cx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150', checked ? 'bg-brand' : 'bg-line-strong')}>
        <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

export function FilterChip({ label, onRemove }: { label: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface py-0.5 pl-2 pr-1 text-xs font-medium text-ink" data-testid="filter-chip">
      {label}
      <button className="rounded p-0.5 text-faint hover:bg-hover hover:text-ink" onClick={onRemove} aria-label={`Remove filter ${typeof label === 'string' ? label : ''}`}><X size={12} aria-hidden /></button>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group/tt relative inline-flex" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-white opacity-0 shadow-raised transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100">
        {content}
      </span>
    </span>
  );
}

export function KeyValue({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx('grid grid-cols-[minmax(0,auto),1fr] gap-x-4 gap-y-1.5 text-[13px]', className)}>
      {items.map(([k, v], i) => <div key={i} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words text-ink">{v}</dd></div>)}
    </dl>
  );
}

// ---------------------------------------------------------------- overlays
function useOverlay(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('textarea, input, select, button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const f = Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'));
        if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open, onClose, ref]);
}

export function Modal({ open, onClose, title, children, footer, wide, description }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; description?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex animate-fade-in items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('flex max-h-[92vh] w-full animate-pop flex-col rounded-t-2xl bg-surface shadow-overlay sm:rounded-panel', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div><h2 className="text-[16px] font-semibold">{title}</h2>{description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}</div>
          <button className="btn-icon -mr-2 -mt-1" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel, danger, busy, testId }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; testId?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy} data-testid={testId}>{busy ? 'Working…' : confirmLabel}</button>
    </>}>{children}</Modal>
  );
}

export function Drawer({ open, onClose, title, children, footer, testId, width = 'max-w-[680px]' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; testId?: string; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex animate-fade-in justify-end bg-ink/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('flex h-full w-full animate-slide-in flex-col bg-canvas shadow-overlay', width)} data-testid={testId}>
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          <button className="btn-icon -mr-2" onClick={onClose} aria-label="Close panel"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
