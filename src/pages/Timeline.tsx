import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, FileUp, MessageSquare, Scale, Sparkles, UserCheck } from 'lucide-react';
import { useApp, useCaseData } from '../app/state';
import { EmptyState, PageHeader, PageSkeleton, cx } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/dates';
import type { AuditEvent, DocumentRecord, Finding } from '../lib/types';
import { DOCUMENT_TYPE_LABEL, REVIEW_STATUS_LABEL } from '../lib/types';

type Group = 'upload' | 'analysis' | 'finding' | 'review';

const GROUP_OF: Record<AuditEvent['kind'], Group> = {
  case_created: 'upload', document_uploaded: 'upload', document_extracted: 'upload', document_failed: 'upload', document_deleted: 'upload',
  analysis_started: 'analysis', analysis_completed: 'analysis', analysis_failed: 'analysis',
  finding_created: 'finding', finding_superseded: 'finding',
  status_changed: 'review', note_added: 'review',
  ai_analysis_completed: 'analysis', ai_analysis_failed: 'analysis',
  case_shared: 'review', member_added: 'review', member_removed: 'review', case_synced: 'upload',
};

const GROUP_META: Record<Group, { label: string; stamp: string; icon: typeof FileUp; cls: string }> = {
  upload: { label: 'Uploads & extraction', stamp: 'Upload / processing time', icon: FileUp, cls: 'bg-slate-100 text-slate-700' },
  analysis: { label: 'Analysis runs', stamp: 'Analysis time', icon: Sparkles, cls: 'bg-brand-50 text-brand-700' },
  finding: { label: 'Findings', stamp: 'Detection time', icon: Scale, cls: 'bg-warn-50 text-warn' },
  review: { label: 'Reviewer decisions & notes', stamp: 'Review time', icon: UserCheck, cls: 'bg-ok-50 text-ok' },
};

export function describeEvent(e: AuditEvent, findings: Finding[], docs: DocumentRecord[]): { title: string; body?: string } {
  const f = e.findingId ? findings.find((x) => x.id === e.findingId) : undefined;
  const d = e.documentId ? docs.find((x) => x.id === e.documentId) : undefined;
  const fRef = f ? `${f.displayId}` : 'finding';
  switch (e.kind) {
    case 'case_created': return { title: 'Case created', body: e.detail };
    case 'document_uploaded': return { title: `Document uploaded: ${d?.title ?? 'deleted document'}`, body: e.detail };
    case 'document_extracted': return { title: `Text extracted: ${d?.title ?? 'deleted document'}`, body: e.detail };
    case 'document_failed': return { title: `Extraction problem: ${d?.title ?? 'deleted document'}`, body: e.detail };
    case 'document_deleted': return { title: 'Document removed', body: e.detail };
    case 'analysis_started': return { title: 'Analysis started', body: e.detail };
    case 'analysis_failed': return { title: 'Analysis failed', body: e.detail };
    case 'analysis_completed': {
      try {
        const s = JSON.parse(e.detail ?? '{}');
        return { title: 'Analysis completed', body: `${s.comparisonsEvaluated} comparisons · ${s.findingsTotalActive} findings (${s.findingsCreated} new, ${s.findingsSuperseded} superseded)` };
      } catch { return { title: 'Analysis completed' }; }
    }
    case 'finding_created': return { title: `Finding created: ${fRef}`, body: f?.title ?? e.detail };
    case 'finding_superseded': return { title: `Finding superseded: ${fRef}`, body: e.detail };
    case 'status_changed': return { title: `${fRef}: ${REVIEW_STATUS_LABEL[e.fromStatus!]} → ${REVIEW_STATUS_LABEL[e.toStatus!]}`, body: e.reason ? `Reason: ${e.reason}` : undefined };
    case 'note_added': return { title: `Reviewer note on ${fRef}`, body: e.note };
    case 'ai_analysis_completed': return { title: 'AI-assisted analysis completed', body: e.detail };
    case 'ai_analysis_failed': return { title: 'AI-assisted analysis did not complete', body: e.detail };
    case 'case_shared': return { title: 'Case published to the shared workspace', body: e.detail };
    case 'member_added': return { title: 'Collaborator added', body: e.detail };
    case 'member_removed': return { title: 'Collaborator removed', body: e.detail };
    case 'case_synced': return { title: 'Case data synchronized to the shared workspace', body: e.detail };
  }
}

