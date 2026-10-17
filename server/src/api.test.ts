import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-test-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');

async function setup() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const login = async (name: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name } });
    assert.equal(res.statusCode, 200, res.body);
    const cookie = res.cookies.find((c) => c.name === 'nn_session')!;
    return { cookie: `nn_session=${cookie.value}` };
  };
  const call = async (headers: Record<string, string>, method: string, url: string, payload?: unknown) => {
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return { app, login, call };
}

test('homes, roles and joining', async () => {
  const { login, call } = await setup();
  const alice = await login('Alice');
  const bob = await login('Bob');
  const me = await call(alice, 'GET', '/api/me');
  assert.equal(me.body.user.isAdmin, true, 'first user is admin');
  const { body: home } = await call(alice, 'POST', '/api/homes', { name: 'Den' });
  const detail = await call(alice, 'GET', `/api/homes/${home.id}`);
  assert.equal(detail.body.role, 'manager');
  assert.equal((await call(bob, 'GET', `/api/homes/${home.id}`)).status, 404);
  await call(bob, 'POST', '/api/homes/join', { code: detail.body.joinCode });
  const bobView = await call(bob, 'GET', `/api/homes/${home.id}`);
  assert.equal(bobView.body.role, 'member');
  assert.equal((await call(bob, 'PATCH', `/api/homes/${home.id}`, { name: 'Mine' })).status, 403);
  // The only manager can't demote themselves.
  assert.equal((await call(alice, 'PATCH', `/api/homes/${home.id}/members/${me.body.user.id}`, { role: 'member' })).status, 400);
});

test('inventory, recipes, ready-to-cook and cooking', async () => {
  const { login, call } = await setup();
  const a = await login('Cook');
  const { body: home } = await call(a, 'POST', '/api/homes', { name: 'Kitchen' });
  const base = `/api/homes/${home.id}`;
  await call(a, 'POST', `${base}/items`, { name: 'Flour', quantity: 2, unit: 'cup' });
  await call(a, 'POST', `${base}/items`, { name: 'Eggs', quantity: 12 });
  const imported = await call(a, 'POST', `${base}/recipes/import`, {
    save: true,
    text: 'Pancakes\nServes 4\nIngredients\n1 cup flour\n2 eggs\n1 cup milk\nInstructions\nMix.\nCook.',
  });
  const id = imported.body.ids[0];
  let r = await call(a, 'GET', `${base}/recipes/${id}`);
  assert.equal(r.body.status, 'almost');
  assert.deepEqual(r.body.missing, ['milk']);
  await call(a, 'POST', `${base}/items`, { name: 'Milk', quantity: 1, unit: 'gallon' });
  r = await call(a, 'GET', `${base}/recipes/${id}`);
  assert.equal(r.body.status, 'ready');
  const cooked = await call(a, 'POST', `${base}/recipes/${id}/cook`, {});
  assert.equal(cooked.body.used.length, 3);
  const items = (await call(a, 'GET', `${base}/items`)).body;
  assert.equal(items.find((i: { name: string }) => i.name === 'Eggs').quantity, 10);
  assert.equal(items.find((i: { name: string }) => i.name === 'Flour').quantity, 1);
  const history = (await call(a, 'GET', `${base}/history`)).body;
  assert.ok(history.some((h: { reason: string }) => h.reason === 'cooked Pancakes'));
});

test('shopping list quick-add, merge, check-off to inventory', async () => {
  const { login, call } = await setup();
  const a = await login('Shopper');
  const { body: home } = await call(a, 'POST', '/api/homes', { name: 'Home' });
  const base = `/api/homes/${home.id}`;
  await call(a, 'POST', `${base}/shopping`, { text: '2 lb chicken thighs\n1 lb chicken thighs, bananas' });
  const list = (await call(a, 'GET', `${base}/shopping`)).body;
  assert.equal(list.length, 2);
  const chicken = list.find((i: { name: string }) => i.name === 'chicken thighs');
  assert.equal(chicken.quantity, 3);
  await call(a, 'PATCH', `${base}/shopping/${chicken.id}`, { checked: true });
  const items = (await call(a, 'GET', `${base}/items`)).body;
  assert.equal(items[0].name, 'chicken thighs');
  assert.equal(items[0].category, 'Meat & Seafood');
  const sugg = (await call(a, 'GET', `${base}/shopping/suggestions`)).body;
  assert.equal(sugg[0].name, 'chicken thighs');
});

