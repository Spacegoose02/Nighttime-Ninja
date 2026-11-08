// What a recipe costs to make, from what the household last paid for each ingredient on the shopping list.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { ingredientMatches, type Ingredient } from '../../shared/recipe.ts';
import { convertFor } from '../../shared/units.ts';

export interface Purchase { name: string; quantity: number | null; unit: string | null; price: number }
export interface RecipeCost {
  /** Estimated cost of the ingredients we have prices for, in dollars. */
  total: number;
  perServing: number | null;
  /** How many ingredients had a price, out of how many count (optional ones and water, salt and the like are left out). */
  priced: number;
  of: number;
  /** Ingredients with no price yet, so the app can say what's missing. */
  unpriced: string[];
}

const FREE = new Set(['water', 'ice', 'salt', 'pepper', 'black pepper', 'salt and pepper']);

/** The latest priced purchase of each thing the home has bought. */
export function latestPurchases(db: DatabaseSync, homeId: string): Purchase[] {
  const rows = db.prepare(`SELECT name, quantity, unit, price FROM shopping_items s
    WHERE home_id = ? AND checked = 1 AND price IS NOT NULL AND price > 0
      AND checked_at = (SELECT MAX(checked_at) FROM shopping_items t WHERE t.home_id = s.home_id AND lower(t.name) = lower(s.name) AND t.price IS NOT NULL AND t.price > 0)
    GROUP BY lower(name)`).all(homeId) as Row[];
  return rows.map((r) => ({ name: String(r.name), quantity: r.quantity as number | null, unit: r.unit as string | null, price: Number(r.price) }));
}

/** What one ingredient costs, given what was paid for a purchase of it. Null when the amounts can't be compared. */
export function ingredientCost(ing: Pick<Ingredient, 'name' | 'quantity' | 'unit'>, p: Purchase): number | null {
  const bought = p.quantity && p.quantity > 0 ? p.quantity : 1;
  const need = ing.quantity && ing.quantity > 0 ? ing.quantity : null;
  const plain = (u: string | null) => !u || u === 'each';
  // "2 onions" from a purchase of "3 onions" (or of "onions" at one price each).
  if (plain(ing.unit) && plain(p.unit)) return (p.price / bought) * (need ?? 1);
  if (need == null) return null;
  const inBoughtUnits = convertFor(need, ing.unit, plain(p.unit) ? null : p.unit, ing.name);
  if (inBoughtUnits == null) return null;
  return (p.price / bought) * inBoughtUnits;
}

export function recipeCost(ingredients: Ingredient[], servings: number | null, purchases: Purchase[]): RecipeCost {
  let total = 0;
  let priced = 0;
  const unpriced: string[] = [];
  const counted = ingredients.filter((i) => !i.optional && !FREE.has(i.name.toLowerCase().trim()));
  for (const ing of counted) {
    const p = purchases.find((x) => ingredientMatches(ing.name, x.name));
    const c = p ? ingredientCost(ing, p) : null;
    if (c == null || !Number.isFinite(c)) { unpriced.push(ing.name); continue; }
    total += c;
    priced++;
  }
  total = Math.round(total * 100) / 100;
  return { total, perServing: servings && priced ? Math.round((total / servings) * 100) / 100 : null, priced, of: counted.length, unpriced };
}
