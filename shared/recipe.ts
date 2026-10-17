// The one standard recipe format every importer normalizes into.
import { normalizeUnit, parseQuantity } from './units.ts';

export interface Ingredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  optional: boolean;
}

export interface Recipe {
  title: string;
  description: string;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  sourceUrl: string | null;
  image: string | null;
  ingredients: Ingredient[];
  instructions: string[];
  tags: string[];
}

export function emptyRecipe(): Recipe {
  return {
    title: '', description: '', servings: null, prepMinutes: null, cookMinutes: null,
    sourceUrl: null, image: null, ingredients: [], instructions: [], tags: [],
  };
}

/** Parses a free-text ingredient line like "1 1/2 cups flour, sifted" or "2 (14 oz) cans tomatoes". */
export function parseIngredient(line: string): Ingredient {
  let s = line.replace(/^[\s•*\-–▢□☐]+/, '').trim();
  let optional = false;
  if (/\(optional\)|,\s*optional$|^optional:?\s*/i.test(s)) {
    optional = true;
    s = s.replace(/\(optional\)|,\s*optional$|^optional:?\s*/gi, '').trim();
  }
  const { quantity, rest } = parseQuantity(s);
  let remainder = rest;
  const notes: string[] = [];
  // Leading parenthetical size such as "(14 oz)".
  const paren = remainder.match(/^\(([^)]*)\)\s*/);
  if (paren) {
    notes.push(paren[1]);
    remainder = remainder.slice(paren[0].length);
  }
  let unit: string | null = null;
  const unitMatch = remainder.match(/^(fl\.?\s*oz\.?|fluid ounces?|[A-Za-z]+\.?)\s+(?:of\s+)?/);
  if (unitMatch && quantity !== null) {
    const u = normalizeUnit(unitMatch[1]);
    if (u) {
      unit = u;
      remainder = remainder.slice(unitMatch[0].length);
    }
  }
  let name = remainder;
  const comma = name.indexOf(',');
  if (comma > 0) {
    notes.push(name.slice(comma + 1).trim());
    name = name.slice(0, comma);
  }
  const trailingParen = name.match(/\s*\(([^)]*)\)\s*$/);
  if (trailingParen) {
    notes.push(trailingParen[1]);
    name = name.slice(0, trailingParen.index);
  }
  return {
    name: name.trim() || line.trim(),
    quantity,
    unit,
    note: notes.filter(Boolean).join('; ') || null,
    optional,
  };
}

/** Lowercase, singular-ish key used to match recipe ingredients against inventory items. */
export function matchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(fresh|large|small|medium|chopped|diced|minced|sliced|ground|whole|organic|raw)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('es') && /(ch|sh|x|o)es$/.test(w) ? w.slice(0, -2) : w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/** Parses ISO-8601 durations ("PT1H30M") or plain numbers/phrases into minutes. */
export function parseDuration(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v).trim();
  const iso = s.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso) return (Number(iso[1] ?? 0) * 1440) + (Number(iso[2] ?? 0) * 60) + Number(iso[3] ?? 0) + Math.round(Number(iso[4] ?? 0) / 60);
  let total = 0;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const m = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (h) total += Number(h[1]) * 60;
  if (m) total += Number(m[1]);
  if (total) return Math.round(total);
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseServings(v: unknown): number | null {
  if (Array.isArray(v)) v = v[0];
  if (v == null) return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return decodeEntities(v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (Array.isArray(v)) return v.map(text).join(' ');
  if (typeof v === 'object' && 'text' in (v as object)) return text((v as { text: unknown }).text);
  return String(v);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function imageUrl(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return imageUrl(v[0]);
  if (typeof v === 'object') return imageUrl((v as { url?: unknown }).url);
  return null;
}

function flattenInstructions(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') {
    return v.split(/\r?\n+|(?<=\.)\s+(?=\d+\.\s)/).map((s) => text(s).replace(/^\d+[.)]\s*/, '')).filter(Boolean);
  }
  if (Array.isArray(v)) return v.flatMap(flattenInstructions);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.itemListElement) return flattenInstructions(o.itemListElement);
    if (o.text) return [text(o.text)].filter(Boolean);
    if (o.name) return [text(o.name)].filter(Boolean);
  }
  return [];
}

function toTags(...vals: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of vals) {
    const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
    for (const t of list) {
      const s = text(t).trim().toLowerCase();
      if (s && s.length < 40) out.add(s);
    }
  }
  return [...out];
}

/** Converts a schema.org Recipe object (from JSON-LD) into the standard format. */
export function fromSchemaOrg(o: Record<string, unknown>, sourceUrl: string | null = null): Recipe {
  const ingredients = ((o.recipeIngredient ?? o.ingredients ?? []) as unknown[])
    .map((l) => text(l))
    .filter(Boolean)
    .map(parseIngredient);
  return {
    title: text(o.name) || 'Untitled recipe',
    description: text(o.description),
    servings: parseServings(o.recipeYield ?? o.yield),
    prepMinutes: parseDuration(o.prepTime),
    cookMinutes: parseDuration(o.cookTime) ?? parseDuration(o.totalTime),
    sourceUrl: (typeof o.url === 'string' ? o.url : null) ?? sourceUrl,
    image: imageUrl(o.image),
    ingredients,
    instructions: flattenInstructions(o.recipeInstructions),
    tags: toTags(o.recipeCategory, o.recipeCuisine, o.keywords),
  };
}

function findRecipeNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipeNode(n);
      if (r) return r;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  const type = o['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return o;
  if (o['@graph']) return findRecipeNode(o['@graph']);
  if (o.mainEntity) return findRecipeNode(o.mainEntity);
  return null;
}

/** Pulls a recipe out of a web page's JSON-LD. Returns null when the page has none. */
export function fromHtml(html: string, sourceUrl: string | null = null): Recipe | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const node = findRecipeNode(JSON.parse(m[1].trim()));
      if (node) return fromSchemaOrg(node, sourceUrl);
    } catch {
      // Malformed JSON-LD blocks are common; keep looking.
    }
  }
  return null;
}

/**
 * Parses a plain-text recipe. The first line is the title; "Ingredients" and
 * "Instructions"/"Directions"/"Method"/"Steps" headings split the sections.
 */
export function fromText(input: string): Recipe {
  const r = emptyRecipe();
  const lines = input.split(/\r?\n/).map((l) => l.trim());
  let section: 'head' | 'ing' | 'steps' = 'head';
  const head: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (/^#*\s*ingredients?:?$/i.test(line)) { section = 'ing'; continue; }
    if (/^#*\s*(instructions|directions|method|steps|preparation):?$/i.test(line)) { section = 'steps'; continue; }
    if (section === 'head') {
      const serves = line.match(/^(?:serves|servings|yield|makes):?\s*(\d+)/i);
      const prep = line.match(/^prep(?:\s*time)?:?\s*(.+)$/i);
      const cook = line.match(/^cook(?:\s*time)?:?\s*(.+)$/i);
      if (serves) r.servings = Number(serves[1]);
      else if (prep) r.prepMinutes = parseDuration(prep[1]);
      else if (cook) r.cookMinutes = parseDuration(cook[1]);
      else head.push(line.replace(/^#+\s*/, ''));
    } else if (section === 'ing') {
      r.ingredients.push(parseIngredient(line));
    } else {
      r.instructions.push(line.replace(/^(\d+[.)]|step\s*\d+:?)\s*/i, ''));
    }
  }
  r.title = head.shift() ?? 'Untitled recipe';
  r.description = head.join('\n');
  return r;
}

/** Accepts our own export format (one recipe or an array). */
export function fromNinjaJson(o: unknown): Recipe[] {
  const list = Array.isArray(o) ? o : (o as { recipes?: unknown[] })?.recipes ?? [o];
  return list.map((x) => ({ ...emptyRecipe(), ...(x as Partial<Recipe>) })).filter((r) => r.title);
}

/** KitchenOwl recipe (export file or API response). */
export function fromKitchenOwlRecipe(o: Record<string, unknown>): Recipe {
  const items = (o.items ?? []) as Record<string, unknown>[];
  const desc = text(o.description ?? '');
  // KitchenOwl keeps the whole method in the markdown description.
  const descLines = String(o.description ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const stepLines = descLines.filter((l) => /^(\d+[.)]|[-*])\s+/.test(l));
  return {
    title: text(o.name) || 'Untitled recipe',
    description: stepLines.length >= 2 ? descLines.filter((l) => !stepLines.includes(l)).join('\n') : desc,
    servings: parseServings(o.yields),
    prepMinutes: parseDuration(o.prep_time),
    cookMinutes: parseDuration(o.cook_time) ?? parseDuration(o.time),
    sourceUrl: typeof o.source === 'string' && /^https?:/.test(o.source) ? o.source : null,
    image: typeof o.photo === 'string' && /^https?:/.test(o.photo) ? o.photo : null,
    ingredients: items.map((it) => {
      const parsed = it.description ? parseIngredient(`${text(it.description)} ${text(it.name)}`) : null;
      return {
        name: text(it.name),
        quantity: parsed?.quantity ?? null,
        unit: parsed?.unit ?? null,
        note: parsed && parsed.quantity == null ? text(it.description) || null : null,
        optional: Boolean(it.optional),
      };
    }),
    instructions: stepLines.length >= 2 ? stepLines.map((l) => l.replace(/^(\d+[.)]|[-*])\s+/, '')) : [],
    tags: toTags(((o.tags ?? []) as unknown[]).map((t) => (typeof t === 'object' && t ? (t as { name?: unknown }).name : t))),
  };
}

/**
 * Detects the format of an uploaded/pasted blob and returns standard recipes.
 * Supports: schema.org JSON-LD, HTML pages, our JSON export, KitchenOwl JSON, and plain text.
 */
export function importAny(input: string, sourceUrl: string | null = null): Recipe[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (/^[[{]/.test(trimmed)) {
    try {
      const data = JSON.parse(trimmed);
      const ld = findRecipeNode(data);
      if (ld) return [fromSchemaOrg(ld, sourceUrl)];
      const list = Array.isArray(data) ? data : data.recipes ?? [data];
      if (list.length && list.every((x: Record<string, unknown>) => 'name' in x && !('title' in x))) {
        return list.map(fromKitchenOwlRecipe);
      }
      return fromNinjaJson(data);
    } catch {
      // Not JSON after all; fall through.
    }
  }
  if (/<html|<script|<!doctype/i.test(trimmed)) {
    const r = fromHtml(trimmed, sourceUrl);
    return r ? [r] : [];
  }
  return [fromText(trimmed)];
}
