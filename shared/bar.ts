// Bar measures and batch math for the Mixologist. Everything converts through fluid ounces.
import { convert, normalizeUnit } from './units.ts';

const ML_PER_FL_OZ = 29.5735;

export interface BarUnit { key: string; label: string; flOz: number; aliases: string[] }

export const BAR_UNITS: BarUnit[] = [
  { key: 'fl oz', label: 'oz', flOz: 1, aliases: ['oz', 'ounce', 'ounces', 'fl oz', 'floz'] },
  { key: 'ml', label: 'ml', flOz: 1 / ML_PER_FL_OZ, aliases: ['ml', 'milliliter', 'milliliters'] },
  { key: 'cl', label: 'cl', flOz: 10 / ML_PER_FL_OZ, aliases: ['cl', 'centiliter', 'centiliters'] },
  { key: 'shot', label: 'shot (1.5 oz)', flOz: 1.5, aliases: ['shot', 'shots'] },
  { key: 'jigger', label: 'jigger (1.5 oz)', flOz: 1.5, aliases: ['jigger', 'jiggers'] },
  { key: 'pony', label: 'pony (1 oz)', flOz: 1, aliases: ['pony', 'ponies'] },
  { key: 'barspoon', label: 'barspoon', flOz: 5 / ML_PER_FL_OZ, aliases: ['barspoon', 'barspoons', 'bar spoon', 'bar spoons'] },
  { key: 'dash', label: 'dash', flOz: 1 / 32, aliases: ['dash', 'dashes'] },
  { key: 'splash', label: 'splash', flOz: 0.25, aliases: ['splash', 'splashes'] },
  { key: 'tsp', label: 'tsp', flOz: 1 / 6, aliases: ['tsp', 'teaspoon', 'teaspoons'] },
  { key: 'tbsp', label: 'tbsp', flOz: 0.5, aliases: ['tbsp', 'tablespoon', 'tablespoons'] },
  { key: 'cup', label: 'cup', flOz: 8, aliases: ['cup', 'cups'] },
  { key: 'pint', label: 'pint', flOz: 16, aliases: ['pint', 'pints'] },
  { key: 'quart', label: 'quart', flOz: 32, aliases: ['quart', 'quarts'] },
  { key: 'bottle', label: 'bottle (750 ml)', flOz: 750 / ML_PER_FL_OZ, aliases: ['bottle', 'bottles', 'fifth', 'fifths'] },
  { key: 'liter', label: 'liter', flOz: 1000 / ML_PER_FL_OZ, aliases: ['l', 'liter', 'liters', 'litre', 'litres'] },
  { key: 'handle', label: 'handle (1.75 L)', flOz: 1750 / ML_PER_FL_OZ, aliases: ['handle', 'handles'] },
  { key: 'gallon', label: 'gallon', flOz: 128, aliases: ['gallon', 'gallons'] },
];

const byAlias = new Map(BAR_UNITS.flatMap((u) => u.aliases.map((a) => [a, u] as const)));

/** Turns an amount into fluid ounces. In a drink a bare "oz" means fluid ounces. Null when it isn't a liquid measure. */
export function toFlOz(qty: number, unit: string | null | undefined): number | null {
  const u = (unit ?? '').trim().toLowerCase().replace(/\.$/, '');
  const bar = byAlias.get(u);
  if (bar) return qty * bar.flOz;
  const key = normalizeUnit(unit);
  return key ? convert(qty, key, 'fl oz') : null;
}

export function barConvert(qty: number, from: string, to: string): number | null {
  const oz = toFlOz(qty, from);
  const target = byAlias.get(to.toLowerCase()) ?? BAR_UNITS.find((u) => u.key === to);
  return oz == null || !target ? null : oz / target.flOz;
}

export interface BatchLine { name: string; quantity: number | null; unit: string | null; flOz: number | null; ml: number | null; note: string | null }

/** Scales a single drink up for a crowd and totals how much liquid it makes. */
export function batchDrink(ingredients: { name: string; quantity: number | null; unit: string | null; note?: string | null }[], servings: number) {
  const lines: BatchLine[] = ingredients.map((i) => {
    const quantity = i.quantity == null ? null : i.quantity * servings;
    const flOz = quantity == null ? null : toFlOz(quantity, i.unit);
    return { name: i.name, quantity, unit: i.unit, flOz, ml: flOz == null ? null : flOz * ML_PER_FL_OZ, note: i.note ?? null };
  });
  const totalFlOz = lines.reduce((sum, l) => sum + (l.flOz ?? 0), 0);
  return { lines, totalFlOz, totalMl: totalFlOz * ML_PER_FL_OZ };
}

/** How many 750 ml bottles cover an amount. */
export const bottlesOf750 = (flOz: number): number => Math.ceil((flOz * ML_PER_FL_OZ) / 750 - 1e-9);
