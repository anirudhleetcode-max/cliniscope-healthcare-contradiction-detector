import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../lib/db';
import { browserExtractor } from '../lib/browserExtract';
import { DEMO_REVIEWER, seedDemoWorkspace, type DemoFile } from '../lib/services';
import { DEMO_MANIFEST } from '../../scripts/demo-content.mjs';
import { defaultServerUrl, loadSession } from '../lib/remote';
import type { AuditEvent, CaseRecord, ClinicalStatement, DocumentRecord, Finding } from '../lib/types';

export const db = getDb();
export const extractor = browserExtractor;

const LS_CASE = 'medguard.currentCase';
const LS_REVIEWER = 'medguard.reviewer';
const LS_PREFS = 'medguard.prefs';

export interface Prefs { sidebarCompact: boolean; reduceMotion: boolean }
const DEFAULT_PREFS: Prefs = { sidebarCompact: false, reduceMotion: false };

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable: convenience only */ }
}

export interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }

interface AppState {
  cases: CaseRecord[] | undefined;
  caseId: string | null;
  currentCase: CaseRecord | undefined;
  setCaseId: (id: string) => void;
  reviewer: string;
  setReviewer: (r: string) => void;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  seeding: boolean;
  seedStage: string | null;
  seedError: string | null;
  resetDemo: (opts?: { select?: boolean }) => Promise<CaseRecord | null>;
  storageError: string | null;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  /**
   * True while signed in to the shared workspace. The fictional demo is then neither seeded nor shown:
   * the signed-in views contain only the account's server cases and cases created in this browser.
   */
  accountMode: boolean;
  setAccountMode: (v: boolean) => void;
}

/** Whether a stored session for the configured server exists (read synchronously, before the first render). */
function hasStoredSession(): boolean {
  const s = loadSession();
  return !!s && s.serverUrl === defaultServerUrl();
}

const Ctx = createContext<AppState | null>(null);

