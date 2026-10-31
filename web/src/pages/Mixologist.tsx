import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chat, type ChatPersona } from '../components/Chat.tsx';
import { api, tileState, type HomeDetail, type Item, type RecipeFull, type RecipeSummary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { useUrlState } from '../urlState.ts';
import { amount } from '../format.ts';
import { formatQuantity } from '../../../shared/units.ts';
import { BAR_UNITS, barConvert, batchDrink, bottlesOf750 } from '../../../shared/bar.ts';
import { CATEGORIES, LOCATIONS } from '../../../shared/catalog.ts';
import { READY_LABEL } from './Recipes.tsx';
import { ItemArt, ItemEditor, type Labels } from './Inventory.tsx';

type Tab = 'chat' | 'ideas' | 'drinks' | 'bar' | 'convert';
const TABS: [Tab, string][] = [['chat', '💬 Chat'], ['ideas', '💡 Idea Zone'], ['drinks', '🍹 Drinks'], ['bar', '🍾 Bar'], ['convert', '⚖️ Converter']];

const isBar = (i: Item) => i.category.toLowerCase() === 'bar' || i.location.toLowerCase() === 'bar';

export function Mixologist() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'chat') as Tab;
  const [status] = useLoad<{ available: boolean }>('/api/mixologist/status');

  return (
    <div className="stack">
      <div className="topbar">
        <h1>🍸 Mixologist</h1>
        <div className="chips">
          {TABS.map(([t, label]) => <button key={t} className={`chip${tab === t ? ' on' : ''}`} onClick={() => setParams(t === 'chat' ? {} : { tab: t })}>{label}</button>)}
        </div>
      </div>
      {(tab === 'chat' || tab === 'ideas') && status && !status.available && <SetupCard />}
      {tab === 'chat' && <Chat disabled={!status?.available} persona={ROCCO} />}
      {tab === 'ideas' && <IdeaZone disabled={!status?.available} />}
      {tab === 'drinks' && <Drinks />}
      {tab === 'bar' && <Bar />}
      {tab === 'convert' && <Converter />}
    </div>
  );
}

function SetupCard() {
  return (
    <div className="card stack">
      <strong>The Mixologist needs a Claude API key</strong>
      <span className="muted">
        Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>, set it as <code>ANTHROPIC_API_KEY</code> on
        the server (your <code>.env</code> file, or the Unraid template), and restart. The key stays on your server. Drinks, Bar and the Converter work without it.
      </span>
    </div>
  );
}

/* ---------- Chat ---------- */

const STARTERS = [
  'What can I make right now?',
  'Something tropical with rum',
  'A strong, spirit-forward sipper',
  'Teach me to make a classic margarita',
  'Party punch for 10 people',
];

const ROCCO: ChatPersona = {
  endpoint: 'mixologist/chat',
  name: 'Rocco Rocks',
  avatar: '/avatars/rocco-rocks.png',
  emoji: '🍸',
  intro: "Hey, I'm Rocco Rocks, your mixologist. Ask me anything about drinks. I can see what's in your bar and pantry, or just tell me: “I need a good drink. I have triple sec, coconut rum, pineapple juice…”",
  starters: STARTERS,
  placeholder: 'What are you in the mood for?',
  thinking: 'Rocco is shaking something up…',
};

/* ---------- Idea Zone ---------- */

interface IdeaIngredient { name: string; quantity: number | null; unit: string | null; note: string | null; optional: boolean; availability: 'have' | 'low' | 'missing' | 'unknown' }
interface Idea { title: string; description: string; glass: string; garnish: string | null; ingredients: IdeaIngredient[]; instructions: string[]; style: string | null; missing: string[]; status: 'ready' | 'almost' | 'missing' }

const STYLES = ['Tropical', 'Sour & citrusy', 'Sweet & creamy', 'Fruity & fizzy', 'Strong & spirit-forward', 'Frozen', 'Party punch', 'Low-alcohol', 'Mocktail', 'Surprise me'];

