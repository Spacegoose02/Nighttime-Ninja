import Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting, homeCtx, requireAdmin, setSetting } from '../auth.ts';
import type { Row } from '../db.ts';
import { config } from '../config.ts';
import { HttpError, num, str } from '../util.ts';
import type { Ingredient } from '../../../shared/recipe.ts';
import { checkIngredients, saveRecipe, stockIndex } from './recipes.ts';
import { addShoppingItem } from './shopping.ts';
import { existingRecipeId, runChat, TOOL_RULES } from './aichat.ts';

const PERSONA = `You are the Mixologist inside Nighttime Ninja, a home kitchen app run by a raccoon chef.

A mixologist is more than a bartender: a master at crafting drinks who invents new cocktails and perfects the classics, keeps an eye on the bar's inventory, and teaches people about what they're drinking. You have a knack for blending flavors, a sharp sense for pairing spirits with mixers, and you enjoy sharing that knowledge so people try something new.

How you work:
- You can see what the household has in stock (below). Build drinks from it first. Use the item names as they appear there, so the app can match them to the pantry.
- When someone lists ingredients, suggest drinks they can make right now from exactly those, and say plainly if a drink needs something they didn't mention.
- Give amounts in US bar measures: oz, dashes, barspoons, splashes, "top with". One shot is 1.5 oz.
- For each recipe give a short name, one line on the taste, the ingredients as a list with amounts, then a short "Build:" with the method and glass.
- If a drink would be better with one or two things they don't have, say so and offer to put them on the shopping list. Only call add_to_shopping_list when the person agrees or asks.
- Call save_drink_recipe when the person asks to save, keep, or remember a drink.
- Keep replies friendly and to the point. Use Markdown: short headings or bold names, bullet lists for ingredients.
- Encourage drinking responsibly when it fits, without lecturing. Never help someone who says they are under 21 make alcoholic drinks; offer a mocktail instead.`;

const INGREDIENT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The ingredient. Use the household item name when it is in stock.' },
    quantity: { type: ['number', 'null'] },
    unit: { type: ['string', 'null'], description: 'oz, dash, barspoon, splash, tsp, each... null for "top with" or garnish.' },
    note: { type: ['string', 'null'], description: 'e.g. "top with", "for garnish", "or triple sec".' },
    optional: { type: 'boolean' },
  },
  required: ['name', 'quantity', 'unit', 'note', 'optional'],
  additionalProperties: false,
} as const;

const DRINK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string', description: 'One line on how it tastes.' },
    glass: { type: 'string' },
    garnish: { type: ['string', 'null'] },
    ingredients: { type: 'array', items: INGREDIENT_SCHEMA },
    instructions: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'description', 'glass', 'garnish', 'ingredients', 'instructions'],
  additionalProperties: false,
} as const;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'add_to_shopping_list',
    description: "Adds items to the household's shared shopping list. Use only when the person agrees or asks.",
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, quantity: { type: ['number', 'null'] }, unit: { type: ['string', 'null'] } },
            required: ['name'],
          },
        },
        forDrink: { type: ['string', 'null'], description: 'The drink these are for, shown as a note on the list.' },
      },
      required: ['items'],
    },
  },
  {
    name: 'save_drink_recipe',
    description: "Saves a drink to the household's recipe book, tagged as a cocktail, so it shows up under Drinks.",
    input_schema: { ...DRINK_SCHEMA, properties: { ...DRINK_SCHEMA.properties, style: { type: ['string', 'null'] } } } as unknown as Anthropic.Beta.BetaTool.InputSchema,
  },
];

// Models that take the server-side refusal fallback. Others just run without it.
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/** The models an admin can pick in Settings. ANTHROPIC_MODEL can name any other one. */
export const MODEL_CHOICES = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', blurb: 'Best drinks, the default' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', blurb: 'Faster, about half the price' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', blurb: 'Quickest and cheapest' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', blurb: 'Most capable, priciest' },
];

