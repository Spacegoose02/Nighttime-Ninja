import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type HomeDetail } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { AVATARS, AVATAR_LABELS, RaccoonAvatar } from '../components/Raccoon.tsx';
import { PICTURE_AVATARS } from '../avatars.ts';
import { VersionCard } from '../components/UpdateBanner.tsx';
import { AdminSignIn, AdminUserActions, SecurityCard } from './Security.tsx';

const THEMES = [
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
];

function Profile() {
  const { me, refresh, toast } = useApp();
  const [name, setName] = useState(me!.user.name);
  const [pair, setPair] = useState<string | null>(null);
  const update = async (body: object) => { await api('/api/me', { method: 'PATCH', body }); await refresh(); };

  return (
    <div className="card stack">
      <h2>You</h2>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); await update({ name }); toast('Saved'); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <button>Save name</button>
      </form>
      {me!.user.email && <p className="small muted" style={{ margin: 0 }}>Signed in with Google as {me!.user.email}</p>}
      <h3>Avatar</h3>
      <div className="avatar-grid">
        {[...PICTURE_AVATARS.map((p) => ({ id: p.id, label: p.label })), ...AVATARS.map((a) => ({ id: a, label: AVATAR_LABELS[a] }))].map((a) => (
          <button key={a.id} className={`avatar-pick${me!.user.avatar === a.id ? ' on' : ''}`} onClick={() => update({ avatar: a.id })}>
            <RaccoonAvatar variant={a.id} size={64} title={a.label} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <h3>Theme</h3>
      <div className="chips">
        {THEMES.map((t) => (
          <button key={t.id} className={`chip${me!.user.theme === t.id ? ' on' : ''}`} onClick={() => update({ theme: t.id })}>
            <span style={{ width: 18, height: 18, borderRadius: 99, background: t.swatch, display: 'inline-block', border: '2px solid #fff' }} /> {t.name}
          </button>
        ))}
      </div>
      <h3>Measurements</h3>
      <div className="chips">
        {[['us', 'US (cups, oz, °F)'], ['metric', 'Metric (g, ml)'], ['original', 'As written']].map(([v, l]) => (
          <button key={v} className={`chip${me!.user.units === v ? ' on' : ''}`} onClick={() => update({ units: v })}>{l}</button>
        ))}
      </div>
      <h3>Tablets and phones</h3>
      <p className="small muted" style={{ margin: 0 }}>Sign in on a kitchen tablet or the app without typing your Google password: get a code here, then choose “I have a pairing code” on the other device.</p>
      <div className="row">
        <button onClick={async () => setPair((await api<{ code: string }>('/api/auth/pair-code', { body: {} })).code)}>📱 Pair a device</button>
        {pair && <span style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '0.25em' }}>{pair}</span>}
        {pair && <span className="small muted">valid for 10 minutes</span>}
      </div>
      <div className="row">
        <span className="spacer" />
        <button className="danger" onClick={async () => { await api('/api/auth/logout', { body: {} }); location.href = '/'; }}>Sign out</button>
      </div>
    </div>
  );
}

/** Add, rename, reorder or remove a home's pantry locations or categories. */
function LabelEditor({ kind, title, hint, list, onSaved }: { kind: 'locations' | 'categories'; title: string; hint: string; list: string[]; onSaved: () => void }) {
  const { base, toast } = useApp();
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const save = async (body: object, msg: string) => {
    try { await api(`${base}/labels`, { method: 'PUT', body }); toast(msg); onSaved(); } catch (e) { toast((e as Error).message); }
  };
  const move = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    void save({ [kind]: next }, 'Order saved');
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p className="small muted" style={{ margin: 0 }}>{hint}</p>
      <div className="list">
        {list.map((l, i) => (
          <div key={l} className="list-item" style={{ minHeight: 48, padding: '4px 0' }}>
            {editing?.from === l ? (
              <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); void save({ rename: { kind, from: l, to: editing.to } }, `Renamed to ${editing.to}`); setEditing(null); }}>
                <input value={editing.to} onChange={(e) => setEditing({ from: l, to: e.target.value })} autoFocus style={{ flex: 1 }} />
                <button className="primary" disabled={!editing.to.trim()}>Save</button>
                <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span style={{ flex: 1 }}>{l}</span>
                <button className="ghost icon" aria-label={`Move ${l} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="ghost icon" aria-label={`Move ${l} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="ghost" onClick={() => setEditing({ from: l, to: l })}>Rename</button>
                <button className="ghost danger" disabled={list.length < 2} onClick={() => save({ [kind]: list.filter((x) => x !== l) }, `Removed ${l}`)}>Remove</button>
              </>
            )}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void save({ [kind]: [...list, adding.trim()] }, `Added ${adding.trim()}`); setAdding(''); }}>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={kind === 'locations' ? 'New place, e.g. Garage Freezer' : 'New category, e.g. Baby Food'} style={{ flex: 1 }} />
        <button disabled={!adding.trim()}>Add</button>
      </form>
    </div>
  );
}

