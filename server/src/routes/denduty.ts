// Den Duty, the family's chore app. With its address, a Den Duty home id and a control API token saved here, a
// recipe's Little helpers job can be sent to a kid as a one-off chore ("Ask Sam to help"), worth the points picked
// here. It uses Den Duty's public API: GET /api/v1/homes/:homeId/kids and POST /api/v1/homes/:homeId/chores.
// The token is kept sealed with a key made from the session secret, so a copied database alone can't use it.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { seal, unseal } from '../gcal.ts';
import { HttpError, localDate, num, str } from '../util.ts';

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests: a stand-in for Den Duty. */
export function setDenDutyFetch(f: typeof fetch): void {
  fetchImpl = f;
}

interface Link { url: string; denHomeId: string; denHomeName: string | null; token: string; points: number }

function openToken(sealed: string): string | null {
  try { return unseal(sealed); } catch { return null; } // e.g. the session secret changed
}

function link(db: DatabaseSync, homeId: string): Link | null {
  const r = db.prepare('SELECT * FROM denduty_links WHERE home_id = ?').get(homeId) as Row | undefined;
  const token = r ? openToken(r.token as string) : null;
  if (!r || !token) return null;
  return { url: r.url as string, denHomeId: r.den_home_id as string, denHomeName: (r.den_home_name as string | null) ?? null, token, points: Number(r.points) };
}

class DenDutyDown extends HttpError {
  constructor(message = "Couldn't reach Den Duty. Check it's running and try again.") { super(502, message); }
}

async function call<T>(l: Pick<Link, 'url' | 'denHomeId' | 'token'>, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${l.url}/api/v1/homes/${encodeURIComponent(l.denHomeId)}${path}`, {
      method,
      headers: { authorization: `Bearer ${l.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new DenDutyDown();
  }
  if (res.status === 401) throw new HttpError(502, "Den Duty didn't take the API token. Make a control token in Den Duty's Settings and link it again.");
  if (res.status === 403) throw new HttpError(502, 'That Den Duty token is read-only or for a different home. Make a control token for this home.');
  if (res.status === 404) throw new HttpError(502, "Den Duty doesn't know that home or kid. Check the home id in Settings.");
  if (!res.ok) {
    const err = await res.json().catch(() => null) as { error?: string } | null;
    throw new DenDutyDown(err?.error ? `Den Duty said: ${String(err.error).slice(0, 200)}` : undefined);
  }
  return (await res.json()) as T;
}

export interface DenKid { id: string; name: string; avatar: string | null; color: string | null; age: number | null }

const kidCache = new Map<string, { at: number; kids: DenKid[] }>();

