import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, localDate, newId, num, requireStr, str } from '../util.ts';
import { guessItem } from '../../../shared/catalog.ts';
import { matchKey } from '../../../shared/recipe.ts';
import { addShoppingItem } from './shopping.ts';
import { useLabel } from './homes.ts';
import { body, flag, list, number, text } from '../schemas.ts';
import { publicFetch } from '../security.ts';
import { saveImage } from './integrations.ts';

const ITEM = {
  name: text, category: text, location: text, icon: text, photo: text, quantity: number, unit: text,
  lowThreshold: number, barcode: text, expiresOn: text, frozenOn: text,
};

const isFreezer = (location: unknown) => /freez/i.test(String(location ?? ''));

/** An item is low when someone tapped "running low", or its amount dropped to the warning level. */
export const LOW_SQL = '(marked_low = 1 OR (low_threshold IS NOT NULL AND quantity <= low_threshold))';

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
  // Restocking clears a "running low" mark.
  db.prepare(`UPDATE items SET quantity = ?, marked_low = CASE WHEN ? > 0 THEN 0 ELSE marked_low END, updated_at = datetime('now') WHERE id = ?`).run(after, delta, itemId);
  recordHistory(db, { homeId, itemId, itemName: item.name as string, delta: after - (item.quantity as number), unit: item.unit as string | null, after, reason, userId });
  return { ...item, quantity: after };
}

/** The pantry item with this name: the exact name first, then the same food written differently ("Avocado" for "avocados"). */
export function itemByName(db: DatabaseSync, homeId: string, name: string): string | null {
  const exact = db.prepare('SELECT id FROM items WHERE home_id = ? AND name = ? COLLATE NOCASE').get(homeId, name) as Row | undefined;
  if (exact) return exact.id as string;
  const key = matchKey(name);
  if (!key) return null;
  const rows = db.prepare('SELECT id, name FROM items WHERE home_id = ? ORDER BY updated_at DESC').all(homeId) as Row[];
  return (rows.find((r) => matchKey(r.name as string) === key)?.id as string | undefined) ?? null;
}

/**
 * Adds stock to an item matched by name, creating it if needed. Used when shopping items are checked off.
 * Returns the history row, so the change can be taken back.
 */
