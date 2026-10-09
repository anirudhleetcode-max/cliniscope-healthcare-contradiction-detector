import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CornerDownLeft, FileText, FolderOpen, GitCompareArrows, LayoutDashboard, Search, SearchX } from 'lucide-react';
import { db } from '../../app/state';
import { cx, Kbd, StatusBadge } from '../ui';
import { CATEGORY_LABEL, DOCUMENT_TYPE_LABEL } from '../../lib/types';
import { splitLabel } from '../../lib/metrics';

interface Result { id: string; group: 'Pages' | 'Cases' | 'Findings' | 'Documents'; title: string; sub: string; to: string; extra?: React.ReactNode }

const PAGES: Result[] = [
  { id: 'p-overview', group: 'Pages', title: 'Overview', sub: 'Clinical overview dashboard', to: '/' },
  { id: 'p-cases', group: 'Pages', title: 'Clinical Cases', sub: 'All cases in the workspace', to: '/cases' },
  { id: 'p-contra', group: 'Pages', title: 'Contradictions', sub: 'Explore all findings', to: '/contradictions' },
  { id: 'p-docs', group: 'Pages', title: 'Documents', sub: 'Document library and import', to: '/documents' },
  { id: 'p-queue', group: 'Pages', title: 'Review Queue', sub: 'Pending reviews', to: '/queue' },
  { id: 'p-activity', group: 'Pages', title: 'Activity', sub: 'Local activity log', to: '/activity' },
  { id: 'p-settings', group: 'Pages', title: 'Settings', sub: 'Workspace, data and capabilities', to: '/settings' },
  { id: 'p-help', group: 'Pages', title: 'Help & About', sub: 'How MEDGAURD works', to: '/help' },
];

const ICON = { Pages: LayoutDashboard, Cases: FolderOpen, Findings: GitCompareArrows, Documents: FileText };

/** Global search over cases, patient aliases, findings and documents (Ctrl/Cmd+K). Purely local. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const cases = useLiveQuery(() => (open ? db.cases.toArray() : []), [open]);
  const findings = useLiveQuery(() => (open ? db.findings.filter((f) => !f.stale).toArray() : []), [open]);
  const docs = useLiveQuery(() => (open ? db.documents.toArray() : []), [open]);

  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    const caseLabel = new Map((cases ?? []).map((c) => [c.id, splitLabel(c.label).displayId]));
    const match = (...parts: (string | null | undefined)[]) => !term || parts.some((p) => p?.toLowerCase().includes(term));
    const out: Result[] = [];
    out.push(...PAGES.filter((p) => match(p.title, p.sub)).slice(0, term ? 3 : 4));
    out.push(...(cases ?? []).filter((c) => match(c.label, c.demoScenario)).slice(0, 6).map((c) => {
      const { displayId, alias } = splitLabel(c.label);
      return { id: c.id, group: 'Cases' as const, title: displayId, sub: alias !== '—' ? alias : 'Local case', to: `/cases/${c.id}` };
    }));
    out.push(...(findings ?? []).filter((f) => match(f.title, f.displayId, CATEGORY_LABEL[f.category], caseLabel.get(f.caseId))).slice(0, 8).map((f) => ({
      id: f.id, group: 'Findings' as const, title: f.title, sub: `${f.displayId} · ${caseLabel.get(f.caseId) ?? ''} · ${CATEGORY_LABEL[f.category]}`, to: `/findings/${f.id}`, extra: <StatusBadge status={f.reviewStatus} />,
    })));
    out.push(...(docs ?? []).filter((d) => match(d.title, d.originalFilename, caseLabel.get(d.caseId))).slice(0, 6).map((d) => ({
      id: d.id, group: 'Documents' as const, title: d.title, sub: `${DOCUMENT_TYPE_LABEL[d.documentType]} · ${caseLabel.get(d.caseId) ?? ''}`, to: `/documents/${d.id}`,
    })));
    return out;
  }, [q, cases, findings, docs]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  if (!open) return null;
  const go = (r: Result | undefined) => { if (!r) return; onClose(); navigate(r.to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-[75] flex animate-fade-in items-start justify-center bg-ink/40 px-3 pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search the workspace" className="w-full max-w-[640px] animate-pop overflow-hidden rounded-panel border border-line bg-surface shadow-overlay" data-testid="command-palette">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={18} className="text-faint" aria-hidden />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search cases, patient aliases, findings, documents…" className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            role="combobox" aria-expanded="true" aria-controls="palette-results" aria-activedescendant={results[active] ? `pr-${results[active].id}` : undefined} aria-label="Search" data-testid="palette-input" />
          <Kbd>Esc</Kbd>
        </div>
        {results.length ? (
          <ul id="palette-results" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto py-2" aria-label="Search results">
            {results.map((r, i) => {
              const header = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              const Icon = ICON[r.group];
              return (
                <li key={`${r.group}-${r.id}`} role="presentation">
                  {header ? <div className="eyebrow px-4 pb-1 pt-3" role="presentation">{header}</div> : null}
                  <div id={`pr-${r.id}`} role="option" aria-selected={i === active} data-idx={i} onMouseMove={() => setActive(i)} onClick={() => go(r)}
                    className={cx('mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2', i === active ? 'bg-brand-50' : '')} data-testid="palette-result">
                    <Icon size={16} className={i === active ? 'text-brand' : 'text-faint'} aria-hidden />
                    <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium text-ink">{r.title}</div><div className="truncate text-xs text-muted">{r.sub}</div></div>
                    {r.extra}
                    {i === active ? <CornerDownLeft size={14} className="text-faint" aria-hidden /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <SearchX size={22} className="mb-2 text-faint" aria-hidden />
            <div className="text-[14px] font-medium">No results for “{q}”</div>
            <p className="mt-1 text-[13px] text-muted">Try a case ID (e.g. DEMO-0107), a patient alias, a drug name or a document title.</p>
          </div>
        )}
        <div className="flex items-center gap-4 border-t border-line bg-subtle px-4 py-2 text-[11.5px] text-faint">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd>navigate</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd>open</span>
          <span className="ml-auto">Searches this browser's local data only</span>
        </div>
      </div>
    </div>
  );
}
