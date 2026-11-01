// Gordy's bigger jobs: planning a week of meals, reading a recipe from a photo or a cooking video, and estimating
// nutrition. Same Claude setup and per-person cap as the chats; all of it needs ANTHROPIC_API_KEY.
import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, localDate, newId, num, parseJson, str } from '../util.ts';
import { guessItem } from '../../../shared/catalog.ts';
import { ingredientMatches, matchKey } from '../../../shared/recipe.ts';
import { ask, claude, keepAlive, limitAi, textOf } from '../claude.ts';
import { publicFetch } from '../security.ts';
import { list, body, number, text } from '../schemas.ts';
import { checkIngredients, loadRecipe, stockIndex } from './recipes.ts';
import { stockForPrompt } from './mixologist.ts';
import { homeTools } from './homes.ts';
import { missingTools } from '../../../shared/equipment.ts';
import { checkOff, mainList } from './shopping.ts';
import { stockByName } from './inventory.ts';
import { cleanRecipe, PERSONA, type PlainRecipe, RECIPE_SCHEMA, REFUSED } from './chef.ts';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pulls the JSON answer out of a structured-output reply. */
function parsed<T>(res: Anthropic.Beta.BetaMessage, what: string): T {
  if (res.stop_reason === 'refusal') throw new HttpError(422, REFUSED);
  try { return JSON.parse(textOf(res)) as T; } catch { throw new HttpError(502, `Gordy's ${what} got garbled. Try again.`); }
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    meals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD, one of the open days.' },
          slot: { type: 'string', enum: SLOTS },
          recipeId: { type: ['string', 'null'], description: 'The id of a recipe from the recipe book, or null for a new dish.' },
          title: { type: 'string' },
          why: { type: 'string', description: 'One short line: what it uses up, why it fits the day.' },
          recipe: { anyOf: [RECIPE_SCHEMA, { type: 'null' }], description: 'The full recipe when recipeId is null; null otherwise.' },
        },
        required: ['date', 'slot', 'recipeId', 'title', 'why', 'recipe'],
        additionalProperties: false,
      },
    },
  },
  required: ['meals'],
  additionalProperties: false,
} as const;

const RECIPES_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'False when there is no recipe to read.' },
    recipes: { type: 'array', items: { ...RECIPE_SCHEMA, properties: { ...RECIPE_SCHEMA.properties, tags: { type: 'array', items: { type: 'string' } } }, required: [...RECIPE_SCHEMA.required, 'tags'] } },
  },
  required: ['found', 'recipes'],
  additionalProperties: false,
} as const;

const NUTRITION_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sodiumMg'].map((k) => [k, { type: 'number' }])),
  required: ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sodiumMg'],
  additionalProperties: false,
} as const;

/** A recipe Claude read, in the app's own format (as the importer would give it). */
function asRecipe(r: Partial<PlainRecipe> & { tags?: unknown }, sourceUrl: string | null = null) {
  const tags = Array.isArray(r.tags) ? r.tags.map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 8) : [];
  return { ...cleanRecipe(r), sourceUrl, image: null, tags };
}

/** The title and description of a YouTube video, where cooks usually write the recipe. */
export function youTubeDetails(html: string): { title: string; description: string } | null {
  const m = /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var |<\/script>)/s.exec(html);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]).videoDetails as { title?: string; shortDescription?: string } | undefined;
    return d?.title ? { title: d.title, description: d.shortDescription ?? '' } : null;
  } catch {
    return null;
  }
}

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'False when the photo is not a store receipt.' },
    store: { type: ['string', 'null'] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Plain grocery name a person would write on a list, e.g. "whole milk" for "GV WHL MLK GAL".' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], description: 'lb, oz, gallon, each and so on, when the receipt says.' },
          price: { type: ['number', 'null'], description: 'What this line cost in total, after any line discount.' },
          food: { type: 'boolean', description: 'False for non-food things like bags, tax, deposits or household goods.' },
        },
        required: ['name', 'quantity', 'unit', 'price', 'food'],
        additionalProperties: false,
      },
    },
  },
  required: ['found', 'store', 'lines'],
  additionalProperties: false,
} as const;

/** The unchecked list item a receipt line is for, if any. */
export function matchListItem(line: string, open: { id: string; name: string }[]): { id: string; name: string } | null {
  const key = matchKey(line);
  return open.find((o) => matchKey(o.name) === key) ?? open.find((o) => ingredientMatches(o.name, line) || ingredientMatches(line, o.name)) ?? null;
}

const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

