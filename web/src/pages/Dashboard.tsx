import { Link } from 'react-router-dom';
import { useApp, useLoad } from '../state.tsx';
import { KitchenScene } from '../components/Raccoon.tsx';

interface Summary {
  shopping_count: number;
  low_stock_count: number;
  low_stock: string[];
  expiring_soon: { name: string; date: string }[];
  todays_meals: { slot: string; title: string; cooked: boolean }[];
  tonight: string | null;
  ready_to_cook_count: number;
  ready_to_cook: string[];
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5 || h >= 22) return 'Late-night snack run';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard() {
  const { me, home, base } = useApp();
  const [s] = useLoad<Summary>(`${base}/ha/summary`);

  return (
    <div className="stack">
      <div className="hero">
        <KitchenScene variant={me?.user.avatar} />
        <div className="stack">
          <h1>{greeting()}, {me?.user.name}</h1>
          <p className="muted" style={{ margin: 0 }}>{home?.name}</p>
          <div className="card">
            <div className="muted small">Tonight</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{s?.tonight ?? 'Nothing planned yet'}</div>
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
          {!!s?.expiring_soon.length && <span className="muted small">{s.expiring_soon.map((e) => e.name).join(', ')}</span>}
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
