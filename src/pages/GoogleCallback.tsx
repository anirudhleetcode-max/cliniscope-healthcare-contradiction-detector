import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/state';
import { useWorkspace } from '../app/workspace';
import { Callout } from '../components/ui';

const ERRORS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  provider_error: 'Google could not complete the sign-in. Try again.',
  verification_failed: 'MedGuard could not verify the Google sign-in. Try again.',
  email_unverified: 'Your Google account email is not verified, so it cannot be used to sign in.',
  account_exists: 'A MedGuard account with this email already exists. Sign in with your password, then use "Link Google account" in Settings → Shared workspace.',
  google_in_use: 'This Google account is already linked to another MedGuard account.',
  already_linked: 'Your MedGuard account is already linked to a different Google account.',
};

/** Landing page of the Google redirect: exchanges the one-time hand-off code for a session. */
export function GoogleCallback() {
  const [params] = useSearchParams();
  const ws = useWorkspace();
  const { toast } = useApp();
  const navigate = useNavigate();
  const handoff = params.get('handoff');
  const [exchangeError, setError] = useState<string | null>(null);
  const error = handoff ? exchangeError : ERRORS[params.get('error') ?? ''] ?? 'Google sign-in did not complete.';
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!handoff || started.current === handoff) return;
    started.current = handoff; // each code is single use; never submit it twice
    setError(null);
    ws.completeGoogle(handoff)
      .then(() => { toast('success', 'Signed in with Google.'); navigate('/', { replace: true }); })
      .catch((e: Error) => setError(`Google sign-in could not be completed: ${e.message}`));
  }, [handoff, ws, toast, navigate]);

  if (error) {
    return <Callout tone="warn" title="Google sign-in" action={<Link to="/settings#workspace" className="btn-secondary">Back to sign-in</Link>}><span role="alert" data-testid="google-error">{error}</span></Callout>;
  }
  return <Callout title="Signing you in with Google…"><span role="status" data-testid="google-pending">Verifying the sign-in with the MedGuard server.</span></Callout>;
}
