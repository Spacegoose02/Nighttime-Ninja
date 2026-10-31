import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, parseJson, str } from '../util.ts';
import { guessItem } from '../../../shared/catalog.ts';
import { matchKey, parseIngredient } from '../../../shared/recipe.ts';
import { convert } from '../../../shared/units.ts';
import { stockByName } from './inventory.ts';
import { body, flag, list, number, text } from '../schemas.ts';

const LINE = { name: text, quantity: number, unit: text, category: text, note: text };

function shape(r: Row) {
  return {
    id: r.id, name: r.name, quantity: r.quantity, unit: r.unit, category: r.category, note: r.note,
    checked: !!r.checked, createdAt: r.created_at, checkedAt: r.checked_at, addedBy: r.added_by_name ?? null,
  };
}

/** Adds to the list, merging into an existing unchecked entry with the same name when units allow. */
export function addShoppingItem(
  db: DatabaseSync,
  homeId: string,
  input: { name: string; quantity?: number | null; unit?: string | null; category?: string | null; note?: string | null },
  userId: string | null,
) {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, 'Name is required');
  const existing = db.prepare('SELECT * FROM shopping_items WHERE home_id = ? AND checked = 0 AND name = ? COLLATE NOCASE').get(homeId, name) as Row | undefined;
  if (existing) {
    const q = input.quantity ?? null;
    if (q != null) {
      const base = existing.quantity as number | null;
      const converted = base == null ? null : convert(q, input.unit ?? null, existing.unit as string | null);
      if (base == null) {
        db.prepare('UPDATE shopping_items SET quantity = ?, unit = ? WHERE id = ?').run(q, input.unit ?? null, existing.id as string);
      } else if (converted != null) {
        db.prepare('UPDATE shopping_items SET quantity = ? WHERE id = ?').run(Math.round((base + converted) * 100) / 100, existing.id as string);
      }
    }
    return shape(db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(existing.id as string) as Row);
  }
  const history = db.prepare('SELECT category FROM shopping_history WHERE home_id = ? AND name_key = ?').get(homeId, matchKey(name)) as Row | undefined;
  const id = newId();
  db.prepare('INSERT INTO shopping_items (id, home_id, name, quantity, unit, category, note, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, homeId, name, input.quantity ?? null, input.unit ?? null,
    input.category ?? (history?.category as string | undefined) ?? guessItem(name).category, input.note ?? null, userId,
  );
  return shape(db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as Row);
}

