import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AppProvider } from './app/state';
import { WorkspaceProvider } from './app/workspace';
import { AppShell } from './components/shell/AppShell';
import { EmptyState } from './components/ui';
import { Overview } from './pages/Overview';
import { Contradictions } from './pages/Contradictions';
import { ReviewQueue } from './pages/ReviewQueue';
import { CaseDetail, CurrentCase } from './pages/CaseDetail';
import { Activity } from './pages/Activity';
import { Help } from './pages/Help';
import { FindingDetail } from './pages/FindingDetail';
import { Documents } from './pages/Documents';
import { DocumentViewer } from './pages/DocumentViewer';
import { Cases } from './pages/Cases';
import { About } from './pages/About';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg p-8">
          <EmptyState title="Something went wrong" body="This screen hit an unexpected error. Your saved data is not affected." action={<button className="btn-primary" onClick={() => { window.location.hash = '#/'; window.location.reload(); }}>Return to overview</button>} />
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  return <EmptyState title="Page not found" body="This address does not match any screen." action={<Link className="btn-primary" to="/">Go to overview</Link>} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProvider>
          <WorkspaceProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/queue" element={<ReviewQueue />} />
              <Route path="/contradictions" element={<Contradictions />} />
              <Route path="/cases/:id" element={<CaseDetail />} />
              <Route path="/case" element={<CurrentCase />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/help" element={<Help />} />
              <Route path="/settings" element={<About />} />
              <Route path="/findings/:id" element={<FindingDetail />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/documents/:id" element={<DocumentViewer />} />
              <Route path="/timeline" element={<Navigate to="/activity" replace />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
          </WorkspaceProvider>
        </AppProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);

// Offline support in production builds: after load, ask the service worker to cache everything already fetched.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const known = ['./', './pdf.worker.min.js', './ocr/worker.min.js', './ocr/tesseract-core-simd-lstm.wasm.js', './ocr/tesseract-core-lstm.wasm.js', './ocr/lang/eng.traineddata.gz'];
    const precache = async () => {
      const reg = await navigator.serviceWorker.ready;
      const urls = [location.href.split('#')[0], ...known.map((u) => new URL(u, document.baseURI).href), ...performance.getEntriesByType('resource').map((r) => r.name)];
      reg.active?.postMessage({ type: 'precache', urls });
    };
    navigator.serviceWorker.register('./sw.js').then(precache).catch(() => { /* offline support is optional */ });
    // Lazily loaded chunks (pdf.js, mammoth, OCR, demo files) appear after the first seeding run.
    setTimeout(() => { void precache().catch(() => {}); }, 15000);
  });
}
