import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity, Bell, BookOpenText, ChevronRight, ChevronsLeft, ChevronsRight, Cloud, FileStack, FlaskConical, FolderOpen, GitCompareArrows,
  HardDrive, LayoutDashboard, ListChecks, Menu, PlayCircle, Search, Settings, UserRound, X,
} from 'lucide-react';
import { db, useApp } from '../../app/state';
import { useWorkspace } from '../../app/workspace';
import { cx, Kbd, Tooltip } from '../ui';
import { DemoGuide, useDemoGuide } from '../DemoGuide';
import { CommandPalette } from './CommandPalette';
import { BrandMark } from './BrandMark';
import { APP_VERSION } from '../../lib/version';
import { PENDING_STATUSES } from '../../lib/review';
import { formatDateTime } from '../../lib/dates';
import { describeEvent } from '../../pages/Activity';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/cases', label: 'Clinical Cases', icon: FolderOpen },
  { to: '/contradictions', label: 'Contradictions', icon: GitCompareArrows },
  { to: '/documents', label: 'Documents', icon: FileStack },
  { to: '/queue', label: 'Review Queue', icon: ListChecks, badge: 'pending' as const },
  { to: '/activity', label: 'Activity', icon: Activity },
];
const NAV_BOTTOM = [
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/help', label: 'Help & About', icon: BookOpenText },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { prefs, setPref, toasts, dismissToast, cases } = useApp();
  const [mobileNav, setMobileNav] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const guide = useDemoGuide();
  const location = useLocation();
  const compact = prefs.sidebarCompact;
  const pending = useLiveQuery(() => db.findings.filter((f) => !f.stale && PENDING_STATUSES.includes(f.reviewStatus)).count(), []);
  const hasDemo = !!cases?.some((c) => c.isDemo);

  useEffect(() => { setMobileNav(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '') && !(e.target as HTMLElement)?.isContentEditable) { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navList = (isCompact: boolean, onNavigate?: () => void) => (
    <>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.map((n) => <NavItem key={n.to} {...n} compact={isCompact} onNavigate={onNavigate} count={n.badge === 'pending' ? pending : undefined} />)}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only-focusable fixed left-3 top-3 z-[90] rounded-md bg-ink px-3 py-2 text-sm font-medium text-white">Skip to content</a>
      {hasDemo ? (
        <div className="flex items-center justify-center gap-2 bg-ink px-4 py-1 text-center text-[11px] font-medium tracking-[0.04em] text-white/90" data-testid="demo-banner">
          <FlaskConical size={12} aria-hidden className="shrink-0 text-brand-100" />
          <span><span className="font-semibold uppercase tracking-[0.08em] text-white">Demo workspace</span> · synthetic data — not real patients · runs locally in this browser</span>
        </div>
      ) : null}
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', compact ? 'w-[var(--sidebar-w-compact)]' : 'w-[var(--sidebar-w)]')} aria-label="Sidebar">
          <div className={cx('flex h-[var(--header-h)] items-center border-b border-line', compact ? 'justify-center px-2' : 'px-4')}>
            <Brand compact={compact} />
          </div>
          <div className={cx('flex-1 overflow-y-auto py-4', compact ? 'px-2' : 'px-3')}>
            {!compact ? <div className="eyebrow mb-2 px-2.5">Workspace</div> : null}
            {navList(compact)}
          </div>
          <div className={cx('space-y-1 border-t border-line py-3', compact ? 'px-2' : 'px-3')}>
            <DemoEnvironment compact={compact} />
            {NAV_BOTTOM.map((n) => <NavItem key={n.to} {...n} compact={compact} />)}
            <button onClick={() => setPref('sidebarCompact', !compact)} className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted transition-colors duration-150 hover:bg-hover hover:text-ink', compact && 'justify-center')} aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'} title={compact ? 'Expand sidebar' : 'Collapse sidebar'}>
              {compact ? <ChevronsRight size={17} aria-hidden /> : <><ChevronsLeft size={17} aria-hidden />Collapse</>}
            </button>
            <ProfileCard compact={compact} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[var(--header-h)] items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:px-6 lg:px-8">
            <button className="btn-icon -ml-1 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
            <div className="lg:hidden"><Brand compact /></div>
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <button className="hidden h-9 w-[260px] items-center gap-2 rounded-[9px] border border-line bg-subtle px-3 text-[13px] text-faint transition-colors duration-150 hover:border-line-strong hover:bg-surface md:flex xl:w-[300px]" onClick={() => setPaletteOpen(true)} data-testid="open-search">
                <Search size={15} aria-hidden /><span className="flex-1 text-left">Search cases, findings, documents…</span><Kbd>Ctrl</Kbd><Kbd>K</Kbd>
              </button>
              <button className="btn-icon md:hidden" onClick={() => setPaletteOpen(true)} aria-label="Search"><Search size={18} /></button>
              <ModeChip />
              <Notifications />
              <Tooltip content="Run guided demo"><button className="btn-icon" onClick={() => guide.start()} aria-label="Run interactive demo" data-testid="run-demo"><PlayCircle size={18} /></button></Tooltip>
              <UserMenu onTour={() => guide.start()} />
            </div>
          </header>

          <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-6 md:py-8 lg:px-8" tabIndex={-1}>{children}</main>
          <footer className="mx-auto w-full max-w-[1600px] px-4 pb-6 text-[11.5px] text-faint md:px-6 lg:px-8">
            CLINISCOPE v{APP_VERSION} · frontend demonstration build · review-support prototype: it does not diagnose or determine which record is clinically correct. Synthetic data only.
          </footer>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileNav ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 animate-fade-in bg-ink/40" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 flex h-full w-[280px] animate-slide-in flex-col bg-surface shadow-overlay">
            <div className="flex h-[var(--header-h)] items-center justify-between border-b border-line px-4"><Brand /><button className="btn-icon" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div>
            <div className="flex-1 overflow-y-auto px-3 py-4">{navList(false, () => setMobileNav(false))}</div>
            <div className="space-y-1 border-t border-line px-3 py-3">
              <DemoEnvironment compact={false} />
              {NAV_BOTTOM.map((n) => <NavItem key={n.to} {...n} compact={false} onNavigate={() => setMobileNav(false)} />)}
              <ProfileCard compact={false} />
            </div>
          </div>
        </div>
      ) : null}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <DemoGuide guide={guide} />

      <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={cx(
            'pointer-events-auto flex animate-fade-up items-start gap-2.5 rounded-[10px] border bg-surface px-3.5 py-3 text-[13.5px] shadow-raised',
            t.kind === 'error' ? 'border-crit/30' : t.kind === 'success' ? 'border-ok/30' : 'border-line',
          )}>
            <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', t.kind === 'error' ? 'bg-crit' : t.kind === 'success' ? 'bg-ok' : 'bg-info')} aria-hidden />
            <span className="flex-1">{t.text}</span>
            <button className="text-faint hover:text-ink" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NavItem({ to, label, icon: Icon, end, compact, onNavigate, count }: { to: string; label: string; icon: typeof Activity; end?: boolean; compact: boolean; onNavigate?: () => void; count?: number }) {
  const link = (
    <NavLink to={to} end={end} onClick={onNavigate} aria-label={compact ? label : undefined}
      className={({ isActive }) => cx(
        'group relative flex items-center gap-3 rounded-lg py-2 text-[13.5px] font-medium transition-colors duration-150',
        compact ? 'justify-center px-2' : 'px-2.5',
        isActive ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-hover hover:text-ink',
      )}>
      {({ isActive }) => (
        <>
          {isActive && !compact ? <span className="absolute -left-3 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-brand" aria-hidden /> : null}
          <Icon size={18} aria-hidden className={isActive ? 'text-brand' : 'text-faint group-hover:text-ink'} />
          {!compact ? <span className="flex-1">{label}</span> : null}
          {count ? <span className={cx('rounded-full px-1.5 text-[11px] font-semibold tabular-nums', compact ? 'absolute right-1 top-0.5 bg-brand text-white' : 'bg-line/80 text-muted')} aria-label={`${count} pending`}>{count}</span> : null}
        </>
      )}
    </NavLink>
  );
  return compact ? <Tooltip content={label}>{link}</Tooltip> : link;
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-md" aria-label="CLINISCOPE home">
      <BrandMark size={32} />
      {!compact ? (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-[0.08em] text-ink">CLINISCOPE</span>
          <span className="block text-[11px] text-faint">Clinical Intelligence</span>
        </span>
      ) : null}
    </Link>
  );
}

