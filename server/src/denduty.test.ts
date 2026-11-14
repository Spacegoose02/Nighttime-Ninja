// The Den Duty link ("Ask Sam to help") and recipes another app sends over that must never be shared publicly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-denduty-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { clearRateLimit } = await import('./security.ts');
const { setDenDutyFetch, choreTitle } = await import('./routes/denduty.ts');

async function setup() {
  clearRateLimit('local:ip:127.0.0.1');
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });
  const login = async (name: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name } });
    assert.equal(res.statusCode, 200, res.body);
    return { cookie: `nn_session=${res.cookies.find((c) => c.name === 'nn_session')!.value}` };
  };
  const call = async (headers: Record<string, string>, method: string, url: string, payload?: unknown) => {
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return { db, login, call };
}

/** A pretend Den Duty: one home, two kids, a control token and a read token. */
function fakeDenDuty() {
  const chores: { auth: string; body: Record<string, unknown> }[] = [];
  let up = true;
  setDenDutyFetch(async (input, init) => {
    if (!up) throw new TypeError('fetch failed');
    const url = new URL(String(input));
    const auth = String((init?.headers as Record<string, string>)?.authorization ?? '');
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (!url.pathname.startsWith('/api/v1/homes/den-1')) return json(403, { error: 'Token is for a different home' });
    if (auth !== 'Bearer dnk_control' && auth !== 'Bearer dnk_read') return json(401, { error: 'Please sign in' });
    const rest = url.pathname.slice('/api/v1/homes/den-1'.length);
    if (rest === '' && init?.method === 'GET') return json(200, { name: 'The Den', timezone: 'America/Chicago' });
    if (rest === '/kids') return json(200, [{ id: 'kid-sam', name: 'Sam', avatar: 'fox', color: '#f00', age: 9 }, { id: 'kid-ivy', name: 'Ivy', age: null }]);
    if (rest === '/chores' && init?.method === 'POST') {
      if (auth !== 'Bearer dnk_control') return json(403, { error: 'This token can only read' });
      const body = JSON.parse(String(init.body));
      chores.push({ auth, body });
      return json(200, { id: `chore-${chores.length}`, title: body.title });
    }
    return json(404, { error: 'Not found' });
  });
  return { chores, setUp: (v: boolean) => { up = v; } };
}

