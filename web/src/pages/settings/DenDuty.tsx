// Settings → Home → Den Duty: link the family's chore app so Little helpers jobs on a recipe can be sent to a kid
// as a one-off chore. Home managers link it; everyone in the home can then use the "Ask … to help" buttons.
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';

interface Link { linked: boolean; url: string; denHomeId: string; denHomeName: string | null; points: number }

export function DenDuty() {
  const { base, home, toast } = useApp();
  const [link, reload] = useLoad<Link>(`${base}/denduty`);
  const [url, setUrl] = useState('');
  const [denHomeId, setDenHomeId] = useState('');
  const [token, setToken] = useState('');
  const [points, setPoints] = useState('5');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!link) return;
    setUrl(link.url);
    setDenHomeId(link.denHomeId);
    setPoints(String(link.points));
  }, [link]);
  if (!link) return null;
  const isManager = home?.role === 'manager';
  const save = async (body: object, done: string) => {
    setBusy(true);
    try {
      await api(`${base}/denduty`, { method: 'PUT', body });
      setToken('');
      toast(done);
      await reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack">
      <h2>Den Duty</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Link your Den Duty chore app and each Little helpers job on a recipe gets an “Ask … to help” button. It sends the job to that kid
        as a one-off chore for today, worth the points you pick here.
      </p>
      {link.linked && (
        <p style={{ margin: 0 }}>✅ Linked to {link.denHomeName ? <strong>{link.denHomeName}</strong> : 'Den Duty'} at {link.url}</p>
      )}
      {isManager ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          void save({ url, denHomeId, token: token || undefined, points: Number(points) }, 'Den Duty linked');
        }}>
          <label className="field">Den Duty address
            <input type="url" required placeholder="http://192.168.1.20:8090" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="field">Den Duty home id
            <input required value={denHomeId} onChange={(e) => setDenHomeId(e.target.value)} />
          </label>
          <label className="field">Control API token {link.linked && <span className="small muted">(leave empty to keep the saved one)</span>}
            <input type="password" autoComplete="off" placeholder="dnk_…" required={!link.linked} value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <label className="field">Points for a kitchen job
            <input type="number" min={0} max={10000} value={points} onChange={(e) => setPoints(e.target.value)} style={{ maxWidth: 140 }} />
          </label>
          <p className="small muted" style={{ margin: 0 }}>
            Make the token in Den Duty under Settings, Home Assistant and API tokens, as a control token (it creates chores). It's kept encrypted here.
          </p>
          <div className="row">
            <button className="primary" disabled={busy}>{busy ? 'Checking…' : link.linked ? 'Save' : 'Link Den Duty'}</button>
            {link.linked && <button type="button" className="ghost danger" disabled={busy} onClick={() => void save({ url: '' }, 'Den Duty unlinked')}>Unlink</button>}
          </div>
        </form>
      ) : !link.linked && <p className="small muted" style={{ margin: 0 }}>A home manager can link it.</p>}
    </div>
  );
}
