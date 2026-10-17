import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, formatQuantity, parseQuantity, toUS, celsiusToFahrenheitText, normalizeUnit } from './units.ts';
import { parseIngredient, importAny, matchKey, parseDuration } from './recipe.ts';

test('parses quantities', () => {
  assert.equal(parseQuantity('1 1/2 cups').quantity, 1.5);
  assert.equal(parseQuantity('½ tsp').quantity, 0.5);
  assert.equal(parseQuantity('2½ cups').quantity, 2.5);
  assert.equal(parseQuantity('1-2 cloves').quantity, 2);
  assert.equal(parseQuantity('salt').quantity, null);
});

test('normalizes units', () => {
  assert.equal(normalizeUnit('Tbsp'), 'tbsp');
  assert.equal(normalizeUnit('T'), 'tbsp');
  assert.equal(normalizeUnit('t'), 'tsp');
  assert.equal(normalizeUnit('grams'), 'g');
  assert.equal(normalizeUnit('Cloves'), 'clove');
});

test('converts units', () => {
  assert.equal(convert(3, 'tsp', 'tbsp')?.toFixed(2), '1.00');
  assert.equal(convert(1, 'lb', 'oz')?.toFixed(1), '16.0');
  assert.equal(convert(1, 'cup', 'g'), null);
});

test('converts metric to US', () => {
  assert.deepEqual(toUS(500, 'g'), { quantity: 1.1, unit: 'lb' });
  assert.deepEqual(toUS(250, 'ml'), { quantity: 1.06, unit: 'cup' });
  assert.deepEqual(toUS(5, 'ml'), { quantity: 1.01, unit: 'tsp' });
  assert.equal(celsiusToFahrenheitText('Bake at 180°C for 20 min'), 'Bake at 355°F for 20 min');
});

test('formats quantities', () => {
  assert.equal(formatQuantity(1.5), '1 1/2');
  assert.equal(formatQuantity(0.333), '1/3');
  assert.equal(formatQuantity(2), '2');
});

test('parses ingredient lines', () => {
  assert.deepEqual(parseIngredient('1 1/2 cups all-purpose flour, sifted'), {
    name: 'all-purpose flour', quantity: 1.5, unit: 'cup', note: 'sifted', optional: false,
  });
  assert.deepEqual(parseIngredient('2 (14 oz) cans diced tomatoes'), {
    name: 'diced tomatoes', quantity: 2, unit: 'can', note: '14 oz', optional: false,
  });
  assert.equal(parseIngredient('3 eggs').name, 'eggs');
  assert.equal(parseIngredient('Salt to taste').quantity, null);
});

test('matches names loosely', () => {
  assert.equal(matchKey('Fresh Tomatoes'), matchKey('tomato'));
  assert.equal(matchKey('Cherries'), 'cherry');
});

test('parses durations', () => {
  assert.equal(parseDuration('PT1H30M'), 90);
  assert.equal(parseDuration('45 minutes'), 45);
});

test('imports JSON-LD from html', () => {
  const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Recipe","name":"Pancakes","recipeYield":"4 servings","recipeIngredient":["1 cup flour","2 eggs"],"recipeInstructions":[{"@type":"HowToStep","text":"Mix."},{"@type":"HowToStep","text":"Cook."}],"prepTime":"PT10M"}]}</script></html>`;
  const [r] = importAny(html);
  assert.equal(r.title, 'Pancakes');
  assert.equal(r.servings, 4);
  assert.equal(r.ingredients.length, 2);
  assert.deepEqual(r.instructions, ['Mix.', 'Cook.']);
});

test('imports plain text', () => {
  const [r] = importAny('Toast\nServes 2\nIngredients\n2 slices bread\n1 tbsp butter\nInstructions\n1. Toast bread.\n2. Butter it.');
  assert.equal(r.title, 'Toast');
  assert.equal(r.servings, 2);
  assert.equal(r.ingredients[1].unit, 'tbsp');
  assert.deepEqual(r.instructions, ['Toast bread.', 'Butter it.']);
});

test('imports KitchenOwl recipes', () => {
  const [r] = importAny(JSON.stringify({ recipes: [{ name: 'Chili', yields: 6, time: 60, description: 'Hearty.\n1. Brown beef\n2. Simmer', items: [{ name: 'ground beef', description: '1 lb' }, { name: 'beans', description: '', optional: true }], tags: [{ name: 'Dinner' }] }] }));
  assert.equal(r.title, 'Chili');
  assert.equal(r.ingredients[0].quantity, 1);
  assert.equal(r.ingredients[0].unit, 'lb');
  assert.equal(r.ingredients[1].optional, true);
  assert.deepEqual(r.instructions, ['Brown beef', 'Simmer']);
  assert.deepEqual(r.tags, ['dinner']);
});
