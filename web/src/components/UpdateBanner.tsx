import { useApp, useLoad } from '../state.tsx';

export interface VersionInfo { current: string; latest: string | null; updateAvailable: boolean; releaseUrl: string; notes: string; apk: string | null; exe: string | null }

/** Shown to server admins when GitHub has a newer release than this server is running. */
export function UpdateBanner() {
  const { me } = useApp();
  const [v] = useLoad<VersionInfo>(me?.user.isAdmin ? '/api/version' : null);
  if (!v?.updateAvailable) return null;
  return (
    <div className="card row" style={{ borderColor: 'var(--primary)', borderWidth: 2 }}>
      <span style={{ fontSize: '1.6rem' }} aria-hidden>🆕</span>
      <div style={{ flex: 1 }}>
        <strong>Nighttime Ninja {v.latest} is out</strong>
        <div className="small muted">This server runs {v.current}. On Unraid, open the Docker tab and choose Force Update (or Check for Updates) on the container.</div>
      </div>
      <a className="btn" href={v.releaseUrl} target="_blank" rel="noreferrer">What's new</a>
    </div>
  );
}

/** Version details for Settings, for everyone. */
export function VersionCard() {
  const [v] = useLoad<VersionInfo>('/api/version');
  if (!v) return null;
  return (
    <div className="card stack">
      <h2>Updates</h2>
      <p style={{ margin: 0 }}>
        This server runs <strong>{v.current}</strong>.{' '}
        {v.latest == null ? <span className="muted">Couldn't check GitHub for updates right now.</span>
          : v.updateAvailable ? <span><strong>{v.latest}</strong> is available.</span>
          : <span className="pill ok">Up to date</span>}
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        The phone, tablet and desktop apps load everything from this server, so updating the server updates them too.
        The Windows app also updates itself, and the Android app offers new versions when it starts.
        To update the server automatically, run Watchtower or turn on auto-update for this container in Unraid's CA Auto Update plugin.
      </p>
      <div className="row">
        <a className="btn" href={v.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>
        {v.apk && <a className="btn" href={v.apk} target="_blank" rel="noreferrer">Download Android app</a>}
        {v.exe && <a className="btn" href={v.exe} target="_blank" rel="noreferrer">Download Windows app</a>}
      </div>
    </div>
  );
}