function HomeSettings() {
  const { me, base, homeId, setHome, refresh, toast } = useApp();
  const [home, reload] = useLoad<HomeDetail>(base);
  const [stores] = useLoad<{ stores: { id: string; name: string }[]; krogerApi: boolean }>('/api/stores');
  const [tokens, reloadTokens] = useLoad<{ id: string; name: string; last_used_at: string | null }[]>(home?.role === 'manager' ? `${base}/tokens` : null, [home?.role]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [zip, setZip] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string; address: string }[] | null>(null);
  if (!home) return null;
  const isManager = home.role === 'manager';
  const patch = async (body: object) => { await api(base, { method: 'PATCH', body }); await reload(); };
  const calendar = home.calendarUrl ? `${location.origin}${home.calendarUrl}` : null;

  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ flex: 1, margin: 0 }}>Home</h2>
        {me!.homes.length > 1 && (
          <select value={homeId ?? ''} onChange={(e) => setHome(e.target.value)} style={{ width: 'auto' }}>
            {me!.homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
        <Link className="btn" to="/home/new">＋ Add or join a home</Link>
      </div>
      {isManager ? (
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await patch({ name: (e.currentTarget.elements.namedItem('hn') as HTMLInputElement).value }); await refresh(); toast('Renamed'); }}>
          <input name="hn" defaultValue={home.name} style={{ flex: 1 }} />
          <button>Rename</button>
        </form>
      ) : <p style={{ margin: 0 }}><strong>{home.name}</strong> <span className="muted">(you're a member)</span></p>}

      <h3>Invite people</h3>
      <div className="row">
        <span>Join code:</span>
        <strong style={{ fontSize: '1.4rem', letterSpacing: '0.15em' }}>{home.joinCode}</strong>
        {isManager && <button onClick={async () => { await api(`${base}/join-code`, { body: {} }); await reload(); }}>New code</button>}
      </div>

      <h3>People</h3>
      <div className="list">
        {home.members.map((m) => (
          <div key={m.id} className="list-item">
            <RaccoonAvatar variant={m.avatar} size={40} />
            <span style={{ flex: 1 }}>{m.name}{m.id === me!.user.id && ' (you)'}</span>
            {isManager ? (
              <select value={m.role} style={{ width: 'auto' }} onChange={async (e) => {
                try { await api(`${base}/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }); } catch (err) { toast((err as Error).message); }
                await reload();
              }}>
                <option value="manager">Home manager</option>
                <option value="member">Member</option>
              </select>
            ) : <span className="pill">{m.role === 'manager' ? 'Home manager' : 'Member'}</span>}
            {(isManager || m.id === me!.user.id) && (
              <button className="ghost danger" onClick={async () => {
                if (!confirm(m.id === me!.user.id ? 'Leave this home?' : `Remove ${m.name}?`)) return;
                try { await api(`${base}/members/${m.id}`, { method: 'DELETE' }); } catch (err) { toast((err as Error).message); return; }
                if (m.id === me!.user.id) { await refresh(); } else await reload();
              }}>{m.id === me!.user.id ? 'Leave' : 'Remove'}</button>
            )}
          </div>
        ))}
      </div>

      <h3>Google Calendar</h3>
      <p className="small muted" style={{ margin: 0 }}>In Google Calendar choose Other calendars → ＋ → From URL, and paste this link. Your meal plan shows up and stays in sync.</p>
      {calendar && (
        <div className="row">
          <input readOnly value={calendar} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
          <button onClick={() => { void navigator.clipboard?.writeText(calendar); toast('Copied'); }}>Copy</button>
          {isManager && <button onClick={async () => { await api(`${base}/calendar-token`, { body: {} }); await reload(); toast('Old link turned off'); }}>Reset link</button>}
        </div>
      )}

      <LabelEditor kind="locations" title="Pantry places" hint="Where things are kept. Renaming moves every item in that place." list={home.settings.locations} onSaved={() => void reload()} />
      <LabelEditor kind="categories" title="Categories" hint="Groups for the pantry and shopping list, in this order. Renaming updates every item." list={home.settings.categories} onSaved={() => void reload()} />

      <h3>Stores</h3>
      <div className="chips">
        {stores?.stores.map((s) => {
          const on = home.settings.stores.includes(s.id);
          return (
            <button key={s.id} disabled={!isManager} className={`chip${on ? ' on' : ''}`}
              onClick={() => patch({ stores: on ? home.settings.stores.filter((x) => x !== s.id) : [...home.settings.stores, s.id] })}>{s.name}</button>
          );
        })}
      </div>
      {stores?.krogerApi && isManager && (
        <div className="stack">
          <span className="small muted">Kroger store for live prices: {home.settings.krogerLocationId ?? 'not set'}</span>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); setLocations(await api(`/api/deals/kroger/locations?zip=${zip}`)); }}>
            <input placeholder="ZIP code" value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" style={{ maxWidth: 160 }} />
            <button>Find stores</button>
          </form>
          {locations?.map((l) => (
            <button key={l.id} className="ghost" style={{ justifyContent: 'flex-start' }} onClick={async () => { await patch({ krogerLocationId: l.id, zipCode: zip }); setLocations(null); }}>
              {l.name}: {l.address}
            </button>
          ))}
        </div>
      )}

      {isManager && (
        <>
          <h3>Home Assistant and automations</h3>
          <p className="small muted" style={{ margin: 0 }}>Create a token, then follow docs/home-assistant.md in the project to add sensors and a shopping-list service.</p>
          <p className="small" style={{ margin: 0 }}>API address for this home: <code style={{ wordBreak: 'break-all' }}>{location.origin}{base}</code></p>
          <form className="row" onSubmit={async (e) => {
            e.preventDefault();
            const el = e.currentTarget.elements.namedItem('tn') as HTMLInputElement;
            setNewToken((await api<{ token: string }>(`${base}/tokens`, { body: { name: el.value } })).token);
            el.value = '';
            await reloadTokens();
          }}>
            <input name="tn" placeholder="Token name, e.g. Home Assistant" style={{ flex: 1 }} required />
            <button>Create token</button>
          </form>
          {newToken && <div className="card" style={{ background: 'var(--surface-2)' }}><strong>Copy this now, it won't be shown again:</strong><br /><code style={{ wordBreak: 'break-all' }}>{newToken}</code></div>}
          {tokens?.map((t) => (
            <div key={t.id} className="row">
              <span style={{ flex: 1 }}>{t.name} <span className="small muted">{t.last_used_at ? `last used ${t.last_used_at}` : 'never used'}</span></span>
              <button className="ghost danger" onClick={async () => { await api(`${base}/tokens/${t.id}`, { method: 'DELETE' }); await reloadTokens(); }}>Revoke</button>
            </div>
          ))}
          <h3>Backup</h3>
          <div className="row">
            <a className="btn" href={`${base}/export`}>⬇️ Download everything (JSON)</a>
            <button className="danger" onClick={async () => {
              if (prompt(`Type the home name to delete it forever: ${home.name}`) !== home.name) return;
              await api(base, { method: 'DELETE' });
              await refresh();
            }}>Delete home</button>
          </div>
        </>
      )}
    </div>
  );
}

interface Overview {
  users: { id: string; name: string; username: string | null; email: string | null; is_admin: number; disabled: number; totp_enabled: number; has_password: number; has_google: number; passkeys: number; homes: number }[];
  homes: { id: string; name: string; members: number; recipes: number }[];
}

function Admin() {
  const { me, toast } = useApp();
  const [data, reload] = useLoad<Overview>('/api/admin/overview');
  if (!data) return null;
  return (
    <div className="card stack">
      <h2>Server admin</h2>
      <AdminSignIn />
      <h3>People</h3>
      <table>
        <thead><tr><th>Person</th><th>Sign-in</th><th>Homes</th><th>Admin</th><th /></tr></thead>
        <tbody>
          {data.users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}{!!u.disabled && <span className="pill bad"> off</span>}<div className="small muted">{u.username ?? u.email}</div></td>
              <td className="small">{[u.has_password && 'password', u.has_google && 'Google', u.passkeys && 'passkey', u.totp_enabled && '2FA'].filter(Boolean).join(', ') || 'quick only'}</td>
              <td>{u.homes}</td>
              <td>
                <input type="checkbox" checked={!!u.is_admin} disabled={u.id === me!.user.id} style={{ width: 24, minHeight: 24 }}
                  onChange={async (e) => { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { isAdmin: e.target.checked } }); await reload(); }} />
              </td>
              <td>{u.id !== me!.user.id && (
                <span className="row" style={{ gap: 4 }}>
                  <AdminUserActions user={u} onChange={() => void reload()} />
                  <button className="ghost danger" onClick={async () => { if (confirm(`Delete ${u.name}'s account?`)) { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); await reload(); toast('Deleted'); } }}>Delete</button>
                </span>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Homes on this server</h3>
      <ul>{data.homes.map((h) => <li key={h.id}>{h.name} <span className="muted small">{h.members} people · {h.recipes} recipes</span></li>)}</ul>
    </div>
  );
}

export function Settings() {
  const { me } = useApp();
  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <div className="topbar"><h1>Settings</h1></div>
      <Profile />
      <SecurityCard />
      <HomeSettings />
      <VersionCard />
      {me?.user.isAdmin && <Admin />}
      <p className="small muted">Nighttime Ninja is open source under the MIT license.</p>
    </div>
  );
}
