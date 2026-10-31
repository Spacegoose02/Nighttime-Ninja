import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// A stand-in push service: records what it's sent and answers with the status the test asks for.
const got: { path: string; headers: http.IncomingHttpHeaders; bytes: number }[] = [];
let status = 201;
const fake = http.createServer((req, res) => {
  let bytes = 0;
  req.on('data', (c: Buffer) => { bytes += c.length; });
  req.on('end', () => { got.push({ path: req.url ?? '', headers: req.headers, bytes }); res.writeHead(status).end(); });
});
await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
const endpoint = (name: string) => `http://127.0.0.1:${(fake.address() as { port: number }).port}/${name}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-push-test-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';
process.env.ALLOW_PRIVATE_FETCH = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { createUser } = await import('./auth.ts');
const { dueReminders, listAdded, sendDue } = await import('./push.ts');

test.after(() => fake.close());

// What a browser hands over when it subscribes: its public key and a shared secret.
const browserKeys = () => ({
  p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'),
  auth: crypto.randomBytes(16).toString('base64url'),
});

async function setup() {
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });
  const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name: 'Cook' } });
  const headers = { cookie: `nn_session=${res.cookies.find((c) => c.name === 'nn_session')!.value}` };
  const call = async (method: string, url: string, payload?: unknown) => {
    const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers });
    return { status: r.statusCode, body: r.body.trim() ? JSON.parse(r.body) : null };
  };
  const home = (await call('POST', '/api/homes', { name: 'Push Kitchen' })).body;
  const me = (await call('GET', '/api/me')).body.user.id as string;
  // Subscriptions normally need https; these point at the local fake, so they go straight in.
  const addDevice = (userId: string, name: string) => {
    const k = browserKeys();
    db.prepare('INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)').run(endpoint(name), userId, k.p256dh, k.auth);
  };
  return { db, call, base: `/api/homes/${home.id}`, homeId: home.id as string, me, addDevice };
}

test('signing a device up for reminders, and choosing which ones', async () => {
  const { call } = await setup();
  const first = (await call('GET', '/api/push')).body;
  assert.match(first.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.deepEqual(first.prefs, { expiring: true, plan: true, list: true });
  assert.equal(first.devices, 0);
  assert.equal((await call('POST', '/api/push/subscribe', { endpoint: 'http://example.com/x', ...browserKeys() })).status, 400);
  assert.equal((await call('POST', '/api/push/subscribe', { endpoint: 'https://push.example.com/abc', ...browserKeys() })).status, 200);
  const again = (await call('GET', '/api/push')).body;
  assert.equal(again.devices, 1);
  assert.equal(again.publicKey, first.publicKey, 'the server keeps its keys');
  assert.deepEqual((await call('PUT', '/api/push/prefs', { list: false })).body, { expiring: true, plan: true, list: false });
  await call('POST', '/api/push/unsubscribe', { endpoint: 'https://push.example.com/abc' });
  assert.equal((await call('GET', '/api/push')).body.devices, 0);
});

test('morning and evening reminders, each sent once', async () => {
  const { db, call, base, me, addDevice } = await setup();
  await call('POST', `${base}/items`, { name: 'Spinach', quantity: 1, expiresOn: '2030-01-11' });
  await call('POST', `${base}/items`, { name: 'Rice', quantity: 1, expiresOn: '2031-01-01' });
  await call('POST', `${base}/mealplan`, { date: '2030-01-11', title: 'Tacos', cookId: me });
  assert.deepEqual(dueReminders(db, new Date(2030, 0, 10, 18)), [], 'nobody has a device yet');
  addDevice(me, 'phone');

  assert.deepEqual(dueReminders(db, new Date(2030, 0, 10, 7)), [], 'too early for anything');
  const morning = dueReminders(db, new Date(2030, 0, 10, 10));
  assert.equal(morning.length, 1);
  assert.match(morning[0].reminder.body, /^Spinach goes off/);
  const evening = dueReminders(db, new Date(2030, 0, 10, 18)).map((d) => d.reminder);
  assert.equal(evening.length, 2);
  assert.equal(evening[1].title, 'Tomorrow');
  assert.match(evening[1].body, /dinner: Tacos \(Cook cooking\)/);

  got.length = 0;
  assert.equal(await sendDue(db, new Date(2030, 0, 10, 18)), 2);
  assert.equal(got.length, 2);
  assert.equal(got[0].path, '/phone');
  assert.equal(got[0].headers['content-encoding'], 'aes128gcm', 'the message is encrypted for the device');
  assert.match(String(got[0].headers.authorization), /^vapid t=/);
  assert.ok(got[0].bytes > 0);
  assert.equal(await sendDue(db, new Date(2030, 0, 10, 19)), 0, 'not again the same day');

  // A device the push service says is gone is forgotten.
  status = 410;
  await call('POST', `${base}/mealplan`, { date: '2030-01-12', title: 'Soup' });
  await sendDue(db, new Date(2030, 0, 11, 18));
  status = 201;
  assert.equal((await call('GET', '/api/push')).body.devices, 0);
});

test('tells the rest of the home what was added to the list, not too often', async () => {
  const { db, call, base, homeId, me, addDevice } = await setup();
  const other = createUser(db, { name: 'Sam' });
  db.prepare("INSERT INTO home_members (home_id, user_id, role) VALUES (?, ?, 'member')").run(homeId, other.id);
  addDevice(other.id, 'sam');
  addDevice(me, 'me');
  got.length = 0;
  await call('POST', `${base}/shopping`, { text: 'milk, eggs' });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(got.map((g) => g.path), ['/sam'], 'only the others hear about it');
  await listAdded(db, homeId, me, ['bread']);
  assert.equal(got.length, 1, 'a second add right after stays quiet');
  db.prepare("UPDATE users SET reminders = '{\"list\":false}' WHERE id = ?").run(other.id);
  db.prepare('DELETE FROM reminders_sent').run();
  await listAdded(db, homeId, me, ['bread']);
  assert.equal(got.length, 1, 'turned off');
});
