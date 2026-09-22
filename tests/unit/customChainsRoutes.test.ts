// Custom-chain route contract: POST validates the RPC URL, probes the
// endpoint's eth_chainId with a raw JSON-RPC request (network failures
// and garbage answers answer 502 honestly, never a fabricated chain),
// 409s with existingName when viem already ships the reported id, and on
// success persists + registers the chain so getChainInfo resolves it
// backend-side. GET applies the same URL-redaction policy as
// /rpc-configs; DELETE is gated and 404/204. The drizzle layer is faked
// (labelsRoutes.test.ts pattern) and the probe fetch is stubbed; the
// admin gate and rate limiter run for real.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
// Node's real fetch, importable directly (setup.ts mocks the global).
import { fetch as realFetch } from 'undici';
import { Hono } from 'hono';
import { resetRateLimiterState } from '@/middleware/rate-limit';
import { getChainInfo } from '@/config/chains';
import { registerCustomChain, resetCustomChainsForTests } from '@/config/customChains';

const dbState = vi.hoisted(() => ({
  // Rows every select (GET list + DELETE existence) resolves with.
  rows: [] as Array<Record<string, unknown>>,
  // The last upsert's values + conflict set (null when none happened).
  upsert: null as { values: Record<string, unknown>; set: Record<string, unknown> } | null,
  // Set (to a sentinel) when a delete ran; null when none happened.
  deletedChainId: null as number | null,
  reloadConfigs: vi.fn(),
}));

vi.mock('@/database/drizzle', async () => {
  const { customChains } = await import('@/database/schema');
  const S = dbState;

  return {
    db: {
      select: () => {
        const b: Record<string, unknown> = {
          from: (t: unknown) => {
            if (t !== customChains) throw new Error('unexpected select table');
            return b;
          },
          where: () => b,
          then: (res: unknown, rej: unknown) =>
            Promise.resolve([...S.rows]).then(res as never, rej as never),
        };
        return b;
      },
      insert: (t: unknown) => {
        if (t !== customChains) throw new Error('unexpected insert table');
        const b: Record<string, unknown> = {
          values: (v: Record<string, unknown>) => {
            S.upsert = { values: v, set: {} };
            return b;
          },
          onConflictDoUpdate: (conflict: { set: Record<string, unknown> }) => {
            if (S.upsert) S.upsert.set = conflict.set;
            return b;
          },
          then: (res: unknown, rej: unknown) =>
            Promise.resolve([]).then(res as never, rej as never),
        };
        return b;
      },
      delete: (t: unknown) => {
        if (t !== customChains) throw new Error('unexpected delete table');
        return {
          where: () => {
            S.deletedChainId = -1;
            return Promise.resolve([]);
          },
        };
      },
    },
  };
});

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { reloadConfigs: dbState.reloadConfigs },
}));

import chainsRoutes from '@/routes/chains';

const app = new Hono();
app.route('/', chainsRoutes);

const request = (path: string, init?: RequestInit) => app.request(path, init);

