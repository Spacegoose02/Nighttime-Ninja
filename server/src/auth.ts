import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import * as oidc from 'openid-client';
import { config } from './config.ts';
import { HttpError, newId, randomToken, readableCode, requireStr, sha256, str } from './util.ts';
import type { Row } from './db.ts';

export const SESSION_COOKIE = 'nn_session';
const SESSION_DAYS = 60;

export interface User {
  id: string;
  email: string | null;
  name: string;
  avatar: string;
  theme: string;
  units: string;
  is_admin: number;
  last_home_id: string | null;
}

export type Role = 'manager' | 'member';

export interface HomeCtx {
  user: User | null;
  homeId: string;
  role: Role;
  /** True when the request came from an API token (e.g. Home Assistant) rather than a person. */
  viaToken: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    tokenHomeId: string | null;
  }
}

const cookieOpts = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.publicUrl.startsWith('https://'),
  signed: true,
};

export function createSession(db: DatabaseSync, userId: string): string {
  const id = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(id), userId, expires);
  return id;
}

function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, { ...cookieOpts, maxAge: SESSION_DAYS * 86400 });
}

/** Finds an existing user or creates one. The very first account on a server becomes its admin. */
export function upsertUser(db: DatabaseSync, u: { name: string; email?: string | null; googleSub?: string | null }): User {
  let row: Row | undefined;
  if (u.googleSub) row = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(u.googleSub) as Row | undefined;
  if (!row && u.email) row = db.prepare('SELECT * FROM users WHERE email = ?').get(u.email) as Row | undefined;
  if (!row && !u.googleSub && !u.email) {
    row = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE AND google_sub IS NULL AND email IS NULL').get(u.name) as Row | undefined;
  }
  if (row) {
    if (u.googleSub && !row.google_sub) db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(u.googleSub, row.id as string);
    return row as unknown as User;
  }
  const isFirst = !(db.prepare('SELECT 1 FROM users LIMIT 1').get());
  const id = newId();
  db.prepare('INSERT INTO users (id, name, email, google_sub, is_admin) VALUES (?, ?, ?, ?, ?)')
    .run(id, u.name, u.email ?? null, u.googleSub ?? null, isFirst ? 1 : 0);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as User;
}

