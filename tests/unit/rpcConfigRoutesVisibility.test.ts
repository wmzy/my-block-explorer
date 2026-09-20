/**
 * Visibility semantics of GET /rpc-configs: custom endpoint URLs embed
 * provider API keys, so the full URL is only served to (a) requests whose
 * Origin is allowlisted by the shared cors-origins policy (browsers always
 * send Origin on cross-origin reads), or (b) Origin-less requests whose
 * socket is loopback (local curl, same-host scripts) — CORS never applied
 * to Origin-less clients, so the socket is the only trust anchor left for
 * them. Everything else — foreign Origins, remote Origin-less clients,
 * and runtimes with no socket info at all (the in-process Vite dev
 * bridge) — gets the redacted scheme + host plus urlRedacted: true. The
 * DB and RPC manager are mocked; conn info is injected through
 * app.request's env, mirroring @hono/node-server's { incoming: { socket } }.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const SECRET_URL = 'https://mainnet.infura.io/v3/SECRET-API-KEY';
const REDACTED_URL = 'https://mainnet.infura.io/…';

const mocks = vi.hoisted(() => ({
  // Rows the GET's select resolves with.
  rows: [] as Array<Record<string, unknown>>,
  reloadConfigs: vi.fn(),
  gate: vi.fn(),
}));

vi.mock('@/middleware/admin-token', () => ({
  requireAdminTokenIfConfigured: mocks.gate,
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { reloadConfigs: mocks.reloadConfigs },
}));

vi.mock('@/database/init', () => ({
  userRpcConfigs: {},
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => Promise.resolve([...mocks.rows])) })),
    insert: vi.fn(() => ({ values: vi.fn() })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn() })),
  },
}));

import app from '@/routes/rpc-config';

// @hono/node-server hands the app env = { incoming: { socket: … } }; the
// same shape through app.request drives getConnInfo in these tests.
const socketEnv = (remoteAddress: string) => ({
  incoming: {
    socket: {
      remoteAddress,
      remotePort: 51234,
      remoteFamily: remoteAddress.includes(':') ? 'IPv6' : 'IPv4',
    },
  },
});

const get = (init?: RequestInit, env?: object) => app.request('/rpc-configs', init, env);

const firstConfig = async (res: Response) => {
  const body = await res.json();
  return body.configs[0] as { url: string | null; urlRedacted: boolean };
};

beforeAll(() => {
  // Pin the allowlist to loopback-only: the shared policy also admits
  // CORS_ALLOWED_ORIGINS / FRONTEND_URL, which the ambient environment
  // must not leak into these tests.
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.FRONTEND_URL;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.length = 0;
  mocks.rows.push({
    chainId: 1,
    name: 'Mainnet custom',
    url: SECRET_URL,
    supportsHistory: true,
    maxEventRange: null,
  });
});

describe('GET /rpc-configs full-URL visibility', () => {
  it('serves the full URL to an allowlisted Origin regardless of socket', async () => {
    const res = await get(
      { headers: { origin: 'http://localhost:3000' } },
      socketEnv('203.0.113.7'),
    );

    expect(res.status).toBe(200);
    const config = await firstConfig(res);
    expect(config.url).toBe(SECRET_URL);
    expect(config.urlRedacted).toBe(false);
  });

  it('redacts for a foreign Origin even from a loopback socket', async () => {
    const res = await get(
      { headers: { origin: 'https://attacker.example' } },
      socketEnv('127.0.0.1'),
    );

    expect(res.status).toBe(200);
    const config = await firstConfig(res);
    expect(config.url).toBe(REDACTED_URL);
    expect(config.url).not.toContain('SECRET');
    expect(config.urlRedacted).toBe(true);
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'serves the full URL to an Origin-less loopback caller (%s)',
    async (address) => {
      const res = await get(undefined, socketEnv(address));

      expect(res.status).toBe(200);
      const config = await firstConfig(res);
      expect(config.url).toBe(SECRET_URL);
      expect(config.urlRedacted).toBe(false);
    },
  );

  it('redacts for an Origin-less remote caller', async () => {
    const res = await get(undefined, socketEnv('203.0.113.7'));

    expect(res.status).toBe(200);
    const config = await firstConfig(res);
    expect(config.url).toBe(REDACTED_URL);
    expect(config.url).not.toContain('SECRET');
    expect(config.urlRedacted).toBe(true);
  });

  it('redacts when no socket info exists at all (in-process dev bridge)', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    const config = await firstConfig(res);
    expect(config.url).toBe(REDACTED_URL);
    expect(config.urlRedacted).toBe(true);
  });

  it('reports urlRedacted: false for a row with no URL to protect', async () => {
    mocks.rows.length = 0;
    mocks.rows.push({ chainId: 1, name: 'Empty', url: null, supportsHistory: null, maxEventRange: null });

    const res = await get(undefined, socketEnv('203.0.113.7'));

    expect(res.status).toBe(200);
    const config = await firstConfig(res);
    expect(config.url).toBeNull();
    expect(config.urlRedacted).toBe(false);
  });
});
