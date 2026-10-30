import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../components/Dialog.tsx';
import { api, type Meal, type RecipeSummary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { addDays, todayIso } from '../format.ts';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

function AddMeal({ date, onClose }: { date: string; onClose: (changed: boolean) => void }) {
  const { base } = useApp();
  const [recipes] = useLoad<RecipeSummary[]>(`${base}/recipes`);
  const [slot, setSlot] = useState('dinner');
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');

  async function add(body: { recipeId?: string; title?: string }) {
    await api(`${base}/mealplan`, { body: { date, slot, ...body } });
    onClose(true);
  }

  const shown = (recipes ?? []).filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal label="Plan a meal" onClose={() => onClose(false)}>
      <h2>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
      <div className="chips">{SLOTS.map((s) => <button key={s} className={`chip${slot === s ? ' on' : ''}`} onClick={() => setSlot(s)}>{s}</button>)}</div>
      <input placeholder="Find a recipe" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list" style={{ maxHeight: 320, overflow: 'auto' }}>
        {shown.map((r) => (
          <button key={r.id} className="list-item ghost" style={{ justifyContent: 'flex-start', borderRadius: 0 }} onClick={() => add({ recipeId: r.id })}>
            <span>{r.ready === 'ready' ? '✅' : r.ready === 'almost' ? '🟡' : '⚪'}</span> {r.title}
          </button>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void add({ title }); }}>
        <input placeholder="…or just type a meal (Leftovers, Pizza night)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
        <button disabled={!title.trim()}>Add</button>
      </form>
    </Modal>
  );
}

export function MealPlan() {
  const { base, toast } = useApp();
  const [start, setStart] = useState(todayIso());
  const [meals, reload] = useLoad<Meal[]>(`${base}/mealplan?start=${start}&days=7`, [start]);
  const [adding, setAdding] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayIso();

  async function shopForWeek() {
    const r = await api<{ added: number; meals: number }>(`${base}/mealplan/to-shopping`, { body: { start, days: 7 } });
    toast(r.added ? `Added ${r.added} items for ${r.meals} meals` : 'You have everything for this week');
  }

  return (
    <div className="stack">
      <div className="topbar">
        <h1>Meal plan</h1>
        <button className="icon" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">‹</button>
        <button onClick={() => setStart(todayIso())}>Today</button>
        <button className="icon" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">›</button>
        <button className="primary" onClick={shopForWeek}>🛒 Shop for this week</button>
      </div>
      <div className="week">
        {days.map((d) => {
          const dayMeals = (meals ?? []).filter((m) => m.date === d).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
          return (
            <div key={d} className={`card day stack${d === today ? ' today' : ''}`} style={{ gap: 8 }}>
              <div>
                <strong>{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</strong>{' '}
                <span className="muted">{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              {dayMeals.map((m) => (
                <div key={m.id} className="meal">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="slot">{m.slot}</div>
                    {m.recipeId ? <Link to={`/recipes/${m.recipeId}`} className={m.cookedAt ? 'done' : ''}>{m.title}</Link> : <span className={m.cookedAt ? 'done' : ''}>{m.title}</span>}
                  </div>
                  <button className="ghost icon" style={{ minWidth: 36, minHeight: 36 }} aria-label="Remove" onClick={async () => { await api(`${base}/mealplan/${m.id}`, { method: 'DELETE' }); await reload(); }}>✕</button>
                </div>
              ))}
              <button className="ghost" onClick={() => setAdding(d)}>＋ Add</button>
            </div>
          );
        })}
      </div>
      <p className="small muted">Want this in Google Calendar? Settings → Home → Calendar link.</p>
      {adding && <AddMeal date={adding} onClose={(c) => { setAdding(null); if (c) void reload(); }} />}
    </div>
  );
}