function DemoEnvironment({ compact }: { compact: boolean }) {
  const content = (
    <Link to="/settings#data" className={cx('mb-1 flex items-center gap-2.5 rounded-lg border border-warn/25 bg-warn-50 px-2.5 py-2 text-xs text-warn', compact && 'justify-center px-2')} aria-label="Demo environment — local, synthetic data">
      <FlaskConical size={15} aria-hidden className="shrink-0" />
      {!compact ? <span className="leading-tight"><span className="block font-semibold">Demo environment</span><span className="text-[11px] text-warn/90">Local browser · synthetic data</span></span> : null}
    </Link>
  );
  return compact ? <Tooltip content="Demo environment · local, synthetic data">{content}</Tooltip> : content;
}

function ProfileCard({ compact }: { compact: boolean }) {
  return (
    <div className={cx('mt-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2', compact && 'justify-center px-0')} title="Fictional demo profile — not an authenticated account">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-semibold text-brand-700" aria-hidden>CR</span>
      {!compact ? <span className="min-w-0 leading-tight"><span className="block truncate text-[13px] font-medium text-ink">Clinical Reviewer</span><span className="block truncate text-[11px] text-faint">Demo Workspace · not signed in</span></span> : null}
    </div>
  );
}

/** Mode of the active case: local browser storage or the optional shared workspace. */
function ModeChip() {
  const { currentCase } = useApp();
  const ws = useWorkspace();
  const remote = currentCase?.remote;
  if (remote) {
    const signedIn = !!ws.session && ws.session.serverUrl === remote.serverUrl;
    return (
      <NavLink to="/settings#workspace" className={cx('chip hidden h-7 px-2.5 sm:inline-flex', signedIn ? 'bg-ok-50 text-ok ring-1 ring-inset ring-ok/20' : 'bg-warn-50 text-warn ring-1 ring-inset ring-warn/20')} data-testid="mode-chip"
        title={signedIn ? `Shared workspace on ${remote.serverUrl}. Last synchronized ${remote.syncedAt ?? 'never'}.` : 'Shared case — sign in to synchronize'}>
        <Cloud size={13} aria-hidden />{signedIn ? `Shared workspace · ${remote.role}` : 'Shared case · signed out'}{ws.syncing ? ' · syncing…' : remote.unsynced ? ' · unsynced changes' : ''}
      </NavLink>
    );
  }
  return (
    <NavLink to="/settings#workspace" className="chip hidden h-7 bg-brand-50 px-2.5 text-brand-700 ring-1 ring-inset ring-brand/15 sm:inline-flex" data-testid="mode-chip" title="Data is stored only in this browser (IndexedDB). No backend is used.">
      <HardDrive size={13} aria-hidden />Local demo mode
    </NavLink>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const events = useLiveQuery(() => db.events.orderBy('at').reverse().filter((e) => e.kind === 'status_changed' || e.kind === 'note_added' || e.kind === 'analysis_completed' || e.kind === 'document_extracted').limit(6).toArray(), []);
  const findings = useLiveQuery(() => db.findings.toArray(), []);
  const pending = (findings ?? []).filter((f) => !f.stale && PENDING_STATUSES.includes(f.reviewStatus)).length;
  useClickOutside(ref, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <Tooltip content="Notifications"><button className="btn-icon relative" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${pending ? ` (${pending} pending reviews)` : ''}`} aria-expanded={open} data-testid="notifications">
        <Bell size={18} />{pending ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-crit ring-2 ring-surface" aria-hidden /> : null}
      </button></Tooltip>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[340px] max-w-[calc(100vw-2rem)] animate-pop overflow-hidden rounded-panel border border-line bg-surface shadow-overlay" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><span className="text-[13.5px] font-semibold">Notifications</span><span className="text-[11px] text-faint">Local activity only</span></div>
          {pending ? <Link to="/queue" onClick={() => setOpen(false)} className="flex items-center gap-2 border-b border-line bg-warn-50/60 px-4 py-2.5 text-[13px] font-medium text-warn hover:bg-warn-50"><ListChecks size={15} aria-hidden />{pending} finding(s) awaiting review<ChevronRight size={14} className="ml-auto" aria-hidden /></Link> : null}
          <ul className="max-h-[320px] divide-y divide-line overflow-y-auto">
            {(events ?? []).map((e) => (
              <li key={e.id} className="px-4 py-2.5">
                <div className="truncate text-[13px] font-medium text-ink">{describeEvent(e, findings ?? [], []).title}</div>
                <div className="text-[11.5px] text-faint">{formatDateTime(e.at)} · {e.actor}</div>
              </li>
            ))}
            {events && !events.length ? <li className="px-4 py-6 text-center text-[13px] text-muted">No activity yet.</li> : null}
          </ul>
          <Link to="/activity" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-[13px] font-medium text-brand hover:bg-hover">View all activity</Link>
        </div>
      ) : null}
    </div>
  );
}

function UserMenu({ onTour }: { onTour: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { reviewer } = useApp();
  const ws = useWorkspace();
  useClickOutside(ref, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button className="flex h-9 items-center gap-2 rounded-[9px] pl-1 pr-1.5 hover:bg-hover" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="User menu">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white" aria-hidden>CR</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[280px] animate-pop overflow-hidden rounded-panel border border-line bg-surface shadow-overlay" role="menu">
          <div className="border-b border-line px-4 py-3">
            <div className="text-[13.5px] font-semibold">Clinical Reviewer</div>
            <div className="text-xs text-muted">Demo Workspace · fictional profile</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-faint" data-testid="current-user"><UserRound size={12} aria-hidden />{ws.session ? `${ws.session.user.displayName} (signed in to shared workspace)` : `${reviewer} — not authenticated`}</div>
          </div>
          <div className="py-1">
            <MenuLink to="/settings" icon={Settings} onClick={() => setOpen(false)}>Settings</MenuLink>
            <MenuLink to="/help" icon={BookOpenText} onClick={() => setOpen(false)}>Help &amp; About</MenuLink>
            <button role="menuitem" className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13.5px] text-ink hover:bg-hover" onClick={() => { setOpen(false); onTour(); }}><PlayCircle size={16} className="text-faint" aria-hidden />Run guided demo</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ to, icon: Icon, children, onClick }: { to: string; icon: typeof Settings; children: ReactNode; onClick: () => void }) {
  return <Link role="menuitem" to={to} onClick={onClick} className="flex items-center gap-2.5 px-4 py-2 text-[13.5px] text-ink hover:bg-hover"><Icon size={16} className="text-faint" aria-hidden />{children}</Link>;
}

function useClickOutside(ref: React.RefObject<HTMLElement>, cb: () => void) {
  useEffect(() => {
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cb(); };
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', key); };
  }, [ref, cb]);
}

// ------------------------------------------------------------- breadcrumbs
const SECTION: Record<string, { label: string; to: string }> = {
  cases: { label: 'Clinical Cases', to: '/cases' },
  case: { label: 'Clinical Cases', to: '/cases' },
  contradictions: { label: 'Contradictions', to: '/contradictions' },
  findings: { label: 'Contradictions', to: '/contradictions' },
  documents: { label: 'Documents', to: '/documents' },
  queue: { label: 'Review Queue', to: '/queue' },
  activity: { label: 'Activity', to: '/activity' },
  timeline: { label: 'Activity', to: '/activity' },
  settings: { label: 'Settings', to: '/settings' },
  about: { label: 'Settings', to: '/settings' },
  help: { label: 'Help & About', to: '/help' },
  styleguide: { label: 'Style guide', to: '/styleguide' },
};

function Breadcrumbs() {
  const { pathname } = useLocation();
  const { caseId } = useApp();
  const [section, id] = pathname.split('/').filter(Boolean);
  const caseRec = useLiveQuery(() => (section === 'cases' && id ? db.cases.get(id) : section === 'case' && caseId ? db.cases.get(caseId) : undefined), [section, id, caseId]);
  const finding = useLiveQuery(() => (section === 'findings' && id ? db.findings.get(id) : undefined), [section, id]);
  const doc = useLiveQuery(() => (section === 'documents' && id ? db.documents.get(id) : undefined), [section, id]);
  const parentCase = useLiveQuery(() => (finding ? db.cases.get(finding.caseId) : doc ? db.cases.get(doc.caseId) : undefined), [finding?.caseId, doc?.caseId]);
  const crumbs = useMemo(() => {
    const out: { label: string; to?: string }[] = [{ label: 'Overview', to: '/' }];
    const s = SECTION[section ?? ''];
    if (!section) return [{ label: 'Overview' }];
    if (s) out.push({ label: s.label, to: id || section === 'case' ? s.to : undefined });
    if (caseRec) out.push({ label: caseRec.label.split(' · ')[0] });
    if (finding) {
      if (parentCase) out.push({ label: parentCase.label.split(' · ')[0], to: `/cases/${parentCase.id}` });
      out.push({ label: finding.displayId });
    }
    if (doc) {
      if (parentCase) out.push({ label: parentCase.label.split(' · ')[0], to: `/cases/${parentCase.id}` });
      out.push({ label: doc.title });
    }
    return out;
  }, [section, id, caseRec, finding, doc, parentCase]);
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight size={14} className="shrink-0 text-faint" aria-hidden /> : null}
            {c.to && i < crumbs.length - 1 ? <Link to={c.to} className="truncate text-muted hover:text-ink">{c.label}</Link> : <span className="truncate font-medium text-ink" aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
