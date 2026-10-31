import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, parseJson, str } from '../util.ts';
import { guessItem } from '../../../shared/catalog.ts';
import { matchKey, parseIngredient } from '../../../shared/recipe.ts';
import { convert } from '../../../shared/units.ts';
import { stockByName, undoHistory } from './inventory.ts';
import { body, flag, list, number, text } from '../schemas.ts';
import { listAdded } from '../push.ts';

const LINE = { name: text, quantity: number, unit: text, category: text, note: text, price: number, store: text };

function shape(r: Row) {
  return {
    id: r.id, name: r.name, quantity: r.quantity, unit: r.unit, category: r.category, note: r.note,
    checked: !!r.checked, createdAt: r.created_at, checkedAt: r.checked_at, addedBy: r.added_by_name ?? null,
    price: r.price ?? null, store: r.store ?? null, lastPrice: r.last_price ?? null, listId: r.list_id ?? null,
  };
}

/** The home's first list (Main), made on the spot for a home that doesn't have one yet. */
export function mainList(db: DatabaseSync, homeId: string): string {
  const row = db.prepare('SELECT id FROM shopping_lists WHERE home_id = ? ORDER BY position, created_at LIMIT 1').get(homeId) as Row | undefined;
  if (row) return row.id as string;
  const id = newId();
  db.prepare("INSERT INTO shopping_lists (id, home_id, name, position) VALUES (?, ?, 'Main', 0)").run(id, homeId);
  return id;
}