const post = (body: unknown, headers: Record<string, string> = {}) =>
  request('/chains/custom', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

// Probe stub: one JSON-RPC eth_chainId answer per call.
const probe = vi.fn();

const rpcAnswer = (result: unknown, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// A Response body is single-consume, so multi-call tests must mint a
// fresh answer per call instead of reusing one resolved value.
const answersChainId = (result: unknown, status = 200) =>
  probe.mockImplementation(() => Promise.resolve(rpcAnswer(result, status)));

const envBefore = vi.hoisted(() => ({ ADMIN_TOKEN: '', RATE_LIMIT_DISABLED: '' }));

beforeAll(() => {
  envBefore.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
  envBefore.RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLED ?? '';
  // Pin the redaction policy to loopback-only: ambient CORS extras must
  // not leak into these tests (rpcConfigRoutesVisibility.test.ts pattern).
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.FRONTEND_URL;
});

afterAll(() => {
  process.env.ADMIN_TOKEN = envBefore.ADMIN_TOKEN;
  process.env.RATE_LIMIT_DISABLED = envBefore.RATE_LIMIT_DISABLED;
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', probe);
  dbState.rows.length = 0;
  dbState.upsert = null;
  dbState.deletedChainId = null;
  dbState.reloadConfigs.mockResolvedValue(undefined);
  resetCustomChainsForTests();
  resetRateLimiterState();
  delete process.env.ADMIN_TOKEN;
  // The route's limiter would otherwise 429 the third POST of a test.
  process.env.RATE_LIMIT_DISABLED = '1';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /chains/custom — validation', () => {
  it('rejects a missing/non-string rpcUrl with 400 invalid_url', async () => {
    for (const body of [{}, { rpcUrl: 42 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'invalid_url' });
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects an unparseable URL with 400 invalid_url', async () => {
    const res = await post({ rpcUrl: 'not a url' });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_url' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) scheme with 400 invalid_url', async () => {
    const res = await post({ rpcUrl: 'ws://localhost:8545' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_url');
    expect(body.message).toContain('http');
  });

  it('rejects mistyped optional fields with 400 invalid_fields', async () => {
    for (const bad of [{ name: 42 }, { symbol: 42 }, { decimals: 'lots' }, { decimals: -1 }, { decimals: 1.5 }]) {
      const res = await post({ rpcUrl: 'http://127.0.0.1:8545', ...bad });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'invalid_fields' });
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body with 400 invalid_json', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_json' });
  });
});

describe('POST /chains/custom — probe failures answer 502 honestly', () => {
  it('network failure → 502 rpc_unreachable', async () => {
    probe.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await post({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('rpc_unreachable');
    expect(typeof body.message).toBe('string');
    expect(dbState.upsert).toBeNull();
  });

  it('HTTP-level failure → 502 rpc_unreachable', async () => {
    answersChainId(undefined, 503);

    const res = await post({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: 'rpc_unreachable' });
  });

  it.each([
    ['a decimal number', 31337],
    ['a non-hex string', 'zz'],
    ['an empty hex', '0x'],
    ['missing entirely', undefined],
  ])('a non-integer chain id (%s) → 502 rpc_invalid_response', async (_name, result) => {
    answersChainId(result);

    const res = await post({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: 'rpc_invalid_response' });
    expect(dbState.upsert).toBeNull();
  });

  it('probes with a raw JSON-RPC eth_chainId POST and nothing else', async () => {
    answersChainId('0x7a69');

    await post({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(probe).toHaveBeenCalledTimes(1);
    const [url, init] = probe.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8545');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_chainId',
    });
  });
});

describe('POST /chains/custom — conflict with viem', () => {
  it('a known id (0x89 = Polygon) → 409 with existingName and hint', async () => {
    answersChainId('0x89');

    const res = await post({ rpcUrl: 'https://polygon-rpc.example' });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('chain_already_known');
    expect(body.existingName).toBe('Polygon');
    expect(body.hint).toContain('RPC panel');
    expect(body.message).toContain('Polygon');
    expect(dbState.upsert).toBeNull();
  });
});

describe('POST /chains/custom — success', () => {
  it('registers anvil (0x7a69) with defaults, echoes 201, and reloads the manager', async () => {
    answersChainId('0x7a69');

    const res = await post({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      chainId: 31337,
      name: 'Chain 31337',
      symbol: 'ETH',
      decimals: 18,
      rpcUrl: 'http://127.0.0.1:8545',
    });
    expect(dbState.upsert?.values).toMatchObject({ chainId: 31337, rpcUrl: 'http://127.0.0.1:8545' });
    expect(dbState.upsert?.set).toMatchObject({ name: 'Chain 31337', rpcUrl: 'http://127.0.0.1:8545' });
    expect(dbState.reloadConfigs).toHaveBeenCalledTimes(1);
    // Backend-side resolution: the registration is live immediately.
    expect(getChainInfo(31337)?.nativeCurrency.symbol).toBe('ETH');
  });

  it('honors explicit name/symbol/decimals', async () => {
    answersChainId('0x7a69');

    const res = await post({
      rpcUrl: 'http://127.0.0.1:8545',
      name: 'Anvil',
      symbol: 'GO',
      decimals: 9,
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ name: 'Anvil', symbol: 'GO', decimals: 9 });
    expect(getChainInfo(31337)?.nativeCurrency.decimals).toBe(9);
  });
});

describe('GET /chains/custom — URL redaction parity', () => {
  const SECRET_URL = 'https://rpc.example.com/v3/SECRET-API-KEY';

  beforeEach(() => {
    dbState.rows.push({
      chainId: 31337,
      name: 'Chain 31337',
      symbol: 'ETH',
      rpcUrl: SECRET_URL,
      decimals: 18,
    });
  });

  const firstChain = async (res: Response) => {
    const body = await res.json();
    return body.chains[0] as { rpcUrl: string; urlRedacted: boolean };
  };

  it('serves the full URL to an allowlisted Origin regardless of socket', async () => {
    const res = await request('/chains/custom', {
      headers: { origin: 'http://localhost:3000' },
    });

    expect(res.status).toBe(200);
    const chain = await firstChain(res);
    expect(chain.rpcUrl).toBe(SECRET_URL);
    expect(chain.urlRedacted).toBe(false);
  });

  it('redacts for a foreign Origin even from a loopback socket', async () => {
    const res = await request('/chains/custom', {
      headers: { origin: 'https://attacker.example' },
    });

    expect(res.status).toBe(200);
    const chain = await firstChain(res);
    expect(chain.rpcUrl).toBe('https://rpc.example.com/…');
    expect(chain.rpcUrl).not.toContain('SECRET');
    expect(chain.urlRedacted).toBe(true);
  });

  it('redacts when no socket info exists at all (in-process dev bridge)', async () => {
    const res = await request('/chains/custom');

    expect(res.status).toBe(200);
    const chain = await firstChain(res);
    expect(chain.rpcUrl).toBe('https://rpc.example.com/…');
    expect(chain.urlRedacted).toBe(true);
  });
});

describe('admin gate', () => {
  it('ADMIN_TOKEN set + no header → 403, nothing persisted', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    answersChainId('0x7a69');

    const res = await post({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(res.status).toBe(403);
    expect(dbState.upsert).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('ADMIN_TOKEN set + matching header → passes', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    answersChainId('0x7a69');

    const res = await post({ rpcUrl: 'http://127.0.0.1:8545' }, { 'x-admin-token': 'secret' });

    expect(res.status).toBe(201);
  });

  it('ADMIN_TOKEN unset → passes without a header (zero-config local)', async () => {
    answersChainId('0x7a69');

    const res = await post({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(res.status).toBe(201);
  });
});

describe('DELETE /chains/custom/:chainId', () => {
  it('answers 404 when nothing is registered under the id', async () => {
    const res = await request('/chains/custom/31337', { method: 'DELETE' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' });
    expect(dbState.deletedChainId).toBeNull();
  });

  it('rejects a non-positive-integer id with 400', async () => {
    const res = await request('/chains/custom/abc', { method: 'DELETE' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_chain_id' });
  });

  it('removes a registration with 204, reloads the manager, and deregisters', async () => {
    dbState.rows.push({ chainId: 31337 });
    registerCustomChain({
      chainId: 31337,
      name: 'Chain 31337',
      symbol: 'ETH',
      decimals: 18,
      rpcUrl: 'http://127.0.0.1:8545',
    });
    expect(getChainInfo(31337)).not.toBeNull();

    const res = await request('/chains/custom/31337', { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(dbState.deletedChainId).not.toBeNull();
    expect(dbState.reloadConfigs).toHaveBeenCalledTimes(1);
    // Deregistered: viem's own placeholder answer returns (name and
    // default loopback URL), not the registration's.
    expect(getChainInfo(31337)?.name).toBe('Anvil');
    expect(getChainInfo(31337)?.rpcUrls.default.http).toEqual(['http://127.0.0.1:8545']);
  });
});

describe('registration rate limit', () => {
  it('throttles the third rapid POST with 429', async () => {
    delete process.env.RATE_LIMIT_DISABLED;
    resetRateLimiterState();
    answersChainId('0x7a69');

    const first = await post({ rpcUrl: 'http://127.0.0.1:8545' });
    const second = await post({ rpcUrl: 'http://127.0.0.1:8545' });
    const third = await post({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(429);
    await expect(third.json()).resolves.toMatchObject({ error: 'rate_limited' });
  });
});

describe('probe against a real HTTP server', () => {
  // The acceptance scenario end-to-end minus the database: a live local
  // server answering eth_chainId 0x7a69 through real fetch networking →
  // 201, and the chain serves from that endpoint. tests/setup.ts replaces
  // the global fetch with a bare vi.fn(), so the REAL fetch (undici —
  // what Node's global wraps) is stubbed in explicitly for this test.
  it('registers anvil from a live eth_chainId answer (0x7a69 → 201)', async () => {
    vi.stubGlobal('fetch', realFetch);

    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => (raw += chunk));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x7a69' }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const rpcUrl = `http://127.0.0.1:${address.port}`;

    try {
      const res = await post({ rpcUrl });

      expect(res.status).toBe(201);
      await expect(res.json()).resolves.toMatchObject({
        chainId: 31337,
        rpcUrl,
      });
      // The registration serves: lookups resolve to this endpoint.
      expect(getChainInfo(31337)?.rpcUrls.default.http).toEqual([rpcUrl]);
    }
    finally {
      server.close();
    }
  });
});
