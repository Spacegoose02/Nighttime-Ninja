import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type RecipeFull } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { amount, minutes, todayIso } from '../format.ts';
import { celsiusToFahrenheitText } from '../../../shared/units.ts';
import { READY_LABEL } from './Recipes.tsx';

const AVAIL = { have: ['ok', '✓'], unknown: ['ok', '✓'], low: ['warn', 'low'], missing: ['bad', 'need'] } as const;

export function RecipeDetail() {
  const { id } = useParams();
  const { base, me, toast } = useApp();
  const nav = useNavigate();
  const [servings, setServings] = useState<number | null>(null);
  const [recipe, reload] = useLoad<RecipeFull>(`${base}/recipes/${id}${servings ? `?servings=${servings}` : ''}`, [servings]);
  const [cookMode, setCookMode] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [planDate, setPlanDate] = useState<string | null>(null);

  if (!recipe) return <div className="card">Loading…</div>;
  const factor = servings && recipe.servings ? servings / recipe.servings : 1;
  const units = me?.user.units ?? 'us';
  const [cls, label] = READY_LABEL[recipe.status];

  async function cook() {
    if (!confirm(`Take the ingredients for ${recipe!.title} out of the pantry?`)) return;
    const r = await api<{ used: unknown[]; skipped: string[] }>(`${base}/recipes/${id}/cook`, { body: { servings } });
    toast(`Used ${r.used.length} pantry items${r.skipped.length ? `; not in pantry: ${r.skipped.join(', ')}` : ''}`);
    void reload();
  }

  async function toList(all: boolean) {
    const r = await api<{ added: unknown[] }>(`${base}/recipes/${id}/to-shopping`, { body: { servings, all } });
    toast(r.added.length ? `Added ${r.added.length} items to the shopping list` : 'You already have everything');
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
        <button onClick={() => setCookMode(!cookMode)}>{cookMode ? 'Exit cook mode' : '👩‍🍳 Cook mode'}</button>
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
      {recipe.description && !cookMode && <p style={{ whiteSpace: 'pre-wrap' }}>{recipe.description}</p>}
      <div className="row">
        <button className="primary" onClick={cook}>🍳 I cooked this</button>
        <button onClick={() => toList(false)}>🛒 Add missing to list</button>
        <button onClick={() => toList(true)}>🛒 Add all</button>
        <button onClick={() => setPlanDate(todayIso())}>📅 Plan it</button>
        <button onClick={share}>{recipe.isPublic ? '🌍 Stop sharing' : '🔗 Share publicly'}</button>
      </div>
      {planDate !== null && (
        <div className="card row">
          <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} style={{ maxWidth: 220 }} />
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
              return (
                <li key={n} className="row" style={{ flexWrap: 'nowrap' }}>
                  <span className={`pill ${c}`} style={{ minWidth: 48, justifyContent: 'center' }}>{l}</span>
                  <span>
                    <strong>{amount(i.quantity == null ? null : i.quantity * factor, i.unit, units)}</strong> {i.name}
                    {i.note && <span className="muted">, {i.note}</span>}
                    {i.optional && <span className="muted"> (optional)</span>}
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
              <li key={n} className={done.has(n) ? 'done' : ''} onClick={() => setDone((d) => { const x = new Set(d); if (x.has(n)) x.delete(n); else x.add(n); return x; })} style={{ cursor: 'pointer' }}>
                {units === 'us' ? celsiusToFahrenheitText(s) : s}
              </li>
            ))}
          </ol>
          {!recipe.instructions.length && <p className="muted">No steps written down.</p>}
        </div>
      </div>
      <div className="row">
        <span className="spacer" />
        <button className="danger" onClick={async () => { if (confirm('Delete this recipe?')) { await api(`${base}/recipes/${id}`, { method: 'DELETE' }); nav('/recipes'); } }}>Delete recipe</button>
      </div>
    </div>
  );
}
