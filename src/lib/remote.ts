// Shared-workspace client: API calls, session handling and synchronization of
// a server case into the local IndexedDB cache (the server is authoritative).
import type { MedguardDB } from './db';
import type { AuditEvent, CaseRecord, CaseRole, ClinicalStatement, DocumentRecord, Finding, ReviewStatus } from './types';

const LS_SERVER = 'medguard.serverUrl';
const SS_SESSION = 'medguard.session';

export interface RemoteUser { id: string; email: string; displayName: string }
export interface RemoteSession { serverUrl: string; token: string; expiresAt: string; user: RemoteUser }
export interface RemoteHealth { ok: boolean; version: string; ai: { configured: boolean; provider: string | null; model: string | null }; registration: boolean }
export interface RemoteMember { userId: string; email: string; displayName: string; role: CaseRole }
export interface RemoteSnapshot {
  case: { id: string; label: string; createdAt: string; updatedAt: string; lastAnalyzedAt: string | null; owner: string };
  role: CaseRole;
  members: RemoteMember[];
  documents: (DocumentRecord & { hasServerFile: boolean })[];
  statements: ClinicalStatement[];
  findings: Finding[];
  events: AuditEvent[];
  serverTime: string;
}
export interface RemoteCaseSummary { id: string; label: string; updatedAt: string; lastAnalyzedAt: string | null; role: CaseRole; owner: string; documents: number; findings: number }

export class RemoteError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}

function safeGet(store: Storage | undefined, k: string): string | null { try { return store?.getItem(k) ?? null; } catch { return null; } }
function safeSet(store: Storage | undefined, k: string, v: string | null) { try { if (v === null) store?.removeItem(k); else store?.setItem(k, v); } catch { /* storage unavailable */ } }

