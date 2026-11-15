// Settings → Users and Server (admins): who has an account, which homes exist, which AI the helpers use, and backups.
import { useState } from 'react';
import { useDialogs, Modal } from '../../components/Dialog.tsx';
import { api } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { AdminUserActions } from '../Security.tsx';

interface Overview {
  users: { id: string; name: string; username: string | null; email: string | null; is_admin: number; disabled: number; totp_enabled: number; has_password: number; has_google: number; passkeys: number; homes: number; sso: string | null }[];
  homes: { id: string; name: string; members: number; recipes: number }[];
}
type OverviewUser = Overview['users'][number];

/** Settings → Users: everyone with an account on this server. */
export function AdminUsers() {
  const { me, toast } = useApp();
  const dialogs = useDialogs();
  const [data, reload] = useLoad<Overview>('/api/admin/overview');
  const [linking, setLinking] = useState<OverviewUser | null>(null);
  if (!data) return null;
  return (
    <>
      <div className="card stack">
        <h2>People</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Person</th><th>Sign-in</th><th>Homes</th><th>Admin</th><th /></tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}{!!u.disabled && <span className="pill bad"> off</span>}<div className="small muted">{u.username ?? u.email}</div></td>
                  <td className="small">{[u.has_password && 'password', u.has_google && 'Google', u.sso, u.passkeys && 'passkey', u.totp_enabled && '2FA'].filter(Boolean).join(', ') || 'quick only'}</td>
                  <td>{u.homes}</td>
                  <td>
                    <input type="checkbox" checked={!!u.is_admin} disabled={u.id === me!.user.id} style={{ width: 24, minHeight: 24 }} aria-label={`${u.name} is a server admin`}
                      onChange={async (e) => { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { isAdmin: e.target.checked } }); await reload(); }} />
                  </td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      <button className="ghost" onClick={() => setLinking(u)}>Linked sign-in</button>
                      {u.id !== me!.user.id && (
                        <>
                          <AdminUserActions user={u} onChange={() => void reload()} />
                          <button className="ghost danger" onClick={async () => { if (await dialogs.confirm(`Delete ${u.name}'s account?`, { okLabel: 'Delete', danger: true })) { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); await reload(); toast('Deleted'); } }}>Delete</button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card stack">
        <h2>Homes on this server</h2>
        <ul>{data.homes.map((h) => <li key={h.id}>{h.name} <span className="muted small">{h.members} people · {h.recipes} recipes</span></li>)}</ul>
      </div>
      {linking && <LinkDialog user={linking} onClose={() => { setLinking(null); void reload(); }} />}
    </>
  );
}

interface SsoLink { id: string; name: string; kind: string; linked: boolean; username: string | null; email: string | null; confirmed: boolean }

/** Link someone's account to their Tinyauth (or other single sign-on) username, so they can sign in with it. */
function LinkDialog({ user, onClose }: { user: OverviewUser; onClose: () => void }) {
  const { toast } = useApp();
  const [data, , , set] = useLoad<{ links: SsoLink[] }>(`/api/admin/users/${user.id}/sso`);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<{ links: SsoLink[] }>, msg: string) => {
    try { const r = await fn(); set(() => r); toast(msg); } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal label={`Linked sign-in for ${user.name}`} onClose={onClose}>
      <h2 style={{ margin: 0 }}>Linked sign-in for {user.name}</h2>
      {!data ? null : !data.links.length ? (
        <p className="muted" style={{ margin: 0 }}>No single sign-on is set up yet. Add Tinyauth under Settings → Sign-in first.</p>
      ) : data.links.map((l) => (
        <form key={l.id} className="stack" style={{ gap: 6 }} onSubmit={(e) => {
          e.preventDefault();
          void run(() => api(`/api/admin/users/${user.id}/sso/${encodeURIComponent(l.id)}`, { method: 'PUT', body: { username: typed[l.id] ?? l.username ?? '' } }), 'Linked');
        }}>
          <strong>{l.name}</strong>
          <span className="small muted">
            {l.linked ? (l.confirmed ? `Linked as ${l.username ?? l.email ?? 'their account'}.` : `Waiting for ${l.username} to sign in for the first time.`) : 'Not linked.'}
            {' '}Type their {l.name} username; the next time that person signs in with {l.name} they land in this account.
          </span>
          <div className="row">
            <input aria-label={`${l.name} username`} placeholder={`${l.name} username`} autoCapitalize="none" value={typed[l.id] ?? l.username ?? ''}
              onChange={(e) => setTyped({ ...typed, [l.id]: e.target.value })} style={{ flex: 1 }} />
            <button className="primary" disabled={!(typed[l.id] ?? l.username ?? '').trim()}>Link</button>
            {l.linked && <button type="button" className="ghost danger" onClick={() => void run(() => api(`/api/admin/users/${user.id}/sso/${encodeURIComponent(l.id)}`, { method: 'DELETE' }), 'Unlinked')}>Unlink</button>}
          </div>
        </form>
      ))}
      <div className="row"><span className="spacer" /><button onClick={onClose}>Done</button></div>
    </Modal>
  );
}

