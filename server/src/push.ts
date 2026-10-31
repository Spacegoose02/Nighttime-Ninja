// Reminders on your phone or computer, sent with Web Push: food about to expire, tomorrow's dinner,
// and things other people put on the shopping list. Works in browsers and installed web apps; the
// Android app's WebView can't receive them yet.
import webpush from 'web-push';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { getSetting, requireUser, setSetting } from './auth.ts';
import { config } from './config.ts';
import type { Row } from './db.ts';
import { body, flag, text } from './schemas.ts';
import { publicFetch } from './security.ts';
import { HttpError, parseJson, str } from './util.ts';

export interface ReminderPrefs { expiring: boolean; plan: boolean; list: boolean }
export interface Reminder { title: string; body: string; url: string }

const KINDS = ['expiring', 'plan', 'list'] as const;
/** Morning heads-up about food going off, and the evening one about tomorrow's meals, in the server's time zone (TZ). */
const MORNING = 9;
const EVENING = 17;
/** Several things added in a row make one reminder, not one each. */
const LIST_QUIET_MINUTES = 20;

/** The server's VAPID keys, made the first time they're needed and kept in the database. */
export function vapidKeys(db: DatabaseSync): { publicKey: string; privateKey: string } {
  const saved = parseJson<{ publicKey: string; privateKey: string } | null>(getSetting(db, 'vapid'), null);
  if (saved) return saved;
  const keys = webpush.generateVAPIDKeys();
  setSetting(db, 'vapid', JSON.stringify(keys));
  return keys;
}

export function reminderPrefs(db: DatabaseSync, userId: string): ReminderPrefs {
  const row = db.prepare('SELECT reminders FROM users WHERE id = ?').get(userId) as Row | undefined;
  const saved = parseJson<Partial<ReminderPrefs>>(row?.reminders, {});
  return { expiring: saved.expiring !== false, plan: saved.plan !== false, list: saved.list !== false };
}

/** Sends to every device the person turned reminders on for. Devices that have gone away are forgotten. */
export async function sendTo(db: DatabaseSync, userId: string, r: Reminder): Promise<number> {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId) as Row[];
  if (!subs.length) return 0;
  const keys = vapidKeys(db);
  const subject = config.publicUrl.startsWith('https://') ? config.publicUrl : 'mailto:reminders@nighttime-ninja.invalid';
  let sent = 0;
  for (const s of subs) {
    try {
      const req = webpush.generateRequestDetails(
        { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
        JSON.stringify(r),
        { vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 12 * 3600 },
      );
      // Sent with publicFetch so a made-up endpoint can't make the server call into a private network.
      const res = await publicFetch(req.endpoint, { method: req.method, headers: req.headers as Record<string, string>, body: req.body ? new Uint8Array(req.body) : undefined });
      await res.body?.cancel();
      if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint as string);
      else if (res.ok) sent++;
    } catch { /* one bad device shouldn't stop the rest */ }
  }
  return sent;
}

/** Marks a reminder as sent; false if it already was. */
function once(db: DatabaseSync, key: string): boolean {
  return db.prepare('INSERT OR IGNORE INTO reminders_sent (key) VALUES (?)').run(key).changes > 0;
}

const list = (names: string[], max = 4) => names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

