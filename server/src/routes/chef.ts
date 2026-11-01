// Gordy Scavengé: the AI chef chat. Same Claude setup as the Mixologist, with his own personality and tools.
import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, num, str } from '../util.ts';
import type { Ingredient } from '../../../shared/recipe.ts';
import { checkIngredients, loadRecipe, saveRecipe, stockIndex } from './recipes.ts';
import { addShoppingItem } from './shopping.ts';
import { ask, claude, keepAlive, limitAi, textOf } from '../claude.ts';
import { stockForPrompt } from './mixologist.ts';
import { existingRecipeId, runChat, TOOL_RULES } from './aichat.ts';

export const PERSONA = `You are Gordy Scavengé, the master chef inside Nighttime Ninja, a home kitchen app run by raccoon chefs. You're a raccoon yourself: an absolute masterchef with warm Southern hospitality.

# Southern Masterchef

Act as a warm, hospitable masterchef of downhome Southern cooking.

## Specialties
- Southern recipes, comfort food and cooking advice.
- Virginia-style Mexican restaurant food, especially the iconic sweet white salsa/sauce.
- Steak preparation and grilling.
- Breadmaking, especially copycat Texas Roadhouse rolls and Hardee's biscuits.
- Southern sweet tea and homemade lemonade.
You're a great all-around cook too, so help with any cooking question, but these are your home turf.

## Persona & tone
- Warm & hospitable: speak with authentic Southern charm and hospitality. Be inviting, encouraging and deeply knowledgeable.
- Expertise: you are a culinary master. Always explain the *why* behind techniques (why biscuits need ice-cold fat, how to properly bloom yeast for rolls).

## Core culinary pillars
1. Downhome Southern cooking: rich, flavorful, traditional Southern recipes.
2. Virginia-style Mexican: recreate the distinct flavors of VA Mexican restaurants, especially the famous sweet white sauce (salsa blanca) made with Miracle Whip/mayo, milk and spices.
3. The perfect steak: selecting, seasoning, resting and cooking great steaks, cast-iron seared or grilled.
4. Master breadmaker:
   - Texas Roadhouse rolls: the soft, sweet yeast dough and the signature honey cinnamon butter.
   - Hardee's biscuits: self-rising flour, buttermilk, shortening/lard, and folding for the perfect rise and flaky layers.
5. Southern beverages:
   - Sweet tea: steeping times, adding sugar while hot, and a pinch of baking soda to take away bitterness.
   - Lemonade: balance fresh-squeezed lemon juice with a proper simple syrup.

## Steps for responding
1. Welcome: greet the person warmly and acknowledge their craving or request.
2. The secret/technique: share a brief masterchef tip or secret about the dish before the recipe.
3. Ingredients & instructions: clear, step-by-step, with standard US volume measurements, but emphasize technique over strict rules.
4. Serving suggestions: pairing ideas or serving tips (e.g. "Serve this with a tall glass of ice-cold sweet tea").

## In this app
- You can see what the household has in stock (below). Lean on it, use the item names as they appear there, and say plainly what they'd need to buy.
- Items marked [use soon] are about to go off. When someone asks what to cook, or asks to use things up, build around those first.
- Offer to put missing ingredients on the shopping list. Only call add_to_shopping_list when the person agrees or asks.
- Never save a recipe on your own. Call save_recipe only when the person asks to save, keep or remember a recipe, or says yes when you offer to save it.
- Use Markdown: a bold recipe name, bullet lists for ingredients, numbered steps. Keep the charm, but don't pad.`;

const INGREDIENT = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The ingredient. Use the household item name when it is in stock.' },
    quantity: { type: ['number', 'null'] },
    unit: { type: ['string', 'null'], description: 'cup, tbsp, tsp, lb, oz, each...' },
    note: { type: ['string', 'null'], description: 'e.g. "ice cold", "softened", "or lard".' },
    optional: { type: 'boolean' },
  },
  required: ['name', 'quantity', 'unit', 'note', 'optional'],
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
          items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: ['number', 'null'] }, unit: { type: ['string', 'null'] } }, required: ['name'] },
        },
        forRecipe: { type: ['string', 'null'], description: 'The dish these are for, shown as a note on the list.' },
      },
      required: ['items'],
    },
  },
  {
    name: 'save_recipe',
    description: "Saves a recipe to the household's recipe book. Only use when the person asks to save it or says yes to your offer to save it.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: 'A line or two, including your masterchef tip.' },
        servings: { type: ['number', 'null'] },
        prepMinutes: { type: ['number', 'null'] },
        cookMinutes: { type: ['number', 'null'] },
        ingredients: { type: 'array', items: INGREDIENT },
        instructions: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' }, description: 'e.g. southern, bread, steak, drinks.' },
      },
      required: ['title', 'description', 'ingredients', 'instructions'],
    } as unknown as Anthropic.Beta.BetaTool.InputSchema,
  },
];

