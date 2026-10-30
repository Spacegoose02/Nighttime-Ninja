import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, parseJson, randomToken, str } from '../util.ts';
import { importAny, ingredientMatches, matchKey, type Ingredient, type Recipe } from '../../../shared/recipe.ts';
import { convert } from '../../../shared/units.ts';
import { publicFetch } from '../security.ts';
import { adjustItem } from './inventory.ts';
import { addShoppingItem } from './shopping.ts';

/** Things nobody tracks in inventory. */
const ALWAYS_HAVE = new Set(['water', 'ice', 'hot water', 'cold water', 'warm water', 'ice water']);

export function saveRecipe(db: DatabaseSync, homeId: string, r: Recipe, userId: string | null, id: string = newId()): string {
  tx(db, () => {
    db.prepare(`INSERT INTO recipes (id, home_id, title, description, servings, prep_minutes, cook_minutes, source_url, image, instructions, tags, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET title = excluded.title, description = excluded.description, servings = excluded.servings,
        prep_minutes = excluded.prep_minutes, cook_minutes = excluded.cook_minutes, source_url = excluded.source_url,
        image = excluded.image, instructions = excluded.instructions, tags = excluded.tags, updated_at = datetime('now')`).run(
      id, homeId, (r.title || 'Untitled recipe').slice(0, 200), (r.description ?? '').slice(0, 5000),
      r.servings ?? null, r.prepMinutes ?? null, r.cookMinutes ?? null, r.sourceUrl ?? null, r.image ?? null,
      JSON.stringify((r.instructions ?? []).map(String).slice(0, 200)),
      JSON.stringify((r.tags ?? []).map((t) => String(t).toLowerCase()).slice(0, 30)),
      userId,
    );
    db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(id);
    const ins = db.prepare('INSERT INTO recipe_ingredients (recipe_id, position, name, quantity, unit, note, optional) VALUES (?, ?, ?, ?, ?, ?, ?)');
    (r.ingredients ?? []).slice(0, 200).forEach((ing, i) => {
      if (!ing?.name) return;
      ins.run(id, i, String(ing.name).slice(0, 200), num(ing.quantity), ing.unit ?? null, ing.note ?? null, ing.optional ? 1 : 0);
    });
  });
  return id;
}

export function loadRecipe(db: DatabaseSync, row: Row) {
  const ingredients = (db.prepare('SELECT name, quantity, unit, note, optional FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position').all(row.id as string) as Row[])
    .map((i): Ingredient => ({ name: i.name as string, quantity: i.quantity as number | null, unit: i.unit as string | null, note: i.note as string | null, optional: !!i.optional }));
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    servings: row.servings as number | null,
    prepMinutes: row.prep_minutes as number | null,
    cookMinutes: row.cook_minutes as number | null,
    sourceUrl: row.source_url as string | null,
    image: row.image as string | null,
    instructions: parseJson<string[]>(row.instructions, []),
    tags: parseJson<string[]>(row.tags, []),
    isPublic: !!row.is_public,
    shareSlug: row.share_slug as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    ingredients,
  };
}

interface Stock { id: string; name: string; quantity: number; unit: string | null }

export interface StockIndex {
  byKey: Map<string, Stock[]>;
  byId: Map<string, Stock>;
  /** Ingredient key -> pantry item id, set by hand when automatic matching gets it wrong. */
  links: Map<string, string>;
}

export function stockIndex(db: DatabaseSync, homeId: string): StockIndex {
  const byKey = new Map<string, Stock[]>();
  const byId = new Map<string, Stock>();
  for (const r of db.prepare('SELECT id, name, quantity, unit FROM items WHERE home_id = ?').all(homeId) as unknown as Stock[]) {
    const k = matchKey(r.name);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
    byId.set(r.id, r);
  }
  const links = new Map<string, string>();
  for (const l of db.prepare('SELECT ingredient_key, item_id FROM ingredient_links WHERE home_id = ?').all(homeId) as Row[]) {
    links.set(l.ingredient_key as string, l.item_id as string);
  }
  return { byKey, byId, links };
}