export function shoppingRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/shopping', async (req) => {
    const ctx = homeCtx(db, req);
    const rows = db.prepare(`
      SELECT s.*, u.name AS added_by_name FROM shopping_items s LEFT JOIN users u ON u.id = s.added_by
      WHERE s.home_id = ? AND (s.checked = 0 OR s.checked_at > datetime('now', '-1 day'))
      ORDER BY s.checked, s.category, s.name COLLATE NOCASE`).all(ctx.homeId) as Row[];
    return rows.map(shape);
  });

  // Accepts either structured fields or a quick-add line like "2 lb chicken thighs".
  app.post('/api/homes/:homeId/shopping', { schema: body({ ...LINE, text }) }, async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const lines = typeof b.text === 'string' ? b.text.split(/\r?\n|,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean) : [];
    if (lines.length) {
      return lines.slice(0, 100).map((line) => {
        const p = parseIngredient(line);
        return addShoppingItem(db, ctx.homeId, { name: p.name, quantity: p.quantity, unit: p.unit, note: p.note }, ctx.user?.id ?? null);
      });
    }
    const name = str(b.name, 120);
    if (!name) throw new HttpError(400, 'Name is required');
    return [addShoppingItem(db, ctx.homeId, {
      name, quantity: num(b.quantity), unit: str(b.unit, 20), category: str(b.category, 40), note: str(b.note, 200),
    }, ctx.user?.id ?? null)];
  });

  app.patch('/api/homes/:homeId/shopping/:id', { schema: body({ ...LINE, checked: flag, addToInventory: flag }) }, async (req) => {
    const ctx = homeCtx(db, req);
    const { id } = req.params as { id: string };
    const item = db.prepare('SELECT * FROM shopping_items WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!item) throw new HttpError(404, 'Not on the list');
    const b = (req.body ?? {}) as Row;
    tx(db, () => {
      if ('name' in b && str(b.name, 120)) db.prepare('UPDATE shopping_items SET name = ? WHERE id = ?').run(str(b.name, 120), id);
      if ('quantity' in b) db.prepare('UPDATE shopping_items SET quantity = ? WHERE id = ?').run(num(b.quantity), id);
      if ('unit' in b) db.prepare('UPDATE shopping_items SET unit = ? WHERE id = ?').run(str(b.unit, 20), id);
      if ('category' in b) db.prepare('UPDATE shopping_items SET category = ? WHERE id = ?').run(str(b.category, 40) ?? 'Other', id);
      if ('note' in b) db.prepare('UPDATE shopping_items SET note = ? WHERE id = ?').run(str(b.note, 200), id);
      if (typeof b.checked === 'boolean' && b.checked !== !!item.checked) {
        if (b.checked) {
          db.prepare("UPDATE shopping_items SET checked = 1, checked_at = datetime('now') WHERE id = ?").run(id);
          db.prepare(`INSERT INTO shopping_history (home_id, name_key, name, category, times_bought, last_bought_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'))
            ON CONFLICT (home_id, name_key) DO UPDATE SET times_bought = times_bought + 1, last_bought_at = datetime('now'),
              name = excluded.name, category = excluded.category`)
            .run(ctx.homeId, matchKey(item.name as string), item.name as string, item.category as string);
          if (b.addToInventory !== false) {
            stockByName(db, ctx.homeId, item.name as string, (item.quantity as number | null) ?? 1, item.unit as string | null, 'bought', ctx.user?.id ?? null);
          }
        } else {
          db.prepare('UPDATE shopping_items SET checked = 0, checked_at = NULL WHERE id = ?').run(id);
        }
      }
    });
    return shape(db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as Row);
  });

  app.delete('/api/homes/:homeId/shopping/:id', async (req) => {
    const ctx = homeCtx(db, req);
    db.prepare('DELETE FROM shopping_items WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  app.post('/api/homes/:homeId/shopping/clear-checked', async (req) => {
    const ctx = homeCtx(db, req);
    // Checked items stay in the database as purchase history; they just leave the list view.
    db.prepare("UPDATE shopping_items SET checked_at = datetime('now', '-2 day') WHERE home_id = ? AND checked = 1").run(ctx.homeId);
    return { ok: true };
  });

  // Each store's aisle order: the category the list should start with, then the next, and so on.
  app.get('/api/homes/:homeId/store-layouts', async (req) => {
    const ctx = homeCtx(db, req);
    const row = db.prepare('SELECT store_layouts FROM home_settings WHERE home_id = ?').get(ctx.homeId) as Row | undefined;
    return parseJson<{ name: string; categories: string[] }[]>(row?.store_layouts, []);
  });

  app.put('/api/homes/:homeId/store-layouts', {
    schema: body({ layouts: list({ type: 'object', properties: { name: text, categories: list(text, 100) } }, 30) }, ['layouts']),
  }, async (req) => {
    const ctx = homeCtx(db, req);
    const layouts = ((req.body as Row).layouts as Row[])
      .map((l) => ({ name: str(l.name, 60), categories: ((l.categories as unknown[]) ?? []).map((c) => str(c, 40)).filter((c): c is string => !!c) }))
      .filter((l): l is { name: string; categories: string[] } => !!l.name);
    db.prepare('UPDATE home_settings SET store_layouts = ? WHERE home_id = ?').run(JSON.stringify(layouts), ctx.homeId);
    return layouts;
  });

  app.get('/api/homes/:homeId/shopping/suggestions', async (req) => {
    const ctx = homeCtx(db, req);
    return db.prepare(`
      SELECT h.name, h.category, h.times_bought AS timesBought, h.last_bought_at AS lastBoughtAt
      FROM shopping_history h
      WHERE h.home_id = ? AND NOT EXISTS (
        SELECT 1 FROM shopping_items s WHERE s.home_id = h.home_id AND s.checked = 0 AND s.name = h.name COLLATE NOCASE)
      ORDER BY h.times_bought DESC, h.last_bought_at DESC LIMIT 40`).all(ctx.homeId);
  });

  app.get('/api/homes/:homeId/shopping/history', async (req) => {
    const ctx = homeCtx(db, req);
    const rows = db.prepare(`
      SELECT s.*, u.name AS added_by_name FROM shopping_items s LEFT JOIN users u ON u.id = s.added_by
      WHERE s.home_id = ? AND s.checked = 1 ORDER BY s.checked_at DESC LIMIT 300`).all(ctx.homeId) as Row[];
    return rows.map(shape);
  });
}
