// Service worker: makes the app installable and keeps the shopping list usable with no signal.
// - The app itself (HTML, scripts, styles, pictures) is kept on the device and refreshed in the background.
// - A few API answers the shopping list needs are kept as a fallback for when the network is gone.
// Everything else always goes to the server.
const SHELL = 'nn-shell-v1';
const API = 'nn-api';

// Only what the shopping list needs to open offline. Signing out deletes these (see web/src/offline.ts).
const OFFLINE_API = [
  /^\/api\/me$/,
  /^\/api\/homes\/[^/]+$/,
  /^\/api\/homes\/[^/]+\/shopping$/,
  /^\/api\/homes\/[^/]+\/shopping\/suggestions$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== API) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(fallbackUrl ?? request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackUrl ?? request);
    if (hit) return hit;
    throw err;
  }
}

// Each release brings new script and style files; keep the newest ones and let old releases fall away.
async function trim(cache, max = 80) {
  const keys = (await cache.keys()).filter((k) => new URL(k.url).pathname !== '/');
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((res) => {
    if (res.ok) void cache.put(request, res.clone()).then(() => trim(cache));
    return res;
  });
  if (hit) {
    fresh.catch(() => {});
    return hit;
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (OFFLINE_API.some((re) => re.test(url.pathname))) event.respondWith(networkFirst(req, API));
    return;
  }
  if (url.pathname.startsWith('/uploads/')) return;
  // Pages: always the newest from the server, or the saved copy of the app when offline.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL, '/'));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});
