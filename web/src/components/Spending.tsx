import { useState } from 'react';
import { api, fileToDataUrl } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

interface Week { week: string; total: number; items: number }
interface ItemCost { name: string; times: number; total: number; average: number; low: number; high: number }
interface Spend { weeks: Week[]; items: ItemCost[]; stores: { store: string; total: number }[] }

export const dollars = (n: number | null | undefined) => (n == null ? '' : `$${n.toFixed(2)}`);

/** Weekly grocery spending, what things cost, and where the money went. */
export function Spending() {
  const { base } = useApp();
  const [weeks, setWeeks] = useState(8);
  const [data] = useLoad<Spend>(`${base}/shopping/spending?weeks=${weeks}`, [weeks]);
  const top = Math.max(1, ...(data?.weeks ?? []).map((w) => w.total));
  const total = (data?.weeks ?? []).reduce((s, w) => s + w.total, 0);
  return (
    <div className="stack">
      <div className="row">
        <div className="chips" style={{ flex: 1 }}>
          {[4, 8, 26, 52].map((w) => <button key={w} className={`chip${weeks === w ? ' on' : ''}`} onClick={() => setWeeks(w)}>{w === 52 ? 'Year' : `${w} weeks`}</button>)}
        </div>
        {!!data?.weeks.length && <strong>{dollars(total)} total · {dollars(total / data.weeks.length)} a week</strong>}
      </div>
      {data && !data.weeks.length && (
        <div className="card">No prices yet. Type what you paid next to items in the cart, or scan a receipt, and your spending shows up here.</div>
      )}
      {!!data?.weeks.length && (
        <div className="card">
          <h2>By week</h2>
          <div className="spend-bars">
            {data.weeks.map((w) => (
              <div key={w.week} className="spend-bar" title={`${w.items} items`}>
                <span className="small">{dollars(w.total)}</span>
                <div style={{ height: `${Math.max(4, (w.total / top) * 140)}px` }} />
                <span className="small muted">{new Date(`${w.week}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!!data?.stores.length && (
        <div className="card">
          <h2>By store</h2>
          <table>
            <tbody>{data.stores.map((s) => <tr key={s.store}><td>{s.store}</td><td style={{ textAlign: 'right' }}>{dollars(s.total)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {!!data?.items.length && (
        <div className="card">
          <h2>What things cost</h2>
          <table>
            <thead><tr><th>Item</th><th>Bought</th><th>Usually</th><th>Range</th><th>Spent</th></tr></thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td><td>{i.times}×</td><td>{dollars(i.average)}</td>
                  <td className="small muted">{i.low === i.high ? '' : `${dollars(i.low)} to ${dollars(i.high)}`}</td>
                  <td>{dollars(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Line { name: string; quantity: number | null; unit: string | null; price: number | null; food: boolean; match: { id: string; name: string } | null }

/** Photo of a receipt: Gordy reads it, you check the matches, and the list gets ticked off with prices. */
export function ReceiptScan({ onDone }: { onDone: () => void }) {
  const { base, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState('');
  const [lines, setLines] = useState<(Line & { keep: boolean; toPantry: boolean })[] | null>(null);

  async function read(file: File) {
    setBusy(true); setError(null); setLines(null);
    try {
      const image = await fileToDataUrl(file, 2000);
      const res = await api<{ store: string | null; lines: Line[] }>(`${base}/shopping/receipt/read`, { body: { image } });
      setStore(res.store ?? '');
      setLines(res.lines.map((l) => ({ ...l, keep: true, toPantry: l.food })));
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function apply() {
    if (!lines) return;
    setBusy(true);
    try {
      const keep = lines.filter((l) => l.keep);
      const res = await api<{ checked: number; stocked: number }>(`${base}/shopping/receipt/apply`, {
        body: { store: store.trim() || undefined, lines: keep.map((l) => ({ name: l.name, quantity: l.quantity ?? undefined, unit: l.unit ?? undefined, price: l.price ?? undefined, shoppingId: l.match?.id, toPantry: l.toPantry })) },
      });
      toast(`Receipt added: ${res.checked} checked off the list${res.stocked ? `, ${res.stocked} more put in the pantry` : ''}`);
      setLines(null);
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const set = (n: number, patch: Partial<Line & { keep: boolean; toPantry: boolean }>) => setLines((cur) => cur?.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const sum = (lines ?? []).filter((l) => l.keep).reduce((s, l) => s + (l.price ?? 0), 0);

  return (
    <div className="card stack">
      <h2>🧾 Scan a receipt</h2>
      <p className="small muted" style={{ margin: 0 }}>Gordy reads it, checks off what was on the list, and remembers what everything cost.</p>
      <input type="file" accept="image/*" capture="environment" aria-label="Receipt photo" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
      {busy && !lines && <p>Reading the receipt…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {lines && (
        <>
          <label className="stack small">Store<input value={store} onChange={(e) => setStore(e.target.value)} placeholder="Where was this?" /></label>
          <table>
            <thead><tr><th>Keep</th><th>Item</th><th>Price</th><th>On the list</th><th>Pantry</th></tr></thead>
            <tbody>
              {lines.map((l, n) => (
                <tr key={`${l.name}-${n}`} className={l.keep ? '' : 'muted'}>
                  <td><input type="checkbox" checked={l.keep} onChange={(e) => set(n, { keep: e.target.checked })} aria-label={`Keep ${l.name}`} style={{ width: 22, minHeight: 22 }} /></td>
                  <td>{l.name}{l.quantity != null && <span className="small muted"> · {l.quantity}{l.unit ? ` ${l.unit}` : ''}</span>}</td>
                  <td><input type="number" step="0.01" min="0" value={l.price ?? ''} aria-label={`Price of ${l.name}`} style={{ width: 90 }}
                    onChange={(e) => set(n, { price: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                  <td className="small">{l.match ? `✓ ${l.match.name}` : <span className="muted">not on it</span>}</td>
                  <td><input type="checkbox" checked={l.toPantry} onChange={(e) => set(n, { toPantry: e.target.checked })} aria-label={`Put ${l.name} in the pantry`} style={{ width: 22, minHeight: 22 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <strong style={{ flex: 1 }}>{dollars(sum)}</strong>
            <button className="ghost" onClick={() => setLines(null)} disabled={busy}>Cancel</button>
            <button className="primary" onClick={apply} disabled={busy || !lines.some((l) => l.keep)}>Add {lines.filter((l) => l.keep).length} items</button>
          </div>
        </>
      )}
    </div>
  );
}
