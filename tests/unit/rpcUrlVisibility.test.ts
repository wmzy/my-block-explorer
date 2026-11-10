// middleware/rpc-url-visibility: the shared URL-secret gate behind GET
// /rpc-configs and GET /chains/custom. redactUrl is pinned purely
// (scheme + host survive, everything after the host is dropped,
// unparseable input degrades to the opaque marker); requestSeesFullUrl
// is pinned through a probe route whose request env carries
// @hono/node-server's { incoming: { socket } } shape — the same
// injection the route-level visibility suites use. The allowlist is
// pinned to loopback-only so ambient CORS_ALLOWED_ORIGINS cannot flip a
// case.
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

import { redactUrl, requestSeesFullUrl } from '@/middleware/rpc-url-visibility';

// A probe route answering with the gate verdict for the request itself —
// the route suites (rpcConfigRoutesVisibility / customChainsRoutes) pin
// the end-to-end redaction; this pins the shared module's own contract.
const probe = new Hono();
probe.get('/', c => c.json({ seesFullUrl: requestSeesFullUrl(c) }));

const socketEnv = (remoteAddress: string) => ({
  incoming: {
    socket: {
      remoteAddress,
      remotePort: 51234,
      remoteFamily: remoteAddress.includes(':') ? 'IPv6' : 'IPv4',
    },
  },
});

const verdict = async (init?: RequestInit, env?: object) => {
  const res = await probe.request('/', init, env);
  return (await res.json()) as { seesFullUrl: boolean };
};

beforeAll(() => {
  // Pin the allowlist to loopback-only (rpcConfigRoutesVisibility.test.ts
  // pattern): the shared policy also admits CORS_ALLOWED_ORIGINS /
  // FRONTEND_URL, which the ambient environment must not leak in.
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.FRONTEND_URL;
});

describe('redactUrl', () => {
  it('keeps scheme + host and drops path, query and fragment', () => {
    expect(redactUrl('https://mainnet.infura.io/v3/SECRET-API-KEY')).toBe(
      'https://mainnet.infura.io/…',
    );
    expect(redactUrl('http://127.0.0.1:8545/a/b/c?token=xyz#frag')).toBe(
      'http://127.0.0.1:8545/…',
    );
  });

  it('degrades an unparseable URL to the opaque marker instead of leaking', () => {
    expect(redactUrl('not a url')).toBe('…');
    expect(redactUrl('')).toBe('…');
  });
});

describe('requestSeesFullUrl', () => {
  it('trusts an allowlisted Origin regardless of socket', async () => {
    const v = await verdict(
      { headers: { origin: 'http://localhost:3000' } },
      socketEnv('203.0.113.7'),
    );
    expect(v).toEqual({ seesFullUrl: true });
  });

  it('does not trust a foreign Origin even from a loopback socket', async () => {
    const v = await verdict(
      { headers: { origin: 'https://attacker.example' } },
      socketEnv('127.0.0.1'),
    );
    expect(v).toEqual({ seesFullUrl: false });
  });

  it('trusts an operator-configured extra Origin (re-read per call)', async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://ops.example';
    try {
      const v = await verdict(
        { headers: { origin: 'https://ops.example' } },
        socketEnv('203.0.113.7'),
      );
      expect(v).toEqual({ seesFullUrl: true });
    } finally {
      delete process.env.CORS_ALLOWED_ORIGINS;
    }
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'trusts an Origin-less loopback caller (%s)',
    async address => {
      const v = await verdict(undefined, socketEnv(address));
      expect(v).toEqual({ seesFullUrl: true });
    },
  );

  it('fails closed for an Origin-less remote caller', async () => {
    const v = await verdict(undefined, socketEnv('192.168.1.5'));
    expect(v).toEqual({ seesFullUrl: false });
  });

  it('fails closed when no socket info exists at all (in-process dev bridge)', async () => {
    const v = await verdict(undefined, {});
    expect(v).toEqual({ seesFullUrl: false });
  });
});
