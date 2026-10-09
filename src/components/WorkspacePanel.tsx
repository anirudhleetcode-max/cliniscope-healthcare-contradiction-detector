import { useState } from 'react';
import { Cloud, LogIn, LogOut, RefreshCw, ServerCrash, UserPlus } from 'lucide-react';
import { useApp } from '../app/state';
import { useWorkspace } from '../app/workspace';
import { Callout, cx } from './ui';

/** Shared-workspace connection: server URL, health, and genuine sign-in against the MEDGUARD API. */
export function WorkspacePanel() {
  const ws = useWorkspace();
  const { toast } = useApp();
  const [url, setUrl] = useState(ws.serverUrl);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await ws.signIn(email, password);
      else await ws.register(email, password, name);
      setPassword('');
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
      <p className="mb-4 text-xs text-muted">Optional. Connect to a MEDGUARD API server to share cases with other authenticated reviewers and to use AI-assisted analysis. Without it, the app runs in <strong>local demo mode</strong> and data stays in this browser.</p>
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
          ) : <p className="flex items-center gap-2 text-xs text-crit"><ServerCrash size={14} />{ws.healthError ?? 'Checking…'}</p>}
      </div>
      {ws.session ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-soft px-3 py-2">
          <span>Signed in as <strong data-testid="signed-in-as">{ws.session.user.displayName}</strong> &lt;{ws.session.user.email}&gt; · session expires {new Date(ws.session.expiresAt).toLocaleTimeString()}</span>
          <button className="btn-secondary py-1.5" onClick={() => void ws.signOut()} data-testid="sign-out"><LogOut size={14} />Sign out</button>
        </div>
      ) : ws.health ? (
        <div className="mt-4 space-y-2">
          <div className="flex gap-1 text-xs" role="tablist">
            <button role="tab" aria-selected={mode === 'login'} className={cx('rounded-md px-2.5 py-1', mode === 'login' ? 'bg-brand-50 font-semibold text-brand-700' : 'text-muted')} onClick={() => setMode('login')}>Sign in</button>
            {ws.health.registration ? <button role="tab" aria-selected={mode === 'register'} className={cx('rounded-md px-2.5 py-1', mode === 'register' ? 'bg-brand-50 font-semibold text-brand-700' : 'text-muted')} onClick={() => setMode('register')}>Create account</button> : null}
          </div>
          {mode === 'register' ? <div><label className="label" htmlFor="ws-name">Display name</label><input id="ws-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="ws-name" /></div> : null}
          <div><label className="label" htmlFor="ws-email">Email</label><input id="ws-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" data-testid="ws-email" /></div>
          <div><label className="label" htmlFor="ws-pw">Password {mode === 'register' ? '(min. 10 characters)' : ''}</label><input id="ws-pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} data-testid="ws-password" /></div>
          {error ? <p className="text-xs font-medium text-crit" role="alert">{error}</p> : null}
          <button className="btn-primary w-full" disabled={busy || !email || !password} onClick={submit} data-testid="ws-submit">{mode === 'login' ? <><LogIn size={15} />Sign in</> : <><UserPlus size={15} />Create account</>}</button>
          <p className="text-[11px] text-muted">Passwords are hashed with scrypt on the server. The session token is kept only for this browser tab.</p>
        </div>
      ) : null}
      <div className="mt-4"><Callout tone="warn">Hackathon prototype: use synthetic data only. The shared workspace is not certified for real patient records.</Callout></div>
    </section>
  );
}
