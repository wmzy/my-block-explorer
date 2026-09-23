// Price-history layer tests: fetchPriceHistory / usePriceHistory in
// services/prices (the /chart sibling of the spot layer) plus the Token
// page's pure day-grid mapping. Covered: URL/key building through the
// EXISTING id maps (incl. the gnosis=xdai quirk), request param
// computation, series shaping (unsorted input, duplicate timestamps,
// gaps never fabricated, min/max), the unavailable taxonomy (non-200,
// timeout, malformed body), TTL positive AND negative caching, in-flight
// dedupe, and the hook's settle shape. The only network edge — global
// fetch — is stubbed; the service code under test is real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import {
  fetchPriceHistory,
  priceHistoryUrl,
  resetPricesForTests,
  shapePriceHistory,
  usePriceHistory,
  type PriceHistoryWindow,
} from '@/services/prices';
import { toDailyGappedSeries } from '@/views/Token/priceHistorySeries';

const ETH = 'coingecko:ethereum';
// Real USDT checksum: exercises viem checksumming without hardcoding a
// made-up case pattern.
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const DAY = 86_400;

const fetchMock = vi.fn<typeof fetch>();

const chartResponse = (coins: Record<string, unknown>): Response =>
  ({ ok: true, json: async () => ({ coins }) }) as Response;

const chartFor = (
  id: string,
  prices: Array<{ timestamp: number; price: number }>,
): Response =>
  chartResponse({ [id]: { symbol: 'ETH', confidence: 0.99, prices } });

// Points safely inside both supported windows (no second-boundary races
// against the service's own Date.now()).
const recentPoints = (): Array<{ timestamp: number; price: number }> => {
  const now = Math.floor(Date.now() / 1000);
  return [
    { timestamp: now - 5 * DAY, price: 2 },
    { timestamp: now - 3 * DAY, price: 4 },
    { timestamp: now - 1 * DAY, price: 3 },
  ];
};