/** An admin's pick in Settings wins over ANTHROPIC_MODEL. */
export function mixologistModel(db: DatabaseSync): string | null {
  if (!config.anthropic) return null;
  return getSetting(db, 'mixologistModel') ?? config.anthropic.model;
}

let client: Anthropic | null = null;

export function claude(db: DatabaseSync): { client: Anthropic; model: string } {
  if (!config.anthropic) throw new HttpError(503, 'The Mixologist needs a Claude API key. Add ANTHROPIC_API_KEY to the server settings and restart.');
  client ??= new Anthropic({ apiKey: config.anthropic.apiKey });
  return { client, model: mixologistModel(db)! };
}

/** Claude's own explanation from an API error, e.g. "model: claude-x is not available". */
function claudeMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? err.message;
}

export async function ask(db: DatabaseSync, params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model' | 'max_tokens'>): Promise<Anthropic.Beta.BetaMessage> {
  const { client, model } = claude(db);
  const { output_config, ...rest } = params;
  const send = (withFallback: boolean) => client.beta.messages.stream({
    ...rest,
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium', ...output_config },
    ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  }).finalMessage();
  try {
    try {
      return await send(FALLBACK_MODELS.has(model));
    } catch (err) {
      // Not every account can use the refusal fallback yet. If Claude turns the request down, try once without it.
      if (!(err instanceof Anthropic.BadRequestError) || !FALLBACK_MODELS.has(model)) throw err;
      console.warn('Mixologist: retrying without the refusal fallback:', claudeMessage(err));
      return await send(false);
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'Claude rejected the API key. Check ANTHROPIC_API_KEY.');
    if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
      throw new HttpError(502, `Claude can't use ${model} with this API key. Pick another model in Settings → Server admin. (${claudeMessage(err)})`);
    }
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The Mixologist is getting a lot of orders. Try again in a minute.');
    if (err instanceof Anthropic.APIError) {
      console.error('Mixologist: Claude API error', err.status, claudeMessage(err));
      throw new HttpError(502, `Claude answered ${err.status ?? 'with a network error'}: ${claudeMessage(err)}`);
    }
    throw err;
  }
}

const isBar = (r: Row) => String(r.category).toLowerCase() === 'bar' || String(r.location).toLowerCase() === 'bar';

/** What's in stock, bar first, written out for the model. */
export function stockForPrompt(db: DatabaseSync, homeId: string): string {
  const rows = db.prepare('SELECT name, category, location, quantity, unit FROM items WHERE home_id = ? AND quantity > 0 ORDER BY name COLLATE NOCASE LIMIT 600').all(homeId) as Row[];
  const line = (r: Row) => `- ${r.name}${r.unit && r.unit !== 'each' ? ` (${r.quantity} ${r.unit})` : (r.quantity as number) > 1 ? ` (${r.quantity})` : ''}`;
  const bar = rows.filter(isBar);
  const rest = rows.filter((r) => !isBar(r));
  return [
    "The household's bar (liquor, liqueurs, mixers):",
    bar.length ? bar.map(line).join('\n') : '- (nothing marked as bar stock yet)',
    '',
    'Everything else in stock (juices, sodas, fruit, dairy, sweeteners and so on are fair game):',
    rest.length ? rest.map(line).join('\n') : '- (pantry is empty)',
  ].join('\n');
}

export interface Drink {
  title: string;
  description: string;
  glass: string;
  garnish: string | null;
  ingredients: Ingredient[];
  instructions: string[];
  style?: string | null;
}

/** Bar "oz" are fluid ounces; the shared unit table reads a bare "oz" as weight. */
function cleanIngredient(i: Partial<Ingredient>): Ingredient {
  const unit = str(i.unit, 20);
  return {
    name: str(i.name, 200) ?? 'Ingredient',
    quantity: num(i.quantity),
    unit: unit && /^(oz|ounces?)$/i.test(unit) ? 'fl oz' : unit,
    note: str(i.note, 200),
    optional: !!i.optional,
  };
}

