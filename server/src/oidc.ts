// Single sign-on with OpenID Connect: Tinyauth (the preset), Authelia, Pocket ID, Authentik, Keycloak...
// An admin adds a provider in Settings → Sign-in. People sign in with it from the sign-in page, link it to the account
// they already have from Settings → Security, or an admin links it for them from Settings → Users.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import * as oidc from 'openid-client';
import { config } from './config.ts';
import type { Row } from './db.ts';
import { createUser, cookieOpts, getUser, hasUsers, requireAdmin, requireUser, signupMode, startMfa, startSession, type User } from './auth.ts';
import { seal, unseal } from './gcal.ts';
import { limitAuth } from './security.ts';
import { HttpError, str } from './util.ts';

export type ProviderKind = 'tinyauth' | 'generic';

export interface Provider {
  id: string;
  kind: ProviderKind;
  name: string;
  issuer: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  auto_create: number;
  show_on_login: number;
}

/** Who the provider says signed in. email is only set when the provider says it's verified. */
export interface Identity { sub: string; username: string | null; email: string | null; name: string | null }

const COOKIE = 'nn_sso';

export const redirectUri = (id: string): string => `${config.publicUrl}/api/auth/sso/${id}/callback`;

export function getProvider(db: DatabaseSync, id: string): Provider | undefined {
  return db.prepare('SELECT * FROM oidc_providers WHERE id = ?').get(id) as Provider | undefined;
}

/** A short, URL-safe id from the name ("Tinyauth" → tinyauth). It's part of the redirect URI, so it never changes. */
export function providerSlug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'sso';
}

function uniqueSlug(db: DatabaseSync, name: string): string {
  const base = providerSlug(name);
  let id = base;
  for (let i = 2; db.prepare('SELECT 1 FROM oidc_providers WHERE id = ?').get(id); i++) id = `${base}-${i}`;
  return id;
}

// ---------- talking to the provider ----------

// Tests swap in a fake provider.
let customFetch: typeof fetch | null = null;
export function useOidcFetchForTests(f: typeof fetch | null): void { customFetch = f; discovered.clear(); }

const discovered = new Map<string, Promise<oidc.Configuration>>();
const cacheKey = (p: Provider) => `${p.id}|${p.issuer}|${p.client_id}|${p.client_secret}`;

function discover(p: Provider): Promise<oidc.Configuration> {
  const key = cacheKey(p);
  let cfg = discovered.get(key);
  if (!cfg) {
    const opts: oidc.DiscoveryRequestOptions = { timeout: 15 };
    if (customFetch) opts[oidc.customFetch] = customFetch as oidc.CustomFetch;
    // Plain http only for a provider on the home network; anything on the internet must use https.
    if (new URL(p.issuer).protocol === 'http:') opts.execute = [oidc.allowInsecureRequests];
    cfg = oidc.discovery(new URL(p.issuer), p.client_id, unseal(p.client_secret), undefined, opts)
      .then((c) => {
        if (customFetch) c[oidc.customFetch] = customFetch as oidc.CustomFetch;
        return c;
      })
      .catch((err) => { discovered.delete(key); throw err; });
    discovered.set(key, cfg);
  }
  return cfg;
}

function forget(id: string): void {
  for (const k of discovered.keys()) if (k.startsWith(`${id}|`)) discovered.delete(k);
}

function scopeFor(p: Provider): string {
  const extra = p.scopes.split(/[\s,]+/).filter((s) => /^[\w:.\-/]+$/.test(s));
  return [...new Set(['openid', 'profile', 'email', ...extra])].join(' ');
}

function identityFrom(claims: Record<string, unknown>): Identity {
  const s = (k: string, max = 200) => str(claims[k], max);
  const email = s('email')?.toLowerCase() ?? null;
  return {
    sub: String(claims.sub),
    username: s('preferred_username', 100),
    email: email && claims.email_verified === true && /^[^@\s]+@[^@\s]+$/.test(email) ? email : null,
    name: s('name', 60),
  };
}

// ---------- who is this? ----------

export type SignInResult = { user: User } | { error: 'closed' | 'invite' | 'notlinked' | 'disabled' };

