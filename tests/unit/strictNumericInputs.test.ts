// Route/param inputs must be parsed STRICTLY: the repo ships
// parseStrictInteger / parseChainIdParam (plain /^\d+$/ only) precisely
// because Number() and parseInt() accept a valid PREFIX and reinterpret
// the rest. A hex ("0x1a" -> 26), an exponent ("1e5" -> 100000) or
// padded (" 7 " -> 7) input silently addressed a DIFFERENT block, chain
// or page while the UI reported success — the worst failure shape, a
// plausible answer to a question nobody asked.
//
// These tests drive the REAL route apps (service faked at the module
// boundary) and the REAL view parsers, so they pin the shipped parse
// rather than a local re-implementation of it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  recentEvents: vi.fn(),
  getTokenTransfers: vi.fn(),
  listApprovals: vi.fn(),
}));

vi.mock('@/services/WatchService', () => ({
  watchService: {
    recentEvents: mocks.recentEvents,
    // The sub-app owns the watcher interval; mounting calls start().
    start: vi.fn(),
  },
  WATCH_EVENTS_DEFAULT_LIMIT: 25,
  WATCH_EVENTS_MAX_LIMIT: 100,
  WATCH_GAP_BLOCK_CAP: 200,
  WATCH_RING_CAPACITY: 100,
  WATCH_MAX_SUBSCRIPTIONS_PER_CHAIN: 25,
  WATCH_TICK_INTERVAL_MS: 4_000,
  WATCH_GETLOGS_CONCURRENCY: 5,
}));

vi.mock('@/services/TokenTransferService', () => ({
  tokenTransferService: { getTokenTransfers: mocks.getTokenTransfers },
}));

vi.mock('@/services/ApprovalScanService', () => ({
  approvalScanService: { getApprovals: mocks.listApprovals },
}));

import watchRoutes from '@/routes/watch';
import transfersRoutes from '@/routes/transfers';
import approvalsRoutes from '@/routes/approvals';
import { resetRateLimiterState } from '@/middleware/rate-limit';
import { parseChainIdParam, parseBlockNumberParam } from '@/utils/chainParam';
import { parseScanStartBlock } from '@/views/Address/scanStartBlock';
import { chainAddressKey } from '@/services/dataloaders';
import { isChainSupported } from '@/config/chains';

const app = new Hono();
app.route('/', watchRoutes);
app.route('/', transfersRoutes);
app.route('/', approvalsRoutes);

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

// Every spelling Number() accepts but a decimal-integer field must not.
const JUNK = ['0x10', '1e2', ' 7 ', '+7', '0x1a', '1e5'];

/** The limit the service was actually asked for. */
const askedLimit = (): unknown => mocks.recentEvents.mock.calls.at(-1)?.[1];
const askedCursor = (): unknown => mocks.getTokenTransfers.mock.calls.at(-1)?.[2];
// getApprovals(chainId, address, windowBlocks, refresh) — index 2.
const askedWindow = (): unknown => mocks.listApprovals.mock.calls.at(-1)?.[2];

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiterState();
  mocks.recentEvents.mockReturnValue({ events: [] });
  mocks.getTokenTransfers.mockResolvedValue({ transfers: [], total: 0, truncated: false });
  mocks.listApprovals.mockResolvedValue({
    approvals: [],
    total: 0,
    truncated: false,
    // The route reads these honesty fields straight off the result.
    scannedAt: '2026-10-01T00:00:00.000Z',
    windowBlocks: 5_000,
    coverage: 'discovered',
    pairCount: 0,
    history: [],
    historyTruncated: false,
  });
});

