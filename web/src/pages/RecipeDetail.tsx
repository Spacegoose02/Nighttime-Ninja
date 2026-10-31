import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Modal, useDialogs } from '../components/Dialog.tsx';
import { api, type Item, type Nutrition, type RecipeFull } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { amount, minutes, todayIso } from '../format.ts';
import { celsiusToFahrenheitText } from '../../../shared/units.ts';
import { findTimers } from '../../../shared/timers.ts';
import { startTimer, useWakeLock } from '../components/Timers.tsx';
import { canListen, say, useVoice } from '../components/Voice.tsx';
import { ingredientMatches } from '../../../shared/recipe.ts';
import { READY_LABEL } from './Recipes.tsx';

/** Lets someone say "this ingredient is that pantry item". Saved for the whole home, so every recipe uses it. */
function MatchPicker({ ingredient, onClose }: { ingredient: string; onClose: (changed: boolean) => void }) {
  const { base, toast, me } = useApp();
  const [items] = useLoad<Item[]>(`${base}/items`);
  const [q, setQ] = useState('');
  const save = async (itemId: string | null, label: string) => {
    await api(`${base}/ingredient-links`, { method: 'PUT', body: { ingredient, itemId } });
    toast(label);
    onClose(true);
  };
  const shown = (items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal label="Match an ingredient" onClose={() => onClose(false)}>
      <h2>What do you use for “{ingredient}”?</h2>
      <p className="small muted" style={{ margin: 0 }}>Pick it once and every recipe that calls for {ingredient} will use it.</p>
      <input placeholder="Search the pantry" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="list" style={{ maxHeight: 340, overflow: 'auto' }}>
        {shown.map((i) => (
          <button key={i.id} className="list-item ghost" style={{ justifyContent: 'flex-start', borderRadius: 0 }} onClick={() => save(i.id, `${ingredient} → ${i.name}`)}>
            <span style={{ fontSize: '1.4rem' }}>{i.icon}</span>
            <span style={{ flex: 1, textAlign: 'left' }}>{i.name}</span>
            <span className="small muted">{amount(i.quantity, i.unit, me?.user.units)}</span>
          </button>
        ))}
        {items && !shown.length && <p className="muted">Nothing in the pantry matches that.</p>}
      </div>
      <div className="row">
        <button onClick={() => save(null, 'Back to automatic matching')}>Let the app decide</button>
        <span className="spacer" />
        <button className="ghost" onClick={() => onClose(false)}>Cancel</button>
      </div>
    </Modal>
  );
}

/** Tap-to-start timers for the times a step mentions. */
function StepTimers({ step, title }: { step: string; title: string }) {
  const found = findTimers(step);
  if (!found.length) return null;
  return (
    <span className="row" style={{ gap: 6, marginTop: 6 }}>
      {found.map((t) => (
        <button key={t.label} className="chip" onClick={() => startTimer(`${title}: ${t.label}`, t.seconds)}>
          ⏱ {t.label}
        </button>
      ))}
    </span>
  );
}

/** AI nutrition estimate per serving, clearly marked as approximate. */
function NutritionCard({ recipeId, nutrition, onChange }: { recipeId: string; nutrition: Nutrition | null; onChange: () => void }) {
  const { base, toast } = useApp();
  const [status] = useLoad<{ available: boolean }>('/api/mixologist/status');
  const [busy, setBusy] = useState(false);
  if (!nutrition && !status?.available) return null;
  const estimate = async () => {
    setBusy(true);
    try { await api(`${base}/recipes/${recipeId}/nutrition`, { body: {} }); onChange(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const rows: [string, number | undefined, string][] = nutrition ? [
    ['Calories', nutrition.calories, ''], ['Protein', nutrition.proteinG, ' g'], ['Carbs', nutrition.carbsG, ' g'], ['Fat', nutrition.fatG, ' g'],
    ['Fiber', nutrition.fiberG, ' g'], ['Sugar', nutrition.sugarG, ' g'], ['Sodium', nutrition.sodiumMg, ' mg'],
  ] : [];
  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ flex: 1, margin: 0 }}>Nutrition</h2>
        {status?.available && <button className="ghost" disabled={busy} onClick={estimate}>{busy ? 'Working it out…' : nutrition ? '↻ Estimate again' : '✨ Estimate'}</button>}
      </div>
      {nutrition ? (
        <>
          <div className="nutrition">{rows.map(([k, v, u]) => <div key={k}><strong>{v}{u}</strong><span className="small muted">{k}</span></div>)}</div>
          <p className="small muted" style={{ margin: 0 }}>Per serving ({nutrition.servings} servings). An AI estimate from the ingredients, so treat it as approximate.</p>
        </>
      ) : <p className="small muted" style={{ margin: 0 }}>Get a rough calories, protein, carbs and fat count per serving.</p>}
    </div>
  );
}

