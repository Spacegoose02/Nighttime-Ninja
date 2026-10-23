import { useMemo, useState } from 'react';
import { api, type HomeDetail, type ShoppingItem } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { amount } from '../format.ts';
import { CATEGORIES, guessItem } from '../../../shared/catalog.ts';

interface Suggestion { name: string; category: string; timesBought: number }

export function Shopping() {
  const { base, me, toast } = useApp();
  const [items, reload] = useLoad<ShoppingItem[]>(`${base}/shopping`);
  const [home] = useLoad<HomeDetail>(base);
  const order = home?.settings.categories ?? [...CATEGORIES];
  const [suggestions, reloadSugg] = useLoad<Suggestion[]>(`${base}/shopping/suggestions`);
  const [tab, setTab] = useState<'list' | 'history'>('list');
  const [history] = useLoad<ShoppingItem[]>(tab === 'history' ? `${base}/shopping/history` : null, [tab]);
  const [text, setText] = useState('');
  const [stock, setStock] = useState(true);

  const refresh = () => Promise.all([reload(), reloadSugg()]);

  async function add(t: string) {
    if (!t.trim()) return;
    await api(`${base}/shopping`, { body: { text: t } });
    setText('');
    await refresh();
  }

  async function toggle(i: ShoppingItem) {
    await api(`${base}/shopping/${i.id}`, { method: 'PATCH', body: { checked: !i.checked, addToInventory: stock } });
    await refresh();
  }

  const groups = useMemo(() => {
    const open = (items ?? []).filter((i) => !i.checked);
    const m = new Map<string, ShoppingItem[]>();
    for (const i of open) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    const pos = (c: string) => { const i = order.findIndex((x) => x.toLowerCase() === c.toLowerCase()); return i < 0 ? 999 : i; };
    return [...m.entries()].sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, home]);
  const checked = (items ?? []).filter((i) => i.checked);

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="topbar">
        <h1>Shopping</h1>
        <div className="chips">
          <button className={`chip${tab === 'list' ? ' on' : ''}`} onClick={() => setTab('list')}>List</button>
          <button className={`chip${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>History</button>
        </div>
      </div>

      {tab === 'list' ? (
        <>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void add(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Quick add: “2 lb chicken, milk, 3 avocados”" style={{ flex: 1 }} />
            <button className="primary" disabled={!text.trim()}>Add</button>
          </form>
          {!!suggestions?.length && (
            <div className="stack">
              <span className="small muted">Tap to add again</span>
              <div className="chips">
                {suggestions.slice(0, 24).map((s) => (
                  <button key={s.name} className="chip" onClick={() => add(s.name)}>{guessItem(s.name).icon} {s.name}</button>
                ))}
              </div>
            </div>
          )}
          <label className="row small muted" style={{ gap: 8 }}>
            <input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} style={{ width: 22, minHeight: 22 }} />
            Put checked-off items in the pantry
          </label>
          {items && !groups.length && <div className="card">The list is empty. Nice work, ninja. 🦝</div>}
          {groups.map(([cat, list]) => (
            <div key={cat} className="card">
              <h2>{cat}</h2>
              <div className="list">
                {list.map((i) => (
                  <div key={i.id} className="list-item">
                    <button className="check" onClick={() => toggle(i)} aria-label={`Check off ${i.name}`} />
                    <span style={{ fontSize: '1.5rem' }} aria-hidden>{guessItem(i.name).icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{i.quantity != null && <span>{amount(i.quantity, i.unit, me?.user.units)} </span>}{i.name}</div>
                      {(i.note || i.addedBy) && <div className="small muted">{[i.note, i.addedBy && `added by ${i.addedBy}`].filter(Boolean).join(' · ')}</div>}
                    </div>
                    <button className="ghost icon" aria-label="Remove" onClick={async () => { await api(`${base}/shopping/${i.id}`, { method: 'DELETE' }); await reload(); }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!!checked.length && (
            <div className="card">
              <div className="row">
                <h2 style={{ flex: 1, margin: 0 }}>In the cart</h2>
                <button onClick={async () => { await api(`${base}/shopping/clear-checked`, { body: {} }); await reload(); toast('Cleared'); }}>Clear</button>
              </div>
              <div className="list">
                {checked.map((i) => (
                  <div key={i.id} className="list-item">
                    <button className="check on" onClick={() => toggle(i)} aria-label={`Uncheck ${i.name}`}>✓</button>
                    <span className="done">{i.quantity != null && `${amount(i.quantity, i.unit, me?.user.units)} `}{i.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <table>
            <thead><tr><th>Bought</th><th>Item</th><th>Amount</th></tr></thead>
            <tbody>
              {history?.map((h) => (
                <tr key={h.id}>
                  <td className="small muted">{h.checkedAt && new Date(`${h.checkedAt.replace(' ', 'T')}Z`).toLocaleDateString()}</td>
                  <td>{h.name}</td>
                  <td>{amount(h.quantity, h.unit, me?.user.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history && !history.length && <p className="muted">Nothing bought yet.</p>}
        </div>
      )}
    </div>
  );
}
