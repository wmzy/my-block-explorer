// Labels route contract: address validation, PUT body validation (label
// 1-64 trimmed, note <=500/null), upsert semantics (full replace incl.
// note clearing), GET 200/404 and DELETE 204/404, the admin gate on
// writes, and the list-all feed GET /labels (backup export: admin tiers,
// ISO timestamps, source pinning). The drizzle layer is faked
// (eventIndexingRanges.test.ts pattern): an in-memory store routed by
// table identity. The where()-keying itself is drizzle's contract —
// these tests pin the route wiring, not SQL generation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { resetRateLimiterState } from '@/middleware/rate-limit';

const dbState = vi.hoisted(() => ({
  // Single-row store: the per-address route always addresses exactly one
  // (chain, address) per test, so insert-overwrites and select-returns
  // model the upsert/get pair without evaluating drizzle conditions.
  row: null as { label: string; note: string | null; source: string | null } | null,
  // Multi-row store: what the list route's table scan (no where clause)
  // resolves with — raw rows carrying every selected column.
  listRows: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ values: Record<string, unknown>; set: Record<string, unknown> }>,
  deleted: false,
}));

vi.mock('@/database/drizzle', async () => {
  const { addressLabels } = await import('@/database/schema');
  const S = dbState;

  return {
    db: {
      select: () => {
        // The per-address builder chains .where() before awaiting; the
        // list route awaits right after .from().orderBy(). The flag
        // routes the same thenable to the right store.
        let sawWhere = false;
        const b: Record<string, unknown> = {
          from: (t: unknown) => {
            if (t !== addressLabels) throw new Error('unexpected select table');
            return b;
          },
          where: () => {
            sawWhere = true;
            return b;
          },
          orderBy: () => b,
          then: (res: unknown, rej: unknown) =>
            Promise.resolve(sawWhere ? (S.row === null ? [] : [S.row]) : S.listRows).then(
              res as never,
              rej as never,
            ),
        };
        return b;
      },
      insert: (t: unknown) => {
        if (t !== addressLabels) throw new Error('unexpected insert table');
        const b: Record<string, unknown> = {
          values: (v: Record<string, unknown>) => {
            S.inserts.push({ values: v, set: {} });
            return b;
          },
          onConflictDoUpdate: (conflict: { set: Record<string, unknown> }) => {
            const entry = S.inserts[S.inserts.length - 1];
            if (entry !== undefined) entry.set = conflict.set;
            // Upsert lands in the store: the row the next GET would serve.
            S.row = {
              label: conflict.set.label as string,
              note: (conflict.set.note ?? null) as string | null,
              source: (conflict.set.source ?? null) as string | null,
            };
            return b;
          },
          then: (res: unknown, rej: unknown) => Promise.resolve([]).then(res as never, rej as never),
        };
        return b;
      },
      delete: (t: unknown) => {
        if (t !== addressLabels) throw new Error('unexpected delete table');
        return {
          where: () => {
            S.deleted = true;
            S.row = null;
            return Promise.resolve([]);
          },
        };
      },
    },
  };
});

import labelsRoutes from '@/routes/labels';

// All-digit address: checksum-neutral, so the exact string reaches the
// storage key.
const LABEL_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const app = new Hono();
app.route('/', labelsRoutes);

const request = (path: string, init?: RequestInit) => app.request(path, init);