function findStock(index: StockIndex, name: string): { stock: Stock[]; linked: boolean } {
  const key = matchKey(name);
  const linkedId = index.links.get(key);
  if (linkedId && index.byId.has(linkedId)) return { stock: [index.byId.get(linkedId)!], linked: true };
  if (index.byKey.has(key)) return { stock: index.byKey.get(key)!, linked: false };
  // Fuzzy: "cheddar or Monterey Jack cheese" finds "Extra Sharp Cheddar Cheese"; "boneless chicken thighs" finds "chicken thighs".
  const found: Stock[] = [];
  for (const list of index.byKey.values()) for (const s of list) if (ingredientMatches(name, s.name)) found.push(s);
  return { stock: found, linked: false };
}

export type Availability = 'have' | 'low' | 'missing' | 'unknown';

/** Works out whether each ingredient is covered by inventory, after unit conversion and scaling. */
export function checkIngredients(index: StockIndex, ingredients: Ingredient[], factor = 1) {
  return ingredients.map((ing) => {
    if (ALWAYS_HAVE.has(ing.name.toLowerCase().trim())) return { ...ing, availability: 'have' as Availability, matched: [] as string[], linked: false };
    const { stock, linked } = findStock(index, ing.name);
    const base = { ...ing, matched: stock.map((s) => s.name), linked };
    const total = stock.reduce((sum, s) => sum + s.quantity, 0);
    if (!stock.length || total <= 0) return { ...base, availability: 'missing' as Availability };
    if (ing.quantity == null) return { ...base, availability: 'have' as Availability };
    const need = ing.quantity * factor;
    let have = 0;
    let comparable = false;
    for (const s of stock) {
      const c = convert(s.quantity, s.unit, ing.unit);
      if (c != null) { have += c; comparable = true; }
    }
    // Units we can't compare (e.g. "2 cloves" vs "1 head") count as present.
    if (!comparable) return { ...base, availability: 'unknown' as Availability };
    return { ...base, availability: (have + 1e-9 >= need ? 'have' : 'low') as Availability };
  });
}

function readiness(checked: ReturnType<typeof checkIngredients>) {
  const required = checked.filter((i) => !i.optional);
  const missing = required.filter((i) => i.availability === 'missing' || i.availability === 'low').map((i) => i.name);
  const status = missing.length === 0 ? 'ready' : missing.length <= Math.max(1, Math.floor(required.length / 4)) ? 'almost' : 'missing';
  return { status, missing };
}

