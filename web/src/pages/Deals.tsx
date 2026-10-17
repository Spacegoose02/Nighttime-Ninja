import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useLoad } from '../state.tsx';

interface StoreLink { id: string; name: string; color: string; searchUrl: string | null; weeklyAdUrl: string; couponsUrl: string }
interface Deal { store: string; name: string; brand: string | null; size: string | null; price: number | null; salePrice: number | null; onSale: boolean; image: string | null; url: string; forItem?: string }

const money = (n: number | null) => (n == null ? '' : `$${n.toFixed(2)}`);

function DealCard({ d }: { d: Deal }) {
  return (
    <a className="card row" href={d.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit', flexWrap: 'nowrap' }}>
      {d.image && <img src={d.image} alt="" style={{ width: 72, height: 72, objectFit: 'contain', background: '#fff', borderRadius: 10 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{d.name}</div>
        <div className="small muted">{[d.brand, d.size, d.forItem && `for “${d.forItem}”`].filter(Boolean).join(' · ')}</div>
        <div className="row">
          {d.onSale ? (
            <>
              <span className="pill ok">{money(d.salePrice)}</span>
              <span className="small muted" style={{ textDecoration: 'line-through' }}>{money(d.price)}</span>
            </>
          ) : <span className="pill">{money(d.price)}</span>}
        </div>
      </div>
    </a>
  );
}

export function Deals() {
  const { base } = useApp();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data] = useLoad<{ stores: StoreLink[]; live: Deal[]; liveError: string | null }>(`${base}/deals?q=${encodeURIComponent(query)}`, [query]);
  const [mine] = useLoad<{ available: boolean; deals: Deal[] }>(`${base}/deals/my-list`);

  return (
    <div className="stack">
      <div className="topbar"><h1>Deals & coupons</h1></div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <input placeholder="Search every store for…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, maxWidth: 480 }} />
        <button className="primary">Search</button>
      </form>

      {!!mine?.deals.length && (
        <div className="stack">
          <h2>🏷️ On sale from your shopping list</h2>
          <div className="grid-2">{mine.deals.map((d, i) => <DealCard key={i} d={d} />)}</div>
        </div>
      )}

      {!!data?.live.length && (
        <div className="stack">
          <h2>Kroger prices</h2>
          <div className="grid-2">{data.live.map((d, i) => <DealCard key={i} d={d} />)}</div>
        </div>
      )}
      {data?.liveError && <p className="small" style={{ color: 'var(--danger)' }}>{data.liveError}</p>}

      <h2>Your stores</h2>
      <div className="grid-2">
        {data?.stores.map((s) => (
          <div key={s.id} className="card stack" style={{ borderTop: `6px solid ${s.color}` }}>
            <h3 style={{ margin: 0 }}>{s.name}</h3>
            <div className="row">
              {s.searchUrl && <a className="btn primary" href={s.searchUrl} target="_blank" rel="noreferrer">Search “{query}”</a>}
              <a className="btn" href={s.weeklyAdUrl} target="_blank" rel="noreferrer">Weekly ad</a>
              <a className="btn" href={s.couponsUrl} target="_blank" rel="noreferrer">Coupons</a>
            </div>
          </div>
        ))}
      </div>
      {mine && !mine.available && (
        <p className="small muted">
          Live prices and automatic sale-matching use the free Kroger API (Kroger, Harris Teeter, Ralphs, Fred Meyer and more).
          Add Kroger keys to the server and pick your store in <Link to="/settings">Settings</Link>. Walmart, Food Lion, BJ's and Sam's Club don't offer public price APIs, so they open in their own sites.
        </p>
      )}
    </div>
  );
}
