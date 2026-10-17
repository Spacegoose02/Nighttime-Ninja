// Measurement parsing and conversion. Everything can be normalized to US customary units.

export type Dimension = 'volume' | 'mass' | 'count';

interface UnitDef {
  key: string;
  dim: Dimension;
  /** Size in the dimension's base unit (ml for volume, g for mass, 1 for count). */
  factor: number;
  metric?: boolean;
  aliases: string[];
}

const UNITS: UnitDef[] = [
  { key: 'tsp', dim: 'volume', factor: 4.92892, aliases: ['t', 'tsp', 'tsps', 'teaspoon', 'teaspoons', 'tspn'] },
  { key: 'tbsp', dim: 'volume', factor: 14.7868, aliases: ['T', 'tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons'] },
  { key: 'fl oz', dim: 'volume', factor: 29.5735, aliases: ['fl oz', 'floz', 'fl. oz', 'fl. oz.', 'fluid ounce', 'fluid ounces'] },
  { key: 'cup', dim: 'volume', factor: 236.588, aliases: ['c', 'cup', 'cups'] },
  { key: 'pint', dim: 'volume', factor: 473.176, aliases: ['pt', 'pint', 'pints'] },
  { key: 'quart', dim: 'volume', factor: 946.353, aliases: ['qt', 'qts', 'quart', 'quarts'] },
  { key: 'gallon', dim: 'volume', factor: 3785.41, aliases: ['gal', 'gallon', 'gallons'] },
  { key: 'ml', dim: 'volume', factor: 1, metric: true, aliases: ['ml', 'mL', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
  { key: 'cl', dim: 'volume', factor: 10, metric: true, aliases: ['cl', 'centiliter', 'centiliters', 'centilitre', 'centilitres'] },
  { key: 'dl', dim: 'volume', factor: 100, metric: true, aliases: ['dl', 'deciliter', 'deciliters', 'decilitre', 'decilitres'] },
  { key: 'l', dim: 'volume', factor: 1000, metric: true, aliases: ['l', 'L', 'liter', 'liters', 'litre', 'litres'] },
  { key: 'oz', dim: 'mass', factor: 28.3495, aliases: ['oz', 'ounce', 'ounces'] },
  { key: 'lb', dim: 'mass', factor: 453.592, aliases: ['lb', 'lbs', 'pound', 'pounds', '#'] },
  { key: 'mg', dim: 'mass', factor: 0.001, metric: true, aliases: ['mg', 'milligram', 'milligrams'] },
  { key: 'g', dim: 'mass', factor: 1, metric: true, aliases: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes'] },
  { key: 'kg', dim: 'mass', factor: 1000, metric: true, aliases: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'] },
];

/** Count-like units that are kept as-is (only convertible to themselves). */
const COUNT_UNITS: Record<string, string[]> = {
  pinch: ['pinch', 'pinches'],
  dash: ['dash', 'dashes'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans', 'tin', 'tins'],
  jar: ['jar', 'jars'],
  package: ['package', 'packages', 'pkg', 'pkgs', 'packet', 'packets', 'pack', 'packs'],
  bag: ['bag', 'bags'],
  box: ['box', 'boxes'],
  bottle: ['bottle', 'bottles'],
  bunch: ['bunch', 'bunches'],
  head: ['head', 'heads'],
  slice: ['slice', 'slices'],
  stick: ['stick', 'sticks'],
  sprig: ['sprig', 'sprigs'],
  piece: ['piece', 'pieces', 'pc', 'pcs'],
  dozen: ['dozen', 'doz'],
  each: ['each', 'ea', 'whole', 'x'],
};

const aliasMap = new Map<string, string>();
const lowerAliasMap = new Map<string, string>();
for (const u of UNITS) {
  for (const a of u.aliases) {
    aliasMap.set(a, u.key);
    // "T" vs "t" is meaningful; only add a lowercase fallback when it does not collide.
    if (a !== 'T' && a !== 't') lowerAliasMap.set(a.toLowerCase(), u.key);
  }
}
for (const [key, aliases] of Object.entries(COUNT_UNITS)) {
  for (const a of aliases) lowerAliasMap.set(a, key);
}
const unitDefs = new Map(UNITS.map((u) => [u.key, u]));

/** Returns the canonical unit key for a unit string, or null when it is not a known unit. */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\.$/, '');
  if (!s) return null;
  return aliasMap.get(s) ?? lowerAliasMap.get(s.toLowerCase()) ?? null;
}

export function unitDimension(unit: string | null | undefined): Dimension {
  const key = normalizeUnit(unit ?? '');
  return (key && unitDefs.get(key)?.dim) || 'count';
}

export function isMetric(unit: string | null | undefined): boolean {
  const key = normalizeUnit(unit ?? '');
  return !!(key && unitDefs.get(key)?.metric);
}

/** Converts between two units. Returns null if they are not compatible. */
export function convert(qty: number, from: string | null | undefined, to: string | null | undefined): number | null {
  const a = normalizeUnit(from ?? '') ?? (from || 'each');
  const b = normalizeUnit(to ?? '') ?? (to || 'each');
  if (a === b) return qty;
  const da = unitDefs.get(a);
  const db = unitDefs.get(b);
  if (!da || !db || da.dim !== db.dim) {
    if (a === 'dozen' && b === 'each') return qty * 12;
    if (a === 'each' && b === 'dozen') return qty / 12;
    return null;
  }
  return (qty * da.factor) / db.factor;
}

const NICE_FRACTIONS: [number, string][] = [
  [0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'],
  [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8'], [1, ''],
];

/** Formats a quantity as a friendly kitchen number: 1.5 -> "1 1/2", 0.333 -> "1/3". */
export function formatQuantity(qty: number | null | undefined): string {
  if (qty == null || !Number.isFinite(qty)) return '';
  if (qty >= 20) return String(Math.round(qty));
  const whole = Math.floor(qty);
  const frac = qty - whole;
  let best = NICE_FRACTIONS[0];
  for (const f of NICE_FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
  if (Math.abs(best[0] - frac) > 0.04) return String(Math.round(qty * 100) / 100);
  if (best[0] === 1) return String(whole + 1);
  if (!best[1]) return String(whole);
  return whole ? `${whole} ${best[1]}` : best[1];
}

/** Picks a sensible US unit for a metric (or any) amount. */
export function toUS(qty: number, unit: string | null | undefined): { quantity: number; unit: string | null } {
  const key = normalizeUnit(unit ?? '');
  const def = key ? unitDefs.get(key) : undefined;
  if (!def || !def.metric) return { quantity: qty, unit: key ?? unit ?? null };
  const base = qty * def.factor;
  if (def.dim === 'mass') {
    if (base >= 453.592) return { quantity: round(base / 453.592), unit: 'lb' };
    return { quantity: round(base / 28.3495), unit: 'oz' };
  }
  if (base < 14) return { quantity: round(base / 4.92892), unit: 'tsp' };
  if (base < 59) return { quantity: round(base / 14.7868), unit: 'tbsp' };
  if (base < 946) return { quantity: round(base / 236.588), unit: 'cup' };
  if (base < 3785) return { quantity: round(base / 946.353), unit: 'quart' };
  return { quantity: round(base / 3785.41), unit: 'gallon' };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/**
 * Parses a leading quantity such as "1", "1.5", "1 1/2", "1½", "1-2" or "1 to 2" (ranges use the upper value).
 * Returns the number and the rest of the string.
 */
export function parseQuantity(input: string): { quantity: number | null; rest: string } {
  let s = input.trim();
  for (const [ch, v] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.replace(new RegExp(`(\\d)\\s*${ch}`, 'g'), (_m, d) => `${Number(d) + v} `);
    s = s.replaceAll(ch, ` ${v} `);
  }
  s = s.replace(/^\s+/, '');
  const num = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
  const m = s.match(new RegExp(`^${num}(?:\\s*(?:-|–|to)\\s*${num})?`, 'i'));
  if (!m) return { quantity: null, rest: input.trim() };
  const value = parseNumber(m[2] ?? m[1]);
  return { quantity: value, rest: s.slice(m[0].length).trim() };
}

function parseNumber(s: string): number {
  const t = s.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

/** Rewrites Celsius temperatures in free text to Fahrenheit, e.g. "180°C" -> "350°F". */
export function celsiusToFahrenheitText(text: string): string {
  return text.replace(/(\d{2,3})\s*(?:°\s*C|º\s*C|degrees?\s*C(?:elsius)?)(?![a-z])/gi, (_m, c) => {
    const f = Math.round(((Number(c) * 9) / 5 + 32) / 5) * 5;
    return `${f}°F`;
  });
}
