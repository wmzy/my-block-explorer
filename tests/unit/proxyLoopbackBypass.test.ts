// Proxy-dispatcher wiring (src/server.ts): with any HTTP(S)_PROXY env
// set, the global dispatcher becomes an EnvHttpProxyAgent with a
// loopback NO_PROXY bypass — a bare ProxyAgent has no noProxy option at
// all (undici 8.x typings), and without the bypass every loopback fetch
// (local anvil nodes, this server's own probes) dies behind a proxy that
// cannot reach the dev box. Pins the pure env mapping AND the real
// undici behavior end to end (a loopback fetch bypasses a dead proxy).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { EnvHttpProxyAgent, request } from 'undici';

// src/server.ts pulls the whole app graph at import time (api-app,
// DuckDB drizzle handle, WatchService...). Only the pure helper is under
// test — stub the heavy module-scope imports so nothing touches a
// database or starts a listener.
vi.mock('@/api-app', () => ({ default: { fetch: vi.fn() }, reconcileStartupState: vi.fn() }));
vi.mock('@/database/drizzle', () => ({ db: {} }));
vi.mock('@/database/chain-database-manager', () => ({ multiChainDb: {} }));
vi.mock('@/services/WatchService', () => ({ watchService: { start: vi.fn() } }));

const { proxyDispatcherOptions } = await import('@/server');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxyDispatcherOptions — pure env mapping', () => {
  it('returns null when no proxy env is set', () => {
    expect(proxyDispatcherOptions({})).toBeNull();
  });

  it('keeps the precedence chain HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy', () => {
    expect(
      proxyDispatcherOptions({ HTTPS_PROXY: 'https://a', HTTP_PROXY: 'http://b' }),
    ).toMatchObject({ httpProxy: 'https://a', httpsProxy: 'https://a' });
    expect(
      proxyDispatcherOptions({ https_proxy: 'https://lower', HTTP_PROXY: 'http://b' }),
    ).toMatchObject({ httpProxy: 'https://lower' });
    expect(proxyDispatcherOptions({ http_proxy: 'http://lower' })).toMatchObject({
      httpProxy: 'http://lower',
    });
  });

  it('routes both protocols through the one URL (the old bare-ProxyAgent behavior)', () => {
    const options = proxyDispatcherOptions({ HTTP_PROXY: 'http://corp:3128' });
    expect(options).toEqual({
      httpProxy: 'http://corp:3128',
      httpsProxy: 'http://corp:3128',
      noProxy: '127.0.0.1,localhost,::1',
    });
  });

  it('defaults the bypass to loopback and honors an explicit NO_PROXY verbatim', () => {
    expect(proxyDispatcherOptions({ HTTP_PROXY: 'http://corp:3128' })?.noProxy).toBe(
      '127.0.0.1,localhost,::1',
    );
    expect(
      proxyDispatcherOptions({ HTTP_PROXY: 'http://corp:3128', NO_PROXY: 'internal.example' })
        ?.noProxy,
    ).toBe('internal.example');
    // lowercase env wins over nothing, and NO_PROXY beats no_proxy.
    expect(
      proxyDispatcherOptions({ HTTP_PROXY: 'http://corp:3128', no_proxy: 'a.example' })?.noProxy,
    ).toBe('a.example');
  });
});

describe('EnvHttpProxyAgent — loopback bypass, end to end against real undici', () => {
  it('fetches a loopback origin directly while the "proxy" is a dead port', async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('direct');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const { port } = address;

    // Port 9 (discard) is closed on any sane host: if the request were
    // routed through the "proxy" it would fail to connect.
    const agent = new EnvHttpProxyAgent({
      httpProxy: 'http://127.0.0.1:9',
      httpsProxy: 'http://127.0.0.1:9',
      noProxy: '127.0.0.1,localhost,::1',
    });

    try {
      const response = await request(`http://127.0.0.1:${port}/`, { dispatcher: agent });
      expect(response.statusCode).toBe(200);
      expect(await response.body.text()).toBe('direct');
    } finally {
      server.close();
      await agent.close();
    }
  });

  it('still proxies (fails against the dead proxy) when the bypass list omits loopback', async () => {
    const agent = new EnvHttpProxyAgent({
      httpProxy: 'http://127.0.0.1:9',
      httpsProxy: 'http://127.0.0.1:9',
      noProxy: 'internal.example', // operator explicitly excluded loopback
    });

    await expect(request('http://127.0.0.1:1/', { dispatcher: agent })).rejects.toThrow();
    await agent.close();
  });
});