const callUrl = (index = 0): string => String(fetchMock.mock.calls[index]?.[0]);

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset (not just clearAllMocks): the once-implementation queue
  // must not leak across tests — the negative cache makes a same-subject
  // second call skip the network, leaving once-mocks unconsumed.
  fetchMock.mockReset();
  resetPricesForTests();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('history URL and coin keys', () => {
  it('builds the /chart URL from the window params (30d and 7d)', () => {
    expect(priceHistoryUrl('coingecko:ethereum', 30, 1_700_000_000)).toBe(
      'https://coins.llama.fi/chart/coingecko:ethereum?start=1697408000&span=30&period=1d&searchWidth=600',
    );
    expect(priceHistoryUrl('xdai:0xABC', 7, 1_700_000_000)).toBe(
      'https://coins.llama.fi/chart/xdai:0xABC?start=1699395200&span=7&period=1d&searchWidth=600',
    );
  });

  it('native-coin requests reuse the coingecko id map (L2s included)', async () => {
    fetchMock.mockResolvedValue(chartFor(ETH, recentPoints()));

    await fetchPriceHistory(1);
    expect(callUrl()).toContain('/chart/coingecko:ethereum?');

    await fetchPriceHistory(42161);
    expect(callUrl(1)).toContain('/chart/coingecko:ethereum?');
  });

  it('token requests reuse the slug:checksum id builders (gnosis=xdai quirk)', async () => {
    fetchMock.mockResolvedValue(chartResponse({}));

    await fetchPriceHistory(100, '0xabc0000000000000000000000000000000000001');
    expect(callUrl()).toContain(
      '/chart/xdai:0xABC0000000000000000000000000000000000001?',
    );

    await fetchPriceHistory(137, USDT.toLowerCase());
    expect(callUrl(1)).toContain(`/chart/polygon:${USDT}?`);
  });

  it('normalizes an unsupported window to 30 and caches it under the 30d key', async () => {
    fetchMock.mockResolvedValue(chartFor(ETH, recentPoints()));

    await fetchPriceHistory(1, undefined, 14 as PriceHistoryWindow);
    expect(callUrl()).toContain('span=30');

    await fetchPriceHistory(1, undefined, 30);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('settles unmapped subjects without any network access', async () => {
    expect(await fetchPriceHistory(9999)).toEqual({
      status: 'unavailable',
      reason: 'unmapped chain or token',
    });
    expect(await fetchPriceHistory(1, 'not-an-address')).toEqual({
      status: 'unavailable',
      reason: 'unmapped chain or token',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('request params', () => {
  it('computes start = now − window·86400 and span = window', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(1_700_000_123_456);
      fetchMock.mockResolvedValue(chartFor(ETH, recentPoints()));

      await fetchPriceHistory(1);
      expect(callUrl()).toBe(
        'https://coins.llama.fi/chart/coingecko:ethereum?start=1697408123&span=30&period=1d&searchWidth=600',
      );

      await fetchPriceHistory(1, undefined, 7);
      expect(callUrl(1)).toBe(
        'https://coins.llama.fi/chart/coingecko:ethereum?start=1699395323&span=7&period=1d&searchWidth=600',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('shapePriceHistory (pure)', () => {
  const base = 1_700_000_000;

  it('sorts unsorted input ascending by timestamp', () => {
    const shaped = shapePriceHistory(
      [
        { timestamp: base + 300, price: 3 },
        { timestamp: base, price: 1 },
        { timestamp: base + 200, price: 2 },
      ],
      base,
    );
    expect(shaped.points.map((p) => p.price)).toEqual([1, 2, 3]);
  });

  it('keeps the LAST occurrence of a duplicated timestamp', () => {
    const shaped = shapePriceHistory(
      [
        { timestamp: base, price: 1 },
        { timestamp: base, price: 1.5 },
      ],
      base,
    );
    expect(shaped.points).toEqual([{ timestamp: base, price: 1.5 }]);
  });

  it('drops pre-window points and malformed entries', () => {
    const shaped = shapePriceHistory(
      [
        { timestamp: base - 1, price: 9 }, // searchWidth pre-window neighbor
        'nope',
        null,
        { timestamp: 'x', price: 1 },
        { timestamp: base, price: 0 },
        { timestamp: base, price: -3 },
        { timestamp: base, price: 'nope' },
        { price: 5 }, // no timestamp
        { timestamp: base + 10, price: 2 }, // the one usable entry
      ],
      base,
    );
    expect(shaped.points).toEqual([{ timestamp: base + 10, price: 2 }]);
    expect(shaped.extent).toEqual({ min: 2, max: 2 });
  });

  it('never fabricates missing days — gaps stay gaps', () => {
    // Days 0, 2, 4 answered; days 1 and 3 must NOT appear as points.
    const shaped = shapePriceHistory(
      [
        { timestamp: base, price: 1 },
        { timestamp: base + 2 * DAY, price: 3 },
        { timestamp: base + 4 * DAY, price: 2 },
      ],
      base,
    );
    expect(shaped.points.map((p) => p.timestamp)).toEqual([
      base,
      base + 2 * DAY,
      base + 4 * DAY,
    ]);
  });

  it('exposes min/max for axis scaling; empty input yields no extent', () => {
    expect(
      shapePriceHistory(
        [
          { timestamp: base, price: 3 },
          { timestamp: base + DAY, price: 1 },
          { timestamp: base + 2 * DAY, price: 2 },
        ],
        base,
      ).extent,
    ).toEqual({ min: 1, max: 3 });

    expect(shapePriceHistory([], base)).toEqual({ points: [], extent: null });
    expect(shapePriceHistory('nope', base)).toEqual({ points: [], extent: null });
    expect(shapePriceHistory({ 0: { timestamp: base, price: 1 } }, base)).toEqual({
      points: [],
      extent: null,
    });
  });
});

describe('unavailable taxonomy', () => {
  it('a non-2xx response settles "request failed" with exactly one warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);

      expect(await fetchPriceHistory(1)).toEqual({
        status: 'unavailable',
        reason: 'request failed',
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a request that outlives the timeout budget aborts to "request failed"', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A fetch that only ever settles through its abort signal.
      fetchMock.mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('The operation was aborted'));
            });
          }),
      );

      const pending = fetchPriceHistory(1);
      vi.advanceTimersByTime(8_001); // REQUEST_TIMEOUT_MS is 8s
      expect(await pending).toEqual({
        status: 'unavailable',
        reason: 'request failed',
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('malformed bodies settle "malformed response" without a warn (the API answered)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock
        // Non-object JSON.
        .mockResolvedValueOnce({ ok: true, json: async () => [] } as unknown as Response)
        // coins is not a record.
        .mockResolvedValueOnce(
          { ok: true, json: async () => ({ coins: 'nope' }) } as unknown as Response,
        )
        // prices is not an array (chain 56 → its own native id).
        .mockResolvedValueOnce(
          chartResponse({ 'coingecko:binancecoin': { prices: 'nope' } }));

      // Distinct subjects (chainId is part of the cache key): each call
      // must actually reach the network — the negative cache would
      // otherwise answer variants 2 and 3 from variant 1's verdict.
      expect(await fetchPriceHistory(1)).toEqual({
        status: 'unavailable',
        reason: 'malformed response',
      });
      expect(await fetchPriceHistory(10)).toEqual({
        status: 'unavailable',
        reason: 'malformed response',
      });
      expect(await fetchPriceHistory(56)).toEqual({
        status: 'unavailable',
        reason: 'malformed response',
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('answered-but-empty series settle "no usable points in the window"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock
        // Unknown coin: the coins record has no entry for our key.
        .mockResolvedValueOnce(chartResponse({}))
        // Empty prices array.
        .mockResolvedValueOnce(chartFor(ETH, []))
        // Every entry unusable (chain 56 → its own native id).
        .mockResolvedValueOnce(
          chartResponse({
            'coingecko:binancecoin': { prices: [{ timestamp: 1, price: 0 }, 'nope'] },
          }),
        );

      expect(await fetchPriceHistory(1)).toEqual({
        status: 'unavailable',
        reason: 'no usable points in the window',
      });
      expect(await fetchPriceHistory(10)).toEqual({
        status: 'unavailable',
        reason: 'no usable points in the window',
      });
      expect(await fetchPriceHistory(56)).toEqual({
        status: 'unavailable',
        reason: 'no usable points in the window',
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('ok outcomes', () => {
  it('settles ok with sorted points, extent, symbol, confidence and window echo', async () => {
    const base = Math.floor(Date.now() / 1000) - 30 * DAY;
    fetchMock.mockResolvedValue(
      chartFor(ETH, [
        { timestamp: base + 3 * DAY, price: 3 },
        { timestamp: base + DAY, price: 1 },
        { timestamp: base + 2 * DAY, price: 2 },
      ]),
    );

    const outcome = await fetchPriceHistory(1);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.points.map((p) => p.price)).toEqual([1, 2, 3]);
    expect(outcome.extent).toEqual({ min: 1, max: 3 });
    expect(outcome.symbol).toBe('ETH');
    expect(outcome.confidence).toBe(0.99);
    expect(outcome.windowDays).toBe(30);
    // start = the service's own now − 30d; the test's base may trail by
    // a second-boundary tick.
    expect(Math.abs(outcome.start - base)).toBeLessThanOrEqual(1);
  });

  it('nulls out unusable symbol/confidence fields instead of guessing', async () => {
    fetchMock.mockResolvedValue(
      chartResponse({
        [ETH]: { symbol: 123, confidence: 5, prices: recentPoints() },
      }),
    );

    const outcome = await fetchPriceHistory(1);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.symbol).toBeNull();
    expect(outcome.confidence).toBeNull();
  });
});

describe('caching and dedupe', () => {
  it('serves a fresh ok series from cache, then refetches after the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      fetchMock.mockResolvedValue(chartFor(ETH, recentPoints()));

      await fetchPriceHistory(1);
      await fetchPriceHistory(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
      await fetchPriceHistory(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches settled-unavailable verdicts for the TTL (one attempt per window)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);

      await fetchPriceHistory(1);
      await fetchPriceHistory(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
      await fetchPriceHistory(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares one in-flight request between concurrent callers', async () => {
    fetchMock.mockResolvedValue(chartFor(`ethereum:${USDT}`, recentPoints()));

    const [a, b] = await Promise.all([
      fetchPriceHistory(1, USDT),
      fetchPriceHistory(1, USDT),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
  });

  it('caches windows separately (30d and 7d are distinct subjects)', async () => {
    fetchMock.mockResolvedValue(chartFor(`ethereum:${USDT}`, recentPoints()));

    await fetchPriceHistory(1, USDT, 30);
    await fetchPriceHistory(1, USDT, 7);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callUrl()).toContain('span=30');
    expect(callUrl(1)).toContain('span=7');
  });
});

describe('usePriceHistory', () => {
  it('is undefined while in flight, then settles the ok outcome', async () => {
    fetchMock.mockResolvedValue(chartFor(`ethereum:${USDT}`, recentPoints()));

    const { result } = renderHook(() => usePriceHistory(1, USDT, 30));

    expect(result.current).toBeUndefined();
    await waitFor(() => {
      expect(result.current?.status).toBe('ok');
    });
    if (result.current?.status !== 'ok') return;
    expect(result.current.points).toHaveLength(3);
    expect(result.current.windowDays).toBe(30);
  });

  it('settles unavailable (with reason) when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => usePriceHistory(1, USDT, 30));

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    expect(result.current).toEqual({
      status: 'unavailable',
      reason: 'request failed',
    });
  });

  it('refetches when the window switches (30d → 7d)', async () => {
    fetchMock.mockResolvedValue(chartFor(`ethereum:${USDT}`, recentPoints()));

    const { result, rerender } = renderHook(
      ({ window }) => usePriceHistory(1, USDT, window),
      { initialProps: { window: 30 as PriceHistoryWindow } },
    );
    await waitFor(() => {
      expect(result.current?.status).toBe('ok');
    });

    rerender({ window: 7 });
    await waitFor(() => {
      expect(result.current?.status).toBe('ok');
    });
    if (result.current?.status !== 'ok') return;
    expect(result.current.windowDays).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callUrl(1)).toContain('span=7');
  });

  it('surfaces an already-cached series synchronously (no loading flash)', async () => {
    fetchMock.mockResolvedValue(chartFor(`ethereum:${USDT}`, recentPoints()));

    const first = renderHook(() => usePriceHistory(1, USDT, 30));
    await waitFor(() => {
      expect(first.result.current?.status).toBe('ok');
    });
    first.unmount();

    fetchMock.mockClear();
    const second = renderHook(() => usePriceHistory(1, USDT, 30));
    expect(second.result.current?.status).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('toDailyGappedSeries (Token page day grid)', () => {
  const start = 100 * DAY; // aligned grid origin: UTC day 100

  it('maps points onto day slots; unanswered days stay null (gaps preserved)', () => {
    const series = toDailyGappedSeries(
      [
        { timestamp: start, price: 1 }, // day 100 → index 0
        { timestamp: start + DAY, price: 2 }, // day 101 → index 1
        { timestamp: start + 3 * DAY, price: 4 }, // day 103 → index 3
      ],
      start,
      7,
    );
    expect(series).toEqual([1, 2, null, 4, null, null, null, null]);
  });

  it('keeps the last observation of a twice-answered day', () => {
    const series = toDailyGappedSeries(
      [
        { timestamp: start, price: 1 },
        { timestamp: start + 500, price: 1.5 },
      ],
      start,
      7,
    );
    expect(series[0]).toBe(1.5);
  });

  it('drops points outside the grid (defensive — the service already windowed)', () => {
    const series = toDailyGappedSeries(
      [
        { timestamp: start - DAY, price: 9 }, // before the grid
        { timestamp: start, price: 1 },
        { timestamp: start + 8 * DAY, price: 9 }, // past the last slot
      ],
      start,
      7,
    );
    expect(series).toEqual([1, null, null, null, null, null, null, null]);
  });

  it('handles a mid-day window start (grid anchored to the start DAY)', () => {
    const series = toDailyGappedSeries(
      [{ timestamp: start + DAY, price: 2 }],
      start + 43_200, // noon of day 100 — still grid day 100
      7,
    );
    expect(series).toEqual([null, 2, null, null, null, null, null, null]);
  });
});
