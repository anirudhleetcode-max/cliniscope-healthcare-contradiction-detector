import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, useApp } from './state';
import {
  RemoteError, applySnapshot, defaultServerUrl, loadSession, pullCase, pushCase, remoteApi, saveSession, setServerUrl as persistServerUrl,
  type RemoteHealth, type RemoteSession,
} from '../lib/remote';
import { addReviewerNote, transitionFinding } from '../lib/services';
import type { CaseRecord, Finding, ReviewStatus } from '../lib/types';

interface WorkspaceState {
  serverUrl: string;
  setServerUrl: (u: string) => void;
  health: RemoteHealth | null;
  healthError: string | null;
  refreshHealth: () => Promise<void>;
  session: RemoteSession | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Throws a user-facing error if not signed in. */
  requireSession: () => RemoteSession;
  syncing: boolean;
  lastSyncError: string | null;
  pull: (caseId: string) => Promise<void>;
  push: (caseId: string, opts?: { analyzed?: boolean; detail?: string }) => Promise<void>;
  publishCase: (c: CaseRecord) => Promise<void>;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { currentCase, toast } = useApp();
  const [serverUrl, setUrl] = useState(defaultServerUrl);
  const [session, setSession] = useState<RemoteSession | null>(() => {
    const s = loadSession();
    return s && s.serverUrl === defaultServerUrl() ? s : null;
  });
  const [health, setHealth] = useState<RemoteHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  const refreshHealth = useCallback(async () => {
    if (!serverUrl) { setHealth(null); setHealthError(null); return; }
    try { setHealth(await remoteApi.health(serverUrl)); setHealthError(null); } catch (e) { setHealth(null); setHealthError((e as Error).message); }
  }, [serverUrl]);
  useEffect(() => { void refreshHealth(); }, [refreshHealth]);

  const setServerUrl = useCallback((u: string) => {
    const clean = u.trim().replace(/\/$/, '');
    persistServerUrl(clean);
    setUrl(clean);
    if (session && session.serverUrl !== clean) { saveSession(null); setSession(null); }
  }, [session]);

  const accept = useCallback((r: { token: string; expiresAt: string; user: RemoteSession['user'] }) => {
    const s = { serverUrl, ...r };
    saveSession(s);
    setSession(s);
  }, [serverUrl]);

  const signIn = useCallback(async (email: string, password: string) => accept(await remoteApi.login(serverUrl, email, password)), [serverUrl, accept]);
  const register = useCallback(async (email: string, password: string, displayName: string) => accept(await remoteApi.register(serverUrl, email, password, displayName)), [serverUrl, accept]);
  const signOut = useCallback(async () => {
    if (session) await remoteApi.logout(session).catch(() => {});
    saveSession(null);
    setSession(null);
  }, [session]);

  const requireSession = useCallback(() => {
    if (!session) throw new RemoteError(401, 'Sign in to the shared workspace (About & settings) to act on a shared case.');
    if (Date.parse(session.expiresAt) <= Date.now()) { saveSession(null); setSession(null); throw new RemoteError(401, 'Your session has expired. Sign in again.'); }
    return session;
  }, [session]);

  const handleAuthError = useCallback((e: unknown) => {
    if (e instanceof RemoteError && e.status === 401) { saveSession(null); setSession(null); }
  }, []);

  const pull = useCallback(async (caseId: string) => {
    const s = requireSession();
    setSyncing(true);
    try { await pullCase(db, s, caseId); setLastSyncError(null); } catch (e) { handleAuthError(e); setLastSyncError((e as Error).message); throw e; } finally { setSyncing(false); }
  }, [requireSession, handleAuthError]);

  const push = useCallback(async (caseId: string, opts: { analyzed?: boolean; detail?: string } = {}) => {
    const s = requireSession();
    setSyncing(true);
    try { await pushCase(db, s, caseId, opts); setLastSyncError(null); } catch (e) { handleAuthError(e); setLastSyncError((e as Error).message); throw e; } finally { setSyncing(false); }
  }, [requireSession, handleAuthError]);

  const publishCase = useCallback(async (c: CaseRecord) => {
    const s = requireSession();
    // Local review decisions and notes cannot be imported into the server's audit trail, so refuse rather than drop them silently.
    const reviewed = (await db.findings.where('caseId').equals(c.id).toArray()).some((f) => f.reviewStatus !== 'unreviewed');
    const notes = (await db.events.where('caseId').equals(c.id).toArray()).some((e) => e.kind === 'note_added' || e.kind === 'status_changed');
    if (reviewed || notes) {
      throw new RemoteError(409, 'This case already has local review decisions or notes, which cannot be carried into the shared audit trail. Create a new shared case and upload the documents there, or reset the demo case before publishing.');
    }
    try {
      await remoteApi.createCase(s, c.id, c.label);
    } catch (e) {
      // A previous publish attempt may have created the server case before its push failed: continue only if we own it.
      if (!(e instanceof RemoteError && e.status === 409)) throw e;
      const existing = await remoteApi.getCase(s, c.id).catch(() => null);
      if (existing?.role !== 'owner') throw e;
    }
    // The case becomes "shared" locally only after the first push (documents, findings, files) succeeded.
    await pushCase(db, s, c.id, { detail: 'Local case published to the shared workspace' });
  }, [requireSession]);

  // Shared cases are refreshed periodically and on focus (polling, not real-time push).
  const remoteCaseId = currentCase?.remote && session && currentCase.remote.serverUrl === session.serverUrl ? currentCase.id : null;
  useEffect(() => {
    if (!remoteCaseId || !session) return;
    let stopped = false;
    const tick = () => {
      if (stopped || document.hidden) return;
      pullCase(db, session, remoteCaseId).then(() => setLastSyncError(null)).catch((e) => { handleAuthError(e); setLastSyncError((e as Error).message); });
    };
    tick();
    const t = setInterval(tick, 15000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => { stopped = true; clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [remoteCaseId, session, handleAuthError]);

  useEffect(() => { if (lastSyncError && remoteCaseId) toast('error', `Shared workspace: ${lastSyncError}`); }, [lastSyncError]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<WorkspaceState>(() => ({
    serverUrl, setServerUrl, health, healthError, refreshHealth, session, signIn, register, signOut, requireSession,
    syncing, lastSyncError, pull, push, publishCase,
  }), [serverUrl, setServerUrl, health, healthError, refreshHealth, session, signIn, register, signOut, requireSession, syncing, lastSyncError, pull, push, publishCase]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace outside provider');
  return v;
}

/** Review actions: local service for local cases, server API (authoritative, audited) for shared cases. */
export function useReviewActions() {
  const { requireSession } = useWorkspace();
  const { reviewer } = useApp();
  const transition = useCallback(async (f: Finding, c: CaseRecord | undefined, to: ReviewStatus, reason?: string) => {
    if (c?.remote) {
      const s = requireSession();
      try {
        await applySnapshot(db, s.serverUrl, await remoteApi.transition(s, f.id, to, reason, f.reviewStatus));
      } catch (e) {
        if (e instanceof RemoteError && e.status === 409) await pullCase(db, s, c.id).catch(() => {});
        throw e;
      }
      return;
    }
    await transitionFinding(db, f.id, to, { reason, reviewer });
  }, [requireSession, reviewer]);
  const note = useCallback(async (f: Finding, c: CaseRecord | undefined, text: string) => {
    if (c?.remote) {
      const s = requireSession();
      await applySnapshot(db, s.serverUrl, await remoteApi.note(s, f.id, text));
      return;
    }
    await addReviewerNote(db, f.id, text, reviewer);
  }, [requireSession, reviewer]);
  return { transition, note };
}
