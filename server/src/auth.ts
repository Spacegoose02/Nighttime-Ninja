import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import * as oidc from 'openid-client';
import { config } from './config.ts';
import { HttpError, newId, randomToken, readableCode, requireStr, sha256, str } from './util.ts';
import type { Row } from './db.ts';
import { isPrivateAddress, limitAuth } from './security.ts';

export const SESSION_COOKIE = 'nn_session';
const SESSION_DAYS = 60;

export interface User {
  id: string;
  email: string | null;
  name: string;
  username: string | null;
  avatar: string;
  theme: string;
  units: string;
  is_admin: number;
  disabled: number;
  last_home_id: string | null;
  google_sub: string | null;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number | null;
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
    /** Hash of the current session id, for "this device" in the sessions list. */
    sessionHash: string | null;
  }
}

/**
 * Cookies are only marked Secure when this request really came in over HTTPS. Basing it on PUBLIC_URL broke
 * sign-in for anyone reaching an https server by its plain-http LAN address (the browser silently dropped the cookie).
 */
export function cookieOpts(reply: FastifyReply) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: reply.request.protocol === 'https', signed: true };
}

// ---------- server-wide sign-in settings (admins can change these in the app) ----------

export type SignupMode = 'open' | 'invite' | 'closed';
export type LocalLogin = 'off' | 'lan' | 'anywhere';

