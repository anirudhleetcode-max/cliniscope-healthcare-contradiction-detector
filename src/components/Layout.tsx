import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Activity, BookOpen, FileStack, FolderKanban, GanttChartSquare, LayoutDashboard, ListChecks, Menu, PlayCircle, ScanSearch, UserRound, X,
} from 'lucide-react';
import { useApp } from '../app/state';
import { cx } from './ui';
import { DemoGuide, useDemoGuide } from './DemoGuide';
import { APP_VERSION } from '../lib/version';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/queue', label: 'Review queue', icon: ListChecks },
  { to: '/documents', label: 'Document library', icon: FileStack },
  { to: '/timeline', label: 'Case timeline', icon: GanttChartSquare },
  { to: '/cases', label: 'Cases', icon: FolderKanban },
  { to: '/about', label: 'About & settings', icon: BookOpen },
];

export function Layout({ children }: { children: ReactNode }) {
  const { currentCase, cases, setCaseId, reviewer, toasts, dismissToast } = useApp();
  const [mobileNav, setMobileNav] = useState(false);
  const guide = useDemoGuide();
  const navigate = useNavigate();

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setMobileNav(false)}
          className={({ isActive }) => cx(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-soft hover:text-ink',
          )}
        >
          <n.icon size={17} aria-hidden />{n.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen">
      {currentCase?.isDemo ? (
        <div className="bg-ink px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-white" data-testid="demo-banner">
          Demo case — synthetic data — not a real patient
        </div>
      ) : null}
      <div className="flex">
        {/* Sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-white px-3 py-5 lg:flex">
          <Brand />
          <div className="mt-6">{nav}</div>
          <div className="mt-auto space-y-3 px-1">
            <button className="btn-primary w-full" onClick={() => { guide.start(); }} data-testid="run-demo">
              <PlayCircle size={16} aria-hidden />Run Interactive Demo
            </button>
            <div className="rounded-lg bg-soft p-3 text-[11px] leading-relaxed text-muted">
              Review-support prototype. Does not diagnose or determine clinical truth. Data stays in this browser.
              <div className="mt-1 font-mono">v{APP_VERSION}</div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur md:px-6">
            <button className="btn-ghost px-2 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
            <div className="lg:hidden"><Brand compact /></div>
            <div className="ml-auto flex min-w-0 items-center gap-2 md:ml-0">
              <label htmlFor="case-switch" className="hidden text-xs font-medium text-muted md:block">Case</label>
              <select
                id="case-switch"
                className="input max-w-[14rem] py-1.5 md:max-w-xs"
                value={currentCase?.id ?? ''}
                onChange={(e) => { if (e.target.value === '__new') navigate('/cases?new=1'); else setCaseId(e.target.value); }}
              >
                {!currentCase ? <option value="">Loading cases…</option> : null}
                {cases?.map((c) => <option key={c.id} value={c.id}>{c.isDemo ? '◆ ' : ''}{c.label}</option>)}
                <option value="__new">+ New case…</option>
              </select>
            </div>
            <div className="ml-auto hidden items-center gap-2 text-xs text-muted md:flex" title="Demo identity — no authentication is implemented">
              <UserRound size={15} aria-hidden /><span className="max-w-[16rem] truncate">{reviewer}</span>
            </div>
            <button className="btn-secondary px-2.5 lg:hidden" onClick={() => guide.start()} aria-label="Run interactive demo"><PlayCircle size={16} /></button>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {mobileNav ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 h-full w-72 animate-fade-up bg-white p-4 shadow-xl">
            <div className="mb-6 flex items-center justify-between"><Brand /><button className="btn-ghost px-2" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div>
            {nav}
            <button className="btn-primary mt-6 w-full" onClick={() => { setMobileNav(false); guide.start(); }}><PlayCircle size={16} />Run Interactive Demo</button>
          </div>
        </div>
      ) : null}

      <DemoGuide guide={guide} />

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={cx(
            'pointer-events-auto flex animate-fade-up items-start gap-2 rounded-lg border bg-white px-3.5 py-3 text-sm shadow-lg',
            t.kind === 'error' ? 'border-crit/30' : t.kind === 'success' ? 'border-ok/30' : 'border-line',
          )}>
            <Activity size={16} className={cx('mt-0.5 shrink-0', t.kind === 'error' ? 'text-crit' : t.kind === 'success' ? 'text-ok' : 'text-brand')} aria-hidden />
            <span className="flex-1">{t.text}</span>
            <button className="text-muted hover:text-ink" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 px-2" aria-label="CLINISCOPE home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white"><ScanSearch size={18} aria-hidden /></span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-[0.06em]">CLINISCOPE</span>
        {!compact ? <span className="block text-[10.5px] text-muted">Evidence-first record review</span> : null}
      </span>
    </NavLink>
  );
}
