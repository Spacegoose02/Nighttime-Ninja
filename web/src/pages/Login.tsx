import { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../state.tsx';
import { useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';

export function Login() {
  const { refresh } = useApp();
  const [cfg] = useLoad<{ google: boolean; local: boolean }>('/api/auth/config');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'main' | 'pair'>('main');
  const [error, setError] = useState<string | null>(null);

  async function submit(path: string, body: unknown) {
    setError(null);
    try {
      await api(path, { body });
      // If the browser refused the sign-in cookie, say so instead of silently staying on this screen
      // (retrying would then fail, because pairing codes only work once).
      const ok = await api('/api/me').then(() => true, () => false);
      if (!ok) {
        setError("The server accepted you, but this browser didn't keep the sign-in. If the server uses https, open it with its https address.");
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="center-screen">
      <div className="card login-card">
        <div><RaccoonAvatar variant="ninja" size={120} /></div>
        <h1>Nighttime Ninja</h1>
        <p className="muted">Your kitchen, run by a very organized raccoon.</p>
        {mode === 'main' ? (
          <>
            {cfg?.google && (
              <a className="btn primary" href="/api/auth/google">
                <span aria-hidden>🔐</span> Sign in with Google
              </a>
            )}
            {cfg?.local && (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit('/api/auth/local', { name }); }}>
                <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
                <button className={cfg.google ? '' : 'primary'} disabled={!name.trim()}>Continue</button>
              </form>
            )}
            <button className="ghost" onClick={() => setMode('pair')}>I have a pairing code</button>
          </>
        ) : (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit('/api/auth/pair', { code }); }}>
            <p className="small muted">On a device that's already signed in, open Settings and tap “Pair a device”.</p>
            <input placeholder="6-letter code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.4rem' }} />
            <button className="primary" disabled={code.length < 6}>Pair this device</button>
            <button type="button" className="ghost" onClick={() => setMode('main')}>Back</button>
          </form>
        )}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    </div>
  );
}
