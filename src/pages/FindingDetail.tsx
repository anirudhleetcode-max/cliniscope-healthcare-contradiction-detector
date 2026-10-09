import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, BookMarked, Bot, CircleHelp, History, Lightbulb, ShieldAlert } from 'lucide-react';
import { db, useApp } from '../app/state';
import { Callout, EmptyState, NatureBadge, PageSkeleton, QualityIndicator, SectionCard, SeverityBadge, StatusBadge, SyntheticBadge, TypeBadge, Badge } from '../components/ui';
import { DecisionHistory, EvidenceComparison, EvidenceHeading, ReviewPanel, useFindingDocs, useFindingEvents } from '../components/review/Review';
import { formatDateTime } from '../lib/dates';
import { natureOf, severityOf, splitLabel, suggestedQuestion } from '../lib/metrics';
import type { Finding } from '../lib/types';
import { CATEGORY_LABEL } from '../lib/types';

export function FindingDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { caseId, setCaseId } = useApp();
  const finding = useLiveQuery(() => db.findings.get(id ?? ''), [id]);
  const caseRec = useLiveQuery(() => (finding ? db.cases.get(finding.caseId) : undefined), [finding?.caseId]);
  const docs = useFindingDocs(finding);
  const events = useFindingEvents(id);

  useEffect(() => {
    // Opening a finding makes its case the active case (used by upload and analysis actions).
    if (finding && finding.caseId !== caseId) setCaseId(finding.caseId);
  }, [finding, caseId, setCaseId]);
  useEffect(() => {
    if (location.hash === '#review' && finding) document.getElementById('review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, finding?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (finding === undefined || docs === undefined || events === undefined) {
    if (finding === undefined && docs !== undefined) {
      return <EmptyState icon={<ShieldAlert size={20} />} title="Finding not found" body="This finding does not exist in this browser's records. It may belong to a demo case that was reset." action={<Link className="btn-primary" to="/contradictions">Back to contradictions</Link>} />;
    }
    return <PageSkeleton />;
  }
  const caseLabel = caseRec ? splitLabel(caseRec.label) : null;

  return (
    <div className="animate-fade-up" data-testid="finding-detail">
      <Link to="/contradictions" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-brand"><ArrowLeft size={15} />Contradictions</Link>

      <header className="mb-6">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-faint">{finding.displayId}</span>
          <SeverityBadge severity={severityOf(finding)} />
          <Badge>{CATEGORY_LABEL[finding.category]}</Badge>
          <TypeBadge type={finding.findingType} />
          <StatusBadge status={finding.reviewStatus} />
          {finding.isSeededDemo ? <SyntheticBadge /> : null}
          {finding.origin === 'ai' ? <Badge tone="brand" testId="ai-badge">AI-assisted · quotes verified</Badge> : null}
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]" data-testid="finding-title">{finding.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
          {caseRec && caseLabel ? <Link to={`/cases/${caseRec.id}`} className="font-medium text-brand hover:underline">{caseLabel.displayId} · {caseLabel.alias}</Link> : null}
          <span className="inline-flex items-center gap-1"><Bot size={13} aria-hidden />{finding.detectionMethod}</span>
          <span>Detected {formatDateTime(finding.createdAt)}</span>
          <span>Updated {formatDateTime(finding.updatedAt)}</span>
        </div>
      </header>

      {finding.stale ? <div className="mb-4"><Callout tone="warn" title="Superseded finding">The latest analysis no longer produces this finding (a source document may have been removed or changed). The original evidence and review history below are preserved.</Callout></div> : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <FindingExplanation finding={finding} />
          <div id="evidence"><EvidenceHeading /><EvidenceComparison finding={finding} docs={docs} /></div>
          <FindingContext finding={finding} />
        </div>
        <aside className="space-y-6">
          <ReviewPanel finding={finding} caseRec={caseRec} />
          <DecisionHistory finding={finding} events={events} />
        </aside>
      </div>
    </div>
  );
}

export function FindingExplanation({ finding }: { finding: Finding }) {
  return (
    <SectionCard title="Why this was flagged" icon={<Lightbulb size={16} aria-hidden />} actions={<NatureBadge nature={natureOf(finding)} />}>
      <div className="space-y-3">
        <div>
          <div className="eyebrow mb-1">{finding.origin === 'ai' ? <>AI-generated interpretation <span className="normal-case tracking-normal text-faint">· written by {finding.aiModel}; not evidence — only the verified quotes are</span></> : <>Plain-language explanation <span className="normal-case tracking-normal text-faint">· generated from a rules template, not quoted evidence</span></>}</div>
          <p className="text-[14.5px] leading-relaxed">{finding.explanation}</p>
        </div>
        <div className="rounded-lg bg-subtle px-3.5 py-2.5 text-[13px]"><span className="font-semibold">Comparison rule: </span><span className="text-ink/80">{finding.comparisonReason}</span></div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line px-3.5 py-2.5">
            <div className="eyebrow mb-1">Certainty</div>
            <QualityIndicator quality={finding.evidenceQuality} />
            <p className="mt-1 text-xs text-muted">Describes how complete and reliable the source text is — not how likely either record is to be correct. No numeric confidence score is produced.</p>
          </div>
          <div className="rounded-lg border border-info/20 bg-info-50/60 px-3.5 py-2.5" data-testid="review-question">
            <div className="eyebrow mb-1 flex items-center gap-1 text-info"><CircleHelp size={12} aria-hidden />Suggested review question</div>
            <p className="text-[13px] text-ink/85">{suggestedQuestion(finding)}</p>
            <p className="mt-1 text-[11px] text-faint">Template prompt for this finding type, not clinical advice.</p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

export function FindingContext({ finding }: { finding: Finding }) {
  return (
    <section className="card grid gap-5 p-5 md:grid-cols-2" aria-label="Context">
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><History size={15} className="text-brand" aria-hidden />Temporal &amp; contextual caveats</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] text-ink/85">{finding.contextualCaveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </div>
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><BookMarked size={15} className="text-brand" aria-hidden />Alternative explanations to consider</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] text-ink/85">{finding.alternativeExplanations.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </div>
    </section>
  );
}