function ingredientLine(i: { name: string; quantity: number | null; unit: string | null; note: string | null }) {
  const qty = i.quantity == null ? '' : `${formatQuantity(i.quantity)}${i.unit ? ` ${i.unit === 'fl oz' ? 'oz' : i.unit}` : ''} `;
  return `${qty}${i.name}${i.note ? ` (${i.note})` : ''}`;
}

function IdeaCard({ d }: { d: Idea }) {
  const { base, toast } = useApp();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [listed, setListed] = useState(false);
  const label = d.status === 'ready' ? ['ok', '✅ Make it now'] : d.status === 'almost' ? ['warn', `🟡 Missing ${d.missing.length}`] : ['bad', `Missing ${d.missing.length}`];

  async function save() {
    const { id } = await api<{ id: string }>(`${base}/mixologist/save`, { body: { drink: d } });
    setSavedId(id);
    toast(`${d.title} saved to Drinks`);
  }

  async function addMissing() {
    for (const name of d.missing) await api(`${base}/shopping`, { body: { name, note: `for ${d.title}` } });
    setListed(true);
    toast(`Added ${d.missing.join(', ')} to the shopping list`);
  }

  return (
    <div className="card stack">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <h3 style={{ margin: 0, flex: 1 }}>{d.title}</h3>
        <span className={`pill ${label[0]}`}>{label[1]}</span>
      </div>
      {d.description && <span className="muted">{d.description}</span>}
      <ul className="drink-ingredients">
        {d.ingredients.map((i, k) => (
          <li key={k} className={i.availability === 'missing' ? 'missing' : ''}>
            <span aria-hidden>{i.availability === 'missing' ? '✗' : '✓'}</span> {ingredientLine(i)}{i.optional ? ' (optional)' : ''}
          </li>
        ))}
      </ul>
      {!!d.instructions.length && <div><strong>Build: </strong>{d.instructions.join(' ')}</div>}
      <div className="small muted">{[d.glass && `Glass: ${d.glass}`, d.garnish && `Garnish: ${d.garnish}`].filter(Boolean).join(' · ')}</div>
      <div className="row">
        {savedId ? <Link className="btn" to={`/recipes/${savedId}`}>📖 Open in Recipes</Link> : <button onClick={save}>⭐ Save to Drinks</button>}
        {d.missing.length > 0 && d.missing.length <= 2 && (
          <button className="primary" disabled={listed} onClick={addMissing}>{listed ? '✓ On the list' : `🛒 Add ${d.missing.join(' + ')} to list`}</button>
        )}
      </div>
    </div>
  );
}

function IdeaZone({ disabled }: { disabled: boolean }) {
  const { base, toast } = useApp();
  const [style, setStyle] = useState('Tropical');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);

  async function go() {
    setBusy(true);
    try {
      const res = await api<{ drinks: Idea[] }>(`${base}/mixologist/ideas`, { body: { style, notes, count: 4 } });
      setIdeas(res.drinks);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <strong>Give me an idea. What style are you in the mood for?</strong>
        <div className="chips">{STYLES.map((s) => <button key={s} className={`chip${style === s ? ' on' : ''}`} onClick={() => setStyle(s)}>{s}</button>)}</div>
        <div className="row">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else? e.g. use the Malibu, not too sweet, for 6 people" style={{ flex: 1 }} />
          <button className="primary" disabled={disabled || busy} onClick={go}>{busy ? 'Mixing…' : '🍹 Mix me ideas'}</button>
        </div>
        <span className="small muted">Recipes use what's in your Bar and Pantry. If a drink is only missing one or two things, you can add them to the shopping list in one tap.</span>
      </div>
      {ideas && !ideas.length && <div className="card muted">No ideas came back. Try another style.</div>}
      <div className="grid-2">{ideas?.map((d, i) => <IdeaCard key={i} d={d} />)}</div>
    </div>
  );
}

/* ---------- Drinks (saved cocktail recipes) ---------- */

