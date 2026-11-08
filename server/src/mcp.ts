// A Model Context Protocol server, so AI assistants (Claude Desktop, Claude Code, or anything else that speaks MCP)
// can check the pantry, read recipes and the meal plan, and add to the shopping list.
//
// It's one endpoint, POST /api/mcp, speaking JSON-RPC over the "streamable HTTP" transport without streaming
// (every answer is a single JSON reply). Sign in with a home's API token from Settings → Home → API tokens,
// sent as "Authorization: Bearer nnk_…". A token reaches one home, as a member, and can't manage it.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { parseIngredient } from '../../shared/recipe.ts';
import { publish } from './live.ts';
import type { Row } from './db.ts';
import { addShoppingItem, mainList } from './routes/shopping.ts';
import { loadRecipe } from './routes/recipes.ts';
import { rateLimit } from './security.ts';
import { HttpError } from './util.ts';
import { VERSION } from './updates.ts';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Args = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  run: (db: DatabaseSync, homeId: string, args: Args) => unknown;
}

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const TOOLS: Tool[] = [
  {
    name: 'list_pantry',
    description: "What's in the home's pantry, fridge and freezer: name, amount, where it is, and expiry date. Optionally filter by a word in the name.",
    inputSchema: obj({ search: { type: 'string', description: 'Only items whose name contains this' } }),
    readOnly: true,
    run: (db, homeId, a) => {
      const q = text(a.search, 60);
      const rows = db.prepare(`SELECT name, quantity, unit, location, expires_on FROM items WHERE home_id = ?${q ? ' AND name LIKE ?' : ''} ORDER BY name LIMIT 500`)
        .all(...(q ? [homeId, `%${q}%`] : [homeId])) as Row[];
      return rows.map((r) => ({ name: r.name, quantity: r.quantity, unit: r.unit, location: r.location, expires: r.expires_on }));
    },
  },
  {
    name: 'get_shopping_list',
    description: "Everything still to buy, on every shopping list, with each item's list.",
    inputSchema: obj(),
    readOnly: true,
    run: (db, homeId) => (db.prepare(`SELECT s.name, s.quantity, s.unit, s.note, l.name AS list FROM shopping_items s
      LEFT JOIN shopping_lists l ON l.id = s.list_id WHERE s.home_id = ? AND s.checked = 0 ORDER BY l.position, s.created_at`).all(homeId) as Row[])
      .map((r) => ({ name: r.name, quantity: r.quantity, unit: r.unit, note: r.note, list: r.list ?? 'Main' })),
  },
  {
    name: 'add_to_shopping_list',
    description: 'Adds items to the Main shopping list. Each item is a short line like "2 lb chicken thighs" or "milk". Items already on the list are merged.',
    inputSchema: obj({ items: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 } }, ['items']),
    readOnly: false,
    run: (db, homeId, a) => {
      const lines = (Array.isArray(a.items) ? a.items : []).map((x) => text(x, 120)).filter(Boolean).slice(0, 50);
      if (!lines.length) throw new HttpError(400, 'Give at least one item');
      const listId = mainList(db, homeId);
      const added = lines.map((line) => {
        const p = parseIngredient(line);
        const row = addShoppingItem(db, homeId, { name: p.name || line, quantity: p.quantity, unit: p.unit, note: p.note, listId }, null);
        return row.name;
      });
      publish(homeId, { area: 'shopping', by: null });
      return { added };
    },
  },
  {
    name: 'search_recipes',
    description: "Finds recipes in the home's recipe book by words in the title or tags. Leave the query empty for favorites and recent ones.",
    inputSchema: obj({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }),
    readOnly: true,
    run: (db, homeId, a) => {
      const q = text(a.query, 80);
      const limit = Math.min(50, Math.max(1, Number(a.limit) || 15));
      const rows = db.prepare(`SELECT id, title, tags, servings, prep_minutes, cook_minutes, favorite, rating FROM recipes WHERE home_id = ?
        ${q ? 'AND (title LIKE ? OR tags LIKE ?)' : ''} ORDER BY favorite DESC, rating DESC, updated_at DESC LIMIT ?`)
        .all(...(q ? [homeId, `%${q}%`, `%${q}%`, limit] : [homeId, limit])) as Row[];
      return rows.map((r) => ({ id: r.id, title: r.title, tags: JSON.parse(String(r.tags ?? '[]')), servings: r.servings, minutes: (Number(r.prep_minutes) || 0) + (Number(r.cook_minutes) || 0) || null, favorite: !!r.favorite, rating: r.rating }));
    },
  },
  {
    name: 'get_recipe',
    description: 'One recipe in full: ingredients, steps, servings and times. Use an id from search_recipes or get_meal_plan.',
    inputSchema: obj({ id: { type: 'string' } }, ['id']),
    readOnly: true,
    run: (db, homeId, a) => {
      const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND home_id = ?').get(text(a.id, 40), homeId) as Row | undefined;
      if (!row) throw new HttpError(404, 'No recipe with that id in this home');
      const { isPublic: _p, shareSlug: _s, ...r } = loadRecipe(db, row);
      return r;
    },
  },
  {
    name: 'get_meal_plan',
    description: "The meal plan from today: date, meal, what's planned (with its recipe id when it's from the book) and whether it's been cooked.",
    inputSchema: obj({ days: { type: 'integer', minimum: 1, maximum: 31, description: 'How many days ahead, default 7' } }),
    readOnly: true,
    run: (db, homeId, a) => {
      const days = Math.min(31, Math.max(1, Number(a.days) || 7));
      const rows = db.prepare(`SELECT m.date, m.slot, m.title, m.note, m.recipe_id, m.cooked_at, r.title AS recipe FROM meal_plan m
        LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.home_id = ? AND m.date >= date('now', 'localtime') AND m.date < date('now', 'localtime', ?)
        ORDER BY m.date, m.slot`).all(homeId, `+${days} days`) as Row[];
      return rows.map((r) => ({ date: r.date, meal: r.slot, title: r.recipe ?? r.title, recipeId: r.recipe_id, note: r.note, cooked: !!r.cooked_at }));
    },
  },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Args };
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function handle(db: DatabaseSync, homeId: string, msg: Rpc): object | null {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid request');
  // Notifications (no id) get no reply.
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case 'initialize': {
      const asked = text(msg.params?.protocolVersion, 20);
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'nighttime-ninja', title: 'Nighttime Ninja', version: VERSION },
        instructions: "The household's kitchen: pantry, recipes, meal plan and shopping list. Check the pantry before suggesting a shopping list.",
      });
    }
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly } })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${String(msg.params?.name)}`);
      try {
        const out = tool.run(db, homeId, (msg.params?.arguments ?? {}) as Args);
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { results: out } : out, isError: false });
      } catch (err) {
        // Tool errors go back to the model as a result it can read, not as a protocol error.
        return ok(msg.id, { content: [{ type: 'text', text: err instanceof HttpError ? err.message : 'Something went wrong' }], isError: true });
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export function mcpRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const homeOf = (req: FastifyRequest): string => {
    if (!req.tokenHomeId) throw new HttpError(401, 'Use a home API token (Settings → Home → API tokens) as a Bearer token');
    return req.tokenHomeId;
  };

  app.post('/api/mcp', async (req, reply: FastifyReply) => {
    const homeId = homeOf(req);
    rateLimit(`mcp:${homeId}`, 600, 3600e3);
    const body = req.body as Rpc | Rpc[];
    if (Array.isArray(body)) {
      const out = body.slice(0, 50).map((m) => handle(db, homeId, m)).filter(Boolean);
      return out.length ? out : reply.code(202).send();
    }
    const out = handle(db, homeId, body);
    return out ?? reply.code(202).send();
  });

  // No server-to-client stream: say so, as the transport asks.
  app.get('/api/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send());
  app.delete('/api/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send());
}