async function fetchPage(url: string): Promise<string> {
  let u: URL;
  try { u = new URL(url); } catch { throw new HttpError(400, 'That is not a valid link'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'Only http and https links can be imported');
  const res = await publicFetch(u, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; NighttimeNinja/0.1; +https://github.com/)', accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new HttpError(502, `The site answered ${res.status}`);
  const text = await res.text();
  return text.slice(0, 3_000_000);
}

export function recipeRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/recipes', async (req) => {
    const ctx = homeCtx(db, req);
    const q = req.query as Row;
    const args: string[] = [ctx.homeId];
    let where = 'home_id = ?';
    if (q.q) { where += ' AND (title LIKE ? OR tags LIKE ?)'; args.push(`%${q.q}%`, `%${q.q}%`); }
    const rows = db.prepare(`SELECT * FROM recipes WHERE ${where} ORDER BY title COLLATE NOCASE`).all(...args) as Row[];
    const index = stockIndex(db, ctx.homeId);
    const list = rows.map((r) => {
      const full = loadRecipe(db, r);
      const { status, missing } = readiness(checkIngredients(index, full.ingredients));
      return {
        id: full.id, title: full.title, image: full.image, servings: full.servings, tags: full.tags,
        totalMinutes: (full.prepMinutes ?? 0) + (full.cookMinutes ?? 0) || null,
        ingredientCount: full.ingredients.length, isPublic: full.isPublic, ready: status, missing,
      };
    });
    return q.ready === 'true' ? list.filter((r) => r.ready === 'ready') : list;
  });

  app.get('/api/homes/:homeId/recipes/:id', async (req) => {
    const ctx = homeCtx(db, req);
    const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND home_id = ?').get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Recipe not found');
    const full = loadRecipe(db, row);
    const servings = num((req.query as Row).servings);
    const factor = servings && full.servings ? servings / full.servings : 1;
    const checked = checkIngredients(stockIndex(db, ctx.homeId), full.ingredients, factor);
    return { ...full, ingredients: checked, ...readiness(checked) };
  });

  app.post('/api/homes/:homeId/recipes', async (req) => {
    const ctx = homeCtx(db, req);
    const r = req.body as Recipe;
    if (!r?.title) throw new HttpError(400, 'Title is required');
    return { id: saveRecipe(db, ctx.homeId, r, ctx.user?.id ?? null) };
  });

  app.put('/api/homes/:homeId/recipes/:id', async (req) => {
    const ctx = homeCtx(db, req);
    const { id } = req.params as { id: string };
    if (!db.prepare('SELECT 1 FROM recipes WHERE id = ? AND home_id = ?').get(id, ctx.homeId)) throw new HttpError(404, 'Recipe not found');
    const r = req.body as Recipe;
    if (!r?.title) throw new HttpError(400, 'Title is required');
    saveRecipe(db, ctx.homeId, r, ctx.user?.id ?? null, id);
    return { id };
  });

  app.delete('/api/homes/:homeId/recipes/:id', async (req) => {
    const ctx = homeCtx(db, req);
    db.prepare('DELETE FROM recipes WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // Parse without saving (preview), or save when save=true.
  app.post('/api/homes/:homeId/recipes/import', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const url = str(b.url, 2000);
    const input = url ? await fetchPage(url) : String(b.text ?? '');
    const recipes = importAny(input, url);
    if (!recipes.length) throw new HttpError(422, url ? "Couldn't find a recipe on that page" : "Couldn't read a recipe from that");
    if (b.save) return { ids: recipes.map((r) => saveRecipe(db, ctx.homeId, r, ctx.user?.id ?? null)) };
    return { recipes };
  });

  app.post('/api/homes/:homeId/recipes/:id/cook', async (req) => {
    const ctx = homeCtx(db, req);
    const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND home_id = ?').get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Recipe not found');
    const full = loadRecipe(db, row);
    const servings = num((req.body as Row)?.servings);
    const factor = servings && full.servings ? servings / full.servings : 1;
    const index = stockIndex(db, ctx.homeId);
    const used: { name: string; amount: number; unit: string | null }[] = [];
    const skipped: string[] = [];
    tx(db, () => {
      for (const ing of full.ingredients) {
        if (ALWAYS_HAVE.has(ing.name.toLowerCase())) continue;
        const stock = findStock(index, ing.name).stock.filter((s) => s.quantity > 0);
        if (!stock.length) { if (!ing.optional) skipped.push(ing.name); continue; }
        let remaining = ing.quantity == null ? null : ing.quantity * factor;
        for (const s of stock) {
          if (remaining == null) {
            // No amount given: use one unit of a counted item, otherwise leave the stock alone.
            if (!s.unit || s.unit === 'each') { adjustItem(db, ctx.homeId, s.id, -1, `cooked ${full.title}`, ctx.user?.id ?? null); used.push({ name: s.name, amount: 1, unit: s.unit }); }
            break;
          }
          const inStockUnits = convert(remaining, ing.unit, s.unit);
          if (inStockUnits == null) continue;
          const take = Math.min(s.quantity, inStockUnits);
          adjustItem(db, ctx.homeId, s.id, -take, `cooked ${full.title}`, ctx.user?.id ?? null);
          s.quantity -= take;
          used.push({ name: s.name, amount: Math.round(take * 100) / 100, unit: s.unit });
          remaining -= convert(take, s.unit, ing.unit) ?? remaining;
          if (remaining <= 1e-9) break;
        }
      }
      const mealId = str((req.body as Row)?.mealPlanId, 60);
      if (mealId) db.prepare("UPDATE meal_plan SET cooked_at = datetime('now') WHERE id = ? AND home_id = ?").run(mealId, ctx.homeId);
    });
    return { used, skipped };
  });

  app.post('/api/homes/:homeId/recipes/:id/to-shopping', async (req) => {
    const ctx = homeCtx(db, req);
    const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND home_id = ?').get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Recipe not found');
    const full = loadRecipe(db, row);
    const b = (req.body ?? {}) as Row;
    const servings = num(b.servings);
    const factor = servings && full.servings ? servings / full.servings : 1;
    const checked = checkIngredients(stockIndex(db, ctx.homeId), full.ingredients, factor);
    const wanted = b.all ? checked.filter((i) => !i.optional) : checked.filter((i) => !i.optional && (i.availability === 'missing' || i.availability === 'low'));
    const added = wanted.map((i) => addShoppingItem(db, ctx.homeId, {
      name: i.name, quantity: i.quantity == null ? null : Math.round(i.quantity * factor * 100) / 100, unit: i.unit, note: `for ${full.title}`,
    }, ctx.user?.id ?? null));
    return { added };
  });

  // Pin an ingredient name to a pantry item for every recipe in this home, or pass itemId null to go back to automatic.
  app.put('/api/homes/:homeId/ingredient-links', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const key = matchKey(String(b.ingredient ?? ''));
    if (!key) throw new HttpError(400, 'Which ingredient?');
    const itemId = str(b.itemId, 60);
    if (!itemId) {
      db.prepare('DELETE FROM ingredient_links WHERE home_id = ? AND ingredient_key = ?').run(ctx.homeId, key);
      return { ok: true, itemId: null };
    }
    if (!db.prepare('SELECT 1 FROM items WHERE id = ? AND home_id = ?').get(itemId, ctx.homeId)) throw new HttpError(404, 'That pantry item is gone');
    db.prepare(`INSERT INTO ingredient_links (home_id, ingredient_key, item_id) VALUES (?, ?, ?)
      ON CONFLICT (home_id, ingredient_key) DO UPDATE SET item_id = excluded.item_id, created_at = datetime('now')`).run(ctx.homeId, key, itemId);
    return { ok: true, itemId };
  });

  app.post('/api/homes/:homeId/recipes/:id/share', async (req) => {
    const ctx = homeCtx(db, req);
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT share_slug FROM recipes WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Recipe not found');
    const makePublic = (req.body as Row)?.public !== false;
    const slug = (row.share_slug as string | null) ?? randomToken(9);
    db.prepare('UPDATE recipes SET is_public = ?, share_slug = ? WHERE id = ?').run(makePublic ? 1 : 0, slug, id);
    return { isPublic: makePublic, shareUrl: makePublic ? `/r/${slug}` : null };
  });

  app.post('/api/homes/:homeId/recipes/copy/:slug', async (req) => {
    const ctx = homeCtx(db, req);
    const row = db.prepare('SELECT * FROM recipes WHERE share_slug = ? AND is_public = 1').get((req.params as { slug: string }).slug) as Row | undefined;
    if (!row) throw new HttpError(404, 'That recipe is not shared');
    const { id: _id, isPublic: _p, shareSlug: _s, createdAt: _c, updatedAt: _u, ...recipe } = loadRecipe(db, row);
    return { id: saveRecipe(db, ctx.homeId, recipe, ctx.user?.id ?? null) };
  });

  // Public, no sign-in needed.
  app.get('/api/public/recipes', async (req) => {
    const q = str((req.query as Row).q, 100);
    const rows = db.prepare(`
      SELECT r.title, r.image, r.share_slug, r.tags, r.servings, h.name AS home_name FROM recipes r JOIN homes h ON h.id = r.home_id
      WHERE r.is_public = 1 ${q ? 'AND r.title LIKE ?' : ''} ORDER BY r.updated_at DESC LIMIT 200`).all(...(q ? [`%${q}%`] : [])) as Row[];
    return rows.map((r) => ({ title: r.title, image: r.image, slug: r.share_slug, tags: parseJson(r.tags, []), servings: r.servings, from: r.home_name }));
  });

  app.get('/api/public/recipes/:slug', async (req) => {
    const row = db.prepare('SELECT * FROM recipes WHERE share_slug = ? AND is_public = 1').get((req.params as { slug: string }).slug) as Row | undefined;
    if (!row) throw new HttpError(404, 'That recipe is not shared');
    const { id: _id, ...rest } = loadRecipe(db, row);
    return rest;
  });
}