export const REFUSED = "Sugar, I can't help with that one. Ask me about anything from the kitchen and I'll walk you right through it.";


function cleanIngredient(i: Partial<Ingredient>): Ingredient {
  return { name: str(i.name, 200) ?? 'Ingredient', quantity: num(i.quantity), unit: str(i.unit, 20), note: str(i.note, 200), optional: !!i.optional };
}

export const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string', description: 'One or two lines on the dish.' },
    servings: { type: ['number', 'null'] },
    prepMinutes: { type: ['number', 'null'] },
    cookMinutes: { type: ['number', 'null'] },
    ingredients: { type: 'array', items: { ...INGREDIENT, additionalProperties: false } },
    instructions: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'description', 'servings', 'prepMinutes', 'cookMinutes', 'ingredients', 'instructions'],
  additionalProperties: false,
} as const;

const PERFECT_SCHEMA = {
  type: 'object',
  properties: {
    greeting: { type: 'string', description: 'A short, warm note in your voice about the recipe.' },
    improvements: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string', description: 'The change, in a few words.' }, why: { type: 'string', description: 'Why it makes the dish better.' } },
        required: ['title', 'why'],
        additionalProperties: false,
      },
    },
    perfected: { ...RECIPE_SCHEMA, description: 'The whole recipe with your improvements worked in.' },
    mealIdeas: {
      type: 'array',
      description: 'Meals to put on the meal plan that go with or build on this recipe, made mostly from what is in stock.',
      items: {
        type: 'object',
        properties: { pitch: { type: 'string', description: 'One line on why this meal fits.' }, recipe: RECIPE_SCHEMA },
        required: ['pitch', 'recipe'],
        additionalProperties: false,
      },
    },
  },
  required: ['greeting', 'improvements', 'perfected', 'mealIdeas'],
  additionalProperties: false,
} as const;

export interface PlainRecipe {
  title: string; description: string; servings: number | null; prepMinutes: number | null; cookMinutes: number | null;
  ingredients: Partial<Ingredient>[]; instructions: string[];
}

export function cleanRecipe(r: Partial<PlainRecipe> | undefined): PlainRecipe & { ingredients: Ingredient[] } {
  return {
    title: str(r?.title, 200) ?? "Gordy's special",
    description: str(r?.description, 2000) ?? '',
    servings: num(r?.servings), prepMinutes: num(r?.prepMinutes), cookMinutes: num(r?.cookMinutes),
    ingredients: (Array.isArray(r?.ingredients) ? r.ingredients : []).slice(0, 60).map(cleanIngredient),
    instructions: (Array.isArray(r?.instructions) ? r.instructions : []).slice(0, 60).map(String),
  };
}

/** The recipe as Gordy reads it: from the recipe book, or whatever the person typed or pasted. */
function recipeText(db: DatabaseSync, homeId: string, b: Row): string {
  const id = str(b.recipeId, 60);
  if (id) {
    const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND home_id = ?').get(id, homeId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Recipe not found');
    const r = loadRecipe(db, row);
    return [
      `Title: ${r.title}`,
      r.description && `Description: ${r.description}`,
      r.servings && `Serves: ${r.servings}`,
      'Ingredients:',
      ...r.ingredients.map((i) => `- ${[i.quantity, i.unit, i.name].filter((x) => x != null && x !== '').join(' ')}${i.note ? `, ${i.note}` : ''}${i.optional ? ' (optional)' : ''}`),
      'Steps:',
      ...r.instructions.map((s, n) => `${n + 1}. ${s}`),
    ].filter(Boolean).join('\n');
  }
  const text = str(b.text, 20000);
  if (!text) throw new HttpError(400, 'Pick a recipe or paste one in');
  return text;
}

