import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { RecipeSummary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { minutes } from '../format.ts';

export const READY_LABEL = { ready: ['ok', '✅ Ready to cook'], almost: ['warn', '🟡 Almost'], missing: ['bad', 'Missing items'] } as const;

export function Recipes() {
  const { base } = useApp();
  const [params, setParams] = useSearchParams();
  const [recipes] = useLoad<RecipeSummary[]>(`${base}/recipes`);
  const [q, setQ] = useState('');
  const readyOnly = params.get('ready') === '1';
  const [tag, setTag] = useState<string | null>(null);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recipes ?? []) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => t);
  }, [recipes]);

  const shown = (recipes ?? []).filter((r) =>
    (!q || r.title.toLowerCase().includes(q.toLowerCase()) || r.tags.some((t) => t.includes(q.toLowerCase()))) &&
    (!readyOnly || r.ready === 'ready') && (!tag || r.tags.includes(tag)));

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
        <button className={`chip${readyOnly ? ' on' : ''}`} onClick={() => setParams(readyOnly ? {} : { ready: '1' })}>✅ Ready to cook</button>
      </div>
      {!!tags.length && (
        <div className="chips">
          {tags.map((t) => <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)}>{t}</button>)}
        </div>
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
                <span className="title">{r.title}</span>
                <div className="row small muted">
                  {r.totalMinutes && <span>⏱ {minutes(r.totalMinutes)}</span>}
                  {r.servings && <span>🍽 {r.servings}</span>}
                  {r.isPublic && <span>🌍</span>}
                </div>
                <span className={`pill ${cls}`} title={r.missing.join(', ')}>{label}{r.ready !== 'ready' && r.missing.length ? ` (${r.missing.length})` : ''}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
