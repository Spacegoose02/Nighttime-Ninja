import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';
import { installAuth, registerAuthRoutes } from './auth.ts';
import { HttpError } from './util.ts';
import { installHardening } from './security.ts';
import { accountRoutes } from './accounts.ts';
import { updateRoutes } from './updates.ts';
import { homeRoutes } from './routes/homes.ts';
import { inventoryRoutes } from './routes/inventory.ts';
import { recipeRoutes } from './routes/recipes.ts';
import { shoppingRoutes } from './routes/shopping.ts';
import { mealPlanRoutes } from './routes/mealplan.ts';
import { feedRoutes } from './routes/feeds.ts';
import { dealRoutes } from './routes/deals.ts';
import { integrationRoutes } from './routes/integrations.ts';
import { kitchenOwlRoutes } from './routes/kitchenowl.ts';

export async function buildApp(db: DatabaseSync, opts: { logger?: boolean; serveWeb?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024, trustProxy: config.trustProxy });
  await app.register(cookie, { secret: config.sessionSecret });
  installHardening(app);
  installAuth(app, db);

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong in the kitchen' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  registerAuthRoutes(app, db);
  accountRoutes(app, db);
  updateRoutes(app);
  homeRoutes(app, db);
  inventoryRoutes(app, db);
  recipeRoutes(app, db);
  shoppingRoutes(app, db);
  mealPlanRoutes(app, db);
  feedRoutes(app, db);
  dealRoutes(app, db);
  integrationRoutes(app, db);
  kitchenOwlRoutes(app, db);

  await app.register(fastifyStatic, {
    root: path.join(config.dataDir, 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
    maxAge: '30d',
    immutable: true,
  });

  const hasWeb = opts.serveWeb !== false && fs.existsSync(path.join(config.webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/', wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !hasWeb) {
      return reply.status(404).send({ error: 'Not found' });
    }
    // Single-page app: let the browser router handle it.
    return reply.sendFile('index.html', config.webDist);
  });

  return app;
}