/** Settings → Server: AI helpers and database backups. */
export function AdminServer() {
  return (
    <>
      <div className="card stack"><AdminMixologist /></div>
      <div className="card stack"><AdminBackups /></div>
    </>
  );
}

interface AiUsage { today: { requests: number; cost: number }; month: { requests: number; cost: number }; byModel: { model: string; requests: number; cost: number }[] }
const usd = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 3 : 2 }).format(n);

/** Server admin: which AI the helpers use, whether they may search the web, and what it's costing. */
function AdminMixologist() {
  const { toast } = useApp();
  const [usage] = useLoad<AiUsage>('/api/admin/ai-usage');
  const [s, reload] = useLoad<{ available: boolean; provider: 'claude' | 'local' | null; localUrl: string | null; model: string | null; envModel: string | null; choices: { id: string; label: string; blurb: string }[]; webAccess: boolean }>('/api/admin/mixologist');
  if (!s) return null;
  const choices = s.envModel && !s.choices.some((c) => c.id === s.envModel)
    ? [...s.choices, { id: s.envModel, label: s.envModel, blurb: 'From ANTHROPIC_MODEL' }]
    : s.choices;
  const pick = async (model: string) => { await api('/api/admin/mixologist', { method: 'PATCH', body: { model } }); await reload(); toast('Saved'); };
  const setWeb = async (webAccess: boolean) => { await api('/api/admin/mixologist', { method: 'PATCH', body: { webAccess } }); await reload(); toast('Saved'); };
  return (
    <div className="stack">
      <h2>🤖 AI helpers</h2>
      {s.provider === 'local' ? (
        <p className="small muted" style={{ margin: 0 }}>
          Using your own AI server at <code>{s.localUrl}</code> with <code>{s.model}</code>. Gordy and Rocco can't search the web this way.
          Remove <code>AI_BASE_URL</code> and set <code>ANTHROPIC_API_KEY</code> to use Claude instead.
        </p>
      ) : s.available ? (
        <>
          <div className="chips">
            {choices.map((c) => (
              <button key={c.id} className={`chip${s.model === c.id ? ' on' : ''}`} title={c.id} onClick={() => pick(c.id)}>{c.label} · {c.blurb}</button>
            ))}
          </div>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={s.webAccess} onChange={(e) => void setWeb(e.target.checked)} style={{ width: 20, minHeight: 20 }} />
            🌐 Let Gordy and Rocco search the web (up to 3 searches a reply, billed to your Claude key)
          </label>
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Add <code>ANTHROPIC_API_KEY</code> to the server and restart to turn on Gordy, Rocco and the other AI helpers, then pick a model here.
          Or run your own model with Ollama or LM Studio and set <code>AI_BASE_URL</code> (see docs/settings.md).
        </p>
      )}
      {usage && usage.month.requests > 0 && (
        <div className="small">
          <strong>This month:</strong> {usage.month.requests} AI request{usage.month.requests === 1 ? '' : 's'}, about {usd(usage.month.cost)}
          {' '}(today {usage.today.requests}, {usd(usage.today.cost)}).
          <span className="muted"> {usage.byModel.map((m) => `${m.model}: ${m.requests} · ${usd(m.cost)}`).join(' · ')}. Estimated from Claude's list prices; your bill is the final word.</span>
        </div>
      )}
    </div>
  );
}

interface Backups { dir: string; backups: { name: string; kind: 'nightly' | 'upgrade' | 'manual'; size: number; createdAt: string }[] }
const KIND = { nightly: 'Nightly', upgrade: 'Before an upgrade', manual: 'Made by hand' } as const;

/** Server admin: the automatic database backups, with a download link for each. */
function AdminBackups() {
  const { toast } = useApp();
  const [data, reload] = useLoad<Backups>('/api/admin/backups');
  if (!data) return null;
  const now = async () => { await api('/api/admin/backups', { method: 'POST', body: {} }); await reload(); toast('Backup made'); };
  return (
    <div className="stack">
      <h2>Backups</h2>
      <p className="small muted" style={{ margin: 0 }}>
        The database is copied every night (last 7 kept) and before every upgrade (last 3 kept), into <code>{data.dir}</code>.
        Photos live in the <code>uploads</code> folder next to it; back that up with the rest of your data folder.
        To restore, stop the server, replace <code>nighttime-ninja.db</code> with a backup, and start it again.
      </p>
      <div className="row"><button onClick={now}>Back up now</button></div>
      {data.backups.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No backups yet. The first nightly one is made a minute after the server starts.</p> : (
        <ul className="plain stack" style={{ gap: 4 }}>
          {data.backups.map((b) => (
            <li key={b.name} className="row small" style={{ justifyContent: 'space-between' }}>
              <span>{new Date(b.createdAt).toLocaleString()} <span className="muted">· {KIND[b.kind]} · {(b.size / 1048576).toFixed(1)} MB</span></span>
              <a href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download>Download</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
