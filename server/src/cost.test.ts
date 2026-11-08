import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingredientCost, recipeCost, type Purchase } from './cost.ts';
import type { Ingredient } from '../../shared/recipe.ts';

const ing = (name: string, quantity: number | null, unit: string | null, optional = false) =>
  ({ name, quantity, unit, optional, note: null, group: null, raw: name }) as unknown as Ingredient;

test('prices an ingredient from what was paid', () => {
  assert.equal(ingredientCost(ing('onion', 2, null), { name: 'onions', quantity: 4, unit: null, price: 2 }), 1);
  // 1 lb out of a 2 lb pack that cost $10.
  assert.equal(ingredientCost(ing('chicken thighs', 1, 'lb'), { name: 'chicken thighs', quantity: 2, unit: 'lb', price: 10 }), 5);
  // 8 oz is half a pound.
  assert.equal(ingredientCost(ing('ground beef', 8, 'oz'), { name: 'ground beef', quantity: 1, unit: 'lb', price: 6 }), 3);
  // Cups of flour can't be priced from a count with no weight.
  assert.equal(ingredientCost(ing('rice', 1, 'cup'), { name: 'rice', quantity: null, unit: null, price: 4 }), null);
});

test('adds up a recipe and says what has no price', () => {
  const purchases: Purchase[] = [
    { name: 'chicken thighs', quantity: 2, unit: 'lb', price: 10 },
    { name: 'onion', quantity: 3, unit: null, price: 3 },
  ];
  const c = recipeCost([ing('chicken thighs', 2, 'lb'), ing('onion', 1, null), ing('salt', 1, 'tsp'), ing('cilantro', 1, 'bunch', true), ing('rice', 1, 'cup')], 4, purchases);
  assert.equal(c.total, 11);
  assert.equal(c.perServing, 2.75);
  assert.equal(c.priced, 2);
  assert.equal(c.of, 3);
  assert.deepEqual(c.unpriced, ['rice']);
});
