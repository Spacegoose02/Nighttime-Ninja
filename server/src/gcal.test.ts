import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-test-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { config } = await import('./config.ts');
const { localDate } = await import('./util.ts');
const gcal = await import('./gcal.ts');

type Ev = Record<string, unknown> & { id: string; etag: string; seq: number; status?: string };

/** Just enough of Google's token endpoint and Calendar API, kept in memory. */
function fakeGoogle() {
  const events = new Map<string, Ev>();
  const calls: string[] = [];
  let seq = 0;
  let n = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const touch = (e: Ev) => { e.seq = ++seq; e.etag = `"${seq}"`; return e; };
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const u = new URL(url);
    calls.push(`${method} ${u.pathname}`);
    if (u.pathname === '/token') {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get('client_id'), 'test-client');
      if (form.get('grant_type') === 'authorization_code') {
        assert.equal(form.get('code'), 'the-code');
        assert.ok(form.get('code_verifier'));
        return json({ access_token: 'at-1', refresh_token: 'rt-secret', expires_in: 3600 });
      }
      assert.equal(form.get('refresh_token'), 'rt-secret');
      return json({ access_token: 'at-2', expires_in: 3600 });
    }
    if (u.pathname === '/revoke') return new Response('', { status: 200 });
    assert.match(String((init?.headers as Record<string, string>)?.authorization), /^Bearer at-/);
    if (u.pathname === '/calendar/v3/calendars' && method === 'POST') return json({ id: 'cal-1', ...JSON.parse(String(init?.body)) });
    const m = /^\/calendar\/v3\/calendars\/cal-1\/events(?:\/(.+))?$/.exec(u.pathname);
    assert.ok(m, `unexpected ${method} ${u.pathname}`);
    const id = m[1] && decodeURIComponent(m[1]);
    if (method === 'GET') {
      const token = u.searchParams.get('syncToken');
      const after = token ? Number(token.slice(1)) : 0;
      const items = [...events.values()].filter((e) => e.seq > after && (token || e.status !== 'cancelled'));
      return json({ items, nextSyncToken: `s${seq}` });
    }
    if (method === 'POST') {
      const e = touch({ ...JSON.parse(String(init?.body)), id: `ev-${++n}`, status: 'confirmed' } as Ev);
      events.set(e.id, e);
      return json(e);
    }
    const e = events.get(id!);
    if (!e || e.status === 'cancelled') return json({ error: { message: 'Not Found' } }, 404);
    if (method === 'PATCH') { Object.assign(e, JSON.parse(String(init?.body))); return json(touch(e)); }
    if (method === 'DELETE') { touch(e).status = 'cancelled'; return new Response(null, { status: 204 }); }
    throw new Error(`unexpected ${method}`);
  };
  /** Changes made by someone in Google Calendar. */
  const edit = (id: string, change: Record<string, unknown>) => { Object.assign(events.get(id)!, change); touch(events.get(id)!); };
  const add = (e: Record<string, unknown>) => { const ev = touch({ ...e, id: `ev-${++n}`, status: 'confirmed' } as Ev); events.set(ev.id, ev); return ev; };
  const live = () => [...events.values()].filter((e) => e.status !== 'cancelled');
  return { fetch, events, calls, edit, add, live };
}

test('slots from the time of day', () => {
  assert.equal(gcal.slotFor(7), 'breakfast');
  assert.equal(gcal.slotFor(12), 'lunch');
  assert.equal(gcal.slotFor(15), 'snack');
  assert.equal(gcal.slotFor(19), 'dinner');
  assert.equal(gcal.unseal(gcal.seal('hello')), 'hello');
  assert.notEqual(gcal.seal('hello'), gcal.seal('hello'));
});

