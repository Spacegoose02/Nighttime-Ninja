import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';

interface PushInfo { publicKey: string; prefs: { expiring: boolean; plan: boolean; list: boolean }; devices: number }

const KINDS = [
  { key: 'expiring', label: 'Food about to expire', when: 'mornings' },
  { key: 'plan', label: "Tomorrow's meals", when: 'late afternoon, so there\'s time to thaw' },
  { key: 'list', label: 'Things others add to the shopping list', when: 'as it happens' },
] as const;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string): Uint8Array {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '='));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Turn reminders on for this phone or computer, and pick which ones. */
export function Reminders() {
  const { toast } = useApp();
  const [info, reload, , setInfo] = useLoad<PushInfo>('/api/push');
  const [here, setHere] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (supported()) void currentSubscription().then((s) => setHere(!!s)); else setHere(false); }, []);

  async function turnOn() {
    if (!info) return;
    setBusy(true);
    try {
      if (await Notification.requestPermission() !== 'granted') { toast('Notifications are blocked for this site. Allow them in your browser settings.'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) as BufferSource });
      const json = sub.toJSON();
      await api('/api/push/subscribe', { body: { endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth } });
      setHere(true);
      await reload();
      toast('Reminders are on for this device');
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const sub = await currentSubscription();
      if (sub) { await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      setHere(false);
      await reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  async function setPref(key: keyof PushInfo['prefs'], on: boolean) {
    if (!info) return;
    setInfo((cur) => cur && { ...cur, prefs: { ...cur.prefs, [key]: on } });
    try { await api('/api/push/prefs', { method: 'PUT', body: { [key]: on } }); } catch (e) { toast((e as Error).message); await reload(); }
  }

  return (
    <div className="card stack">
      <h2>🔔 Reminders</h2>
      {!supported() ? (
        <p className="muted" style={{ margin: 0 }}>
          This browser can't show reminders. They work in Chrome, Edge, Firefox and Safari, and on iPhone once the app is added to the Home Screen. The Android app can't get them yet; open the site in Chrome instead.
        </p>
      ) : (
        <>
          <div className="row">
            <span style={{ flex: 1 }}>
              {here ? 'On for this device.' : 'Off on this device.'}
              {!!info?.devices && <span className="small muted"> {info.devices} device{info.devices === 1 ? '' : 's'} in all.</span>}
            </span>
            {here && <button className="ghost" disabled={busy} onClick={async () => { try { await api('/api/push/test', { body: {} }); } catch (e) { toast((e as Error).message); } }}>Send a test</button>}
            {here ? <button disabled={busy} onClick={turnOff}>Turn off</button> : <button className="primary" disabled={busy || !info} onClick={turnOn}>Turn on</button>}
          </div>
          {info && (
            <div className="list">
              {KINDS.map((k) => (
                <label key={k.key} className="list-item" style={{ gap: 12 }}>
                  <input type="checkbox" checked={info.prefs[k.key]} onChange={(e) => setPref(k.key, e.target.checked)} style={{ width: 22, minHeight: 22 }} />
                  <span style={{ flex: 1 }}>{k.label} <span className="small muted">· {k.when}</span></span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
