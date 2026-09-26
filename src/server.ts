import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import apiApp from './api-app';
import { db } from './database/drizzle';
import { runStartupSecurityChecks } from './startupChecks';
import { createStaticFrontendHandler } from './middleware/og-meta';

export type ServerOptions = {
  port?: number;
};

export function createServer(options: ServerOptions = {}) {
  const port = options.port ?? parseInt(process.env.PORT ?? '8201');
  const hostname = process.env.HOST;

  // Public-binding posture, evaluated before listen: refuse to start with
  // ENABLE_DEBUG_API on a non-loopback HOST (unless ALLOW_INSECURE_START=1)
  // and warn when mutating endpoints run without ADMIN_TOKEN. Runs here —
  // never at api-app import time, which the vite dev bridge also loads.
  runStartupSecurityChecks();

  const PROXY_URL =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;

  if (PROXY_URL) {
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
  }

  // Optional static frontend hosting (single-container deployments).
  //
  // By default this server is API-only — the built SPA is served by the
  // nginx `web` image (Dockerfile target `web`, compose.yaml). Setting
  // SERVE_STATIC_DIR=<built client dir, e.g. dist/client> opts into serving
  // it from this process instead, with per-route og/twitter meta injected
  // into HTML navigations for JS-less requests (crawlers, unfurlers) via
  // src/middleware/og-meta.ts. Unset (dev:server, API-only, the compose api
  // container) the handler below is the bare API app — byte-identical to
  // before. The vite dev bridge is unaffected: it loads src/api-app.ts,
  // never this file.
  const SERVE_STATIC_DIR = process.env.SERVE_STATIC_DIR;
  let fetchHandler: typeof apiApp.fetch = apiApp.fetch;

  if (SERVE_STATIC_DIR) {
    if (!existsSync(join(SERVE_STATIC_DIR, 'index.html'))) {
      console.error(
        `SERVE_STATIC_DIR is set to '${SERVE_STATIC_DIR}' but no index.html exists there. ` +
        'Point it at a built frontend (pnpm build:client output, e.g. ./dist/client) or unset it to run API-only.',
      );
      process.exit(1);
    }
    fetchHandler = createStaticFrontendHandler({
      staticDir: SERVE_STATIC_DIR,
      apiFetch: apiApp.fetch,
    });
  }

  const server = serve(
    {
      fetch: fetchHandler,
      port,
      hostname,
    },
    info => {
      console.log(`Server is running on http://localhost:${info.port}`);
      console.log(`API Info: http://localhost:${info.port}/api`);
      console.log(`Health Check: http://localhost:${info.port}/api/health`);

      console.log('');
      console.log('Available endpoints:');
      console.log('  GET /api                - API information');
      console.log('  GET /api/health         - Health check');
      console.log('  GET /api/search?q={}    - Search');
      console.log('  GET /api/stats/overview - Statistics');

      if (SERVE_STATIC_DIR) {
        console.log('  GET /                   - Frontend application');
        console.log(`  (static dir: ${SERVE_STATIC_DIR}; HTML navigations get og/twitter meta injected)`);
      }
    },
  );

  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    try {
      await (db.$client).end?.();
    } catch (error) {
      console.warn('Shutdown checkpoint failed:', error);
    }
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { server, port };
}
