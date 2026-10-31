import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDialogs } from '../components/Dialog.tsx';
import { api, type RecipeSummary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { amount, todayIso } from '../format.ts';
import { Chat, ChatAvatar, Markdown, type ChatPersona } from '../components/Chat.tsx';

export const GORDY: ChatPersona = {
  endpoint: 'chef/chat',
  name: 'Gordy Scavengé',
  avatar: '/avatars/gordy-scavenge.png',
  emoji: '👨‍🍳',
  intro: "Well hey there, sugar, come on in! I'm Gordy Scavengé. Pull up a stool and tell me what you're craving. Southern comfort food, a perfect steak, Virginia-style Mexican, homemade rolls and biscuits, sweet tea or lemonade, that's my home turf, but I'll help with anything from the kitchen. I can see what's in your pantry, too.",
  starters: [
    'What can I cook tonight with what I have?',
    "Hardee's-style buttermilk biscuits",
    'Texas Roadhouse rolls with honey cinnamon butter',
    'Virginia-style Mexican white sauce',
    'How do I cook the perfect steak?',
    'Real Southern sweet tea',
  ],
  placeholder: 'What are you craving, sugar?',
  thinking: 'Gordy is stirring the pot…',
};

type Tab = 'chat' | 'perfect';

/** The AI chef with Gordy Scavengé: a chat, and "Help me perfect my recipe". */
export function Chef() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'perfect' ? 'perfect' : 'chat';
  const [status] = useLoad<{ available: boolean }>('/api/mixologist/status');
  return (
    <div className="stack">
      <div className="topbar">
        <ChatAvatar p={GORDY} size={48} />
        <h1>Chef Gordy</h1>
        <div className="chips">
          <button className={`chip${tab === 'chat' ? ' on' : ''}`} onClick={() => setParams({})}>💬 Chat</button>
          <button className={`chip${tab === 'perfect' ? ' on' : ''}`} onClick={() => setParams({ tab: 'perfect' })}>✨ Perfect my recipe</button>
        </div>
      </div>
      {status && !status.available && (
        <div className="card stack">
          <strong>Gordy needs a Claude API key</strong>
          <span className="muted">Set <code>ANTHROPIC_API_KEY</code> on the server (the same key the Mixologist uses) and restart.</span>
        </div>
      )}
      {tab === 'chat' ? <Chat disabled={!status?.available} persona={GORDY} /> : <Perfect disabled={!status?.available} />}
    </div>
  );
}

/* ---------- Help me perfect my recipe ---------- */

interface CheckedIngredient { name: string; quantity: number | null; unit: string | null; note: string | null; optional: boolean; availability: 'have' | 'low' | 'missing' | 'unknown' }
interface GordyRecipe {
  title: string; description: string; servings: number | null; prepMinutes: number | null; cookMinutes: number | null;
  ingredients: CheckedIngredient[]; instructions: string[];
  missing: { name: string; quantity: number | null; unit: string | null }[]; status: 'ready' | 'almost' | 'missing';
}
interface PerfectResult {
  greeting: string;
  improvements: { title: string; why: string }[];
  perfected: GordyRecipe;
  mealIdeas: (GordyRecipe & { pitch: string })[];
  sourceRecipeId: string | null;
}

const STATUS: Record<GordyRecipe['status'], [string, string]> = {
  ready: ['ok', '✅ You have everything'],
  almost: ['warn', '🟡 Need a few things'],
  missing: ['bad', '🛒 Needs a shopping trip'],
};