test('meal plan, calendar feed, public sharing and API tokens', async () => {
  const { login, call, app } = await setup();
  const a = await login('Planner');
  const { body: home } = await call(a, 'POST', '/api/homes', { name: 'Home' });
  const base = `/api/homes/${home.id}`;
  const { body: rec } = await call(a, 'POST', `${base}/recipes`, { title: 'Tacos', ingredients: [{ name: 'tortillas', quantity: 8, unit: null }], instructions: ['Fill'] });
  const today = new Date().toISOString().slice(0, 10);
  await call(a, 'POST', `${base}/mealplan`, { date: today, slot: 'dinner', recipeId: rec.id });
  const toShop = await call(a, 'POST', `${base}/mealplan/to-shopping`, { start: today });
  assert.equal(toShop.body.added, 1);
  const detail = (await call(a, 'GET', base)).body;
  const ics = await app.inject({ url: detail.calendarUrl });
  assert.match(ics.body, /SUMMARY:Dinner: Tacos/);

  const share = await call(a, 'POST', `${base}/recipes/${rec.id}/share`, {});
  const slug = share.body.shareUrl.split('/').pop();
  const pub = await app.inject({ url: `/api/public/recipes/${slug}` });
  assert.equal(JSON.parse(pub.body).title, 'Tacos');

  const { body: tok } = await call(a, 'POST', `${base}/tokens`, { name: 'Home Assistant' });
  const ha = await call({ authorization: `Bearer ${tok.token}` }, 'GET', `${base}/ha/summary`);
  assert.equal(ha.status, 200);
  assert.equal(ha.body.tonight, 'Tacos');
  assert.equal(ha.body.shopping_count, 1);
  assert.equal((await call({ authorization: `Bearer ${tok.token}` }, 'DELETE', base)).status, 403);
});

test('KitchenOwl export file import', async () => {
  const { login, call } = await setup();
  const a = await login('Mover');
  const { body: home } = await call(a, 'POST', '/api/homes', { name: 'Home' });
  const base = `/api/homes/${home.id}`;
  const data = {
    name: 'Old house',
    shoppinglists: ['Default'],
    items: [{ name: 'Milk', category: 'Dairy' }, { name: 'Apples', icon: 'apple' }],
    recipes: [{ name: 'Chili', description: '1. Brown\n2. Simmer', yields: 4, time: 60, photo: 'abc.jpg', items: [{ name: 'beef', description: '1 lb', optional: false }], tags: ['dinner'] }],
  };
  const res = await call(a, 'POST', `${base}/import/kitchenowl/file`, { data });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.recipes, 1);
  assert.equal(res.body.items, 2);
  const again = await call(a, 'POST', `${base}/import/kitchenowl/file`, { data: JSON.stringify(data) });
  assert.equal(again.body.recipesSkipped, 1);
  const recipes = (await call(a, 'GET', `${base}/recipes`)).body;
  assert.equal(recipes[0].title, 'Chili');
});

test('pairing a device signs it in once', async () => {
  const { login, call, app } = await setup();
  const a = await login('Pairer');
  const { body } = await call(a, 'POST', '/api/auth/pair-code', {});
  const res = await app.inject({ method: 'POST', url: '/api/auth/pair', payload: { code: body.code.toLowerCase() } });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.cookies.find((c) => c.name === 'nn_session')!;
  assert.equal(cookie.secure, undefined, 'plain-http requests must get a cookie the browser will keep');
  const me = await call({ cookie: `nn_session=${cookie.value}` }, 'GET', '/api/me');
  assert.equal(me.body.user.name, 'Pairer');
  const again = await app.inject({ method: 'POST', url: '/api/auth/pair', payload: { code: body.code } });
  assert.equal(again.statusCode, 400);
});
