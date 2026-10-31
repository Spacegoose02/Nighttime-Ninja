// Live updates: every open screen in a home hears when something in that home changed, so a check-off in the
// store shows up on the kitchen tablet without a refresh. Server-sent events are enough: the browser reconnects
// on its own, and the message only says what to reload, never the data itself.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from './auth.ts';

export interface Change { area: string; by: string | null }
type Listener = (change: Change) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(homeId: string, fn: Listener): () => void {
  const set = listeners.get(homeId) ?? new Set<Listener>();
  listeners.set(homeId, set);
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(homeId);
  };
}

export function publish(homeId: string, change: Change): void {
  for (const fn of listeners.get(homeId) ?? []) fn(change);
}

const HOME_ROUTE = /^\/api\/homes\/([^/?]+)(?:\/([^/?]+))?/;
// Per-person things that don't change what anyone else sees.
const PRIVATE_AREAS = new Set(['ai-chats', 'events']);

export function liveRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const open = new Set<() => void>();
  // Event streams never end on their own, so end them when the server shuts down.
  app.addHook('onClose', async () => { for (const end of open) end(); });

  // Any successful change inside a home tells the home's other screens which part to reload.
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || reply.statusCode >= 400) return;
    const m = HOME_ROUTE.exec(req.url);
    if (!m || m[1] === 'join') return;
    const area = m[2] ?? 'home';
    if (PRIVATE_AREAS.has(area)) return;
    publish(m[1], { area, by: req.headers['x-nn-client'] ? String(req.headers['x-nn-client']).slice(0, 64) : null });
  });

  app.get('/api/homes/:homeId/events', async (req, reply) => {
    const ctx = homeCtx(db, req);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff', connection: 'keep-alive',
    });
    raw.write('retry: 5000\n\n');
    const off = subscribe(ctx.homeId, (c) => raw.write(`data: ${JSON.stringify(c)}\n\n`));
    // A comment every 25 seconds keeps proxies and phone networks from closing a quiet connection.
    const ping = setInterval(() => raw.write(': ping\n\n'), 25_000);
    const end = () => { clearInterval(ping); off(); open.delete(end); raw.end(); };
    open.add(end);
    req.raw.on('close', end);
  });
}
