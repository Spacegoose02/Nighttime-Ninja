// Automatic database backups: one a night, one before every upgrade, and a list admins can download from.
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth.ts';
import { HttpError } from './util.ts';

/** How many of each kind to keep. Older ones are removed after a new one is made. */
const KEEP = { nightly: 7, upgrade: 3, manual: 5 } as const;
export type BackupKind = keyof typeof KEEP;

const NAME = /^nighttime-ninja-(nightly|upgrade|manual)-[0-9TZ-]+\.db$/;

export function backupDir(dataDir: string): string {
  return path.join(dataDir, 'backups');
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
}

export interface BackupInfo { name: string; kind: BackupKind; size: number; createdAt: string }

export function listBackups(dataDir: string): BackupInfo[] {
  const dir = backupDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => NAME.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, kind: name.match(NAME)![1] as BackupKind, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** Writes a consistent copy of the database (safe while the server is running) and trims old copies of that kind. */
export function makeBackup(db: DatabaseSync, dataDir: string, kind: BackupKind): BackupInfo {
  const dir = backupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  let name = `nighttime-ninja-${kind}-${stamp()}.db`;
  for (let i = 1; fs.existsSync(path.join(dir, name)); i++) name = `nighttime-ninja-${kind}-${stamp()}-${i}.db`;
  const file = path.join(dir, name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = listBackups(dataDir).filter((b) => b.kind === kind).slice(KEEP[kind]);
  for (const b of old) fs.rmSync(path.join(dir, b.name), { force: true });
  const st = fs.statSync(file);
  return { name, kind, size: st.size, createdAt: st.mtime.toISOString() };
}

/** Makes a nightly backup when none was made in the last 20 hours. Checks every hour. */
export function startBackups(db: DatabaseSync, dataDir: string, onError: (err: unknown) => void): () => void {
  const tick = () => {
    try {
      const last = listBackups(dataDir).find((b) => b.kind === 'nightly');
      if (!last || Date.now() - Date.parse(last.createdAt) > 20 * 3600e3) makeBackup(db, dataDir, 'nightly');
    } catch (err) {
      onError(err);
    }
  };
  const first = setTimeout(tick, 60_000);
  const every = setInterval(tick, 3600e3);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}

export function backupRoutes(app: FastifyInstance, db: DatabaseSync, dataDir: string): void {
  app.get('/api/admin/backups', async (req) => {
    requireAdmin(req);
    return { dir: backupDir(dataDir), backups: listBackups(dataDir) };
  });

  app.post('/api/admin/backups', async (req) => {
    requireAdmin(req);
    return makeBackup(db, dataDir, 'manual');
  });

  app.get('/api/admin/backups/:name', async (req, reply) => {
    requireAdmin(req);
    const { name } = req.params as { name: string };
    if (!NAME.test(name)) throw new HttpError(400, 'Not a backup file');
    const file = path.join(backupDir(dataDir), name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'That backup is gone');
    reply.header('content-type', 'application/vnd.sqlite3');
    reply.header('content-disposition', `attachment; filename="${name}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(fs.createReadStream(file));
  });
}
