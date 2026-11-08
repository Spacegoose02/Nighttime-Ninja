import { useEffect, useMemo, useState } from 'react';
import { Modal, useDialogs } from '../components/Dialog.tsx';
import { api, type HomeDetail, type ShoppingItem, type ShoppingList } from '../api.ts';
import { rememberList } from '../components/ListPicker.tsx';
import { useApp, useLoad } from '../state.tsx';
import { useUrlState } from '../urlState.ts';
import { pending, sendOrQueue } from '../offline.ts';
import { amount, itemAmount } from '../format.ts';
import { CATEGORIES, guessItem } from '../../../shared/catalog.ts';
import { dollars, ReceiptScan, Spending } from '../components/Spending.tsx';
import { Icon } from '../components/Icon.tsx';
import { SwipeRow } from '../components/SwipeRow.tsx';
import { t } from '../i18n.ts';

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
        {onDelete && <button className="danger" onClick={onDelete}>{t('Delete')}</button>}
        <span className="spacer" />
        <button onClick={onClose}>{t('Cancel')}</button>
        <button className="primary" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), categories: cats })}>{t('Save')}</button>
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
        {lists.filter((l) => l.id !== item.listId).map((l) => <button key={l.id} onClick={() => onPick(l)}><Icon name="shopping" /> {l.name}</button>)}
      </div>
      <div className="row"><span className="spacer" /><button onClick={onClose}>{t('Cancel')}</button></div>
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
  const stockKey = `nn-stock-${homeId}`;
  const [stock, setStockState] = useState(() => { try { return localStorage.getItem(stockKey) !== 'off'; } catch { return true; } });
  const setStock = (on: boolean) => { setStockState(on); try { localStorage.setItem(stockKey, on ? 'on' : 'off'); } catch { /* private mode */ } };
  const [menu, setMenu] = useState(false);
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
      else {
        // No "are you sure?": it goes straight away, and Undo puts it back.
        const again = [i.quantity != null ? amount(i.quantity, i.unit, 'original') : '', i.name].filter(Boolean).join(' ');
        toast(t('Removed {item}', { item: i.name }), async () => {
          await api(`${base}/shopping`, { body: { text: again, listId: i.listId ?? listId } });
          await refresh();
        });
      }
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

  /** Hands the list to someone else (a text, a note, a grocery app) through the phone's share sheet, or copies it. */
  async function sendList() {
    const text = [
      current?.name ?? t('Shopping'),
      ...groups.flatMap(([cat, list]) => [``, cat, ...list.map((i) => `• ${[itemAmount(i.quantity, i.unit, me?.user.units), i.name].filter(Boolean).join(' ')}${i.note ? ` (${i.note})` : ''}`)]),
    ].join('\n');
    try {
      if (navigator.share) { await navigator.share({ title: current?.name ?? t('Shopping'), text }); return; }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    try { await navigator.clipboard.writeText(text); toast(t('List copied. Paste it into a message or a grocery app.')); } catch { toast(t("Couldn't copy the list on this device")); }
  }

  return (
    <div className="stack shopping" style={{ maxWidth: 1000 }}>
      <div className="topbar">
        <h1>{t('Shopping')}</h1>
        <div className="chips" role="tablist" aria-label={t('Shopping views')}>
          <button role="tab" aria-selected={tab === 'list'} className={`chip${tab === 'list' ? ' on' : ''}`} onClick={() => setTab('list')}>{t('List')}</button>
          <button role="tab" aria-selected={tab === 'history'} className={`chip${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>{t('History')}</button>
          <button role="tab" aria-selected={tab === 'spending'} className={`chip${tab === 'spending' ? ' on' : ''}`} onClick={() => setTab('spending')}>{t('Spending')}</button>
        </div>
        <button className="ghost icon" aria-label={t('List options')} aria-haspopup="dialog" title={t('List options')} onClick={() => setMenu(true)}><Icon name="menu" /></button>
      </div>

      {menu && (
        <Modal label={t('List options')} onClose={() => setMenu(false)}>
          <h2>{t('List options')}</h2>
          {tab === 'list' && current && (
            <div className="stack" style={{ gap: 8 }}>
              <button onClick={() => { setMenu(false); void newList(); }}><Icon name="add" /> {t('New list')}</button>
              <button onClick={() => { setMenu(false); void renameList(current); }}><Icon name="edit" /> {t('Rename {name}', { name: current.name })}</button>
              {many && <button className="danger" onClick={() => { setMenu(false); void deleteList(current); }}><Icon name="delete" /> {t('Delete {name}', { name: current.name })}</button>}
            </div>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>{t('Aisle order')}</h3>
            <p className="small muted" style={{ margin: 0 }}>{t('Pick your store and the list follows the order you walk its aisles.')}</p>
            <div className="chips">
              <button className={`chip${!layout ? ' on' : ''}`} onClick={() => setStore('')}>{t('Usual')}</button>
              {layouts?.map((l) => <button key={l.name} className={`chip${layout?.name === l.name ? ' on' : ''}`} onClick={() => setStore(l.name)}>{l.name}</button>)}
              {layout && <button className="chip" onClick={() => { setMenu(false); setEditingLayout(layout); }} aria-label={`Change the order for ${layout.name}`}><Icon name="edit" /></button>}
              <button className="chip" onClick={() => { setMenu(false); setEditingLayout('new'); }}><Icon name="add" /> {t('Store')}</button>
            </div>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} style={{ width: 22, minHeight: 22 }} />
            {t('Put checked-off items in the pantry')}
          </label>
          <div className="row">
            <button onClick={() => { setMenu(false); setTimeout(() => window.print(), 50); }}><Icon name="print" /> {t('Print')}</button>
            <button onClick={() => { setMenu(false); void sendList(); }}><Icon name="share" /> {t('Send the list')}</button>
            <span className="spacer" />
            <button className="primary" onClick={() => setMenu(false)}>{t('Done')}</button>
          </div>
        </Modal>
      )}

      {tab === 'list' ? (
        <>
          <div className="chips scroll-x">
            <div className="chips" role="tablist" aria-label={t('Shopping lists')} style={{ flexWrap: 'nowrap' }}>
              {lists?.map((l) => (
                <button key={l.id} role="tab" aria-selected={l.id === listId} className={`chip${l.id === listId ? ' on' : ''}`} onClick={() => openList(l.id)}>
                  {l.name}{l.open ? <span className="count">{l.open}</span> : null}
                </button>
              ))}
            </div>
            <button className="chip" onClick={newList} aria-label={t('New list')}><Icon name="add" /> {t('List')}</button>
          </div>
          {moving && lists && <MoveTo item={moving} lists={lists} onPick={(l) => void move(moving, l)} onClose={() => setMoving(null)} />}
          <form className="row quick-add" onSubmit={(e) => { e.preventDefault(); void add(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={many && current ? t('Add to {name}: “2 lb chicken, milk”', { name: current.name }) : t('Quick add: “2 lb chicken, milk, 3 avocados”')} style={{ flex: 1 }} aria-label={current ? t('Add to {name}', { name: current.name }) : t('Quick add')} />
            <button className="primary" disabled={!text.trim()}>{t('Add')}</button>
          </form>
          {(layout || !stock) && (
            <p className="small muted" style={{ margin: 0 }}>
              {[layout && t('In {store} aisle order', { store: layout.name }), !stock && t("Checked-off items won't go in the pantry")].filter(Boolean).join(' · ')}
            </p>
          )}
          {editingLayout && (
            <LayoutEditor layout={editingLayout === 'new' ? null : editingLayout} all={homeOrder} onClose={() => setEditingLayout(null)}
              onSave={(l) => {
                const old = editingLayout === 'new' ? null : editingLayout.name;
                void saveLayouts([...(layouts ?? []).filter((x) => x.name !== old && x.name !== l.name), l], l.name);
              }}
              onDelete={editingLayout === 'new' ? null : () => void saveLayouts((layouts ?? []).filter((x) => x.name !== (editingLayout as Layout).name), '')} />
          )}
          {items && !groups.length && <div className="card">{many && current ? t('{name} is empty.', { name: current.name }) : t('The list is empty.')} {t('Nice work, ninja.')} 🦝</div>}
          {groups.map(([cat, list]) => (
            <div key={cat} className="card">
              <h2>{cat}</h2>
              <div className="list">
                {list.map((i) => (
                  <SwipeRow key={i.id} disabled={i.id.startsWith('pending-')} onRight={() => void toggle(i)} onLeft={() => void remove(i)} rightLabel={t('In the cart')} leftLabel={t('Remove')}>
                  <div className="list-item">
                    <button className="check" onClick={() => toggle(i)} disabled={i.id.startsWith('pending-')} aria-label={t('Check off {item}', { item: i.name })} />
                    <span style={{ fontSize: '1.5rem' }} aria-hidden>{guessItem(i.name).icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{itemAmount(i.quantity, i.unit, me?.user.units) && <span>{itemAmount(i.quantity, i.unit, me?.user.units)} </span>}{i.name}</div>
                      {(i.note || i.addedBy || i.lastPrice != null) && <div className="small muted">{[i.note, i.addedBy && t('added by {name}', { name: i.addedBy }), i.lastPrice != null && t('last paid {price}', { price: dollars(i.lastPrice) })].filter(Boolean).join(' · ')}</div>}
                    </div>
                    {many && <button className="ghost icon" aria-label={t('Move {item} to another list', { item: i.name })} title={t('Move to another list')} disabled={i.id.startsWith('pending-')} onClick={() => setMoving(i)}><Icon name="move" /></button>}
                    <button className="ghost icon" aria-label={t('Remove {item}', { item: i.name })} title={t('Remove')} disabled={i.id.startsWith('pending-')} onClick={() => remove(i)}><Icon name="close" /></button>
                  </div>
                  </SwipeRow>
                ))}
              </div>
            </div>
          ))}
          {!!suggestions?.length && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">{t('Tap to add again')}</span>
              <div className="chips">
                {suggestions.slice(0, 24).map((s) => (
                  <button key={s.name} className="chip" onClick={() => add(s.name)}>{guessItem(s.name).icon} {s.name}</button>
                ))}
              </div>
            </div>
          )}
          {!!checked.length && (
            <div className="card">
              <div className="row">
                <h2 style={{ flex: 1, margin: 0 }}>{t('In the cart')}</h2>
                <button onClick={async () => { await api(`${base}/shopping/clear-checked`, { body: { listId } }); await reload(); toast('Cleared'); }}>{t('Clear')}</button>
              </div>
              <div className="list">
                {checked.map((i) => (
                  <div key={i.id} className="list-item">
                    <button className="check on" onClick={() => toggle(i)} aria-label={t('Uncheck {item}', { item: i.name })}><Icon name="check" /></button>
                    <span className="done" style={{ flex: 1 }}>{itemAmount(i.quantity, i.unit, me?.user.units) && `${itemAmount(i.quantity, i.unit, me?.user.units)} `}{i.name}</span>
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
            <thead><tr><th>{t('Bought')}</th><th>{t('Item')}</th><th>{t('Amount')}</th></tr></thead>
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
          {history && !history.length && <p className="muted">{t('Nothing bought yet.')}</p>}
        </div>
      )}
    </div>
  );
}