/**
 * Finds (or makes) the account for someone a provider just signed in.
 * 1. Their link, by the provider's subject.
 * 2. A link an admin made by provider username before they first signed in (Tinyauth: always by username, because
 *    Tinyauth's subject changes if the client ID does).
 * 3. Providers you trust to create accounts: an account with the same verified email gets linked.
 * 4. Otherwise a new account, following the server's sign-up rules (trusted providers skip the join code).
 */
export function resolveSignIn(db: DatabaseSync, p: Provider, who: Identity, inviteHomeId: string | null): SignInResult {
  let link = db.prepare('SELECT * FROM oidc_links WHERE provider_id = ? AND subject = ?').get(p.id, who.sub) as Row | undefined;
  if (!link && who.username) {
    link = db.prepare(`SELECT * FROM oidc_links WHERE provider_id = ? AND username = ? ${p.kind === 'tinyauth' ? '' : 'AND subject IS NULL'}`)
      .get(p.id, who.username) as Row | undefined;
  }
  let user = link ? getUser(db, link.user_id as string) : undefined;
  if (!user && p.auto_create && who.email) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(who.email) as User | undefined;
    // Someone already linked to a different account at this provider keeps that link.
    if (byEmail && !db.prepare('SELECT 1 FROM oidc_links WHERE provider_id = ? AND user_id = ?').get(p.id, byEmail.id)) user = byEmail;
  }
  if (!user) {
    const first = !hasUsers(db);
    const mode = signupMode(db);
    if (!first && mode === 'closed') return { error: p.auto_create ? 'closed' : 'notlinked' };
    if (!first && !p.auto_create && mode === 'invite') {
      if (!inviteHomeId) return { error: 'notlinked' };
    }
    const emailTaken = !!who.email && !!db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(who.email);
    user = createUser(db, { name: who.name ?? who.username?.slice(0, 60) ?? who.email?.split('@')[0] ?? 'Cook', email: emailTaken ? null : who.email });
    if (!first && !p.auto_create && mode === 'invite' && inviteHomeId) {
      db.prepare("INSERT OR IGNORE INTO home_members (home_id, user_id, role) VALUES (?, ?, 'member')").run(inviteHomeId, user.id);
    }
  }
  if (user.disabled) return { error: 'disabled' };
  saveLink(db, p, user.id, who);
  return { user };
}

/** Ties this provider identity to a person. Throws 409 if it already belongs to someone else. */
export function saveLink(db: DatabaseSync, p: Provider, userId: string, who: Identity): void {
  const other = db.prepare('SELECT user_id FROM oidc_links WHERE provider_id = ? AND user_id != ? AND (subject = ? OR (? IS NOT NULL AND username = ?))')
    .get(p.id, userId, who.sub, who.username, who.username) as Row | undefined;
  if (other) {
    // A stale username on someone else's old link (they were renamed at the provider) shouldn't block this one.
    const bySub = db.prepare('SELECT 1 FROM oidc_links WHERE provider_id = ? AND user_id = ? AND subject = ?').get(p.id, other.user_id as string, who.sub);
    if (bySub || p.kind === 'tinyauth') throw new HttpError(409, `That ${p.name} account is already linked to someone else`);
    db.prepare('UPDATE oidc_links SET username = NULL WHERE provider_id = ? AND user_id = ?').run(p.id, other.user_id as string);
  }
  db.prepare(`INSERT INTO oidc_links (provider_id, user_id, subject, username, email) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (provider_id, user_id) DO UPDATE SET subject = excluded.subject, username = excluded.username, email = excluded.email`)
    .run(p.id, userId, who.sub, who.username, who.email);
}

/** True when the person could still get in without this provider link. */
function hasOtherWayIn(db: DatabaseSync, user: User, providerId: string): boolean {
  return !!(user.password_hash || user.google_sub || user.forward_user
    || db.prepare('SELECT 1 FROM passkeys WHERE user_id = ?').get(user.id)
    || db.prepare('SELECT 1 FROM oidc_links WHERE user_id = ? AND provider_id != ?').get(user.id, providerId));
}

