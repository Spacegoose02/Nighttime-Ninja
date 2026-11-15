// Single sign-on with OpenID Connect (Tinyauth preset): admin setup, signing in, and linking accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-oidc-'));
process.env.SIGNUP_MODE = 'invite';
process.env.LOCAL_LOGIN = 'lan';
process.env.PUBLIC_URL = 'https://kitchen.test';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { useOidcFetchForTests, providerSlug } = await import('./oidc.ts');
const { createUser } = await import('./auth.ts');

const ISSUER = 'https://auth.test';
// Made-up test values; a real client's ID and secret only ever go in the running app's settings.
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

/** A tiny pretend Tinyauth: discovery, token and userinfo. The test says who signs in next. */
function fakeProvider() {
  const state = { who: { sub: 'sub-mom', preferred_username: 'mom', email: 'mom@example.com', email_verified: true, name: 'Mom' } as Record<string, unknown>, nonce: '' };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const json = (o: object) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/api/oidc/token`,
        userinfo_endpoint: `${ISSUER}/api/oidc/userinfo`, jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      });
    }
    if (url.pathname === '/api/oidc/token') {
      const form = new URLSearchParams(String(init?.body ?? ''));
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      const basic = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString() : '';
      const okClient = basic === `${CLIENT_ID}:${CLIENT_SECRET}` || (form.get('client_id') === CLIENT_ID && form.get('client_secret') === CLIENT_SECRET);
      if (!okClient) return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401, headers: { 'content-type': 'application/json' } });
      const now = Math.floor(Date.now() / 1000);
      // Only sub in the ID token, like Tinyauth: the rest comes from userinfo.
      const idToken = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: ISSUER, aud: CLIENT_ID, sub: state.who.sub, iat: now, exp: now + 300, nonce: state.nonce })}.c2ln`;
      return json({ access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    if (url.pathname === '/api/oidc/userinfo') return json(state.who);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { f, state };
}

async function setup() {
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });
  const fake = fakeProvider();
  useOidcFetchForTests(fake.f);
  const req = async (method: string, url: string, payload?: unknown, cookie?: string | null) => {
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: cookie ? { cookie } : {}, remoteAddress: '127.0.0.1' });
    const session = res.cookies.find((c) => c.name === 'nn_session' && c.value);
    return {
      status: res.statusCode, body: res.body && res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : null,
      location: res.headers.location as string | undefined, cookie: session ? `nn_session=${session.value}` : null, cookies: res.cookies,
    };
  };
  /** Runs the whole redirect dance as whoever fake.state.who is. */
  const sso = async (id: string, cookie?: string | null, link = false) => {
    const start = await req('GET', `/api/auth/sso/${id}${link ? '?link=1' : ''}`, undefined, cookie);
    assert.equal(start.status, 302, JSON.stringify(start.body));
    const to = new URL(start.location!);
    assert.equal(to.origin + to.pathname, `${ISSUER}/authorize`);
    assert.equal(to.searchParams.get('redirect_uri'), `https://kitchen.test/api/auth/sso/${id}/callback`);
    fake.state.nonce = to.searchParams.get('nonce')!;
    const ssoCookie = start.cookies.find((c) => c.name === 'nn_sso')!;
    const jar = [`nn_sso=${ssoCookie.value}`, cookie].filter(Boolean).join('; ');
    return req('GET', `/api/auth/sso/${id}/callback?code=abc&state=${to.searchParams.get('state')}`, undefined, jar);
  };
  const admin = await req('POST', '/api/auth/register', { username: 'owner', password: 'raccoons love snacks', name: 'Owner' });
  return { db, req, sso, fake, adminCookie: admin.cookie!, adminId: admin.body.user.id as string };
}

test('slugs for the redirect address', () => {
  assert.equal(providerSlug('Tinyauth'), 'tinyauth');
  assert.equal(providerSlug('Pocket ID (home)'), 'pocket-id-home');
  assert.equal(providerSlug('!!!'), 'sso');
});

test('admin sets up Tinyauth; the secret is sealed and never sent back', async () => {
  const { db, req, adminCookie } = await setup();
  const created = await req('POST', '/api/admin/sso', { kind: 'tinyauth', issuer: `${ISSUER}/.well-known/openid-configuration`, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, adminCookie);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.id, 'tinyauth');
  assert.equal(created.body.name, 'Tinyauth');
  assert.equal(created.body.issuer, ISSUER, 'a pasted discovery address is trimmed to the issuer');
  assert.equal(created.body.redirectUri, 'https://kitchen.test/api/auth/sso/tinyauth/callback');
  assert.equal(created.body.hasSecret, true);
  const list = await req('GET', '/api/admin/sso', undefined, adminCookie);
  assert.ok(!JSON.stringify(list.body).includes(CLIENT_SECRET));
  const stored = db.prepare('SELECT client_secret FROM oidc_providers').get() as { client_secret: string };
  assert.notEqual(stored.client_secret, CLIENT_SECRET);
  // An empty secret on edit keeps the saved one.
  const edited = await req('PATCH', '/api/admin/sso/tinyauth', { name: 'Family login', clientSecret: '' }, adminCookie);
  assert.equal(edited.body.name, 'Family login');
  assert.equal((db.prepare('SELECT client_secret FROM oidc_providers').get() as { client_secret: string }).client_secret, stored.client_secret);
  const check = await req('POST', '/api/admin/sso/tinyauth/test', {}, adminCookie);
  assert.equal(check.body.ok, true, JSON.stringify(check.body));
  const cfg = await req('GET', '/api/auth/config');
  assert.deepEqual(cfg.body.sso, [{ id: 'tinyauth', name: 'Family login', kind: 'tinyauth' }]);
  // Only admins.
  assert.equal((await req('GET', '/api/admin/sso')).status, 401);
});

