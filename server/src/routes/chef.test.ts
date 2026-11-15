import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-test-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('../db.ts');
const { buildApp } = await import('../app.ts');
const { clearRateLimit } = await import('../security.ts');
const { searchBook, readBookRecipe } = await import('./chef.ts');

async function twoHomes() {
  clearRateLimit('local:ip:127.0.0.1');
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });
  const login = async (name: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name } });
    return { cookie: `nn_session=${res.cookies.find((c) => c.name === 'nn_session')!.value}` };
  };
  const call = async (headers: Record<string, string>, method: string, url: string, payload?: unknown) => {
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers });
    return res.body ? JSON.parse(res.body) : null;
  };
  const a = await login('Cook');
  const b = await login('Neighbor');
  const mine = await call(a, 'POST', '/api/homes', { name: 'Mine' });
  const theirs = await call(b, 'POST', '/api/homes', { name: 'Theirs' });
  const biscuits = await call(a, 'POST', `/api/homes/${mine.id}/recipes`, {
    title: "Grandma's Biscuits", description: 'Flaky and tall', servings: 8, prepMinutes: 15, cookMinutes: 12, tags: ['bread', 'southern'],
    ingredients: [{ name: 'self-rising flour', quantity: 2, unit: 'cup' }, { name: 'buttermilk', quantity: 1, unit: 'cup' }], instructions: ['Fold', 'Bake hot'],
  });
  await call(a, 'POST', `/api/homes/${mine.id}/recipes`, { title: 'Sweet Tea', ingredients: [{ name: 'black tea bags', quantity: 6 }], instructions: ['Steep'] });
  await call(a, 'PATCH', `/api/homes/${mine.id}/recipes/${biscuits.id}/meta`, { favorite: true, rating: 5, notes: 'Use the cast iron.' });
  const secret = await call(b, 'POST', `/api/homes/${theirs.id}/recipes`, { title: 'Secret Chili', ingredients: [{ name: 'beans' }], instructions: ['Simmer'] });
  return { db, mine: mine.id as string, theirs: theirs.id as string, biscuits: biscuits.id as string, secret: secret.id as string };
}

test('Gordy can list and search the recipe book', async () => {
  const { db, mine } = await twoHomes();
  const all = searchBook(db, mine, {});
  assert.match(all, /2 recipes in the book/);
  assert.match(all, /Grandma's Biscuits/);
  assert.match(all, /Sweet Tea/);
  assert.match(all, /Grandma's Biscuits \(id: [^)]+\) · bread, southern · 27 min · favorite · 5\/5/);
  assert.ok(all.indexOf('Biscuits') < all.indexOf('Sweet Tea'), 'favorites first');
  assert.match(searchBook(db, mine, { favoritesOnly: true }), /1 recipe in the book/);
  assert.match(searchBook(db, mine, { query: 'biscuits' }), /Grandma's Biscuits/);
  assert.doesNotMatch(searchBook(db, mine, { query: 'biscuits' }), /Sweet Tea/);
  assert.match(searchBook(db, mine, { query: 'buttermilk' }), /Grandma's Biscuits/, 'finds by ingredient');
  assert.match(searchBook(db, mine, { query: 'southern' }), /Grandma's Biscuits/, 'finds by tag');
  assert.match(searchBook(db, mine, { query: 'lasagna' }), /Nothing in the recipe book matches/);
});

test('Gordy reads a whole recipe by id or title', async () => {
  const { db, mine, biscuits } = await twoHomes();
  const byId = readBookRecipe(db, mine, { id: biscuits });
  assert.match(byId, /Title: Grandma's Biscuits/);
  assert.match(byId, /2 cup self-rising flour/);
  assert.match(byId, /1\. Fold/);
  assert.match(byId, /A household favorite/);
  assert.match(byId, /Household rating: 5\/5/);
  assert.match(byId, /Household notes: Use the cast iron\./);
  assert.match(byId, /\[not in stock\]/, 'says what is missing from the pantry');
  assert.equal(readBookRecipe(db, mine, { title: "grandma's biscuits" }), byId);
  assert.match(readBookRecipe(db, mine, { title: 'biscuits' }), /Grandma's Biscuits/, 'a partial title works');
  assert.throws(() => readBookRecipe(db, mine, { title: 'Lasagna' }), /not in the recipe book/);
});

test("Gordy never sees another household's recipes", async () => {
  const { db, mine, secret } = await twoHomes();
  assert.doesNotMatch(searchBook(db, mine, {}), /Secret Chili/);
  assert.match(searchBook(db, mine, { query: 'chili' }), /Nothing in the recipe book matches/);
  assert.throws(() => readBookRecipe(db, mine, { id: secret }), /not in the recipe book/);
  assert.throws(() => readBookRecipe(db, mine, { title: 'Secret Chili' }), /not in the recipe book/);
  assert.throws(() => readBookRecipe(db, mine, { title: '%' }), /not in the recipe book/, 'LIKE wildcards are matched literally');
});
