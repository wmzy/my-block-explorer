// Boot smoke for the REAL standalone server stack: src/server.ts's
// createServer() in-process, on an ephemeral port, with a throwaway
// DuckDB (migrations 0000–0016 run against it during boot — the adapter's
// lazy connect() applies them before reconcileStartupState queries).
// Asserts the /api/health contract over a real socket and exercises the
// graceful-shutdown path registered on SIGTERM, proving the listener
// closes and the 5s force-exit timer is cleared (its clearTimeout runs in
// the same close callback as the process.exit(0) we observe).
//
// In-process, not spawned: the shutdown seam (the SIGTERM handler
// server.ts registers) and the process.exit inside it are only
// observable/neutralizable from inside the worker — a spawned tsx child
// could prove exit codes but not these internals. process.exit is spied
// to a no-op for the shutdown call and the handler is unregistered right
// after, so the vitest worker can never be killed by this file.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'undici';
import { createRequire } from 'node:module';

type ServerHandle = Awaited<ReturnType<typeof import('@/server').createServer>>['server'];

// Pin the zero-config local posture this boot asserts (no admin token, no
// debug API), and keep the DuckDB writer off the repo's data/blockchain.db:
// the duckdb:// scheme is REQUIRED — a bare path is silently ignored by
// the adapter and lands on that default single-writer file (pinned
// lesson). Stubbing precedes the first server-graph import in beforeAll.
const tempDir = mkdtempSync(join(tmpdir(), 'server-boot-smoke-'));
vi.stubEnv('DATABASE_URL', `duckdb://${join(tempDir, 'blockchain.db')}`);
vi.stubEnv('ADMIN_TOKEN', '');
vi.stubEnv('ENABLE_DEBUG_API', '');

// Snapshot the worker's signal listeners so createServer's handlers can
// be identified (and removed) afterwards — vitest registers its own.
const sigtermBefore = process.listeners('SIGTERM');
const sigintBefore = process.listeners('SIGINT');

const packageVersion: string = createRequire(import.meta.url)('../../package.json').version;

let server: ServerHandle | undefined;
let port = 0;

const handle = (): ServerHandle => {
  if (!server) throw new Error('server was not booted in beforeAll');
  return server;
};

beforeAll(async () => {
  const { createServer } = await import('@/server');
  // port 0 = let the OS pick; no collision with siblings or a dev server.
  const started = await createServer({ port: 0 });
  server = started.server;

  // createServer resolves once serve() has been called; wait for the
  // actual bind so the address below is real.
  if (!server.listening) await once(server, 'listening');

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error(`unexpected server address: ${String(address)}`);
  }
  port = address.port;
}, 60_000);

afterAll(async () => {
  // Remove createServer's signal handlers first: they close over a
  // process.exit that must never run inside the vitest worker.
  for (const listener of process.listeners('SIGTERM')) {
    if (!sigtermBefore.includes(listener)) process.removeListener('SIGTERM', listener);
  }
  for (const listener of process.listeners('SIGINT')) {
    if (!sigintBefore.includes(listener)) process.removeListener('SIGINT', listener);
  }
  // Belt-and-braces if the shutdown test never ran (assertion failure
  // above it): close the listener directly.
  const s = server;
  if (s?.listening) {
    if ('closeAllConnections' in s) s.closeAllConnections();
    await new Promise<void>(resolve => s.close(() => resolve()));
  }
  // idempotent: end() checkpoints+closes only if the instance is live.
  const { db } = await import('@/database/init');
  await db.$client.end?.();
  rmSync(tempDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
}, 60_000);

describe('server boot smoke (real createServer, ephemeral port, temp DuckDB)', () => {
  it('serves GET /api/health with the documented shape over a real socket', async () => {
    // undici.request, not global fetch: tests/setup.ts replaces the
    // global with a vi.fn().
    const { statusCode, body } = await request(`http://127.0.0.1:${port}/api/health`);

    expect(statusCode).toBe(200);
    const health = (await body.json()) as Record<string, unknown>;
    expect(health).toEqual({
      status: 'ok',
      adminTokenConfigured: false,
      debugApiEnabled: false,
      version: packageVersion,
      timestamp: expect.any(String),
    });
    // Boot ran the real migration chain — the health route answering is
    // itself the proof reconcileStartupState's queries survived it.
    expect(handle().listening).toBe(true);
  });

  it('shuts down gracefully on the SIGTERM handler: listener closed, force-exit timer cleared', async () => {
    const added = process.listeners('SIGTERM').filter(l => !sigtermBefore.includes(l));
    expect(added).toHaveLength(1);

    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      // The same function object the process would invoke on a real
      // SIGTERM — the full shutdown path including the 5s force-exit
      // timer registration.
      const closed = once(handle(), 'close');
      await added[0]('SIGTERM');
      await closed;

      expect(handle().listening).toBe(false);
      // exit(0) fires inside server.close()'s callback AFTER
      // clearTimeout(forceExitTimer) — observing it proves both the
      // clean-exit path ran and the force-exit (exit(1) + warn) did not.
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
    }
  });
});
