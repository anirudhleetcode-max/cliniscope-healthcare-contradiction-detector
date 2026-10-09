import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { db, useApp } from '../app/state';
import { analyzeCase } from '../lib/services';
import type { AnalysisSummary } from '../lib/types';

export function AnalyzeButton({ variant = 'primary', onDone, disabled }: { variant?: 'primary' | 'secondary'; onDone?: (s: AnalysisSummary) => void; disabled?: boolean }) {
  const { caseId, reviewer, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!caseId || busy) return;
    setBusy(true);
    try {
      const s = await analyzeCase(db, caseId, reviewer);
      toast('success', `Analysis complete: ${s.statementsExtracted} statements, ${s.comparisonsEvaluated} comparisons, ${s.findingsTotalActive} finding(s) (${s.findingsCreated} new).`);
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
