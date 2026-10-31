import { useEffect, useMemo, useState } from 'react';
import { Modal, useDialogs } from '../components/Dialog.tsx';
import { api, type HomeDetail, type ShoppingItem, type ShoppingList } from '../api.ts';
import { rememberList } from '../components/ListPicker.tsx';
import { useApp, useLoad } from '../state.tsx';
import { useUrlState } from '../urlState.ts';
import { pending, sendOrQueue } from '../offline.ts';
import { amount } from '../format.ts';
import { CATEGORIES, guessItem } from '../../../shared/catalog.ts';
import { dollars, ReceiptScan, Spending } from '../components/Spending.tsx';

interface Suggestion { name: string; category: string; timesBought: number }
interface Layout { name: string; categories: string[] }

/** Set the order a store's aisles come in, so the list can be walked top to bottom. */
function LayoutEditor({ layout, all, onSave, onDelete, onClose }: {
  layout: Layout | null; all: string[]; onSave: (l: Layout) => void; onDelete: (() => void) | null; onClose: () => void;
}) {
  const [name, setName] = useState(layout?.name ?? '');
  const [cats, setCats] = useState(() => {
    const first = layout?.categories ?? [];
    return [...first, ...all.filter((c) => !first.some((f) => f.toLowerCase() === c.toLowerCase()))];
  });
  const move = (i: number, by: number) => setCats((c) => {
    const next = [...c];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, x);
    return next;
  });
  return (
    <Modal label="Store order" onClose={onClose}>
      <h2>{layout ? `Order for ${layout.name}` : 'New store order'}</h2>
      <label className="field">Store<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kroger on Main St" autoFocus={!layout} /></label>
      <p className="small muted" style={{ margin: 0 }}>Put the aisles in the order you walk them. The list will follow it.</p>
      <ol className="list layout-list">
        {cats.map((c, i) => (
          <li key={c} className="list-item">
            <span style={{ flex: 1 }}>{c}</span>
            <button className="ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c} up`}>↑</button>
            <button className="ghost icon" disabled={i === cats.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${c} down`}>↓</button>
          </li>
        ))}
      </ol>
      <div className="row">
        {onDelete && <button className="danger" onClick={onDelete}>Delete</button>}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), categories: cats })}>Save</button>
      </div>
    </Modal>
  );
}

/** Pick where an item goes: every list but the one it's on. */
function MoveTo({ item, lists, onPick, onClose }: { item: ShoppingItem; lists: ShoppingList[]; onPick: (l: ShoppingList) => void; onClose: () => void }) {
  return (
    <Modal label={`Move ${item.name}`} onClose={onClose}>
      <h2>Move {item.name} to…</h2>
      <div className="stack">
        {lists.filter((l) => l.id !== item.listId).map((l) => <button key={l.id} onClick={() => onPick(l)}>🛒 {l.name}</button>)}
      </div>
      <div className="row"><span className="spacer" /><button onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

/** The list as it will be once changes waiting on this device are sent. isMain: adds that named no list go on this one. */
function withPending(list: ShoppingItem[], base: string, listId: string, isMain: boolean): ShoppingItem[] {
  let out = list;
  pending().forEach((p, n) => {
    const id = p.path.startsWith(`${base}/shopping/`) ? p.path.slice(base.length + 10) : null;
    const body = (p.body ?? {}) as { checked?: boolean; text?: string; listId?: string };
    const forThisList = body.listId ? body.listId === listId : isMain;
    if (id && p.method === 'PATCH' && body.checked != null) out = out.map((i) => (i.id === id ? { ...i, checked: body.checked! } : i));
    else if (id && p.method === 'DELETE') out = out.filter((i) => i.id !== id);
    else if (p.path === `${base}/shopping` && p.method === 'POST' && body.text && forThisList && !out.some((i) => i.id === `pending-${n}`)) {
      out = [...out, { id: `pending-${n}`, name: body.text, quantity: null, unit: null, category: guessItem(body.text).category, note: null, checked: false, createdAt: '', checkedAt: null, addedBy: null }];
    }
  });
  return out;
}

export function Shopping() {
  const { base, me, toast, homeId } = useApp();
  const dialogs = useDialogs();
  // Which list is open: remembered on this device, Main when it's new or that list was deleted.
  const [lists, reloadLists] = useLoad<ShoppingList[]>(`${base}/shopping/lists`);
  const openKey = `nn-open-list-${homeId}`;
  const [chosen, setChosen] = useState<string>(() => { try { return localStorage.getItem(openKey) ?? ''; } catch { return ''; } });
  const current = lists?.find((l) => l.id === chosen) ?? lists?.find((l) => l.main) ?? lists?.[0] ?? null;
  const listId = current?.id ?? null;
  const many = (lists?.length ?? 0) > 1;
  function openList(id: string) {
    setChosen(id);
    try { localStorage.setItem(openKey, id); } catch { /* private mode */ }
  }
  const [moving, setMoving] = useState<ShoppingItem | null>(null);
  const [loaded, reload, , setItems] = useLoad<ShoppingItem[]>(listId ? `${base}/shopping?list=${listId}` : null);
  // Opened with no signal: show the list as it will be once the waiting changes are sent.
  const items = useMemo(() => (loaded && listId ? withPending(loaded, base, listId, !!current?.main) : null), [loaded, base, listId, current?.main]);
  const [home] = useLoad<HomeDetail>(base);
  const homeOrder = home?.settings.categories ?? [...CATEGORIES];
  const [layouts, reloadLayouts] = useLoad<Layout[]>(`${base}/store-layouts`);
  const storeKey = `nn-store-${homeId}`;
  const [store, setStore] = useState<string>(() => { try { return localStorage.getItem(storeKey) ?? ''; } catch { return ''; } });
  useEffect(() => { try { if (store) localStorage.setItem(storeKey, store); else localStorage.removeItem(storeKey); } catch { /* private mode */ } }, [store, storeKey]);
  const [editingLayout, setEditingLayout] = useState<Layout | 'new' | null>(null);
  const layout = layouts?.find((l) => l.name === store) ?? null;
  const order = layout ? [...layout.categories, ...homeOrder] : homeOrder;

  async function saveLayouts(next: Layout[], pick: string) {
    await api(`${base}/store-layouts`, { method: 'PUT', body: { layouts: next } });
    setEditingLayout(null);
    setStore(pick);
    await reloadLayouts();
  }
  const [suggestions, reloadSugg] = useLoad<Suggestion[]>(listId ? `${base}/shopping/suggestions?list=${listId}` : null);
  const [tabParam, setTab] = useUrlState('tab', 'list');
  const tab = (['history', 'spending'].includes(tabParam) ? tabParam : 'list') as 'list' | 'history' | 'spending';
  const [history] = useLoad<ShoppingItem[]>(tab === 'history' ? `${base}/shopping/history` : null, [tab]);
  const [text, setText] = useState('');
  const [stock, setStock] = useState(true);
  const [ai] = useLoad<{ available: boolean }>('/api/mixologist/status');

  const refresh = () => Promise.all([reload(), reloadSugg(), reloadLists()]);

  async function newList() {
    const name = (await dialogs.prompt('Name the new list', '', { okLabel: 'Create' }))?.trim();
    if (!name) return;
    try {
      const l = await api<ShoppingList>(`${base}/shopping/lists`, { body: { name } });
      await reloadLists();
      openList(l.id);
    } catch (e) { toast((e as Error).message); }
  }

  async function renameList(l: ShoppingList) {
    const name = (await dialogs.prompt(`Rename ${l.name}`, l.name, { okLabel: 'Rename' }))?.trim();
    if (!name || name === l.name) return;
    try { await api(`${base}/shopping/lists/${l.id}`, { method: 'PATCH', body: { name } }); await reloadLists(); } catch (e) { toast((e as Error).message); }
  }

  async function deleteList(l: ShoppingList) {
    // What's left to buy goes to the first list that stays (Main, or the next one when Main itself goes).
    const main = lists?.find((x) => x.id !== l.id);
    const ok = await dialogs.confirm(
      l.open ? `Delete ${l.name}? The ${l.open} thing${l.open === 1 ? '' : 's'} still to buy move to ${main?.name ?? 'Main'}.` : `Delete ${l.name}?`,
      { okLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    try {
      await api(`${base}/shopping/lists/${l.id}`, { method: 'DELETE' });
      if (main) openList(main.id);
      await reloadLists();
      toast(`Deleted ${l.name}`);
    } catch (e) { toast((e as Error).message); }
  }

  async function move(i: ShoppingItem, to: ShoppingList) {
    setMoving(null);
    setItems((cur) => (cur ?? []).filter((x) => x.id !== i.id));
    try {
      await api(`${base}/shopping/${i.id}`, { method: 'PATCH', body: { listId: to.id } });
      toast(`Moved ${i.name} to ${to.name}`);
    } catch (e) { toast((e as Error).message); }
    await refresh();
  }
  const offline = () => toast("No signal. Saved on this device; it'll sync when you're back online.");

  // The list updates on screen straight away; with no signal the change waits on this device and syncs later.
  async function add(t: string) {
    if (!t.trim() || !listId) return;
    setText('');
    rememberList(homeId, listId);
    const tempId = `pending-${Date.now()}`;
    setItems((cur) => [...(cur ?? []), { id: tempId, name: t.trim(), quantity: null, unit: null, category: guessItem(t).category, note: null, checked: false, createdAt: '', checkedAt: null, addedBy: null, listId }]);
    try {
      if (await sendOrQueue(`${base}/shopping`, 'POST', { text: t, listId })) await refresh();
      else {
        // The waiting change itself now shows the item (see withPending), so drop the stand-in.
        setItems((cur) => (cur ?? []).filter((i) => i.id !== tempId));
        offline();
      }
    } catch (e) {
      setItems((cur) => (cur ?? []).filter((i) => i.id !== tempId));
      setText(t);
      toast((e as Error).message);
    }
  }

  async function toggle(i: ShoppingItem) {
    setItems((cur) => (cur ?? []).map((x) => (x.id === i.id ? { ...x, checked: !i.checked } : x)));
    try {
      if (await sendOrQueue(`${base}/shopping/${i.id}`, 'PATCH', { checked: !i.checked, addToInventory: stock, ...(!i.checked && layout ? { store: layout.name } : {}) })) await refresh();
      else offline();
    } catch (e) {
      toast((e as Error).message);
      await reload();
    }
  }

  async function setPrice(i: ShoppingItem, price: number | null) {
    setItems((cur) => (cur ?? []).map((x) => (x.id === i.id ? { ...x, price } : x)));
    try { await api(`${base}/shopping/${i.id}`, { method: 'PATCH', body: { price } }); } catch (err) { toast((err as Error).message); }
  }

  async function remove(i: ShoppingItem) {
    setItems((cur) => (cur ?? []).filter((x) => x.id !== i.id));
    try {
      if (!(await sendOrQueue(`${base}/shopping/${i.id}`, 'DELETE', undefined))) offline();
    } catch (e) {
      toast((e as Error).message);
      await reload();
    }
  }

  const groups = useMemo(() => {
    const open = (items ?? []).filter((i) => !i.checked);
    const m = new Map<string, ShoppingItem[]>();
    for (const i of open) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    const pos = (c: string) => { const i = order.findIndex((x) => x.toLowerCase() === c.toLowerCase()); return i < 0 ? 999 : i; };
    return [...m.entries()].sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, home, layout]);
  const checked = (items ?? []).filter((i) => i.checked);

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="topbar">
        <h1>Shopping</h1>
        <button className="ghost" onClick={() => window.print()}>🖨 Print</button>
        <div className="chips">
          <button className={`chip${tab === 'list' ? ' on' : ''}`} onClick={() => setTab('list')}>List</button>
          <button className={`chip${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>History</button>
          <button className={`chip${tab === 'spending' ? ' on' : ''}`} onClick={() => setTab('spending')}>Spending</button>
        </div>
      </div>

      {tab === 'list' ? (
        <>
          <div className="row list-tabs">
            <div className="chips" role="tablist" aria-label="Shopping lists">
              {lists?.map((l) => (
                <button key={l.id} role="tab" aria-selected={l.id === listId} className={`chip${l.id === listId ? ' on' : ''}`} onClick={() => openList(l.id)}>
                  🛒 {l.name}{l.open ? ` · ${l.open}` : ''}
                </button>
              ))}
              {current && <button className="chip" onClick={() => renameList(current)} aria-label={`Rename ${current.name}`}>✎</button>}
              {current && many && <button className="chip" onClick={() => deleteList(current)} aria-label={`Delete ${current.name}`}>🗑</button>}
              <button className="chip" onClick={newList}>＋ List</button>
            </div>
          </div>
          {moving && lists && <MoveTo item={moving} lists={lists} onPick={(l) => void move(moving, l)} onClose={() => setMoving(null)} />}
          <form className="row" onSubmit={(e) => { e.preventDefault(); void add(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={many && current ? `Add to ${current.name}: “2 lb chicken, milk”` : 'Quick add: “2 lb chicken, milk, 3 avocados”'} style={{ flex: 1 }} aria-label={current ? `Add to ${current.name}` : 'Quick add'} />
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
          <div className="row">
            <span className="small muted">🏬 Aisle order</span>
            <div className="chips">
              <button className={`chip${!layout ? ' on' : ''}`} onClick={() => setStore('')}>Usual</button>
              {layouts?.map((l) => <button key={l.name} className={`chip${layout?.name === l.name ? ' on' : ''}`} onClick={() => setStore(l.name)}>{l.name}</button>)}
              {layout && <button className="chip" onClick={() => setEditingLayout(layout)} aria-label={`Change the order for ${layout.name}`}>✎</button>}
              <button className="chip" onClick={() => setEditingLayout('new')}>＋ Store</button>
            </div>
          </div>
          {editingLayout && (
            <LayoutEditor layout={editingLayout === 'new' ? null : editingLayout} all={homeOrder} onClose={() => setEditingLayout(null)}
              onSave={(l) => {
                const old = editingLayout === 'new' ? null : editingLayout.name;
                void saveLayouts([...(layouts ?? []).filter((x) => x.name !== old && x.name !== l.name), l], l.name);
              }}
              onDelete={editingLayout === 'new' ? null : () => void saveLayouts((layouts ?? []).filter((x) => x.name !== (editingLayout as Layout).name), '')} />
          )}
          <label className="row small muted" style={{ gap: 8 }}>
            <input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} style={{ width: 22, minHeight: 22 }} />
            Put checked-off items in the pantry
          </label>
          {items && !groups.length && <div className="card">{many && current ? `${current.name} is empty.` : 'The list is empty.'} Nice work, ninja. 🦝</div>}
          {groups.map(([cat, list]) => (
            <div key={cat} className="card">
              <h2>{cat}</h2>
              <div className="list">
                {list.map((i) => (
                  <div key={i.id} className="list-item">
                    <button className="check" onClick={() => toggle(i)} disabled={i.id.startsWith('pending-')} aria-label={`Check off ${i.name}`} />
                    <span style={{ fontSize: '1.5rem' }} aria-hidden>{guessItem(i.name).icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{i.quantity != null && <span>{amount(i.quantity, i.unit, me?.user.units)} </span>}{i.name}</div>
                      {(i.note || i.addedBy || i.lastPrice != null) && <div className="small muted">{[i.note, i.addedBy && `added by ${i.addedBy}`, i.lastPrice != null && `last paid ${dollars(i.lastPrice)}`].filter(Boolean).join(' · ')}</div>}
                    </div>
                    {many && <button className="ghost icon" aria-label={`Move ${i.name} to another list`} title="Move to another list" disabled={i.id.startsWith('pending-')} onClick={() => setMoving(i)}>⇄</button>}
                    <button className="ghost icon" aria-label={`Remove ${i.name}`} disabled={i.id.startsWith('pending-')} onClick={() => remove(i)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!!checked.length && (
            <div className="card">
              <div className="row">
                <h2 style={{ flex: 1, margin: 0 }}>In the cart</h2>
                <button onClick={async () => { await api(`${base}/shopping/clear-checked`, { body: { listId } }); await reload(); toast('Cleared'); }}>Clear</button>
              </div>
              <div className="list">
                {checked.map((i) => (
                  <div key={i.id} className="list-item">
                    <button className="check on" onClick={() => toggle(i)} aria-label={`Uncheck ${i.name}`}>✓</button>
                    <span className="done" style={{ flex: 1 }}>{i.quantity != null && `${amount(i.quantity, i.unit, me?.user.units)} `}{i.name}</span>
                    <input className="price-input" type="number" step="0.01" min="0" inputMode="decimal" placeholder={i.lastPrice != null ? dollars(i.lastPrice) : '$'}
                      defaultValue={i.price ?? ''} aria-label={`What ${i.name} cost`}
                      onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (i.price ?? null)) void setPrice(i, v); }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {ai?.available && <ReceiptScan onDone={() => void reload()} />}
        </>
      ) : tab === 'spending' ? <Spending /> : (
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
