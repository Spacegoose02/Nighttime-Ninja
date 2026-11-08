// Requests: things kids ask for, waiting for a grown-up. Den Duty (the family's chore app) sends what a kid picks on
// its grocery list here with a home API token; the Shopping page's Requests tab shows them, and a grown-up says yes
// (it goes onto the list they pick) or no. Den Duty reads the answer back by its own ids, so the kid sees it too.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, num, str } from '../util.ts';
import { body, number, text } from '../schemas.ts';
import { guessItem } from '../../../shared/catalog.ts';
import { addShoppingItem, listFor } from './shopping.ts';
import { requestAdded } from '../push.ts';

export interface ShoppingRequest {
  id: string; name: string; icon: string; note: string | null; requestedBy: string | null; source: string; externalId: string | null;
  status: 'waiting' | 'approved' | 'declined'; listId: string | null; listName: string | null; decidedBy: string | null;
  decidedAt: string | null; createdAt: string;
}

function shape(r: Row): ShoppingRequest {
  return {
    id: r.id as string, name: r.name as string, icon: guessItem(r.name as string).icon, note: (r.note as string | null) ?? null,
    requestedBy: (r.requested_by as string | null) ?? null, source: r.source as string, externalId: (r.external_id as string | null) ?? null,
    status: r.status as ShoppingRequest['status'], listId: (r.list_id as string | null) ?? null, listName: (r.list_name as string | null) ?? null,
    decidedBy: (r.decided_by_name as string | null) ?? null, decidedAt: (r.decided_at as string | null) ?? null, createdAt: r.created_at as string,
  };
}

const SELECT = 'SELECT q.*, u.name AS decided_by_name FROM shopping_requests q LEFT JOIN users u ON u.id = q.decided_by';

function getRequest(db: DatabaseSync, homeId: string, id: string): Row {
  const r = db.prepare(`${SELECT} WHERE q.id = ? AND q.home_id = ?`).get(id, homeId) as Row | undefined;
  if (!r) throw new HttpError(404, 'That request is gone');
  return r;
}

/** Saying yes or no takes a person: an app with a token can ask, but never answer its own asks. */
function decider(db: DatabaseSync, req: Parameters<typeof homeCtx>[1]) {
  const ctx = homeCtx(db, req);
  if (!ctx.user) throw new HttpError(403, 'A grown-up has to answer requests from the app');
  return ctx as typeof ctx & { user: NonNullable<typeof ctx.user> };
}