export async function fetchDemoFiles(): Promise<{ meta: DemoFile; bytes: Uint8Array }[]> {
  return Promise.all(
    (DEMO_MANIFEST as DemoFile[]).map(async (meta) => {
      const res = await fetch(`./demo/${meta.file}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Could not load demo file ${meta.file} (HTTP ${res.status}).`);
      return { meta, bytes: new Uint8Array(await res.arrayBuffer()) };
    }),
  );
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [storageError, setStorageError] = useState<string | null>(null);
  const [accountMode, setAccountMode] = useState(hasStoredSession);
  const allCases = useLiveQuery(async () => {
    try {
      return await db.cases.orderBy('createdAt').toArray();
    } catch (e) {
      setStorageError(e instanceof Error ? e.message : 'IndexedDB unavailable');
      return [];
    }
  }, []);
  const cases = useMemo(() => (allCases && accountMode ? allCases.filter((c) => !c.isDemo) : allCases), [allCases, accountMode]);
  const [caseId, setCaseIdState] = useState<string | null>(() => lsGet(LS_CASE));
  const [reviewer, setReviewerState] = useState<string>(() => lsGet(LS_REVIEWER) || DEMO_REVIEWER);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [seedStage, setSeedStage] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const seededOnce = useRef(false);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(lsGet(LS_PREFS) ?? '{}') }; } catch { return DEFAULT_PREFS; }
  });
  const setPref = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => { const n = { ...p, [k]: v }; lsSet(LS_PREFS, JSON.stringify(n)); return n; });
  }, []);
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion); }, [prefs.reduceMotion]);
  const toastId = useRef(0);

  const setCaseId = useCallback((id: string) => { setCaseIdState(id); lsSet(LS_CASE, id); }, []);
  const setReviewer = useCallback((r: string) => { setReviewerState(r); lsSet(LS_REVIEWER, r); }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);

  const caseIdRef = useRef(caseId);
  caseIdRef.current = caseId;
  const resetDemo = useCallback(async (opts: { select?: boolean } = {}) => {
    setSeeding(true);
    setSeedError(null);
    const before = caseIdRef.current;
    try {
      setSeedStage('Downloading the synthetic demo documents');
      const files = await fetchDemoFiles();
      const c = await seedDemoWorkspace(db, extractor, files, setSeedStage);
      // Background auto-seeding must not hijack a case the user opened meanwhile.
      if (opts.select !== false || !caseIdRef.current || caseIdRef.current === before) setCaseId(c.id);
      return c;
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Demo seeding failed');
      return null;
    } finally {
      setSeeding(false);
      setSeedStage(null);
    }
  }, [setCaseId]);

  // First signed-out visit: create the synthetic demo case (documents ingested, not yet analyzed).
  // Never while signed in: an empty account shows empty states, not fictional records.
  useEffect(() => {
    if (!cases || storageError) return;
    if (cases.length === 0) {
      if (accountMode || seededOnce.current) return;
      seededOnce.current = true;
      void resetDemo({ select: false });
    } else if (!caseId || !cases.some((c) => c.id === caseId)) {
      setCaseId((cases.find((c) => c.demoKey === 'DEMO-0042') ?? cases.find((c) => c.isDemo) ?? cases[0]).id);
    }
  }, [cases, caseId, resetDemo, setCaseId, storageError, accountMode]);

  const currentCase = cases?.find((c) => c.id === caseId);
  const value = useMemo<AppState>(() => ({
    cases, caseId: currentCase ? caseId : null, currentCase, setCaseId, reviewer, setReviewer, toasts, toast, dismissToast,
    seeding, seedStage, seedError, resetDemo, storageError, prefs, setPref, accountMode, setAccountMode,
  }), [cases, caseId, currentCase, setCaseId, reviewer, setReviewer, toasts, toast, dismissToast, seeding, seedStage, seedError, resetDemo, storageError, prefs, setPref, accountMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/** Live data for the current case. Re-renders automatically on any write. */
export function useCaseData(caseId: string | null) {
  const documents = useLiveQuery<DocumentRecord[]>(() => (caseId ? db.documents.where('caseId').equals(caseId).toArray() : []), [caseId]);
  const findings = useLiveQuery<Finding[]>(() => (caseId ? db.findings.where('caseId').equals(caseId).toArray() : []), [caseId]);
  const statements = useLiveQuery<ClinicalStatement[]>(() => (caseId ? db.statements.where('caseId').equals(caseId).toArray() : []), [caseId]);
  const events = useLiveQuery<AuditEvent[]>(() => (caseId ? db.events.where('caseId').equals(caseId).sortBy('at') : []), [caseId]);
  return { documents, findings, statements, events, loading: !documents || !findings || !statements || !events };
}

/** Live data for the whole local workspace (all cases). Re-renders automatically on any write. */
export function useWorkspaceData() {
  const { accountMode } = useApp();
  const allCases = useLiveQuery<CaseRecord[]>(() => db.cases.orderBy('createdAt').toArray(), []);
  const allDocuments = useLiveQuery<DocumentRecord[]>(() => db.documents.toArray(), []);
  const allFindings = useLiveQuery<Finding[]>(() => db.findings.toArray(), []);
  const allEvents = useLiveQuery<AuditEvent[]>(() => db.events.orderBy('at').toArray(), []);
  // Signed in: the demo's cases, documents, findings and events are excluded from every view and metric.
  return useMemo(() => {
    const loading = !allCases || !allDocuments || !allFindings || !allEvents;
    if (!accountMode || loading) return { cases: allCases, documents: allDocuments, findings: allFindings, events: allEvents, loading };
    const cases = allCases.filter((c) => !c.isDemo);
    const ids = new Set(cases.map((c) => c.id));
    return {
      cases, documents: allDocuments.filter((d) => ids.has(d.caseId)), findings: allFindings.filter((f) => ids.has(f.caseId)),
      events: allEvents.filter((e) => ids.has(e.caseId)), loading,
    };
  }, [accountMode, allCases, allDocuments, allFindings, allEvents]);
}
