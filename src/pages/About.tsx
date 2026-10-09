import { useState } from 'react';
import { AlertTriangle, Cpu, Database, FileCheck2, Lock, ScanSearch, UserRound } from 'lucide-react';
import { useApp } from '../app/state';
import { Callout, PageHeader } from '../components/ui';
import { DETECTION_METHOD } from '../lib/detect';
import { DEMO_REVIEWER } from '../lib/services';
import { APP_VERSION, BUILD_LABEL } from '../lib/version';

export function About() {
  const { reviewer, setReviewer, toast } = useApp();
  const [name, setName] = useState(reviewer);
  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow="About & settings" title="CLINISCOPE" description="Evidence-first healthcare record contradiction detection and clinical review support — PS-11R3 hackathon prototype." />
      <div className="mb-6"><Callout tone="warn" title="Review-support tool — not a diagnostic system">CLINISCOPE identifies possible inconsistencies between records and shows the evidence for each. It does not diagnose, does not decide which statement is medically correct, and does not replace professional judgment. It holds no regulatory certification or compliance attestation (e.g. HIPAA) and must not be used with real patient data.</Callout></div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section icon={<ScanSearch size={17} />} title="What it does">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Ingests PDF, TXT and DOCX records into a case.</li>
            <li>Extracts the text in the browser (pdf.js text layer, UTF-8 decoding, mammoth for DOCX).</li>
            <li>Identifies clinical statements (allergies, medications, diagnoses, lab results, procedures, smoking status) with deterministic rules.</li>
            <li>Compares statements across documents in the same case, considering negation, hedging, history, documented changes and dates.</li>
            <li>Creates findings only when every quotation can be located again in the source text.</li>
            <li>Supports a recorded review decision with a required reason, and keeps an append-only audit trail.</li>
          </ol>
        </Section>
        <Section icon={<Cpu size={17} />} title="Methods actually used">
          <ul className="space-y-1.5">
            <li><strong>Statement extraction:</strong> deterministic vocabulary and pattern rules. No machine-learning or LLM model is used.</li>
            <li><strong>Detection:</strong> {DETECTION_METHOD}.</li>
            <li><strong>Explanations:</strong> rule-specific templates filled from the extracted data. They are interpretation and are labelled separately from quoted evidence.</li>
            <li><strong>OCR:</strong> not available. Scanned PDFs are flagged as “Needs attention” and no statements are invented for them.</li>
            <li><strong>Evidence quality</strong> describes source availability and extraction reliability, not clinical correctness. <strong>Review priority</strong> is a workflow suggestion, not a risk score.</li>
          </ul>
        </Section>
        <Section icon={<FileCheck2 size={17} />} title="Supported files">
          <ul className="space-y-1">
            <li>PDF with a selectable text layer: page numbers are verified per page.</li>
            <li>TXT (UTF-8): character offsets and line numbers.</li>
            <li>DOCX: paragraph text (paragraph index shown).</li>
            <li>Maximum size: {Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 10} MB per file. Duplicate files (same SHA-256) are rejected within a case.</li>
          </ul>
        </Section>
        <Section icon={<Database size={17} />} title="Data handling & persistence">
          <ul className="space-y-1.5">
            <li>All processing happens <strong>in your browser</strong>. Documents are never sent to a server.</li>
            <li>Cases, original files, extracted text, statements, findings and audit events are stored in this browser's <strong>IndexedDB</strong>. They persist across reloads on this device.</li>
            <li>Data is <strong>not shared</strong> between devices or users, and clearing site data deletes it. There is no server-side backup.</li>
            <li>The public demo uses fictional, synthetic records only.</li>
          </ul>
        </Section>
        <Section icon={<AlertTriangle size={17} />} title="Known limitations">
          <ul className="list-disc space-y-1 pl-5">
            <li>The rules cover a limited vocabulary of common drugs, allergens, diagnoses and lab tests; anything outside it is not extracted.</li>
            <li>Tabular or multi-column layouts may produce imperfect line ordering. Text on scanned pages is not read.</li>
            <li>Negation and hedging detection are pattern-based and can miss unusual phrasing.</li>
            <li>Type 1 and type 2 diabetes are grouped under one concept. Medication formulations are not distinguished.</li>
            <li>There is no authentication. The reviewer name is a self-declared demo identity.</li>
          </ul>
        </Section>
        <Section icon={<UserRound size={17} />} title="Reviewer identity (demo)">
          <p className="mb-2">Recorded on every decision and note. This is <strong>not</strong> an authenticated identity.</p>
          <label htmlFor="reviewer" className="label">Display name</label>
          <div className="flex gap-2">
            <input id="reviewer" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <button className="btn-secondary" onClick={() => { const v = name.trim() || DEMO_REVIEWER; setReviewer(v); setName(v); toast('success', 'Reviewer name saved.'); }}>Save</button>
          </div>
        </Section>
      </div>
      <div className="mt-6 flex items-center gap-2 text-xs text-muted"><Lock size={12} aria-hidden />Version {APP_VERSION} · {BUILD_LABEL} · uploaded content is rendered as text only, never as HTML.</div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 text-sm leading-relaxed text-ink/85">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink"><span className="text-brand">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}
