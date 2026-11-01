import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatLoop, saveApproved, wantsToSave, type ChatAction } from './aichat.ts';

// A stand-in for Claude that plays back scripted replies and records what it was asked.
function fake(script: ({ text?: string; tool?: { name: string; input: object } })[]) {
  const calls: { tool_choice?: unknown; messages: { role: string; content?: unknown }[] }[] = [];
  let i = 0;
  const askFn = async (p: { tool_choice?: unknown; messages: { role: string; content?: unknown }[] }, onText?: (t: string) => void) => {
    calls.push({ ...p, messages: [...p.messages] });
    const step = script[Math.min(i++, script.length - 1)];
    if (step.text && onText) for (const word of step.text.split(/(?<= )/)) onText(word);
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
  assert.ok(!wantsToSave('can you keep it under 30 minutes?'));
  assert.ok(!wantsToSave('how long can I store leftovers?'));
  assert.ok(!wantsToSave('remember I am vegetarian'));
  assert.ok(!wantsToSave('any tricks to save time on the dough?'));
  assert.ok(!wantsToSave("don't save this one"));
});

test('a yes to an offer to save counts as asking, and nothing else does', () => {
  const offer = `${RECIPE}\n\nWant me to save this to your recipe book?`;
  assert.ok(saveApproved([{ role: 'user', content: 'biscuits' }, { role: 'assistant', content: offer }, { role: 'user', content: 'Yes please!' }]));
  assert.ok(saveApproved([{ role: 'user', content: 'biscuits' }, { role: 'assistant', content: offer }, { role: 'user', content: 'sure' }]));
  assert.ok(!saveApproved([{ role: 'user', content: 'biscuits' }, { role: 'assistant', content: offer }, { role: 'user', content: 'no thanks' }]));
  assert.ok(!saveApproved([{ role: 'user', content: 'biscuits' }, { role: 'assistant', content: 'Want them flakier?' }, { role: 'user', content: 'yes' }]));
  assert.ok(!saveApproved([{ role: 'user', content: 'biscuits recipe' }]));
});