test('linking Den Duty: managers only, checked with Den Duty, token kept sealed', async () => {
  const { db, login, call } = await setup();
  const den = fakeDenDuty();
  const mom = await login('Mom');
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Kitchen' });
  const base = `/api/homes/${home.id}`;
  const kid = await login('Teen');
  const { body: detail } = await call(mom, 'GET', base);
  await call(kid, 'POST', '/api/homes/join', { code: detail.joinCode });

  assert.deepEqual((await call(mom, 'GET', `${base}/denduty`)).body, { linked: false, url: '', denHomeId: '', denHomeName: null, points: 5 });
  assert.deepEqual((await call(mom, 'GET', `${base}/denduty/kids`)).body, [], 'no kids before linking');
  assert.equal((await call(kid, 'PUT', `${base}/denduty`, { url: 'http://den.lan', denHomeId: 'den-1', token: 'dnk_control' })).status, 403, 'members cannot link');
  assert.equal((await call(mom, 'PUT', `${base}/denduty`, { url: 'den.lan', denHomeId: 'den-1', token: 'dnk_control' })).status, 400);
  const bad = await call(mom, 'PUT', `${base}/denduty`, { url: 'http://den.lan', denHomeId: 'den-1', token: 'dnk_wrong' });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /didn't take the API token/);
  assert.equal((await call(mom, 'PUT', `${base}/denduty`, { url: 'http://den.lan', denHomeId: 'den-2', token: 'dnk_control' })).status, 502, 'wrong home id');
  den.setUp(false);
  assert.match((await call(mom, 'PUT', `${base}/denduty`, { url: 'http://den.lan', denHomeId: 'den-1', token: 'dnk_control' })).body.error, /Couldn't reach Den Duty/);
  den.setUp(true);

  const ok = await call(mom, 'PUT', `${base}/denduty`, { url: 'http://den.lan:8080/some/page/', denHomeId: 'den-1', token: 'dnk_control', points: 3 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { linked: true, url: 'http://den.lan:8080', denHomeId: 'den-1', denHomeName: 'The Den', points: 3 });
  const stored = db.prepare('SELECT token FROM denduty_links WHERE home_id = ?').get(home.id) as { token: string };
  assert.ok(!stored.token.includes('dnk_control'), 'the token is not stored in plain text');
  const seen = await call(kid, 'GET', `${base}/denduty`);
  assert.equal(seen.body.linked, true);
  assert.equal(JSON.stringify(seen.body).includes('dnk_'), false, 'the token never goes back to the browser');
  // Saving again without a token keeps the saved one.
  assert.equal((await call(mom, 'PUT', `${base}/denduty`, { url: 'http://den.lan:8080', denHomeId: 'den-1', points: 4 })).body.points, 4);
  // Unlinking forgets it all.
  assert.equal((await call(mom, 'PUT', `${base}/denduty`, { url: '' })).body.linked, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM denduty_links').get()!.n, 0);
});

test('"Ask a kid to help" makes a one-off Den Duty chore', async () => {
  const { db, login, call } = await setup();
  const den = fakeDenDuty();
  const mom = await login('Mom');
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Kitchen' });
  const base = `/api/homes/${home.id}`;
  const recipe = await call(mom, 'POST', `${base}/recipes`, { title: 'Tacos', ingredients: [{ name: 'tomatoes' }], instructions: ['Chop.'] });

  assert.equal((await call(mom, 'POST', `${base}/denduty/chores`, { kidId: 'kid-sam', task: 'Wash the tomatoes' })).status, 400, 'link first');
  await call(mom, 'PUT', `${base}/denduty`, { url: 'http://den.lan', denHomeId: 'den-1', token: 'dnk_control', points: 3 });

  const kids = await call(mom, 'GET', `${base}/denduty/kids`);
  assert.deepEqual(kids.body.map((k: { name: string }) => k.name), ['Sam', 'Ivy']);
  assert.equal(kids.body[0].age, 9);

  const asked = await call(mom, 'POST', `${base}/denduty/chores`, { kidId: 'kid-sam', task: 'Wash the tomatoes in a bowl of water', recipeId: recipe.body.id, dueDate: '2026-11-14', dueTime: '17:30' });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.deepEqual(asked.body, { ok: true, choreId: 'chore-1', title: 'Tacos: Wash the tomatoes in a bowl of water', kidName: 'Sam', points: 3 });
  assert.deepEqual(den.chores[0].body, {
    title: 'Tacos: Wash the tomatoes in a bowl of water', icon: '🍳', memberIds: ['kid-sam'], points: 3,
    schedule: 'once', dueDate: '2026-11-14', dueTime: '17:30',
  });
  // Points can be picked per ask; no date means today.
  await call(mom, 'POST', `${base}/denduty/chores`, { kidId: 'kid-ivy', task: 'Set the table and put out napkins', points: 10 });
  assert.equal(den.chores[1].body.points, 10);
  assert.match(String(den.chores[1].body.dueDate), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(den.chores[1].body.dueTime, undefined);
  assert.equal(den.chores[1].body.title, 'Set the table and put out napkins');

  assert.equal((await call(mom, 'POST', `${base}/denduty/chores`, { kidId: 'kid-sam', task: 'x', dueDate: 'tomorrow' })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/denduty/chores`, { kidId: 'kid-sam', task: 'x', recipeId: 'nope' })).status, 404);
  assert.equal((await call(mom, 'POST', `${base}/denduty/chores`, { task: 'x' })).status, 400);

  // A Home Assistant token can't hand out chores.
  const tok = await call(mom, 'POST', `${base}/tokens`, { name: 'HA' });
  assert.equal((await call({ authorization: `Bearer ${tok.body.token}` }, 'POST', `${base}/denduty/chores`, { kidId: 'kid-sam', task: 'x' })).status, 403);

  // A read-only Den Duty token links but can't make chores, and says why.
  db.prepare('DELETE FROM denduty_links').run();
  await call(mom, 'PUT', `${base}/denduty`, { url: 'http://den.lan', denHomeId: 'den-1', token: 'dnk_read' });
  const ro = await call(mom, 'POST', `${base}/denduty/chores`, { kidId: 'kid-sam', task: 'x' });
  assert.equal(ro.status, 502);
  assert.match(ro.body.error, /read-only/);
});

test('chore titles fit Den Duty (80 characters)', () => {
  assert.equal(choreTitle('Stir', 'Soup'), 'Soup: Stir');
  const long = 'Put it in and take it out of the oven, with oven gloves and a grown-up';
  assert.equal(choreTitle(long, 'Grandma’s famous extra cheesy lasagna'), long, 'drops the recipe name when both do not fit');
  assert.equal(choreTitle('x'.repeat(100), null).length, 80);
});

test('noPublicShare: recipes sent that way can never get a public link', async () => {
  const { login, call } = await setup();
  const mom = await login('Mom');
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Kitchen' });
  const base = `/api/homes/${home.id}`;
  const text = 'Pancakes\nServes 4\nIngredients\n1 cup flour\n2 eggs\nInstructions\nMix.\nCook.';

  // Through import with save.
  const imported = await call(mom, 'POST', `${base}/recipes/import`, { save: true, text, noPublicShare: true });
  const locked = imported.body.ids[0];
  // Parse-only import still just parses (BookBandit parses first, then saves with POST /recipes).
  const parsed = await call(mom, 'POST', `${base}/recipes/import`, { text, noPublicShare: true });
  assert.equal(parsed.body.recipes[0].title, 'Pancakes');
  // Through a full recipe, like BookBandit's Send to kitchen.
  const sent = await call(mom, 'POST', `${base}/recipes`, {
    ...parsed.body.recipes[0], title: 'Pancakes (from The Breakfast Book)', sourceUrl: 'https://books.example.com/cook/abc', tags: ['bookbandit'], noPublicShare: true,
  });
  const plain = await call(mom, 'POST', `${base}/recipes`, { ...parsed.body.recipes[0], noPublicShare: 'yes' });

  for (const id of [locked, sent.body.id]) {
    const r = await call(mom, 'GET', `${base}/recipes/${id}`);
    assert.equal(r.body.noPublicShare, true);
    const share = await call(mom, 'POST', `${base}/recipes/${id}/share`, { public: true });
    assert.equal(share.status, 403);
    assert.match(share.body.error, /can't be shared publicly/);
    assert.equal((await call(mom, 'POST', `${base}/recipes/${id}/share`, { public: false })).status, 200, 'turning sharing off is always fine');
    // Editing it keeps the flag, and so does making a variation of it.
    await call(mom, 'PUT', `${base}/recipes/${id}`, { ...r.body, title: 'Changed' });
    assert.equal((await call(mom, 'GET', `${base}/recipes/${id}`)).body.noPublicShare, true);
    const v = await call(mom, 'POST', `${base}/recipes/${id}/variation`, {});
    assert.equal((await call(mom, 'GET', `${base}/recipes/${v.body.id}`)).body.noPublicShare, true);
    assert.equal((await call(mom, 'POST', `${base}/recipes/${v.body.id}/share`, {})).status, 403);
  }
  assert.equal(sent.body && (await call(mom, 'GET', `${base}/recipes/${sent.body.id}`)).body.sourceUrl, 'https://books.example.com/cook/abc');
  // Anything other than true leaves a recipe shareable as before.
  assert.equal((await call(mom, 'GET', `${base}/recipes/${plain.body.id}`)).body.noPublicShare, false);
  const shared = await call(mom, 'POST', `${base}/recipes/${plain.body.id}/share`, {});
  assert.equal(shared.status, 200);
  const pub = await call({}, 'GET', '/api/public/recipes');
  assert.deepEqual(pub.body.map((r: { slug: string }) => `/r/${r.slug}`), [shared.body.shareUrl], 'only the ordinary recipe is public');
});
