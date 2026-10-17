import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fileToDataUrl, type Item } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { amount } from '../format.ts';
import { CATEGORIES, LOCATIONS, guessItem } from '../../../shared/catalog.ts';

interface HistoryRow { id: number; itemName: string; delta: number; unit: string | null; quantityAfter: number | null; reason: string; createdAt: string; userName: string | null }

function ItemArt({ item }: { item: Pick<Item, 'photo' | 'icon' | 'name'> }) {
  return <div className="art">{item.photo ? <img src={item.photo} alt="" /> : (item.icon ?? guessItem(item.name).icon)}</div>;
}

function ItemEditor({ item, onClose }: { item: Item | null; onClose: (changed: boolean) => void }) {
  const { base, toast, me } = useApp();
  const [f, setF] = useState(() => ({
    name: item?.name ?? '', quantity: String(item?.quantity ?? 1), unit: item?.unit ?? '', category: item?.category ?? '',
    location: item?.location ?? 'Pantry', lowThreshold: item?.lowThreshold == null ? '' : String(item.lowThreshold),
    expiresOn: item?.expiresOn ?? '', icon: item?.icon ?? '', photo: item?.photo ?? '',
  }));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save() {
    const body = {
      ...f, quantity: Number(f.quantity) || 0, lowThreshold: f.lowThreshold === '' ? null : Number(f.lowThreshold),
      category: f.category || undefined, icon: f.icon || undefined, photo: f.photo || null, expiresOn: f.expiresOn || null, unit: f.unit || null,
    };
    if (item) await api(`${base}/items/${item.id}`, { method: 'PATCH', body });
    else await api(`${base}/items`, { body });
    onClose(true);
  }

  async function bump(delta: number) {
    if (!item) { setF({ ...f, quantity: String(Math.max(0, (Number(f.quantity) || 0) + delta)) }); return; }
    const updated = await api<Item>(`${base}/items/${item.id}/adjust`, { body: { delta } });
    setF({ ...f, quantity: String(updated.quantity) });
  }

  async function photo(file: File | undefined) {
    if (!file) return;
    const { url } = await api<{ url: string }>(`${base}/uploads`, { body: { dataUrl: await fileToDataUrl(file, 600) } });
    setF({ ...f, photo: url });
  }

  return (
    <div className="modal-back" onClick={() => onClose(false)}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <div className="tile" style={{ minHeight: 0, width: 96, cursor: 'default' }}><ItemArt item={{ ...f, name: f.name }} /></div>
          <h2 style={{ flex: 1 }}>{item ? item.name : 'Add to pantry'}</h2>
        </div>
        <label className="field">Name<input value={f.name} onChange={set('name')} autoFocus={!item} /></label>
        <div className="row">
          <button className="icon" onClick={() => bump(-1)} aria-label="One less">−</button>
          <label className="field" style={{ flex: 1 }}>Amount<input inputMode="decimal" value={f.quantity} onChange={set('quantity')} /></label>
          <label className="field" style={{ flex: 1 }}>Unit<input value={f.unit} onChange={set('unit')} placeholder="each, lb, cup…" /></label>
          <button className="icon" onClick={() => bump(1)} aria-label="One more">+</button>
        </div>
        {item && <p className="small muted" style={{ margin: 0 }}>Shown as {amount(Number(f.quantity), f.unit, me?.user.units)}</p>}
        <div className="row">
          <label className="field" style={{ flex: 1 }}>Where
            <select value={f.location} onChange={set('location')}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select>
          </label>
          <label className="field" style={{ flex: 1 }}>Category
            <select value={f.category} onChange={set('category')}>
              <option value="">Guess for me</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>Warn me when at or below<input inputMode="decimal" value={f.lowThreshold} onChange={set('lowThreshold')} placeholder="e.g. 1" /></label>
          <label className="field" style={{ flex: 1 }}>Expires<input type="date" value={f.expiresOn} onChange={set('expiresOn')} /></label>
        </div>
        <div className="row">
          <label className="field" style={{ width: 110 }}>Icon<input value={f.icon} onChange={set('icon')} placeholder={guessItem(f.name).icon} /></label>
          <label className="field" style={{ flex: 1 }}>Photo<input type="file" accept="image/*" capture="environment" onChange={(e) => photo(e.target.files?.[0])} /></label>
          {f.photo && <button className="ghost" onClick={() => setF({ ...f, photo: '' })}>Remove photo</button>}
        </div>
        <div className="row">
          {item && <button className="danger" onClick={async () => { await api(`${base}/items/${item.id}`, { method: 'DELETE' }); onClose(true); }}>Delete</button>}
          {item && <button onClick={async () => { await api(`${base}/items/${item.id}/to-shopping`, { body: {} }); toast(`${item.name} added to the shopping list`); }}>🛒 Add to list</button>}
          <span className="spacer" />
          <button onClick={() => onClose(false)}>Cancel</button>
          <button className="primary" onClick={save} disabled={!f.name.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}

export function Inventory() {
  const { base, me } = useApp();
  const [params, setParams] = useSearchParams();
  const [items, reload] = useLoad<Item[]>(`${base}/items`);
  const [tab, setTab] = useState<'items' | 'history'>('items');
  const [history, reloadHistory] = useLoad<HistoryRow[]>(tab === 'history' ? `${base}/history?limit=200` : null);
  const [q, setQ] = useState('');
  const [loc, setLoc] = useState('All');
  const [editing, setEditing] = useState<Item | null | 'new'>(null);
  const lowOnly = params.get('low') === '1';

  const shown = useMemo(() => (items ?? []).filter((i) =>
    (!q || i.name.toLowerCase().includes(q.toLowerCase())) && (loc === 'All' || i.location === loc) && (!lowOnly || i.isLow)), [items, q, loc, lowOnly]);
  const byCategory = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of shown) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()].sort(([a], [b]) => CATEGORIES.indexOf(a as never) - CATEGORIES.indexOf(b as never));
  }, [shown]);
  const locations = ['All', ...LOCATIONS.filter((l) => items?.some((i) => i.location === l))];

  return (
    <div className="stack">
      <div className="topbar">
        <h1>Pantry</h1>
        <div className="chips">
          <button className={`chip${tab === 'items' ? ' on' : ''}`} onClick={() => setTab('items')}>Items</button>
          <button className={`chip${tab === 'history' ? ' on' : ''}`} onClick={() => { setTab('history'); void reloadHistory(); }}>History</button>
        </div>
        <button className="primary" onClick={() => setEditing('new')}>＋ Add item</button>
      </div>

      {tab === 'items' ? (
        <>
          <div className="row">
            <input placeholder="Search the pantry" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} />
            <button className={`chip${lowOnly ? ' on' : ''}`} onClick={() => setParams(lowOnly ? {} : { low: '1' })}>⚠️ Running low</button>
          </div>
          <div className="chips">
            {locations.map((l) => <button key={l} className={`chip${loc === l ? ' on' : ''}`} onClick={() => setLoc(l)}>{l}</button>)}
          </div>
          {items && !items.length && <div className="card">Your pantry is empty. Add items, check things off your shopping list, or import from KitchenOwl in Recipes → Import.</div>}
          {byCategory.map(([cat, list]) => (
            <section key={cat} className="stack">
              <h2 style={{ marginTop: 8 }}>{cat}</h2>
              <div className="tiles">
                {list.map((i) => (
                  <button key={i.id} className={`tile${i.quantity <= 0 ? ' empty' : i.isLow ? ' low' : ''}`} onClick={() => setEditing(i)}>
                    {i.isLow && <span className="badge">LOW</span>}
                    <ItemArt item={i} />
                    <span className="name">{i.name}</span>
                    <span className="qty">{amount(i.quantity, i.unit, me?.user.units)} · {i.location}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </>
      ) : (
        <div className="card">
          <table>
            <thead><tr><th>When</th><th>Item</th><th>Change</th><th>Why</th><th>Who</th></tr></thead>
            <tbody>
              {history?.map((h) => (
                <tr key={h.id}>
                  <td className="small muted">{new Date(`${h.createdAt.replace(' ', 'T')}Z`).toLocaleString()}</td>
                  <td>{h.itemName}</td>
                  <td style={{ color: h.delta < 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 600 }}>{h.delta > 0 ? '+' : ''}{amount(h.delta, h.unit, me?.user.units)}</td>
                  <td>{h.reason}</td>
                  <td className="muted">{h.userName ?? 'Automation'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history && !history.length && <p className="muted">No changes yet.</p>}
        </div>
      )}

      {editing && <ItemEditor item={editing === 'new' ? null : editing} onClose={(changed) => { setEditing(null); if (changed) void reload(); }} />}
    </div>
  );
}
