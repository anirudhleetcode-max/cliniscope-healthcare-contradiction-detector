import { useState } from 'react';
import { AlertTriangle, Cpu, Database, FileCheck2, Lock, ScanSearch, UserRound } from 'lucide-react';
import { useApp } from '../app/state';
import { Callout, PageHeader } from '../components/ui';
import { WorkspacePanel } from '../components/WorkspacePanel';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DETECTION_METHOD } from '../lib/detect';
import { DEMO_REVIEWER } from '../lib/services';
import { APP_VERSION, BUILD_LABEL } from '../lib/version';

export function About() {
  const { reviewer, setReviewer, toast } = useApp();
  const [name, setName] = useState(reviewer);
  const location = useLocation();
  useEffect(() => { if (location.hash === '#workspace') document.getElementById('workspace')?.scrollIntoView({ block: 'start' }); }, [location.hash]);
  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow="About & settings" title="CLINISCOPE" description="Evidence-first healthcare record contradiction detection and clinical review support — PS-11R3 hackathon prototype." />
      <div className="mb-6"><Callout tone="warn" title="Review-support tool — not a diagnostic system">CLINISCOPE identifies possible inconsistencies between records and shows the evidence for each. It does not diagnose, does not decide which statement is medically correct, and does not replace professional judgment. It holds no regulatory certification or compliance attestation (e.g. HIPAA) and must not be used with real patient data.</Callout></div>

      <div className="mb-6"><WorkspacePanel /></div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section icon={<ScanSearch size={17} />} title="What it does">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Ingests PDF (digital or scanned), PNG/JPEG scans, TXT and DOCX records into a case.</li>
            <li>Extracts the text in the browser (pdf.js text layer, Tesseract.js OCR for scanned pages, UTF-8 decoding, mammoth for DOCX).</li>
            <li>Identifies clinical statements (allergies, medications, diagnoses, lab results, procedures, smoking status) with deterministic rules.</li>
            <li>Compares statements across documents in the same case, considering negation, hedging, history, documented changes and dates.</li>
            <li>Creates findings only when every quotation can be located again in the source text.</li>
            <li>Optionally asks an AI model (server-side) for additional findings and keeps only those whose quotations verify.</li>
            <li>Supports a recorded review decision with a required reason, and keeps an append-only audit trail — locally, or on a shared workspace with authenticated collaborators.</li>
          </ol>
        </Section>
        <Section icon={<Cpu size={17} />} title="Methods actually used">
          <ul className="space-y-1.5">
            <li><strong>Statement extraction:</strong> deterministic vocabulary and pattern rules. No machine-learning or LLM model is used.</li>
            <li><strong>Detection:</strong> {DETECTION_METHOD}.</li>
            <li><strong>AI-assisted reasoning (optional):</strong> only when a CLINISCOPE server with a provider API key is configured and you are signed in. The model's structured output is schema-validated, every quotation is re-located verbatim in the source text (unsupported ones are discarded), one-sided conflicts are downgraded to insufficient evidence, model-invented dates are dropped, and page numbers come only from verified PDF page spans. AI findings are labelled “AI-assisted” and start unreviewed.</li>
            <li><strong>Explanations:</strong> rule-specific templates filled from the extracted data. They are interpretation and are labelled separately from quoted evidence.</li>
            <li><strong>OCR:</strong> Tesseract.js (LSTM, English) running on this device. PDF pages without a usable text layer, and PNG/JPEG scans, are rendered and read one page at a time. Engine-reported word confidences are kept; words below 70% are marked “OCR text requires review”, and findings that depend on them are downgraded to insufficient evidence. OCR-derived evidence is never rated above “moderate” availability. Values the OCR could not read are reported as unreadable, never guessed.</li>
            <li><strong>Evidence quality</strong> describes source availability and extraction reliability, not clinical correctness. <strong>Review priority</strong> is a workflow suggestion, not a risk score.</li>
          </ul>
        </Section>
        <Section icon={<FileCheck2 size={17} />} title="Supported files">
          <ul className="space-y-1">
            <li>PDF with a selectable text layer: page numbers are verified per page.</li>
            <li>Scanned PDF (or mixed digital + scanned pages): image-only pages are OCR'd; page numbers are kept.</li>
            <li>PNG / JPEG scan: OCR'd as a single image (no page number is shown).</li>
            <li>TXT (UTF-8): character offsets and line numbers.</li>
            <li>DOCX: paragraph text (paragraph index shown).</li>
            <li>Maximum size: {Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 10} MB per file. Duplicate files (same SHA-256) are rejected within a case.</li>
          </ul>
        </Section>
        <Section icon={<Database size={17} />} title="Data handling & persistence">
          <ul className="space-y-1.5">
            <li>All processing happens <strong>in your browser</strong>. Documents are never sent to a server.</li>
            <li>Cases, original files, extracted text, statements, findings and audit events are stored in this browser's <strong>IndexedDB</strong>. They persist across reloads on this device.</li>
            <li>In <strong>local demo mode</strong>, data is not shared between devices or users, and clearing site data deletes it.</li>
            <li>In <strong>shared workspace mode</strong> (optional CLINISCOPE server), shared cases — extracted text, statements, findings, review decisions, notes, audit events and original files — are stored on that server (SQLite + private file storage) and are visible only to authenticated members of the case. Permissions are enforced by the server; the audit table is append-only at the database level.</li>
            <li>The public demo uses fictional, synthetic records only.</li>
          </ul>
        </Section>
        <Section icon={<AlertTriangle size={17} />} title="Known limitations">
          <ul className="list-disc space-y-1 pl-5">
            <li>The rules cover a limited vocabulary of common drugs, allergens, diagnoses and lab tests; anything outside it is not extracted.</li>
            <li>Tabular or multi-column layouts may produce imperfect line ordering. OCR quality depends on scan quality; handwriting is not supported; OCR runs in the browser and takes a few seconds per page.</li>
            <li>Negation and hedging detection are pattern-based and can miss unusual phrasing.</li>
            <li>Type 1 and type 2 diabetes are grouped under one concept. Medication formulations are not distinguished.</li>
            <li>Local demo mode has no authentication; the reviewer name there is self-declared. Shared workspace mode uses real accounts (scrypt-hashed passwords, expiring sessions) but no SSO, MFA or password reset.</li>
            <li>Shared cases update by polling every 15 s, not by real-time push.</li>
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