/** The reminders due now for each person with a device signed up. Each goes out at most once a day. */
export function dueReminders(db: DatabaseSync, now = new Date()): { userId: string; key: string; reminder: Reminder }[] {
  const out: { userId: string; key: string; reminder: Reminder }[] = [];
  const hour = now.getHours();
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = local(now);
  const tomorrow = local(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const people = db.prepare(`SELECT DISTINCT u.id, u.reminders, m.home_id, h.name AS home FROM users u
    JOIN push_subscriptions p ON p.user_id = u.id JOIN home_members m ON m.user_id = u.id JOIN homes h ON h.id = m.home_id`).all() as Row[];
  for (const p of people) {
    const prefs = { expiring: true, plan: true, ...parseJson<Partial<ReminderPrefs>>(p.reminders, {}) };
    const userId = p.id as string;
    const homeId = p.home_id as string;
    if (prefs.expiring && hour >= MORNING) {
      const items = db.prepare(`SELECT name FROM items WHERE home_id = ? AND quantity > 0 AND expires_on IS NOT NULL
        AND expires_on >= ? AND expires_on <= date(?, '+2 day') ORDER BY expires_on, name`).all(homeId, today, today) as Row[];
      if (items.length) {
        out.push({ userId, key: `expiring:${userId}:${homeId}:${today}`, reminder: {
          title: `Use soon at ${p.home}`,
          body: `${list(items.map((i) => i.name as string))} ${items.length === 1 ? 'goes' : 'go'} off in the next couple of days.`,
          url: '/recipes?useup=1',
        } });
      }
    }
    if (prefs.plan && hour >= EVENING) {
      const meals = db.prepare(`SELECT COALESCE(r.title, mp.title) AS title, mp.slot, u.name AS cook FROM meal_plan mp
        LEFT JOIN recipes r ON r.id = mp.recipe_id LEFT JOIN users u ON u.id = mp.cook_id
        WHERE mp.home_id = ? AND mp.date = ? AND mp.cooked_at IS NULL
        ORDER BY CASE mp.slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'snack' THEN 2 ELSE 3 END`).all(homeId, tomorrow) as Row[];
      if (meals.length) {
        const frozen = db.prepare("SELECT COUNT(*) AS n FROM items WHERE home_id = ? AND quantity > 0 AND frozen_on IS NOT NULL").get(homeId) as Row;
        out.push({ userId, key: `plan:${userId}:${homeId}:${today}`, reminder: {
          title: 'Tomorrow',
          body: `${meals.map((m) => `${m.slot}: ${m.title}${m.cook ? ` (${m.cook} cooking)` : ''}`).join('; ')}.${Number(frozen.n) ? ' Anything to take out of the freezer?' : ''}`,
          url: '/plan',
        } });
      }
    }
  }
  return out;
}

/** Sends whatever's due that hasn't gone out yet. */
export async function sendDue(db: DatabaseSync, now = new Date()): Promise<number> {
  let n = 0;
  for (const d of dueReminders(db, now)) if (once(db, d.key)) n += await sendTo(db, d.userId, d.reminder);
  // Old markers are only needed for a day or two.
  db.prepare("DELETE FROM reminders_sent WHERE sent_at < datetime('now', '-3 day')").run();
  return n;
}

/** Tells the rest of the home what someone just put on the shopping list, unless they heard about it a moment ago. */
export async function listAdded(db: DatabaseSync, homeId: string, byUserId: string | null, names: string[]): Promise<void> {
  if (!names.length || !byUserId) return;
  const by = db.prepare('SELECT name FROM users WHERE id = ?').get(byUserId) as Row | undefined;
  const others = db.prepare(`SELECT DISTINCT m.user_id FROM home_members m JOIN push_subscriptions p ON p.user_id = m.user_id
    WHERE m.home_id = ? AND m.user_id != ?`).all(homeId, byUserId) as Row[];
  for (const o of others) {
    const userId = o.user_id as string;
    if (!reminderPrefs(db, userId).list) continue;
    const key = `list:${userId}:${homeId}`;
    const last = db.prepare('SELECT sent_at FROM reminders_sent WHERE key = ?').get(key) as Row | undefined;
    if (last && Date.parse(`${last.sent_at}Z`) > Date.now() - LIST_QUIET_MINUTES * 60_000) continue;
    db.prepare("INSERT INTO reminders_sent (key, sent_at) VALUES (?, datetime('now')) ON CONFLICT(key) DO UPDATE SET sent_at = excluded.sent_at").run(key);
    await sendTo(db, userId, { title: `${by?.name ?? 'Someone'} added to the list`, body: list(names), url: '/shopping' });
  }
}

/** Checks for due reminders every 15 minutes while the server runs. */
export function startReminders(db: DatabaseSync, log: (err: unknown) => void): () => void {
  const tick = () => { sendDue(db).catch(log); };
  const first = setTimeout(tick, 60_000);
  const every = setInterval(tick, 15 * 60_000);
  first.unref(); every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}

export function pushRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/push', async (req) => {
    const user = requireUser(req);
    const devices = (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(user.id) as Row).n;
    return { publicKey: vapidKeys(db).publicKey, prefs: reminderPrefs(db, user.id), devices };
  });

  app.post('/api/push/subscribe', { schema: body({ endpoint: text, p256dh: text, auth: text }, ['endpoint', 'p256dh', 'auth']) }, async (req) => {
    const user = requireUser(req);
    const b = req.body as Row;
    const endpoint = str(b.endpoint, 1000);
    if (!endpoint?.startsWith('https://')) throw new HttpError(400, "That doesn't look like a notification address");
    const p256dh = str(b.p256dh, 200);
    const auth = str(b.auth, 100);
    if (!p256dh || !auth) throw new HttpError(400, 'Missing notification keys');
    if ((db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(user.id) as Row).n as number >= 20) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = (SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at LIMIT 1)').run(user.id);
    }
    db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).run(endpoint, user.id, p256dh, auth);
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', { schema: body({ endpoint: text }, ['endpoint']) }, async (req) => {
    const user = requireUser(req);
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String((req.body as Row).endpoint), user.id);
    return { ok: true };
  });

  app.put('/api/push/prefs', { schema: body({ expiring: flag, plan: flag, list: flag }) }, async (req) => {
    const user = requireUser(req);
    const b = req.body as Row;
    const old = reminderPrefs(db, user.id);
    // Only ever the three switches, as plain booleans.
    const prefs: ReminderPrefs = { expiring: old.expiring, plan: old.plan, list: old.list };
    for (const k of KINDS) if (typeof b[k] === 'boolean') prefs[k] = b[k] === true;
    db.prepare('UPDATE users SET reminders = ? WHERE id = ?').run(JSON.stringify(prefs), user.id);
    return prefs;
  });

  app.post('/api/push/test', async (req) => {
    const user = requireUser(req);
    const sent = await sendTo(db, user.id, { title: 'Nighttime Ninja', body: 'Reminders are on. 🦝', url: '/' });
    if (!sent) throw new HttpError(502, "Couldn't reach this device. Try turning reminders off and on again.");
    return { sent };
  });
}
