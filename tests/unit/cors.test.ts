import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import { corsMiddleware } from '@/middleware/cors';

// Minimal app wrapping the middleware with probe routes, mirroring how
// api-app.ts applies it (app.use('*', corsMiddleware)). The allowlist
// reads CORS_ALLOWED_ORIGINS / FRONTEND_URL per request, so vi.stubEnv
// controls them per test.
function testApp() {
  const app = new Hono();
  app.use('*', corsMiddleware);
  app.get('/data', c => c.json({ success: true }));
  app.post('/data', c => c.json({ success: true }));
  return app;
}

function get(origin?: string) {
  return testApp().request('/data', {
    method: 'GET',
    headers: origin === undefined ? {} : { origin },
  });
}

function options(origin: string, requestHeaders?: string) {
  return testApp().request('/data', {
    method: 'OPTIONS',
    headers: {
      origin,
      ...(requestHeaders === undefined ? {} : { 'Access-Control-Request-Headers': requestHeaders }),
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('corsMiddleware allowlist', () => {
  describe('allowed origins', () => {
    it.each([
      'http://localhost:3000',
      'http://localhost:5173',
      'https://localhost',
      'http://127.0.0.1:8201',
      'https://127.0.0.1:4443',
    ])('echoes %s in Access-Control-Allow-Origin', async (origin) => {
      const response = await get(origin);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    });

    it('answers preflights from an allowed origin with full CORS headers', async () => {
      const response = await options('http://localhost:3000', 'content-type,x-admin-token');

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      // The frontend injects x-admin-token on gated writes, so the
      // preflight must allow it for cross-origin saves to work.
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-Admin-Token');
    });
  });

  describe('disallowed origins', () => {
    it.each([
      'https://evil.example',
      'http://localhost.evil.example',
      'http://fake-localhost:3000',
      'https://104.18.0.1',
    ])('sets no Access-Control-Allow-Origin for %s', async (origin) => {
      const response = await get(origin);

      expect(response.status).toBe(200); // server still answers; browsers block the read
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('gives a disallowed preflight no Access-Control-Allow-Origin', async () => {
      const response = await options('https://evil.example', 'content-type');

      // No allow-origin in the preflight response means the browser
      // blocks the preflighted write before it is ever sent.
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('no Origin header', () => {
    it('passes same-origin/curl requests through without CORS headers', async () => {
      const response = await get();

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(await response.json()).toEqual({ success: true });
    });
  });

  describe('env-configured origins', () => {
    it('allows origins listed in CORS_ALLOWED_ORIGINS (comma-separated)', async () => {
      vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://explorer.example , https://stats.example:8443');

      expect((await get('https://explorer.example')).headers.get('Access-Control-Allow-Origin'))
        .toBe('https://explorer.example');
      expect((await get('https://stats.example:8443')).headers.get('Access-Control-Allow-Origin'))
        .toBe('https://stats.example:8443');
    });

    it('allows FRONTEND_URL, tolerating a trailing slash', async () => {
      vi.stubEnv('FRONTEND_URL', 'https://my-explorer.example/');

      const response = await get('https://my-explorer.example');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://my-explorer.example');
    });

    it('does not leak env-configured access to unrelated origins', async () => {
      vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://explorer.example');

      expect((await get('https://other.example')).headers.get('Access-Control-Allow-Origin'))
        .toBeNull();
    });
  });

  it('marks responses as varying on Origin', async () => {
    const response = await get('http://localhost:3000');

    expect(response.headers.get('Vary')).toContain('Origin');
  });
});
