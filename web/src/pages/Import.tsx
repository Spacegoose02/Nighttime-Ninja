import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp } from '../state.tsx';
import type { Recipe } from '../../../shared/recipe.ts';

interface KoResult { recipes: number; recipesSkipped: number; items: number; shopping: number; photos: number }

function KitchenOwlImport() {
  const { base } = useApp();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [households, setHouseholds] = useState<{ id: number; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const fromServer = (householdId?: number) => run(async () => {
    const r = await api<KoResult & { households?: { id: number; name: string }[] }>(`${base}/import/kitchenowl/server`, { body: { url, token, householdId } });
    if (r.households) setHouseholds(r.households);
    else setResult(r);
  });

  const fromFile = (file: File | undefined) => file && run(async () => {
    setResult(await api<KoResult>(`${base}/import/kitchenowl/file`, { body: { data: await file.text() } }));
  });

  return (
    <div className="card stack">
      <h2>🦉 Move over from KitchenOwl</h2>
      <p className="muted" style={{ margin: 0 }}>
        Brings over recipes (with photos), your item catalog as quick-add suggestions, and everything on your shopping lists.
        Recipes you already have here are skipped, so it's safe to run again.
      </p>
      <div className="grid-2">
        <div className="stack">
          <h3>Straight from your KitchenOwl server</h3>
          <input placeholder="https://kitchenowl.example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input placeholder="Long-lived token" value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
          <p className="small muted" style={{ margin: 0 }}>In KitchenOwl: Settings → Account → Sessions → add a long-lived token. It's used once and not saved.</p>
          {!households && <button className="primary" disabled={busy || !url || !token} onClick={() => fromServer()}>Connect</button>}
          {households && households.map((h) => (
            <button key={h.id} className="primary" disabled={busy} onClick={() => fromServer(h.id)}>Import “{h.name}”</button>
          ))}
        </div>
        <div className="stack">
          <h3>Or from an export file</h3>
          <p className="small muted" style={{ margin: 0 }}>In KitchenOwl: Household settings → Export. Then pick the .json file here.</p>
          <input type="file" accept=".json,application/json" onChange={(e) => fromFile(e.target.files?.[0])} disabled={busy} />
        </div>
      </div>
      {busy && <p>Importing… big kitchens can take a minute.</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {result && (
        <p className="pill ok" style={{ fontSize: '1rem', padding: '8px 14px' }}>
          Imported {result.recipes} recipes{result.photos ? ` (${result.photos} photos)` : ''}, {result.items} items, {result.shopping} shopping list entries
          {result.recipesSkipped ? `. Skipped ${result.recipesSkipped} you already had.` : '.'}
        </p>
      )}
    </div>
  );
}

export function ImportPage() {
  const { base, toast } = useApp();
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Recipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function parse(body: { url?: string; text?: string }) {
    setBusy(true); setError(null); setPreview(null);
    try {
      setPreview((await api<{ recipes: Recipe[] }>(`${base}/recipes/import`, { body })).recipes);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function saveAll() {
    const ids: string[] = [];
    for (const r of preview ?? []) ids.push((await api<{ id: string }>(`${base}/recipes`, { body: r })).id);
    toast(`Saved ${ids.length} recipe${ids.length === 1 ? '' : 's'}`);
    nav(ids.length === 1 ? `/recipes/${ids[0]}` : '/recipes');
  }

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="topbar">
        <button className="ghost" onClick={() => nav(-1)}>← Back</button>
        <h1>Import recipes</h1>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Everything is turned into one standard format: recipe-site links (schema.org), pasted text, web pages, Nighttime Ninja or KitchenOwl JSON.
        Metric amounts and °C are shown in US units when you've chosen US in Settings.
      </p>
      <div className="grid-2">
        <div className="card stack">
          <h2>🔗 From a link</h2>
          <input placeholder="https://www.allrecipes.com/recipe/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="primary" disabled={!url || busy} onClick={() => parse({ url })}>Fetch recipe</button>
        </div>
        <div className="card stack">
          <h2>📄 From a file</h2>
          <input type="file" accept=".json,.txt,.html,.htm,.md" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await parse({ text: await f.text() }); }} />
          <p className="small muted" style={{ margin: 0 }}>JSON, HTML, Markdown or plain text.</p>
        </div>
      </div>
      <div className="card stack">
        <h2>📋 Paste it</h2>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Grandma\'s Pancakes\nServes 4\n\nIngredients\n1 1/2 cups flour\n2 eggs\n\nInstructions\n1. Mix.\n2. Cook.'} />
        <button disabled={!text.trim() || busy} onClick={() => parse({ text })}>Read recipe</button>
      </div>
      {busy && <p>Reading…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {preview && (
        <div className="card stack">
          <div className="row">
            <h2 style={{ flex: 1, margin: 0 }}>Found {preview.length} recipe{preview.length === 1 ? '' : 's'}</h2>
            <button className="primary" onClick={saveAll}>Save {preview.length === 1 ? 'it' : 'all'}</button>
          </div>
          {preview.slice(0, 20).map((r, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
              {r.image && <img src={r.image} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 10 }} />}
              <div>
                <strong>{r.title}</strong>
                <div className="small muted">{r.ingredients.length} ingredients · {r.instructions.length} steps{r.servings ? ` · serves ${r.servings}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <KitchenOwlImport />
    </div>
  );
}