/** This home's list with that name, made if there isn't one yet. */
export function listNamed(db: DatabaseSync, homeId: string, name: string): string {
  mainList(db, homeId);
  const row = db.prepare('SELECT id FROM shopping_lists WHERE home_id = ? AND name = ? COLLATE NOCASE').get(homeId, name) as Row | undefined;
  if (row) return row.id as string;
  const id = newId();
  const pos = Number((db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM shopping_lists WHERE home_id = ?').get(homeId) as Row).p);
  db.prepare('INSERT INTO shopping_lists (id, home_id, name, position) VALUES (?, ?, ?, ?)').run(id, homeId, name, pos);
  return id;
}

/** This home's list with that id, or null. */
function findList(db: DatabaseSync, homeId: string, listId: unknown): Row | null {
  if (typeof listId !== 'string' || !listId) return null;
  return (db.prepare('SELECT * FROM shopping_lists WHERE id = ? AND home_id = ?').get(listId, homeId) as Row | undefined) ?? null;
}

/**
 * The list a change is for: the one asked for, or Main when none was named (older apps) or it has since been
 * deleted (a change that waited offline), so nothing someone added is ever lost.
 */
export function listFor(db: DatabaseSync, homeId: string, listId: unknown): string {
  return (findList(db, homeId, listId)?.id as string | undefined) ?? mainList(db, homeId);
}

/** The list's name for a notification, or null for Main when it's the only list (so it just says "the list"). */
function listLabel(db: DatabaseSync, homeId: string, listId: string): string | null {
  const count = Number((db.prepare('SELECT COUNT(*) AS n FROM shopping_lists WHERE home_id = ?').get(homeId) as Row).n);
  if (count < 2) return null;
  return (findList(db, homeId, listId)?.name as string | undefined) ?? null;
}

/** A price in dollars and cents, or null for blank, negative or silly amounts. */
const money = (v: unknown) => { const n = num(v); return n != null && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null; };

/** Ticks an item off: remembers it was bought, and (unless told not to) puts it in the pantry. */
export function checkOff(db: DatabaseSync, homeId: string, item: Row, addToInventory: boolean, userId: string | null): void {
  db.prepare("UPDATE shopping_items SET checked = 1, checked_at = datetime('now'), cleared = 0, stock_history_id = NULL WHERE id = ?").run(item.id as string);
  db.prepare(`INSERT INTO shopping_history (home_id, name_key, name, category, times_bought, last_bought_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT (home_id, name_key) DO UPDATE SET times_bought = times_bought + 1, last_bought_at = datetime('now'),
      name = excluded.name, category = excluded.category`)
    .run(homeId, matchKey(item.name as string), item.name as string, item.category as string);
  if (addToInventory) {
    const historyId = stockByName(db, homeId, item.name as string, (item.quantity as number | null) ?? 1, item.unit as string | null, 'bought', userId);
    db.prepare('UPDATE shopping_items SET stock_history_id = ? WHERE id = ?').run(historyId, item.id as string);
  }
}

/** Unticks an item (a mis-tap in the store): back on the list, and whatever the tick put in the pantry comes out again. */
export function uncheck(db: DatabaseSync, homeId: string, item: Row, userId: string | null): void {
  db.prepare('UPDATE shopping_items SET checked = 0, checked_at = NULL, cleared = 0, stock_history_id = NULL WHERE id = ?').run(item.id as string);
  db.prepare('UPDATE shopping_history SET times_bought = MAX(0, times_bought - 1) WHERE home_id = ? AND name_key = ?')
    .run(homeId, matchKey(item.name as string));
  if (item.stock_history_id != null) undoHistory(db, homeId, Number(item.stock_history_id), userId);
}

/** Adds to the list, merging into an existing unchecked entry with the same name when units allow. */
export function addShoppingItem(
  db: DatabaseSync,
  homeId: string,
  input: { name: string; quantity?: number | null; unit?: string | null; category?: string | null; note?: string | null; listId?: string | null },
  userId: string | null,
) {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, 'Name is required');
  const listId = listFor(db, homeId, input.listId);
  // Only merges within the same list: milk on Long term and milk on Quick trip are two separate lines.
  const existing = db.prepare('SELECT * FROM shopping_items WHERE list_id = ? AND checked = 0 AND name = ? COLLATE NOCASE').get(listId, name) as Row | undefined;
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
  db.prepare('INSERT INTO shopping_items (id, home_id, list_id, name, quantity, unit, category, note, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, homeId, listId, name, input.quantity ?? null, input.unit ?? null,
    input.category ?? (history?.category as string | undefined) ?? guessItem(name).category, input.note ?? null, userId,
  );
  return shape(db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as Row);
}

/**
 * Moves a line to another list. Still to buy and already on the other list: the amounts are added together there
 * (as adding it twice would) and this line goes. Returns the id of the line it ended up as.
 */
function moveItem(db: DatabaseSync, homeId: string, item: Row, toListId: string): string {
  if (!item.checked) {
    const same = db.prepare('SELECT id FROM shopping_items WHERE list_id = ? AND checked = 0 AND name = ? COLLATE NOCASE AND id != ?')
      .get(toListId, item.name as string, item.id as string) as Row | undefined;
    if (same) {
      const merged = addShoppingItem(db, homeId, {
        name: item.name as string, quantity: item.quantity as number | null, unit: item.unit as string | null, listId: toListId,
      }, null);
      db.prepare('DELETE FROM shopping_items WHERE id = ?').run(item.id as string);
      return merged.id as string;
    }
  }
  db.prepare('UPDATE shopping_items SET list_id = ? WHERE id = ?').run(toListId, item.id as string);
  return item.id as string;
}

export function shoppingRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // The home's lists, Main first, each with how many things are still to buy on it.
  app.get('/api/homes/:homeId/shopping/lists', async (req) => {
    const ctx = homeCtx(db, req);
    mainList(db, ctx.homeId);
    const rows = db.prepare(`SELECT l.id, l.name, (SELECT COUNT(*) FROM shopping_items s WHERE s.list_id = l.id AND s.checked = 0) AS open
      FROM shopping_lists l WHERE l.home_id = ? ORDER BY l.position, l.created_at`).all(ctx.homeId) as Row[];
    return rows.map((r, i) => ({ id: r.id, name: r.name, open: Number(r.open), main: i === 0 }));
  });

  app.post('/api/homes/:homeId/shopping/lists', { schema: body({ name: text }, ['name']) }, async (req) => {
    const ctx = homeCtx(db, req);
    const name = str((req.body as Row).name, 40);
    if (!name) throw new HttpError(400, 'Give the list a name');
    mainList(db, ctx.homeId);
    const count = Number((db.prepare('SELECT COUNT(*) AS n FROM shopping_lists WHERE home_id = ?').get(ctx.homeId) as Row).n);
    if (count >= 20) throw new HttpError(400, 'That is a lot of lists. Delete one you no longer use first.');
    if (db.prepare('SELECT 1 FROM shopping_lists WHERE home_id = ? AND name = ? COLLATE NOCASE').get(ctx.homeId, name)) throw new HttpError(409, `There's already a list called ${name}`);
    const id = newId();
    const pos = Number((db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM shopping_lists WHERE home_id = ?').get(ctx.homeId) as Row).p);
    db.prepare('INSERT INTO shopping_lists (id, home_id, name, position) VALUES (?, ?, ?, ?)').run(id, ctx.homeId, name, pos);
    return { id, name, open: 0, main: false };
  });

  app.patch('/api/homes/:homeId/shopping/lists/:listId', { schema: body({ name: text }, ['name']) }, async (req) => {
    const ctx = homeCtx(db, req);
    const l = findList(db, ctx.homeId, (req.params as { listId: string }).listId);
    if (!l) throw new HttpError(404, 'That list is gone');
    const name = str((req.body as Row).name, 40);
    if (!name) throw new HttpError(400, 'Give the list a name');
    if (db.prepare('SELECT 1 FROM shopping_lists WHERE home_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(ctx.homeId, name, l.id as string)) {
      throw new HttpError(409, `There's already a list called ${name}`);
    }
    db.prepare('UPDATE shopping_lists SET name = ? WHERE id = ?').run(name, l.id as string);
    return { ok: true };
  });

  // Deleting a list never loses anything: what was still to buy moves to Main (merging with what's already there),
  // and what was bought stays in the purchase history and spending.
  app.delete('/api/homes/:homeId/shopping/lists/:listId', async (req) => {
    const ctx = homeCtx(db, req);
    const l = findList(db, ctx.homeId, (req.params as { listId: string }).listId);
    if (!l) return { ok: true, moved: 0 };
    const count = Number((db.prepare('SELECT COUNT(*) AS n FROM shopping_lists WHERE home_id = ?').get(ctx.homeId) as Row).n);
    if (count < 2) throw new HttpError(400, "That's your only list, so it stays");
    let moved = 0;
    tx(db, () => {
      const to = (db.prepare('SELECT id FROM shopping_lists WHERE home_id = ? AND id != ? ORDER BY position, created_at LIMIT 1').get(ctx.homeId, l.id as string) as Row).id as string;
      const open = db.prepare('SELECT * FROM shopping_items WHERE list_id = ? AND checked = 0').all(l.id as string) as Row[];
      for (const item of open) moveItem(db, ctx.homeId, item, to);
      moved = open.length;
      db.prepare('UPDATE shopping_items SET list_id = ?, cleared = 1 WHERE list_id = ?').run(to, l.id as string);
      db.prepare('DELETE FROM shopping_lists WHERE id = ?').run(l.id as string);
    });
    return { ok: true, moved };
  });

  app.get('/api/homes/:homeId/shopping', async (req) => {
    const ctx = homeCtx(db, req);
    const listId = listFor(db, ctx.homeId, (req.query as Row).list);
    const rows = db.prepare(`
      SELECT s.*, u.name AS added_by_name,
        (SELECT p.price FROM shopping_items p WHERE p.home_id = s.home_id AND p.name = s.name COLLATE NOCASE AND p.price IS NOT NULL
          AND p.id != s.id ORDER BY p.checked_at DESC LIMIT 1) AS last_price
      FROM shopping_items s LEFT JOIN users u ON u.id = s.added_by
      WHERE s.list_id = ? AND (s.checked = 0 OR (s.cleared = 0 AND s.checked_at > datetime('now', '-1 day')))
      ORDER BY s.checked, s.category, s.name COLLATE NOCASE`).all(listId) as Row[];
    return rows.map(shape);
  });

  // Accepts either structured fields or a quick-add line like "2 lb chicken thighs".
  // Accepts either structured fields or a quick-add line like "2 lb chicken thighs". listId picks the list (Main if left out).
  app.post('/api/homes/:homeId/shopping', { schema: body({ ...LINE, text, listId: text }) }, async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const listId = listFor(db, ctx.homeId, b.listId);
    const lines = typeof b.text === 'string' ? b.text.split(/\r?\n|,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean) : [];
    const tell = (added: Row[]) => {
      void listAdded(db, ctx.homeId, ctx.user?.id ?? null, added.map((a) => a.name as string), listLabel(db, ctx.homeId, listId)).catch(() => {});
      return added;
    };
    if (lines.length) {
      return tell(lines.slice(0, 100).map((line) => {
        const p = parseIngredient(line);
        return addShoppingItem(db, ctx.homeId, { name: p.name, quantity: p.quantity, unit: p.unit, note: p.note, listId }, ctx.user?.id ?? null);
      }));
    }
    const name = str(b.name, 120);
    if (!name) throw new HttpError(400, 'Name is required');
    return tell([addShoppingItem(db, ctx.homeId, {
      name, quantity: num(b.quantity), unit: str(b.unit, 20), category: str(b.category, 40), note: str(b.note, 200), listId,
    }, ctx.user?.id ?? null)]);
  });

  // listId moves the item to another list (pulling something off Long term for a quick trip, say).
  app.patch('/api/homes/:homeId/shopping/:id', { schema: body({ ...LINE, checked: flag, addToInventory: flag, listId: text }) }, async (req) => {
    const ctx = homeCtx(db, req);
    let { id } = req.params as { id: string };
    let item = db.prepare('SELECT * FROM shopping_items WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!item) throw new HttpError(404, 'Not on the list');
    const b = (req.body ?? {}) as Row;
    if (typeof b.listId === 'string' && b.listId !== item.list_id) {
      const to = findList(db, ctx.homeId, b.listId);
      if (!to) throw new HttpError(404, 'That list is gone');
      const target = item;
      id = tx(db, () => moveItem(db, ctx.homeId, target, to.id as string));
      item = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as Row;
    }
    const current = item;
    tx(db, () => {
      if ('name' in b && str(b.name, 120)) db.prepare('UPDATE shopping_items SET name = ? WHERE id = ?').run(str(b.name, 120), id);
      if ('quantity' in b) db.prepare('UPDATE shopping_items SET quantity = ? WHERE id = ?').run(num(b.quantity), id);
      if ('unit' in b) db.prepare('UPDATE shopping_items SET unit = ? WHERE id = ?').run(str(b.unit, 20), id);
      if ('category' in b) db.prepare('UPDATE shopping_items SET category = ? WHERE id = ?').run(str(b.category, 40) ?? 'Other', id);
      if ('note' in b) db.prepare('UPDATE shopping_items SET note = ? WHERE id = ?').run(str(b.note, 200), id);
      if ('price' in b) db.prepare('UPDATE shopping_items SET price = ? WHERE id = ?').run(money(b.price), id);
      if ('store' in b) db.prepare('UPDATE shopping_items SET store = ? WHERE id = ?').run(str(b.store, 60), id);
      if (typeof b.checked === 'boolean' && b.checked !== !!current.checked) {
        if (b.checked) {
          checkOff(db, ctx.homeId, current, b.addToInventory !== false, ctx.user?.id ?? null);
        } else {
          uncheck(db, ctx.homeId, current, ctx.user?.id ?? null);
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

  app.post('/api/homes/:homeId/shopping/clear-checked', { schema: body({ listId: text }) }, async (req) => {
    const ctx = homeCtx(db, req);
    // Checked items stay in the database as purchase history (with the day they were really bought); they just leave the list view.
    // With a listId only that list's cart is cleared; without one (older apps), every list's.
    const l = findList(db, ctx.homeId, (req.body as Row | null)?.listId);
    if (l) db.prepare('UPDATE shopping_items SET cleared = 1 WHERE list_id = ? AND checked = 1').run(l.id as string);
    else db.prepare('UPDATE shopping_items SET cleared = 1 WHERE home_id = ? AND checked = 1').run(ctx.homeId);
    return { ok: true };
  });

  // Grocery spending: totals by week, and what each thing usually costs. Only items with a price count.
  app.get('/api/homes/:homeId/shopping/spending', async (req) => {
    const ctx = homeCtx(db, req);
    const weeks = Math.min(52, Math.max(1, Number((req.query as Row).weeks) || 8));
    const since = `-${weeks * 7} day`;
    const priced = 'home_id = ? AND checked = 1 AND price IS NOT NULL AND checked_at >= date(\'now\', ?)';
    // Weeks start on Sunday.
    const byWeek = db.prepare(`SELECT date(checked_at, '-6 day', 'weekday 0') AS week, ROUND(SUM(price), 2) AS total, COUNT(*) AS items
      FROM shopping_items WHERE ${priced} GROUP BY week ORDER BY week`).all(ctx.homeId, since) as Row[];
    const items = db.prepare(`SELECT name, COUNT(*) AS times, ROUND(SUM(price), 2) AS total, ROUND(AVG(price), 2) AS average, MIN(price) AS low, MAX(price) AS high
      FROM shopping_items WHERE ${priced} GROUP BY lower(name) ORDER BY total DESC LIMIT 40`).all(ctx.homeId, since) as Row[];
    const stores = db.prepare(`SELECT store, ROUND(SUM(price), 2) AS total FROM shopping_items
      WHERE ${priced} AND store IS NOT NULL GROUP BY store ORDER BY total DESC`).all(ctx.homeId, since) as Row[];
    return { weeks: byWeek, items, stores };
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

  // Things bought before that aren't on this list yet (?list=, Main if left out).
  app.get('/api/homes/:homeId/shopping/suggestions', async (req) => {
    const ctx = homeCtx(db, req);
    const listId = listFor(db, ctx.homeId, (req.query as Row).list);
    return db.prepare(`
      SELECT h.name, h.category, h.times_bought AS timesBought, h.last_bought_at AS lastBoughtAt
      FROM shopping_history h
      WHERE h.home_id = ? AND NOT EXISTS (
        SELECT 1 FROM shopping_items s WHERE s.list_id = ? AND s.checked = 0 AND s.name = h.name COLLATE NOCASE)
      ORDER BY h.times_bought DESC, h.last_bought_at DESC LIMIT 40`).all(ctx.homeId, listId);
  });

  app.get('/api/homes/:homeId/shopping/history', async (req) => {
    const ctx = homeCtx(db, req);
    const rows = db.prepare(`
      SELECT s.*, u.name AS added_by_name FROM shopping_items s LEFT JOIN users u ON u.id = s.added_by
      WHERE s.home_id = ? AND s.checked = 1 ORDER BY s.checked_at DESC LIMIT 300`).all(ctx.homeId) as Row[];
    return rows.map(shape);
  });
}
