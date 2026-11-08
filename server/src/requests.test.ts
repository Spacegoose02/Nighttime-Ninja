import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-test-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { clearRateLimit } = await import('./security.ts');

test('requests: another app asks with a token, a grown-up says yes onto a list or no', async () => {
  clearRateLimit('local:ip:127.0.0.1');
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name: 'Mom' } });
  const mom = { cookie: `nn_session=${res.cookies.find((c) => c.name === 'nn_session')!.value}` };
  const call = async (headers: Record<string, string>, method: string, url: string, payload?: unknown) => {
    const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Den' });
  const base = `/api/homes/${home.id}`;
  const weekly = (await call(mom, 'POST', `${base}/shopping/lists`, { name: 'Weekly' })).body;
  const { body: tok } = await call(mom, 'POST', `${base}/tokens`, { name: 'Den Duty' });
  const dd = { authorization: `Bearer ${tok.token}` };

  // The token says which home it's for.
  assert.deepEqual((await call(dd, 'GET', '/api/token/home')).body, { homeId: home.id, name: 'Den' });
  assert.equal((await call(mom, 'GET', '/api/token/home')).status, 401);

  // Den Duty sends Ava's cereal; sending it again is harmless.
  const ask = { name: 'Cereal', requestedBy: 'Ava', source: 'den-duty', externalId: 'item-1' };
  const cereal = (await call(dd, 'POST', `${base}/shopping/requests`, ask)).body;
  assert.equal(cereal.status, 'waiting');
  assert.equal((await call(dd, 'POST', `${base}/shopping/requests`, ask)).body.id, cereal.id);
  const chips = (await call(dd, 'POST', `${base}/shopping/requests`, { name: 'Chips', requestedBy: 'Ben', source: 'den-duty', externalId: 'item-2' })).body;
  const gum = (await call(dd, 'POST', `${base}/shopping/requests`, { name: 'Gum', requestedBy: 'Ben', source: 'den-duty', externalId: 'item-3' })).body;
  assert.deepEqual((await call(mom, 'GET', `${base}/shopping/requests`)).body.map((r: { name: string }) => r.name), ['Cereal', 'Chips', 'Gum']);

  // The app can't answer its own asks.
  assert.equal((await call(dd, 'POST', `${base}/shopping/requests/${cereal.id}/approve`, {})).status, 403);

  // Yes to cereal on Weekly, no to chips.
  const yes = (await call(mom, 'POST', `${base}/shopping/requests/${cereal.id}/approve`, { listId: weekly.id })).body;
  assert.equal(yes.status, 'approved');
  assert.equal(yes.listName, 'Weekly');
  const onWeekly = (await call(mom, 'GET', `${base}/shopping?list=${weekly.id}`)).body;
  assert.deepEqual(onWeekly.map((i: { name: string; note: string }) => `${i.name}:${i.note}`), ['Cereal:Asked for by Ava']);
  assert.equal((await call(mom, 'POST', `${base}/shopping/requests/${cereal.id}/decline`, {})).status, 409);
  assert.equal((await call(mom, 'POST', `${base}/shopping/requests/${chips.id}/decline`, {})).body.status, 'declined');

  // Ben takes gum back off his list before anyone answers.
  assert.equal((await call(dd, 'POST', `${base}/shopping/requests/withdraw`, { source: 'den-duty', externalId: 'item-3' })).body.withdrawn, true);
  assert.equal((await call(mom, 'POST', `${base}/shopping/requests/${gum.id}/approve`, {})).status, 404);

  // Den Duty reads the answers back by its own ids.
  const answers = (await call(dd, 'GET', `${base}/shopping/requests?source=den-duty&ids=item-1,item-2,item-3`)).body;
  assert.deepEqual(answers.map((r: { externalId: string; status: string; listName: string | null }) => `${r.externalId}:${r.status}:${r.listName}`).sort(),
    ['item-1:approved:Weekly', 'item-2:declined:null']);
  assert.equal((await call(mom, 'GET', `${base}/shopping/requests`)).body.length, 0);
  assert.equal((await call(mom, 'GET', `${base}/shopping/requests?status=all`)).body.length, 2);

  // Picks: what the home buys most, minus the grown-up aisles.
  await call(mom, 'POST', `${base}/shopping`, { text: 'Apples, Beer' });
  for (const i of (await call(mom, 'GET', `${base}/shopping`)).body) await call(mom, 'PATCH', `${base}/shopping/${i.id}`, { checked: true, addToInventory: false });
  const picks = (await call(dd, 'GET', `${base}/shopping/requests/picks`)).body;
  assert.deepEqual(picks.map((p: { name: string }) => p.name), ['Apples']);
  assert.equal(picks[0].icon, '🍎');
});
