// Stock-take from photos: snap the fridge, freezer or a cupboard, check the list the AI read, and update the pantry.
import { useState } from 'react';
import { api, fileToDataUrl } from '../api.ts';
import { useApp } from '../state.tsx';
import { Modal } from './Dialog.tsx';

interface Seen {
  name: string; quantity: number | null; unit: string | null; location: string;
  match: { id: string; name: string; quantity: number; unit: string | null } | null;
}
interface Row extends Seen { keep: boolean; count: string }

export function StockTake({ onClose }: { onClose: (changed: boolean) => void }) {
  const { base, toast } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(files: File[]) {
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      const images = await Promise.all(files.slice(0, 4).map((f) => fileToDataUrl(f, 1600)));
      const { items } = await api<{ items: Seen[] }>(`${base}/pantry/photo/read`, { body: { images } });
      setRows(items.map((i) => ({ ...i, keep: true, count: String(i.quantity ?? i.match?.quantity ?? 1) })));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function apply() {
    if (!rows) return;
    setBusy(true);
    try {
      const items = rows.filter((r) => r.keep).map((r) => ({ name: r.name, quantity: Number(r.count) || 1, unit: r.unit, location: r.location, itemId: r.match?.id }));
      const out = await api<{ added: number; updated: number }>(`${base}/pantry/photo/apply`, { body: { items } });
      toast(`Added ${out.added} and updated ${out.updated} in the pantry`);
      onClose(true);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal label="Stock-take from photos" onClose={() => onClose(false)}>
      <h2>📸 Stock-take</h2>
      {!rows && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Open the fridge, freezer or a cupboard and take up to 4 photos. You'll check the list before anything changes.</p>
          <input type="file" accept="image/*" multiple capture="environment" aria-label="Photos of the fridge, freezer or cupboard" disabled={busy}
            onChange={(e) => void read([...(e.target.files ?? [])])} />
        </>
      )}
      {busy && <p>Looking…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {rows && (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>New things are added. For things already in the pantry, the count is set to what you enter.</p>
          {rows.map((r, i) => (
            <div key={`${r.name}-${i}`} className="row">
              <input type="checkbox" checked={r.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={`Include ${r.name}`} style={{ width: 22, minHeight: 22 }} />
              <span style={{ flex: 1 }}>
                {r.name} <span className="small muted">{r.location}{r.match ? ` · you have ${r.match.quantity}${r.match.unit ? ` ${r.match.unit}` : ''}` : ' · new'}</span>
              </span>
              <input inputMode="decimal" value={r.count} onChange={(e) => set(i, { count: e.target.value })} aria-label={`How many ${r.name}`} style={{ width: 70 }} />
            </div>
          ))}
          <div className="row">
            <span className="spacer" />
            <button onClick={() => onClose(false)}>Cancel</button>
            <button className="primary" disabled={busy || !rows.some((r) => r.keep)} onClick={() => void apply()}>Update the pantry</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
