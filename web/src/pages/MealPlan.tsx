import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../components/Dialog.tsx';
import { api, type HomeDetail, type Meal, type RecipeSummary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { useListPicker } from '../components/ListPicker.tsx';
import { useUrlState } from '../urlState.ts';
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

interface Proposal {
  date: string; slot: string; recipeId: string | null; title: string; why: string; missing: string[];
  recipe: { title: string; ingredients: unknown[]; instructions: string[] } | null;
}

/** "Plan my week": Gordy fills the open days from the recipe book and the pantry; you pick which to keep. */
function PlanWithGordy({ start, onClose }: { start: string; onClose: (changed: boolean) => void }) {
  const { base, toast } = useApp();
  const { pick, picker } = useListPicker();
  const [slots, setSlots] = useState(['dinner']);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Proposal[] | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());

  async function ask() {
    setBusy(true);
    try {
      const r = await api<{ meals: Proposal[] }>(`${base}/chef/plan-week`, { body: { start, days: 7, slots, notes } });
      setPlan(r.meals);
      setKeep(new Set(r.meals.map((_, i) => i)));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  async function add(shop: boolean) {
    setBusy(true);
    try {
      for (const [i, m] of (plan ?? []).entries()) {
        if (!keep.has(i)) continue;
        // New dishes go into the recipe book first, so the plan links to them.
        const recipeId = m.recipeId ?? (m.recipe ? (await api<{ id: string }>(`${base}/chef/save`, { body: { recipe: m.recipe, tags: ['plan'] } })).id : null);
        await api(`${base}/mealplan`, { body: { date: m.date, slot: m.slot, ...(recipeId ? { recipeId } : { title: m.title }) } });
      }
      const list = shop ? await pick({ prefer: 'main', title: 'Shop for the week on which list?' }) : null;
      if (list) {
        const r = await api<{ added: number }>(`${base}/mealplan/to-shopping`, { body: { start, days: 7, listId: list.id } });
        toast(`Planned ${keep.size} meals and added ${r.added} things to ${list.label}`);
      } else toast(`Planned ${keep.size} meals`);
      onClose(true);
    } catch (e) { toast((e as Error).message); setBusy(false); }
  }

  return (
    <Modal label="Plan my week with Gordy" onClose={() => onClose(false)}>
      {picker}
      <h2>✨ Plan my week with Gordy</h2>
      {!plan ? (
        <>
          <p className="muted" style={{ margin: 0 }}>Gordy fills the open days from your recipe book and what's in the pantry, using up what's about to expire first.</p>
          <div className="chips">
            {SLOTS.map((s) => (
              <button key={s} className={`chip${slots.includes(s) ? ' on' : ''}`} aria-pressed={slots.includes(s)}
                onClick={() => setSlots(slots.includes(s) ? slots.filter((x) => x !== s) : [...slots, s])}>{s}</button>
            ))}
          </div>
          <input placeholder="Anything to know? e.g. busy Wednesday, fish once, no pasta" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="row">
            <span className="spacer" />
            <button onClick={() => onClose(false)}>Cancel</button>
            <button className="primary" disabled={busy || !slots.length} onClick={ask}>{busy ? 'Gordy is thinking…' : 'Plan it'}</button>
          </div>
        </>
      ) : (
        <>
          <div className="list" style={{ maxHeight: '55vh', overflow: 'auto' }}>
            {plan.map((m, i) => (
              <label key={`${m.date}-${m.slot}`} className="list-item" style={{ alignItems: 'flex-start', flexShrink: 0 }}>
                <input type="checkbox" checked={keep.has(i)} style={{ width: 22, minHeight: 22 }}
                  onChange={() => setKeep((k) => { const x = new Set(k); if (x.has(i)) x.delete(i); else x.add(i); return x; })} />
                <span style={{ flex: 1 }}>
                  <span className="small muted">{dayName(m.date)} · {m.slot}</span><br />
                  <strong>{m.title}</strong>{!m.recipeId && <span className="pill" style={{ marginLeft: 6 }}>new</span>}<br />
                  <span className="small">{m.why}</span>
                  {!!m.missing.length && <span className="small muted" style={{ display: 'block' }}>Need: {m.missing.join(', ')}</span>}
                </span>
              </label>
            ))}
            {!plan.length && <p className="muted">Gordy couldn't fill those days. Try different meals or add a few recipes first.</p>}
          </div>
          <div className="row">
            <button className="ghost" onClick={() => setPlan(null)}>↻ Try again</button>
            <span className="spacer" />
            <button disabled={busy || !keep.size} onClick={() => add(false)}>Add {keep.size} to plan</button>
            <button className="primary" disabled={busy || !keep.size} onClick={() => add(true)}>Add and shop</button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function MealPlan() {
  const { base, toast } = useApp();
  const { pick, picker } = useListPicker();
  const [week, setWeek] = useUrlState('week');
  const start = /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : todayIso();
  const setStart = (d: string) => setWeek(d === todayIso() ? '' : d);
  const [meals, reload] = useLoad<Meal[]>(`${base}/mealplan?start=${start}&days=7`, [start]);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<Meal | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [ai] = useLoad<{ available: boolean }>('/api/mixologist/status');
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
    const list = await pick({ prefer: 'main', title: 'Shop for the week on which list?' });
    if (!list) return;
    const r = await api<{ added: number; meals: number }>(`${base}/mealplan/to-shopping`, { body: { start, days: 7, listId: list.id } });
    toast(r.added ? `Added ${r.added} items for ${r.meals} meals to ${list.label}` : 'You have everything for this week');
  }

  return (
    <div className="stack">
      {picker}
      <div className="topbar">
        <h1>Meal plan</h1>
        <button className="icon" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">‹</button>
        <button onClick={() => setStart(todayIso())}>Today</button>
        <button className="icon" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">›</button>
        <button onClick={copyLastWeek}>⧉ Copy last week</button>
        {ai?.available && <button onClick={() => setPlanning(true)}>✨ Plan my week</button>}
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
      {planning && <PlanWithGordy start={start} onClose={(c) => { setPlanning(false); if (c) void reload(); }} />}
      {editing && <EditMeal meal={editing} onClose={(c) => { setEditing(null); if (c) void reload(); }} />}
      {adding && <AddMeal date={adding} onClose={(c) => { setAdding(null); if (c) void reload(); }} />}
    </div>
  );
}
