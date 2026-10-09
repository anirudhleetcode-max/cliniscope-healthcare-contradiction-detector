import { useState } from 'react';
import { Bot, Loader2, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { db, useApp } from '../app/state';
import { useWorkspace } from '../app/workspace';
import { runAiAnalysis, type AiRunSummary } from '../lib/aiClient';
import { withLocalWork } from '../lib/remote';
import { Callout, Modal } from './ui';

/** Optional AI-assisted reasoning. Clearly reports when it is not available; never simulates output. */
export function AiPanel({ disabled }: { disabled?: boolean }) {
  const ws = useWorkspace();
  const { caseId, currentCase, toast } = useApp();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = !!ws.health?.ai.configured;
  const ready = configured && !!ws.session && !disabled && currentCase?.remote?.role !== 'viewer';

  const run = async () => {
    if (!caseId || !ws.session) return;
    setConsent(false);
    setBusy(true);
    setError(null);
    try {
      const r = await withLocalWork(async () => {
        const out = await runAiAnalysis(db, ws.session!, caseId, ws.session!.user.displayName);
        if (currentCase?.remote) await ws.push(caseId, { detail: `AI-assisted analysis (${out.model}): ${out.created} new finding(s)` });
        return out;
      });
      setResult(r);
      toast('success', `AI-assisted analysis: ${r.created} new finding(s) with verified quotes; ${r.rejected.length} rejected.`);
    } catch (e) {
      setError((e as Error).message);
      toast('error', `AI-assisted analysis did not complete: ${(e as Error).message} The rules-based results are unaffected.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5" aria-label="AI-assisted analysis" data-testid="ai-panel">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Bot size={17} className="text-brand" aria-hidden />AI-assisted reasoning <span className="chip bg-soft text-muted">optional</span></h2>
      <p className="mb-3 text-xs text-muted">Complements the deterministic rules. A language model proposes findings; MedGuard keeps only those whose quotations are found verbatim in the extracted text, and never lets the model change review status.</p>
      <p className="mb-3 text-sm" data-testid="ai-availability">
        Status: {!ws.serverUrl ? <strong>not available — no MedGuard server configured</strong>
          : !ws.health ? <strong>server unreachable</strong>
          : !configured ? <strong>not configured on the server (no provider API key)</strong>
          : !ws.session ? <strong>available after sign-in</strong>
          : <strong className="text-ok">available ({ws.health.ai.model})</strong>}
      </p>
      <button className="btn-secondary w-full" disabled={!ready || busy} onClick={() => setConsent(true)} data-testid="run-ai">
        {busy ? <><Loader2 size={15} className="animate-spin" />Analysing with AI…</> : <><Bot size={15} />Run AI-assisted analysis</>}
      </button>
      {!ready && !busy ? <p className="mt-2 text-xs text-muted">The rules-based analysis works without AI. <Link className="text-brand hover:underline" to="/about#workspace">Configure the shared workspace</Link>.</p> : null}
      {error ? <div className="mt-3"><Callout tone="warn" title="AI analysis did not complete">{error}</Callout></div> : null}
      {result ? (
        <div className="mt-3 text-xs" data-testid="ai-result">
          <p><strong>{result.created}</strong> new AI-assisted finding(s) · {result.corroborated.length} corroborated existing findings · {result.downgraded} downgraded · {result.rejected.length} rejected (evidence not found in source text) · model {result.model}</p>
          {result.rejected.length ? <ul className="mt-1 list-disc pl-4 text-muted">{result.rejected.slice(0, 5).map((r, i) => <li key={i}>{r.title}: {r.reason}</li>)}</ul> : null}
        </div>
      ) : null}
      <Modal open={consent} onClose={() => setConsent(false)} title="Send case text to the AI provider?" footer={<>
        <button className="btn-secondary" onClick={() => setConsent(false)}>Cancel</button>
        <button className="btn-primary" onClick={run} data-testid="confirm-ai"><ShieldAlert size={15} />I understand — send synthetic text</button>
      </>}>
        <div className="space-y-2 text-sm">
          <p>The extracted text of every document in this case will be sent to <strong>{ws.serverUrl}</strong>, which forwards it to the configured external provider ({ws.health?.ai.provider}, model {ws.health?.ai.model}).</p>
          <p>Only use synthetic or properly de-identified data. The provider's data retention depends on the server operator's account configuration, which MedGuard cannot verify.</p>
          <p className="text-muted">AI output is treated as a proposal: every quotation is re-checked against the source text in this browser, and unsupported findings are rejected or downgraded.</p>
        </div>
      </Modal>
    </section>
  );
}