const AVAIL = { have: ['ok', '✓'], unknown: ['ok', '✓'], low: ['warn', 'low'], missing: ['bad', 'need'] } as const;

export function RecipeDetail() {
  const { id } = useParams();
  const { base, me, toast } = useApp();
  const dialogs = useDialogs();
  const nav = useNavigate();
  const [servings, setServings] = useState<number | null>(null);
  const [recipe, reload] = useLoad<RecipeFull>(`${base}/recipes/${id}${servings ? `?servings=${servings}` : ''}`, [servings]);
  const [cookMode, setCookMode] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());
  /** Ingredients ticked off in cook mode, once they're measured out. */
  const [got, setGot] = useState<Set<number>>(new Set());
  const [stepAt, setStepAt] = useState(0);
  useWakeLock(cookMode);
  const [voice, setVoice] = useState(false);
  const voiceOn = cookMode && voice;
  const { heard, error: voiceError } = useVoice(voiceOn, (c) => {
    if (!recipe) return;
    const steps = recipe.instructions;
    const read = (n: number) => say(`Step ${n + 1}. ${units === 'us' ? celsiusToFahrenheitText(steps[n]) : steps[n]}`);
    if (c.kind === 'next') {
      if (stepAt < steps.length - 1) { setDone((d) => new Set(d).add(stepAt)); setStepAt(stepAt + 1); read(stepAt + 1); } else say("That's the last step. Enjoy!");
    } else if (c.kind === 'back') {
      if (stepAt > 0) { setStepAt(stepAt - 1); read(stepAt - 1); }
    } else if (c.kind === 'repeat') read(stepAt);
    else if (c.kind === 'ingredients') say(recipe.ingredients.map((i) => `${amount(i.quantity == null ? null : i.quantity * factor, i.unit, units)} ${i.name}`.trim()).join(', '));
    else if (c.kind === 'howMuch') {
      const i = recipe.ingredients.find((x) => ingredientMatches(x.name, c.what) || ingredientMatches(c.what, x.name));
      say(i ? `${amount(i.quantity == null ? null : i.quantity * factor, i.unit, units) || 'Some'} ${i.name}` : `I don't see ${c.what} in this recipe.`);
    } else if (c.kind === 'timer') { startTimer(`${recipe.title}: ${c.label}`, c.seconds); say(`Timer set for ${c.label}.`); }
    else if (c.kind === 'stepTimer') {
      const t = findTimers(steps[stepAt])[0];
      if (t) { startTimer(`${recipe.title}: ${t.label}`, t.seconds); say(`Timer set for ${t.label}.`); } else say('This step has no time in it. Say, set a timer for ten minutes.');
    } else if (c.kind === 'stop') { setVoice(false); say('Okay, I stopped listening.'); }
  });
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [matching, setMatching] = useState<string | null>(null);

  if (!recipe) return <div className="card">Loading…</div>;
  const factor = servings && recipe.servings ? servings / recipe.servings : 1;
  const units = me?.user.units ?? 'us';
  const [cls, label] = READY_LABEL[recipe.status];

  async function cook() {
    if (!(await dialogs.confirm(`Take the ingredients for ${recipe!.title} out of the pantry?`, { okLabel: 'I cooked it' }))) return;
    const r = await api<{ used: unknown[]; skipped: string[]; historyIds: number[] }>(`${base}/recipes/${id}/cook`, { body: { servings } });
    void reload();
    const left = await dialogs.prompt('Any leftovers? Say how many servings and they go in the fridge for 4 days.', '', { okLabel: 'Save leftovers' });
    const n = Number(left);
    let saved = '';
    if (left && n > 0) {
      try {
        await api(`${base}/recipes/${id}/leftovers`, { body: { servings: n } });
        saved = `. Saved ${n} serving${n === 1 ? '' : 's'} of leftovers`;
      } catch (e) {
        saved = `. Leftovers weren't saved: ${(e as Error).message}`;
      }
    }
    // Shown after the leftovers question, so its Undo isn't hidden behind that pop-up while it counts down.
    toast(`Used ${r.used.length} pantry items${r.skipped.length ? `; not in pantry: ${r.skipped.join(', ')}` : ''}${saved}`,
      r.historyIds.length ? () => api(`${base}/history/undo`, { body: { ids: r.historyIds } }) : undefined);
  }

  async function toList(all: boolean) {
    const r = await api<{ added: unknown[] }>(`${base}/recipes/${id}/to-shopping`, { body: { servings, all } });
    toast(r.added.length ? `Added ${r.added.length} items to the shopping list` : 'You already have everything');
  }

  async function meta(change: { favorite?: boolean; rating?: number | null; notes?: string; collections?: string[] }) {
    await api(`${base}/recipes/${id}/meta`, { method: 'PATCH', body: change });
    void reload();
  }

  async function addToCollection() {
    const name = (await dialogs.prompt('Add to which collection? (e.g. Weeknight, Holidays)', '', { okLabel: 'Add' }))?.trim();
    if (name && !recipe!.collections.includes(name)) await meta({ collections: [...recipe!.collections, name] });
  }

  async function share() {
    const r = await api<{ isPublic: boolean; shareUrl: string | null }>(`${base}/recipes/${id}/share`, { body: { public: !recipe!.isPublic } });
    if (r.shareUrl) {
      const url = `${location.origin}${r.shareUrl}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast('Shared! Link copied.');
    } else toast('No longer shared');
    void reload();
  }

  async function plan() {
    await api(`${base}/mealplan`, { body: { date: planDate, slot: 'dinner', recipeId: id } });
    setPlanDate(null);
    toast('Added to the meal plan');
  }

  return (
    <div className={`stack${cookMode ? ' cook-mode' : ''}`}>
      <div className="topbar">
        <button className="ghost" onClick={() => nav(-1)}>← Back</button>
        <h1>{recipe.title}</h1>
        <button onClick={() => { setCookMode(!cookMode); setStepAt(0); }}>{cookMode ? 'Exit cook mode' : '👩‍🍳 Cook mode'}</button>
        <Link className="btn" to={`/recipes/${id}/edit`}>✏️ Edit</Link>
      </div>
      {recipe.image && !cookMode && <img src={recipe.image} alt="" style={{ borderRadius: 20, maxHeight: 380, objectFit: 'cover', width: '100%' }} />}
      <div className="row">
        <span className={`pill ${cls}`}>{label}</span>
        {recipe.prepMinutes && <span className="pill">Prep {minutes(recipe.prepMinutes)}</span>}
        {recipe.cookMinutes && <span className="pill">Cook {minutes(recipe.cookMinutes)}</span>}
        {recipe.tags.map((t) => <span key={t} className="pill">{t}</span>)}
        {recipe.sourceUrl && <a className="small" href={recipe.sourceUrl} target="_blank" rel="noreferrer">Original</a>}
      </div>
      {!cookMode && (
        <div className="row">
          <button className={`chip${recipe.favorite ? ' on' : ''}`} aria-pressed={recipe.favorite} onClick={() => meta({ favorite: !recipe.favorite })}>
            {recipe.favorite ? '★ Favorite' : '☆ Favorite'}
          </button>
          <fieldset className="stars"><legend className="sr-only">Rating</legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="star" aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={recipe.rating === n}
                onClick={() => meta({ rating: recipe.rating === n ? null : n })}>{recipe.rating && n <= recipe.rating ? '★' : '☆'}</button>
            ))}
          </fieldset>
          <span className="chips">
            {recipe.collections.map((c) => (
              <button key={c} className="chip" onClick={() => meta({ collections: recipe.collections.filter((x) => x !== c) })} aria-label={`Take out of ${c}`}>📁 {c} ✕</button>
            ))}
            <button className="chip" onClick={addToCollection}>📁 ＋ Collection</button>
          </span>
          <span className="small muted">
            {recipe.cookCount ? `Cooked ${recipe.cookCount} time${recipe.cookCount === 1 ? '' : 's'}, last on ${new Date(`${recipe.lastCooked!.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Not cooked yet'}
          </span>
        </div>
      )}
      {!!recipe.dietClashes.length && (
        <div className="card diet-warning" role="note">
          <strong>⚠️ Heads up</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {recipe.dietClashes.map((c) => <li key={`${c.ingredient}-${c.person}-${c.reason}`}>{c.ingredient}: {c.person}, {c.reason}</li>)}
          </ul>
        </div>
      )}
      {recipe.description && !cookMode && <p style={{ whiteSpace: 'pre-wrap' }}>{recipe.description}</p>}
      {cookMode && recipe.instructions.length > 0 && (
        <div className="card cook-focus stack" aria-live="polite">
          <div className="muted small">Step {stepAt + 1} of {recipe.instructions.length}</div>
          <p className="cook-focus-step">{units === 'us' ? celsiusToFahrenheitText(recipe.instructions[stepAt]) : recipe.instructions[stepAt]}</p>
          <StepTimers step={recipe.instructions[stepAt]} title={recipe.title} />
          <div className="row">
            <button className="ghost" onClick={() => say(`Step ${stepAt + 1}. ${units === 'us' ? celsiusToFahrenheitText(recipe.instructions[stepAt]) : recipe.instructions[stepAt]}`)}>🔊 Read aloud</button>
            {canListen() && (
              <button className={voice ? 'primary' : 'ghost'} aria-pressed={voice} onClick={() => {
                if (!voice) say(`Listening. Say next, back, repeat, or set a timer. Step ${stepAt + 1}. ${recipe.instructions[stepAt]}`);
                setVoice(!voice);
              }}>{voice ? '🎙 Listening…' : '🎙 Hands-free'}</button>
            )}
          </div>
          {voiceOn && <div className="small muted">{voiceError ?? (heard ? `Heard: “${heard}”` : 'Try “next”, “back”, “repeat”, “how much flour” or “set a timer for 10 minutes”.')}</div>}
          <div className="row">
            <button disabled={stepAt === 0} onClick={() => setStepAt(stepAt - 1)}>← Back</button>
            <span className="spacer" />
            {stepAt < recipe.instructions.length - 1
              ? <button className="primary" onClick={() => { setDone((d) => new Set(d).add(stepAt)); setStepAt(stepAt + 1); }}>Next step →</button>
              : <button className="primary" onClick={() => { setDone((d) => new Set(d).add(stepAt)); void cook(); }}>🍳 Done, I cooked this</button>}
          </div>
        </div>
      )}
      <div className="row">
        <button className="primary" onClick={cook}>🍳 I cooked this</button>
        <button onClick={() => toList(false)}>🛒 Add missing to list</button>
        <button onClick={() => toList(true)}>🛒 Add all</button>
        <button onClick={() => setPlanDate(todayIso())}>📅 Plan it</button>
        <button onClick={share}>{recipe.isPublic ? '🌍 Stop sharing' : '🔗 Share publicly'}</button>
        <button onClick={() => window.print()}>🖨 Print</button>
      </div>
      {planDate !== null && (
        <div className="card row">
          <input type="date" aria-label="Day to cook it" value={planDate} onChange={(e) => setPlanDate(e.target.value)} style={{ maxWidth: 220 }} />
          <button className="primary" onClick={plan}>Add for dinner</button>
          <button className="ghost" onClick={() => setPlanDate(null)}>Cancel</button>
        </div>
      )}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row">
            <h2 style={{ margin: 0, flex: 1 }}>Ingredients</h2>
            {recipe.servings && (
              <div className="row">
                <button className="icon" onClick={() => setServings(Math.max(1, (servings ?? recipe.servings!) - 1))}>−</button>
                <span>{servings ?? recipe.servings} servings</span>
                <button className="icon" onClick={() => setServings((servings ?? recipe.servings!) + 1)}>+</button>
              </div>
            )}
          </div>
          <ul className="ingredients" style={{ paddingLeft: 0, listStyle: 'none' }}>
            {recipe.ingredients.map((i, n) => {
              const [c, l] = AVAIL[i.availability];
              const ticked = cookMode && got.has(n);
              return (
                <li key={n} className={`row${ticked ? ' got' : ''}`} style={{ flexWrap: 'nowrap' }}>
                  <button className={`pill ${c}`} style={{ minWidth: 56, minHeight: 36, justifyContent: 'center', border: 'none', cursor: 'pointer' }}
                    title="Choose which pantry item this is" onClick={() => setMatching(i.name)}>{l}</button>
                  {cookMode && (
                    <input type="checkbox" className="got-box" aria-label={`Got ${i.name} ready`} checked={ticked}
                      onChange={() => setGot((g) => { const x = new Set(g); if (x.has(n)) x.delete(n); else x.add(n); return x; })} />
                  )}
                  <span>
                    <strong>{amount(i.quantity == null ? null : i.quantity * factor, i.unit, units)}</strong> {i.name}
                    {i.note && <span className="muted">, {i.note}</span>}
                    {i.optional && <span className="muted"> (optional)</span>}
                    {!!i.matched?.length && i.matched.join().toLowerCase() !== i.name.toLowerCase() && (
                      <span className="small muted" style={{ display: 'block' }}>{i.linked ? '📌 ' : 'using '}{i.matched.join(', ')}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card">
          <h2>Steps</h2>
          <ol className="steps">
            {recipe.instructions.map((s, n) => (
              <li key={n} className={done.has(n) ? 'done' : ''}>
                <button className="step" aria-pressed={done.has(n)} onClick={() => setDone((d) => { const x = new Set(d); if (x.has(n)) x.delete(n); else x.add(n); return x; })}>
                  {units === 'us' ? celsiusToFahrenheitText(s) : s}
                </button>
                <StepTimers step={s} title={recipe.title} />
              </li>
            ))}
          </ol>
          {!recipe.instructions.length && <p className="muted">No steps written down.</p>}
        </div>
      </div>
      {!cookMode && <NutritionCard recipeId={recipe.id} nutrition={recipe.nutrition} onChange={() => void reload()} />}
      <label className="field card">📝 Our notes
        <textarea key={recipe.notes} defaultValue={recipe.notes} rows={3} placeholder="Double the garlic. Kids liked it with rice."
          onBlur={(e) => { if (e.target.value !== recipe.notes) void meta({ notes: e.target.value }); }} />
      </label>
      <div className="row">
        <span className="spacer" />
        <button className="danger" onClick={async () => { if (await dialogs.confirm('Delete this recipe?', { okLabel: 'Delete', danger: true })) { await api(`${base}/recipes/${id}`, { method: 'DELETE' }); nav('/recipes'); } }}>Delete recipe</button>
      </div>
      {matching && <MatchPicker ingredient={matching} onClose={(changed) => { setMatching(null); if (changed) void reload(); }} />}
      <div>
      </div>
    </div>
  );
}
