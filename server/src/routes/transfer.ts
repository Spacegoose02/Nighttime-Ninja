// Recipe files from other apps in, and a Paprika file out (Paprika, Mealie and Tandoor all open it).
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { config } from '../config.ts';
import type { Row } from '../db.ts';
import { readRecipeArchive, toPaprika } from '../formats.ts';
import { HttpError, str } from '../util.ts';
import { loadRecipe, saveRecipe } from './recipes.ts';
import { saveImage } from './integrations.ts';

export function transferRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // The file comes as base64 in JSON, like the rest of the API, so imports work through any proxy that allows JSON.
  app.post('/api/homes/:homeId/import/archive', { bodyLimit: 150 * 1024 * 1024 }, async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    if (typeof b.file !== 'string' || !b.file) throw new HttpError(400, 'Choose an export file');
    let found: ReturnType<typeof readRecipeArchive>;
    try {
      found = readRecipeArchive(Buffer.from(b.file, 'base64'), str(b.filename, 300) ?? '');
    } catch (err) {
      throw new HttpError(422, (err as Error).message === 'Not a ZIP file' ? "That file isn't a Mealie, Tandoor or Paprika export" : (err as Error).message);
    }
    const existing = new Set((db.prepare('SELECT title FROM recipes WHERE home_id = ?').all(ctx.homeId) as Row[]).map((r) => String(r.title).toLowerCase()));
    const result = { format: found.format, recipes: 0, recipesSkipped: 0, photos: 0 };
    for (const { recipe, photo } of found.recipes) {
      if (existing.has(recipe.title.toLowerCase())) { result.recipesSkipped++; continue; }
      if (photo) {
        try { recipe.image = saveImage(photo.bytes, photo.mime); result.photos++; } catch { /* keep the recipe without it */ }
      }
      saveRecipe(db, ctx.homeId, recipe, ctx.user?.id ?? null);
      existing.add(recipe.title.toLowerCase());
      result.recipes++;
    }
    return result;
  });

  app.get('/api/homes/:homeId/export/paprika', async (req, reply) => {
    const ctx = homeCtx(db, req);
    const home = db.prepare('SELECT name FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    const recipes = (db.prepare('SELECT * FROM recipes WHERE home_id = ? ORDER BY title').all(ctx.homeId) as Row[]).map((r) => loadRecipe(db, r));
    const file = toPaprika(recipes, path.join(config.dataDir, 'uploads'));
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${String(home.name).replace(/[^\w-]+/g, '-').toLowerCase() || 'recipes'}.paprikarecipes"`);
    return reply.send(file);
  });
}