export function requestRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Which home an API token belongs to, so another app can be linked with just the address and a token.
  app.get('/api/token/home', async (req) => {
    if (!req.tokenHomeId) throw new HttpError(401, 'Use a home API token (Settings → Home → API tokens) as a Bearer token');
    const h = db.prepare('SELECT id, name FROM homes WHERE id = ?').get(req.tokenHomeId) as Row;
    return { homeId: h.id, name: h.name };
  });

  // Waiting requests (or every recent one with ?status=all). ?ids=a,b (with ?source=) answers for another app's own ids.
  app.get('/api/homes/:homeId/shopping/requests', async (req) => {
    const ctx = homeCtx(db, req);
    const q = req.query as Row;
    const ids = typeof q.ids === 'string' ? q.ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200) : null;
    if (ids) {
      if (!ids.length) return [];
      const rows = db.prepare(`${SELECT} WHERE q.home_id = ? AND q.source = ? AND q.external_id IN (${ids.map(() => '?').join(',')})`)
        .all(ctx.homeId, str(q.source, 40) ?? 'app', ...ids) as Row[];
      return rows.map(shape);
    }
    const rows = q.status === 'all'
      ? db.prepare(`${SELECT} WHERE q.home_id = ? AND (q.status = 'waiting' OR q.decided_at > datetime('now', '-7 day')) ORDER BY q.created_at DESC LIMIT 200`).all(ctx.homeId) as Row[]
      : db.prepare(`${SELECT} WHERE q.home_id = ? AND q.status = 'waiting' ORDER BY q.created_at`).all(ctx.homeId) as Row[];
    return rows.map(shape);
  });

  // Ask for something. Sending the same externalId again returns the request already made.
  app.post('/api/homes/:homeId/shopping/requests', {
    schema: body({ name: text, note: text, requestedBy: text, source: text, externalId: text }, ['name']),
  }, async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const name = str(b.name, 120);
    if (!name) throw new HttpError(400, 'Name is required');
    const source = str(b.source, 40) ?? 'app';
    const externalId = str(b.externalId, 80);
    if (externalId) {
      const had = db.prepare('SELECT id FROM shopping_requests WHERE home_id = ? AND source = ? AND external_id = ?').get(ctx.homeId, source, externalId) as Row | undefined;
      if (had) return shape(getRequest(db, ctx.homeId, had.id as string));
    }
    if (Number((db.prepare("SELECT COUNT(*) AS n FROM shopping_requests WHERE home_id = ? AND status = 'waiting'").get(ctx.homeId) as Row).n) >= 200) {
      throw new HttpError(429, 'There are already lots of requests waiting. Answer some first.');
    }
    const id = newId();
    const by = str(b.requestedBy, 60) ?? ctx.user?.name ?? null;
    db.prepare('INSERT INTO shopping_requests (id, home_id, name, note, requested_by, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, name, str(b.note, 200), by, source, externalId);
    void requestAdded(db, ctx.homeId, by, [name]).catch(() => {});
    return shape(getRequest(db, ctx.homeId, id));
  });

  // Yes: onto the list picked (Main if none), with an amount if the grown-up gave one.
  app.post('/api/homes/:homeId/shopping/requests/:id/approve', {
    schema: body({ listId: text, name: text, quantity: number, unit: text }),
  }, async (req) => {
    const ctx = decider(db, req);
    const r = getRequest(db, ctx.homeId, (req.params as { id: string }).id);
    if (r.status !== 'waiting') throw new HttpError(409, r.status === 'approved' ? 'Already said yes to that' : 'Already said no to that');
    const b = (req.body ?? {}) as Row;
    const listId = listFor(db, ctx.homeId, b.listId);
    const name = str(b.name, 120) ?? (r.name as string);
    const note = r.requested_by ? `Asked for by ${r.requested_by as string}` : null;
    const item = addShoppingItem(db, ctx.homeId, { name, quantity: num(b.quantity), unit: str(b.unit, 20), note, listId }, ctx.user.id);
    const listName = (db.prepare('SELECT name FROM shopping_lists WHERE id = ?').get(listId) as Row).name as string;
    db.prepare("UPDATE shopping_requests SET status = 'approved', list_id = ?, list_name = ?, item_id = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?")
      .run(listId, listName, item.id as string, ctx.user.id, r.id as string);
    return shape(getRequest(db, ctx.homeId, r.id as string));
  });

  app.post('/api/homes/:homeId/shopping/requests/:id/decline', async (req) => {
    const ctx = decider(db, req);
    const r = getRequest(db, ctx.homeId, (req.params as { id: string }).id);
    if (r.status !== 'waiting') throw new HttpError(409, r.status === 'approved' ? 'Already said yes to that' : 'Already said no to that');
    db.prepare("UPDATE shopping_requests SET status = 'declined', decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(ctx.user.id, r.id as string);
    return shape(getRequest(db, ctx.homeId, r.id as string));
  });

  // The kid changed their mind (took it off their list in the other app): a request still waiting goes away.
  app.post('/api/homes/:homeId/shopping/requests/withdraw', { schema: body({ source: text, externalId: text }, ['externalId']) }, async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const out = db.prepare("DELETE FROM shopping_requests WHERE home_id = ? AND source = ? AND external_id = ? AND status = 'waiting'")
      .run(ctx.homeId, str(b.source, 40) ?? 'app', str(b.externalId, 80) ?? '');
    return { ok: true, withdrawn: Number(out.changes) > 0 };
  });

  // Things this home buys most, with an icon each: what the other app offers kids to pick from.
  app.get('/api/homes/:homeId/shopping/requests/picks', async (req) => {
    const ctx = homeCtx(db, req);
    const rows = db.prepare('SELECT name, category FROM shopping_history WHERE home_id = ? AND times_bought > 0 ORDER BY times_bought DESC, last_bought_at DESC LIMIT 60')
      .all(ctx.homeId) as Row[];
    // Grown-up things stay off a kid's menu.
    return rows.filter((r) => r.category !== 'Bar' && r.category !== 'Household')
      .slice(0, 24).map((r) => ({ name: r.name as string, icon: guessItem(r.name as string).icon }));
  });
}
