// Settings → Profile, Look and feel, and the linked sign-in accounts on Sign-in and security.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LANGUAGES, language, setLanguage, t } from '../../i18n.ts';
import { fontChoice, setFontChoice, setTextSize, textSize } from '../../devicePrefs.ts';
import { forgetDevice } from '../../offline.ts';
import { api } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { useDialogs } from '../../components/Dialog.tsx';
import { AVATARS, AVATAR_LABELS, RaccoonAvatar } from '../../components/Raccoon.tsx';
import { PICTURE_AVATARS } from '../../avatars.ts';

const THEMES = [
  { id: 'auto', name: 'Match my device', swatch: 'linear-gradient(135deg, #2f7d4f 50%, #0f1612 50%)' },
  { id: 'forest', name: 'Forest', swatch: '#2f7d4f' },
  { id: 'midnight', name: 'Midnight', swatch: '#0f1612' },
  { id: 'citrus', name: 'Citrus', swatch: '#e07a00' },
  { id: 'raccoon', name: 'Raccoon', swatch: '#3a4046' },
  { id: 'berry', name: 'Berry', swatch: '#8e2c7a' },
  { id: 'ocean', name: 'Ocean', swatch: '#1f6fb2' },
  { id: 'sunset', name: 'Sunset', swatch: '#d9480f' },
  { id: 'lavender', name: 'Lavender', swatch: '#6741d9' },
  { id: 'mint', name: 'Mint', swatch: '#0ca678' },
  { id: 'arctic', name: 'Arctic', swatch: '#3b5bdb' },
  { id: 'espresso', name: 'Espresso', swatch: '#3b2a20' },
  { id: 'neon', name: 'Neon', swatch: '#a3e635' },
  { id: 'sweettea', name: 'Sweet Tea', swatch: '#b7791f' },
  { id: 'peach', name: 'Peach Cobbler', swatch: '#f08c5a' },
  { id: 'pistachio', name: 'Pistachio', swatch: '#8aad3a' },
  { id: 'blueberry', name: 'Blueberry', swatch: '#4c4fc4' },
  { id: 'castiron', name: 'Cast Iron', swatch: '#2a2a2a' },
  { id: 'bourbon', name: 'Bourbon', swatch: '#8a5a2b' },
  { id: 'contrast', name: 'High contrast', swatch: 'linear-gradient(135deg, #000 50%, #fff 50%)' },
];

function useUpdateMe() {
  const { refresh } = useApp();
  return async (body: object) => { await api('/api/me', { method: 'PATCH', body }); await refresh(); };
}

/** Settings → Profile: your name, picture, and this device. */
export function Profile() {
  const { me, toast } = useApp();
  const update = useUpdateMe();
  const [name, setName] = useState(me!.user.name);
  const [pair, setPair] = useState<string | null>(null);
  return (
    <>
      <div className="card stack">
        <h2>{t('Your name')}</h2>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await update({ name }); toast('Saved'); }}>
          <input aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <button>Save name</button>
        </form>
        {me!.user.email && <p className="small muted" style={{ margin: 0 }}>{t('Email')}: {me!.user.email}</p>}
      </div>
      <div className="card stack">
        <h2>{t('Avatar')}</h2>
        <div className="avatar-grid">
          {[...PICTURE_AVATARS.map((p) => ({ id: p.id, label: p.label })), ...AVATARS.map((a) => ({ id: a, label: AVATAR_LABELS[a] }))].map((a) => (
            <button key={a.id} className={`avatar-pick${me!.user.avatar === a.id ? ' on' : ''}`} onClick={() => update({ avatar: a.id })}>
              <RaccoonAvatar variant={a.id} size={64} title={a.label} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card stack">
        <h2>Tablets and phones</h2>
        <p className="small muted" style={{ margin: 0 }}>Sign in on a kitchen tablet or the app without typing a password: get a code here, then choose “I have a pairing code” on the other device.</p>
        <div className="row">
          <button onClick={async () => setPair((await api<{ code: string }>('/api/auth/pair-code', { body: {} })).code)}>📱 Pair a device</button>
          {pair && <span style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '0.25em' }}>{pair}</span>}
          {pair && <span className="small muted">valid for 10 minutes</span>}
        </div>
      </div>
      <div className="row">
        <span className="spacer" />
        <button className="danger" onClick={async () => { await api('/api/auth/logout', { body: {} }); await forgetDevice(); location.href = '/'; }}>Sign out</button>
      </div>
    </>
  );
}

