import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RecipeSummary } from '../api.ts';
import { todayIso } from '../format.ts';
import { recipeEmoji, recipeTint } from '../recipeArt.ts';
import { Icon } from '../components/Icon.tsx';
import { useApp, useLoad } from '../state.tsx';
import { KitchenScene } from '../components/Raccoon.tsx';
import { UpdateBanner } from '../components/UpdateBanner.tsx';
import { SetupWizard } from '../components/SetupWizard.tsx';
import { t } from '../i18n.ts';

interface Summary {
  shopping_count: number;
  low_stock_count: number;
  low_stock: string[];
  expiring_soon: { name: string; date: string }[];
  todays_meals: { slot: string; title: string; cooked: boolean; cook: string | null }[];
  tonight: string | null;
  tonight_cook: string | null;
  tonight_recipe_id?: string | null;
  tonight_cooked?: boolean;
  ready_to_cook_count: number;
  ready_to_cook: string[];
  recipe_count: number;
  item_count: number;
}

/**
 * Three dinner ideas for tonight: recipes you can make (or nearly), ranked so food about to expire gets used first,
 * then favourites and high ratings. Exported for tests.
 */
export function tonightIdeas(recipes: RecipeSummary[], n = 3): RecipeSummary[] {
  const score = (r: RecipeSummary) => (r.ready === 'ready' ? 3 : 1) + (r.favorite ? 2 : 0) + (r.rating ?? 0) / 2
    - (r.dietWarnings ? 3 : 0) - r.missingTools.length * 2;
  return recipes
    .filter((r) => r.ready !== 'missing' && !r.tags.includes('drinks'))
    .sort((a, b) => b.usesExpiring.length - a.usesExpiring.length || score(b) - score(a) || a.title.localeCompare(b.title))
    .slice(0, n);
}

/** What's for dinner: tonight's plan with one tap to open it, or three ideas from what you have. */
function Tonight({ s, onPlanned }: { s: Summary | null; onPlanned: () => void }) {
  const { base, toast } = useApp();
  const planned = s?.tonight ?? null;
  const [recipes] = useLoad<RecipeSummary[]>(s && !planned ? `${base}/recipes` : null, [planned]);
  const ideas = recipes ? tonightIdeas(recipes) : [];
  const plan = async (r: RecipeSummary) => {
    try {
      await api(`${base}/mealplan`, { body: { date: todayIso(), slot: 'dinner', recipeId: r.id } });
      toast(t("{recipe} is tonight's dinner", { recipe: r.title }));
      onPlanned();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="card stack tonight">
      <div className="muted small">{t('Tonight')}</div>
      {planned ? (
        <>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }} className={s?.tonight_cooked ? 'done' : ''}>{planned}</div>
          {s?.tonight_cook && <div className="muted">{t('{name} is cooking', { name: s.tonight_cook })}</div>}
          <div className="row">
            {s?.tonight_recipe_id && <Link className="btn primary" to={`/recipes/${s.tonight_recipe_id}`}><Icon name="cook" /> {t('Open the recipe')}</Link>}
            <Link className="btn" to="/plan"><Icon name="plan" /> {t('Meal plan')}</Link>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{t('Nothing planned. How about…')}</div>
          {recipes && !ideas.length && <p className="muted small" style={{ margin: 0 }}>{t("No recipe fits what's in the pantry yet.")} <Link to="/chef">{t('Ask Gordy for an idea')}</Link></p>}
          <div className="tonight-ideas">
            {ideas.map((r) => (
              <div key={r.id} className="tonight-idea">
                <Link to={`/recipes/${r.id}`} className="tonight-cover" style={r.image ? undefined : { background: recipeTint(r.title) }} aria-hidden tabIndex={-1}>
                  {r.image ? <img src={r.image} alt="" loading="lazy" /> : recipeEmoji(r.title, r.tags)}
                </Link>
                <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <Link to={`/recipes/${r.id}`} style={{ fontWeight: 700, color: 'inherit' }}>{r.title}</Link>
                  <span className="small muted">
                    {r.usesExpiring.length ? t('Uses up {items}', { items: r.usesExpiring.slice(0, 2).join(', ') }) : r.ready === 'ready' ? t('You have everything') : t('Missing {items}', { items: r.missing.slice(0, 2).join(', ') })}
                  </span>
                </div>
                <button onClick={() => void plan(r)} aria-label={t("Make {recipe} tonight's dinner", { recipe: r.title })}>{t('Tonight')}</button>
              </div>
            ))}
          </div>
          <div className="row">
            <Link className="btn" to="/recipes?ready=1"><Icon name="recipes" /> {t('Everything I can cook')}</Link>
            <Link className="btn" to="/plan"><Icon name="plan" /> {t('Plan the week')}</Link>
          </div>
        </>
      )}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5 || h >= 22) return t('Late-night snack run');
  if (h < 12) return t('Good morning');
  if (h < 17) return t('Good afternoon');
  return t('Good evening');
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
      {s && !welcomed && !s.recipe_count && !s.item_count && <SetupWizard onDone={dismiss} />}
      <div className="hero">
        <KitchenScene variant={me?.user.avatar} />
        <div className="stack">
          <h1>{greeting()}, {me?.user.name}</h1>
          <p className="muted" style={{ margin: 0 }}>{home?.name}</p>
          <Tonight s={s} onPlanned={() => void reload()} />
        </div>
      </div>

      <div className="grid-2">
        <Link to="/shopping" className="card stat" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="num">{s?.shopping_count ?? '–'}</span>
          <span>{t('on the shopping list')}</span>
        </Link>
        <Link to="/recipes?ready=1" className="card stat" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="num">{s?.ready_to_cook_count ?? '–'}</span>
          <span>{t('recipes ready to cook')}</span>
          {!!s?.ready_to_cook.length && <span className="muted small">{s.ready_to_cook.slice(0, 4).join(', ')}</span>}
        </Link>
        <Link to="/inventory?low=1" className="card stat" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="num" style={{ color: s?.low_stock_count ? 'var(--warn)' : undefined }}>{s?.low_stock_count ?? '–'}</span>
          <span>{t('running low')}</span>
          {!!s?.low_stock.length && <span className="muted small">{s.low_stock.slice(0, 5).join(', ')}</span>}
        </Link>
        <div className="card stat">
          <span className="num" style={{ color: s?.expiring_soon.length ? 'var(--danger)' : undefined }}>{s?.expiring_soon.length ?? '–'}</span>
          <span>{t('expiring in 3 days')}</span>
          {!!s?.expiring_soon.length && (
            <>
              <span className="muted small">{s.expiring_soon.map((e) => e.name).join(', ')}</span>
              <div className="row" style={{ marginTop: 6 }}>
                <Link className="btn" to="/recipes?useup=1">⏳ {t('Use it up')}</Link>
                <Link className="btn" to="/chef?ask=useup">👨‍🍳 {t('Ask Gordy')}</Link>
              </div>
            </>
          )}
        </div>
      </div>

      {!!s?.todays_meals.length && (
        <div className="card">
          <h2>{t('Today')}</h2>
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