export function stockByName(db: DatabaseSync, homeId: string, name: string, quantity: number, unit: string | null, reason: string, userId: string | null): number {
  const existing = itemByName(db, homeId, name);
  if (existing) {
    adjustItem(db, homeId, existing, quantity, reason, userId);
  } else {
    const guess = guessItem(name);
    const id = newId();
    db.prepare('INSERT INTO items (id, home_id, name, category, icon, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, homeId, name, guess.category, guess.icon, quantity, unit);
    recordHistory(db, { homeId, itemId: id, itemName: name, delta: quantity, unit, after: quantity, reason, userId });
  }
  return Number((db.prepare('SELECT last_insert_rowid() AS id').get() as Row).id);
}

/** Takes back one pantry change (an undo), if the item is still there and it wasn't undone already. */
export function undoHistory(db: DatabaseSync, homeId: string, historyId: number, userId: string | null): boolean {
  const h = db.prepare('SELECT * FROM inventory_history WHERE id = ? AND home_id = ? AND undone_at IS NULL').get(historyId, homeId) as Row | undefined;
  if (!h?.item_id || !db.prepare('SELECT 1 FROM items WHERE id = ? AND home_id = ?').get(h.item_id as string, homeId)) return false;
  adjustItem(db, homeId, h.item_id as string, -(h.delta as number), `undo: ${h.reason}`, userId);
  db.prepare("UPDATE inventory_history SET undone_at = datetime('now') WHERE id = ?").run(historyId);
  return true;
}

/** Names on the home's open shopping list, so pantry tiles can show "needs shopped". */
function shoppingKeys(db: DatabaseSync, homeId: string): Set<string> {
  const rows = db.prepare('SELECT name FROM shopping_items WHERE home_id = ? AND checked = 0').all(homeId) as Row[];
  return new Set(rows.map((r) => matchKey(r.name as string)));
}

function shape(r: Row, shopping?: Set<string>) {
  return {
    id: r.id, name: r.name, category: r.category, location: r.location, icon: r.icon, photo: r.photo,
    quantity: r.quantity, unit: r.unit, lowThreshold: r.low_threshold, barcode: r.barcode, expiresOn: r.expires_on,
    markedLow: !!r.marked_low, frozenOn: r.frozen_on ?? null,
    isLow: !!r.marked_low || (r.low_threshold != null && (r.quantity as number) <= (r.low_threshold as number)),
    onShoppingList: shopping ? shopping.has(matchKey(r.name as string)) : false,
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
    if (q.low === 'true') where.push(LOW_SQL);
    const shopping = shoppingKeys(db, ctx.homeId);
    return (db.prepare(`SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`).all(...args) as Row[]).map((r) => shape(r, shopping));
  });

  app.post('/api/homes/:homeId/items', { schema: body(ITEM) }, async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const name = requireStr(b.name, 'Name', 120);
    const canManage = ctx.role === 'manager';
    useLabel(db, ctx.homeId, 'locations', str(b.location, 40), canManage);
    useLabel(db, ctx.homeId, 'categories', str(b.category, 40), canManage);
    const guess = guessItem(name);
    const id = newId();
    const quantity = num(b.quantity) ?? 1;
    const location = str(b.location, 40) ?? 'Pantry';
    // Freezer food gets a "frozen on" date, today unless given, so it can be nudged before it gets freezer burn.
    const frozenOn = isFreezer(location) ? str(b.frozenOn, 10) ?? localDate() : null;
    db.prepare(`INSERT INTO items (id, home_id, name, category, location, icon, photo, quantity, unit, low_threshold, barcode, expires_on, frozen_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, ctx.homeId, name, str(b.category, 40) ?? guess.category, location,
      str(b.icon, 16) ?? guess.icon, str(b.photo, 500), quantity, str(b.unit, 20), num(b.lowThreshold),
      str(b.barcode, 40), str(b.expiresOn, 10), frozenOn,
    );
    recordHistory(db, { homeId: ctx.homeId, itemId: id, itemName: name, delta: quantity, unit: str(b.unit, 20), after: quantity, reason: 'added', userId: ctx.user?.id ?? null });
    return shape(db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Row);
  });

  app.patch('/api/homes/:homeId/items/:itemId', { schema: body({ ...ITEM, markedLow: flag }) }, async (req) => {
    const ctx = homeCtx(db, req);
    const { itemId } = req.params as { itemId: string };
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND home_id = ?').get(itemId, ctx.homeId) as Row | undefined;
    if (!item) throw new HttpError(404, 'Item not found');
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, unknown> = {};
    // Keeping an item's current place or category is always fine, even if it was since removed from the list.
    if ('location' in b && str(b.location, 40)?.toLowerCase() !== String(item.location).toLowerCase()) useLabel(db, ctx.homeId, 'locations', str(b.location, 40), ctx.role === 'manager');
    if ('category' in b && str(b.category, 40)?.toLowerCase() !== String(item.category).toLowerCase()) useLabel(db, ctx.homeId, 'categories', str(b.category, 40), ctx.role === 'manager');
    if ('name' in b) fields.name = requireStr(b.name, 'Name', 120);
    if ('category' in b) fields.category = str(b.category, 40) ?? 'Other';
    if ('location' in b) fields.location = str(b.location, 40) ?? 'Pantry';
    // Moving into the freezer starts the clock; moving out clears it.
    const freezer = isFreezer(fields.location ?? item.location);
    if ('frozenOn' in b) fields.frozen_on = freezer ? str(b.frozenOn, 10) : null;
    if (freezer && !item.frozen_on && !fields.frozen_on) fields.frozen_on = localDate();
    if (!freezer && item.frozen_on) fields.frozen_on = null;
    if ('icon' in b) fields.icon = str(b.icon, 16);
    if ('photo' in b) fields.photo = str(b.photo, 500);
    if ('unit' in b) fields.unit = str(b.unit, 20);
    if ('lowThreshold' in b) fields.low_threshold = num(b.lowThreshold);
    if ('barcode' in b) fields.barcode = str(b.barcode, 40);
    if ('expiresOn' in b) fields.expires_on = str(b.expiresOn, 10);
    if (typeof b.markedLow === 'boolean') fields.marked_low = b.markedLow ? 1 : 0;
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...(Object.values(fields) as (string | number | null)[]), itemId);
    }
    const q = num(b.quantity);
    if (q != null && q !== item.quantity) adjustItem(db, ctx.homeId, itemId, q - (item.quantity as number), 'edited', ctx.user?.id ?? null);
    return shape(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Row);
  });

  app.post('/api/homes/:homeId/items/:itemId/adjust', { schema: body({ delta: number, reason: text }, ['delta']) }, async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const delta = num(b.delta);
    if (delta == null) throw new HttpError(400, 'delta is required');
    const reason = str(b.reason, 40) ?? (delta > 0 ? 'restocked' : 'used');
    const item = shape(adjustItem(db, ctx.homeId, (req.params as { itemId: string }).itemId, delta, reason, ctx.user?.id ?? null));
    return { ...item, historyId: Number((db.prepare('SELECT last_insert_rowid() AS id').get() as Row).id) };
  });

  // A scanned barcode: the pantry item that already has it, or else what Open Food Facts knows about the product.
  app.get('/api/homes/:homeId/barcode/:code', async (req) => {
    const ctx = homeCtx(db, req);
    const code = (req.params as { code: string }).code;
    if (!/^\d{6,14}$/.test(code)) throw new HttpError(400, "That doesn't look like a barcode");
    const mine = db.prepare('SELECT * FROM items WHERE home_id = ? AND barcode = ?').get(ctx.homeId, code) as Row | undefined;
    if (mine) return { item: shape(mine), product: null };
    return { item: null, product: await lookupProduct(code) };
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

  // Puts back the pantry changes behind these history rows (e.g. everything one "I cooked this" took out).
  app.post('/api/homes/:homeId/history/undo', { schema: body({ ids: list(number, 200) }, ['ids']) }, async (req) => {
    const ctx = homeCtx(db, req);
    const ids = ((req.body as Row).ids as number[]).filter((n) => Number.isInteger(n));
    let undone = 0;
    tx(db, () => {
      for (const id of ids) if (undoHistory(db, ctx.homeId, id, ctx.user?.id ?? null)) undone++;
    });
    return { undone };
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

export interface Product { name: string; brand: string | null; size: string | null; photo: string | null; category: string }

/** Open Food Facts: free, no key, and good coverage of US groceries. The photo is copied to this server. */
export async function lookupProduct(code: string): Promise<Product | null> {
  try {
    const res = await publicFetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,quantity,image_front_small_url`, {
      headers: { 'user-agent': 'NighttimeNinja/1.0 (self-hosted kitchen app)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { status?: number; product?: Record<string, string | undefined> };
    const p = data.product;
    const name = p?.product_name?.trim();
    if (!p || !data.status || !name) return null;
    let photo: string | null = null;
    if (p.image_front_small_url) {
      try {
        const img = await publicFetch(p.image_front_small_url, { signal: AbortSignal.timeout(8000) });
        const mime = img.headers.get('content-type')?.split(';')[0] ?? '';
        if (img.ok) photo = saveImage(Buffer.from(await img.arrayBuffer()), mime);
      } catch { /* no photo is fine */ }
    }
    const brand = p.brands?.split(',')[0]?.trim() || null;
    return { name: name.slice(0, 120), brand, size: p.quantity?.trim() || null, photo, category: guessItem(name).category };
  } catch {
    return null;
  }
}