test('Google Calendar: connect, sync both ways, disconnect', async () => {
  const google = fakeGoogle();
  gcal.useGoogleForTests(google.fetch);
  const saved = config.google;
  config.google = { clientId: 'test-client', clientSecret: 'test-secret' };
  try {
    const db = openMemoryDb();
    const app = await buildApp(db, { serveWeb: false });
    const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name: 'Planner' } });
    const cookie = `nn_session=${res.cookies.find((c) => c.name === 'nn_session')!.value}`;
    const call = async (method: string, url: string, payload?: unknown) => {
      const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { cookie } });
      return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
    };
    const { body: home } = await call('POST', '/api/homes', { name: 'Den' });
    const base = `/api/homes/${home.id}`;
    const day = localDate(1);
    const { body: tacos } = await call('POST', `${base}/mealplan`, { date: day, slot: 'dinner', title: 'Tacos' });

    let status = await call('GET', `${base}/gcal`);
    assert.deepEqual([status.body.available, status.body.connected], [true, false]);

    // Connecting goes to Google and back.
    const go = await app.inject({ method: 'GET', url: `${base}/gcal/connect`, headers: { cookie } });
    assert.equal(go.statusCode, 302);
    const to = new URL(go.headers.location as string);
    assert.equal(to.hostname, 'accounts.google.com');
    assert.equal(to.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.app.created');
    assert.equal(to.searchParams.get('access_type'), 'offline');
    const state = to.searchParams.get('state')!;
    const flow = go.cookies.find((c) => c.name === 'nn_gcal')!;
    const back = await app.inject({ method: 'GET', url: `/api/gcal/callback?code=the-code&state=${state}`, headers: { cookie: `${cookie}; nn_gcal=${flow.value}` } });
    assert.equal(back.headers.location, '/settings?calendar=connected');
    await gcal.syncHome(db, home.id);
    // The refresh token isn't stored as plain text.
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM gcal_links').all()).includes('rt-secret'));

    // The plan goes out.
    assert.equal(google.live().length, 1);
    const ev = google.live()[0];
    assert.equal(ev.summary, 'Dinner: Tacos');
    assert.equal((ev.start as { dateTime: string }).dateTime, `${day}T18:00:00`);
    status = await call('GET', `${base}/gcal`);
    assert.equal(status.body.connected, true);
    assert.equal(status.body.error, null);
    assert.ok(status.body.lastSync);

    // A second sync with nothing new sends nothing.
    google.calls.length = 0;
    await gcal.syncHome(db, home.id);
    assert.deepEqual(google.calls.filter((c) => !c.startsWith('GET') && !c.includes('/token')), []);

    // Someone moves the event to breakfast two days later, and adds one of their own.
    const later = localDate(3);
    google.edit(ev.id, { start: { dateTime: `${later}T07:30:00-05:00` }, end: { dateTime: `${later}T08:00:00-05:00` } });
    google.add({ summary: 'Pizza night', start: { dateTime: `${day}T19:00:00-05:00` }, end: { dateTime: `${day}T20:00:00-05:00` } });
    await gcal.syncHome(db, home.id);
    let plan = (await call('GET', `${base}/mealplan?start=${localDate()}&days=7`)).body as { id: string; date: string; slot: string; title: string }[];
    const moved = plan.find((m) => m.id === tacos.id)!;
    assert.deepEqual([moved.date, moved.slot], [later, 'breakfast']);
    const pizza = plan.find((m) => m.title === 'Pizza night');
    assert.deepEqual([pizza?.date, pizza?.slot], [day, 'dinner']);
    // The moved event gets tidied to breakfast's time; the new one isn't duplicated.
    assert.equal(google.live().length, 2);
    assert.equal(google.events.get(ev.id)!.summary, 'Breakfast: Tacos');

    // Taking a meal off the plan takes it off the calendar.
    await call('DELETE', `${base}/mealplan/${tacos.id}`);
    await gcal.syncHome(db, home.id);
    assert.equal(google.events.get(ev.id)!.status, 'cancelled');
    assert.equal(google.live().length, 1);

    // Deleting an event in Google takes the meal off the plan.
    const pizzaEvent = google.live()[0];
    google.edit(pizzaEvent.id, { status: 'cancelled' });
    await gcal.syncHome(db, home.id);
    plan = (await call('GET', `${base}/mealplan?start=${localDate()}&days=7`)).body;
    assert.equal(plan.length, 0);

    // Sync on demand, then disconnect, which tells Google to forget the sign-in.
    assert.equal((await call('POST', `${base}/gcal/sync`)).status, 200);
    assert.equal((await call('DELETE', `${base}/gcal`)).status, 200);
    assert.ok(google.calls.includes('POST /revoke'));
    assert.equal((await call('GET', `${base}/gcal`)).body.connected, false);
    assert.equal((await call('POST', `${base}/gcal/sync`)).status, 404);
    await app.close();
  } finally {
    config.google = saved;
  }
});

test('Google Calendar: a callback without the right state is turned away', async () => {
  const saved = config.google;
  config.google = { clientId: 'test-client', clientSecret: 'test-secret' };
  try {
    const app = await buildApp(openMemoryDb(), { serveWeb: false });
    const r = await app.inject({ method: 'GET', url: '/api/gcal/callback?code=x&state=y' });
    assert.equal(r.headers.location, '/settings?calendar=expired');
    await app.close();
  } finally {
    config.google = saved;
  }
});
