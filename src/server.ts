import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';
import apiApp, { reconcileStartupState } from './api-app';
import { db } from './database/drizzle';
import { registerSelfDestructCloser } from './services/selfDestruct';
import { runStartupSecurityChecks } from './startupChecks';
import { createStaticFrontendHandler } from './middleware/og-meta';

export type ServerOptions = {
  port?: number;
};

// Pure mapping from the proxy env to EnvHttpProxyAgent options —
// exported for tests. null = no proxy env at all (no global dispatcher).
//
// EnvHttpProxyAgent, not a bare ProxyAgent: undici's ProxyAgent has no
// noProxy option at all (verified against the installed 8.x typings —
// only EnvHttpProxyAgent accepts one), and without a bypass the global
// dispatcher would drag LOOPBACK traffic through the proxy too — local
// anvil/hardhat nodes (127.0.0.1:8545) and this server's own probes die
// behind a corporate proxy that cannot reach the dev box. httpProxy and
// httpsProxy both take PROXY_URL so the single-URL precedence chain
// (HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy) keeps routing
// both protocols exactly like the old bare ProxyAgent did; loopback
// stays direct unless the operator's own NO_PROXY says otherwise — an
// explicit NO_PROXY replaces the default list wholesale.
export function proxyDispatcherOptions(
  env: NodeJS.ProcessEnv = process.env,
): { httpProxy: string; httpsProxy: string; noProxy: string } | null {
  const proxyUrl = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (!proxyUrl) return null;
  return {
    httpProxy: proxyUrl,
    httpsProxy: proxyUrl,
    noProxy: env.NO_PROXY ?? env.no_proxy ?? '127.0.0.1,localhost,::1',
  };
}

export async function createServer(options: ServerOptions = {}) {
  const port = options.port ?? parseInt(process.env.PORT ?? '8201');
  // Default to the loopback bind: an unset HOST must mean "local dev", never
  // "all interfaces". Passing undefined to serve() would make Node bind ::
  // (dual-stack, LAN-reachable) while startupChecks treats unset HOST as
  // loopback — the exact posture inversion this default closes. The default
  // is the IPv4 literal 127.0.0.1, NOT 'localhost': Node resolves 'localhost'
  // to a single stack (on Linux often ::1 only), which silently breaks every
  // IPv4-literal loopback consumer (the MCP default EXPLORER_API_URL,
  // curl-by-IP, docker healthchecks); browsers probing 'localhost' still
  // reach an IPv4 bind via happy-eyeballs. Explicit HOST (e.g.
  // HOST=0.0.0.0 in the Docker api image) still overrides, and the startup
  // posture then evaluates the real bind.
  const hostname = process.env.HOST ?? '127.0.0.1';

  // Public-binding posture, evaluated before listen: refuse to start with
  // ENABLE_DEBUG_API on a non-loopback HOST (unless ALLOW_INSECURE_START=1)
  // and warn when mutating endpoints run without ADMIN_TOKEN. Runs here —
  // never at api-app import time, which the vite dev bridge also loads.
  runStartupSecurityChecks();

  const proxyOptions = proxyDispatcherOptions();

  if (proxyOptions) {
    setGlobalDispatcher(new EnvHttpProxyAgent(proxyOptions));
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

  // Zombie-walk reconciliation (stranded 'running' rows → 'error') must
  // land BEFORE the listener exists: awaited here so the blanket UPDATE
  // can never race a job this same process just started — the old
  // fire-and-forget call in api-app's module scope could flip a fresh job
  // between listen and the UPDATE committing. Never throws (failures are
  // logged inside reconcileStartupState); boot proceeds regardless.
  await reconcileStartupState();

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
        console.log(
          `  (static dir: ${SERVE_STATIC_DIR}; HTML navigations get og/twitter meta injected)`,
        );
      }
    },
  );

  let shutdownStarted = false;
  const shutdown = async () => {
    // A second signal means "stop waiting" — abandon in-flight cleanup.
    if (shutdownStarted) {
      console.log('Second shutdown signal received, exiting immediately.');
      process.exit(1);
    }
    shutdownStarted = true;

    console.log('Shutting down gracefully...');
    try {
      await db.$client.end?.();
    } catch (error) {
      console.warn('Shutdown checkpoint failed:', error);
    }
    // Idle keep-alive sockets hold close() open forever — destroy them so
    // the callback can actually fire. serve()'s declared return type covers
    // http2 variants that lack this method; our options always build a
    // plain http.Server, hence the narrowing guard.
    if ('closeAllConnections' in server) server.closeAllConnections();
    // Bound the wait regardless: anything still blocking close() (in-flight
    // request, stray handle) must not turn SIGTERM into a hang.
    const forceExitTimer = setTimeout(() => {
      console.warn('Graceful shutdown did not finish within 5s, forcing exit.');
      process.exit(1);
    }, 5000);
    forceExitTimer.unref?.();
    server.close(() => {
      clearTimeout(forceExitTimer);
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Self-destruct closer for POST /api/ops/uninstall (services/
  // selfDestruct.ts): same teardown shape as the signal handler, minus
  // process.exit — the caller continues into data deletion and exits with
  // a code that reports whether every target was removed. Registered here
  // (not in api-app) because only this file owns the server handle.
  registerSelfDestructCloser(async () => {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  return { server, port };
}
