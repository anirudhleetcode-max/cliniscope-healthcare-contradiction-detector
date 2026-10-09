import { useEffect, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { db, useApp } from '../app/state';
import { useWorkspace } from '../app/workspace';
import { browserOcr } from '../lib/browserOcr';
import { ocrToText } from '../lib/extract';
import { cx } from './ui';

type Tone = 'ok' | 'warn' | 'muted' | 'crit';
function Row({ label, value, tone, detail, testid }: { label: string; value: string; tone: Tone; detail?: string; testid?: string }) {
  const cls = { ok: 'bg-ok-50 text-ok', warn: 'bg-warn-50 text-warn', muted: 'bg-slate-100 text-slate-600', crit: 'bg-crit-50 text-crit' }[tone];
  return (
    <div className="grid gap-1 border-b border-dashed border-line py-2.5 last:border-0 sm:grid-cols-[11rem,1fr]">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd><span className={cx('chip', cls)} data-testid={testid}>{value}</span>{detail ? <span className="ml-2 text-xs text-muted">{detail}</span> : null}</dd>
    </div>
  );
}

/** Live status of every capability, based on actual checks — no indicator is shown as "ready" without one. */
export function StatusPanel() {
  const { currentCase, storageError } = useApp();
  const ws = useWorkspace();
  const [storage, setStorage] = useState<{ ok: boolean; persisted: boolean | null; usage: string | null; error?: string } | null>(null);
  const [ocrUsed, setOcrUsed] = useState<number | null>(null);
  const [ocrCheck, setOcrCheck] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle');
  const [ocrDetail, setOcrDetail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        // Real write/read/delete round-trip in a separate throw-away database.
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('medguard-probe', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('p');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const tx = req.result.transaction('p', 'readwrite');
            tx.objectStore('p').put('ok', 'k');
            tx.oncomplete = () => { req.result.close(); indexedDB.deleteDatabase('medguard-probe'); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        });
        const est = await navigator.storage?.estimate?.().catch(() => null);
        const persisted = await navigator.storage?.persisted?.().catch(() => null);
        setStorage({ ok: true, persisted: persisted ?? null, usage: est?.usage != null ? `${(est.usage / 1048576).toFixed(1)} MB used` : null });
      } catch (e) {
        setStorage({ ok: false, persisted: null, usage: null, error: (e as Error)?.message ?? 'IndexedDB unavailable' });
      }
      const docs = await db.documents.toArray().catch(() => []);
      setOcrUsed(docs.filter((d) => d.extractionMethod && /ocr/.test(d.extractionMethod) && d.extractedText).length);
    })();
  }, []);

  const verifyOcr = async () => {
    setOcrCheck('running');
    try {
      const res = await fetch('./demo/scanned-discharge-letter-2025-11-20.png');
      const bytes = new Uint8Array(await res.arrayBuffer());
      const t0 = performance.now();
      const r = await browserOcr.recognizeImage(bytes);
      const text = ocrToText(r).text;
      if (!/Penicillin allergy/.test(text)) throw new Error('expected text not recognised');
      setOcrCheck('ok');
      setOcrDetail(`Self-test read the synthetic scan in ${((performance.now() - t0) / 1000).toFixed(1)} s (mean confidence ${Math.round(r.confidence)}%).`);
    } catch (e) {
      setOcrCheck('fail');
      setOcrDetail(`Self-test failed: ${(e as Error).message}`);
    }
  };

  const remote = currentCase?.remote;
  const signedIn = !!ws.session && !!remote && ws.session.serverUrl === remote.serverUrl;
  return (
    <section className="card p-5" aria-labelledby="status-h" data-testid="status-panel">
      <h2 id="status-h" className="mb-2 flex items-center gap-2 text-base font-semibold"><Activity size={17} className="text-brand" aria-hidden />Application status</h2>
      <dl>
        <Row label="Application mode" testid="status-mode" tone={remote ? 'ok' : 'muted'} value={remote ? 'Remote shared workspace (this case)' : 'Local demo mode'}
          detail={remote ? `Server ${remote.serverUrl}` : 'Core workflow runs entirely in this browser; no server, login or API key needed.'} />
        <Row label="Persistence" testid="status-persistence" tone={storageError || storage?.ok === false ? 'crit' : storage ? 'ok' : 'muted'}
          value={storageError || storage?.ok === false ? 'Browser storage unavailable' : storage ? 'IndexedDB working (write/read check passed)' : 'Checking…'}
          detail={storage?.ok ? [storage.usage, storage.persisted ? 'persistent storage granted' : 'browser may evict data under storage pressure'].filter(Boolean).join(' · ') : storageError ?? storage?.error} />
        <Row label="OCR" testid="status-ocr" tone={ocrCheck === 'ok' ? 'ok' : ocrCheck === 'fail' ? 'crit' : ocrUsed ? 'ok' : 'muted'}
          value={ocrCheck === 'ok' ? 'Available and verified' : ocrCheck === 'fail' ? 'Self-test failed' : ocrUsed ? `Available — used on ${ocrUsed} document(s) in this browser` : 'Bundled, not yet used in this browser'}
          detail={ocrDetail || 'Tesseract.js runs on this device; English printed text only, no handwriting.'} />
        <Row label="AI-assisted reasoning" testid="status-ai" tone={ws.health?.ai.configured ? 'warn' : 'muted'}
          value={!ws.serverUrl ? 'Unavailable — no server configured' : !ws.health ? 'Unavailable — server unreachable' : ws.health.ai.configured ? `Configured on server (${ws.health.ai.model})` : 'Not configured on server'}
          detail={ws.health?.ai.configured ? 'Verified only when an analysis run returns validated output.' : 'Optional. Contradiction detection uses local deterministic rules.'} />
        <Row label="Synchronization" testid="status-sync" tone={!remote ? 'muted' : remote.unsynced || ws.lastSyncError ? 'crit' : signedIn ? 'ok' : 'warn'}
          value={!remote ? 'Not configured (local case)' : remote.unsynced ? 'Unsynced local changes' : ws.lastSyncError ? 'Sync failed' : signedIn ? 'Synced' : 'Signed out'}
          detail={!remote ? 'Nothing is uploaded.' : ws.lastSyncError ?? `Last synchronized ${remote.syncedAt ?? 'never'}`} />
        <Row label="Data classification" testid="status-classification" tone={currentCase?.isDemo ? 'warn' : 'muted'}
          value={currentCase?.isDemo ? 'Synthetic demonstration data' : 'User-provided (use synthetic data only)'} detail="Not a real patient record. Not for clinical use." />
      </dl>
      <button className="btn-secondary mt-3" onClick={verifyOcr} disabled={ocrCheck === 'running'} data-testid="verify-ocr">
        {ocrCheck === 'running' ? <><Loader2 size={15} className="animate-spin" />Running OCR self-test…</> : 'Run OCR self-test'}
      </button>
    </section>
  );
}
