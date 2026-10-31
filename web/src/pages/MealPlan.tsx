import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../components/Dialog.tsx';
import { api, type HomeDetail, type Meal, type RecipeSummary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { addDays, todayIso } from '../format.ts';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

const dayName = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

/** Picks who's cooking from the people in the home. */
function CookSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { base } = useApp();
  const [home] = useLoad<HomeDetail>(base);
  if (!home || home.members.length < 2) return null;
  return (
    <label className="field">Who's cooking
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Nobody picked yet</option>
        {home.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </label>
  );
}

function AddMeal({ date, onClose }: { date: string; onClose: (changed: boolean) => void }) {
  const { base } = useApp();
  const [recipes] = useLoad<RecipeSummary[]>(`${base}/recipes`);
  const [slot, setSlot] = useState('dinner');
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [cookId, setCookId] = useState('');
  const [repeatWeeks, setRepeatWeeks] = useState(1);

  async function add(body: { recipeId?: string; title?: string }) {
    await api(`${base}/mealplan`, { body: { date, slot, cookId: cookId || null, repeatWeeks, ...body } });
    onClose(true);
  }

  const shown = (recipes ?? []).filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal label="Plan a meal" onClose={() => onClose(false)}>
      <h2>{dayName(date)}</h2>
      <div className="chips">{SLOTS.map((s) => <button key={s} className={`chip${slot === s ? ' on' : ''}`} onClick={() => setSlot(s)}>{s}</button>)}</div>
      <div className="row">
        <CookSelect value={cookId} onChange={setCookId} />
        <label className="field">Repeat
          <select value={repeatWeeks} onChange={(e) => setRepeatWeeks(Number(e.target.value))}>
            <option value={1}>Just this once</option>
            {[4, 8, 12].map((n) => <option key={n} value={n}>Every {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })} for {n} weeks</option>)}
          </select>
        </label>
      </div>
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

/** Move a meal to another day or slot, pick who's cooking, or take it off the plan. */
function EditMeal({ meal, onClose }: { meal: Meal; onClose: (changed: boolean) => void }) {
  const { base } = useApp();
  const [date, setDate] = useState(meal.date);
  const [slot, setSlot] = useState(meal.slot);
  const [cookId, setCookId] = useState(meal.cookId ?? '');
  const save = async () => {
    await api(`${base}/mealplan/${meal.id}`, { method: 'PATCH', body: { date, slot, cookId: cookId || null } });
    onClose(true);
  };
  return (
    <Modal label="Change a planned meal" onClose={() => onClose(false)}>
      <h2>{meal.title}</h2>
      <label className="field">Day<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div className="chips">{SLOTS.map((s) => <button key={s} className={`chip${slot === s ? ' on' : ''}`} onClick={() => setSlot(s)}>{s}</button>)}</div>
      <CookSelect value={cookId} onChange={setCookId} />
      <div className="row">
        <button className="danger" onClick={async () => { await api(`${base}/mealplan/${meal.id}`, { method: 'DELETE' }); onClose(true); }}>Remove</button>
        <span className="spacer" />
        <button onClick={() => onClose(false)}>Cancel</button>
        <button className="primary" onClick={save} disabled={!date}>Save</button>
      </div>
    </Modal>
  );
}

export function MealPlan() {
  const { base, toast } = useApp();
  const [start, setStart] = useState(todayIso());
  const [meals, reload] = useLoad<Meal[]>(`${base}/mealplan?start=${start}&days=7`, [start]);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<Meal | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayIso();

  async function copyLastWeek() {
    const r = await api<{ copied: number }>(`${base}/mealplan/copy`, { body: { from: addDays(start, -7), to: start, days: 7 } });
    toast(r.copied ? `Copied ${r.copied} meal${r.copied === 1 ? '' : 's'} from last week` : 'Nothing new to copy from last week');
    void reload();
  }

  // Drag a meal onto another day (mouse or pen); on touch screens, tap it and change the day.
  async function moveTo(day: string, mealId: string) {
    setDropDay(null);
    const m = meals?.find((x) => x.id === mealId);
    if (!m || m.date === day) return;
    await api(`${base}/mealplan/${mealId}`, { method: 'PATCH', body: { date: day } });
    toast(`Moved ${m.title} to ${dayName(day)}`);
    void reload();
  }

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
        <button onClick={copyLastWeek}>⧉ Copy last week</button>
        <button className="primary" onClick={shopForWeek}>🛒 Shop for this week</button>
      </div>
      <div className="week">
        {days.map((d) => {
          const dayMeals = (meals ?? []).filter((m) => m.date === d).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: dragging is a mouse shortcut; the ✎ button does the same from a keyboard.
            <div key={d} className={`card day stack${d === today ? ' today' : ''}${dropDay === d ? ' drop' : ''}`} style={{ gap: 8 }}
              onDragOver={(e) => { e.preventDefault(); setDropDay(d); }} onDragLeave={() => setDropDay((x) => (x === d ? null : x))}
              onDrop={(e) => { e.preventDefault(); void moveTo(d, e.dataTransfer.getData('text/x-meal')); }}>
              <div>
                <strong>{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</strong>{' '}
                <span className="muted">{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              {dayMeals.map((m) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: as above, ✎ is the keyboard way to move a meal.
                <div key={m.id} className="meal" draggable onDragStart={(e) => e.dataTransfer.setData('text/x-meal', m.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="slot">{m.slot}</div>
                    {m.recipeId ? <Link to={`/recipes/${m.recipeId}`} className={m.cookedAt ? 'done' : ''}>{m.title}</Link> : <span className={m.cookedAt ? 'done' : ''}>{m.title}</span>}
                    {m.cookName && <div className="small muted">👩‍🍳 {m.cookName}</div>}
                  </div>
                  <button className="ghost icon" style={{ minWidth: 36, minHeight: 36 }} aria-label={`Change ${m.title}`} onClick={() => setEditing(m)}>✎</button>
                </div>
              ))}
              <button className="ghost" onClick={() => setAdding(d)}>＋ Add</button>
            </div>
          );
        })}
      </div>
      <p className="small muted">Want this in Google Calendar? Settings → Home → Calendar link.</p>
      {editing && <EditMeal meal={editing} onClose={(c) => { setEditing(null); if (c) void reload(); }} />}
      {adding && <AddMeal date={adding} onClose={(c) => { setAdding(null); if (c) void reload(); }} />}
    </div>
  );
}
