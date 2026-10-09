import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { db, useApp } from '../app/state';
import { analyzeCase } from '../lib/services';
import { withLocalWork } from '../lib/remote';
import { useWorkspace } from '../app/workspace';
import type { AnalysisSummary } from '../lib/types';

export function AnalyzeButton({ variant = 'primary', onDone, disabled, caseId: forCase }: { variant?: 'primary' | 'secondary'; onDone?: (s: AnalysisSummary) => void; disabled?: boolean; caseId?: string }) {
  const app = useApp();
  const { reviewer, toast } = app;
  const caseId = forCase ?? app.caseId;
  const currentCase = app.cases?.find((c) => c.id === caseId);
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!caseId || busy) return;
    setBusy(true);
    try {
      const remote = !!currentCase?.remote;
      if (remote) ws.requireSession();
      const s = await withLocalWork(async () => {
        const sum = await analyzeCase(db, caseId, ws.session?.user.displayName ?? reviewer);
        if (remote) await ws.push(caseId, { analyzed: true, detail: `Rules analysis: ${sum.comparisonsEvaluated} comparisons, ${sum.findingsTotalActive} findings` });
        return sum;
      });
      toast('success', `Analysis complete: ${s.statementsExtracted} statements, ${s.comparisonsEvaluated} comparisons, ${s.findingsTotalActive} finding(s) (${s.findingsCreated} new)${remote ? ' — synchronized to the shared workspace' : ''}.`);
      onDone?.(s);
    } catch (e) {
      toast('error', `Analysis failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'} onClick={run} disabled={busy || disabled || !caseId} data-testid="analyze-button" aria-busy={busy}>
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
      {busy ? 'Analyzing documents…' : 'Analyze documents'}
    </button>
  );
}
