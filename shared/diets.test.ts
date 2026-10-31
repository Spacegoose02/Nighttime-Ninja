import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dietClashes, dietsForPrompt } from './diets.ts';

const ing = (...names: string[]) => names.map((name) => ({ name }));

test('flags ingredients that break a diet', () => {
  const sam = { name: 'Sam', diets: ['vegetarian'], allergies: [] };
  assert.deepEqual(dietClashes(ing('chicken thighs', 'rice', 'vegetable broth'), [sam]).map((c) => c.ingredient), ['chicken thighs']);
  const vegan = { name: 'Vee', diets: ['vegan'], allergies: [] };
  assert.deepEqual(dietClashes(ing('coconut milk', 'butter', 'peanut butter', 'eggs', 'honey'), [vegan]).map((c) => c.ingredient), ['butter', 'eggs', 'honey']);
  const gf = { name: 'Gus', diets: ['gluten-free'], allergies: [] };
  assert.deepEqual(dietClashes(ing('all-purpose flour', 'almond flour', 'soy sauce', 'tamari', 'corn tortillas'), [gf]).map((c) => c.ingredient), ['all-purpose flour', 'soy sauce']);
  assert.deepEqual(dietClashes(ing('butternut squash'), [{ name: 'D', diets: ['dairy-free'], allergies: [] }]), []);
});

test('flags allergens, including groups like tree nuts and shellfish', () => {
  const kid = { name: 'Kid', diets: [], allergies: ['tree nuts', 'Shellfish', 'kiwi'] };
  const clashes = dietClashes(ing('chopped pecans', 'shrimp', 'peanuts', 'sliced kiwi', 'salt'), [kid]);
  assert.deepEqual(clashes.map((c) => `${c.ingredient}: ${c.reason}`), ['chopped pecans: tree nuts allergy', 'shrimp: Shellfish allergy', 'sliced kiwi: kiwi allergy']);
  assert.equal(dietClashes(ing('2 eggs'), [{ name: 'E', diets: [], allergies: ['eggs'] }]).length, 1);
  assert.equal(dietClashes(ing('eggplant'), [{ name: 'E', diets: [], allergies: ['egg'] }]).length, 0);
});

test('describes the household for the AI', () => {
  assert.equal(dietsForPrompt([{ name: 'A', diets: [], allergies: [] }]), null);
  assert.match(dietsForPrompt([{ name: 'Kid', diets: ['vegetarian'], allergies: ['peanut'] }])!, /Kid: vegetarian, allergic to peanut/);
});

test('whole words only', () => {
  const gf = { name: 'Gus', diets: ['gluten-free'], allergies: [] };
  assert.deepEqual(dietClashes(ing('1 bunch cilantro', 'hamburger buns', 'egg noodles'), [gf]).map((c) => c.ingredient), ['hamburger buns', 'egg noodles']);
  assert.equal(dietClashes(ing('anchovies'), [{ name: 'V', diets: ['vegetarian'], allergies: [] }]).length, 1);
});
