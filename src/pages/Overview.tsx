import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AccountOverview } from '../components/AccountOverview';
import { ArrowRight, CheckCircle2, Cloud, Cpu, FileStack, FileUp, FlaskConical, FolderOpen, GitCompareArrows, HardDrive, ListChecks, ScanText } from 'lucide-react';
import { useApp, useWorkspaceData } from '../app/state';
import { useWorkspace } from '../app/workspace';
import { AnalyzeButton } from '../components/AnalyzeButton';
import { BarList, CHART, Donut, type Datum } from '../components/charts';
import { AnalysisSummaryList, FindingsTable } from '../components/clinical';
import { Badge, Callout, EmptyState, MetricCard, PageHeader, PageSkeleton, SectionCard, cx } from '../components/ui';
import { formatDateTime } from '../lib/dates';
import { isOpen, SEVERITY_ORDER, severityOf, splitLabel, summarizeCase, workspaceMetrics } from '../lib/metrics';
import type { AnalysisSummary, Category, ReviewStatus } from '../lib/types';
import { CATEGORY_LABEL, REVIEW_STATUS_LABEL } from '../lib/types';
import { describeEvent, isSeededEvent } from './Activity';

const CATEGORY_COLOR: Record<Category, string> = {
  medication: CHART.brand, allergy: CHART.crit, demographic: CHART.info, diagnosis: CHART.warn, lab: 'rgb(124 92 196)',
  procedure: CHART.slate, history: CHART.slate, other: CHART.neutral,
};
export const STATUS_COLOR: Record<ReviewStatus, string> = {
  unreviewed: CHART.neutral, in_review: CHART.info, needs_info: CHART.warn, confirmed: CHART.crit, undetermined: 'rgb(214 170 92)',
  expected_change: 'rgb(94 170 140)', resolved: CHART.ok, dismissed: CHART.slate,
};

/**
 * The account card (sign-in choices, or the signed-in user's server data) is rendered once, outside the
 * demo's loading/loaded branches, so the demo finishing to load never unmounts, re-animates or moves it.
 */
export function Overview() {
  const navigate = useNavigate();
  const { accountMode } = useApp();
  // Signed in, the dashboard is the account's server data only; the fictional demo is not shown.
  return (
    <div className="space-y-6">
      <AccountOverview onExploreDemo={() => navigate('/cases')} />
      {accountMode ? null : <DemoOverview />}
    </div>
  );
}

