import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { config } from '../config.ts';
import { HttpError, newId, str } from '../util.ts';
import { checkIngredients, loadRecipe, stockIndex } from './recipes.ts';
import { addShoppingItem } from './shopping.ts';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const SLOT_TIMES: Record<string, [number, number]> = { breakfast: [8, 30], lunch: [12, 45], snack: [15, 30], dinner: [18, 60] };

function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shape(r: Row) {
  return {
    id: r.id, date: r.date, slot: r.slot, recipeId: r.recipe_id, title: r.recipe_title ?? r.title,
    image: r.recipe_image ?? null, note: r.note, cookedAt: r.cooked_at,
  };
}

const SELECT = `SELECT m.*, r.title AS recipe_title, r.image AS recipe_image FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id`;

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function mealPlanRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/mealplan', async (req) => {
    const ctx = homeCtx(db, req);
    const q = req.query as Row;
    const start = isDate(q.start) ? q.start : new Date().toISOString().slice(0, 10);
    const days = Math.min(62, Math.max(1, Number(q.days) || 7));
    const rows = db.prepare(`${SELECT} WHERE m.home_id = ? AND m.date >= ? AND m.date < ? ORDER BY m.date, m.slot`)
      .all(ctx.homeId, start, addDays(start, days)) as Row[];
    return rows.map(shape);
  });

  app.post('/api/homes/:homeId/mealplan', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    if (!isDate(b.date)) throw new HttpError(400, 'Pick a date');
    const slot = SLOTS.includes(b.slot as (typeof SLOTS)[number]) ? (b.slot as string) : 'dinner';
    const recipeId = str(b.recipeId, 60);
    if (recipeId && !db.prepare('SELECT 1 FROM recipes WHERE id = ? AND home_id = ?').get(recipeId, ctx.homeId)) throw new HttpError(404, 'Recipe not found');
    const title = str(b.title, 200);
    if (!recipeId && !title) throw new HttpError(400, 'Pick a recipe or type a meal');
    const id = newId();
    db.prepare('INSERT INTO meal_plan (id, home_id, date, slot, recipe_id, title, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, b.date, slot, recipeId, title, str(b.note, 500));
    return shape(db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as Row);
  });

  app.patch('/api/homes/:homeId/mealplan/:id', async (req) => {
    const ctx = homeCtx(db, req);
    const { id } = req.params as { id: string };
    if (!db.prepare('SELECT 1 FROM meal_plan WHERE id = ? AND home_id = ?').get(id, ctx.homeId)) throw new HttpError(404, 'Not on the plan');
    const b = (req.body ?? {}) as Row;
    if (isDate(b.date)) db.prepare('UPDATE meal_plan SET date = ? WHERE id = ?').run(b.date, id);
    if (SLOTS.includes(b.slot as (typeof SLOTS)[number])) db.prepare('UPDATE meal_plan SET slot = ? WHERE id = ?').run(b.slot as string, id);
    if ('note' in b) db.prepare('UPDATE meal_plan SET note = ? WHERE id = ?').run(str(b.note, 500), id);
    if ('cooked' in b) db.prepare(`UPDATE meal_plan SET cooked_at = ${b.cooked ? "datetime('now')" : 'NULL'} WHERE id = ?`).run(id);
    return shape(db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as Row);
  });

  app.delete('/api/homes/:homeId/mealplan/:id', async (req) => {
    const ctx = homeCtx(db, req);
    db.prepare('DELETE FROM meal_plan WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // Puts every ingredient for the planned meals on the shopping list, minus what's already in stock.
  app.post('/api/homes/:homeId/mealplan/to-shopping', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const start = isDate(b.start) ? b.start : new Date().toISOString().slice(0, 10);
    const days = Math.min(31, Math.max(1, Number(b.days) || 7));
    const meals = db.prepare('SELECT recipe_id FROM meal_plan WHERE home_id = ? AND date >= ? AND date < ? AND recipe_id IS NOT NULL AND cooked_at IS NULL')
      .all(ctx.homeId, start, addDays(start, days)) as Row[];
    const index = stockIndex(db, ctx.homeId);
    let count = 0;
    for (const m of meals) {
      const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(m.recipe_id as string) as Row | undefined;
      if (!row) continue;
      const full = loadRecipe(db, row);
      for (const i of checkIngredients(index, full.ingredients)) {
        if (i.optional || (i.availability !== 'missing' && i.availability !== 'low')) continue;
        addShoppingItem(db, ctx.homeId, { name: i.name, quantity: i.quantity, unit: i.unit, note: `for ${full.title}` }, ctx.user?.id ?? null);
        count++;
      }
    }
    return { added: count, meals: meals.length };
  });

  // Subscribe to this URL from Google Calendar ("From URL") to see the meal plan there.
  app.get('/api/calendar/:file', async (req, reply) => {
    const token = (req.params as { file: string }).file.replace(/\.ics$/, '');
    const home = db.prepare('SELECT id, name FROM homes WHERE calendar_token = ?').get(token) as Row | undefined;
    if (!home) throw new HttpError(404, 'Calendar not found');
    const rows = db.prepare(`${SELECT} WHERE m.home_id = ? AND m.date >= date('now', '-30 day') ORDER BY m.date`).all(home.id as string) as Row[];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nighttime Ninja//Meal Plan//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(`${home.name} meals`)}`,
    ];
    for (const r of rows) {
      const [h, mins] = SLOT_TIMES[r.slot as string] ?? [18, 60];
      const d = (r.date as string).replace(/-/g, '');
      const pad = (n: number) => String(n).padStart(2, '0');
      const end = h * 60 + mins;
      const title = (r.recipe_title ?? r.title ?? 'Meal') as string;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${r.id}@nighttime-ninja`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${d}T${pad(h)}0000`,
        `DTEND:${d}T${pad(Math.floor(end / 60))}${pad(end % 60)}00`,
        `SUMMARY:${icsEscape(`${(r.slot as string)[0].toUpperCase()}${(r.slot as string).slice(1)}: ${title}`)}`,
        ...(r.note ? [`DESCRIPTION:${icsEscape(r.note as string)}`] : []),
        ...(r.recipe_id ? [`URL:${config.publicUrl}/recipes/${r.recipe_id}`] : []),
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    reply.header('content-type', 'text/calendar; charset=utf-8');
    return lines.join('\r\n') + '\r\n';
  });
}
