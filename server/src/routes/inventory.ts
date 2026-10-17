import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { guessItem } from '../../../shared/catalog.ts';
import { addShoppingItem } from './shopping.ts';

export function recordHistory(
  db: DatabaseSync,
  h: { homeId: string; itemId: string | null; itemName: string; delta: number; unit: string | null; after: number | null; reason: string; userId: string | null },
): void {
  db.prepare(`INSERT INTO inventory_history (home_id, item_id, item_name, delta, unit, quantity_after, reason, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(h.homeId, h.itemId, h.itemName, h.delta, h.unit, h.after, h.reason, h.userId);
}

/** Changes an item's quantity (never below zero) and logs it. */
export function adjustItem(db: DatabaseSync, homeId: string, itemId: string, delta: number, reason: string, userId: string | null): Row {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND home_id = ?').get(itemId, homeId) as Row | undefined;
  if (!item) throw new HttpError(404, 'Item not found');
  const after = Math.max(0, Math.round(((item.quantity as number) + delta) * 1000) / 1000);
  db.prepare("UPDATE items SET quantity = ?, updated_at = datetime('now') WHERE id = ?").run(after, itemId);
  recordHistory(db, { homeId, itemId, itemName: item.name as string, delta: after - (item.quantity as number), unit: item.unit as string | null, after, reason, userId });
  return { ...item, quantity: after };
}

/** Adds stock to an item matched by name, creating it if needed. Used when shopping items are checked off. */
export function stockByName(db: DatabaseSync, homeId: string, name: string, quantity: number, unit: string | null, reason: string, userId: string | null): void {
  const existing = db.prepare('SELECT id FROM items WHERE home_id = ? AND name = ? COLLATE NOCASE').get(homeId, name) as Row | undefined;
  if (existing) {
    adjustItem(db, homeId, existing.id as string, quantity, reason, userId);
    return;
  }
  const guess = guessItem(name);
  const id = newId();
  db.prepare('INSERT INTO items (id, home_id, name, category, icon, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, homeId, name, guess.category, guess.icon, quantity, unit);
  recordHistory(db, { homeId, itemId: id, itemName: name, delta: quantity, unit, after: quantity, reason, userId });
}

function shape(r: Row) {
  return {
    id: r.id, name: r.name, category: r.category, location: r.location, icon: r.icon, photo: r.photo,
    quantity: r.quantity, unit: r.unit, lowThreshold: r.low_threshold, barcode: r.barcode, expiresOn: r.expires_on,
    isLow: r.low_threshold != null && (r.quantity as number) <= (r.low_threshold as number),
    updatedAt: r.updated_at,
  };
}

export function inventoryRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/items', async (req) => {
    const ctx = homeCtx(db, req);
    const q = req.query as Row;
    const where = ['home_id = ?'];
    const args: (string | number)[] = [ctx.homeId];
    if (q.q) { where.push('name LIKE ?'); args.push(`%${q.q}%`); }
    if (q.category) { where.push('category = ?'); args.push(String(q.category)); }
    if (q.location) { where.push('location = ?'); args.push(String(q.location)); }
    if (q.low === 'true') where.push('low_threshold IS NOT NULL AND quantity <= low_threshold');
    return (db.prepare(`SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`).all(...args) as Row[]).map(shape);
  });

  app.post('/api/homes/:homeId/items', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const name = requireStr(b.name, 'Name', 120);
    const guess = guessItem(name);
    const id = newId();
    const quantity = num(b.quantity) ?? 1;
    db.prepare(`INSERT INTO items (id, home_id, name, category, location, icon, photo, quantity, unit, low_threshold, barcode, expires_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, ctx.homeId, name, str(b.category, 40) ?? guess.category, str(b.location, 40) ?? 'Pantry',
      str(b.icon, 16) ?? guess.icon, str(b.photo, 500), quantity, str(b.unit, 20), num(b.lowThreshold),
      str(b.barcode, 40), str(b.expiresOn, 10),
    );
    recordHistory(db, { homeId: ctx.homeId, itemId: id, itemName: name, delta: quantity, unit: str(b.unit, 20), after: quantity, reason: 'added', userId: ctx.user?.id ?? null });
    return shape(db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Row);
  });

  app.patch('/api/homes/:homeId/items/:itemId', async (req) => {
    const ctx = homeCtx(db, req);
    const { itemId } = req.params as { itemId: string };
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND home_id = ?').get(itemId, ctx.homeId) as Row | undefined;
    if (!item) throw new HttpError(404, 'Item not found');
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, unknown> = {};
    if ('name' in b) fields.name = requireStr(b.name, 'Name', 120);
    if ('category' in b) fields.category = str(b.category, 40) ?? 'Other';
    if ('location' in b) fields.location = str(b.location, 40) ?? 'Pantry';
    if ('icon' in b) fields.icon = str(b.icon, 16);
    if ('photo' in b) fields.photo = str(b.photo, 500);
    if ('unit' in b) fields.unit = str(b.unit, 20);
    if ('lowThreshold' in b) fields.low_threshold = num(b.lowThreshold);
    if ('barcode' in b) fields.barcode = str(b.barcode, 40);
    if ('expiresOn' in b) fields.expires_on = str(b.expiresOn, 10);
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...(Object.values(fields) as (string | number | null)[]), itemId);
    }
    const q = num(b.quantity);
    if (q != null && q !== item.quantity) adjustItem(db, ctx.homeId, itemId, q - (item.quantity as number), 'edited', ctx.user?.id ?? null);
    return shape(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Row);
  });

  app.post('/api/homes/:homeId/items/:itemId/adjust', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const delta = num(b.delta);
    if (delta == null) throw new HttpError(400, 'delta is required');
    const reason = str(b.reason, 40) ?? (delta > 0 ? 'restocked' : 'used');
    return shape(adjustItem(db, ctx.homeId, (req.params as { itemId: string }).itemId, delta, reason, ctx.user?.id ?? null));
  });

  app.delete('/api/homes/:homeId/items/:itemId', async (req) => {
    const ctx = homeCtx(db, req);
    const { itemId } = req.params as { itemId: string };
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND home_id = ?').get(itemId, ctx.homeId) as Row | undefined;
    if (!item) throw new HttpError(404, 'Item not found');
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    recordHistory(db, { homeId: ctx.homeId, itemId: null, itemName: item.name as string, delta: -(item.quantity as number), unit: item.unit as string | null, after: 0, reason: 'removed', userId: ctx.user?.id ?? null });
    return { ok: true };
  });

  app.post('/api/homes/:homeId/items/:itemId/to-shopping', async (req) => {
    const ctx = homeCtx(db, req);
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND home_id = ?').get((req.params as { itemId: string }).itemId, ctx.homeId) as Row | undefined;
    if (!item) throw new HttpError(404, 'Item not found');
    return addShoppingItem(db, ctx.homeId, { name: item.name as string, category: item.category as string, unit: item.unit as string | null }, ctx.user?.id ?? null);
  });

  app.get('/api/homes/:homeId/history', async (req) => {
    const ctx = homeCtx(db, req);
    const q = req.query as Row;
    const limit = Math.min(500, Number(q.limit) || 100);
    const args: (string | number)[] = [ctx.homeId];
    let extra = '';
    if (q.itemId) { extra = ' AND h.item_id = ?'; args.push(String(q.itemId)); }
    args.push(limit);
    return db.prepare(`
      SELECT h.id, h.item_id AS itemId, h.item_name AS itemName, h.delta, h.unit, h.quantity_after AS quantityAfter,
        h.reason, h.created_at AS createdAt, u.name AS userName
      FROM inventory_history h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.home_id = ?${extra} ORDER BY h.id DESC LIMIT ?`).all(...args);
  });
}
