import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ICONS, searchIcons } from './icons.ts';
import { guessItem } from './catalog.ts';

test('the icon picker has a big, duplicate-free set', () => {
  assert.ok(ALL_ICONS.length >= 150, `only ${ALL_ICONS.length} icons`);
  const seen = new Set<string>();
  for (const i of ALL_ICONS) { assert.ok(!seen.has(i.emoji), `duplicate ${i.emoji} ${i.name}`); seen.add(i.emoji); }
});

test('icon search matches names and extra words', () => {
  assert.ok(searchIcons('cheese').some((i) => i.emoji === '🧀'));
  assert.ok(searchIcons('boba').some((i) => i.emoji === '🧋'));
  assert.ok(searchIcons('pet').some((i) => i.emoji === '🐶'));
  assert.equal(searchIcons('').length, ALL_ICONS.length);
});

test('every guessed icon is offered in the picker', () => {
  const known = new Set(ALL_ICONS.map((i) => i.emoji));
  const names = ['milk', 'kiwi', 'ramen', 'trash bags', 'dog food', 'oysters', 'sweet potato', 'frozen peas', 'coffee', 'olive oil', 'jam'];
  for (const n of names) assert.ok(known.has(guessItem(n).icon), `${n} → ${guessItem(n).icon}`);
});

test('compound names get the right icon and aisle', () => {
  const cases: [string, string, string][] = [
    ['chicken broth', '🥫', 'Pantry'], ['peanut butter', '🥜', 'Pantry'], ['ice cream', '🍨', 'Frozen'],
    ['sweet potatoes', '🍠', 'Produce'], ['green beans', '🫛', 'Produce'], ['black beans', '🫘', 'Pantry'],
    ['coconut milk', '🥥', 'Pantry'], ['cream cheese', '🧀', 'Dairy & Eggs'], ['garlic powder', '🧂', 'Spices'],
    ['frozen peas', '🫛', 'Frozen'], ['frozen yogurt', '🍨', 'Frozen'], ['eggplant', '🍆', 'Produce'], ['eggs', '🥚', 'Dairy & Eggs'],
    ['graham crackers', '🥨', 'Snacks'], ['hamburger buns', '🍞', 'Bakery'], ['sausage', '🌭', 'Meat & Seafood'],
    ['popcorn', '🍿', 'Snacks'], ['coffee beans', '☕', 'Beverages'], ['tortilla chips', '🥨', 'Snacks'], ['blueberries', '🫐', 'Produce'],
    ['grapefruit', '🍊', 'Produce'], ['butternut squash', '🥒', 'Produce'], ['dish soap', '🫧', 'Household'],
  ];
  for (const [name, icon, category] of cases) assert.deepEqual(guessItem(name), { icon, category }, name);
  assert.deepEqual(guessItem('mystery box from grandma'), { icon: '🛒', category: 'Other' });
});