function linksFor(db: DatabaseSync, userId: string) {
  return (db.prepare(`
    SELECT p.id, p.name, p.kind, l.username, l.email, l.subject IS NOT NULL AS confirmed, l.created_at AS linkedAt
    FROM oidc_providers p LEFT JOIN oidc_links l ON l.provider_id = p.id AND l.user_id = ?
    ORDER BY p.created_at`).all(userId) as Row[])
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, linked: r.linkedAt != null, username: r.username, email: r.email, confirmed: !!r.confirmed }));
}

// ---------- admin: provider settings ----------

function publicProvider(p: Provider) {
  return {
    id: p.id, kind: p.kind, name: p.name, issuer: p.issuer, clientId: p.client_id, hasSecret: !!p.client_secret,
    scopes: p.scopes, autoCreate: !!p.auto_create, showOnLogin: !!p.show_on_login, redirectUri: redirectUri(p.id),
  };
}

function cleanIssuer(v: unknown): string {
  const raw = str(v, 300);
  if (!raw) throw new HttpError(400, 'Issuer URL is required');
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Issuer URL should look like https://auth.example.com'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'Issuer URL should start with https://');
  // People paste the discovery address; the issuer is the part before it.
  return u.href.replace(/\/\.well-known\/openid-configuration\/?$/, '').replace(/\/$/, '');
}

function body(req: FastifyRequest): Row {
  const b = req.body;
  return b && typeof b === 'object' ? b as Row : {};
}

function readCookie(req: FastifyRequest): Row | null {
  const raw = req.cookies[COOKIE];
  const un = raw ? req.unsignCookie(raw) : null;
  if (!un?.valid || !un.value) return null;
  try { return JSON.parse(un.value) as Row; } catch { return null; }
}