export function defaultServerUrl(): string {
  return (safeGet(globalThis.localStorage, LS_SERVER) ?? (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');
}
export function setServerUrl(url: string) { safeSet(globalThis.localStorage, LS_SERVER, url.trim().replace(/\/$/, '') || null); }

/** Session token lives in sessionStorage: it is gone when the tab closes, and is never put in localStorage. */
export function loadSession(): RemoteSession | null {
  const raw = safeGet(globalThis.sessionStorage, SS_SESSION);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as RemoteSession;
    return Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch { return null; }
}
export function saveSession(s: RemoteSession | null) { safeSet(globalThis.sessionStorage, SS_SESSION, s ? JSON.stringify(s) : null); }

export async function apiFetch<T>(serverUrl: string, path: string, opts: { method?: string; token?: string; body?: unknown; raw?: Blob | Uint8Array; timeoutMs?: number; blob?: boolean } = {}): Promise<T> {
  if (!/^https?:\/\//.test(serverUrl)) throw new RemoteError(0, 'No shared-workspace server is configured.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
  let res: Response;
  try {
    res = await fetch(serverUrl + path, {
      method: opts.method ?? (opts.body !== undefined || opts.raw ? 'POST' : 'GET'),
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.raw ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      body: opts.raw ? (opts.raw as BodyInit) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new RemoteError(0, (e as Error)?.name === 'AbortError' ? 'The shared-workspace server did not respond in time.' : 'The shared-workspace server could not be reached. Your data is still available locally.');
  } finally {
    clearTimeout(timer);
  }
  if (opts.blob && res.ok) return (await res.blob()) as unknown as T;
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) throw new RemoteError(res.status, json?.error ?? `Server error (HTTP ${res.status}).`, json?.code);
  return json as T;
}

export const remoteApi = {
  health: (url: string) => apiFetch<RemoteHealth>(url, '/api/health', { timeoutMs: 8000 }),
  register: (url: string, email: string, password: string, displayName: string) => apiFetch<{ token: string; expiresAt: string; user: RemoteUser }>(url, '/api/auth/register', { body: { email, password, displayName } }),
  login: (url: string, email: string, password: string) => apiFetch<{ token: string; expiresAt: string; user: RemoteUser }>(url, '/api/auth/login', { body: { email, password } }),
  logout: (s: RemoteSession) => apiFetch(s.serverUrl, '/api/auth/logout', { method: 'POST', token: s.token }),
  listCases: (s: RemoteSession) => apiFetch<{ cases: RemoteCaseSummary[] }>(s.serverUrl, '/api/cases', { token: s.token }),
  createCase: (s: RemoteSession, id: string | undefined, label: string) => apiFetch<RemoteSnapshot>(s.serverUrl, '/api/cases', { token: s.token, body: { id, label } }),
  getCase: (s: RemoteSession, id: string) => apiFetch<RemoteSnapshot>(s.serverUrl, `/api/cases/${encodeURIComponent(id)}`, { token: s.token }),
  addMember: (s: RemoteSession, id: string, email: string, role: 'reviewer' | 'viewer') => apiFetch<RemoteSnapshot>(s.serverUrl, `/api/cases/${encodeURIComponent(id)}/members`, { token: s.token, body: { email, role } }),
  removeMember: (s: RemoteSession, id: string, userId: string) => apiFetch<RemoteSnapshot>(s.serverUrl, `/api/cases/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { token: s.token, method: 'DELETE' }),
  snapshot: (s: RemoteSession, id: string, body: { documents: DocumentRecord[]; statements: ClinicalStatement[]; findings: Finding[]; removedDocumentIds?: string[]; analyzed?: boolean; detail?: string }) =>
    apiFetch<RemoteSnapshot>(s.serverUrl, `/api/cases/${encodeURIComponent(id)}/snapshot`, { token: s.token, method: 'PUT', body, timeoutMs: 60000 }),
  uploadFile: (s: RemoteSession, caseId: string, docId: string, blob: Blob) => apiFetch(s.serverUrl, `/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(docId)}/file`, { token: s.token, method: 'PUT', raw: blob, timeoutMs: 60000 }),
  downloadFile: (s: RemoteSession, caseId: string, docId: string) => apiFetch<Blob>(s.serverUrl, `/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(docId)}/file`, { token: s.token, blob: true }),
  transition: (s: RemoteSession, findingId: string, to: ReviewStatus, reason: string | undefined, expectedStatus: ReviewStatus) =>
    apiFetch<RemoteSnapshot>(s.serverUrl, `/api/findings/${encodeURIComponent(findingId)}/transition`, { token: s.token, body: { to, reason, expectedStatus } }),
  note: (s: RemoteSession, findingId: string, note: string) => apiFetch<RemoteSnapshot>(s.serverUrl, `/api/findings/${encodeURIComponent(findingId)}/notes`, { token: s.token, body: { note } }),
  aiAnalyze: (s: RemoteSession, body: unknown) => apiFetch<{ provider: string; model: string; raw: unknown; summary: { accepted: number; rejected: { title: string; reason: string }[]; consistent: string[]; downgraded: number } }>(s.serverUrl, '/api/ai/analyze', { token: s.token, body, timeoutMs: 180000 }),
};

/**
 * Applies the server's authoritative state of a shared case to the local cache.
 * If the case has unsynced local changes (and this is not the result of a successful push),
 * local-only documents, statements, files and findings are KEPT and the unsynced flag survives.
 */
export async function applySnapshot(db: MedguardDB, serverUrl: string, snap: RemoteSnapshot, opts: { afterPush?: boolean } = {}): Promise<CaseRecord> {
  const caseId = snap.case.id;
  const existing = await db.cases.get(caseId);
  const keepLocal = !opts.afterPush && !!existing?.remote?.unsynced;
  const rec: CaseRecord = {
    id: caseId,
    label: snap.case.label,
    isDemo: existing?.isDemo ?? false,
    createdAt: snap.case.createdAt,
    updatedAt: snap.case.updatedAt,
    lastAnalyzedAt: snap.case.lastAnalyzedAt,
    remote: {
      serverUrl, role: snap.role, owner: snap.case.owner, syncedAt: snap.serverTime,
      ...(keepLocal ? { unsynced: true, pendingRemovals: existing!.remote!.pendingRemovals ?? [] } : {}),
    },
  };
  await db.transaction('rw', [db.cases, db.documents, db.statements, db.findings, db.events, db.files], async () => {
    await db.cases.put(rec);
    const serverDocIds = new Set(snap.documents.map((d) => d.id));
    const pendingRemoval = new Set(keepLocal ? existing!.remote!.pendingRemovals ?? [] : []);
    const localDocs = await db.documents.where('caseId').equals(caseId).toArray();
    const localOnly = new Set(keepLocal ? localDocs.filter((d) => !serverDocIds.has(d.id)).map((d) => d.id) : []);
    for (const d of localDocs) {
      if (!serverDocIds.has(d.id) && !localOnly.has(d.id)) { await db.documents.delete(d.id); await db.files.delete(d.id); }
    }
    await db.documents.bulkPut(snap.documents.filter((d) => !pendingRemoval.has(d.id)).map(({ hasServerFile: _h, ...d }) => d));
    const keptStatements = keepLocal ? (await db.statements.where('caseId').equals(caseId).toArray()).filter((x) => localOnly.has(x.documentId)) : [];
    await db.statements.where('caseId').equals(caseId).delete();
    await db.statements.bulkPut([...snap.statements.filter((x) => !pendingRemoval.has(x.documentId)), ...keptStatements]);
    const serverFp = new Set(snap.findings.map((f) => f.fingerprint));
    const keptFindings = keepLocal ? (await db.findings.where('caseId').equals(caseId).toArray()).filter((f) => !serverFp.has(f.fingerprint)) : [];
    await db.findings.where('caseId').equals(caseId).delete();
    await db.findings.bulkPut([...snap.findings, ...keptFindings]);
    await db.events.where('caseId').equals(caseId).delete();
    await db.events.bulkPut(snap.events);
  });
  return rec;
}

/** Records that a shared case has local changes the server has not accepted yet (suspends background pulls). */
export async function markUnsynced(db: MedguardDB, caseId: string, removedDocumentId?: string): Promise<void> {
  const c = await db.cases.get(caseId);
  if (!c?.remote) return;
  const pending = new Set(c.remote.pendingRemovals ?? []);
  if (removedDocumentId) pending.add(removedDocumentId);
  await db.cases.update(caseId, { remote: { ...c.remote, unsynced: true, pendingRemovals: [...pending] } });
}

/**
 * Pushes the local state of a shared case (documents, statements, findings) and any missing original files.
 * The server MERGES: nothing is deleted because it is missing from the snapshot; deletions are explicit.
 * The unsynced flag is cleared only when the whole push (including files) succeeded.
 */
export async function pushCase(db: MedguardDB, s: RemoteSession, caseId: string, opts: { analyzed?: boolean; detail?: string } = {}): Promise<RemoteSnapshot> {
  await markUnsynced(db, caseId);
  const c = await db.cases.get(caseId);
  const documents = await db.documents.where('caseId').equals(caseId).toArray();
  const statements = await db.statements.where('caseId').equals(caseId).toArray();
  const findings = await db.findings.where('caseId').equals(caseId).toArray();
  const snap = await remoteApi.snapshot(s, caseId, { documents, statements, findings, removedDocumentIds: c?.remote?.pendingRemovals ?? [], ...opts });
  const missing = snap.documents.filter((d) => !d.hasServerFile);
  for (const d of missing) {
    const f = await db.files.get(d.id);
    if (f) await remoteApi.uploadFile(s, caseId, d.id, f.blob);
  }
  const fresh = missing.length ? await remoteApi.getCase(s, caseId) : snap;
  await applySnapshot(db, s.serverUrl, fresh, { afterPush: true }); // only a fully successful push clears the unsynced flag
  return fresh;
}

/** While local work (upload, extraction, analysis) is in flight, background pulls are skipped so unsynced local data is not replaced. */
const localWork = { n: 0 };
export async function withLocalWork<T>(fn: () => Promise<T>): Promise<T> {
  localWork.n++;
  try { return await fn(); } finally { localWork.n--; }
}
export function localWorkInProgress(): boolean { return localWork.n > 0; }

export async function pullCase(db: MedguardDB, s: RemoteSession, caseId: string): Promise<RemoteSnapshot | null> {
  const unsynced = async () => localWork.n > 0 || !!(await db.cases.get(caseId))?.remote?.unsynced;
  if (await unsynced()) return null;
  const snap = await remoteApi.getCase(s, caseId);
  if (await unsynced()) return null;
  await applySnapshot(db, s.serverUrl, snap);
  return snap;
}

/** Original file for a document: local copy first, then (for shared cases) the server, cached locally afterwards. */
export async function getOriginalBlob(db: MedguardDB, docId: string, session: RemoteSession | null): Promise<Blob | null> {
  const local = await db.files.get(docId);
  if (local) return local.blob;
  const doc = await db.documents.get(docId);
  const c = doc ? await db.cases.get(doc.caseId) : undefined;
  if (!doc || !c?.remote || !session || session.serverUrl !== c.remote.serverUrl) return null;
  try {
    const blob = await remoteApi.downloadFile(session, c.id, docId);
    // Type comes from the validated file kind, never from server/client-supplied MIME strings.
    const typed = new Blob([blob], { type: SAFE_MIME[doc.fileKind] ?? 'application/octet-stream' });
    await db.files.put({ id: docId, caseId: c.id, blob: typed });
    return typed;
  } catch {
    return null;
  }
}

/** Fixed MIME type per supported file kind (used for local object URLs). */
export const SAFE_MIME: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', image: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
