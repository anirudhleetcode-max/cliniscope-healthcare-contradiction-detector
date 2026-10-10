import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Cloud, LogIn, LogOut, RefreshCw, ServerCrash, UserPlus } from 'lucide-react';
import { useApp } from '../app/state';
import { useWorkspace } from '../app/workspace';
import { Callout, cx } from './ui';

/** Shared-workspace connection: server URL, health, and genuine sign-in against the MEDGUARD API. */
export function WorkspacePanel() {
  const ws = useWorkspace();
  const { toast } = useApp();
  const [url, setUrl] = useState(ws.serverUrl);
  const location = useLocation();
  const requestedMode = (location.state as { mode?: string } | null)?.mode;
  const [mode, setMode] = useState<'login' | 'register'>(requestedMode === 'register' ? 'register' : 'login');
  // "Sign in" / "Create account" links (profile menu, Overview) may arrive while this panel is already shown.
  useEffect(() => { if (requestedMode === 'login' || requestedMode === 'register') setMode(requestedMode); }, [requestedMode, location.key]);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const google = async (link: boolean) => {
    setGoogleBusy(true);
    try { await ws.startGoogle(link); } // navigates away on success
    catch (e) { toast('error', `Google sign-in could not start: ${(e as Error).message}`); setGoogleBusy(false); }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The fields are uncontrolled and read from the form itself: browser-autofilled credentials (which may not
  // fire React change events) are used, and a re-render can never reset what the browser filled in.
  // The button is never silently disabled: missing fields produce a visible message.
  const submit = async (form: HTMLFormElement) => {
    if (busy) return;
    const fd = new FormData(form);
    const e = String(fd.get('email') ?? '').trim();
    const p = String(fd.get('password') ?? '');
    const n = String(fd.get('displayName') ?? '').trim();
    if (!e || !p || (mode === 'register' && !n)) {
      setError(mode === 'register' ? 'Enter your display name, email and password.' : 'Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await ws.signIn(e, p);
      else await ws.register(e, p, n);
      toast('success', 'Signed in to the shared workspace.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="workspace" className="card scroll-mt-20 p-5 text-sm" aria-labelledby="ws-h" data-testid="workspace-panel">
      <h2 id="ws-h" className="mb-1 flex items-center gap-2 text-base font-semibold"><Cloud size={17} className="text-brand" aria-hidden />Shared workspace</h2>
      <p className="mb-4 text-xs text-muted">Optional. Connect to a MedGuard API server to share cases with other authenticated reviewers and to use AI-assisted analysis. Without it, the app runs in <strong>local demo mode</strong> and data stays in this browser.</p>
      <label htmlFor="ws-url" className="label">Server URL</label>
      <div className="flex gap-2">
        <input id="ws-url" className="input" placeholder="https://medguard-api.example.org" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="server-url" />
        <button className="btn-secondary" onClick={() => { ws.setServerUrl(url); }} data-testid="save-server-url">Connect</button>
      </div>
      <div className="mt-3" data-testid="server-health">
        {!ws.serverUrl ? <p className="text-xs text-muted">No server configured.</p>
          : ws.health ? (
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span className="chip bg-ok-50 text-ok">Reachable · API v{ws.health.version}</span>
              <span className={cx('chip', ws.health.ai.configured ? 'bg-ok-50 text-ok' : 'bg-slate-100 text-slate-600')} data-testid="ai-status">AI: {ws.health.ai.configured ? `configured (${ws.health.ai.provider}, ${ws.health.ai.model})` : 'not configured on server'}</span>
              <button className="inline-flex items-center gap-1 text-brand hover:underline" onClick={() => void ws.refreshHealth()}><RefreshCw size={12} />recheck</button>
            </p>
          ) : ws.healthError
            ? <p className="flex items-center gap-2 text-xs text-crit"><ServerCrash size={14} />{ws.healthError}<button className="inline-flex items-center gap-1 text-brand hover:underline" onClick={() => void ws.refreshHealth()} data-testid="health-retry"><RefreshCw size={12} />retry</button></p>
            : <p className="text-xs text-muted">Connecting… A server on a free hosting plan can take up to a minute to wake up.</p>}
      </div>
      {ws.session ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-soft px-3 py-2">
          <span>Signed in as <strong data-testid="signed-in-as">{ws.session.user.displayName}</strong> &lt;{ws.session.user.email}&gt; · session expires {new Date(ws.session.expiresAt).toLocaleTimeString()}</span>
          <button className="btn-secondary py-1.5" onClick={() => void ws.signOut()} data-testid="sign-out"><LogOut size={14} />Sign out</button>
        </div>
      ) : null}
      {ws.session ? (
        <form className="mt-3 flex flex-wrap items-end gap-2" data-testid="profile-form" onSubmit={async (e) => {
          e.preventDefault();
          const name = (nameDraft ?? '').trim();
          if (!name || name.length > 80) { toast('error', 'Enter a display name of 1 to 80 characters.'); return; }
          setSavingName(true);
          try { await ws.updateProfile(name); setNameDraft(null); toast('success', 'Profile saved on the server.'); }
          catch (err) { toast('error', `Profile not saved: ${(err as Error).message}`); }
          finally { setSavingName(false); }
        }}>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium">Display name
            <input className="input" maxLength={80} value={nameDraft ?? ws.session.user.displayName} onChange={(e) => setNameDraft(e.target.value)} data-testid="profile-name-input" />
          </label>
          <button className="btn-primary py-1.5" disabled={savingName || nameDraft === null || nameDraft.trim() === ws.session.user.displayName} data-testid="profile-save">{savingName ? 'Saving…' : 'Save'}</button>
          {nameDraft !== null ? <button type="button" className="btn-secondary py-1.5" onClick={() => setNameDraft(null)}>Cancel</button> : null}
          <p className="basis-full text-xs text-muted">Your email ({ws.session.user.email}) cannot be changed here.</p>
          {ws.health?.googleSignIn ? <button type="button" className="btn-secondary py-1.5" disabled={googleBusy} onClick={() => void google(true)} data-testid="google-link">{googleBusy ? 'Opening Google…' : 'Link Google account'}</button> : null}
        </form>
      ) : ws.health ? (
        <div className="mt-4 space-y-2">
          <div className="flex gap-1 text-xs" role="tablist">
            <button role="tab" aria-selected={mode === 'login'} className={cx('rounded-md px-2.5 py-1', mode === 'login' ? 'bg-brand-50 font-semibold text-brand-700' : 'text-muted')} onClick={() => setMode('login')}>Sign in</button>
            {ws.health.registration ? <button role="tab" aria-selected={mode === 'register'} className={cx('rounded-md px-2.5 py-1', mode === 'register' ? 'bg-brand-50 font-semibold text-brand-700' : 'text-muted')} onClick={() => setMode('register')}>Create account</button> : null}
          </div>
          <form className="space-y-2" noValidate onSubmit={(ev) => { ev.preventDefault(); void submit(ev.currentTarget); }} data-testid="sign-in-form">
          {mode === 'register' ? <div><label className="label" htmlFor="ws-name">Display name</label><input id="ws-name" name="displayName" className="input" autoComplete="name" data-testid="ws-name" /></div> : null}
          <div><label className="label" htmlFor="ws-email">Email</label><input id="ws-email" name="email" type="email" className="input" autoComplete="username" data-testid="ws-email" /></div>
          <div><label className="label" htmlFor="ws-pw">Password {mode === 'register' ? '(min. 10 characters)' : ''}</label><input id="ws-pw" name="password" type="password" className="input" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} data-testid="ws-password" /></div>
          {error ? <p className="text-xs font-medium text-crit" role="alert">{error}</p> : null}
          <button type="submit" className="btn-primary w-full" disabled={busy} aria-busy={busy} data-testid="ws-submit">{mode === 'login' ? <><LogIn size={15} />Sign in</> : <><UserPlus size={15} />Create account</>}</button>
          </form>
          {ws.health.googleSignIn ? (
            <button type="button" className="btn-secondary w-full" disabled={googleBusy} aria-busy={googleBusy} onClick={() => void google(false)} data-testid="google-sign-in">{googleBusy ? 'Opening Google…' : 'Continue with Google'}</button>
          ) : null}
          <p className="text-[11px] text-muted">Passwords are hashed with scrypt on the server. The session token is kept only for this browser tab.</p>
        </div>
      ) : null}
      <div className="mt-4"><Callout tone="warn">Hackathon prototype: use synthetic data only. The shared workspace is not certified for real patient records.</Callout></div>
    </section>
  );
}
