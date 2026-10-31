// Settings → Places and categories: the "Where" and category lists a home's pantry and shopping list use.
import { useState } from 'react';
import { api, type HomeDetail } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';

/** Add, rename, reorder or remove a home's pantry locations or categories. */
function LabelEditor({ kind, title, hint, list, onSaved }: { kind: 'locations' | 'categories'; title: string; hint: string; list: string[]; onSaved: () => void }) {
  const { base, toast } = useApp();
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const save = async (body: object, msg: string) => {
    try { await api(`${base}/labels`, { method: 'PUT', body }); toast(msg); onSaved(); } catch (e) { toast((e as Error).message); }
  };
  const move = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    void save({ [kind]: next }, 'Order saved');
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p className="small muted" style={{ margin: 0 }}>{hint}</p>
      <div className="list">
        {list.map((l, i) => (
          <div key={l} className="list-item" style={{ minHeight: 48, padding: '4px 0' }}>
            {editing?.from === l ? (
              <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); void save({ rename: { kind, from: l, to: editing.to } }, `Renamed to ${editing.to}`); setEditing(null); }}>
                <input aria-label={`New name for ${l}`} value={editing.to} onChange={(e) => setEditing({ from: l, to: e.target.value })} autoFocus style={{ flex: 1 }} />
                <button className="primary" disabled={!editing.to.trim()}>Save</button>
                <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span style={{ flex: 1 }}>{l}</span>
                <button className="ghost icon" aria-label={`Move ${l} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="ghost icon" aria-label={`Move ${l} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="ghost" onClick={() => setEditing({ from: l, to: l })}>Rename</button>
                <button className="ghost danger" disabled={list.length < 2} onClick={() => save({ [kind]: list.filter((x) => x !== l) }, `Removed ${l}`)}>Remove</button>
              </>
            )}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void save({ [kind]: [...list, adding.trim()] }, `Added ${adding.trim()}`); setAdding(''); }}>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={kind === 'locations' ? 'New place, e.g. Garage Freezer' : 'New category, e.g. Baby Food'} style={{ flex: 1 }} />
        <button disabled={!adding.trim()}>Add</button>
      </form>
    </div>
  );
}

/** Its own card so it's easy to find: the places ("Where") and categories used across the pantry and shopping list. */
export function PlacesAndCategories() {
  const { base } = useApp();
  const [home, reload] = useLoad<HomeDetail>(base);
  // Only home managers (and server admins, who count as managers) can change these lists.
  if (!home || home.role !== 'manager') return null;
  return (
    <div className="card stack">
      <h2>Pantry places & categories</h2>
      <p className="small muted" style={{ margin: 0 }}>These fill the Where and Category dropdowns when you add or edit an item. As a home manager you can also pick “➕ Add new…” right in the dropdown. Other people in the home choose from these lists.</p>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <LabelEditor kind="locations" title="Places (Where)" hint="Renaming moves every item in that place." list={home.settings.locations} onSaved={() => void reload()} />
        <LabelEditor kind="categories" title="Categories" hint="Shown in this order. Renaming updates every item." list={home.settings.categories} onSaved={() => void reload()} />
      </div>
    </div>
  );
}
