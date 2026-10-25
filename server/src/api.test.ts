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

test('ingredients can be matched to a pantry item by hand', async () => {
  const { login, call } = await setup();
  const a = await login('Matcher');
  const { body: home } = await call(a, 'POST', '/api/homes', { name: 'Home' });
  const base = `/api/homes/${home.id}`;
  const { body: item } = await call(a, 'POST', `${base}/items`, { name: 'Tillamook Medium', quantity: 1 });
  const { body: rec } = await call(a, 'POST', `${base}/recipes`, { title: 'Mac', ingredients: [{ name: 'cheddar', quantity: null, unit: null }] });
  let r = await call(a, 'GET', `${base}/recipes/${rec.id}`);
  assert.equal(r.body.ingredients[0].availability, 'missing');
  await call(a, 'PUT', `${base}/ingredient-links`, { ingredient: 'Cheddar', itemId: item.id });
  r = await call(a, 'GET', `${base}/recipes/${rec.id}`);
  assert.equal(r.body.ingredients[0].availability, 'have');
  assert.equal(r.body.ingredients[0].linked, true);
  assert.deepEqual(r.body.ingredients[0].matched, ['Tillamook Medium']);
  const cooked = await call(a, 'POST', `${base}/recipes/${rec.id}/cook`, {});
  assert.equal(cooked.body.used[0].name, 'Tillamook Medium');
  await call(a, 'PUT', `${base}/ingredient-links`, { ingredient: 'cheddar', itemId: null });
  r = await call(a, 'GET', `${base}/recipes/${rec.id}`);
  assert.equal(r.body.ingredients[0].linked, false);
});

test('custom places and categories, and the running-low marker', async () => {
  const { login, call } = await setup();
  const a = await login('Organizer');
  const { body: home } = await call(a, 'POST', '/api/homes', { name: 'Home' });
  const base = `/api/homes/${home.id}`;
  let detail = (await call(a, 'GET', base)).body;
  assert.ok(detail.settings.locations.includes('Pantry'));
  const { body: item } = await call(a, 'POST', `${base}/items`, { name: 'Ice', location: 'Garage Freezer', quantity: 2 });
  detail = (await call(a, 'GET', base)).body;
  assert.ok(detail.settings.locations.includes('Garage Freezer'), 'typed places are remembered');
  await call(a, 'PUT', `${base}/labels`, { rename: { kind: 'locations', from: 'Garage Freezer', to: 'Chest Freezer' } });
  let items = (await call(a, 'GET', `${base}/items`)).body;
  assert.equal(items[0].location, 'Chest Freezer');
  assert.equal((await call(a, 'PUT', `${base}/labels`, { categories: [] })).status, 400);
  await call(a, 'PUT', `${base}/labels`, { categories: ['Snacks', 'Frozen'] });
  assert.deepEqual((await call(a, 'GET', base)).body.settings.categories, ['Snacks', 'Frozen']);

  await call(a, 'PATCH', `${base}/items/${item.id}`, { markedLow: true });
  items = (await call(a, 'GET', `${base}/items?low=true`)).body;
  assert.equal(items.length, 1);
  assert.equal(items[0].isLow, true);
  assert.equal((await call(a, 'GET', `${base}/ha/summary`)).body.low_stock_count, 1);
  await call(a, 'POST', `${base}/items/${item.id}/adjust`, { delta: 3 });
  items = (await call(a, 'GET', `${base}/items`)).body;
  assert.equal(items[0].markedLow, false, 'restocking clears the mark');
});

test('only home managers can add or change places and categories', async () => {
  const { login, call } = await setup();
  const boss = await login('Boss');
  const kid = await login('Kid');
  const { body: home } = await call(boss, 'POST', '/api/homes', { name: 'Home' });
  const base = `/api/homes/${home.id}`;
  await call(kid, 'POST', '/api/homes/join', { code: (await call(boss, 'GET', base)).body.joinCode });
  assert.equal((await call(kid, 'PUT', `${base}/labels`, { locations: ['Fridge'] })).status, 403);
  assert.equal((await call(kid, 'POST', `${base}/items`, { name: 'Soda', location: 'Secret Stash' })).status, 403);
  const ok = await call(kid, 'POST', `${base}/items`, { name: 'Soda', location: 'Fridge' });
  assert.equal(ok.status, 200);
  await call(boss, 'PUT', `${base}/labels`, { locations: ['Pantry', 'Garage'] });
  // The kid can still edit Soda even though "Fridge" was removed from the list.
  assert.equal((await call(kid, 'PATCH', `${base}/items/${ok.body.id}`, { name: 'Cola', location: 'Fridge' })).status, 200);
  assert.equal((await call(boss, 'POST', `${base}/items`, { name: 'Ice', location: 'Chest Freezer' })).status, 200);
  assert.ok((await call(boss, 'GET', base)).body.settings.locations.includes('Chest Freezer'));
});

