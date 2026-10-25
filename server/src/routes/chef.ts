// Gordy Scavengé: the AI chef chat. Same Claude setup as the Mixologist, with his own personality and tools.
import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, num, str } from '../util.ts';
import type { Ingredient } from '../../../shared/recipe.ts';
import { saveRecipe } from './recipes.ts';
import { addShoppingItem } from './shopping.ts';
import { ask, claude, keepAlive, stockForPrompt, textOf } from './mixologist.ts';

const PERSONA = `You are Gordy Scavengé, the master chef inside Nighttime Ninja, a home kitchen app run by raccoon chefs. You're a raccoon yourself: an absolute masterchef with warm Southern hospitality.

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
- Offer to put missing ingredients on the shopping list. Only call add_to_shopping_list when the person agrees or asks.
- Call save_recipe when the person asks to save, keep or remember a recipe.
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
    description: "Saves a recipe to the household's recipe book.",
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

const REFUSED = "Sugar, I can't help with that one. Ask me about anything from the kitchen and I'll walk you right through it.";

interface ChatAction { type: 'shopping' | 'saved'; label: string; recipeId?: string }

function cleanIngredient(i: Partial<Ingredient>): Ingredient {
  return { name: str(i.name, 200) ?? 'Ingredient', quantity: num(i.quantity), unit: str(i.unit, 20), note: str(i.note, 200), optional: !!i.optional };
}

export function chefRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.post('/api/homes/:homeId/chef/chat', async (req, reply) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const history = (Array.isArray(b.messages) ? b.messages : [])
      .filter((m: Row) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-30)
      .map((m: Row): Anthropic.Beta.BetaMessageParam => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 8000) }));
    while (history.length && history[0].role !== 'user') history.shift();
    if (!history.length || history[history.length - 1].role !== 'user') throw new HttpError(400, 'Ask Gordy something');
    claude(db);

    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: stockForPrompt(db, ctx.homeId) },
    ];
    const messages = [...history];
    const actions: ChatAction[] = [];
    const replies: string[] = [];

    function runTool(name: string, input: Row): string {
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
        const title = str(input.title, 200) ?? "Gordy's special";
        const id = saveRecipe(db, ctx.homeId, {
          title,
          description: str(input.description, 2000) ?? '',
          servings: num(input.servings), prepMinutes: num(input.prepMinutes), cookMinutes: num(input.cookMinutes),
          sourceUrl: null, image: null,
          ingredients: (Array.isArray(input.ingredients) ? input.ingredients : []).slice(0, 60).map(cleanIngredient),
          instructions: (Array.isArray(input.instructions) ? input.instructions : []).slice(0, 60).map(String),
          tags: ['gordy', ...(Array.isArray(input.tags) ? input.tags.map(String).slice(0, 8) : [])],
        }, userId);
        actions.push({ type: 'saved', label: `Saved ${title}`, recipeId: id });
        return `Saved "${title}" to the recipe book.`;
      }
      throw new Error(`Unknown tool ${name}`);
    }

    await keepAlive(reply, async () => {
      for (let round = 0; round < 6; round++) {
        const res = await ask(db, { system, tools: TOOLS, messages, output_config: { effort: 'low' } });
        if (res.stop_reason === 'refusal') return { reply: REFUSED, actions };
        const text = textOf(res);
        if (text) replies.push(text);
        if (res.stop_reason !== 'tool_use') break;
        messages.push({ role: 'assistant', content: res.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of res.content) {
          if (block.type !== 'tool_use') continue;
          try {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: runTool(block.name, block.input as Row) });
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: (err as Error).message, is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
      }
      return { reply: replies.join('\n\n') || 'Well, come on in! What are we cooking today, sugar?', actions };
    });
  });
}