async function kids(db: DatabaseSync, homeId: string): Promise<DenKid[]> {
  const l = link(db, homeId);
  if (!l) return [];
  const hit = kidCache.get(homeId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.kids;
  const got = await call<Row[]>(l, 'GET', '/kids');
  const out = (Array.isArray(got) ? got : []).filter((k) => typeof k?.id === 'string').map((k) => ({
    id: k.id as string,
    name: String(k.name ?? 'Kid').slice(0, 40),
    avatar: typeof k.avatar === 'string' ? k.avatar.slice(0, 40) : null,
    color: typeof k.color === 'string' ? k.color.slice(0, 20) : null,
    age: typeof k.age === 'number' ? k.age : null,
  }));
  kidCache.set(homeId, { at: Date.now(), kids: out });
  return out;
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** A Den Duty chore title: at most 80 characters, which is Den Duty's limit. */
export function choreTitle(task: string, recipe: string | null): string {
  const full = recipe ? `${recipe}: ${task}` : task;
  if (full.length <= 80) return full;
  return task.length <= 80 ? task : `${task.slice(0, 79)}…`;
}

export function denDutyRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/denduty', async (req) => {
    const ctx = homeCtx(db, req);
    const r = db.prepare('SELECT url, den_home_id, den_home_name, points, token FROM denduty_links WHERE home_id = ?').get(ctx.homeId) as Row | undefined;
    return {
      linked: !!r && !!openToken(r.token as string),
      url: (r?.url as string | undefined) ?? '',
      denHomeId: (r?.den_home_id as string | undefined) ?? '',
      denHomeName: (r?.den_home_name as string | null | undefined) ?? null,
      points: r ? Number(r.points) : 5,
    };
  });

  // { url, denHomeId, token, points }: checks them with Den Duty, then saves. url '' unlinks. Leave token out to keep the saved one.
  app.put('/api/homes/:homeId/denduty', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    const b = (req.body ?? {}) as Row;
    let url = str(b.url, 300)?.replace(/\/+$/, '') ?? '';
    if (!url) {
      db.prepare('DELETE FROM denduty_links WHERE home_id = ?').run(ctx.homeId);
      kidCache.delete(ctx.homeId);
      return { linked: false, url: '', denHomeId: '', denHomeName: null, points: 5 };
    }
    if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new HttpError(400, "Den Duty's address starts with http:// or https://");
    url = new URL(url).origin;
    const denHomeId = str(b.denHomeId, 100);
    if (!denHomeId) throw new HttpError(400, "Add the Den Duty home id (it's in Den Duty's Settings, next to the API tokens)");
    const saved = db.prepare('SELECT token FROM denduty_links WHERE home_id = ?').get(ctx.homeId) as Row | undefined;
    const token = typeof b.token === 'string' && b.token.trim() ? b.token.trim().slice(0, 300) : saved ? openToken(saved.token as string) : null;
    if (!token) throw new HttpError(400, 'Add a Den Duty control API token too');
    const p = num(b.points);
    const points = p == null ? 5 : Math.max(0, Math.min(10000, Math.round(p)));
    const home = await call<{ name?: string }>({ url, denHomeId, token }, 'GET', '');
    const name = str(home?.name, 100) ?? null;
    db.prepare(`INSERT INTO denduty_links (home_id, url, den_home_id, den_home_name, token, points) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (home_id) DO UPDATE SET url = excluded.url, den_home_id = excluded.den_home_id, den_home_name = excluded.den_home_name,
        token = excluded.token, points = excluded.points`).run(ctx.homeId, url, denHomeId, name, seal(token), points);
    kidCache.delete(ctx.homeId);
    return { linked: true, url, denHomeId, denHomeName: name, points };
  });

  // The kids in the linked Den Duty home, for the "Ask … to help" buttons. Empty when nothing is linked.
  app.get('/api/homes/:homeId/denduty/kids', async (req) => {
    const ctx = homeCtx(db, req);
    return kids(db, ctx.homeId);
  });

  // { kidId, task, recipeId?, dueDate?, dueTime?, points? }: a one-off chore in Den Duty for that kid.
  app.post('/api/homes/:homeId/denduty/chores', async (req) => {
    const ctx = homeCtx(db, req);
    // A person asks a kid for help; a Home Assistant token has no business handing out chores.
    if (ctx.viaToken) throw new HttpError(403, 'Only people can ask kids for help');
    const l = link(db, ctx.homeId);
    if (!l) throw new HttpError(400, 'Link Den Duty first (Settings, Home, Den Duty)');
    const b = (req.body ?? {}) as Row;
    const kidId = str(b.kidId, 100);
    const task = str(b.task, 200);
    if (!kidId || !task) throw new HttpError(400, 'Pick a kid and a job');
    let recipe: string | null = null;
    const recipeId = str(b.recipeId, 60);
    if (recipeId) {
      const r = db.prepare('SELECT title FROM recipes WHERE id = ? AND home_id = ?').get(recipeId, ctx.homeId) as Row | undefined;
      if (!r) throw new HttpError(404, 'Recipe not found');
      recipe = r.title as string;
    }
    if (b.dueDate != null && !isDate(b.dueDate)) throw new HttpError(400, 'Due dates look like 2026-05-14');
    if (b.dueTime != null && b.dueTime !== '' && !isTime(b.dueTime)) throw new HttpError(400, 'Due times look like 17:30');
    const p = num(b.points);
    const points = p == null ? l.points : Math.max(0, Math.min(10000, Math.round(p)));
    const chore = await call<{ id?: string; title?: string }>(l, 'POST', '/chores', {
      title: choreTitle(task, recipe),
      icon: '🍳',
      memberIds: [kidId],
      points,
      schedule: 'once',
      dueDate: isDate(b.dueDate) ? b.dueDate : localDate(),
      ...(isTime(b.dueTime) ? { dueTime: b.dueTime } : {}),
    });
    const kid = (kidCache.get(ctx.homeId)?.kids ?? []).find((k) => k.id === kidId);
    return { ok: true, choreId: chore?.id ?? null, title: chore?.title ?? choreTitle(task, recipe), kidName: kid?.name ?? null, points };
  });
}