test('mixologist: bar snapshot, saving drinks, and no key', async () => {
  const { login, call } = await setup();
  const a = await login('Bartender');
  const { body: home } = await call(a, 'POST', '/api/homes', { name: 'Tiki Bar' });
  const base = `/api/homes/${home.id}`;
  const rum = await call(a, 'POST', `${base}/items`, { name: 'Cruzan coconut rum', quantity: 1, unit: 'bottle' });
  assert.equal(rum.body.category, 'Bar');
  await call(a, 'POST', `${base}/items`, { name: 'Pineapple juice', quantity: 46, unit: 'fl oz' });
  await call(a, 'POST', `${base}/items`, { name: 'Old limes', quantity: 0 });

  const status = await call(a, 'GET', '/api/mixologist/status');
  assert.equal(status.body.available, false);
  const chat = await call(a, 'POST', `${base}/mixologist/chat`, { messages: [{ role: 'user', content: 'Make me something' }] });
  assert.equal(chat.status, 503);

  const saved = await call(a, 'POST', `${base}/mixologist/save`, {
    drink: {
      title: 'Blue Island Punch', description: 'Bright and tropical.', glass: 'Highball', garnish: 'Pineapple wedge', style: 'Tropical',
      ingredients: [
        { name: 'Cruzan coconut rum', quantity: 1.5, unit: 'oz', note: null, optional: false },
        { name: 'Pineapple juice', quantity: 2, unit: 'oz', note: null, optional: false },
        { name: 'Sprite', quantity: null, unit: null, note: 'top with', optional: false },
      ],
      instructions: ['Shake rum and juice with ice.', 'Strain into a tall glass and top with Sprite.'],
    },
  });
  const r = await call(a, 'GET', `${base}/recipes/${saved.body.id}`);
  assert.deepEqual(r.body.tags, ['cocktail', 'tropical']);
  assert.equal(r.body.ingredients[0].unit, 'fl oz', 'bar ounces are fluid ounces');
  assert.equal(r.body.ingredients[1].availability, 'have');
  assert.deepEqual(r.body.missing, ['Sprite']);
});

test('mixologist sees the bar first and skips empty stock', async () => {
  const db = openMemoryDb();
  const { createHome } = await import('./routes/homes.ts');
  const { stockForPrompt } = await import('./routes/mixologist.ts');
  db.prepare("INSERT INTO users (id, name) VALUES ('u1', 'Sam')").run();
  const homeId = createHome(db, 'u1', 'Den');
  const add = db.prepare('INSERT INTO items (id, home_id, name, category, location, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?)');
  add.run('i1', homeId, 'Blue Curaçao', 'Bar', 'Pantry', 1, 'bottle');
  add.run('i2', homeId, 'Limes', 'Produce', 'Fridge', 4, null);
  add.run('i3', homeId, 'Grenadine', 'Bar', 'Bar', 0, 'bottle');
  const text = stockForPrompt(db, homeId);
  assert.ok(text.indexOf('Blue Curaçao (1 bottle)') < text.indexOf('Limes (4)'));
  assert.ok(!text.includes('Grenadine'));
});

test('admins pick the Mixologist model', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const { config } = await import('./config.ts');
  const saved = config.anthropic;
  config.anthropic = { apiKey: 'test-key', model: 'claude-opus-5-5' };
  try {
    const { login, call } = await setup();
    const admin = await login('Admin');
    const guest = await login('Guest');
    assert.equal((await call(guest, 'GET', '/api/admin/mixologist')).status, 403);
    assert.equal((await call(admin, 'GET', '/api/admin/mixologist')).body.model, 'claude-opus-5-5');
    assert.equal((await call(admin, 'PATCH', '/api/admin/mixologist', { model: 'gpt-4' })).status, 400);
    assert.equal((await call(admin, 'PATCH', '/api/admin/mixologist', { model: 'claude-sonnet-5-5' })).body.model, 'claude-sonnet-5-5');
    assert.equal((await call(admin, 'GET', '/api/mixologist/status')).body.model, 'claude-sonnet-5-5');
    assert.equal((await call(admin, 'PATCH', '/api/admin/mixologist', { model: 'claude-opus-5-5' })).body.model, 'claude-opus-5-5');
  } finally {
    config.anthropic = saved;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('mixologist retries without the refusal fallback, and reports Claude errors in the body', async () => {
  const { config } = await import('./config.ts');
  const saved = config.anthropic;
  const realFetch = globalThis.fetch;
  config.anthropic = { apiKey: 'test-key', model: 'claude-opus-5-5' };
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const reply = (text: string) => new Response(
    ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } })
    + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
    + ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }) + ev('message_stop', {}),
    { headers: { 'content-type': 'text/event-stream' } });
  const refuse = (message: string) => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }), { status: 400, headers: { 'content-type': 'application/json' } });
  let mode: 'no-fallback' | 'broken' = 'no-fallback';
  const sent: unknown[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes('anthropic.com')) return realFetch(url, init);
    const body = JSON.parse(String(init?.body));
    sent.push(body.fallbacks ?? null);
    if (mode === 'broken') return refuse('something is off');
    return body.fallbacks ? refuse('fallbacks: not available for this account') : reply('Try a **Mai Tai**.');
  }) as typeof fetch;
  try {
    const { app, login, call } = await setup();
    const a = await login('Sipper');
    const { body: home } = await call(a, 'POST', '/api/homes', { name: 'Bar' });
    const ok = await call(a, 'POST', `/api/homes/${home.id}/mixologist/chat`, { messages: [{ role: 'user', content: 'Something tropical' }] });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.reply, 'Try a **Mai Tai**.');
    assert.deepEqual(sent, ['default', null]);

    mode = 'broken';
    const res = await app.inject({ method: 'POST', url: `/api/homes/${home.id}/mixologist/ideas`, payload: { style: 'Tropical' }, headers: a });
    assert.equal(res.headers['x-nn-deferred'], '1');
    const err = JSON.parse(res.body);
    assert.equal(err.status, 502);
    assert.match(err.error, /something is off/);
  } finally {
    globalThis.fetch = realFetch;
    config.anthropic = saved;
  }
});