function Drinks() {
  const { base } = useApp();
  const [recipes] = useLoad<RecipeSummary[]>(`${base}/recipes`);
  const [ready, setReady] = useUrlState('ready');
  const readyOnly = ready === '1';
  const setReadyOnly = (on: boolean) => setReady(on ? '1' : '');
  const [q, setQ] = useUrlState('q');
  const drinks = (recipes ?? []).filter((r) => r.tags.includes('cocktail'));
  const shown = drinks.filter((r) => (!readyOnly || r.ready === 'ready') && (!q || r.title.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="stack">
      <div className="row">
        <input placeholder="Search drinks" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} />
        <button className={`chip${readyOnly ? ' on' : ''}`} onClick={() => setReadyOnly(!readyOnly)}>✅ Can make now</button>
        <span className="spacer" />
        <Link className="btn" to="/recipes/new">＋ New drink</Link>
      </div>
      {recipes && !drinks.length && (
        <div className="card muted">
          No drinks saved yet. Save one from the Idea Zone or the chat, or tag any recipe with <strong>cocktail</strong> and it shows up here.
        </div>
      )}
      <div className="recipe-grid">
        {shown.map((r) => {
          const [cls, label] = READY_LABEL[r.ready];
          return (
            <Link key={r.id} to={`/recipes/${r.id}`} className="card recipe-card">
              <div className="cover">{r.image ? <img src={r.image} alt="" loading="lazy" /> : '🍹'}</div>
              <div className="body">
                <span className="title">{r.title}</span>
                <div className="small muted">{r.tags.filter((t) => t !== 'cocktail').join(' · ')}</div>
                <span className={`pill ${cls}`} title={r.missing.join(', ')}>{r.ready === 'ready' ? '✅ Can make now' : label}{r.ready !== 'ready' && r.missing.length ? ` (${r.missing.length})` : ''}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Bar inventory ---------- */

function Bar() {
  const { base, me, toast } = useApp();
  const [items, reload] = useLoad<Item[]>(`${base}/items`);
  const [home] = useLoad<HomeDetail>(base);
  const labels: Labels = { locations: home?.settings.locations ?? [...LOCATIONS], categories: home?.settings.categories ?? [...CATEGORIES] };
  const [editing, setEditing] = useState<Item | null>(null);
  const [name, setName] = useState('');
  const bar = (items ?? []).filter(isBar);
  const mixers = (items ?? []).filter((i) => !isBar(i) && i.quantity > 0 && i.category === 'Beverages');

  async function add() {
    const n = name.trim();
    if (!n) return;
    // File it under the Bar place when this home has one; the category is guessed from the name either way.
    const hasBarPlace = labels.locations.some((l) => l.toLowerCase() === 'bar');
    await api(`${base}/items`, { body: { name: n, quantity: 1, unit: 'bottle', ...(hasBarPlace ? { location: 'Bar' } : {}) } });
    setName('');
    toast(`${n} added to the bar`);
    void reload();
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a bottle, e.g. Blue Curaçao" style={{ flex: 1, maxWidth: 420 }} />
        <button className="primary" disabled={!name.trim()}>＋ Add</button>
      </form>
      <p className="small muted" style={{ margin: 0 }}>
        Your bar is everything in the Pantry with the <strong>Bar</strong> category or place: liquor, liqueurs, flavorings like curaçao and schnapps, and mixers. Tap a bottle to change it.
      </p>
      {items && !bar.length && <div className="card muted">No bottles yet. Add what's in your liquor cabinet and the Mixologist will build drinks around it.</div>}
      <div className="tiles">
        {bar.map((i) => (
          <button key={i.id} className={`tile${tileState(i).cls}`} onClick={() => setEditing(i)}>
            {tileState(i).badge && <span className="badge">{tileState(i).badge}</span>}
            <ItemArt item={i} />
            <span className="name">{i.name}</span>
            <span className="qty">{amount(i.quantity, i.unit, me?.user.units)}</span>
          </button>
        ))}
      </div>
      {!!mixers.length && (
        <section className="stack">
          <h2 style={{ marginTop: 8 }}>Mixers in the pantry</h2>
          <div className="chips">{mixers.map((i) => <span key={i.id} className="pill">{i.icon} {i.name}</span>)}</div>
        </section>
      )}
      {editing && <ItemEditor item={editing} labels={labels} canAdd={home?.role === 'manager'} onClose={(changed) => { setEditing(null); if (changed) void reload(); }} />}
    </div>
  );
}

/* ---------- Converter and batch scaler ---------- */

const round = (n: number, places = 2) => String(Math.round(n * 10 ** places) / 10 ** places);

function Converter() {
  const { base } = useApp();
  const [qty, setQty] = useState('1.5');
  const [from, setFrom] = useState('fl oz');
  const n = Number(qty);
  const rows = useMemo(() => BAR_UNITS.filter((u) => u.key !== from).map((u) => ({ u, v: Number.isFinite(n) ? barConvert(n, from, u.key) : null })), [n, from]);

  const [recipes] = useLoad<RecipeSummary[]>(`${base}/recipes`);
  const drinks = (recipes ?? []).filter((r) => r.tags.includes('cocktail'));
  const [drinkId, setDrinkId] = useState('');
  const [guests, setGuests] = useState('8');
  const [drink] = useLoad<RecipeFull>(drinkId ? `${base}/recipes/${drinkId}` : null, [drinkId]);
  const servings = Math.max(1, Math.round(Number(guests) || 1));
  const batch = drink ? batchDrink(drink.ingredients.map((i) => ({ ...i, quantity: i.quantity == null ? null : i.quantity / (drink.servings || 1) })), servings) : null;

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Bar measures</h2>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 110, flex: 'none' }} aria-label="Amount" />
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Unit" style={{ flex: 1, width: 'auto' }}>
            {BAR_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
          <span className="muted">is</span>
        </div>
        <table>
          <tbody>
            {rows.map(({ u, v }) => (
              <tr key={u.key}><td style={{ fontWeight: 600 }}>{v == null ? '–' : round(v, v >= 100 ? 0 : v >= 1 ? 2 : 3)}</td><td className="muted">{u.label}</td></tr>
            ))}
          </tbody>
        </table>
        <span className="small muted">A shot or jigger is 1.5 oz, a pony 1 oz, a barspoon about 5 ml, a dash about 1/32 oz, a splash about 1/4 oz.</span>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Batch for a party</h2>
        {!drinks.length ? (
          <span className="muted">Save a drink first (Idea Zone or chat), then scale it up here.</span>
        ) : (
          <>
            <div className="row">
              <select value={drinkId} onChange={(e) => setDrinkId(e.target.value)} style={{ flex: 1 }} aria-label="Drink">
                <option value="">Pick a saved drink…</option>
                {drinks.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
              <label className="row" style={{ gap: 6 }}>for <input inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value)} style={{ width: 70 }} /> drinks</label>
            </div>
            {batch && (
              <>
                <ul className="drink-ingredients">
                  {batch.lines.map((l, i) => (
                    <li key={i}>
                      <strong>{l.flOz != null ? `${round(l.flOz, 1)} oz` : l.quantity != null ? amount(l.quantity, l.unit) : 'to taste'}</strong> {l.name}
                      {l.flOz != null && l.flOz >= 8 && <span className="muted"> · {round(l.flOz / 8, 1)} {l.flOz === 8 ? 'cup' : 'cups'} · {round(l.ml ?? 0, 0)} ml</span>}
                      {l.flOz != null && l.flOz >= 12 && <span className="muted"> · {bottlesOf750(l.flOz)} × 750 ml bottle{bottlesOf750(l.flOz) > 1 ? 's' : ''}</span>}
                      {l.note && <span className="muted"> ({l.note})</span>}
                    </li>
                  ))}
                </ul>
                <span className="small muted">
                  Makes about {round(batch.totalFlOz / 8, 1)} cups ({round(batch.totalMl / 1000, 2)} L) before ice. Add about 20% water if you'll serve it without shaking, and top fizzy mixers per glass.
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
