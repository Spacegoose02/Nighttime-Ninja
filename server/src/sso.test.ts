// Forward-auth: a reverse proxy (Tinyauth, Authelia...) signs people in and passes who they are in headers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-sso-'));
process.env.FORWARD_AUTH_HEADER = 'Remote-User';
process.env.FORWARD_AUTH_TRUSTED = 'private,198.51.100.0/24';
process.env.SIGNUP_MODE = 'invite';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { trustedPeer, setSetting } = await import('./auth.ts');

async function setup() {
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });
  const req = async (url: string, headers: Record<string, string>, remoteAddress: string, method = 'GET', payload?: object) => {
    const res = await app.inject({ method: method as 'GET', url, headers, remoteAddress, payload });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return { db, req };
}

test('trusted proxy addresses: private ranges, single IPs and CIDRs', () => {
  assert.ok(trustedPeer('127.0.0.1', ['private']));
  assert.ok(trustedPeer('::ffff:172.18.0.4', ['private']), 'Docker networks count as private');
  assert.ok(!trustedPeer('203.0.113.9', ['private']));
  assert.ok(trustedPeer('198.51.100.77', ['198.51.100.0/24']));
  assert.ok(!trustedPeer('198.51.101.1', ['198.51.100.0/24']));
  assert.ok(trustedPeer('203.0.113.9', ['203.0.113.9']));
  assert.ok(!trustedPeer(undefined, ['private']));
});

test('forward-auth signs people in from the proxy header, and only from the proxy', async () => {
  const { req } = await setup();
  const headers = { 'remote-user': 'mom', 'remote-email': 'Mom@Example.com', 'remote-name': 'Mom' };
  const me = await req('/api/me', headers, '172.18.0.4');
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.user.name, 'Mom');
  assert.equal(me.body.user.email, 'mom@example.com');
  assert.equal(me.body.user.isAdmin, true, 'the first person is still the admin');
  assert.equal((await req('/api/me', headers, '203.0.113.9')).status, 401, 'a header typed by someone on the internet is ignored');
  assert.equal((await req('/api/me', { ...headers, 'x-forwarded-for': '127.0.0.1' }, '203.0.113.9')).status, 401, 'a faked forwarded address is ignored');
  assert.equal((await req('/api/me', headers, '198.51.100.20')).body.user.name, 'Mom', 'a listed proxy address works');
  // Same person next time, even if the display name changes.
  const again = await req('/api/me', { 'remote-user': 'MOM', 'remote-name': 'Mother' }, '127.0.0.1');
  assert.equal(again.body.user.id, me.body.user.id);
  // Someone new behind the proxy gets an account without a join code (the proxy decided they may come in).
  const dad = await req('/api/me', { 'remote-user': 'dad' }, '127.0.0.1');
  assert.equal(dad.status, 200);
  assert.equal(dad.body.user.isAdmin, false);
  assert.equal(dad.body.homes.length, 0, 'they still have to create or join a home');
  const home = await req('/api/homes', { 'remote-user': 'dad' }, '127.0.0.1', 'POST', { name: 'Dad kitchen' });
  assert.equal(home.status, 200, JSON.stringify(home.body));
  const cfg = await req('/api/auth/config', {}, '127.0.0.1');
  assert.equal(cfg.body.forwardAuth, true);
});

test('forward-auth links an existing account by email, never takes over a linked one, and respects closed sign-up', async () => {
  const { db, req } = await setup();
  await req('/api/me', { 'remote-user': 'admin' }, '127.0.0.1');
  db.prepare("INSERT INTO users (id, name, email) VALUES ('u-gran', 'Gran', 'gran@example.com')").run();
  const gran = await req('/api/me', { 'remote-user': 'granny', 'remote-email': 'GRAN@example.com' }, '127.0.0.1');
  assert.equal(gran.body.user.id, 'u-gran', 'matched by email and linked');
  const other = await req('/api/me', { 'remote-user': 'impostor', 'remote-email': 'gran@example.com' }, '127.0.0.1');
  assert.equal(other.status, 200);
  assert.notEqual(other.body.user.id, 'u-gran', 'an account already linked to another proxy user stays theirs');
  assert.equal(other.body.user.email, null);
  setSetting(db, 'signupMode', 'closed');
  assert.equal((await req('/api/me', { 'remote-user': 'stranger' }, '127.0.0.1')).status, 401, 'closed sign-up stops new accounts');
  assert.equal((await req('/api/me', { 'remote-user': 'granny' }, '127.0.0.1')).status, 200, 'existing people still get in');
  db.prepare("UPDATE users SET disabled = 1 WHERE id = 'u-gran'").run();
  assert.equal((await req('/api/me', { 'remote-user': 'granny' }, '127.0.0.1')).status, 401, 'turned-off accounts stay out');
  // Name-only quick sign-in can't be used to get into a proxy account.
  db.prepare("UPDATE users SET disabled = 0 WHERE id = 'u-gran'").run();
  db.prepare("UPDATE users SET email = NULL WHERE id = 'u-gran'").run();
  const quick = await req('/api/auth/local', {}, '127.0.0.1', 'POST', { name: 'Gran' });
  assert.equal(quick.status, 403);
});