/** Resolves the caller from the session cookie, a bearer session, or a home API token. */
export function installAuth(app: FastifyInstance, db: DatabaseSync): void {
  app.decorateRequest('user', null);
  app.decorateRequest('tokenHomeId', null);
  app.addHook('onRequest', async (req) => {
    req.user = null;
    req.tokenHomeId = null;
    let sessionId: string | null = null;
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const un = req.unsignCookie(raw);
      if (un.valid) sessionId = un.value;
    }
    const authz = req.headers.authorization;
    if (!sessionId && authz?.startsWith('Bearer ')) {
      const token = authz.slice(7).trim();
      if (token.startsWith('nnk_')) {
        const t = db.prepare('SELECT id, home_id FROM api_tokens WHERE token_hash = ?').get(sha256(token)) as Row | undefined;
        if (t) {
          req.tokenHomeId = t.home_id as string;
          db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(t.id as string);
        }
        return;
      }
      sessionId = token;
    }
    if (!sessionId) return;
    const user = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`).get(sha256(sessionId), new Date().toISOString()) as User | undefined;
    req.user = user ?? null;
  });
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, 'Please sign in');
  return req.user;
}

export function requireAdmin(req: FastifyRequest): User {
  const u = requireUser(req);
  if (!u.is_admin) throw new HttpError(403, 'Server admins only');
  return u;
}

/** Checks the caller can act in a home. Server admins act as managers everywhere. */
export function homeCtx(db: DatabaseSync, req: FastifyRequest, minRole: Role = 'member'): HomeCtx {
  const homeId = (req.params as { homeId?: string }).homeId;
  if (!homeId) throw new HttpError(400, 'Missing home');
  if (req.tokenHomeId) {
    if (req.tokenHomeId !== homeId) throw new HttpError(403, 'Token is for a different home');
    if (minRole === 'manager') throw new HttpError(403, 'Tokens cannot manage a home');
    return { user: null, homeId, role: 'member', viaToken: true };
  }
  const user = requireUser(req);
  const m = db.prepare('SELECT role FROM home_members WHERE home_id = ? AND user_id = ?').get(homeId, user.id) as Row | undefined;
  let role = m?.role as Role | undefined;
  if (!role && user.is_admin && db.prepare('SELECT 1 FROM homes WHERE id = ?').get(homeId)) role = 'manager';
  if (!role) throw new HttpError(404, 'Home not found');
  if (minRole === 'manager' && role !== 'manager') throw new HttpError(403, 'Home managers only');
  return { user, homeId, role, viaToken: false };
}

let googleConfig: Promise<oidc.Configuration> | null = null;
function google(): Promise<oidc.Configuration> {
  if (!config.google) throw new HttpError(404, 'Google sign-in is not configured');
  googleConfig ??= oidc.discovery(new URL('https://accounts.google.com'), config.google.clientId, config.google.clientSecret)
    .catch((err) => { googleConfig = null; throw err; });
  return googleConfig;
}

export function publicUser(u: User) {
  return {
    id: u.id, name: u.name, email: u.email, avatar: u.avatar, theme: u.theme, units: u.units,
    isAdmin: !!u.is_admin, lastHomeId: u.last_home_id,
  };
}

export function registerAuthRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/auth/config', async () => ({
    google: !!config.google,
    local: config.allowLocalLogin,
  }));

  app.post('/api/auth/local', async (req, reply) => {
    if (!config.allowLocalLogin) throw new HttpError(403, 'Local sign-in is turned off on this server');
    const name = requireStr((req.body as Row)?.name, 'Name', 60);
    const user = upsertUser(db, { name });
    setSessionCookie(reply, createSession(db, user.id));
    return { user: publicUser(user) };
  });

  app.get('/api/auth/google', async (_req, reply) => {
    const cfg = await google();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    });
    reply.setCookie('nn_oidc', JSON.stringify({ verifier, state }), { ...cookieOpts, maxAge: 600 });
    return reply.redirect(url.href);
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const cfg = await google();
    const raw = req.cookies.nn_oidc;
    const un = raw ? req.unsignCookie(raw) : null;
    if (!un?.valid || !un.value) throw new HttpError(400, 'Sign-in expired, please try again');
    const { verifier, state } = JSON.parse(un.value) as { verifier: string; state: string };
    const current = new URL(req.url, config.publicUrl);
    const tokens = await oidc.authorizationCodeGrant(cfg, current, { pkceCodeVerifier: verifier, expectedState: state });
    const claims = tokens.claims();
    if (!claims) throw new HttpError(400, 'Google did not return an identity');
    const email = typeof claims.email === 'string' && claims.email_verified ? claims.email : null;
    const user = upsertUser(db, {
      name: str(claims.name, 60) ?? email?.split('@')[0] ?? 'Cook',
      email,
      googleSub: claims.sub,
    });
    reply.clearCookie('nn_oidc', { path: '/' });
    setSessionCookie(reply, createSession(db, user.id));
    return reply.redirect('/');
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    const un = raw ? req.unsignCookie(raw) : null;
    if (un?.valid && un.value) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(un.value));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Pairing lets a tablet or app sign in without typing a Google password on it.
  app.post('/api/auth/pair-code', async (req) => {
    const user = requireUser(req);
    db.prepare('DELETE FROM pair_codes WHERE expires_at < ?').run(new Date().toISOString());
    const code = readableCode(6);
    const expires = new Date(Date.now() + 10 * 60e3).toISOString();
    db.prepare('INSERT INTO pair_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, user.id, expires);
    return { code, expiresAt: expires };
  });

  app.post('/api/auth/pair', async (req, reply) => {
    const code = requireStr((req.body as Row)?.code, 'Code', 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = db.prepare('SELECT user_id FROM pair_codes WHERE code = ? AND expires_at > ?').get(code, new Date().toISOString()) as Row | undefined;
    if (!row) throw new HttpError(400, 'That code is wrong or expired');
    db.prepare('DELETE FROM pair_codes WHERE code = ?').run(code);
    setSessionCookie(reply, createSession(db, row.user_id as string));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id as string) as unknown as User;
    return { user: publicUser(user) };
  });

  app.get('/api/me', async (req) => {
    const user = requireUser(req);
    const homes = db.prepare(`
      SELECT h.id, h.name, m.role FROM home_members m JOIN homes h ON h.id = m.home_id
      WHERE m.user_id = ? ORDER BY h.name`).all(user.id);
    return { user: publicUser(user), homes };
  });

  app.patch('/api/me', async (req) => {
    const user = requireUser(req);
    const b = (req.body ?? {}) as Row;
    const themes = ['forest', 'midnight', 'citrus', 'raccoon', 'berry', 'ocean'];
    const avatars = ['classic', 'chef', 'bandana', 'glasses', 'baker', 'ninja', 'grill', 'sushi'];
    const name = str(b.name, 60);
    if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    if (typeof b.theme === 'string' && themes.includes(b.theme)) db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(b.theme, user.id);
    if (typeof b.avatar === 'string' && avatars.includes(b.avatar)) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(b.avatar, user.id);
    if (b.units === 'us' || b.units === 'metric' || b.units === 'original') db.prepare('UPDATE users SET units = ? WHERE id = ?').run(b.units, user.id);
    if (typeof b.lastHomeId === 'string') db.prepare('UPDATE users SET last_home_id = ? WHERE id = ?').run(b.lastHomeId, user.id);
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as User) };
  });
}
