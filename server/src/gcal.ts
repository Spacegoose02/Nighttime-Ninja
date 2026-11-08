// Two-way Google Calendar sync for the meal plan.
//
// A home manager connects a Google account once (Settings → Home → Google Calendar). Nighttime Ninja makes its own
// "<home> meals" calendar in that account and only ever touches that calendar: the permission it asks for
// (calendar.app.created) can't see or change anything else there.
//
// Out: every planned meal from a week ago to two months ahead becomes an event, and changes to the plan follow.
// In: drag an event to another day or time and the meal moves; delete it and the meal goes; add an event to the
// calendar and it lands on the plan (the time picks breakfast, lunch, snack or dinner).
//
// The one-way calendar link (an .ics feed) still works for anyone who'd rather not connect an account.
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { cookieOpts, homeCtx } from './auth.ts';
import { config } from './config.ts';
import type { Row } from './db.ts';
import { publish } from './live.ts';
import { rateLimit } from './security.ts';
import { HttpError, localDate, newId, nowIso, randomToken, sha256 } from './util.ts';

const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const COOKIE = 'nn_gcal';
const PAST_DAYS = 7;
const AHEAD_DAYS = 60;
const EVERY_MS = 15 * 60e3;

const SLOT_TIMES: Record<string, [number, number]> = { breakfast: [8, 30], lunch: [12, 45], snack: [15, 30], dinner: [18, 60] };
const SLOT_NAMES: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };

/** Which meal a time of day is: before 11 breakfast, before 15 lunch, before 17 a snack, then dinner. */
export function slotFor(hour: number): string {
  return hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 17 ? 'snack' : 'dinner';
}

// Tests swap in a fake Google.
type Http = (url: string, init?: RequestInit) => Promise<Response>;
let http: Http = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30e3) });
export function useGoogleForTests(fake: Http): void { http = fake; }

const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Refresh tokens are kept encrypted with a key made from the session secret, so a copied database alone can't use them.
const key = (): Buffer => crypto.createHash('sha256').update(`gcal:${config.sessionSecret}`).digest();
export function seal(s: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}
export function unseal(s: string): string {
  const [iv, tag, data] = s.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

class GoogleError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function tokenRequest(form: Record<string, string>): Promise<Row> {
  if (!config.google) throw new HttpError(400, 'Google is not set up on this server');
  const res = await http(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...form }).toString(),
  });
  const out = (await res.json().catch(() => ({}))) as Row;
  if (!res.ok) throw new GoogleError(res.status, String(out.error_description ?? out.error ?? `Google answered ${res.status}`));
  return out;
}

