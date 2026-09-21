// Labels route contract: address validation, PUT body validation (label
// 1-64 trimmed, note <=500/null), upsert semantics (full replace incl.
// note clearing), GET 200/404 and DELETE 204/404, and the admin gate on
// writes. The drizzle layer is faked (eventIndexingRanges.test.ts
// pattern): a single-row in-memory store routed by table identity. The
// where()-keying itself is drizzle's contract — these tests pin the route
// wiring, not SQL generation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const dbState = vi.hoisted(() => ({
  // Single-row store: the route always addresses exactly one (chain,
  // address) per test, so insert-overwrites and select-returns model the
  // upsert/get pair without evaluating drizzle conditions.
  row: null as { label: string; note: string | null } | null,
  inserts: [] as Array<{ values: Record<string, unknown>; set: Record<string, unknown> }>,
  deleted: false,
}));

vi.mock('@/database/drizzle', async () => {
  const { addressLabels } = await import('@/database/schema');
  const S = dbState;

  return {
    db: {
      select: () => {
        const b: Record<string, unknown> = {
          from: (t: unknown) => {
            if (t !== addressLabels) throw new Error('unexpected select table');
            return b;
          },
          where: () => b,
          then: (res: unknown, rej: unknown) =>
            Promise.resolve(S.row === null ? [] : [S.row]).then(res as never, rej as never),
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
  dbState.inserts = [];
  dbState.deleted = false;
  delete process.env.ADMIN_TOKEN;
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('GET /chains/:chainId/labels/:address', () => {
  it('returns the stored label and note', async () => {
    dbState.row = { label: 'Cold wallet', note: 'hardware backup in safe' };
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      label: 'Cold wallet',
      note: 'hardware backup in safe',
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
    await expect(res.json()).resolves.toEqual({ label: 'Cold wallet', note: null });
  });

  it('omitted note clears an existing one (full replace)', async () => {
    dbState.row = { label: 'Old', note: 'stale note' };
    const res = await put({ label: 'New' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ label: 'New', note: null });
    // The upsert set carries the cleared note for the conflict path too.
    expect(dbState.inserts[0]?.set.note).toBeNull();
  });

  it('upsert echoes the trimmed note', async () => {
    const res = await put({ label: 'Hot wallet', note: '  Metamask #3 ' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ label: 'Hot wallet', note: 'Metamask #3' });
  });

  it('PUT → GET roundtrip serves the saved row', async () => {
    await put({ label: 'Roundtrip', note: 'persisted' });
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ label: 'Roundtrip', note: 'persisted' });
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
    dbState.row = { label: 'Gone soon', note: null };
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(dbState.deleted).toBe(true);
    expect(await res.text()).toBe('');
  });

  it('returns 404 label_not_found when nothing is set', async () => {
    const res = await request(`/chains/1/labels/${LABEL_ADDRESS}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'label_not_found' });
    expect(dbState.deleted).toBe(false);
  });
});
