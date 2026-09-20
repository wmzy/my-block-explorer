import { serve } from '@hono/node-server';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import apiApp from './api-app';
import { db } from './database/drizzle';
import { runStartupSecurityChecks } from './startupChecks';

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

  const server = serve(
    {
      fetch: apiApp.fetch,
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

      if (process.env.NODE_ENV === 'production') {
        console.log('  GET /                   - Frontend application');
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
