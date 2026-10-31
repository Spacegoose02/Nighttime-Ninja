import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { config } from '../config.ts';
import { HttpError, newId } from '../util.ts';
import { checkIngredients, loadRecipe, stockIndex } from './recipes.ts';
import { LOW_SQL } from './inventory.ts';

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Saves image bytes into the uploads folder and returns the public path. */
export function saveImage(bytes: Buffer, mime: string): string {
  const ext = IMAGE_TYPES[mime];
  if (!ext) throw new HttpError(415, 'Only JPEG, PNG, WebP or GIF images');
  if (bytes.length > 8 * 1024 * 1024) throw new HttpError(413, 'Images must be under 8 MB');
  const file = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(config.dataDir, 'uploads', file), bytes);
  return `/uploads/${file}`;
}

export function integrationRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.post('/api/homes/:homeId/uploads', { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    homeCtx(db, req);
    const dataUrl = String((req.body as Row)?.dataUrl ?? '');
    const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!m) throw new HttpError(400, 'Send the image as a data URL');
    return { url: saveImage(Buffer.from(m[2], 'base64'), m[1]) };
  });

  // A compact snapshot for Home Assistant REST sensors and dashboards.
  app.get('/api/homes/:homeId/ha/summary', async (req) => {
    const ctx = homeCtx(db, req);
    const today = new Date().toISOString().slice(0, 10);
    const shopping = db.prepare('SELECT name, quantity, unit FROM shopping_items WHERE home_id = ? AND checked = 0 ORDER BY name').all(ctx.homeId) as Row[];
    const low = db.prepare(`SELECT name, quantity, unit FROM items WHERE home_id = ? AND ${LOW_SQL} ORDER BY name`).all(ctx.homeId) as Row[];
    const expiring = db.prepare("SELECT name, expires_on FROM items WHERE home_id = ? AND expires_on IS NOT NULL AND expires_on <= date('now', '+3 day') ORDER BY expires_on").all(ctx.homeId) as Row[];
    const meals = db.prepare(`SELECT m.slot, COALESCE(r.title, m.title) AS title, m.cooked_at, u.name AS cook FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id
      LEFT JOIN users u ON u.id = m.cook_id
      WHERE m.home_id = ? AND m.date = ? ORDER BY CASE m.slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'snack' THEN 2 ELSE 3 END`).all(ctx.homeId, today) as Row[];
    const index = stockIndex(db, ctx.homeId);
    const ready = (db.prepare('SELECT * FROM recipes WHERE home_id = ?').all(ctx.homeId) as Row[])
      .filter((r) => checkIngredients(index, loadRecipe(db, r).ingredients).every((i) => i.optional || i.availability === 'have' || i.availability === 'unknown'))
      .map((r) => r.title as string);
    const dinner = meals.find((m) => m.slot === 'dinner');
    return {
      shopping_count: shopping.length,
      shopping: shopping.map((s) => [s.quantity, s.unit, s.name].filter((x) => x != null && x !== '').join(' ')),
      low_stock_count: low.length,
      low_stock: low.map((l) => l.name),
      expiring_soon: expiring.map((e) => ({ name: e.name, date: e.expires_on })),
      todays_meals: meals.map((m) => ({ slot: m.slot, title: m.title, cooked: !!m.cooked_at, cook: m.cook ?? null })),
      tonight: dinner?.title ?? null,
      tonight_cook: dinner?.cook ?? null,
      ready_to_cook_count: ready.length,
      recipe_count: (db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE home_id = ?').get(ctx.homeId) as Row).n,
      item_count: (db.prepare('SELECT COUNT(*) AS n FROM items WHERE home_id = ?').get(ctx.homeId) as Row).n,
      ready_to_cook: ready.slice(0, 20),
    };
  });

  // Full backup of a home in a portable JSON file.
  app.get('/api/homes/:homeId/export', async (req, reply) => {
    const ctx = homeCtx(db, req, 'manager');
    const home = db.prepare('SELECT name FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    const recipes = (db.prepare('SELECT * FROM recipes WHERE home_id = ?').all(ctx.homeId) as Row[]).map((r) => {
      const { id: _i, isPublic: _p, shareSlug: _s, createdAt: _c, updatedAt: _u, ...rest } = loadRecipe(db, r);
      return rest;
    });
    const items = db.prepare('SELECT name, category, location, icon, quantity, unit, low_threshold, barcode, expires_on FROM items WHERE home_id = ?').all(ctx.homeId);
    const shopping = db.prepare('SELECT name, quantity, unit, category, note FROM shopping_items WHERE home_id = ? AND checked = 0').all(ctx.homeId);
    const shoppingHistory = db.prepare('SELECT name, category, times_bought, last_bought_at FROM shopping_history WHERE home_id = ?').all(ctx.homeId);
    const mealPlan = (db.prepare('SELECT m.date, m.slot, m.title, m.note, r.title AS recipe FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.home_id = ?').all(ctx.homeId) as Row[]);
    const feeds = db.prepare('SELECT title, url FROM feeds WHERE home_id = ?').all(ctx.homeId);
    reply.header('content-disposition', `attachment; filename="nighttime-ninja-${String(home.name).replace(/[^\w-]+/g, '-').toLowerCase()}.json"`);
    return { format: 'nighttime-ninja', version: 1, exportedAt: new Date().toISOString(), home: home.name, recipes, items, shopping, shoppingHistory, mealPlan, feeds };
  });
}