async function google(access: string, method: string, path: string, body?: unknown): Promise<Row | null> {
  const res = await http(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${access}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const out = (await res.json().catch(() => ({}))) as Row;
  if (!res.ok) throw new GoogleError(res.status, String((out.error as Row | undefined)?.message ?? `Google Calendar answered ${res.status}`));
  return out;
}

interface Link { home_id: string; refresh_token: string; calendar_id: string; sync_token: string | null }

/** What a meal looks like as an event. Its hash tells us later whether the meal changed since we last sent it. */
function eventFor(meal: Row, tz: string) {
  const [h, mins] = SLOT_TIMES[meal.slot as string] ?? SLOT_TIMES.dinner;
  const pad = (n: number) => String(n).padStart(2, '0');
  const end = h * 60 + mins;
  const title = String(meal.recipe_title ?? meal.title ?? 'Meal');
  const description = [
    meal.note ? String(meal.note) : '',
    meal.cook_name ? `${meal.cook_name} is cooking.` : '',
    meal.recipe_id ? `${config.publicUrl}/recipes/${meal.recipe_id}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    summary: `${SLOT_NAMES[meal.slot as string] ?? 'Meal'}: ${title}`,
    description,
    start: { dateTime: `${meal.date}T${pad(h)}:00:00`, timeZone: tz },
    end: { dateTime: `${meal.date}T${pad(Math.floor(end / 60))}:${pad(end % 60)}:00`, timeZone: tz },
    extendedProperties: { private: { nnMealId: String(meal.id) } },
  };
}
const hashOf = (ev: unknown): string => sha256(JSON.stringify(ev));

/** Where an event sits, as a day and a meal. All-day events count as dinner. */
function placeOf(ev: Row): { date: string; slot: string } | null {
  const start = ev.start as { dateTime?: string; date?: string } | undefined;
  if (start?.dateTime) return { date: start.dateTime.slice(0, 10), slot: slotFor(Number(start.dateTime.slice(11, 13))) };
  if (start?.date) return { date: start.date, slot: 'dinner' };
  return null;
}

/** "Dinner: Tacos" → "Tacos", so a title we wrote doesn't grow a second prefix when it comes back. */
const bareTitle = (summary: string): string => summary.replace(/^(Breakfast|Lunch|Snack|Dinner):\s*/i, '').trim();

const MEALS = `SELECT m.*, r.title AS recipe_title, u.name AS cook_name FROM meal_plan m
  LEFT JOIN recipes r ON r.id = m.recipe_id LEFT JOIN users u ON u.id = m.cook_id`;

/** Brings in changes made in Google since last time. Returns how many meals changed. */
async function pull(db: DatabaseSync, link: Link, access: string, tz: string): Promise<number> {
  let changed = 0;
  let pageToken: string | null = null;
  let syncToken = link.sync_token;
  for (let pages = 0; pages < 50; pages++) {
    const q = new URLSearchParams({ showDeleted: 'true', singleEvents: 'true', maxResults: '250', timeZone: tz });
    if (syncToken) q.set('syncToken', syncToken);
    else q.set('timeMin', `${localDate(-PAST_DAYS)}T00:00:00Z`);
    if (pageToken) q.set('pageToken', pageToken);
    let page: Row;
    try {
      page = (await google(access, 'GET', `/calendars/${encodeURIComponent(link.calendar_id)}/events?${q}`))!;
    } catch (err) {
      // An expired sync token means "start over with a full list".
      if (err instanceof GoogleError && err.status === 410 && syncToken) { syncToken = null; pageToken = null; continue; }
      throw err;
    }
    for (const ev of (page.items ?? []) as Row[]) changed += applyEvent(db, link.home_id, ev);
    pageToken = (page.nextPageToken as string | undefined) ?? null;
    if (!pageToken) {
      db.prepare('UPDATE gcal_links SET sync_token = ? WHERE home_id = ?').run((page.nextSyncToken as string | undefined) ?? null, link.home_id);
      break;
    }
  }
  return changed;
}

function applyEvent(db: DatabaseSync, homeId: string, ev: Row): number {
  const eventId = String(ev.id);
  const map = db.prepare('SELECT * FROM gcal_events WHERE home_id = ? AND event_id = ?').get(homeId, eventId) as Row | undefined;
  // Our own writes come back too: the same etag means nothing new happened in Google.
  if (map && map.etag === ev.etag) return 0;
  const meal = map ? db.prepare('SELECT * FROM meal_plan WHERE id = ? AND home_id = ?').get(map.meal_id as string, homeId) as Row | undefined : undefined;

  if (ev.status === 'cancelled') {
    if (!map) return 0;
    db.prepare('DELETE FROM gcal_events WHERE home_id = ? AND event_id = ?').run(homeId, eventId);
    if (!meal) return 0;
    db.prepare('DELETE FROM meal_plan WHERE id = ?').run(meal.id as string);
    return 1;
  }

  const place = placeOf(ev);
  if (!place) return 0;
  const title = bareTitle(String(ev.summary ?? '')).slice(0, 200);

  if (map && meal) {
    let n = 0;
    if (meal.date !== place.date || meal.slot !== place.slot) {
      db.prepare('UPDATE meal_plan SET date = ?, slot = ? WHERE id = ?').run(place.date, place.slot, meal.id as string);
      n = 1;
    }
    // Free-text meals take a new name from the event. Recipe meals keep the recipe.
    if (!meal.recipe_id && title && title !== meal.title) {
      db.prepare('UPDATE meal_plan SET title = ? WHERE id = ?').run(title, meal.id as string);
      n = 1;
    }
    // Remember the new etag, and forget the hash so the next push tidies the event (times, title prefix).
    db.prepare('UPDATE gcal_events SET etag = ?, hash = ? WHERE home_id = ? AND event_id = ?').run(String(ev.etag ?? ''), n ? '' : String(map.hash), homeId, eventId);
    return n;
  }
  if (map && !meal) return 0; // Deleted here; the push removes the event.

  // A new event someone added in Google becomes a meal.
  const fromUs = (ev.extendedProperties as { private?: { nnMealId?: string } } | undefined)?.private?.nnMealId;
  if (fromUs) return 0; // An event for a meal we no longer track (e.g. after reconnecting): leave it alone.
  if (!title) return 0;
  const id = newId();
  db.prepare('INSERT INTO meal_plan (id, home_id, date, slot, title) VALUES (?, ?, ?, ?, ?)').run(id, homeId, place.date, place.slot, title);
  db.prepare('INSERT INTO gcal_events (home_id, meal_id, event_id, etag, hash) VALUES (?, ?, ?, ?, ?)').run(homeId, id, eventId, String(ev.etag ?? ''), '');
  return 1;
}

/** Sends meal plan changes to Google: new meals, changed meals and removed meals. */
async function push(db: DatabaseSync, link: Link, access: string, tz: string): Promise<void> {
  const cal = `/calendars/${encodeURIComponent(link.calendar_id)}/events`;
  const homeId = link.home_id;
  const meals = db.prepare(`${MEALS} WHERE m.home_id = ? AND m.date >= ? AND m.date <= ? ORDER BY m.date`)
    .all(homeId, localDate(-PAST_DAYS), localDate(AHEAD_DAYS)) as Row[];
  const maps = new Map((db.prepare('SELECT * FROM gcal_events WHERE home_id = ?').all(homeId) as Row[]).map((r) => [r.meal_id as string, r]));

  for (const meal of meals) {
    const ev = eventFor(meal, tz);
    const hash = hashOf(ev);
    const map = maps.get(meal.id as string);
    if (map?.hash === hash) continue;
    let out: Row | null = null;
    if (map) {
      try {
        out = await google(access, 'PATCH', `${cal}/${encodeURIComponent(String(map.event_id))}`, ev);
      } catch (err) {
        if (!(err instanceof GoogleError) || (err.status !== 404 && err.status !== 410)) throw err;
        db.prepare('DELETE FROM gcal_events WHERE home_id = ? AND meal_id = ?').run(homeId, meal.id as string);
      }
    }
    if (!out) {
      out = await google(access, 'POST', cal, ev);
      db.prepare('DELETE FROM gcal_events WHERE home_id = ? AND meal_id = ?').run(homeId, meal.id as string);
      db.prepare('INSERT INTO gcal_events (home_id, meal_id, event_id, etag, hash) VALUES (?, ?, ?, ?, ?)')
        .run(homeId, meal.id as string, String(out?.id), String(out?.etag ?? ''), hash);
    } else {
      db.prepare('UPDATE gcal_events SET etag = ?, hash = ? WHERE home_id = ? AND meal_id = ?').run(String(out.etag ?? ''), hash, homeId, meal.id as string);
    }
  }

  // Meals taken off the plan here: take their events off the calendar too.
  const gone = db.prepare('SELECT g.* FROM gcal_events g LEFT JOIN meal_plan m ON m.id = g.meal_id WHERE g.home_id = ? AND m.id IS NULL').all(homeId) as Row[];
  for (const g of gone) {
    try {
      await google(access, 'DELETE', `${cal}/${encodeURIComponent(String(g.event_id))}`);
    } catch (err) {
      if (!(err instanceof GoogleError) || (err.status !== 404 && err.status !== 410)) throw err;
    }
    db.prepare('DELETE FROM gcal_events WHERE home_id = ? AND event_id = ?').run(homeId, g.event_id as string);
  }
}

const running = new Map<string, Promise<void>>();

/** One full round: Google's changes first, then ours. One at a time per home. */
export function syncHome(db: DatabaseSync, homeId: string): Promise<void> {
  const busy = running.get(homeId);
  if (busy) return busy;
  const job = (async () => {
    const link = db.prepare('SELECT * FROM gcal_links WHERE home_id = ?').get(homeId) as Link | undefined;
    if (!link) return;
    try {
      const tz = timeZone();
      const { access_token } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: unseal(link.refresh_token) });
      const access = String(access_token);
      const changed = await pull(db, link, access, tz);
      await push(db, link, access, tz);
      db.prepare('UPDATE gcal_links SET last_sync = ?, last_error = NULL WHERE home_id = ?').run(nowIso(), homeId);
      if (changed) publish(homeId, { area: 'mealplan', by: null });
    } catch (err) {
      const msg = err instanceof GoogleError && (err.status === 400 || err.status === 401) && /invalid_grant|revoked|expired/i.test(err.message)
        ? 'Google turned off this connection. Connect again.'
        : (err as Error).message;
      db.prepare('UPDATE gcal_links SET last_error = ? WHERE home_id = ?').run(msg.slice(0, 300), homeId);
      throw err;
    }
  })().finally(() => running.delete(homeId));
  running.set(homeId, job);
  return job;
}

const soon = new Map<string, NodeJS.Timeout>();
/** After the plan changes, sync a few seconds later (several quick edits make one sync). */
function syncSoon(db: DatabaseSync, homeId: string, onError: (err: unknown) => void): void {
  if (!db.prepare('SELECT 1 FROM gcal_links WHERE home_id = ?').get(homeId)) return;
  clearTimeout(soon.get(homeId));
  soon.set(homeId, setTimeout(() => { soon.delete(homeId); syncHome(db, homeId).catch(onError); }, 5000).unref());
}

/** Every 15 minutes, sync every connected home. */
export function startCalendarSync(db: DatabaseSync, onError: (err: unknown) => void): void {
  const all = async () => {
    for (const r of db.prepare('SELECT home_id FROM gcal_links').all() as Row[]) {
      await syncHome(db, r.home_id as string).catch(onError);
    }
  };
  setTimeout(all, 60e3).unref();
  setInterval(all, EVERY_MS).unref();
}

export function calendarSyncRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const redirectUri = () => `${config.publicUrl}/api/gcal/callback`;

  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || reply.statusCode >= 400) return;
    const m = /^\/api\/homes\/([^/?]+)\/mealplan/.exec(req.url);
    if (m) syncSoon(db, m[1], (err) => req.log.warn({ err }, 'Google Calendar sync failed'));
  });

  app.get('/api/homes/:homeId/gcal', async (req) => {
    const ctx = homeCtx(db, req);
    const link = db.prepare('SELECT l.*, u.name AS by_name FROM gcal_links l LEFT JOIN users u ON u.id = l.user_id WHERE l.home_id = ?').get(ctx.homeId) as Row | undefined;
    return {
      available: !!config.google,
      connected: !!link,
      by: link?.by_name ?? null,
      lastSync: link?.last_sync ?? null,
      error: link?.last_error ?? null,
      calendarUrl: link ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(String(link.calendar_id))}` : null,
    };
  });

  // Sends a home manager to Google to say yes. Opened as a page, not with fetch.
  app.get('/api/homes/:homeId/gcal/connect', async (req, reply) => {
    const ctx = homeCtx(db, req, 'manager');
    if (!config.google) throw new HttpError(400, 'Google is not set up on this server. See the Google sign-in guide in the docs.');
    rateLimit(`gcal-connect:${ctx.homeId}`, 20, 3600e3);
    const verifier = randomToken(48);
    const state = randomToken(24);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    reply.setCookie(COOKIE, JSON.stringify({ verifier, state, homeId: ctx.homeId, userId: ctx.user!.id }), { ...cookieOpts(reply), maxAge: 600 });
    return reply.redirect(url.href);
  });

  app.get('/api/gcal/callback', async (req, reply) => {
    const raw = req.cookies[COOKIE];
    const un = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(COOKIE, { path: '/' });
    if (!un?.valid || !un.value) return reply.redirect('/settings?calendar=expired');
    const saved = JSON.parse(un.value) as { verifier: string; state: string; homeId: string; userId: string };
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error || !q.code) return reply.redirect('/settings?calendar=cancelled');
    if (q.state !== saved.state) return reply.redirect('/settings?calendar=expired');
    // Still a manager of that home?
    const role = db.prepare('SELECT role FROM home_members WHERE home_id = ? AND user_id = ?').get(saved.homeId, saved.userId) as Row | undefined;
    if (role?.role !== 'manager' && !db.prepare('SELECT 1 FROM users WHERE id = ? AND is_admin = 1').get(saved.userId)) return reply.redirect('/settings?calendar=expired');

    try {
      const tokens = await tokenRequest({ grant_type: 'authorization_code', code: q.code, redirect_uri: redirectUri(), code_verifier: saved.verifier });
      if (!tokens.refresh_token) throw new Error('Google did not give a lasting sign-in');
      const home = db.prepare('SELECT name FROM homes WHERE id = ?').get(saved.homeId) as Row | undefined;
      const cal = await google(String(tokens.access_token), 'POST', '/calendars', {
        summary: `${home?.name ?? 'Home'} meals`,
        description: `Meal plan from Nighttime Ninja (${config.publicUrl}). Move or delete meals here and the plan follows.`,
        timeZone: timeZone(),
      });
      db.prepare('DELETE FROM gcal_events WHERE home_id = ?').run(saved.homeId);
      db.prepare(`INSERT INTO gcal_links (home_id, user_id, refresh_token, calendar_id, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(home_id) DO UPDATE SET user_id = excluded.user_id, refresh_token = excluded.refresh_token, calendar_id = excluded.calendar_id,
        sync_token = NULL, last_sync = NULL, last_error = NULL, created_at = excluded.created_at`)
        .run(saved.homeId, saved.userId, seal(String(tokens.refresh_token)), String(cal?.id), nowIso());
    } catch (err) {
      req.log.warn({ err }, 'Connecting Google Calendar failed');
      return reply.redirect('/settings?calendar=failed');
    }
    syncHome(db, saved.homeId).catch((err) => req.log.warn({ err }, 'Google Calendar sync failed'));
    return reply.redirect('/settings?calendar=connected');
  });

  app.post('/api/homes/:homeId/gcal/sync', async (req) => {
    const ctx = homeCtx(db, req);
    if (!db.prepare('SELECT 1 FROM gcal_links WHERE home_id = ?').get(ctx.homeId)) throw new HttpError(404, 'Google Calendar is not connected');
    rateLimit(`gcal-sync:${ctx.homeId}`, 30, 3600e3);
    try {
      await syncHome(db, ctx.homeId);
    } catch (err) {
      throw new HttpError(502, `Couldn't sync with Google Calendar: ${(err as Error).message}`);
    }
    return { ok: true };
  });

  // Stops syncing. The calendar stays in Google with what it had; delete it there if you don't want it.
  app.delete('/api/homes/:homeId/gcal', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    const link = db.prepare('SELECT refresh_token FROM gcal_links WHERE home_id = ?').get(ctx.homeId) as Row | undefined;
    db.prepare('DELETE FROM gcal_events WHERE home_id = ?').run(ctx.homeId);
    db.prepare('DELETE FROM gcal_links WHERE home_id = ?').run(ctx.homeId);
    if (link) {
      try {
        await http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal(String(link.refresh_token)))}`, { method: 'POST' });
      } catch { /* Already gone at Google's end is fine. */ }
    }
    return { ok: true };
  });
}
