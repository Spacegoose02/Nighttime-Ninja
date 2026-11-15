// Settings → Home, Connections and Backup: everything about the home you're in.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../../i18n.ts';
import { REGIONS } from '../../regions.ts';
import { api, type HomeDetail } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { useDialogs } from '../../components/Dialog.tsx';
import { RaccoonAvatar } from '../../components/Raccoon.tsx';
import { DietsAndAllergies } from './Diets.tsx';
import { CalendarSync } from './CalendarSync.tsx';
import { DenDuty } from './DenDuty.tsx';

const OPTIONAL_PAGES = [
  { to: '/plan', name: 'Meal Plan' }, { to: '/chef', name: 'Chef Gordy' }, { to: '/mixologist', name: 'Mixologist' },
  { to: '/deals', name: 'Deals' }, { to: '/feed', name: 'Feed' },
];

/** The home you're in, shared by every Home page. */
function useHome() {
  const { base } = useApp();
  const [home, reload] = useLoad<HomeDetail>(base);
  const patch = async (body: object) => { await api(base, { method: 'PATCH', body }); await reload(); };
  return { home, reload, patch, isManager: home?.role === 'manager' };
}

function CurrencyPicker({ value, disabled, onPick }: { value: string; disabled: boolean; onPick: (c: string) => void }) {
  const codes = [...new Set(REGIONS.map((r) => r.currency))].sort();
  if (!codes.includes(value)) codes.unshift(value);
  return (
    <label className="row">
      <span style={{ fontWeight: 600 }}>{t('Currency')}</span>
      <select value={value} disabled={disabled} onChange={(e) => onPick(e.target.value)} style={{ width: 'auto' }}>
        {codes.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}

/** Settings → Home: name, currency, pages, invites, people, diets. */
export function HomeGeneral() {
  const { me, base, homeId, setHome, refresh, toast } = useApp();
  const dialogs = useDialogs();
  const { home, reload, patch, isManager } = useHome();
  if (!home) return null;
  return (
    <>
      <div className="card stack">
        <div className="row">
          <h2 style={{ flex: 1, margin: 0 }}>{home.name}</h2>
          {me!.homes.length > 1 && (
            <select aria-label="Current home" value={homeId ?? ''} onChange={(e) => setHome(e.target.value)} style={{ width: 'auto' }}>
              {me!.homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
          <Link className="btn" to="/home/new">＋ Add or join a home</Link>
        </div>
        {isManager ? (
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await patch({ name: (e.currentTarget.elements.namedItem('hn') as HTMLInputElement).value }); await refresh(); toast('Renamed'); }}>
            <input name="hn" aria-label="Home name" defaultValue={home.name} style={{ flex: 1 }} />
            <button>Rename</button>
          </form>
        ) : <p className="small muted" style={{ margin: 0 }}>You're a member here. A home manager can change these.</p>}
        <CurrencyPicker value={home.settings.currency ?? 'USD'} disabled={!isManager} onPick={async (currency) => { await patch({ currency }); await refresh(); toast(t('Saved')); }} />
      </div>

      <div className="card stack">
        <h2>{t('Pages')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{t("Hide what this home doesn't use. They come back here any time.")}</p>
        <div className="chips">
          {OPTIONAL_PAGES.map((p) => {
            const hidden = home.settings.hiddenPages ?? [];
            const on = !hidden.includes(p.to);
            return (
              <button key={p.to} disabled={!isManager} aria-pressed={on} className={`chip${on ? ' on' : ''}`}
                onClick={async () => { await patch({ hiddenPages: on ? [...hidden, p.to] : hidden.filter((x) => x !== p.to) }); await refresh(); }}>{t(p.name)}</button>
            );
          })}
        </div>
      </div>

      <div className="card stack">
        <h2>People</h2>
        <div className="row">
          <span>Join code:</span>
          <strong style={{ fontSize: '1.4rem', letterSpacing: '0.15em' }}>{home.joinCode}</strong>
          {isManager && <button onClick={async () => { await api(`${base}/join-code`, { body: {} }); await reload(); }}>New code</button>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>Give this code to someone in your household so they can join.</p>
        <div className="list">
          {home.members.map((m) => (
            <div key={m.id} className="list-item">
              <RaccoonAvatar variant={m.avatar} size={40} />
              <span style={{ flex: 1 }}>{m.name}{m.id === me!.user.id && ' (you)'}</span>
              {isManager ? (
                <select aria-label={`Role for ${m.name}`} value={m.role} style={{ width: 'auto' }} onChange={async (e) => {
                  try { await api(`${base}/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }); } catch (err) { toast((err as Error).message); }
                  await reload();
                }}>
                  <option value="manager">Home manager</option>
                  <option value="member">Member</option>
                </select>
              ) : <span className="pill">{m.role === 'manager' ? 'Home manager' : 'Member'}</span>}
              {(isManager || m.id === me!.user.id) && (
                <button className="ghost danger" onClick={async () => {
                  if (!(await dialogs.confirm(m.id === me!.user.id ? 'Leave this home?' : `Remove ${m.name}?`, { okLabel: m.id === me!.user.id ? 'Leave' : 'Remove', danger: true }))) return;
                  try { await api(`${base}/members/${m.id}`, { method: 'DELETE' }); } catch (err) { toast((err as Error).message); return; }
                  if (m.id === me!.user.id) { await refresh(); } else await reload();
                }}>{m.id === me!.user.id ? 'Leave' : 'Remove'}</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card stack">
        <DietsAndAllergies home={home} reload={reload} />
      </div>
    </>
  );
}

/** Settings → Connections: calendars, stores, Den Duty, and tokens for Home Assistant and AI assistants. */
export function HomeConnections() {
  const { base, toast } = useApp();
  const { home, reload, patch, isManager } = useHome();
  const [stores] = useLoad<{ stores: { id: string; name: string }[]; krogerApi: boolean }>('/api/stores');
  const [tokens, reloadTokens] = useLoad<{ id: string; name: string; last_used_at: string | null }[]>(isManager ? `${base}/tokens` : null, [isManager]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [zip, setZip] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string; address: string }[] | null>(null);
  if (!home) return null;
  const calendar = home.calendarUrl ? `${location.origin}${home.calendarUrl}` : null;
  return (
    <>
      <div className="card stack">
        <h2>Google Calendar</h2>
        <p className="small muted" style={{ margin: 0 }}>In Google Calendar choose Other calendars → ＋ → From URL, and paste this link. Your meal plan shows up and stays in sync.</p>
        {calendar && (
          <div className="row">
            <input readOnly aria-label="Calendar link" value={calendar} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
            <button onClick={() => { void navigator.clipboard?.writeText(calendar); toast('Copied'); }}>Copy</button>
            {isManager && <button onClick={async () => { await api(`${base}/calendar-token`, { body: {} }); await reload(); toast('Old link turned off'); }}>Reset link</button>}
          </div>
        )}
        <CalendarSync isManager={isManager} />
      </div>

      <div className="card stack">
        <h2>Stores</h2>
        <div className="chips">
          {stores?.stores.map((s) => {
            const on = home.settings.stores.includes(s.id);
            return (
              <button key={s.id} disabled={!isManager} aria-pressed={on} className={`chip${on ? ' on' : ''}`}
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
      </div>

      <DenDuty />

      {isManager && (
        <div className="card stack">
          <h2>Home Assistant, AI assistants and automations</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Create a token, then see the project docs for <a href="https://spacegoose02.github.io/Nighttime-Ninja/home-assistant.html" target="_blank" rel="noreferrer">Home Assistant</a> or
            {' '}<a href="https://spacegoose02.github.io/Nighttime-Ninja/mcp.html" target="_blank" rel="noreferrer">AI assistants such as Claude (MCP)</a>.
          </p>
          <p className="small" style={{ margin: 0 }}>API address for this home: <code style={{ wordBreak: 'break-all' }}>{location.origin}{base}</code></p>
          <p className="small" style={{ margin: 0 }}>MCP address for AI assistants: <code style={{ wordBreak: 'break-all' }}>{location.origin}/api/mcp</code></p>
          <form className="row" onSubmit={async (e) => {
            e.preventDefault();
            const el = e.currentTarget.elements.namedItem('tn') as HTMLInputElement;
            setNewToken((await api<{ token: string }>(`${base}/tokens`, { body: { name: el.value } })).token);
            el.value = '';
            await reloadTokens();
          }}>
            <input name="tn" placeholder="Token name, e.g. Home Assistant" aria-label="Token name" style={{ flex: 1 }} required />
            <button>Create token</button>
          </form>
          {newToken && <div className="card" style={{ background: 'var(--surface-2)' }}><strong>Copy this now, it won't be shown again:</strong><br /><code style={{ wordBreak: 'break-all' }}>{newToken}</code></div>}
          {tokens?.map((tk) => (
            <div key={tk.id} className="row">
              <span style={{ flex: 1 }}>{tk.name} <span className="small muted">{tk.last_used_at ? `last used ${tk.last_used_at}` : 'never used'}</span></span>
              <button className="ghost danger" onClick={async () => { await api(`${base}/tokens/${tk.id}`, { method: 'DELETE' }); await reloadTokens(); }}>Revoke</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Settings → Backup: download the home, or delete it. */
export function HomeData() {
  const { base, refresh } = useApp();
  const dialogs = useDialogs();
  const { home, isManager } = useHome();
  if (!home) return null;
  if (!isManager) return <div className="card muted">Only a home manager can download or delete {home.name}.</div>;
  return (
    <>
      <div className="card stack">
        <h2>Download</h2>
        <p className="small muted" style={{ margin: 0 }}>Everything in {home.name}, to keep or to move to another server.</p>
        <div className="row">
          <a className="btn" href={`${base}/export`}>⬇️ Download everything (JSON)</a>
          <a className="btn" href={`${base}/export/paprika`} title="Opens in Paprika, Mealie and Tandoor">⬇️ Recipes for another app (Paprika file)</a>
        </div>
      </div>
      <div className="card stack">
        <h2>Delete this home</h2>
        <p className="small muted" style={{ margin: 0 }}>Removes its recipes, pantry, lists and plans for everyone in it. This can't be undone.</p>
        <div className="row">
          <button className="danger" onClick={async () => {
            if (await dialogs.prompt(`Type the home name to delete it forever: ${home.name}`, '', { okLabel: 'Delete forever', danger: true, mustType: home.name }) !== home.name) return;
            await api(base, { method: 'DELETE' });
            await refresh();
          }}>Delete home</button>
        </div>
      </div>
    </>
  );
}
