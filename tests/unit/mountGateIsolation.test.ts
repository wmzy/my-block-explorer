// Mount-isolation regression: a sub-app's app.use('*', gate) hoists to
// <base>/* on the PARENT when mounted via app.route, swallowing every
// sibling route mounted AFTER it. This exact leak shipped once: the SQL
// console's strict gate 403'd the watch routes, the SSE stream and (later)
// the ops summary in every zero-config session, and turned unknown /api
// paths into 403s — invisible to per-route tests because they exercise
// sub-apps in isolation, never the composed mount order.
//
// These tests compose the real gated sub-apps with a dummy sibling the
// same way api-app.ts does, so a future '*' re-introduction fails here.
// No database is touched: the dummy sibling never reaches a collector,
// and the gated paths under test reject before any handler body runs.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import sqlRoutes from '@/routes/sql';
import opsRoutes from '@/routes/ops';

const compose = (...subApps: Array<{ fetch: Hono['fetch'] }>) => {
  const parent = new Hono();
  for (const sub of subApps) parent.route('/api', sub as unknown as Hono);
  return parent;
};

const dummy = (): Hono => {
  const app = new Hono();
  app.get('/sibling-route', c => c.json({ sibling: true }));
  return app;
};

describe('mount gate isolation', () => {
  it('sql gate does not swallow a sibling mounted after it (zero-config)', async () => {
    // ADMIN_TOKEN unset in the test environment — the exact session shape
    // the leak broke (requireAdminToken answers 403 'disabled').
    const app = compose(sqlRoutes, dummy());
    const res = await app.request('/api/sibling-route');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sibling: true });
  });

  it('sql endpoints themselves stay strictly gated (fail closed, no token)', async () => {
    const app = compose(sqlRoutes, dummy());
    const res = await app.request('/api/sql/tables');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain('ADMIN_TOKEN');
  });

  it('ops gate does not swallow a sibling mounted after it (zero-config)', async () => {
    const app = compose(opsRoutes, dummy());
    const res = await app.request('/api/sibling-route');
    expect(res.status).toBe(200);
  });

  // The uninstall pair's STRICT gate (registered before the opt-in line,
  // scoped '/ops/uninstall/*'): it must fail closed in a zero-config
  // session — including POST /api/ops/uninstall itself, where the
  // wildcard matches the empty tail — and must not hoist any further
  // than its own prefix (the sibling and the unknown path stay
  // unaffected; only the opt-in '/ops/*' line could ever hoist, and it
  // is prefix-scoped).
  it('ops uninstall pair fails closed (403) without swallowing siblings', async () => {
    const app = compose(opsRoutes, dummy());
    const execute = await app.request('/api/ops/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'uninstall' }),
    });
    expect(execute.status).toBe(403);
    expect(((await execute.json()) as { message?: string }).message).toContain('ADMIN_TOKEN');

    const preview = await app.request('/api/ops/uninstall/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(preview.status).toBe(403);

    // The strict prefix is not a 'use(*)': the sibling after opsRoutes
    // still answers, and unknown /api paths still 404.
    expect((await app.request('/api/sibling-route')).status).toBe(200);
    expect((await app.request('/api/does-not-exist')).status).toBe(404);
  });

  it('unknown /api paths 404 instead of being swallowed by a hoisted gate', async () => {
    const app = compose(sqlRoutes, opsRoutes, dummy());
    const res = await app.request('/api/does-not-exist');
    expect(res.status).toBe(404);
  });
});
