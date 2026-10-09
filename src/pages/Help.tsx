import { Link } from 'react-router-dom';
import { PageHeader, SectionCard, Callout } from '../components/ui';

const STEPS = [
  ['Collect clinical documents', 'Import PDF (digital or scanned), PNG/JPEG scans, TXT or DOCX into a case.'],
  ['Extract available text', 'pdf.js, mammoth and on-device OCR (Tesseract.js) extract text in the browser.'],
  ['Identify potentially inconsistent statements', 'Deterministic rules compare allergies, medications, diagnoses, labs and date of birth across documents of the same case.'],
  ['Link findings to source evidence', 'Every finding stores verbatim quotes with document, section, page (when verified) and character offsets.'],
  ['Present findings to a human reviewer', 'The Review Queue lists pending findings with side-by-side evidence.'],
  ['Record the review outcome', 'Confirmed, not a contradiction, needs more information, expected change, or unable to determine — with notes and history.'],
  ['Export a demonstration report', 'JSON case report, findings CSV and full backup from each case page.'],
];

export function Help() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="Help & About" description="MedGuard — Healthcare Contradiction Detection (PS-11R3). Find contradictions. Preserve clinical context. Support better decisions. Frontend demonstration build with synthetic data." />
      <div className="mb-6"><Callout tone="warn" title="Clinical review is required">MedGuard flags possible documentation inconsistencies. It does not diagnose, does not decide which record is correct, is not clinically validated, has no regulatory approval and is not HIPAA-certified. Use synthetic data only.</Callout></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Workflow">
          <ol className="space-y-3">{STEPS.map(([t, b], i) => (
            <li key={t} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand">{i + 1}</span><div><div className="text-[13.5px] font-semibold">{t}</div><p className="text-[13px] text-muted">{b}</p></div></li>
          ))}</ol>
        </SectionCard>
        <div className="space-y-6">
          <SectionCard title="Terms">
            <dl className="space-y-3 text-[13.5px]">
              <div><dt className="font-semibold">Potential contradiction</dt><dd className="text-muted">Two records make statements that the rules consider incompatible. Not yet verified by a person.</dd></div>
              <div><dt className="font-semibold">Confirmed contradiction</dt><dd className="text-muted">A reviewer confirmed that the documents genuinely disagree. It still does not say which is clinically correct.</dd></div>
              <div><dt className="font-semibold">Temporal change</dt><dd className="text-muted">A difference explained by time or a documented change (e.g. a dose increase).</dd></div>
              <div><dt className="font-semibold">Missing or uncertain information</dt><dd className="text-muted">A value could not be read, or a statement is unverified; the system does not guess.</dd></div>
            </dl>
          </SectionCard>
          <SectionCard title="Demo guide for judges">
            <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] text-muted">
              <li>Open <Link className="text-brand hover:underline" to="/">Overview</Link> and run <strong>Analyze documents</strong> for DEMO-0042.</li>
              <li>Open <Link className="text-brand hover:underline" to="/contradictions">Contradictions</Link> and inspect the penicillin allergy evidence.</li>
              <li>In the <Link className="text-brand hover:underline" to="/queue">Review Queue</Link>, record a decision with a note.</li>
              <li>See counts update on the Overview and the entry in <Link className="text-brand hover:underline" to="/activity">Activity</Link>.</li>
            </ol>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