test('a save the person did not ask for is turned away, and Gordy is told to ask first', async () => {
  const saves: string[] = [];
  const { askFn, calls } = fake([{ tool: { name: 'save_recipe', input: { title: 'Biscuits' } } }, { text: `${RECIPE}\n\nWant me to save it?` }]);
  const out = await chatLoop(askFn, turn(saves), [{ role: 'user', content: 'biscuits recipe' }], false);
  assert.deepEqual(saves, []);
  assert.equal(out.actions.length, 0);
  assert.match(JSON.stringify(calls[1].messages.at(-1)), /Ask them whether they want it saved/);
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

test('when asked to save, claiming a save that never happened triggers a real save', async () => {
  const saves: string[] = [];
  const { askFn, calls } = fake([{ text: "I've saved your biscuits to the recipe book!" }, { tool: { name: 'save_recipe', input: { title: 'Biscuits' } } }]);
  const out = await chatLoop(askFn, { ...turn(saves), canForce: true }, [{ role: 'user', content: 'save my biscuits recipe' }], true);
  assert.deepEqual(saves, ['Biscuits']);
  assert.deepEqual(calls[1].tool_choice, { type: 'tool', name: 'save_recipe' });
  assert.equal(out.actions.length, 1);
});

test('models that refuse a forced tool call are asked to save in a system message instead', async () => {
  const saves: string[] = [];
  const { askFn, calls } = fake([{ tool: { name: 'save_recipe', input: { title: 'Biscuits' } } }, { text: 'Saved it, sugar!' }]);
  const out = await chatLoop(askFn, { ...turn(saves), canForce: false }, [{ role: 'user', content: RECIPE }, { role: 'assistant', content: RECIPE }, { role: 'user', content: 'save it' }], true);
  assert.equal(calls[0].tool_choice, undefined);
  const last = calls[0].messages.at(-1)!;
  assert.equal(last.role, 'system');
  assert.match(String(last.content), /save_recipe/);
  assert.equal(calls[0].messages.at(-2)!.role, 'user');
  // The note stays put on the next round, so the conversation only ever grows.
  assert.deepEqual(calls[1].messages.slice(0, 4), calls[0].messages);
  assert.equal(calls[1].tool_choice, undefined);
  assert.deepEqual(saves, ['Biscuits']);
  assert.equal(out.reply, 'Saved it, sugar!');
});

test('an unasked false save claim saves nothing and says so', async () => {
  const saves: string[] = [];
  const { askFn } = fake([{ text: "I've saved your biscuits to the recipe book!" }, { tool: { name: 'save_recipe', input: { title: 'Biscuits' } } }]);
  const out = await chatLoop(askFn, { ...turn(saves), canForce: false }, [{ role: 'user', content: 'biscuits recipe' }], false);
  assert.deepEqual(saves, []);
  assert.match(out.reply, /Nothing was saved/);
});

test('when asked, a false save claim on those models gets a system message too', async () => {
  const saves: string[] = [];
  const { askFn, calls } = fake([{ text: "I've saved your biscuits to the recipe book!" }, { tool: { name: 'save_recipe', input: { title: 'Biscuits' } } }]);
  const out = await chatLoop(askFn, { ...turn(saves), canForce: false }, [{ role: 'user', content: 'save my biscuits' }], true);
  assert.equal(calls[1].tool_choice, undefined);
  assert.equal(calls[1].messages.at(-1)!.role, 'system');
  assert.deepEqual(saves, ['Biscuits']);
  assert.equal(out.actions.length, 1);
});

test('knows which models take a forced tool call', async () => {
  const { canForceTool } = await import('../claude.ts');
  for (const m of ['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-5-20250929', 'claude-haiku-5-5', 'claude-haiku-4-5', 'claude-fable-5']) assert.ok(canForceTool(m), m);
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-mythos-5-1', 'claude-opus-6']) assert.ok(!canForceTool(m), m);
});

test('if the save still fails, the reply says so instead of pretending', async () => {
  const { askFn } = fake([{ text: "It's saved!" }, { text: 'oops' }]);
  const out = await chatLoop(askFn, turn([]), [{ role: 'user', content: 'save the biscuits' }], true);
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

test('streams each round as it is written, with a blank line between rounds', async () => {
  const saves: string[] = [];
  const { askFn } = fake([
    { text: 'Let me check your pantry. ', tool: { name: 'save_recipe', input: { title: 'Biscuits' } } },
    { text: 'Saved Biscuits for you.' },
  ]);
  let heard = '';
  const out = await chatLoop(askFn, turn(saves), [{ role: 'user', content: 'save biscuits please' }], true, (t) => { heard += t; });
  assert.equal(heard, 'Let me check your pantry. \n\nSaved Biscuits for you.');
  assert.equal(out.reply, 'Saved Biscuits for you.');
});

test('a paused web search picks up where it left off, and the pages it used come back as sources', async () => {
  const replies = [
    {
      stop_reason: 'pause_turn',
      content: [
        { type: 'text', text: 'Let me look that up, sugar.' },
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'texas roadhouse rolls' } },
      ],
    },
    {
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'The secret is ' },
        { type: 'text', text: 'honey in the dough', citations: [{ type: 'web_search_result_location', url: 'https://example.com/rolls', title: 'Copycat Rolls', cited_text: '', encrypted_index: '' }] },
        { type: 'text', text: '.' },
        { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: 'https://example.org/butter', retrieved_at: null, content: { type: 'document', title: null, source: { type: 'text', media_type: 'text/plain', data: '' } } } },
      ],
    },
  ];
  const sent: unknown[][] = [];
  let i = 0;
  const askFn = async (p: { messages: unknown[] }) => { sent.push([...p.messages]); return replies[i++] as never; };
  const out = await chatLoop(askFn as never, turn([]), [{ role: 'user', content: 'find me texas roadhouse rolls' }], false);
  assert.equal(sent.length, 2);
  // The paused turn goes back as the last message so Claude can carry on.
  assert.equal((sent[1].at(-1) as { role: string }).role, 'assistant');
  assert.equal(out.reply, 'Let me look that up, sugar.\n\nThe secret is honey in the dough.');
  assert.deepEqual(out.sources, [
    { url: 'https://example.com/rolls', title: 'Copycat Rolls' },
    { url: 'https://example.org/butter', title: '' },
  ]);
});

test('a refused reply has no sources', async () => {
  const askFn = async () => ({ stop_reason: 'refusal', content: [{ type: 'text', text: 'x', citations: [{ type: 'web_search_result_location', url: 'https://example.com', title: 'x', cited_text: '', encrypted_index: '' }] }] }) as never;
  const out = await chatLoop(askFn, turn([]), [{ role: 'user', content: 'hi' }], false);
  assert.deepEqual(out.sources, []);
  assert.equal(out.reply, 'no');
});
