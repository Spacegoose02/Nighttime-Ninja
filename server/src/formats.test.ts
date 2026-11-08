import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { emptyRecipe } from '../../shared/recipe.ts';
import { readRecipeArchive, toPaprika } from './formats.ts';
import { unzip, zip } from './zip.ts';

const j = (o: unknown) => Buffer.from(JSON.stringify(o));
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('zip round trip', () => {
  const files = [{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'dir/ü.json', data: j({ x: 1 }) }];
  assert.deepEqual(unzip(zip(files)).map((f) => [f.name, f.data.toString()]), files.map((f) => [f.name, f.data.toString()]));
  assert.throws(() => unzip(Buffer.from('not a zip at all, sorry, not even close')), /Not a ZIP/);
});

test('reads a Mealie export with photos', () => {
  const file = zip([
    { name: 'recipes/chili/chili.json', data: j({
      name: 'Chili', description: 'Weeknight chili', recipeYield: '6 servings', prepTime: 'PT15M', performTime: '1 hour',
      orgURL: 'https://example.org/chili', tags: [{ name: 'Beef' }], recipeCategory: [{ name: 'Dinner' }],
      recipeIngredient: [
        { quantity: 1, unit: { name: 'lb' }, food: { name: 'ground beef' }, note: '' },
        { quantity: 0, unit: null, food: null, note: '', originalText: '2 cans kidney beans' },
      ],
      recipeInstructions: [{ text: 'Brown the beef.' }, { text: 'Simmer.' }],
    }) },
    { name: 'recipes/chili/images/original.webp', data: Buffer.from('webp') },
  ]);
  const { format, recipes } = readRecipeArchive(file, 'mealie.zip');
  assert.equal(format, 'mealie');
  const r = recipes[0].recipe;
  assert.equal(r.title, 'Chili');
  assert.equal(r.servings, 6);
  assert.equal(r.prepMinutes, 15);
  assert.equal(r.cookMinutes, 60);
  assert.deepEqual(r.ingredients[0], { name: 'ground beef', quantity: 1, unit: 'lb', note: null, optional: false });
  assert.equal(r.ingredients[1].quantity, 2);
  assert.deepEqual(r.instructions, ['Brown the beef.', 'Simmer.']);
  assert.deepEqual(r.tags, ['beef', 'dinner']);
  assert.equal(recipes[0].photo?.mime, 'image/webp');
});

test('reads a Tandoor export (a zip of zips)', () => {
  const one = zip([
    { name: 'recipe.json', data: j({
      name: 'Pancakes', servings: 4, working_time: 10, waiting_time: 15, keywords: [{ name: 'Breakfast' }],
      steps: [
        { instruction: 'Mix.', ingredients: [{ food: { name: 'flour' }, unit: { name: 'cup' }, amount: 1.5, note: '' }, { is_header: true, food: null }] },
        { instruction: 'Fry.', ingredients: [{ food: { name: 'butter' }, unit: null, amount: 0, no_amount: true, note: 'for the pan' }] },
      ],
    }) },
    { name: 'image.png', data: PNG },
  ]);
  const { format, recipes } = readRecipeArchive(zip([{ name: '1.zip', data: one }]));
  assert.equal(format, 'tandoor');
  const r = recipes[0].recipe;
  assert.deepEqual(r.ingredients.map((i) => [i.name, i.quantity, i.unit]), [['flour', 1.5, 'cup'], ['butter', null, null]]);
  assert.deepEqual([r.prepMinutes, r.cookMinutes, r.servings], [10, 15, 4]);
  assert.deepEqual(r.instructions, ['Mix.', 'Fry.']);
  assert.equal(recipes[0].photo?.mime, 'image/png');
});

test('reads Paprika and writes a Paprika file that reads back the same', () => {
  const paprika = zip([{ name: 'Soup.paprikarecipe', data: zlib.gzipSync(j({
    name: 'Soup', ingredients: '2 cups stock\n1 onion, diced', directions: '1. Chop.\n2. Simmer.', servings: '4',
    prep_time: '10 min', cook_time: '30 mins', source_url: 'https://example.org/soup', categories: ['Soups'], photo_data: PNG.toString('base64'),
  })) }]);
  const read = readRecipeArchive(paprika, 'export.paprikarecipes');
  assert.equal(read.format, 'paprika');
  const soup = read.recipes[0].recipe;
  assert.deepEqual(soup.instructions, ['Chop.', 'Simmer.']);
  assert.equal(soup.ingredients[1].note, 'diced');
  assert.equal(read.recipes[0].photo?.bytes.length, PNG.length);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-paprika-'));
  fs.writeFileSync(path.join(dir, 'pic.png'), PNG);
  const out = toPaprika([{ ...soup, image: '/uploads/pic.png' }, { ...emptyRecipe(), title: 'Soup' }], dir);
  const back = readRecipeArchive(out, 'x.paprikarecipes').recipes;
  assert.equal(back.length, 2);
  assert.deepEqual(back[0].recipe.ingredients, soup.ingredients);
  assert.deepEqual(back[0].recipe.instructions, soup.instructions);
  assert.equal(back[0].recipe.servings, 4);
  assert.equal(back[0].recipe.cookMinutes, 30);
  assert.ok(back[0].photo);
  // Two recipes with the same name get separate files.
  assert.deepEqual(unzip(out).map((e) => e.name), ['Soup.paprikarecipe', 'Soup (2).paprikarecipe']);
});

test('says so when a file is from somewhere else', () => {
  assert.throws(() => readRecipeArchive(zip([{ name: 'notes.txt', data: Buffer.from('hi') }])), /Mealie, Tandoor or Paprika/);
});
