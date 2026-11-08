// Moving recipes between Nighttime Ninja and other recipe apps.
//
// In: Mealie's export (.zip), Tandoor's export (.zip of .zip files), and Paprika's .paprikarecipes file, photos included.
// Out: a .paprikarecipes file, which Paprika opens and Mealie and Tandoor can both import.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseDuration, parseIngredient, type Ingredient, type Recipe } from '../../shared/recipe.ts';
import { unzip, zip, type ZipEntry } from './zip.ts';

export type RecipeFormat = 'mealie' | 'tandoor' | 'paprika';
export interface FoundRecipe { recipe: Recipe; photo: { bytes: Buffer; mime: string } | null }

type Obj = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? '' : String(v)).trim();
const lines = (v: unknown): string[] => s(v).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const names = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((x) => s(typeof x === 'object' && x ? (x as Obj).name : x)).filter(Boolean);
const servings = (v: unknown): number | null => {
  const n = Number.parseInt(s(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const url = (v: unknown): string | null => (/^https?:\/\//.test(s(v)) ? s(v) : null);
const tags = (...lists: string[][]): string[] => [...new Set(lists.flat().map((t) => t.toLowerCase()))].slice(0, 20);

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const mimeOf = (name: string): string | null => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;

/** Paprika keeps ingredients and directions as plain text, one per line. */
export function fromPaprika(o: Obj): Recipe {
  return {
    title: s(o.name) || 'Untitled recipe',
    description: [s(o.description), s(o.notes)].filter(Boolean).join('\n\n'),
    servings: servings(o.servings),
    prepMinutes: parseDuration(o.prep_time),
    cookMinutes: parseDuration(o.cook_time),
    sourceUrl: url(o.source_url),
    image: url(o.image_url),
    ingredients: lines(o.ingredients).map(parseIngredient).filter((i) => i.name),
    instructions: lines(o.directions).map((l) => l.replace(/^\d+[.)]\s*/, '')),
    tags: tags((Array.isArray(o.categories) ? o.categories : []).map(s)),
  };
}

/** Mealie: structured ingredients (food, unit, quantity) or plain lines, ISO or "1 hour" times. */
export function fromMealie(o: Obj): Recipe {
  const ingredients = (Array.isArray(o.recipeIngredient) ? o.recipeIngredient : []).map((x): Ingredient | null => {
    if (typeof x === 'string') return parseIngredient(x);
    const i = x as Obj;
    const food = s((i.food as Obj | null)?.name);
    if (!food) {
      const line = s(i.originalText) || s(i.display) || s(i.note);
      return line ? parseIngredient(line) : null;
    }
    const q = Number(i.quantity);
    return { name: food, quantity: Number.isFinite(q) && q > 0 ? q : null, unit: s((i.unit as Obj | null)?.name) || null, note: s(i.note) || null, optional: false };
  }).filter((i): i is Ingredient => !!i?.name);
  const steps = (Array.isArray(o.recipeInstructions) ? o.recipeInstructions : []).map((x) => s(typeof x === 'string' ? x : (x as Obj).text)).filter(Boolean);
  return {
    title: s(o.name) || 'Untitled recipe',
    description: s(o.description),
    servings: servings(o.recipeServings) ?? servings(o.recipeYield),
    prepMinutes: parseDuration(o.prepTime),
    cookMinutes: parseDuration(o.performTime) ?? parseDuration(o.cookTime) ?? parseDuration(o.totalTime),
    sourceUrl: url(o.orgURL),
    image: null,
    ingredients,
    instructions: steps,
    tags: tags(names(o.tags), names(o.recipeCategory)),
  };
}

/** Tandoor: steps that each carry their own ingredients. */
export function fromTandoor(o: Obj): Recipe {
  const steps = Array.isArray(o.steps) ? (o.steps as Obj[]) : [];
  const ingredients: Ingredient[] = [];
  for (const step of steps) {
    for (const i of (Array.isArray(step.ingredients) ? step.ingredients : []) as Obj[]) {
      if (i.is_header) continue;
      const name = s((i.food as Obj | null)?.name);
      if (!name) continue;
      const q = Number(i.amount);
      ingredients.push({ name, quantity: !i.no_amount && Number.isFinite(q) && q > 0 ? q : null, unit: s((i.unit as Obj | null)?.name) || null, note: s(i.note) || null, optional: false });
    }
  }
  return {
    title: s(o.name) || 'Untitled recipe',
    description: s(o.description),
    servings: servings(o.servings),
    prepMinutes: parseDuration(o.working_time) || null,
    cookMinutes: parseDuration(o.waiting_time) || null,
    sourceUrl: url(o.source_url),
    image: null,
    ingredients,
    instructions: steps.map((st) => s(st.instruction)).filter(Boolean),
    tags: tags(names(o.keywords)),
  };
}

function json(e: ZipEntry): Obj | null {
  try { return JSON.parse(e.data.toString('utf8')) as Obj; } catch { return null; }
}

/** Works out which app a file came from and returns its recipes with their photos. */
export function readRecipeArchive(file: Buffer, filename = ''): { format: RecipeFormat; recipes: FoundRecipe[] } {
  const entries = unzip(file);
  const total = entries.reduce((n, e) => n + e.data.length, 0);
  if (entries.length > 20_000 || total > 500 * 1024 * 1024) throw new Error('That archive is too big to import in one go');

  // Paprika: every entry is a gzipped JSON recipe.
  if (/\.paprikarecipes$/i.test(filename) || entries.some((e) => /\.paprikarecipe$/i.test(e.name))) {
    const recipes = entries.filter((e) => /\.paprikarecipe$/i.test(e.name)).flatMap((e): FoundRecipe[] => {
      let o: Obj;
      try { o = JSON.parse(zlib.gunzipSync(e.data, { maxOutputLength: 50 * 1024 * 1024 }).toString('utf8')) as Obj; } catch { return []; }
      const photo = typeof o.photo_data === 'string' && o.photo_data ? { bytes: Buffer.from(o.photo_data, 'base64'), mime: 'image/jpeg' } : null;
      return [{ recipe: fromPaprika(o), photo }];
    });
    return { format: 'paprika', recipes };
  }

  // Tandoor: a ZIP of ZIPs, each holding recipe.json and maybe an image.
  const inner = entries.filter((e) => /\.zip$/i.test(e.name));
  if (inner.length) {
    const recipes = inner.flatMap((z): FoundRecipe[] => {
      let files: ZipEntry[];
      try { files = unzip(z.data); } catch { return []; }
      const r = files.find((f) => /(^|\/)recipe\.json$/i.test(f.name));
      const o = r && json(r);
      if (!o) return [];
      const img = files.find((f) => /(^|\/)image\.\w+$/i.test(f.name) && mimeOf(f.name));
      return [{ recipe: fromTandoor(o), photo: img ? { bytes: img.data, mime: mimeOf(img.name)! } : null }];
    });
    return { format: 'tandoor', recipes };
  }

  // Mealie: recipes/<slug>/<slug>.json with recipes/<slug>/images/original.webp next to it.
  const mealie = entries.filter((e) => /\.json$/i.test(e.name)).map((e) => ({ e, o: json(e) }))
    .filter((x): x is { e: ZipEntry; o: Obj } => !!x.o && typeof x.o.name === 'string' && ('recipeIngredient' in x.o || 'recipeInstructions' in x.o));
  if (mealie.length) {
    const recipes = mealie.map(({ e, o }): FoundRecipe => {
      const dir = e.name.includes('/') ? e.name.slice(0, e.name.lastIndexOf('/') + 1) : '';
      const img = entries.find((f) => f.name.startsWith(`${dir}images/original.`) && mimeOf(f.name))
        ?? entries.find((f) => f.name.startsWith(dir) && f !== e && mimeOf(f.name));
      return { recipe: fromMealie(o), photo: img ? { bytes: img.data, mime: mimeOf(img.name)! } : null };
    });
    return { format: 'mealie', recipes };
  }
  throw new Error("That doesn't look like a Mealie, Tandoor or Paprika export");
}

/** Recipes as a .paprikarecipes file. Photos from this server go inside it. */
export function toPaprika(recipes: Recipe[], uploadsDir: string): Buffer {
  const used = new Set<string>();
  const entries = recipes.map((r): ZipEntry => {
    let photo_data: string | null = null;
    if (r.image?.startsWith('/uploads/')) {
      const file = path.join(uploadsDir, path.basename(r.image));
      try { photo_data = fs.readFileSync(file).toString('base64'); } catch { photo_data = null; }
    }
    const body = {
      uid: crypto.randomUUID().toUpperCase(),
      name: r.title,
      description: r.description,
      ingredients: r.ingredients.map((i) => [i.quantity ?? '', i.unit ?? '', i.name, i.note ? `, ${i.note}` : ''].join(' ').replace(/\s+,/, ',').replace(/\s+/g, ' ').trim()).join('\n'),
      directions: r.instructions.join('\n\n'),
      servings: r.servings ? String(r.servings) : '',
      prep_time: r.prepMinutes ? `${r.prepMinutes} min` : '',
      cook_time: r.cookMinutes ? `${r.cookMinutes} min` : '',
      total_time: '',
      source: r.sourceUrl ? new URL(r.sourceUrl).hostname : '',
      source_url: r.sourceUrl ?? '',
      image_url: r.image && /^https?:/.test(r.image) ? r.image : '',
      photo_data,
      categories: r.tags,
      notes: '',
      nutritional_info: '',
      difficulty: '',
      rating: 0,
      created: new Date().toISOString().replace('T', ' ').slice(0, 19),
      hash: '',
    };
    let name = (r.title || 'Recipe').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.replace(/ \(\d+\)$/, '')} (${n})`;
    used.add(name.toLowerCase());
    return { name: `${name}.paprikarecipe`, data: zlib.gzipSync(JSON.stringify(body)) };
  });
  return zip(entries);
}