test('someone you have not linked can not get in on an invite-only server', async () => {
  const { req, sso, adminCookie } = await setup();
  await req('POST', '/api/admin/sso', { kind: 'tinyauth', issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, adminCookie);
  const r = await sso('tinyauth');
  assert.equal(r.location, '/?signin=notlinked');
  assert.equal(r.cookie, null);
});

test('a person links their own account, then signs in with Tinyauth', async () => {
  const { req, sso, adminCookie, adminId } = await setup();
  await req('POST', '/api/admin/sso', { kind: 'tinyauth', issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, adminCookie);
  // Linking needs you signed in.
  assert.equal((await req('GET', '/api/auth/sso/tinyauth?link=1')).status, 401);
  const linked = await sso('tinyauth', adminCookie, true);
  assert.equal(linked.location, '/settings/security?sso=linked&provider=tinyauth');
  const links = await req('GET', '/api/auth/links', undefined, adminCookie);
  assert.deepEqual(links.body.links.map((l: { linked: boolean; username: string }) => [l.linked, l.username]), [[true, 'mom']]);

  const signedIn = await sso('tinyauth');
  assert.equal(signedIn.location, '/');
  const me = await req('GET', '/api/me', undefined, signedIn.cookie);
  assert.equal(me.body.user.id, adminId);

  // Someone else can't link that same Tinyauth account to theirs.
  const home = await req('POST', '/api/homes', { name: 'Den' }, adminCookie);
  const { body: detail } = await req('GET', `/api/homes/${home.body.id}`, undefined, adminCookie);
  const kid = await req('POST', '/api/auth/register', { username: 'kid', password: 'raccoons love snacks too', joinCode: detail.joinCode });
  assert.equal((await sso('tinyauth', kid.cookie, true)).location, '/settings/security?sso=taken');

  // Unlinking is fine while there's a password to fall back on.
  const un = await req('DELETE', '/api/auth/links/tinyauth', undefined, adminCookie);
  assert.equal(un.status, 200);
  assert.equal(un.body.links[0].linked, false);
  assert.equal((await sso('tinyauth')).location, '/?signin=notlinked');
});

test('an admin links someone by their Tinyauth username before they ever sign in', async () => {
  const { db, req, sso, fake, adminCookie } = await setup();
  await req('POST', '/api/admin/sso', { kind: 'tinyauth', issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, adminCookie);
  const dad = createUser(db, { name: 'Dad' });
  const put = await req('PUT', `/api/admin/users/${dad.id}/sso/tinyauth`, { username: 'Dad' }, adminCookie);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.links.map((l: { linked: boolean; confirmed: boolean }) => [l.linked, l.confirmed]), [[true, false]]);
  // Same username for someone else is refused.
  const kid = createUser(db, { name: 'Kid' });
  assert.equal((await req('PUT', `/api/admin/users/${kid.id}/sso/tinyauth`, { username: 'dad' }, adminCookie)).status, 409);

  fake.state.who = { sub: 'sub-dad', preferred_username: 'dad', email: 'dad@example.com', email_verified: true, name: 'Dad' };
  const r = await sso('tinyauth');
  assert.equal(r.location, '/');
  assert.equal((await req('GET', '/api/me', undefined, r.cookie)).body.user.id, dad.id);
  const after = await req('GET', `/api/admin/users/${dad.id}/sso`, undefined, adminCookie);
  assert.equal(after.body.links[0].confirmed, true, 'the first sign-in confirms the link');
  // A linked account is no longer a name-only quick sign-in account.
  assert.equal((await req('POST', '/api/auth/local', { name: 'Dad' })).status, 403);
  // Overview shows it.
  const overview = await req('GET', '/api/admin/overview', undefined, adminCookie);
  assert.equal(overview.body.users.find((u: { id: string }) => u.id === dad.id).sso, 'Tinyauth');
  // Removing the provider would strand Dad, so it asks first.
  assert.equal((await req('DELETE', '/api/admin/sso/tinyauth', undefined, adminCookie)).status, 409);
  assert.equal((await req('DELETE', '/api/admin/sso/tinyauth?force=1', undefined, adminCookie)).status, 200);
});

test('a trusted provider makes accounts, and links by verified email', async () => {
  const { db, req, sso, fake, adminCookie } = await setup();
  await req('POST', '/api/admin/sso', { kind: 'tinyauth', issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, autoCreate: true }, adminCookie);
  const gran = createUser(db, { name: 'Gran', email: 'gran@example.com' });
  fake.state.who = { sub: 'sub-gran', preferred_username: 'granny', email: 'GRAN@example.com', email_verified: true, name: 'Gran' };
  const g = await sso('tinyauth');
  assert.equal((await req('GET', '/api/me', undefined, g.cookie)).body.user.id, gran.id);
  fake.state.who = { sub: 'sub-new', preferred_username: 'cousin', email: 'cousin@example.com', email_verified: false, name: 'Cousin' };
  const c = await sso('tinyauth');
  const me = await req('GET', '/api/me', undefined, c.cookie);
  assert.equal(me.body.user.name, 'Cousin');
  assert.equal(me.body.user.email, null, 'an unverified email is not trusted');
  assert.equal(me.body.user.isAdmin, false);
});
