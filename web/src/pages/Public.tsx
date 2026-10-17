import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type RecipeFull } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { amount, minutes } from '../format.ts';
import { RaccoonAvatar } from '../components/Raccoon.tsx';

type PublicRecipeData = Omit<RecipeFull, 'id' | 'status' | 'missing'>;

/** A shared recipe page anyone with the link can read. */
export function PublicRecipe() {
  const { slug } = useParams();
  const { me, base, home, toast } = useApp();
  const nav = useNavigate();
  const [r, , error] = useLoad<PublicRecipeData>(`/api/public/recipes/${slug}`);

  async function save() {
    const { id } = await api<{ id: string }>(`${base}/recipes/copy/${slug}`, { body: {} });
    toast('Saved to your recipes');
    nav(`/recipes/${id}`);
  }

  if (error) return <div className="center-screen"><div className="card">That recipe isn't shared anymore.</div></div>;
  if (!r) return null;
  return (
    <div className="main" style={{ margin: '0 auto', maxWidth: 900 }}>
      <div className="stack">
        <div className="row"><RaccoonAvatar variant="chef" size={48} /><strong>Nighttime Ninja</strong></div>
        <h1>{r.title}</h1>
        {r.image && <img src={r.image} alt="" style={{ borderRadius: 20, maxHeight: 400, objectFit: 'cover', width: '100%' }} />}
        <div className="row">
          {r.servings && <span className="pill">Serves {r.servings}</span>}
          {r.prepMinutes && <span className="pill">Prep {minutes(r.prepMinutes)}</span>}
          {r.cookMinutes && <span className="pill">Cook {minutes(r.cookMinutes)}</span>}
          {me && home && <button className="primary" onClick={save}>Save to {home.name}</button>}
        </div>
        {r.description && <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>}
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <h2>Ingredients</h2>
            <ul className="ingredients">
              {r.ingredients.map((i, n) => <li key={n}><strong>{amount(i.quantity, i.unit, me?.user.units)}</strong> {i.name}{i.note && `, ${i.note}`}</li>)}
            </ul>
          </div>
          <div className="card">
            <h2>Steps</h2>
            <ol className="steps">{r.instructions.map((s, n) => <li key={n}>{s}</li>)}</ol>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Recipes shared publicly by anyone on this server. */
export function Community() {
  const [q, setQ] = useState('');
  const [list] = useLoad<{ title: string; image: string | null; slug: string; tags: string[]; from: string }[]>(`/api/public/recipes?q=${encodeURIComponent(q)}`, [q]);
  return (
    <div className="stack">
      <div className="topbar"><h1>Shared recipes</h1></div>
      <p className="muted" style={{ margin: 0 }}>Recipes people on this server have shared. Open one and tap “Save” to copy it into your home.</p>
      <input placeholder="Search shared recipes" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} />
      <div className="recipe-grid">
        {list?.map((r) => (
          <Link key={r.slug} to={`/r/${r.slug}`} className="card recipe-card">
            <div className="cover">{r.image ? <img src={r.image} alt="" loading="lazy" /> : '🍲'}</div>
            <div className="body"><span className="title">{r.title}</span><span className="small muted">from {r.from}</span></div>
          </Link>
        ))}
      </div>
      {list && !list.length && <div className="card">Nothing shared yet. Open any recipe and tap “Share publicly”.</div>}
    </div>
  );
}
