// Settings → Kitchen tools: the gear this home owns. Recipes flag gear you don't have, and Gordy and Rocco cook around it.
import { useState } from 'react';
import { api, type HomeDetail } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { TOOL_GROUPS, TOOLS, toolLabel } from '../../../../shared/equipment.ts';

export function KitchenTools() {
  const { base, toast } = useApp();
  const [home, reload] = useLoad<HomeDetail>(base);
  const [adding, setAdding] = useState('');
  if (!home) return null;
  const owned = home.settings.equipment;
  const has = (k: string) => owned.some((o) => o.toLowerCase() === k.toLowerCase());
  const known = new Set(TOOLS.map((t) => t.key));
  const custom = owned.filter((o) => !known.has(o));
  const save = async (equipment: string[]) => {
    try { await api(`${base}/equipment`, { method: 'PUT', body: { equipment } }); } catch (e) { toast((e as Error).message); }
    await reload();
  };
  const toggle = (k: string) => save(has(k) ? owned.filter((o) => o.toLowerCase() !== k.toLowerCase()) : [...owned, k]);
  return (
    <div className="card stack">
      <h2>Kitchen tools</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Tap the gear you have. Recipes that need something you don't own get a 🍳 note, and Gordy and Rocco stick to what's here or offer a workaround.
        {!owned.length && ' Until you pick something, nothing is flagged.'}
      </p>
      {TOOL_GROUPS.map((g) => (
        <div key={g} className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>{g}</h3>
          <div className="chips">
            {TOOLS.filter((t) => t.group === g).map((t) => {
              const on = has(t.key);
              return <button key={t.key} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => void toggle(t.key)}>{t.label}</button>;
            })}
          </div>
        </div>
      ))}
      {!!custom.length && (
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>Your own</h3>
          <div className="chips">
            {custom.map((c) => <button key={c} className="chip on" aria-label={`Remove ${c}`} title="Tap to remove" onClick={() => void toggle(c)}>{toolLabel(c)} ✕</button>)}
          </div>
        </div>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); const v = adding.trim(); if (v && !has(v)) void save([...owned, v]); setAdding(''); }}>
        <input aria-label="Add your own tool" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Something else, e.g. Pizza oven, Tortilla press" style={{ flex: 1 }} maxLength={60} />
        <button disabled={!adding.trim()}>Add</button>
      </form>
    </div>
  );
}