export function chefRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // "Help me perfect my recipe": tips, an improved version, and meal ideas checked against the pantry.
  app.post('/api/homes/:homeId/chef/perfect', async (req, reply) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const recipe = recipeText(db, ctx.homeId, b);
    const notes = str(b.notes, 1000);
    const ideas = Math.min(5, Math.max(1, num(b.ideas) ?? 3));
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
            'Help me perfect this recipe. Tell me what to change and why, then give me the whole improved recipe.',
            `Then suggest ${ideas} meal${ideas === 1 ? '' : 's'} I could put on my meal plan that go with it or build on it, made mostly from what I have in stock. Each may need a few things I'd have to buy.`,
            'Use the household item names exactly as listed for anything in stock. US measurements.',
            notes && `What I'm hoping for: ${notes}`,
            '',
            recipe,
          ].filter((x) => x !== null && x !== undefined).join('\n'),
        }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: PERFECT_SCHEMA } },
      });
      if (res.stop_reason === 'refusal') throw new HttpError(422, REFUSED);
      let parsed: { greeting?: string; improvements?: { title?: string; why?: string }[]; perfected?: Partial<PlainRecipe>; mealIdeas?: { pitch?: string; recipe?: Partial<PlainRecipe> }[] };
      try { parsed = JSON.parse(textOf(res)); } catch { throw new HttpError(502, "Gordy's answer got garbled. Try again."); }
      const index = stockIndex(db, ctx.homeId);
      const withPantry = (r: ReturnType<typeof cleanRecipe>) => {
        const ingredients = checkIngredients(index, r.ingredients);
        const missing = ingredients.filter((i) => !i.optional && (i.availability === 'missing' || i.availability === 'low'));
        return { ...r, ingredients, missing: missing.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })), status: missing.length === 0 ? 'ready' : missing.length <= 3 ? 'almost' : 'missing' };
      };
      return {
        greeting: str(parsed.greeting, 2000) ?? '',
        improvements: (parsed.improvements ?? []).slice(0, 12).map((i) => ({ title: str(i.title, 200) ?? '', why: str(i.why, 1000) ?? '' })).filter((i) => i.title),
        perfected: withPantry(cleanRecipe(parsed.perfected)),
        mealIdeas: (parsed.mealIdeas ?? []).slice(0, ideas).map((m) => ({ pitch: str(m.pitch, 500) ?? '', ...withPantry(cleanRecipe(m.recipe)) })),
        sourceRecipeId: str(b.recipeId, 60),
      };
    });
  });

  // Saves a recipe Gordy came up with (from the perfect-my-recipe results).
  app.post('/api/homes/:homeId/chef/save', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const r = cleanRecipe(b.recipe as Partial<PlainRecipe>);
    if (!r.ingredients.length) throw new HttpError(400, 'That recipe has no ingredients');
    const replaceId = str(b.replaceId, 60);
    if (replaceId && !db.prepare('SELECT 1 FROM recipes WHERE id = ? AND home_id = ?').get(replaceId, ctx.homeId)) throw new HttpError(404, 'Recipe not found');
    const tags = Array.isArray(b.tags) ? b.tags.map(String).slice(0, 8) : [];
    const recipe = { ...r, sourceUrl: null, image: null, tags: ['gordy', ...tags] };
    const id = replaceId ? saveRecipe(db, ctx.homeId, recipe, ctx.user?.id ?? null, replaceId) : saveRecipe(db, ctx.homeId, recipe, ctx.user?.id ?? null);
    return { id };
  });
  app.post('/api/homes/:homeId/chef/chat', async (req, reply) => {
    const ctx = homeCtx(db, req);
    await runChat(db, req, reply, {
      kind: 'chef',
      system: [
        { type: 'text', text: PERSONA + TOOL_RULES, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: stockForPrompt(db, ctx.homeId) },
      ],
      tools: TOOLS,
      saveTool: 'save_recipe',
      refused: REFUSED,
      empty: 'Well, come on in! What are we cooking today, sugar?',
      runTool(name, input, actions) {
        const userId = ctx.user?.id ?? null;
        if (name === 'add_to_shopping_list') {
          const items = (Array.isArray(input.items) ? input.items : []).slice(0, 30) as Row[];
          const forRecipe = str(input.forRecipe, 120);
          const added = items.map((i) => addShoppingItem(db, ctx.homeId, {
            name: str(i.name, 120) ?? '', quantity: num(i.quantity), unit: str(i.unit, 20), note: forRecipe ? `for ${forRecipe}` : 'from Gordy',
          }, userId));
          for (const a of added) actions.push({ type: 'shopping', label: `Added ${a.name} to the shopping list` });
          return `Added to the shopping list: ${added.map((a) => a.name).join(', ')}`;
        }
        if (name === 'save_recipe') {
          const r = cleanRecipe(input as Partial<PlainRecipe>);
          if (!r.ingredients.length) throw new Error('A recipe needs its ingredients to be saved. Include them.');
          const tags = Array.isArray(input.tags) ? input.tags.map(String).slice(0, 8) : [];
          // Saving the same recipe again updates it instead of adding another copy.
          const existing = existingRecipeId(db, ctx.homeId, r.title);
          const id = saveRecipe(db, ctx.homeId, { ...r, sourceUrl: null, image: null, tags: ['gordy', ...tags] }, userId, existing);
          if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) throw new Error('The save did not stick');
          actions.push({ type: 'saved', label: `${existing ? 'Updated' : 'Saved'} ${r.title}`, recipeId: id });
          return existing ? `"${r.title}" was already in the recipe book, so it was updated instead of copied.` : `Saved "${r.title}" to the recipe book.`;
        }
        throw new Error(`Unknown tool ${name}`);
      },
    });
  });
}
