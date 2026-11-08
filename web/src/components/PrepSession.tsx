// Prep session: Gordy turns the planned meals into one batch-prep list, done in one go. Ticks are kept on this device.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../state.tsx';
import { Modal } from './Dialog.tsx';

interface Prep {
  intro: string; minutes: number; leaveForTheDay: string[];
  steps: { task: string; meals: string[]; minutes: number; store: string }[];
  meals: { date: string; title: string }[];
}

export function PrepSession({ start, onClose }: { start: string; onClose: () => void }) {
  const { base, homeId } = useApp();
  const key = `nn-prep-${homeId}-${start}`;
  const [prep, setPrep] = useState<Prep | null>(() => { try { return JSON.parse(localStorage.getItem(key) ?? 'null')?.prep ?? null; } catch { return null; } });
  const [done, setDone] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? 'null')?.done ?? []; } catch { return []; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prep) return;
    try { localStorage.setItem(key, JSON.stringify({ prep, done })); } catch { /* private mode */ }
  }, [key, prep, done]);

  async function make() {
    setBusy(true); setError(null);
    try {
      setPrep(await api<Prep>(`${base}/chef/prep-session`, { body: { start, days: 7 } }));
      setDone([]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal label="Prep session" onClose={onClose}>
      <h2>🔪 Prep session</h2>
      {!prep && !busy && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Gordy looks at this week's planned recipes and writes one list to work through now: chop once, cook grains and sauces ahead, and store each thing so weeknights are quick.</p>
          <button className="primary" onClick={() => void make()}>Make my prep list</button>
        </>
      )}
      {busy && <p>Gordy is reading the week's recipes…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {prep && !busy && (
        <div className="stack">
          <p style={{ margin: 0 }}>{prep.intro}{prep.minutes ? ` About ${prep.minutes} minutes hands-on.` : ''}</p>
          <ol className="stack" style={{ paddingLeft: 0, listStyle: 'none', margin: 0 }}>
            {prep.steps.map((s, i) => (
              <li key={`${i}-${s.task}`}>
                <label className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <input type="checkbox" checked={done.includes(i)} style={{ width: 22, minHeight: 22, marginTop: 2 }}
                    onChange={(e) => setDone((d) => (e.target.checked ? [...d, i] : d.filter((x) => x !== i)))} />
                  <span className={done.includes(i) ? 'done' : ''}>
                    <strong>{s.task}</strong>{s.minutes ? <span className="small muted"> · {s.minutes} min</span> : null}
                    <br /><span className="small muted">For {s.meals.join(', ') || 'the week'}. {s.store}</span>
                  </span>
                </label>
              </li>
            ))}
          </ol>
          {prep.leaveForTheDay.length > 0 && (
            <>
              <h3 style={{ margin: 0 }}>Leave for the day</h3>
              <ul className="small" style={{ margin: 0 }}>{prep.leaveForTheDay.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
          <div className="row">
            <span className="small muted" style={{ flex: 1 }}>{done.length} of {prep.steps.length} done</span>
            <button className="ghost" onClick={() => void make()}>Start over</button>
            <button className="primary" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
