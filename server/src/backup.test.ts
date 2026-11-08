import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-backup-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openDb, openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { listBackups, makeBackup } = await import('./backup.ts');
const { clearRateLimit } = await import('./security.ts');
const { DatabaseSync } = await import('node:sqlite');

test('backups are consistent copies and old ones are trimmed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-bk-'));
  const db = openDb(dir);
  for (let i = 0; i < 9; i++) makeBackup(db, dir, 'nightly');
  const list = listBackups(dir);
  assert.equal(list.filter((b) => b.kind === 'nightly').length, 7);
  const copy = new DatabaseSync(path.join(dir, 'backups', list[0].name));
  assert.ok(Number((copy.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) > 0);
  copy.close();
  db.close();
});

test('an upgrade backs up the database first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-up-'));
  openDb(dir).close();
  // Pretend the database is one release behind.
  const raw = new DatabaseSync(path.join(dir, 'nighttime-ninja.db'));
  const v = Number((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  raw.exec(`PRAGMA user_version = ${v - 1}`);
  raw.close();
  assert.equal(listBackups(dir).length, 0);
  // Re-running the last migration fails (its column already exists), but the backup is made before migrating.
  assert.throws(() => openDb(dir));
  assert.equal(listBackups(dir).filter((b) => b.kind === 'upgrade').length, 1);
});

test('only admins can list, make and download backups', async () => {
  clearRateLimit('local:ip:127.0.0.1');
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const login = async (name: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name } });
    return { cookie: `nn_session=${res.cookies.find((c) => c.name === 'nn_session')!.value}` };
  };
  const admin = await login('Admin');
  const other = await login('Other');
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/backups', headers: other })).statusCode, 403);
  const made = await app.inject({ method: 'POST', url: '/api/admin/backups', headers: admin, payload: {} });
  assert.equal(made.statusCode, 200, made.body);
  const { name } = made.json();
  const list = await app.inject({ method: 'GET', url: '/api/admin/backups', headers: admin });
  assert.ok(list.json().backups.some((b: { name: string }) => b.name === name));
  const dl = await app.inject({ method: 'GET', url: `/api/admin/backups/${name}`, headers: admin });
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.rawPayload.subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/backups/..%2Fnighttime-ninja.db', headers: admin })).statusCode, 400);
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.json().ok, true);
  assert.match(health.json().version, /^\d+\.\d+\.\d+/);
});