function cleanDrink(d: Partial<Drink>): Drink {
  return {
    title: str(d.title, 200) ?? 'House special',
    description: str(d.description, 1000) ?? '',
    glass: str(d.glass, 80) ?? '',
    garnish: str(d.garnish, 200),
    ingredients: (Array.isArray(d.ingredients) ? d.ingredients : []).slice(0, 30).map(cleanIngredient),
    instructions: (Array.isArray(d.instructions) ? d.instructions : []).slice(0, 30).map((s) => String(s)),
    style: str(d.style, 40),
  };
}

export function saveDrink(db: DatabaseSync, homeId: string, d: Drink, userId: string | null, id?: string): string {
  const extra = [d.glass && `Glass: ${d.glass}.`, d.garnish && `Garnish: ${d.garnish}.`].filter(Boolean).join(' ');
  return saveRecipe(db, homeId, {
    title: d.title,
    description: [d.description, extra].filter(Boolean).join('\n\n'),
    servings: 1, prepMinutes: 5, cookMinutes: null, sourceUrl: null, image: null,
    ingredients: d.ingredients,
    instructions: d.instructions,
    tags: ['cocktail', ...(d.style ? [d.style.toLowerCase()] : [])],
  }, userId, id);
}

/** Marks each ingredient have/missing against the pantry. Drinks missing one or two things are "almost". */
function withAvailability(db: DatabaseSync, homeId: string, drinks: Drink[]) {
  const index = stockIndex(db, homeId);
  return drinks.map((d) => {
    const ingredients = checkIngredients(index, d.ingredients);
    const missing = ingredients.filter((i) => !i.optional && i.availability === 'missing').map((i) => i.name);
    const status = missing.length === 0 ? 'ready' : missing.length <= 2 ? 'almost' : 'missing';
    return { ...d, ingredients, missing, status };
  }).sort((a, b) => a.missing.length - b.missing.length);
}

export function textOf(m: Anthropic.Beta.BetaMessage): string {
  return m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n').trim();
}

/**
 * Claude can take a minute or more, and reverse proxies often give up after 60 seconds with a bare 502.
 * Send the 200 right away and a space every few seconds (JSON ignores leading whitespace), then the answer.
 * A failure after that point goes in the body with x-nn-deferred set, and the web app's api() turns it back into an error.
 */
export async function keepAlive(reply: FastifyReply, work: () => Promise<unknown>): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'x-accel-buffering': 'no', 'x-nn-deferred': '1',
  });
  raw.write(' ');
  const timer = setInterval(() => raw.write(' '), 5000);
  try {
    raw.end(JSON.stringify(await work()));
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('Mixologist:', err);
    const status = err instanceof HttpError ? err.status : 500;
    raw.end(JSON.stringify({ error: err instanceof HttpError ? err.message : 'Something went wrong in the kitchen', status }));
  } finally {
    clearInterval(timer);
  }
}

const REFUSED = "I can't help with that one. Ask me about another drink, or tell me what's in your bar and I'll mix something up.";