export function getSetting(db: DatabaseSync, key: string): string | null {
  return ((db.prepare('SELECT value FROM server_settings WHERE key = ?').get(key) as Row | undefined)?.value as string) ?? null;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function signupMode(db: DatabaseSync): SignupMode {
  const v = getSetting(db, 'signupMode') ?? config.signupMode;
  return v === 'open' || v === 'closed' ? v : 'invite';
}

export function localLoginMode(db: DatabaseSync): LocalLogin {
  const v = getSetting(db, 'localLogin') ?? config.localLogin;
  return v === 'off' || v === 'anywhere' ? v : 'lan';
}

/** Name-only sign-in: never from the internet unless an admin explicitly chose "anywhere". */
export function localLoginAllowed(db: DatabaseSync, req: FastifyRequest): boolean {
  const mode = localLoginMode(db);
  return mode === 'anywhere' || (mode === 'lan' && isPrivateAddress(req.ip));
}

export const hasUsers = (db: DatabaseSync): boolean => !!db.prepare('SELECT 1 FROM users LIMIT 1').get();

// ---------- sessions ----------

export function startSession(db: DatabaseSync, reply: FastifyReply, userId: string, method: string): void {
  const id = randomToken();
  const req = reply.request;
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, method, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(sha256(id), userId, expires, str(req.headers['user-agent'], 300), req.ip, method);
  reply.setCookie(SESSION_COOKIE, id, { ...cookieOpts(reply), maxAge: SESSION_DAYS * 86400 });
}

/** Two-factor step: a short-lived ticket the browser trades, along with a code, for a session. */
export function startMfa(db: DatabaseSync, userId: string, method: string): string {
  const id = randomToken();
  db.prepare('DELETE FROM mfa_tickets WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO mfa_tickets (id, user_id, method, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(id), userId, method, new Date(Date.now() + 5 * 60e3).toISOString());
  return id;
}

export function getUser(db: DatabaseSync, id: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

/** Creates a user. The very first account on a server becomes its admin. */
export function createUser(db: DatabaseSync, u: { name: string; username?: string | null; email?: string | null; googleSub?: string | null; passwordHash?: string | null }): User {
  const id = newId();
  db.prepare('INSERT INTO users (id, name, username, email, google_sub, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, u.name, u.username ?? null, u.email ?? null, u.googleSub ?? null, u.passwordHash ?? null, hasUsers(db) ? 0 : 1);
  return getUser(db, id)!;
}

/** Accounts protected by a password, Google, two-factor or a passkey can never be used through name-only sign-in. */
function isQuickAccount(db: DatabaseSync, u: User): boolean {
  return !u.password_hash && !u.google_sub && !u.email && !u.totp_enabled
    && !db.prepare('SELECT 1 FROM passkeys WHERE user_id = ?').get(u.id);
}

/** Resolves the caller from the session cookie, a bearer session, or a home API token. */
export function installAuth(app: FastifyInstance, db: DatabaseSync): void {
  app.decorateRequest('user', null);
  app.decorateRequest('tokenHomeId', null);
  app.decorateRequest('sessionHash', null);
  app.addHook('onRequest', async (req) => {
    req.user = null;
    req.tokenHomeId = null;
    req.sessionHash = null;
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
    const hash = sha256(sessionId);
    const row = db.prepare(`
      SELECT u.*, s.last_seen_at AS session_seen FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`).get(hash, new Date().toISOString()) as (User & { session_seen: string | null }) | undefined;
    if (!row) return;
    req.user = row;
    req.sessionHash = hash;
    if (!row.session_seen || Date.parse(`${row.session_seen.replace(' ', 'T')}Z`) < Date.now() - 5 * 60e3) {
      db.prepare("UPDATE sessions SET last_seen_at = datetime('now'), ip = ? WHERE id = ?").run(req.ip, hash);
    }
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
    id: u.id, name: u.name, username: u.username, email: u.email, avatar: u.avatar, theme: u.theme, units: u.units,
    isAdmin: !!u.is_admin, lastHomeId: u.last_home_id,
  };
}

export function registerAuthRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/auth/config', async (req) => ({
    google: !!config.google,
    local: localLoginAllowed(db, req),
    passwords: true,
    passkeys: true,
    signup: hasUsers(db) ? signupMode(db) : 'first',
  }));

  // Name-only sign-in for trusted home networks.
  app.post('/api/auth/local', async (req, reply) => {
    if (!localLoginAllowed(db, req)) throw new HttpError(403, 'Quick sign-in only works on your home network. Use your password, a passkey or Google.');
    limitAuth(req, 'local');
    const name = requireStr((req.body as Row)?.name, 'Name', 60);
    const existing = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE ORDER BY created_at').all(name) as unknown as User[];
    let user = existing.find((u) => isQuickAccount(db, u) && !u.disabled);
    if (!user) {
      if (existing.length) throw new HttpError(403, `${name} has a password or passkey. Sign in with that instead.`);
      if (hasUsers(db) && signupMode(db) === 'closed') throw new HttpError(403, 'New accounts are turned off on this server');
      user = createUser(db, { name });
    }
    startSession(db, reply, user.id, 'quick');
    return { user: publicUser(user) };
  });

  app.get('/api/auth/google', async (_req, reply) => {
    const cfg = await google();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      prompt: 'select_account',
    });
    reply.setCookie('nn_oidc', JSON.stringify({ verifier, state, nonce }), { ...cookieOpts(reply), maxAge: 600 });
    return reply.redirect(url.href);
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const cfg = await google();
    const raw = req.cookies.nn_oidc;
    const un = raw ? req.unsignCookie(raw) : null;
    if (!un?.valid || !un.value) return reply.redirect('/?signin=expired');
    reply.clearCookie('nn_oidc', { path: '/' });
    const { verifier, state, nonce } = JSON.parse(un.value) as { verifier: string; state: string; nonce: string };
    const current = new URL(req.url, config.publicUrl);
    const tokens = await oidc.authorizationCodeGrant(cfg, current, { pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce });
    const claims = tokens.claims();
    if (!claims) throw new HttpError(400, 'Google did not return an identity');
    const email = typeof claims.email === 'string' && claims.email_verified ? claims.email.toLowerCase() : null;
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub) as User | undefined;
    if (!user && email) {
      user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) as User | undefined;
      if (user) db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(claims.sub, user.id);
    }
    if (!user) {
      const mode = signupMode(db);
      if (hasUsers(db) && mode !== 'open') {
        // Invite-only servers: you join by using a home's join code, which links this Google account.
        if (mode === 'closed') return reply.redirect('/?signin=closed');
        const pending = req.cookies.nn_invite ? req.unsignCookie(req.cookies.nn_invite) : null;
        const home = pending?.valid && pending.value ? db.prepare('SELECT id FROM homes WHERE join_code = ?').get(pending.value) as Row | undefined : undefined;
        if (!home) return reply.redirect('/?signin=invite');
        user = createUser(db, { name: str(claims.name, 60) ?? email?.split('@')[0] ?? 'Cook', email, googleSub: claims.sub });
        db.prepare("INSERT OR IGNORE INTO home_members (home_id, user_id, role) VALUES (?, ?, 'member')").run(home.id as string, user.id);
        reply.clearCookie('nn_invite', { path: '/' });
      } else {
        user = createUser(db, { name: str(claims.name, 60) ?? email?.split('@')[0] ?? 'Cook', email, googleSub: claims.sub });
      }
    }
    if (user.disabled) return reply.redirect('/?signin=disabled');
    if (user.totp_enabled) return reply.redirect(`/?mfa=${encodeURIComponent(startMfa(db, user.id, 'google'))}`);
    startSession(db, reply, user.id, 'google');
    return reply.redirect('/');
  });

  // Remembers a join code across the Google round trip for invite-only servers.
  app.post('/api/auth/invite', async (req, reply) => {
    const code = requireStr((req.body as Row)?.code, 'Join code', 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    limitAuth(req, 'invite');
    if (!db.prepare('SELECT 1 FROM homes WHERE join_code = ?').get(code)) throw new HttpError(404, 'No home has that join code');
    reply.setCookie('nn_invite', code, { ...cookieOpts(reply), maxAge: 900 });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Pairing lets a tablet or app sign in without typing a password on it.
  app.post('/api/auth/pair-code', async (req) => {
    const user = requireUser(req);
    db.prepare('DELETE FROM pair_codes WHERE expires_at < ? OR user_id = ?').run(new Date().toISOString(), user.id);
    const code = readableCode(8);
    const expires = new Date(Date.now() + 10 * 60e3).toISOString();
    db.prepare('INSERT INTO pair_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, user.id, expires);
    return { code, expiresAt: expires };
  });

  app.post('/api/auth/pair', async (req, reply) => {
    limitAuth(req, 'pair');
    const code = requireStr((req.body as Row)?.code, 'Code', 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = db.prepare('SELECT user_id FROM pair_codes WHERE code = ? AND expires_at > ?').get(code, new Date().toISOString()) as Row | undefined;
    if (!row) throw new HttpError(400, 'That code is wrong or expired. Codes last 10 minutes and work once.');
    db.prepare('DELETE FROM pair_codes WHERE code = ?').run(code);
    const user = getUser(db, row.user_id as string);
    if (!user || user.disabled) throw new HttpError(403, 'That account is turned off');
    startSession(db, reply, user.id, 'pairing');
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
    // Drawn raccoons plus any picture avatars shipped in web/src/avatars (ids are derived from file names).
    const isAvatarId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_]{2,40}$/.test(v);
    const name = str(b.name, 60);
    if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    if (typeof b.theme === 'string' && themes.includes(b.theme)) db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(b.theme, user.id);
    if (isAvatarId(b.avatar)) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(b.avatar, user.id);
    if (b.units === 'us' || b.units === 'metric' || b.units === 'original') db.prepare('UPDATE users SET units = ? WHERE id = ?').run(b.units, user.id);
    if (typeof b.lastHomeId === 'string') db.prepare('UPDATE users SET last_home_id = ? WHERE id = ?').run(b.lastHomeId, user.id);
    return { user: publicUser(getUser(db, user.id)!) };
  });
}
