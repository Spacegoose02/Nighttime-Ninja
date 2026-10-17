// Moves data over from KitchenOwl (https://kitchenowl.org), either from its export file or live from a KitchenOwl server.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, requireStr, str } from '../util.ts';
import { CATEGORIES, guessItem } from '../../../shared/catalog.ts';
import { fromKitchenOwlRecipe, matchKey, parseIngredient } from '../../../shared/recipe.ts';
import { saveRecipe } from './recipes.ts';
import { addShoppingItem } from './shopping.ts';
import { saveImage } from './integrations.ts';

interface KoItem { name: string; description?: string; category?: string | { name?: string } | null; icon?: string | null }
interface KoRecipe extends Record<string, unknown> { name: string; photo?: string | null }
interface KoList { name: string; items: KoItem[] }

export interface KoData {
  recipes?: KoRecipe[];
  items?: KoItem[];
  shoppinglists?: (KoList | string)[];
}

export interface ImportResult {
  recipes: number;
  recipesSkipped: number;
  items: number;
  shopping: number;
  photos: number;
}

function categoryName(c: KoItem['category']): string | null {
  if (!c) return null;
  return typeof c === 'string' ? c : c.name ?? null;
}

function mapCategory(name: string, koCategory: string | null): string {
  if (koCategory) {
    const hit = CATEGORIES.find((c) => c.toLowerCase() === koCategory.toLowerCase());
    if (hit) return hit;
  }
  return guessItem(name).category;
}

export async function importKitchenOwl(
  db: DatabaseSync,
  homeId: string,
  userId: string | null,
  data: KoData,
  fetchPhoto?: (photo: string) => Promise<{ bytes: Buffer; mime: string } | null>,
): Promise<ImportResult> {
  const result: ImportResult = { recipes: 0, recipesSkipped: 0, items: 0, shopping: 0, photos: 0 };
  const existing = new Set((db.prepare('SELECT title FROM recipes WHERE home_id = ?').all(homeId) as Row[]).map((r) => String(r.title).toLowerCase()));

  for (const raw of data.recipes ?? []) {
    if (!raw?.name) continue;
    if (existing.has(raw.name.toLowerCase())) { result.recipesSkipped++; continue; }
    const recipe = fromKitchenOwlRecipe(raw);
    if (!recipe.image && raw.photo && fetchPhoto) {
      try {
        const img = await fetchPhoto(raw.photo);
        if (img) { recipe.image = saveImage(img.bytes, img.mime); result.photos++; }
      } catch {
        // A missing photo shouldn't stop the import.
      }
    }
    saveRecipe(db, homeId, recipe, userId);
    existing.add(raw.name.toLowerCase());
    result.recipes++;
  }

  // KitchenOwl's item catalog becomes our quick-add suggestions.
  tx(db, () => {
    const upsert = db.prepare(`INSERT INTO shopping_history (home_id, name_key, name, category, times_bought)
      VALUES (?, ?, ?, ?, 1) ON CONFLICT (home_id, name_key) DO NOTHING`);
    for (const it of data.items ?? []) {
      if (!it?.name) continue;
      const r = upsert.run(homeId, matchKey(it.name), it.name, mapCategory(it.name, categoryName(it.category)));
      if (r.changes) result.items++;
    }
  });

  const lists = (data.shoppinglists ?? []).filter((l): l is KoList => typeof l === 'object' && Array.isArray(l.items));
  for (const list of lists) {
    for (const it of list.items) {
      if (!it?.name) continue;
      const parsed = it.description ? parseIngredient(`${it.description} ${it.name}`) : null;
      addShoppingItem(db, homeId, {
        name: it.name,
        quantity: parsed?.quantity ?? null,
        unit: parsed?.unit ?? null,
        category: mapCategory(it.name, categoryName(it.category)),
        note: [parsed?.quantity == null ? it.description : null, lists.length > 1 ? list.name : null].filter(Boolean).join(' · ') || null,
      }, userId);
      result.shopping++;
    }
  }
  return result;
}

function koClient(baseUrl: string, token: string) {
  let base: URL;
  try { base = new URL(baseUrl.replace(/\/+$/, '') + '/'); } catch { throw new HttpError(400, 'That KitchenOwl address is not valid'); }
  if (!/^https?:$/.test(base.protocol)) throw new HttpError(400, 'Use an http or https address');
  const call = async (path: string) => {
    const res = await fetch(new URL(path.replace(/^\//, ''), base), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 401 || res.status === 403) throw new HttpError(400, 'KitchenOwl rejected that token. Create a long-lived token in KitchenOwl under Settings > Account.');
    if (!res.ok) throw new HttpError(502, `KitchenOwl answered ${res.status} for ${path}`);
    return res;
  };
  return {
    json: async <T>(path: string): Promise<T> => (await call(path)).json() as Promise<T>,
    photo: async (name: string) => {
      const res = await call(/^https?:/.test(name) ? name : `api/upload/${encodeURIComponent(name)}`);
      const mime = (res.headers.get('content-type') ?? '').split(';')[0];
      return { bytes: Buffer.from(await res.arrayBuffer()), mime };
    },
  };
}

export function kitchenOwlRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Upload the JSON from KitchenOwl's household export.
  app.post('/api/homes/:homeId/import/kitchenowl/file', { bodyLimit: 50 * 1024 * 1024 }, async (req) => {
    const ctx = homeCtx(db, req);
    const body = (req.body ?? {}) as Row;
    let data = body.data as KoData | string;
    if (typeof data === 'string') {
      try { data = JSON.parse(data) as KoData; } catch { throw new HttpError(400, "That file isn't valid JSON"); }
    }
    if (!data || typeof data !== 'object') throw new HttpError(400, 'Choose a KitchenOwl export file');
    return importKitchenOwl(db, ctx.homeId, ctx.user?.id ?? null, data);
  });

  // Pull straight from a running KitchenOwl server. The token is used once and never stored.
  app.post('/api/homes/:homeId/import/kitchenowl/server', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const ko = koClient(requireStr(b.url, 'KitchenOwl address', 500), requireStr(b.token, 'Token', 4000));
    const householdId = str(b.householdId, 20);
    if (!householdId) {
      const households = await ko.json<{ id: number; name: string }[]>('api/household');
      return { households: households.map((h) => ({ id: h.id, name: h.name })) };
    }
    const exported = await ko.json<KoData>(`api/household/${householdId}/export`);
    const lists: KoList[] = [];
    if (b.includeShopping !== false) {
      const koLists = await ko.json<{ id: number; name: string }[]>(`api/household/${householdId}/shoppinglist`);
      for (const l of koLists) lists.push({ name: l.name, items: await ko.json<KoItem[]>(`api/shoppinglist/${l.id}/items`) });
    }
    const result = await importKitchenOwl(db, ctx.homeId, ctx.user?.id ?? null, { ...exported, shoppinglists: lists }, b.includePhotos === false ? undefined : ko.photo);
    return { ...result, households: undefined };
  });
}