export function Timeline() {
  const { caseId, currentCase } = useApp();
  const { documents, findings, events, loading } = useCaseData(caseId);
  const [groups, setGroups] = useState<Set<Group>>(new Set(['upload', 'analysis', 'finding', 'review']));
  if (!currentCase || loading) return <PageSkeleton />;
  const datedDocs = [...documents!].sort((a, b) => (a.documentDate ?? '9999').localeCompare(b.documentDate ?? '9999'));
  const shown = [...events!].reverse().filter((e) => groups.has(GROUP_OF[e.kind]));
  const toggle = (g: Group) => setGroups((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow="Case timeline" title="Timeline & audit history" description="Clinical document dates and system activity are shown separately. An upload time is never treated as the date a clinical statement became true." />

      <section className="card mb-6 p-5" aria-label="Clinical record dates">
        <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarDays size={17} className="text-brand" aria-hidden />Clinical record dates</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted">The dates written on, or entered for, each document. These order the records clinically.</p>
        {datedDocs.length === 0 ? <p className="text-sm text-muted">No documents yet.</p> : (
          <ol className="relative flex flex-col gap-4 md:flex-row md:gap-0">
            {datedDocs.map((d, i) => (
              <li key={d.id} className="relative flex-1 md:pr-4">
                <div className="hidden md:block">
                  <div className={cx('absolute left-0 right-0 top-[7px] h-0.5 bg-line', i === 0 && 'left-2', i === datedDocs.length - 1 && 'right-[calc(100%-1rem)]')} />
                </div>
                <span className="relative z-10 block h-4 w-4 rounded-full border-[3px] border-white bg-brand shadow" aria-hidden />
                <div className="mt-2">
                  <div className="text-sm font-semibold">{d.documentDate ? formatDate(d.documentDate) : <span className="text-warn">Date not recorded</span>}</div>
                  <Link to={`/documents/${d.id}`} className="text-sm text-brand hover:underline">{d.title}</Link>
                  <div className="text-xs text-muted">{DOCUMENT_TYPE_LABEL[d.documentType]}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card p-5" aria-label="Activity and audit log">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold">Activity & audit log</h2>
            <p className="text-xs text-muted">Append-only. Entries are added and never edited. {events!.length} events in total.</p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter event types">
            {(Object.keys(GROUP_META) as Group[]).map((g) => (
              <button key={g} onClick={() => toggle(g)} aria-pressed={groups.has(g)} className={cx('chip border px-2.5 py-1', groups.has(g) ? 'border-brand/30 bg-brand-50 text-brand-700' : 'border-line bg-white text-muted')}>{GROUP_META[g].label}</button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? <EmptyState title="No events" body="No events match the selected filters." /> : (
          <ol className="relative border-l border-line pl-6" data-testid="timeline-events">
            {shown.map((e) => {
              const g = GROUP_OF[e.kind];
              const meta = GROUP_META[g];
              const desc = describeEvent(e, findings!, documents!);
              const Icon = e.kind === 'note_added' ? MessageSquare : meta.icon;
              return (
                <li key={e.id} className="mb-5 last:mb-0">
                  <span className={cx('absolute -left-[13px] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white', meta.cls)}><Icon size={13} aria-hidden /></span>
                  <div className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between md:gap-4">
                    <div className="text-sm font-medium">
                      {e.findingId ? <Link to={`/findings/${e.findingId}`} className="hover:text-brand">{desc.title}</Link> : desc.title}
                    </div>
                    <div className="shrink-0 text-xs text-muted"><span className="font-medium">{meta.stamp}:</span> {formatDateTime(e.at)}</div>
                  </div>
                  {desc.body ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted">{desc.body}</p> : null}
                  <div className="mt-0.5 text-xs text-slate-400">by {e.actor}</div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
