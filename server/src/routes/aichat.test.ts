import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatLoop, wantsToSave, type ChatAction } from './aichat.ts';

// A stand-in for Claude that plays back scripted replies and records what it was asked.
function fake(script: ({ text?: string; tool?: { name: string; input: object } })[]) {
  const calls: { tool_choice?: unknown }[] = [];
  let i = 0;
  const askFn = async (p: { tool_choice?: unknown }) => {
    calls.push(p);
    const step = script[Math.min(i++, script.length - 1)];
    const content: object[] = [];
    if (step.text) content.push({ type: 'text', text: step.text });
    if (step.tool) content.push({ type: 'tool_use', id: `t${i}`, name: step.tool.name, input: step.tool.input });
    return { content, stop_reason: step.tool ? 'tool_use' : 'end_turn' } as never;
  };
  return { askFn, calls };
}

function turn(saves: string[]) {
  return {
    system: [], tools: [], saveTool: 'save_recipe', refused: 'no', empty: 'hi',
    runTool(name: string, input: Record<string, unknown>, actions: ChatAction[]) {
      if (name !== 'save_recipe') throw new Error('unknown');
      saves.push(String(input.title));
      actions.push({ type: 'saved', label: `Saved ${input.title}`, recipeId: 'r1' });
      return 'Saved';
    },
  };
}

const RECIPE = 'Here are my biscuits:\n- 2 cups flour\n- 1 cup buttermilk\n1. Mix\n2. Bake';

test('knows when someone is asking to save', () => {
  assert.ok(wantsToSave('save that one please'));
  assert.ok(wantsToSave('can you keep this recipe'));
  assert.ok(wantsToSave('add it to my recipes'));
  assert.ok(!wantsToSave('add the flour to my shopping list'));
  assert.ok(!wantsToSave('what goes with biscuits?'));
});

test('asking to save forces a real save, and the reply does not repeat the recipe', async () => {
  const saves: string[] = [];
  const { askFn, calls } = fake([{ tool: { name: 'save_recipe', input: { title: 'Biscuits' } } }, { text: 'Saved it, sugar!' }]);
  const out = await chatLoop(askFn, turn(saves), [{ role: 'user', content: RECIPE }, { role: 'assistant', content: RECIPE }, { role: 'user', content: 'save it' }], true);
  assert.deepEqual(saves, ['Biscuits']);
  assert.deepEqual(calls[0].tool_choice, { type: 'tool', name: 'save_recipe' });
  assert.equal(out.reply, 'Saved it, sugar!');
  assert.equal(out.actions[0].type, 'saved');
});

test('claiming a save that never happened triggers a real save', async () => {
  const saves: string[] = [];
  const { askFn, calls } = fake([{ text: "I've saved your biscuits to the recipe book!" }, { tool: { name: 'save_recipe', input: { title: 'Biscuits' } } }]);
  const out = await chatLoop(askFn, turn(saves), [{ role: 'user', content: 'biscuits recipe' }], false);
  assert.deepEqual(saves, ['Biscuits']);
  assert.deepEqual(calls[1].tool_choice, { type: 'tool', name: 'save_recipe' });
  assert.equal(out.actions.length, 1);
});

test('if the save still fails, the reply says so instead of pretending', async () => {
  const { askFn } = fake([{ text: "It's saved!" }, { text: 'oops' }]);
  const out = await chatLoop(askFn, turn([]), [{ role: 'user', content: 'biscuits' }], false);
  assert.match(out.reply, /didn't actually save/);
  assert.equal(out.actions.length, 0);
});

test('a repeat save finds the recipe already in the book', async () => {
  const { openMemoryDb } = await import('../db.ts');
  const { existingRecipeId } = await import('./aichat.ts');
  const { saveRecipe } = await import('./recipes.ts');
  const db = openMemoryDb();
  db.prepare("INSERT INTO homes (id, name, join_code, calendar_token) VALUES ('h', 'Home', 'CODE1234', 'tok')").run();
  const base = { description: '', servings: 4, prepMinutes: null, cookMinutes: null, sourceUrl: null, image: null, ingredients: [], instructions: [], tags: [] };
  assert.equal(existingRecipeId(db, 'h', 'Biscuits'), undefined);
  const id = saveRecipe(db, 'h', { ...base, title: 'Biscuits' }, null);
  assert.equal(existingRecipeId(db, 'h', '  biscuits '), id);
  saveRecipe(db, 'h', { ...base, title: 'Biscuits', servings: 8 }, null, existingRecipeId(db, 'h', 'Biscuits'));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM recipes WHERE title = 'Biscuits'").get() as { n: number }).n, 1);
});