export function kitchenAiRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // "Plan my week": fill open days on the meal plan from the recipe book and the pantry, using up what expires first.
  app.post('/api/homes/:homeId/chef/plan-week', { schema: body({ start: text, days: number, slots: list(text, 4), notes: text }) }, async (req, reply) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start)) ? String(b.start) : localDate();
    const days = Math.min(14, Math.max(1, Math.round(num(b.days) ?? 7)));
    const slots = (Array.isArray(b.slots) ? b.slots.map(String) : ['dinner']).filter((s) => SLOTS.includes(s));
    if (!slots.length) slots.push('dinner');
    const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
    const taken = new Set((db.prepare('SELECT date, slot FROM meal_plan WHERE home_id = ? AND date >= ? AND date < ?').all(ctx.homeId, start, addDays(start, days)) as Row[])
      .map((r) => `${r.date} ${r.slot}`));
    const open = dates.flatMap((d) => slots.filter((s) => !taken.has(`${d} ${s}`)).map((s) => `${d} ${s}`));
    if (!open.length) throw new HttpError(400, 'Those days are already planned');
    const book = db.prepare(`SELECT r.id, r.title, r.tags, r.favorite, r.rating, r.instructions,
        (SELECT MAX(cooked_at) FROM recipe_cooks c WHERE c.recipe_id = r.id) AS last_cooked
      FROM recipes r WHERE r.home_id = ? ORDER BY r.favorite DESC, r.rating DESC LIMIT 300`).all(ctx.homeId) as Row[];
    const bookIds = new Set(book.map((r) => r.id as string));
    const tools = homeTools(db, ctx.homeId);
    const gearNote = (r: Row) => {
      const lacking = missingTools({ title: r.title as string, instructions: parseJson<string[]>(r.instructions, []) }, tools);
      return lacking.length ? ` | needs ${lacking.join(', ')} (they don't have it)` : '';
    };
    claude(db);
    limitAi(ctx);
    await keepAlive(reply, async () => {
      const res = await ask(db, {
        system: [
          { type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: stockForPrompt(db, ctx.homeId) },
        ],
        messages: [{
          role: 'user',
          content: [
            `Plan these open meals for me: ${open.join(', ')}.`,
            'Use dishes from my recipe book where they fit (give their id), and suggest a new dish with its full recipe only when it clearly helps, at most two new ones.',
            tools.length ? 'Skip book recipes marked as needing gear they don\'t have, unless you can say how to make it with what they own.' : null,
            'Use up anything marked [use soon] early in the week. Mix it up: no repeats, vary the proteins, and lean on favorites and things we have not cooked lately. Weeknights should be quick.',
            b.notes && `What I'm hoping for: ${str(b.notes, 500)}`,
            '',
            'My recipe book (id | title | tags | favorite | rating | last cooked):',
            ...book.map((r) => `${r.id} | ${r.title} | ${parseJson<string[]>(r.tags, []).join(', ')} | ${r.favorite ? 'yes' : ''} | ${r.rating ?? ''} | ${r.last_cooked ?? 'never'}${gearNote(r)}`),
            book.length ? '' : '(empty, so every dish is new)',
          ].filter((x) => x != null && x !== false).join('\n'),
        }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      });
      const out = parsed<{ meals?: { date?: string; slot?: string; recipeId?: string | null; title?: string; why?: string; recipe?: Partial<PlainRecipe> | null }[] }>(res, 'plan');
      const index = stockIndex(db, ctx.homeId);
      const openSet = new Set(open);
      const meals = (out.meals ?? []).filter((m) => openSet.delete(`${m.date} ${m.slot}`)).map((m) => {
        const recipeId = m.recipeId && bookIds.has(m.recipeId) ? m.recipeId : null;
        const recipe = !recipeId && m.recipe ? cleanRecipe(m.recipe) : null;
        const ingredients = recipeId ? loadRecipe(db, db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as Row).ingredients : recipe?.ingredients ?? [];
        const missing = checkIngredients(index, ingredients).filter((i) => !i.optional && (i.availability === 'missing' || i.availability === 'low')).map((i) => i.name);
        return { date: m.date!, slot: m.slot!, recipeId, title: str(m.title, 200) ?? recipe?.title ?? 'Dinner', why: str(m.why, 300) ?? '', recipe, missing };
      }).filter((m) => m.recipeId || m.recipe);
      return { meals };
    });
  });

  // "Snap a recipe": a photo of a cookbook page or a handwritten card becomes a recipe to check and save.
  app.post('/api/homes/:homeId/recipes/from-photo', { schema: body({ images: list(text, 4) }, ['images']), bodyLimit: 24 * 1024 * 1024 }, async (req, reply) => {
    const ctx = homeCtx(db, req);
    const images = ((req.body as Row).images as string[]).map((d) => DATA_URL.exec(d ?? '')).filter((m): m is RegExpExecArray => !!m);
    if (!images.length) throw new HttpError(400, 'Add a photo of the recipe');
    claude(db);
    limitAi(ctx);
    await keepAlive(reply, async () => {
      const res = await ask(db, {
        system: 'You read recipes from photos of cookbook pages, magazine clippings and handwritten recipe cards, and write them out exactly, in a standard format.',
        messages: [{
          role: 'user',
          content: [
            ...images.map((m) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: m[1] as 'image/jpeg', data: m[2] } })),
            {
              type: 'text' as const,
              text: 'Write out the recipe in these photos (the photos may be pages of one recipe). Keep the cook\'s own amounts, wording and steps; fix only obvious spelling. Read handwriting carefully. Put each ingredient\'s amount and unit in their own fields. Add a few short tags (e.g. dessert, chicken, holiday). If there is no recipe, set found to false.',
            },
          ],
        }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: RECIPES_SCHEMA } },
      });
      const out = parsed<{ found?: boolean; recipes?: Partial<PlainRecipe>[] }>(res, 'reading');
      const recipes = (out.recipes ?? []).map((r) => asRecipe(r)).filter((r) => r.ingredients.length || r.instructions.length);
      if (!out.found || !recipes.length) throw new HttpError(422, "Couldn't find a recipe in that photo. Try a closer, brighter shot.");
      return { recipes };
    });
  });

  // A recipe from a cooking video: YouTube cooks usually put it in the description.
  app.post('/api/homes/:homeId/recipes/from-video', { schema: body({ url: text }, ['url']) }, async (req, reply) => {
    const ctx = homeCtx(db, req);
    const url = str((req.body as Row).url, 500) ?? '';
    const id = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url)?.[1];
    if (!id) throw new HttpError(400, 'That only works for YouTube videos. For blog posts, use Import with the link.');
    claude(db);
    limitAi(ctx);
    await keepAlive(reply, async () => {
      const page = await publicFetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'accept-language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15000) });
      const video = page.ok ? youTubeDetails(await page.text()) : null;
      if (!video) throw new HttpError(502, "Couldn't open that video on YouTube");
      const res = await ask(db, {
        system: 'You pull recipes out of cooking video descriptions. Only write down a recipe the description actually gives; never invent one.',
        messages: [{
          role: 'user',
          content: `Video: ${video.title}\n\nDescription:\n${video.description.slice(0, 15000)}\n\nWrite out any recipe in this description. If it only links elsewhere or has no ingredient list, set found to false.`,
        }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: RECIPES_SCHEMA } },
      });
      const out = parsed<{ found?: boolean; recipes?: Partial<PlainRecipe>[] }>(res, 'reading');
      const recipes = (out.recipes ?? []).map((r) => asRecipe(r, `https://www.youtube.com/watch?v=${id}`)).filter((r) => r.ingredients.length);
      if (!out.found || !recipes.length) throw new HttpError(422, "This video's description doesn't include the recipe. It may be on the cook's website instead.");
      return { recipes };
    });
  });

  // Receipt scan, step 1: read the receipt and say which shopping list item each line is.
  app.post('/api/homes/:homeId/shopping/receipt/read', { schema: body({ image: text }, ['image']), bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const ctx = homeCtx(db, req);
    const img = DATA_URL.exec(String((req.body as Row).image ?? ''));
    if (!img) throw new HttpError(400, 'Add a photo of the receipt');
    claude(db);
    limitAi(ctx);
    await keepAlive(reply, async () => {
      const res = await ask(db, {
        system: 'You read grocery store receipts. Store abbreviations are cryptic; turn each line into the plain grocery item it is.',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img[1] as 'image/jpeg', data: img[2] } },
            { type: 'text', text: 'List every item bought on this receipt with its price. Leave out subtotals, tax, totals, payments and coupons as lines (but take line discounts off the item they belong to). If it is not a receipt, set found to false.' },
          ],
        }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
      });
      const out = parsed<{ found?: boolean; store?: string | null; lines?: { name?: string; quantity?: number | null; unit?: string | null; price?: number | null; food?: boolean }[] }>(res, 'reading');
      if (!out.found || !out.lines?.length) throw new HttpError(422, "Couldn't read that receipt. Try a flat, well-lit photo of the whole thing.");
      const open = db.prepare('SELECT id, name FROM shopping_items WHERE home_id = ? AND checked = 0').all(ctx.homeId) as { id: string; name: string }[];
      const lines = out.lines.slice(0, 150).map((l) => {
        const name = str(l.name, 120) ?? 'Item';
        const match = matchListItem(name, open);
        // One receipt line ticks off one list item.
        if (match) open.splice(open.indexOf(match), 1);
        return { name, quantity: num(l.quantity), unit: str(l.unit, 20), price: num(l.price), food: l.food !== false, match };
      });
      return { store: str(out.store, 60), lines };
    });
  });

  // Receipt scan, step 2: tick off the matched list items with their prices, and stock the pantry.
  app.post('/api/homes/:homeId/shopping/receipt/apply', {
    schema: body({ store: text, lines: list({ type: 'object', properties: { name: text, quantity: number, unit: text, price: number, shoppingId: text, toPantry: { type: 'boolean' } } }, 150) }, ['lines']),
  }, async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const store = str(b.store, 60);
    const userId = ctx.user?.id ?? null;
    let checked = 0;
    let stocked = 0;
    tx(db, () => {
      for (const l of b.lines as Row[]) {
        const price = num(l.price);
        const cents = price != null && price >= 0 && price < 100000 ? Math.round(price * 100) / 100 : null;
        const item = l.shoppingId ? db.prepare('SELECT * FROM shopping_items WHERE id = ? AND home_id = ? AND checked = 0').get(String(l.shoppingId), ctx.homeId) as Row | undefined : undefined;
        if (item) {
          db.prepare('UPDATE shopping_items SET price = ?, store = ? WHERE id = ?').run(cents, store, item.id as string);
          checkOff(db, ctx.homeId, item, l.toPantry !== false, userId);
          checked++;
          continue;
        }
        const name = str(l.name, 120);
        if (!name) continue;
        // Not on the list: still count what it cost, already ticked off.
        const g = guessItem(name);
        db.prepare(`INSERT INTO shopping_items (id, home_id, list_id, name, quantity, unit, category, note, checked, checked_at, added_by, price, store)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'from a receipt', 1, datetime('now'), ?, ?, ?)`).run(newId(), ctx.homeId, mainList(db, ctx.homeId), name, num(l.quantity), str(l.unit, 20), g.category, userId, cents, store);
        if (l.toPantry) { stockByName(db, ctx.homeId, name, num(l.quantity) ?? 1, str(l.unit, 20), 'bought', userId); stocked++; }
      }
    });
    return { checked, stocked };
  });

  // Nutrition per serving, estimated by Claude from the ingredients. Kept on the recipe and clearly labeled as an estimate.
  app.post('/api/homes/:homeId/recipes/:id/nutrition', async (req, reply) => {
    const ctx = homeCtx(db, req);
    const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND home_id = ?').get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Recipe not found');
    const r = loadRecipe(db, row);
    if (!r.ingredients.length) throw new HttpError(400, 'Add ingredients first');
    claude(db);
    limitAi(ctx);
    await keepAlive(reply, async () => {
      const res = await ask(db, {
        system: 'You are a registered dietitian estimating nutrition from recipes using standard USDA values. Be realistic; round sensibly.',
        messages: [{
          role: 'user',
          content: [
            `Estimate nutrition for ONE serving of this recipe (it makes ${r.servings ?? 'an unknown number of'} servings; if unknown, assume 4).`,
            'Skip optional ingredients. For "salt to taste" assume a modest amount.',
            '', `Title: ${r.title}`, 'Ingredients:',
            ...r.ingredients.filter((i) => !i.optional).map((i) => `- ${[i.quantity, i.unit, i.name].filter((x) => x != null && x !== '').join(' ')}${i.note ? `, ${i.note}` : ''}`),
          ].join('\n'),
        }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: NUTRITION_SCHEMA } },
      });
      const n = parsed<Record<string, unknown>>(res, 'math');
      const nutrition = Object.fromEntries(NUTRITION_SCHEMA.required.map((k) => [k, Math.max(0, Math.round(num(n[k]) ?? 0))]));
      db.prepare('UPDATE recipes SET nutrition = ? WHERE id = ?').run(JSON.stringify({ ...nutrition, servings: r.servings ?? 4, estimatedAt: new Date().toISOString() }), r.id);
      return { ...nutrition, servings: r.servings ?? 4 };
    });
  });
}