function DemoOverview() {
  const ws = useWorkspace();
  const { seeding, seedStage, seedError, resetDemo, storageError } = useApp();
  const { cases, documents, findings, events, loading } = useWorkspaceData();
  const [justRan, setJustRan] = useState<{ caseId: string; summary: AnalysisSummary } | null>(null);
  const metrics = useMemo(() => (loading ? null : workspaceMetrics(cases!, documents!, findings!)), [loading, cases, documents, findings]);

  if (storageError) return <Callout tone="warn" title="Browser storage unavailable">MedGuard stores data in this browser's IndexedDB, which is unavailable ({storageError}). Private browsing modes or blocked site data can cause this. Try a normal browser window.</Callout>;
  if (seedError) return <Callout tone="warn" title="The demonstration workspace could not be loaded" action={<button className="btn-secondary" onClick={() => void resetDemo()}>Try again</button>}>{seedError}</Callout>;
  if (seeding || loading || !metrics) {
    return (
      <div className="space-y-5">
        {seeding ? <Callout title="Preparing the synthetic demonstration workspace">Ingesting fictional records and extracting their text in your browser (including OCR of a scanned letter). Nothing is uploaded.<div className="mt-1 font-medium" role="status" data-testid="seed-stage">{seedStage ?? 'Starting…'}</div></Callout> : null}
        <PageSkeleton />
      </div>
    );
  }

  const primary = cases!.find((c) => c.demoKey === 'DEMO-0042') ?? cases!.find((c) => c.isDemo);
  const summaries = cases!.map((c) => summarizeCase(c, documents!, findings!));
  const awaiting = summaries.filter((s) => s.state === 'awaiting_analysis');
  const caseMap = new Map(cases!.map((c) => [c.id, c]));
  const open = findings!.filter((f) => !f.stale && isOpen(f) && caseMap.has(f.caseId))
    .sort((a, b) => SEVERITY_ORDER.indexOf(severityOf(a)) - SEVERITY_ORDER.indexOf(severityOf(b)) || b.updatedAt.localeCompare(a.updatedAt));
  const catData: Datum[] = [...metrics.byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: CATEGORY_LABEL[k], value: v, color: CATEGORY_COLOR[k], to: `/contradictions?category=${k}` }));
  const statusOrder: ReviewStatus[] = ['unreviewed', 'in_review', 'needs_info', 'confirmed', 'undetermined', 'expected_change', 'resolved', 'dismissed'];
  const statusData: Datum[] = statusOrder.filter((s) => metrics.byStatus.get(s)).map((s) => ({ key: s, label: REVIEW_STATUS_LABEL[s], value: metrics.byStatus.get(s)!, color: STATUS_COLOR[s] }));
  const activity = [...events!].reverse().filter((e) => ['status_changed', 'note_added', 'analysis_completed', 'document_uploaded', 'demo_reset', 'case_created'].includes(e.kind)).slice(0, 7);
  const totalFindings = [...metrics.byCategory.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Clinical Overview"
        meta={<Badge tone="warn" icon={<FlaskConical size={12} aria-hidden />} testId="local-demo-badge">LOCAL DEMO</Badge>}
        description="Identify conflicting statements across clinical records and organize them for human review."
        actions={<>
          {primary ? <Link to={`/cases/${primary.id}`} className="btn-primary" data-testid="open-demo-case"><FolderOpen size={16} aria-hidden />Open Demo Case</Link> : null}
          <Link to="/documents#import" className="btn-secondary"><FileUp size={16} aria-hidden />Import Documents</Link>
        </>}
      />

      {awaiting.length ? (
        <div className="mb-6 space-y-3">
          {awaiting.map((s) => (
            <Callout key={s.caseRecord.id} tone="info" title="Documents are ready for analysis"
              action={<AnalyzeButton caseId={s.caseRecord.id} onDone={(summary) => setJustRan({ caseId: s.caseRecord.id, summary })} />}>
              <Link to={`/cases/${s.caseRecord.id}`} className="font-medium text-brand hover:underline">{s.displayId}</Link> has {s.documentCount} ingested document(s) with extracted text. Run the rules-based analysis to compare their statements.
            </Callout>
          ))}
        </div>
      ) : null}
      {justRan ? (
        <SectionCard className="mb-6" title={`Analysis complete — ${splitLabel(caseMap.get(justRan.caseId)?.label ?? '').displayId}`} icon={<CheckCircle2 size={16} aria-hidden />}
          actions={<Link to={`/contradictions?case=${justRan.caseId}`} className="btn-primary btn-sm" data-testid="open-queue">View findings<ArrowRight size={14} aria-hidden /></Link>}>
          <AnalysisSummaryList summary={justRan.summary} />
        </SectionCard>
      ) : null}

      <section aria-label="Workspace metrics" className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4" data-testid="overview-metrics">
        <MetricCard label="Cases Reviewed" value={<>{metrics.casesReviewed}<span className="text-[18px] font-medium text-faint"> / {metrics.caseCount}</span></>} icon={<FolderOpen size={17} />} to="/cases?state=reviewed" progress={metrics.caseCount ? metrics.casesReviewed / metrics.caseCount : 0} hint="Analysed, with no findings left pending" testId="metric-cases-reviewed" />
        <MetricCard label="Open Contradictions" value={metrics.openContradictions} icon={<GitCompareArrows size={17} />} tone={metrics.openContradictions ? 'crit' : undefined} to="/contradictions?open=1" hint={`${metrics.bySeverity.get('high') ?? 0} high priority · not resolved or dismissed`} testId="metric-open" />
        <MetricCard label="Pending Reviews" value={metrics.pendingReviews} icon={<ListChecks size={17} />} tone={metrics.pendingReviews ? 'warn' : undefined} to="/queue" hint="Unreviewed, in review or awaiting information" testId="metric-pending" />
        <MetricCard label="Documents Processed" value={<>{metrics.documentsProcessed}<span className="text-[18px] font-medium text-faint"> / {metrics.documentCount}</span></>} icon={<FileStack size={17} />} to="/documents" progress={metrics.documentCount ? metrics.documentsProcessed / metrics.documentCount : 0} hint={metrics.documentsNeedingAttention ? `${metrics.documentsNeedingAttention} need attention` : 'Text extracted and available for analysis'} testId="metric-docs" />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <SectionCard title="Contradiction categories" description={`${totalFindings} active finding(s) across ${metrics.analyzedCases} analysed case(s) · select a bar to filter`} actions={<Link to="/contradictions" className="text-[13px] font-medium text-brand hover:underline">Explore</Link>}>
            {catData.length ? <BarList data={catData} caption="Findings by category" testId="category-chart" /> : <p className="text-[13.5px] text-muted">No findings yet. Analyse a case to populate this chart.</p>}
          </SectionCard>

          <SectionCard title="Open contradictions" description="Highest review priority first" bodyClassName="p-0" actions={<Link to="/contradictions?open=1" className="text-[13px] font-medium text-brand hover:underline">View all {open.length}</Link>}>
            <FindingsTable rows={open.slice(0, 8)} cases={caseMap} compact testId="overview-open-table" emptyNote="No open contradictions. Every finding has been resolved, dismissed or classified as an expected change." />
          </SectionCard>
        </div>

        <aside className="space-y-6">
          <SectionCard title="Review queue" description="Status of every active finding" actions={<Link to="/queue" className="text-[13px] font-medium text-brand hover:underline">Open queue</Link>}>
            {statusData.length ? <Donut data={statusData} caption="Findings by review status" centerLabel="findings" testId="status-chart" /> : <p className="text-[13.5px] text-muted">No findings yet.</p>}
          </SectionCard>

          <SectionCard title="Recent activity" bodyClassName="px-5 py-3" actions={<Link to="/activity" className="text-[13px] font-medium text-brand hover:underline">All activity</Link>}>
            {activity.length ? (
              <ul className="divide-y divide-line">
                {activity.map((e) => {
                  const d = describeEvent(e, findings!, documents!);
                  const c = caseMap.get(e.caseId);
                  return (
                    <li key={e.id} className="py-2.5">
                      <div className="truncate text-[13px] font-medium" title={d.title}>{e.findingId ? <Link to={`/findings/${e.findingId}`} className="hover:text-brand">{d.title}</Link> : d.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-faint">
                        {c ? <Link to={`/cases/${c.id}`} className="font-mono hover:text-brand">{splitLabel(c.label).displayId}</Link> : null}<span>·</span><span>{formatDateTime(e.at)}</span><span>·</span><span>{isSeededEvent(e, c) ? 'seeded example' : 'local action'}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState compact title="No activity yet" body="Actions you take appear here." />}
          </SectionCard>

          <SectionCard title="Environment" description="What this build actually uses">
            <ul className="space-y-2.5 text-[13px]">
              <EnvRow icon={HardDrive} label="Data storage" value="This browser (IndexedDB)" ok />
              <EnvRow icon={Cpu} label="Detection" value="Local deterministic rules" ok />
              <EnvRow icon={ScanText} label="OCR" value="On-device (Tesseract.js)" ok />
              <EnvRow icon={Cloud} label="Shared-workspace server" value={!ws.serverUrl ? 'Not configured' : ws.health ? 'Reachable · sign in to use it' : ws.healthError ? 'Unreachable' : 'Checking…'} ok={!!ws.health} />
              <EnvRow icon={Cpu} label="External AI (server)" value={!ws.health ? 'Unknown' : ws.health.ai.configured ? `Configured (${ws.health.ai.provider})` : 'Not configured'} ok={!!ws.health?.ai.configured} />
            </ul>
            <Link to="/settings" className="mt-3 inline-flex text-[13px] font-medium text-brand hover:underline">Capabilities &amp; data settings</Link>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}

function EnvRow({ icon: Icon, label, value, ok }: { icon: typeof Cpu; label: string; value: string; ok?: boolean }) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon size={15} className="shrink-0 text-faint" aria-hidden />
      <span className="flex-1 text-muted">{label}</span>
      <span className={cx('text-right font-medium', ok ? 'text-ink' : 'text-faint')}>{value}</span>
    </li>
  );
}