function Perfect({ disabled }: { disabled: boolean }) {
  const { base, toast } = useApp();
  const [recipes] = useLoad<RecipeSummary[]>(`${base}/recipes`);
  const [mode, setMode] = useState<'book' | 'paste'>('book');
  const [recipeId, setRecipeId] = useState('');
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PerfectResult | null>(null);

  async function go() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api<PerfectResult>(`${base}/chef/perfect`, {
        body: mode === 'book' ? { recipeId, notes, ideas: 3 } : { text, notes, ideas: 3 },
      }));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = mode === 'book' ? !!recipeId : text.trim().length > 10;
  return (
    <div className="stack">
      <div className="card stack">
        <div className="chat-row">
          <ChatAvatar p={GORDY} size={56} />
          <div className="bubble assistant">
            Bring me a recipe, sugar. I'll tell you how to make it sing, hand you the improved version, and dream up a few meals for your calendar from what's in your pantry. I'll tell you straight if you need to pick anything up.
          </div>
        </div>
        <div className="chips">
          <button className={`chip${mode === 'book' ? ' on' : ''}`} onClick={() => setMode('book')}>📖 From my recipes</button>
          <button className={`chip${mode === 'paste' ? ' on' : ''}`} onClick={() => setMode('paste')}>✍️ Type or paste one</button>
        </div>
        {mode === 'book' ? (
          <select aria-label="Recipe to perfect" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
            <option value="">Pick a recipe…</option>
            {recipes?.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        ) : (
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Grandma\'s Biscuits\n2 cups self-rising flour\n1/2 cup shortening\n3/4 cup buttermilk\n\nCut the shortening into the flour…'} />
        )}
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything you're hoping for? (fluffier, spicier, feeds 8, healthier…)" />
        <button className="primary" disabled={disabled || busy || !ready} onClick={go}>{busy ? 'Gordy is tasting…' : '✨ Help me perfect it'}</button>
        {busy && <p className="small muted" style={{ margin: 0 }}>Good cooking takes a minute. This can take up to a minute or two.</p>}
      </div>

      {result && (
        <>
          <div className="card stack">
            <div className="chat-row">
              <ChatAvatar p={GORDY} />
              <div className="bubble assistant"><Markdown text={result.greeting} /></div>
            </div>
            {!!result.improvements.length && (
              <>
                <h2 style={{ margin: 0 }}>How to make it better</h2>
                <ol className="steps" style={{ margin: 0 }}>
                  {result.improvements.map((i, n) => <li key={n}><strong>{i.title}.</strong> {i.why}</li>)}
                </ol>
              </>
            )}
          </div>
          <RecipeResult recipe={result.perfected} heading="The perfected recipe" replaceId={result.sourceRecipeId} />
          {!!result.mealIdeas.length && <h2 style={{ margin: '8px 0 0' }}>Meal ideas for your calendar</h2>}
          {result.mealIdeas.map((m, i) => <RecipeResult key={i} recipe={m} pitch={m.pitch} planner />)}
        </>
      )}
    </div>
  );
}

function RecipeResult({ recipe, heading, pitch, replaceId, planner }: { recipe: GordyRecipe; heading?: string; pitch?: string; replaceId?: string | null; planner?: boolean }) {
  const { base, toast, me } = useApp();
  const dialogs = useDialogs();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [slot, setSlot] = useState('dinner');
  const [listed, setListed] = useState(false);
  const [cls, label] = STATUS[recipe.status];

  async function save(replace: boolean): Promise<string> {
    const { id } = await api<{ id: string }>(`${base}/chef/save`, { body: { recipe, replaceId: replace ? replaceId : null } });
    setSavedId(id);
    return id;
  }

  async function plan() {
    const id = savedId ?? await save(false);
    await api(`${base}/mealplan`, { body: { date, slot, recipeId: id } });
    toast(`${recipe.title} is on the meal plan`);
  }

  async function shop() {
    for (const m of recipe.missing) {
      await api(`${base}/shopping`, { body: { name: m.name, quantity: m.quantity, unit: m.unit, note: `for ${recipe.title}` } });
    }
    setListed(true);
    toast(`Added ${recipe.missing.length} item${recipe.missing.length === 1 ? '' : 's'} to the shopping list`);
  }

  return (
    <div className="card stack">
      {heading && <span className="small muted">{heading}</span>}
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>{recipe.title}</h2>
        <span className={`pill ${cls}`}>{label}</span>
      </div>
      {pitch && <p style={{ margin: 0 }}>{pitch}</p>}
      {recipe.description && <p className="muted" style={{ margin: 0 }}>{recipe.description}</p>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <ul className="drink-ingredients">
          {recipe.ingredients.map((i, n) => (
            <li key={n} className={i.availability === 'missing' || i.availability === 'low' ? 'missing' : ''}>
              {i.availability === 'missing' || i.availability === 'low' ? '🛒 ' : '✓ '}
              <strong>{amount(i.quantity, i.unit, me?.user.units)}</strong> {i.name}{i.note ? `, ${i.note}` : ''}{i.optional ? ' (optional)' : ''}
            </li>
          ))}
        </ul>
        <ol className="steps" style={{ margin: 0 }}>{recipe.instructions.map((s, n) => <li key={n}>{s}</li>)}</ol>
      </div>
      <div className="row">
        {savedId
          ? <Link className="btn" to={`/recipes/${savedId}`}>📖 Open saved recipe</Link>
          : (
            <>
              <button onClick={async () => { await save(false); toast('Saved to your recipes'); }}>💾 Save as new recipe</button>
              {replaceId && <button onClick={async () => { if (await dialogs.confirm('Replace your original recipe with this version?', { okLabel: 'Replace' })) { await save(true); toast('Your recipe is updated'); } }}>✏️ Update my original</button>}
            </>
          )}
        {!!recipe.missing.length && <button disabled={listed} onClick={shop}>🛒 {listed ? 'On the list' : `Add ${recipe.missing.length} missing to list`}</button>}
      </div>
      {planner && (
        <div className="row">
          <input type="date" aria-label="Day" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 180 }} />
          <select aria-label="Meal" value={slot} onChange={(e) => setSlot(e.target.value)} style={{ maxWidth: 150 }}>
            {['breakfast', 'lunch', 'dinner', 'snack'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="primary" onClick={plan}>📅 Put on meal plan</button>
        </div>
      )}
    </div>
  );
}
