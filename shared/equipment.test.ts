import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTools, missingTools, neededTools, toolsForPrompt } from './equipment.ts';

const recipe = (...instructions: string[]) => ({ title: '', instructions });

test('finds the gear a recipe needs from its steps', () => {
  assert.deepEqual(neededTools(recipe('Preheat the air fryer to 400°F.', 'Air fry for 12 minutes, shaking halfway.')), [['air-fryer']]);
  assert.deepEqual(neededTools(recipe('Preheat oven to 350°F.', 'Bake in a 9x13 baking dish for 30 minutes.')), [['oven'], ['baking-dish']]);
  assert.deepEqual(neededTools(recipe('Beat the butter and sugar in a stand mixer or with a hand mixer.')), [['stand-mixer', 'hand-mixer']]);
  assert.deepEqual(neededTools(recipe('Brown the beef in a Dutch oven over medium heat.')), [['stovetop'], ['dutch-oven']]);
  assert.deepEqual(neededTools(recipe('Cook on high pressure in the Instant Pot, then use sauté mode.')), [['pressure-cooker']]);
  assert.deepEqual(neededTools(recipe('Blend until smooth.')), [['blender']]);
  assert.deepEqual(neededTools(recipe('Purée with an immersion blender.')), [['immersion-blender']]);
  assert.deepEqual(neededTools(recipe('Add everything to a shaker with ice and shake hard.', 'Double strain into a chilled coupe.')), [['cocktail-shaker'], ['strainer']]);
  assert.deepEqual(neededTools(recipe('Stir the chicken into the rice.')), []);
});

test('gear only offered as an option is not required', () => {
  assert.deepEqual(neededTools(recipe("If you don't have a stand mixer, knead by hand for 10 minutes.")), []);
  assert.deepEqual(neededTools(recipe('Optionally finish under the broiler.')), []);
});

test('a single requirement covers an either-or that includes it', () => {
  assert.deepEqual(neededTools(recipe('Mix in a stand mixer or by hand with a hand mixer.', 'Knead with the dough hook in the stand mixer.')), [['stand-mixer']]);
});

test('missing gear is only flagged once the home has listed its tools', () => {
  const wings = recipe('Air fry the wings at 380°F for 25 minutes.');
  assert.deepEqual(missingTools(wings, []), []);
  assert.deepEqual(missingTools(wings, ['oven', 'stovetop']), ['Air fryer']);
  assert.deepEqual(missingTools(wings, ['oven', 'air-fryer']), []);
  assert.deepEqual(missingTools(recipe('Use a stand mixer or hand mixer.'), ['oven']), ['Stand mixer or Hand mixer']);
  assert.deepEqual(missingTools(recipe('Use a stand mixer or hand mixer.'), ['hand-mixer']), []);
});

test('cleans the saved list and writes it out for Gordy and Rocco', () => {
  assert.deepEqual(cleanTools(['oven', ' Oven ', '', 42, 'Tortilla press']), ['oven', 'Tortilla press']);
  assert.equal(toolsForPrompt([]), null);
  const text = toolsForPrompt(['oven', 'stovetop', 'Tortilla press'])!;
  assert.match(text, /Oven, Stovetop, Tortilla press/);
  assert.match(text, /They do not have: .*Air fryer/);
  assert.doesNotMatch(text.split('They do not have')[1], /\bOven\b/);
});
