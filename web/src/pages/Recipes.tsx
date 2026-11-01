import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { RecipeSummary } from '../api.ts';
import { useUrlState } from '../urlState.ts';
import { useApp, useLoad } from '../state.tsx';
import { minutes } from '../format.ts';

export const READY_LABEL = { ready: ['ok', '✅ Ready to cook'], almost: ['warn', '🟡 Almost'], missing: ['bad', 'Missing items'] } as const;

export function Recipes() {
  const { base } = useApp();
  const [params, setParams] = useSearchParams();
  const [recipes] = useLoad<RecipeSummary[]>(`${base}/recipes`);
  const [q, setQ] = useUrlState('q');
  const readyOnly = params.get('ready') === '1';
  const useUp = params.get('useup') === '1';
  const favs = params.get('fav') === '1';
  const gearOnly = params.get('gear') === '1';
  const anyGearFlags = (recipes ?? []).some((r) => r.missingTools.length);
  const collection = params.get('col');
  const maxMinutes = Number(params.get('time')) || null;
  const [tagParam, setTagParam] = useUrlState('tag');
  const tag = tagParam || null;
  const setTag = (t: string | null) => setTagParam(t ?? '');

  const collections = useMemo(() => [...new Set((recipes ?? []).flatMap((r) => r.collections))].sort(), [recipes]);
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recipes ?? []) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => t);
  }, [recipes]);

  const shown = (recipes ?? []).filter((r) =>
    (!q || r.title.toLowerCase().includes(q.toLowerCase()) || r.tags.some((t) => t.includes(q.toLowerCase()))) &&
    (!readyOnly || r.ready === 'ready') && (!useUp || r.usesExpiring.length > 0) && (!favs || r.favorite) && (!gearOnly || !r.missingTools.length) && (!collection || r.collections.includes(collection)) &&
    (!maxMinutes || (r.totalMinutes != null && r.totalMinutes <= maxMinutes)) && (!tag || r.tags.includes(tag)));
  // Using up the most food that's about to go off comes first.
  if (useUp) shown.sort((a, b) => b.usesExpiring.length - a.usesExpiring.length);
  const toggle = (key: 'ready' | 'useup' | 'fav' | 'gear', on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.delete(key); else next.set(key, '1');
    setParams(next);
  };

  return (
    <div className="stack">
      <div className="topbar">
        <h1>Recipes</h1>
        <Link className="btn" to="/recipes/community">🌍 Shared</Link>
        <Link className="btn" to="/recipes/import">⬇️ Import</Link>
        <Link className="btn primary" to="/recipes/new">＋ New</Link>
      </div>
      <div className="row">
        <input placeholder="Search recipes or tags" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} />
        <button className={`chip${readyOnly ? ' on' : ''}`} onClick={() => toggle('ready', readyOnly)}>✅ Ready to cook</button>
        <button className={`chip${useUp ? ' on' : ''}`} onClick={() => toggle('useup', useUp)}>⏳ Use it up</button>
        <button className={`chip${favs ? ' on' : ''}`} onClick={() => toggle('fav', favs)}>★ Favorites</button>
        {(anyGearFlags || gearOnly) && <button className={`chip${gearOnly ? ' on' : ''}`} onClick={() => toggle('gear', gearOnly)}>🍳 I have the gear</button>}
        {[30, 60].map((m) => (
          <button key={m} className={`chip${maxMinutes === m ? ' on' : ''}`} onClick={() => setParam('time', maxMinutes === m ? null : String(m))}>⏱ {m} min or less</button>
        ))}
      </div>
      {!!collections.length && (
        <div className="chips">
          {collections.map((c) => (
            <button key={c} className={`chip${collection === c ? ' on' : ''}`} onClick={() => setParam('col', collection === c ? null : c)}>📁 {c}</button>
          ))}
        </div>
      )}
      {!!tags.length && (
        <div className="chips">
          {tags.map((t) => <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)}>{t}</button>)}
        </div>
      )}
      {useUp && recipes && !shown.length && (
        <div className="card">None of your recipes use what's expiring soon. <Link to="/chef?ask=useup">Ask Gordy for an idea</Link>.</div>
      )}
      {recipes && !recipes.length && (
        <div className="card">No recipes yet. Add one, paste a link, or bring everything over from KitchenOwl with <Link to="/recipes/import">Import</Link>.</div>
      )}
      <div className="recipe-grid">
        {shown.map((r) => {
          const [cls, label] = READY_LABEL[r.ready];
          return (
            <Link key={r.id} to={`/recipes/${r.id}`} className="card recipe-card">
              <div className="cover">{r.image ? <img src={r.image} alt="" loading="lazy" /> : '🍲'}</div>
              <div className="body">
                <span className="title">{r.favorite && <span title="Favorite">★ </span>}{r.title}</span>
                <div className="row small muted">
                  {r.totalMinutes && <span>⏱ {minutes(r.totalMinutes)}</span>}
                  {r.servings && <span>🍽 {r.servings}</span>}
                  {r.isPublic && <span>🌍</span>}
                  {r.rating && <span title={`${r.rating} stars`}>{'★'.repeat(r.rating)}</span>}
                </div>
                {!!r.dietWarnings && <span className="small" style={{ color: 'var(--danger)' }}>⚠️ Check diets and allergies</span>}
                {!!r.missingTools.length && <span className="small" style={{ color: 'var(--warn)' }}>🍳 Needs {r.missingTools.join(', ')}</span>}
                {!!r.usesExpiring.length && <span className="small" style={{ color: 'var(--warn)' }}>⏳ Uses up {r.usesExpiring.join(', ')}</span>}
                <span className={`pill ${cls}`} title={r.missing.join(', ')}>{label}{r.ready !== 'ready' && r.missing.length ? ` (${r.missing.length})` : ''}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
