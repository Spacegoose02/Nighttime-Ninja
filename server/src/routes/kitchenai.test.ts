import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// A stand-in for the Claude API: answers every request with the JSON the test queued, as a streamed reply.
const answers: object[] = [];
const asked: { system: unknown; messages: { content: unknown }[] }[] = [];
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    asked.push(JSON.parse(raw));
    const text = JSON.stringify(answers.shift() ?? {});
    const send = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    send('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    send('message_stop', {});
    res.end();
  });
});
await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
const port = (fake.address() as { port: number }).port;
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-ai-test-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('../db.ts');
const { buildApp } = await import('../app.ts');
const { youTubeDetails } = await import('./kitchenai.ts');

test.after(() => fake.close());

async function setup() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name: 'Cook' } });
  const headers = { cookie: `nn_session=${res.cookies.find((c) => c.name === 'nn_session')!.value}` };
  const call = async (method: string, url: string, payload?: unknown) => {
    const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers });
    const body = r.body.trim() ? JSON.parse(r.body) : null;
    // Slow AI routes answer 200 at once and put any failure in the body.
    return { status: body?.error && r.headers['x-nn-deferred'] ? body.status : r.statusCode, body };
  };
  const home = (await call('POST', '/api/homes', { name: 'AI Kitchen' })).body;
  return { call, base: `/api/homes/${home.id}`, homeId: home.id as string };
}

const recipe = (title: string) => ({ title, description: '', servings: 2, prepMinutes: 5, cookMinutes: 10, ingredients: [{ name: 'rice', quantity: 1, unit: 'cup', note: null, optional: false }], instructions: ['Cook.'] });

test('plan my week fills only open days, from the recipe book or new dishes', async () => {
  const { call, base } = await setup();
  const { body: saved } = await call('POST', `${base}/recipes/import`, { save: true, text: 'Fried Rice\nIngredients\n1 cup rice\nInstructions\nFry.' });
  await call('POST', `${base}/mealplan`, { date: '2030-03-02', title: 'Out to eat' });
  answers.push({ meals: [
    { date: '2030-03-01', slot: 'dinner', recipeId: saved.ids[0], title: 'Fried Rice', why: 'Uses the rice', recipe: null },
    { date: '2030-03-02', slot: 'dinner', recipeId: null, title: 'Taken', why: '', recipe: recipe('Taken') },
    { date: '2030-03-03', slot: 'dinner', recipeId: 'made-up-id', title: 'Soup', why: 'Cozy', recipe: recipe('Soup') },
  ] });
  const r = await call('POST', `${base}/chef/plan-week`, { start: '2030-03-01', days: 3, notes: 'quick please' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.meals.map((m: { date: string; recipeId: string | null }) => [m.date, m.recipeId]), [['2030-03-01', saved.ids[0]], ['2030-03-03', null]]);
  assert.equal(r.body.meals[1].recipe.title, 'Soup', 'an unknown id becomes a new dish');
  const prompt = JSON.stringify(asked.at(-1)!.messages);
  assert.match(prompt, /2030-03-01 dinner, 2030-03-03 dinner/, 'only the open days are asked for');
  assert.match(prompt, /quick please/);
});

test('diets reach the AI and show as recipe warnings', async () => {
  const { call, base } = await setup();
  const me = (await call('GET', '/api/me')).body.user.id;
  const set = await call('PUT', `${base}/members/${me}/diet`, { diets: ['vegetarian', 'keto-ish'], allergies: ['peanuts', ' '] });
  assert.deepEqual(set.body, { diets: ['vegetarian'], allergies: ['peanuts'] });
  const { body: saved } = await call('POST', `${base}/recipes/import`, { save: true, text: 'Satay\nIngredients\n1 lb chicken\n1/2 cup peanut butter\nInstructions\nGrill.' });
  const r = (await call('GET', `${base}/recipes/${saved.ids[0]}`)).body;
  assert.deepEqual(r.dietClashes.map((c: { ingredient: string }) => c.ingredient), ['chicken', 'peanut butter']);
  assert.equal((await call('GET', `${base}/recipes`)).body[0].dietWarnings, 2);
  answers.push({ meals: [] });
  await call('POST', `${base}/chef/plan-week`, { start: '2030-03-01', days: 1 });
  assert.match(JSON.stringify(asked.at(-1)!.system), /Cook: vegetarian, allergic to peanuts/);
});

test('reads a recipe from a photo, and estimates nutrition', async () => {
  const { call, base } = await setup();
  assert.equal((await call('POST', `${base}/recipes/from-photo`, { images: ['not an image'] })).status, 400);
  answers.push({ found: true, recipes: [{ ...recipe("Grandma's Rolls"), tags: ['Bread'] }] });
  const tiny = 'data:image/png;base64,iVBORw0KGgo=';
  const r = await call('POST', `${base}/recipes/from-photo`, { images: [tiny] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.recipes[0].title, "Grandma's Rolls");
  assert.deepEqual(r.body.recipes[0].tags, ['bread']);
  const sent = asked.at(-1)!.messages[0].content as { type: string; source?: { media_type: string } }[];
  assert.equal(sent[0].type, 'image');
  assert.equal(sent[0].source?.media_type, 'image/png');
  answers.push({ found: false, recipes: [] });
  assert.equal((await call('POST', `${base}/recipes/from-photo`, { images: [tiny] })).status, 422);

  const { body: saved } = await call('POST', `${base}/recipes/import`, { save: true, text: 'Rice\nServes 2\nIngredients\n1 cup rice\nInstructions\nBoil.' });
  answers.push({ calories: 342.6, proteinG: 6.4, carbsG: 74, fatG: 0.6, fiberG: 1, sugarG: 0, sodiumMg: -5 });
  const n = await call('POST', `${base}/recipes/${saved.ids[0]}/nutrition`, {});
  assert.equal(n.status, 200, JSON.stringify(n.body));
  assert.equal(n.body.calories, 343);
  assert.equal(n.body.sodiumMg, 0);
  assert.equal((await call('GET', `${base}/recipes/${saved.ids[0]}`)).body.nutrition.calories, 343);
  // Editing the recipe throws the old estimate away.
  const full = (await call('GET', `${base}/recipes/${saved.ids[0]}`)).body;
  await call('PUT', `${base}/recipes/${saved.ids[0]}`, { ...full, servings: 4 });
  assert.equal((await call('GET', `${base}/recipes/${saved.ids[0]}`)).body.nutrition, null);
});

test('reads the title and description from a YouTube page', () => {
  const html = '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Best Biscuits","shortDescription":"INGREDIENTS\\n2 cups flour"}};var meta = 1;</script>';
  assert.deepEqual(youTubeDetails(html), { title: 'Best Biscuits', description: 'INGREDIENTS\n2 cups flour' });
  assert.equal(youTubeDetails('<html></html>'), null);
});