export function ssoRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // ----- signing in, and linking from Settings → Security -----
  app.get('/api/auth/sso/:id', async (req, reply) => {
    const p = getProvider(db, (req.params as { id: string }).id);
    if (!p) throw new HttpError(404, 'That sign-in option is gone');
    limitAuth(req, 'sso');
    const link = (req.query as Row).link === '1';
    if (link) requireUser(req);
    let cfg: oidc.Configuration;
    try { cfg = await discover(p); } catch (err) {
      req.log.warn({ err }, `sso discovery failed for ${p.id}`);
      return reply.redirect(link ? '/settings/security?sso=unreachable' : '/?signin=unreachable');
    }
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri(p.id),
      scope: scopeFor(p),
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    reply.setCookie(COOKIE, JSON.stringify({ p: p.id, verifier, state, nonce, link: link ? req.user!.id : null }), { ...cookieOpts(reply), maxAge: 600 });
    return reply.redirect(url.href);
  });

  app.get('/api/auth/sso/:id/callback', async (req, reply) => {
    limitAuth(req, 'sso-callback');
    const p = getProvider(db, (req.params as { id: string }).id);
    const c = readCookie(req);
    reply.clearCookie(COOKIE, { path: '/' });
    const linking = typeof c?.link === 'string' ? c.link : null;
    const fail = (why: string) => reply.redirect(linking ? `/settings/security?sso=${why}` : `/?signin=${why}`);
    if (!p || !c || c.p !== p.id) return fail('expired');
    let who: Identity;
    try {
      const cfg = await discover(p);
      const tokens = await oidc.authorizationCodeGrant(cfg, new URL(req.url, config.publicUrl), {
        pkceCodeVerifier: String(c.verifier), expectedState: String(c.state), expectedNonce: String(c.nonce),
      });
      const claims = tokens.claims();
      if (!claims) return fail('failed');
      let all: Record<string, unknown> = { ...claims };
      // Some providers (Tinyauth among them) put the username and email only in userinfo.
      if (!all.preferred_username || !all.email) {
        try { all = { ...(await oidc.fetchUserInfo(cfg, tokens.access_token, claims.sub)), ...all }; } catch { /* the ID token is enough */ }
        for (const k of ['preferred_username', 'email', 'email_verified', 'name']) if (all[k] == null) delete all[k];
      }
      who = identityFrom(all);
    } catch (err) {
      req.log.warn({ err }, `sso callback failed for ${p.id}`);
      return fail('failed');
    }

    if (linking) {
      // The person who started linking must still be the one signed in here.
      if (!req.user || req.user.id !== linking) return fail('expired');
      try { saveLink(db, p, req.user.id, who); } catch { return fail('taken'); }
      return reply.redirect(`/settings/security?sso=linked&provider=${encodeURIComponent(p.id)}`);
    }

    const pending = req.cookies.nn_invite ? req.unsignCookie(req.cookies.nn_invite) : null;
    const home = pending?.valid && pending.value ? db.prepare('SELECT id FROM homes WHERE join_code = ?').get(pending.value) as Row | undefined : undefined;
    let result: SignInResult;
    try { result = resolveSignIn(db, p, who, (home?.id as string) ?? null); } catch { return fail('taken'); }
    if ('error' in result) return fail(result.error);
    if (home) reply.clearCookie('nn_invite', { path: '/' });
    const { user } = result;
    if (user.totp_enabled) return reply.redirect(`/?mfa=${encodeURIComponent(startMfa(db, user.id, p.id))}`);
    startSession(db, reply, user.id, p.name.slice(0, 40));
    return reply.redirect('/');
  });

  app.get('/api/auth/links', async (req) => {
    const user = requireUser(req);
    return { links: linksFor(db, user.id) };
  });

  app.delete('/api/auth/links/:id', async (req) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    if (!hasOtherWayIn(db, user, id)) throw new HttpError(400, 'Set a password or add a passkey first, so you can still sign in after unlinking');
    db.prepare('DELETE FROM oidc_links WHERE provider_id = ? AND user_id = ?').run(id, user.id);
    return { links: linksFor(db, user.id) };
  });

  // ----- admin: providers -----
  app.get('/api/admin/sso', async (req) => {
    requireAdmin(req);
    const rows = db.prepare('SELECT * FROM oidc_providers ORDER BY created_at').all() as unknown as Provider[];
    return { publicUrl: config.publicUrl, providers: rows.map(publicProvider) };
  });

  app.post('/api/admin/sso', async (req) => {
    requireAdmin(req);
    const b = body(req);
    const kind: ProviderKind = b.kind === 'tinyauth' ? 'tinyauth' : 'generic';
    const name = str(b.name, 40) ?? (kind === 'tinyauth' ? 'Tinyauth' : null);
    if (!name) throw new HttpError(400, 'Give it a name for the sign-in button');
    const clientId = str(b.clientId, 300);
    const secret = str(b.clientSecret, 500);
    if (!clientId || !secret) throw new HttpError(400, 'Client ID and client secret are both needed');
    const id = uniqueSlug(db, kind === 'tinyauth' ? 'tinyauth' : name);
    db.prepare(`INSERT INTO oidc_providers (id, kind, name, issuer, client_id, client_secret, scopes, auto_create, show_on_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, kind, name, cleanIssuer(b.issuer), clientId, seal(secret), str(b.scopes, 200) ?? '', b.autoCreate ? 1 : 0, b.showOnLogin === false ? 0 : 1);
    return publicProvider(getProvider(db, id)!);
  });

  app.patch('/api/admin/sso/:id', async (req) => {
    requireAdmin(req);
    const p = getProvider(db, (req.params as { id: string }).id);
    if (!p) throw new HttpError(404, 'No such sign-in option');
    const b = body(req);
    const name = b.name === undefined ? p.name : str(b.name, 40);
    if (!name) throw new HttpError(400, 'Give it a name for the sign-in button');
    const clientId = b.clientId === undefined ? p.client_id : str(b.clientId, 300);
    if (!clientId) throw new HttpError(400, 'Client ID is needed');
    // An empty secret keeps the saved one; it's never sent back to the browser.
    const secret = str(b.clientSecret, 500);
    db.prepare(`UPDATE oidc_providers SET name = ?, issuer = ?, client_id = ?, client_secret = ?, scopes = ?, auto_create = ?, show_on_login = ? WHERE id = ?`)
      .run(name, b.issuer === undefined ? p.issuer : cleanIssuer(b.issuer), clientId, secret ? seal(secret) : p.client_secret,
        b.scopes === undefined ? p.scopes : str(b.scopes, 200) ?? '',
        b.autoCreate === undefined ? p.auto_create : b.autoCreate ? 1 : 0,
        b.showOnLogin === undefined ? p.show_on_login : b.showOnLogin ? 1 : 0, p.id);
    forget(p.id);
    return publicProvider(getProvider(db, p.id)!);
  });

  app.delete('/api/admin/sso/:id', async (req) => {
    requireAdmin(req);
    const id = (req.params as { id: string }).id;
    // Don't strand anyone whose only way in is this provider.
    const stranded = (db.prepare('SELECT u.* FROM oidc_links l JOIN users u ON u.id = l.user_id WHERE l.provider_id = ?').all(id) as unknown as User[])
      .filter((u) => !hasOtherWayIn(db, u, id));
    if (stranded.length && (req.query as Row).force !== '1') {
      throw new HttpError(409, `${stranded.map((u) => u.name).join(', ')} can only sign in with this. Give them a temporary password under Users first.`);
    }
    db.prepare('DELETE FROM oidc_providers WHERE id = ?').run(id);
    forget(id);
    return { ok: true };
  });

  // Checks the issuer answers and looks like an OpenID provider, without signing anyone in.
  app.post('/api/admin/sso/:id/test', async (req) => {
    requireAdmin(req);
    const p = getProvider(db, (req.params as { id: string }).id);
    if (!p) throw new HttpError(404, 'No such sign-in option');
    forget(p.id);
    try {
      const meta = (await discover(p)).serverMetadata();
      return { ok: true, issuer: meta.issuer, authorization: meta.authorization_endpoint ?? null };
    } catch (err) {
      return { ok: false, error: (err as Error).message.slice(0, 300) };
    }
  });

  // ----- admin: link someone's account -----
  app.get('/api/admin/users/:userId/sso', async (req) => {
    requireAdmin(req);
    const { userId } = req.params as { userId: string };
    if (!getUser(db, userId)) throw new HttpError(404, 'No such person');
    return { links: linksFor(db, userId) };
  });

  // Links by the person's username at the provider. It's confirmed (and their subject saved) the first time they sign in.
  app.put('/api/admin/users/:userId/sso/:id', async (req) => {
    requireAdmin(req);
    const { userId, id } = req.params as { userId: string; id: string };
    const p = getProvider(db, id);
    if (!p) throw new HttpError(404, 'No such sign-in option');
    if (!getUser(db, userId)) throw new HttpError(404, 'No such person');
    const username = str(body(req).username, 100);
    if (!username) throw new HttpError(400, `Type their ${p.name} username`);
    const other = db.prepare('SELECT u.name FROM oidc_links l JOIN users u ON u.id = l.user_id WHERE l.provider_id = ? AND l.username = ? AND l.user_id != ?')
      .get(p.id, username, userId) as Row | undefined;
    if (other) throw new HttpError(409, `${username} is already linked to ${other.name}`);
    const cur = db.prepare('SELECT username FROM oidc_links WHERE provider_id = ? AND user_id = ?').get(p.id, userId) as Row | undefined;
    if (cur && String(cur.username ?? '').toLowerCase() === username.toLowerCase()) return { links: linksFor(db, userId) };
    db.prepare(`INSERT INTO oidc_links (provider_id, user_id, subject, username, email) VALUES (?, ?, NULL, ?, NULL)
      ON CONFLICT (provider_id, user_id) DO UPDATE SET subject = NULL, username = excluded.username, email = NULL`).run(p.id, userId, username);
    return { links: linksFor(db, userId) };
  });

  app.delete('/api/admin/users/:userId/sso/:id', async (req) => {
    requireAdmin(req);
    const { userId, id } = req.params as { userId: string; id: string };
    db.prepare('DELETE FROM oidc_links WHERE provider_id = ? AND user_id = ?').run(id, userId);
    return { links: linksFor(db, userId) };
  });
}

