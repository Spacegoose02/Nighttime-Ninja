// Settings → Server admin: who has an account, which homes exist, and which Claude model the AI helpers use.
import { useDialogs } from '../../components/Dialog.tsx';
import { api } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { AdminSignIn, AdminUserActions } from '../Security.tsx';

interface Overview {
  users: { id: string; name: string; username: string | null; email: string | null; is_admin: number; disabled: number; totp_enabled: number; has_password: number; has_google: number; passkeys: number; homes: number }[];
  homes: { id: string; name: string; members: number; recipes: number }[];
}

export function Admin() {
  const { me, toast } = useApp();
  const dialogs = useDialogs();
  const [data, reload] = useLoad<Overview>('/api/admin/overview');
  if (!data) return null;
  return (
    <div className="card stack">
      <h2>Server admin</h2>
      <AdminSignIn />
      <AdminMixologist />
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
                  <button className="ghost danger" onClick={async () => { if (await dialogs.confirm(`Delete ${u.name}'s account?`, { okLabel: 'Delete', danger: true })) { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); await reload(); toast('Deleted'); } }}>Delete</button>
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

/** Server admin: which Claude model the Mixologist uses. */
function AdminMixologist() {
  const { toast } = useApp();
  const [s, reload] = useLoad<{ available: boolean; model: string | null; envModel: string | null; choices: { id: string; label: string; blurb: string }[] }>('/api/admin/mixologist');
  if (!s) return null;
  const choices = s.envModel && !s.choices.some((c) => c.id === s.envModel)
    ? [...s.choices, { id: s.envModel, label: s.envModel, blurb: 'From ANTHROPIC_MODEL' }]
    : s.choices;
  const pick = async (model: string) => { await api('/api/admin/mixologist', { method: 'PATCH', body: { model } }); await reload(); toast('Saved'); };
  return (
    <div className="stack">
      <h3>🍸 Mixologist model</h3>
      {s.available ? (
        <div className="chips">
          {choices.map((c) => (
            <button key={c.id} className={`chip${s.model === c.id ? ' on' : ''}`} title={c.id} onClick={() => pick(c.id)}>{c.label} · {c.blurb}</button>
          ))}
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Add <code>ANTHROPIC_API_KEY</code> to the server and restart to turn on the Mixologist, then pick a model here.</p>
      )}
    </div>
  );
}