/** Settings → Look and feel: theme and measurements (your account), language, text size and font (this device). */
export function Appearance() {
  const { me } = useApp();
  const update = useUpdateMe();
  const [size, setSize] = useState(textSize());
  const [font, setFont] = useState(fontChoice());
  return (
    <>
      <div className="card stack">
        <h2>{t('Theme')}</h2>
        <div className="chips">
          {THEMES.map((th) => (
            <button key={th.id} className={`chip${me!.user.theme === th.id ? ' on' : ''}`} aria-pressed={me!.user.theme === th.id} onClick={() => update({ theme: th.id })}>
              <span style={{ width: 18, height: 18, borderRadius: 99, background: th.swatch, display: 'inline-block', border: '2px solid #fff' }} /> {th.name}
            </button>
          ))}
        </div>
      </div>
      <div className="card stack">
        <h2>{t('Measurements')}</h2>
        <div className="chips">
          {[['us', 'US (cups, oz, °F)'], ['metric', 'Metric (g, ml)'], ['original', 'As written']].map(([v, l]) => (
            <button key={v} className={`chip${me!.user.units === v ? ' on' : ''}`} aria-pressed={me!.user.units === v} onClick={() => update({ units: v })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="card stack">
        <h2>{t('On this device')}</h2>
        <div className="row">
          <span className="small muted" style={{ minWidth: 90 }}>{t('Language')}</span>
          <div className="chips">
            {LANGUAGES.map((l) => <button key={l.id} className={`chip${language() === l.id ? ' on' : ''}`} aria-pressed={language() === l.id} onClick={() => setLanguage(l.id)}>{l.name}</button>)}
          </div>
        </div>
        <div className="row">
          <span className="small muted" style={{ minWidth: 90 }}>{t('Text size')}</span>
          <div className="chips">
            {([['normal', t('Normal')], ['large', t('Large')], ['xl', t('Extra large')]] as const).map(([v, l]) => (
              <button key={v} className={`chip${size === v ? ' on' : ''}`} aria-pressed={size === v} onClick={() => { setTextSize(v); setSize(v); }}>{l}</button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="small muted" style={{ minWidth: 90 }}>{t('Font')}</span>
          <div className="chips">
            {([['standard', t('Standard')], ['readable', t('Easy to read')]] as const).map(([v, l]) => (
              <button key={v} className={`chip${font === v ? ' on' : ''}`} aria-pressed={font === v} onClick={() => { setFontChoice(v); setFont(v); }}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

interface SsoLink { id: string; name: string; kind: string; linked: boolean; username: string | null; email: string | null; confirmed: boolean }

const SSO_RESULT: Record<string, string> = {
  linked: 'Linked. You can sign in with it from now on.',
  taken: 'That account is already linked to someone else here. Ask the admin to move it.',
  expired: 'That took too long. Try linking again.',
  failed: "The sign-in didn't go through. Try again, or ask the admin to check the settings.",
  unreachable: "Couldn't reach the sign-in server. Ask the admin to check its address.",
};

/** Settings → Sign-in and security: link your account to Tinyauth (or another single sign-on the admin set up). */
export function LinkedAccounts() {
  const { toast } = useApp();
  const dialogs = useDialogs();
  const [data, reload] = useLoad<{ links: SsoLink[] }>('/api/auth/links');
  const [params, setParams] = useSearchParams();
  const result = params.get('sso');
  useEffect(() => {
    if (!result) return;
    toast(SSO_RESULT[result] ?? SSO_RESULT.failed);
    setParams({}, { replace: true });
  }, [result, setParams, toast]);
  if (!data?.links.length) return null;
  return (
    <div className="card stack">
      <h2>Linked accounts</h2>
      <p className="small muted" style={{ margin: 0 }}>Link your account here once, then use the button on the sign-in page instead of a password.</p>
      <div className="list">
        {data.links.map((l) => (
          <div key={l.id} className="list-item">
            <span style={{ flex: 1 }}>
              <strong>{l.name}</strong>{' '}
              {l.linked
                ? <span className="small muted">{l.confirmed ? `linked as ${l.username ?? l.email ?? 'you'}` : `the admin linked ${l.username}; it's confirmed the first time you sign in with it`}</span>
                : <span className="small muted">not linked</span>}
            </span>
            {l.linked && <button className="ghost danger" onClick={async () => {
              if (!(await dialogs.confirm(`Unlink ${l.name}? You won't be able to sign in with it until you link it again.`, { okLabel: 'Unlink', danger: true }))) return;
              try { await api(`/api/auth/links/${encodeURIComponent(l.id)}`, { method: 'DELETE' }); await reload(); toast('Unlinked'); } catch (e) { toast((e as Error).message); }
            }}>Unlink</button>}
            {/* A full-page trip to the provider and back. */}
            <a className="btn" href={`/api/auth/sso/${encodeURIComponent(l.id)}?link=1`}>{l.linked ? 'Link again' : `Link ${l.name}`}</a>
          </div>
        ))}
      </div>
    </div>
  );
}