export function mixologistRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/mixologist/status', async () => ({ available: !!config.anthropic, model: mixologistModel(db) }));

  app.get('/api/admin/mixologist', async (req) => {
    requireAdmin(req);
    return { available: !!config.anthropic, model: mixologistModel(db), envModel: config.anthropic?.model ?? null, choices: MODEL_CHOICES };
  });

  app.patch('/api/admin/mixologist', async (req) => {
    requireAdmin(req);
    const model = str(((req.body ?? {}) as Row).model, 80);
    if (!model || !(MODEL_CHOICES.some((c) => c.id === model) || model === config.anthropic?.model)) throw new HttpError(400, 'Pick one of the listed models');
    // Picking the env var's model clears the override, so ANTHROPIC_MODEL takes over again.
    if (model === config.anthropic?.model) db.prepare("DELETE FROM server_settings WHERE key = 'mixologistModel'").run();
    else setSetting(db, 'mixologistModel', model);
    return { model: mixologistModel(db) };
  });

  app.post('/api/homes/:homeId/mixologist/chat', async (req, reply) => {
    const ctx = homeCtx(db, req);
    await runChat(db, req, reply, {
      kind: 'mixologist',
      system: [
        { type: 'text', text: PERSONA + TOOL_RULES, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: stockForPrompt(db, ctx.homeId) },
      ],
      tools: TOOLS,
      saveTool: 'save_drink_recipe',
      refused: REFUSED,
      empty: "Let me know what you're in the mood for.",
      runTool(name, input, actions) {
        const userId = ctx.user?.id ?? null;
        if (name === 'add_to_shopping_list') {
          const items = (Array.isArray(input.items) ? input.items : []).slice(0, 20) as Row[];
          const forDrink = str(input.forDrink, 120);
          const added = items.map((i) => addShoppingItem(db, ctx.homeId, {
            name: str(i.name, 120) ?? '', quantity: num(i.quantity), unit: str(i.unit, 20), note: forDrink ? `for ${forDrink}` : 'from Rocco',
          }, userId));
          for (const a of added) actions.push({ type: 'shopping', label: `Added ${a.name} to the shopping list` });
          return `Added to the shopping list: ${added.map((a) => a.name).join(', ')}`;
        }
        if (name === 'save_drink_recipe') {
          const drink = cleanDrink(input as Partial<Drink>);
          if (!drink.ingredients.length) throw new Error('A drink needs its ingredients to be saved. Include them.');
          // Saving the same drink again updates it instead of adding another copy.
          const existing = existingRecipeId(db, ctx.homeId, drink.title);
          const id = saveDrink(db, ctx.homeId, drink, userId, existing);
          if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) throw new Error('The save did not stick');
          actions.push({ type: 'saved', label: `${existing ? 'Updated' : 'Saved'} ${drink.title}`, recipeId: id });
          return existing ? `"${drink.title}" was already in the recipe book, so it was updated instead of copied.` : `Saved "${drink.title}" to the recipe book.`;
        }
        throw new Error(`Unknown tool ${name}`);
      },
    });
  });

  // Idea Zone: pick a style, get recipes built from what's in stock.
  app.post('/api/homes/:homeId/mixologist/ideas', async (req, reply) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const style = str(b.style, 60) ?? 'Surprise me';
    const notes = str(b.notes, 500);
    const count = Math.min(6, Math.max(1, num(b.count) ?? 4));
    const prompt = [
      `Give me ${count} different drink ideas. Style: ${style}.`,
      notes && `Also: ${notes}`,
      'Build each drink from what is in stock. A drink may need at most two things that are not in stock; prefer drinks that need none.',
      'Use the household item names exactly as listed for anything in stock. Amounts in oz for liquids.',
    ].filter(Boolean).join('\n');
    claude(db);
    await keepAlive(reply, async () => {
    const res = await ask(db, {
      system: [
        { type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: stockForPrompt(db, ctx.homeId) },
      ],
      messages: [{ role: 'user', content: prompt }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: { type: 'object', properties: { drinks: { type: 'array', items: DRINK_SCHEMA } }, required: ['drinks'], additionalProperties: false },
        },
      },
    });
    if (res.stop_reason === 'refusal') throw new HttpError(422, REFUSED);
    let parsed: { drinks?: Partial<Drink>[] };
    try { parsed = JSON.parse(textOf(res)); } catch { throw new HttpError(502, "The Mixologist's answer got garbled. Try again."); }
    const drinks = (parsed.drinks ?? []).map((d) => cleanDrink({ ...d, style }));
    return { drinks: withAvailability(db, ctx.homeId, drinks) };
    });
  });

  app.post('/api/homes/:homeId/mixologist/save', async (req) => {
    const ctx = homeCtx(db, req);
    const drink = cleanDrink(((req.body ?? {}) as Row).drink as Partial<Drink> ?? {});
    if (!drink.ingredients.length) throw new HttpError(400, 'That drink has no ingredients');
    return { id: saveDrink(db, ctx.homeId, drink, ctx.user?.id ?? null) };
  });
}
