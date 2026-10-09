import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { useApp } from '../app/state';
import { Modal } from './ui';

/** "Load Demonstration Case" and "Reset Demonstration" — affect ONLY the synthetic demo case. */
export function DemoControls({ compact }: { compact?: boolean }) {
  const { cases, setCaseId, resetDemo, seeding, toast } = useApp();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const demo = cases?.find((c) => c.isDemo);
  const load = async () => {
    if (demo) { setCaseId(demo.id); navigate('/'); toast('info', 'Demonstration case opened.'); return; }
    const c = await resetDemo();
    if (c) { navigate('/'); toast('success', 'Demonstration case loaded (5 synthetic documents).'); } else toast('error', 'The demonstration case could not be loaded.');
  };
  return (
    <div className={compact ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'}>
      <button className="btn-primary" onClick={load} disabled={seeding} data-testid="load-demo"><FlaskConical size={15} />{seeding ? 'Loading…' : 'Load Demonstration Case'}</button>
      <button className="btn-secondary" onClick={() => setConfirm(true)} disabled={seeding} data-testid="reset-demo"><RotateCcw size={15} />Reset Demonstration</button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset the demonstration?" footer={<>
        <button className="btn-secondary" onClick={() => setConfirm(false)}>Cancel</button>
        <button className="btn-danger" data-testid="confirm-reset" onClick={async () => {
          setConfirm(false);
          const c = await resetDemo();
          if (c) { toast('success', 'Demonstration reset: the 5 synthetic documents were re-imported. Run the analysis to regenerate findings.'); navigate('/'); } else toast('error', 'Reset failed; existing data was not changed by this action.');
        }}>Reset demonstration</button>
      </>}>
        <div className="space-y-2 text-sm">
          <p>This removes <strong>only the synthetic demonstration case</strong> from this browser — its documents, findings, review decisions, notes and history — and re-imports the original synthetic documents.</p>
          <p className="text-muted">Your own cases, shared-workspace settings and all other browser data are not touched. Export a backup first if you want to keep the demo review history.</p>
        </div>
      </Modal>
    </div>
  );
}
