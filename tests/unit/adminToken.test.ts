import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import { requireAdminToken } from '@/middleware/admin-token';

// Minimal app wrapping the middleware with a probe route, mirroring how
// routes/rpc-config.ts (per-route) and routes/performance.ts (subtree)
// apply it. The middleware reads ADMIN_TOKEN per request, so vi.stubEnv
// controls it per test.
function testApp() {
  const app = new Hono();
  app.use('/admin/*', requireAdminToken);
  app.post('/admin/action', c => c.json({ success: true }));
  return app;
}

function post(action = '/admin/action', token?: string) {
  return testApp().request(action, {
    method: 'POST',
    headers: token === undefined ? {} : { 'x-admin-token': token },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireAdminToken middleware', () => {
  it('fails closed with the disabled message when ADMIN_TOKEN is unset or empty', async () => {
    vi.stubEnv('ADMIN_TOKEN', '');

    const response = await post();

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Forbidden');
    expect(body.message).toBe(
      'Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.',
    );
    // Unified error body shape (createApiError).
    expect(body.statusCode).toBe(403);
    expect(typeof body.timestamp).toBe('string');
  });

  it('rejects a missing header with a terse message when ADMIN_TOKEN is set', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'secret');

    const response = await post();

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.message).toBe('Invalid admin token.');
  });

  it('rejects a wrong token of the same length', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'secret');

    const response = await post(undefined, 'secreX');

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe('Invalid admin token.');
  });

  it('rejects a wrong token of a different length without crashing', async () => {
    // timingSafeEqual throws on length mismatch; the guard must absorb it.
    vi.stubEnv('ADMIN_TOKEN', 'secret');

    const response = await post(undefined, 'a-much-longer-guess');

    expect(response.status).toBe(403);
  });

  it('lets the request through when the header matches ADMIN_TOKEN', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'secret');

    const response = await post(undefined, 'secret');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});