beforeEach(() => {
  vi.clearAllMocks();
  dbState.row = null;
  dbState.listRows = [];
  dbState.inserts = [];
  dbState.deleted = false;
  // The list endpoint's limiter (10/min, burst 3) is process-shared and
  // app.request() collapses every call into one fallback bucket — every
  // test must start with a full bucket.
  resetRateLimiterState();
  delete process.env.ADMIN_TOKEN;
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('GET /chains/:chainId/labels/:address', () => {
  it('returns the stored label, note and user source', async () => {
    dbState.row = { label: 'Cold wallet', note: 'hardware backup in safe', source: 'user' };
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      label: 'Cold wallet',
      note: 'hardware backup in safe',
      source: 'user',
    });
  });

  it('reports source builtin for a seeded row', async () => {
    dbState.row = { label: 'Uniswap V3: SwapRouter02', note: null, source: 'builtin' };
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      label: 'Uniswap V3: SwapRouter02',
      source: 'builtin',
    });
  });

  it('coerces a null source (storage is nullable) to user, never leaking null', async () => {
    dbState.row = { label: 'Legacy row', note: null, source: null };
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      label: 'Legacy row',
      note: null,
      source: 'user',
    });
  });

  it('returns 404 label_not_found when nothing is set', async () => {
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'label_not_found' });
  });

  it('rejects a malformed address with 400', async () => {
    const res = await request('/chains/1/labels/notanaddress');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('rejects an unsupported chain with 400', async () => {
    // The config supports every viem chain (some with absurd ids), so the
    // reliable "unsupported" case is an id outside viem's entire list.
    const res = await request(`/chains/424242424242424/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /labels — list every label (backup/export feed)', () => {
  const ADDRESS_A = '0x1234567890abcdef1234567890abcdef12345678';
  const ADDRESS_B = '0xabcdef0123456789012345678901234567890123';

  it('serves all rows across chains with ISO timestamps and pinned sources', async () => {
    dbState.listRows = [
      {
        chainId: 1,
        address: ADDRESS_A,
        label: 'Cold wallet',
        note: 'hardware backup in safe',
        source: null, // storage is nullable — the API contract pins it to 'user'
        updatedAt: new Date('2026-09-24T10:30:00.000Z'),
      },
      {
        chainId: 137,
        address: ADDRESS_B,
        label: 'Binance 14',
        note: null,
        source: 'builtin',
        // Naive UTC string (space-separated, no offset): must parse as
        // UTC wall clock, never machine-local.
        updatedAt: '2026-09-21 12:07:19.183',
      },
    ];
    const res = await request('/labels');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      labels: [
        {
          chainId: 1,
          address: ADDRESS_A,
          label: 'Cold wallet',
          note: 'hardware backup in safe',
          source: 'user',
          updatedAt: '2026-09-24T10:30:00.000Z',
        },
        {
          chainId: 137,
          address: ADDRESS_B,
          label: 'Binance 14',
          note: null,
          source: 'builtin',
          updatedAt: '2026-09-21T12:07:19.183Z',
        },
      ],
    });
  });

  it('answers an empty table with an explicit empty list', async () => {
    const res = await request('/labels');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ labels: [] });
  });

  it('enforces the admin gate when ADMIN_TOKEN is configured', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await request('/labels');
    expect(res.status).toBe(403);
  });

  it('passes the gate with the right token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    dbState.listRows = [
      { chainId: 1, address: ADDRESS_A, label: 'One', note: null, source: 'user', updatedAt: null },
    ];
    const res = await request('/labels', { headers: { 'x-admin-token': 'secret' } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ labels: [{ label: 'One' }] });
  });
});

describe('PUT /chains/:chainId/labels/:address — body validation', () => {
  const put = (body: unknown) =>
    request(`/chains/1/labels/${LABEL_ADDRESS}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it.each([
    ['missing label', { note: 'x' }],
    ['empty label', { label: '' }],
    ['whitespace-only label', { label: '   ' }],
    ['label over 64 chars after trim', { label: 'x'.repeat(65) }],
    ['non-string label', { label: 42 }],
    ['note over 500 chars', { label: 'ok', note: 'n'.repeat(501) }],
    ['non-string note', { label: 'ok', note: 7 }],
    ['array body', ['ok']],
    ['string body', '"ok"'],
    ['invalid JSON', '{label:'],
  ])('rejects %s with 400 invalid_label', async (_name, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    const parsed = await res.json();
    expect(parsed.error).toBe('invalid_label');
    expect(dbState.inserts).toHaveLength(0);
  });

  it('trims the label and normalizes empty note to null', async () => {
    const res = await put({ label: '  Cold wallet  ', note: '   ' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      label: 'Cold wallet',
      note: null,
      source: 'user',
    });
  });

  it('omitted note clears an existing one (full replace)', async () => {
    dbState.row = { label: 'Old', note: 'stale note', source: 'user' };
    const res = await put({ label: 'New' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ label: 'New', note: null, source: 'user' });
    // The upsert set carries the cleared note for the conflict path too.
    expect(dbState.inserts[0]?.set.note).toBeNull();
  });

  it('upsert echoes the trimmed note', async () => {
    const res = await put({ label: 'Hot wallet', note: '  Metamask #3 ' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      label: 'Hot wallet',
      note: 'Metamask #3',
      source: 'user',
    });
  });

  it('converts a builtin row to a user label (user intent wins over the seed)', async () => {
    dbState.row = { label: 'Binance 14', note: 'seeded', source: 'builtin' };
    const res = await put({ label: 'My Binance contact', note: 'renamed' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ source: 'user' });
    // Both insert values and the conflict-update set force 'user' — the
    // set path is the actual conversion of the pre-existing builtin row.
    expect(dbState.inserts[0]?.values.source).toBe('user');
    expect(dbState.inserts[0]?.set.source).toBe('user');
    // And the store the next GET would serve reflects the conversion.
    expect(dbState.row?.source).toBe('user');
  });

  it('PUT → GET roundtrip serves the saved row', async () => {
    await put({ label: 'Roundtrip', note: 'persisted' });
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      label: 'Roundtrip',
      note: 'persisted',
      source: 'user',
    });
  });

  it('rejects a malformed address with 400 before touching the db', async () => {
    const res = await request('/chains/1/labels/0xzz', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'x' }),
    });
    expect(res.status).toBe(400);
    expect(dbState.inserts).toHaveLength(0);
  });
});

describe('admin gating on writes', () => {
  it('PUT with a wrong token is rejected 403 and persists nothing', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'wrong' },
      body: JSON.stringify({ label: 'x' }),
    });
    expect(res.status).toBe(403);
    expect(dbState.inserts).toHaveLength(0);
  });

  it('PUT with the right token passes', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'secret' },
      body: JSON.stringify({ label: 'gated' }),
    });
    expect(res.status).toBe(200);
  });

  it('GET stays open with a token configured', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /chains/:chainId/labels/:address', () => {
  it('removes an existing label with 204 and an empty body', async () => {
    dbState.row = { label: 'Gone soon', note: null, source: 'user' };
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(dbState.deleted).toBe(true);
    expect(await res.text()).toBe('');
  });

  it('deletes a builtin row too — the user said remove it', async () => {
    dbState.row = { label: 'Binance 14', note: null, source: 'builtin' };
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(dbState.deleted).toBe(true);
  });

  it('returns 404 label_not_found when nothing is set', async () => {
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'label_not_found' });
    expect(dbState.deleted).toBe(false);
  });
});