describe('GET /watch/events — limit must be a plain decimal integer', () => {
  it.each(JUNK)('rejects ?limit=%j instead of serving a silently different page', async raw => {
    const res = await app.request(`/chains/1/watch/events?limit=${encodeURIComponent(raw)}`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_limit' });
    expect(mocks.recentEvents).not.toHaveBeenCalled();
  });

  it('still accepts a plain integer and still caps it', async () => {
    await expect(app.request('/chains/1/watch/events?limit=40')).resolves.toMatchObject({
      status: 200,
    });
    expect(askedLimit()).toBe(40);

    await expect(app.request('/chains/1/watch/events?limit=5000')).resolves.toMatchObject({
      status: 200,
    });
    expect(askedLimit()).toBe(100);
  });
});

describe('GET /transfers — cursor/limit/window must be plain decimal integers', () => {
  it.each(JUNK)('rejects ?cursor=%j instead of paging to an invented offset', async raw => {
    const res = await app.request(
      `/chains/1/addresses/${ADDRESS}/transfers?cursor=${encodeURIComponent(raw)}`,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_cursor' });
    expect(mocks.getTokenTransfers).not.toHaveBeenCalled();
  });

  it.each(JUNK)('rejects ?limit=%j instead of reading a different page size', async raw => {
    const res = await app.request(
      `/chains/1/addresses/${ADDRESS}/transfers?limit=${encodeURIComponent(raw)}`,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_limit' });
  });

  it('serves a plain integer cursor unchanged', async () => {
    await expect(
      app.request(`/chains/1/addresses/${ADDRESS}/transfers?cursor=40`),
    ).resolves.toMatchObject({ status: 200 });
    expect(askedCursor()).toBe(40);
  });
});

describe('GET /approvals — window must be a plain decimal integer', () => {
  // The window keeps this route's documented degrade-to-default policy (a
  // scan window is a discovery bound, not a page). What must not survive
  // is the COERCION: a hex/exponent spelling must degrade like any other
  // junk, never resolve to the chain a different number names.
  it.each(['0x10', '1e2', ' 7 ', '+7', '0x1a', '1e5'])(
    'degrades ?window=%j to the default instead of sweeping an invented range',
    async raw => {
      const res = await app.request(
        `/chains/1/addresses/${ADDRESS}/approvals?window=${encodeURIComponent(raw)}`,
      );

      expect(res.status).toBe(200);
      // undefined = the service's own tiered default window.
      expect(askedWindow()).toBeUndefined();
    },
  );

  it('serves a plain integer window unchanged', async () => {
    await expect(
      app.request(`/chains/1/addresses/${ADDRESS}/approvals?window=5000`),
    ).resolves.toMatchObject({ status: 200 });
    expect(askedWindow()).toBe(5000);
  });
});

describe('frontend: user-typed and route-typed numbers go through the strict parsers', () => {
  it('parseChainIdParam rejects the hex/exponent forms Number() accepts', () => {
    for (const raw of JUNK) expect(parseChainIdParam(raw)).toBeNull();
    expect(parseChainIdParam('137')).toBe(137);
  });

  it('parseBlockNumberParam rejects the hex/exponent forms Number() accepts', () => {
    for (const raw of JUNK) expect(parseBlockNumberParam(raw)).toBeNull();
    // Block 0 (genesis) is a real value, not "absent".
    expect(parseBlockNumberParam('0')).toBe(0);
    expect(parseBlockNumberParam('21000000')).toBe(21000000);
  });

  it('the deep-scan start-block parser rejects junk instead of scanning the wrong block', () => {
    // '0x1a' -> 26 and '1e5' -> 100000 both passed Number.isInteger, so
    // the panel happily POSTed a start block the user never typed.
    for (const raw of ['0x10', '1e2', '+7', '0x1a', '1e5']) {
      expect(parseScanStartBlock(raw)).toEqual({ ok: false });
    }
    expect(parseScanStartBlock('99999999999999999999999')).toEqual({ ok: false });
    // A user typing spaces around a number is still typing a number —
    // trimming is the field-level courtesy the raw input has.
    expect(parseScanStartBlock(' 7 ')).toEqual({ ok: true, value: 7 });

    expect(parseScanStartBlock('')).toEqual({ ok: true, value: 'earliest' });
    expect(parseScanStartBlock('  ')).toEqual({ ok: true, value: 'earliest' });
    expect(parseScanStartBlock('0')).toEqual({ ok: true, value: 0 });
    expect(parseScanStartBlock('21000000')).toEqual({ ok: true, value: 21000000 });
  });

  it('the contract route loader keys on a strictly parsed chainId', () => {
    // keyOf drives the immutable 24h contract-source cache. Number() read
    // '0x1a' as 26 and '1e5' as 100000, so a hand-typed URL keyed and
    // SERVED the cache of a different chain. Junk must never resolve to a
    // supported numeric id (the fetch's own guard turns it into
    // undefined, which the view renders as UnsupportedChainState).
    for (const raw of JUNK) {
      const [chainId] = chainAddressKey({ params: { chainId: raw, address: ADDRESS } });
      expect(isChainSupported(chainId)).toBe(false);
    }
    expect(chainAddressKey({ params: { chainId: '137', address: ADDRESS } })).toEqual([137, ADDRESS]);
  });
});
