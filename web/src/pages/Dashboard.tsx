import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { KitchenScene } from '../components/Raccoon.tsx';
import { UpdateBanner } from '../components/UpdateBanner.tsx';

interface Summary {
  shopping_count: number;
  low_stock_count: number;
  low_stock: string[];
  expiring_soon: { name: string; date: string }[];
  todays_meals: { slot: string; title: string; cooked: boolean; cook: string | null }[];
  tonight: string | null;
  tonight_cook: string | null;
  ready_to_cook_count: number;
  ready_to_cook: string[];
  recipe_count: number;
  item_count: number;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5 || h >= 22) return 'Late-night snack run';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First visit to an empty home: where to start, or a sample kitchen to look around. */
function Welcome({ onDone }: { onDone: () => void }) {
  const { base, home, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const r = await api<{ recipes: number; items: number }>(`${base}/sample-data`, { body: {} });
      toast(`Added ${r.recipes} recipes and ${r.items} pantry items to try things out`);
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="card stack welcome">
      <h2 style={{ margin: 0 }}>Welcome to Nighttime Ninja 🦝</h2>
      <p className="muted" style={{ margin: 0 }}>Here's how most kitchens get going:</p>
      <ol className="welcome-steps">
        <li><Link to="/inventory">Add what's in your pantry</Link>, or scan barcodes as you put groceries away.</li>
        <li><Link to="/recipes/import">Bring in recipes</Link> from any recipe website, or paste one in.</li>
        <li><Link to="/plan">Plan a few dinners</Link> and let the app fill your shopping list.</li>
        <li><Link to="/settings">Invite your household</Link> with the home's join code.</li>
      </ol>
      <div className="row">
        {home?.role === 'manager' && <button className="primary" disabled={busy} onClick={load}>🧺 Load a sample kitchen</button>}
        <button className="ghost" onClick={onDone}>I'll start from scratch</button>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { me, home, base, homeId } = useApp();
  const [s, reload] = useLoad<Summary>(`${base}/ha/summary`);
  const welcomeKey = `nn-welcomed-${homeId}`;
  const [welcomed, setWelcomed] = useState(() => { try { return !!localStorage.getItem(welcomeKey); } catch { return false; } });
  const dismiss = () => {
    try { localStorage.setItem(welcomeKey, '1'); } catch { /* private mode */ }
    setWelcomed(true);
    void reload();
  };

  return (
    <div className="stack">
      <UpdateBanner />
      {s && !welcomed && !s.recipe_count && !s.item_count && <Welcome onDone={dismiss} />}
      <div className="hero">
        <KitchenScene variant={me?.user.avatar} />
        <div className="stack">
          <h1>{greeting()}, {me?.user.name}</h1>
          <p className="muted" style={{ margin: 0 }}>{home?.name}</p>
          <div className="card">
            <div className="muted small">Tonight</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{s?.tonight ?? 'Nothing planned yet'}</div>
            {s?.tonight_cook && <div className="muted">👩‍🍳 {s.tonight_cook} is cooking</div>}
            <div className="row" style={{ marginTop: 10 }}>
              <Link className="btn" to="/plan">📅 Plan meals</Link>
              <Link className="btn" to="/recipes?ready=1">✅ What can I cook?</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <Link to="/shopping" className="card stat" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="num">{s?.shopping_count ?? '–'}</span>
          <span>on the shopping list</span>
        </Link>
        <Link to="/recipes?ready=1" className="card stat" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="num">{s?.ready_to_cook_count ?? '–'}</span>
          <span>recipes ready to cook</span>
          {!!s?.ready_to_cook.length && <span className="muted small">{s.ready_to_cook.slice(0, 4).join(', ')}</span>}
        </Link>
        <Link to="/inventory?low=1" className="card stat" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="num" style={{ color: s?.low_stock_count ? 'var(--warn)' : undefined }}>{s?.low_stock_count ?? '–'}</span>
          <span>running low</span>
          {!!s?.low_stock.length && <span className="muted small">{s.low_stock.slice(0, 5).join(', ')}</span>}
        </Link>
        <div className="card stat">
          <span className="num" style={{ color: s?.expiring_soon.length ? 'var(--danger)' : undefined }}>{s?.expiring_soon.length ?? '–'}</span>
          <span>expiring in 3 days</span>
          {!!s?.expiring_soon.length && (
            <>
              <span className="muted small">{s.expiring_soon.map((e) => e.name).join(', ')}</span>
              <div className="row" style={{ marginTop: 6 }}>
                <Link className="btn" to="/recipes?useup=1">⏳ Use it up</Link>
                <Link className="btn" to="/chef?ask=useup">👨‍🍳 Ask Gordy</Link>
              </div>
            </>
          )}
        </div>
      </div>

      {!!s?.todays_meals.length && (
        <div className="card">
          <h2>Today</h2>
          <div className="stack">
            {s.todays_meals.map((m, i) => (
              <div key={i} className="meal">
                <span className="slot">{m.slot}</span>
                <span className={m.cooked ? 'done' : ''}>{m.title}</span>
                {m.cook && <span className="small muted">👩‍🍳 {m.cook}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
