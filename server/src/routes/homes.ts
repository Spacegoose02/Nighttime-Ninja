import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, requireAdmin, requireUser } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, randomToken, readableCode, requireStr, sha256, str } from '../util.ts';

export function createHome(db: DatabaseSync, userId: string, name: string): string {
  const id = newId();
  tx(db, () => {
    db.prepare('INSERT INTO homes (id, name, join_code, calendar_token) VALUES (?, ?, ?, ?)')
      .run(id, name, readableCode(8), randomToken(24));
    db.prepare("INSERT INTO home_members (home_id, user_id, role) VALUES (?, ?, 'manager')").run(id, userId);
    db.prepare('INSERT INTO home_settings (home_id) VALUES (?)').run(id);
    db.prepare('UPDATE users SET last_home_id = ? WHERE id = ?').run(id, userId);
  });
  return id;
}

export function homeRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.post('/api/homes', async (req) => {
    const user = requireUser(req);
    const name = requireStr((req.body as Row)?.name, 'Home name', 80);
    return { id: createHome(db, user.id, name) };
  });

  app.post('/api/homes/join', async (req) => {
    const user = requireUser(req);
    const code = requireStr((req.body as Row)?.code, 'Join code', 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const home = db.prepare('SELECT id FROM homes WHERE join_code = ?').get(code) as Row | undefined;
    if (!home) throw new HttpError(404, 'No home has that join code');
    db.prepare("INSERT OR IGNORE INTO home_members (home_id, user_id, role) VALUES (?, ?, 'member')").run(home.id as string, user.id);
    db.prepare('UPDATE users SET last_home_id = ? WHERE id = ?').run(home.id as string, user.id);
    return { id: home.id };
  });

  app.get('/api/homes/:homeId', async (req) => {
    const ctx = homeCtx(db, req);
    const home = db.prepare('SELECT id, name, join_code, calendar_token, created_at FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    const members = db.prepare(`
      SELECT u.id, u.name, u.avatar, m.role, m.joined_at FROM home_members m JOIN users u ON u.id = m.user_id
      WHERE m.home_id = ? ORDER BY m.role, u.name`).all(ctx.homeId);
    const settings = db.prepare('SELECT zip_code, stores, kroger_location_id FROM home_settings WHERE home_id = ?').get(ctx.homeId) as Row | undefined;
    const isManager = ctx.role === 'manager';
    return {
      id: home.id,
      name: home.name,
      role: ctx.role,
      joinCode: home.join_code,
      calendarUrl: isManager || !ctx.viaToken ? `/api/calendar/${home.calendar_token}.ics` : null,
      members,
      settings: {
        zipCode: settings?.zip_code ?? null,
        stores: JSON.parse((settings?.stores as string) ?? '[]'),
        krogerLocationId: settings?.kroger_location_id ?? null,
      },
    };
  });

  app.patch('/api/homes/:homeId', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    const b = (req.body ?? {}) as Row;
    const name = str(b.name, 80);
    if (name) db.prepare('UPDATE homes SET name = ? WHERE id = ?').run(name, ctx.homeId);
    db.prepare('INSERT OR IGNORE INTO home_settings (home_id) VALUES (?)').run(ctx.homeId);
    if ('zipCode' in b) db.prepare('UPDATE home_settings SET zip_code = ? WHERE home_id = ?').run(str(b.zipCode, 10), ctx.homeId);
    if (Array.isArray(b.stores)) db.prepare('UPDATE home_settings SET stores = ? WHERE home_id = ?').run(JSON.stringify(b.stores.map(String).slice(0, 20)), ctx.homeId);
    if ('krogerLocationId' in b) db.prepare('UPDATE home_settings SET kroger_location_id = ? WHERE home_id = ?').run(str(b.krogerLocationId, 20), ctx.homeId);
    return { ok: true };
  });

  app.delete('/api/homes/:homeId', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    db.prepare('DELETE FROM homes WHERE id = ?').run(ctx.homeId);
    return { ok: true };
  });

  app.post('/api/homes/:homeId/join-code', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    const code = readableCode(8);
    db.prepare('UPDATE homes SET join_code = ? WHERE id = ?').run(code, ctx.homeId);
    return { joinCode: code };
  });

  app.post('/api/homes/:homeId/calendar-token', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    const token = randomToken(24);
    db.prepare('UPDATE homes SET calendar_token = ? WHERE id = ?').run(token, ctx.homeId);
    return { calendarUrl: `/api/calendar/${token}.ics` };
  });

  app.patch('/api/homes/:homeId/members/:userId', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    const { userId } = req.params as { userId: string };
    const role = (req.body as Row)?.role;
    if (role !== 'manager' && role !== 'member') throw new HttpError(400, 'Role must be manager or member');
    if (role === 'member') assertNotLastManager(db, ctx.homeId, userId);
    db.prepare('UPDATE home_members SET role = ? WHERE home_id = ? AND user_id = ?').run(role, ctx.homeId, userId);
    return { ok: true };
  });

  app.delete('/api/homes/:homeId/members/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    // Anyone can leave; managers can remove others.
    const ctx = homeCtx(db, req, userId === req.user?.id ? 'member' : 'manager');
    assertNotLastManager(db, ctx.homeId, userId);
    db.prepare('DELETE FROM home_members WHERE home_id = ? AND user_id = ?').run(ctx.homeId, userId);
    return { ok: true };
  });

  // API tokens for Home Assistant and other automations.
  app.get('/api/homes/:homeId/tokens', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    return db.prepare('SELECT id, name, last_used_at, created_at FROM api_tokens WHERE home_id = ? ORDER BY created_at DESC').all(ctx.homeId);
  });

  app.post('/api/homes/:homeId/tokens', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    const name = requireStr((req.body as Row)?.name, 'Token name', 60);
    const token = `nnk_${randomToken(30)}`;
    db.prepare('INSERT INTO api_tokens (id, home_id, name, token_hash, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(newId(), ctx.homeId, name, sha256(token), ctx.user?.id ?? null);
    // The plain token is shown exactly once.
    return { token };
  });

  app.delete('/api/homes/:homeId/tokens/:tokenId', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    db.prepare('DELETE FROM api_tokens WHERE id = ? AND home_id = ?').run((req.params as { tokenId: string }).tokenId, ctx.homeId);
    return { ok: true };
  });

  // Server administration.
  app.get('/api/admin/overview', async (req) => {
    requireAdmin(req);
    const users = db.prepare(`
      SELECT u.id, u.name, u.username, u.email, u.is_admin, u.disabled, u.totp_enabled, u.created_at,
        (u.password_hash IS NOT NULL) AS has_password, (u.google_sub IS NOT NULL) AS has_google,
        (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
        (SELECT COUNT(*) FROM home_members m WHERE m.user_id = u.id) AS homes
      FROM users u ORDER BY u.created_at`).all();
    const homes = db.prepare(`
      SELECT h.id, h.name, h.created_at,
        (SELECT COUNT(*) FROM home_members m WHERE m.home_id = h.id) AS members,
        (SELECT COUNT(*) FROM recipes r WHERE r.home_id = h.id) AS recipes
      FROM homes h ORDER BY h.name`).all();
    return { users, homes };
  });

  app.patch('/api/admin/users/:userId', async (req) => {
    const admin = requireAdmin(req);
    const { userId } = req.params as { userId: string };
    const isAdmin = (req.body as Row)?.isAdmin;
    if (typeof isAdmin !== 'boolean') throw new HttpError(400, 'isAdmin must be true or false');
    if (!isAdmin && userId === admin.id) throw new HttpError(400, "You can't remove your own admin rights");
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
    return { ok: true };
  });

  app.delete('/api/admin/users/:userId', async (req) => {
    const admin = requireAdmin(req);
    const { userId } = req.params as { userId: string };
    if (userId === admin.id) throw new HttpError(400, "You can't delete yourself");
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return { ok: true };
  });
}

function assertNotLastManager(db: DatabaseSync, homeId: string, userId: string): void {
  const managers = db.prepare("SELECT user_id FROM home_members WHERE home_id = ? AND role = 'manager'").all(homeId) as Row[];
  if (managers.length === 1 && managers[0].user_id === userId) {
    throw new HttpError(400, 'A home needs at least one manager. Promote someone else first.');
  }
}
