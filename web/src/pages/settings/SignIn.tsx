// Settings → Sign-in (admins): who can make an account, quick sign-in, and single sign-on with Tinyauth or another
// OpenID Connect provider. The client secret goes to the server and is never shown again.
import { useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { useDialogs } from '../../components/Dialog.tsx';
import { AdminSignIn } from '../Security.tsx';

interface Provider {
  id: string; kind: 'tinyauth' | 'generic'; name: string; issuer: string; clientId: string; hasSecret: boolean;
  scopes: string; autoCreate: boolean; showOnLogin: boolean; redirectUri: string;
}
interface SsoData { publicUrl: string; providers: Provider[] }

/** What the redirect address will be once saved (the server makes the id the same way). */
const slug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'sso';

function Copyable({ label, value }: { label: string; value: string }) {
  const { toast } = useApp();
  return (
    <div className="row">
      <input readOnly aria-label={label} value={value} onFocus={(e) => e.target.select()} style={{ flex: 1, fontFamily: 'var(--mono, monospace)' }} />
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(value); toast('Copied'); }}>Copy</button>
    </div>
  );
}

function ProviderForm({ kind, existing, onDone, onCancel, onName }: { kind: Provider['kind']; existing?: Provider; onDone: () => void; onCancel?: () => void; onName?: (name: string) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({
    name: existing?.name ?? (kind === 'tinyauth' ? 'Tinyauth' : ''),
    issuer: existing?.issuer ?? '',
    clientId: existing?.clientId ?? '',
    clientSecret: '',
    scopes: existing?.scopes ?? '',
    autoCreate: existing?.autoCreate ?? false,
    showOnLogin: existing?.showOnLogin ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ready = f.name.trim() && f.issuer.trim() && f.clientId.trim() && (existing || f.clientSecret.trim());
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        if (existing) await api(`/api/admin/sso/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: f });
        else await api('/api/admin/sso', { body: { ...f, kind } });
        toast('Saved');
        onDone();
      } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
    }}>
      <label className="field">Name on the sign-in button
        <input value={f.name} onChange={(e) => { set('name')(e); onName?.(e.target.value); }} placeholder={kind === 'tinyauth' ? 'Tinyauth' : 'e.g. Pocket ID'} required />
      </label>
      <label className="field">{kind === 'tinyauth' ? 'Tinyauth address (issuer URL)' : 'Issuer URL'}
        <input value={f.issuer} onChange={set('issuer')} placeholder="https://auth.example.com" inputMode="url" autoCapitalize="none" required />
      </label>
      <label className="field">Client ID
        <input value={f.clientId} onChange={set('clientId')} autoCapitalize="none" autoComplete="off" spellCheck={false} required />
      </label>
      <label className="field">Client secret
        <input type="password" value={f.clientSecret} onChange={set('clientSecret')} autoComplete="new-password" spellCheck={false}
          placeholder={existing?.hasSecret ? 'Saved; leave empty to keep it' : ''} required={!existing} />
      </label>
      {kind === 'generic' && (
        <label className="field">Extra scopes (optional)
          <input value={f.scopes} onChange={set('scopes')} placeholder="openid, profile and email are always asked for" autoCapitalize="none" />
        </label>
      )}
      <label className="row small" style={{ gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={f.autoCreate} onChange={(e) => setF({ ...f, autoCreate: e.target.checked })} style={{ width: 22, minHeight: 22 }} />
        Make an account for anyone who signs in with it, and link accounts with the same verified email
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        Only turn this on for a provider that only lets in people you trust, like your own Tinyauth. Left off, people link their
        account first (Settings → Sign-in and security), or you link them under Users, and new people still need a home's join code.
      </p>
      <label className="row small" style={{ gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={f.showOnLogin} onChange={(e) => setF({ ...f, showOnLogin: e.target.checked })} style={{ width: 22, minHeight: 22 }} />
        Show a button for it on the sign-in page
      </label>
      <div className="row">
        <span className="spacer" />
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button className="primary" disabled={busy || !ready}>{existing ? 'Save' : kind === 'tinyauth' ? 'Turn on Tinyauth sign-in' : 'Add'}</button>
      </div>
    </form>
  );
}

function ProviderSummary({ p, reload }: { p: Provider; reload: () => Promise<void> }) {
  const { toast } = useApp();
  const dialogs = useDialogs();
  const [editing, setEditing] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);
  if (editing) return <ProviderForm kind={p.kind} existing={p} onDone={() => { setEditing(false); void reload(); }} onCancel={() => setEditing(false)} />;
  const remove = async () => {
    if (!(await dialogs.confirm(`Remove ${p.name} sign-in? People linked to it will need another way in.`, { okLabel: 'Remove', danger: true }))) return;
    try {
      await api(`/api/admin/sso/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    } catch (err) {
      if (!(await dialogs.confirm(`${(err as Error).message}\n\nRemove it anyway?`, { okLabel: 'Remove anyway', danger: true }))) return;
      await api(`/api/admin/sso/${encodeURIComponent(p.id)}?force=1`, { method: 'DELETE' });
    }
    toast('Removed');
    await reload();
  };
  return (
    <div className="stack">
      <div className="row">
        <strong style={{ flex: 1 }}>{p.name} <span className="pill ok">on</span></strong>
        <button className="ghost" onClick={async () => setCheck(await api(`/api/admin/sso/${encodeURIComponent(p.id)}/test`, { body: {} }))}>Test connection</button>
        <button onClick={() => setEditing(true)}>Edit</button>
        <button className="ghost danger" onClick={remove}>Remove</button>
      </div>
      {check && <p className="small" style={{ margin: 0, color: check.ok ? 'var(--ok)' : 'var(--danger)' }}>{check.ok ? `✓ ${p.issuer} answered.` : `✗ ${check.error}`}</p>}
      <p className="small muted" style={{ margin: 0 }}>
        {p.issuer} · client {p.clientId} · {p.autoCreate ? 'makes accounts for new people' : 'linked accounts only'} · {p.showOnLogin ? 'button on the sign-in page' : 'no sign-in button'}
      </p>
      <span className="small">Redirect URI to register at {p.kind === 'tinyauth' ? 'Tinyauth' : 'the provider'}:</span>
      <Copyable label="Redirect URI" value={p.redirectUri} />
    </div>
  );
}

/** The Tinyauth setup area: what to put in Tinyauth, then the client details here. */
function Tinyauth({ data, reload }: { data: SsoData; reload: () => Promise<void> }) {
  const existing = data.providers.find((p) => p.kind === 'tinyauth');
  const [client, setClient] = useState('nighttime-ninja');
  const redirect = existing?.redirectUri ?? `${data.publicUrl}/api/auth/sso/tinyauth/callback`;
  const envName = `TINYAUTH_OIDC_CLIENTS_${client.trim().toUpperCase() || 'NIGHTTIME-NINJA'}_TRUSTEDREDIRECTURIS`;
  const localOnly = /^http:\/\/(localhost|127\.)/.test(data.publicUrl);
  return (
    <div className="card stack">
      <h2>Tinyauth</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Let people sign in with your Tinyauth account instead of a password. This uses Tinyauth's OpenID Connect server
        (Tinyauth v4 or newer), so it works on any device, the apps included, without putting Tinyauth in front of the whole site.
      </p>
      {localOnly && (
        <p className="small" style={{ margin: 0, color: 'var(--danger)' }}>
          This server's public address is {data.publicUrl}. Set <code>PUBLIC_URL</code> to the address people really use (for example https://kitchen.example.com) and restart first, because the redirect address is built from it.
        </p>
      )}
      {existing ? <ProviderSummary p={existing} reload={reload} /> : (
        <>
          <h3>1. In Tinyauth</h3>
          <p className="small muted" style={{ margin: 0 }}>Create an OIDC client (for example named nighttime-ninja) and give it this redirect address, then restart Tinyauth.</p>
          <label className="field">Tinyauth client name
            <input value={client} onChange={(e) => setClient(e.target.value)} autoCapitalize="none" spellCheck={false} />
          </label>
          <Copyable label="Redirect URI" value={redirect} />
          <span className="small muted">As an environment variable on the Tinyauth container:</span>
          <Copyable label="Tinyauth environment variable" value={`${envName}=${redirect}`} />
          <h3>2. Here</h3>
          <p className="small muted" style={{ margin: 0 }}>Paste the address of your Tinyauth and the client ID and secret Tinyauth gave you. The secret is stored encrypted and never shown again.</p>
          <ProviderForm kind="tinyauth" onDone={() => void reload()} />
        </>
      )}
      {existing && (
        <p className="small muted" style={{ margin: 0 }}>
          People link their own account under Settings → Sign-in and security. You can link anyone by their Tinyauth username under Settings → Users → Linked sign-in.
        </p>
      )}
    </div>
  );
}

function OtherProviders({ data, reload }: { data: SsoData; reload: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const others = data.providers.filter((p) => p.kind === 'generic');
  return (
    <div className="card stack">
      <h2>Other single sign-on</h2>
      <p className="small muted" style={{ margin: 0 }}>Any OpenID Connect provider works the same way: Authelia, Authentik, Pocket ID, Keycloak, Zitadel…</p>
      {others.map((p) => <ProviderSummary key={p.id} p={p} reload={reload} />)}
      {adding ? (
        <div className="stack">
          <span className="small">Redirect URI to register at the provider:</span>
          <Copyable label="Redirect URI for the new provider" value={`${data.publicUrl}/api/auth/sso/${slug(name || 'sso')}/callback`} />
          <ProviderForm kind="generic" onName={setName} onDone={() => { setAdding(false); setName(''); void reload(); }} onCancel={() => setAdding(false)} />
        </div>
      ) : <button style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>＋ Add a provider</button>}
    </div>
  );
}

/** Settings → Sign-in. */
export function SignInSettings() {
  const [data, reload] = useLoad<SsoData>('/api/admin/sso');
  return (
    <>
      <div className="card stack"><AdminSignIn /></div>
      {data && <Tinyauth data={data} reload={reload} />}
      {data && <OtherProviders data={data} reload={reload} />}
    </>
  );
}
