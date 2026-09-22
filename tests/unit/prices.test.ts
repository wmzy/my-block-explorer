// Fiat price service tests: id-map gating (unmapped chain/address → no
// fetch), TTL positive AND negative caching, in-flight dedupe, ≤30-id
// chunking, and the failure contract (settled unavailable, ONE warn, one
// attempt per TTL window). The only network edge — global fetch — is
// stubbed; the service code under test is real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import {
  fetchUsdPrices,
  gasTransferCostUsd,
  nativeAmountToUsd,
  nativePriceId,
  resetPricesForTests,
  tokenAmountToUsd,
  tokenPriceId,
  useNativeUsdPrice,
  useTokenUsdPrices,
} from '@/services/prices';

const ETH = 'coingecko:ethereum';
// Real USDT checksum: exercises viem checksumming without hardcoding a
// made-up case pattern.
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

const fetchMock = vi.fn<typeof fetch>();

const llamaResponse = (coins: Record<string, unknown>): Response =>
  ({ ok: true, json: async () => ({ coins }) }) as Response;

beforeEach(() => {
  vi.clearAllMocks();
  resetPricesForTests();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('id maps', () => {
  it('maps the popular chains to their verified DefiLlama ids', () => {
    expect(nativePriceId(1)).toBe('coingecko:ethereum');
    // POL era id, not the legacy "matic-network".
    expect(nativePriceId(137)).toBe('coingecko:polygon-ecosystem-token');
    expect(nativePriceId(56)).toBe('coingecko:binancecoin');
    // L2s are ETH franchises.
    expect(nativePriceId(42161)).toBe('coingecko:ethereum');
    expect(nativePriceId(8453)).toBe('coingecko:ethereum');
    expect(nativePriceId(10)).toBe('coingecko:ethereum');
    expect(nativePriceId(43114)).toBe('coingecko:avalanche-2');
    expect(nativePriceId(250)).toBe('coingecko:fantom');
    expect(nativePriceId(42220)).toBe('coingecko:celo');
    expect(nativePriceId(100)).toBe('coingecko:gnosis');
  });

  it('returns null for unmapped or invalid chains — never a guess', () => {
    expect(nativePriceId(9999)).toBeNull();
    expect(nativePriceId(0)).toBeNull();
    expect(nativePriceId(-1)).toBeNull();
    expect(tokenPriceId(11155111, '0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBeNull();
  });

  it('builds checksummed slug:address token ids (gnosis=xdai, avalanche=avax)', () => {
    expect(tokenPriceId(1, USDT)).toBe(`ethereum:${USDT}`);
    // Lowercase input normalizes to the same checksummed id.
    expect(tokenPriceId(1, USDT.toLowerCase())).toBe(`ethereum:${USDT}`);
    expect(tokenPriceId(100, '0xabc0000000000000000000000000000000000001')).toBe(
      'xdai:0xABC0000000000000000000000000000000000001',
    );
    expect(tokenPriceId(43114, '0xabc0000000000000000000000000000000000001')).toBe(
      'avax:0xABC0000000000000000000000000000000000001',
    );
  });

  it('returns null for an invalid address without throwing', () => {
    expect(tokenPriceId(1, 'not-an-address')).toBeNull();
    expect(tokenPriceId(1, '')).toBeNull();
  });
});

describe('fetchUsdPrices', () => {
  it('fires no request for an empty id list', async () => {
    const result = await fetchUsdPrices([]);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves snapshots from the coins payload, keyed by id', async () => {
    fetchMock.mockResolvedValue(
      llamaResponse({ [ETH]: { price: 2740.68, symbol: 'ETH' } }),
    );

    const result = await fetchUsdPrices([ETH]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `https://coins.llama.fi/prices/current/${ETH}`,
    );
    expect(result.get(ETH)?.usd).toBe(2740.68);
  });

  it('settles null for an id the API does not know', async () => {
    fetchMock.mockResolvedValue(llamaResponse({}));

    const result = await fetchUsdPrices([ETH]);

    expect(result.get(ETH)).toBeNull();
  });

  it('treats zero, negative, and non-numeric prices as no price', async () => {
    fetchMock.mockResolvedValue(
      llamaResponse({
        'a:a': { price: 0 },
        'b:b': { price: -3 },
        'c:c': { price: 'nope' },
        'd:d': { symbol: 'NOPE' },
      }),
    );

    const result = await fetchUsdPrices(['a:a', 'b:b', 'c:c', 'd:d']);

    expect(result.get('a:a')).toBeNull();
    expect(result.get('b:b')).toBeNull();
    expect(result.get('c:c')).toBeNull();
    expect(result.get('d:d')).toBeNull();
  });

  it('serves a second call within the TTL from cache, then refetches after expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      fetchMock.mockResolvedValue(llamaResponse({ [ETH]: { price: 1 } }));

      await fetchUsdPrices([ETH]);
      await fetchUsdPrices([ETH]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61_000);
      await fetchUsdPrices([ETH]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches settled-unavailable verdicts for the TTL (one attempt per window)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      fetchMock.mockResolvedValue(llamaResponse({}));

      await fetchUsdPrices([ETH]);
      await fetchUsdPrices([ETH]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61_000);
      await fetchUsdPrices([ETH]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares one request between concurrent calls for the same subject', async () => {
    fetchMock.mockResolvedValue(llamaResponse({ [ETH]: { price: 2 } }));

    const [a, b] = await Promise.all([
      fetchUsdPrices([ETH]),
      fetchUsdPrices([ETH]),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.get(ETH)?.usd).toBe(2);
    expect(b.get(ETH)?.usd).toBe(2);
  });

  it('chunks more than 30 ids into bounded requests', async () => {
    fetchMock.mockResolvedValue(llamaResponse({}));

    const ids = Array.from({ length: 45 }, (_, index) => `chain${index}:0xabc`);
    await fetchUsdPrices(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = String(fetchMock.mock.calls[0][0]);
    const second = String(fetchMock.mock.calls[1][0]);
    expect(first.split('/current/')[1].split(',')).toHaveLength(30);
    expect(second.split('/current/')[1].split(',')).toHaveLength(15);
  });

  it('a rejected fetch settles unavailable with exactly one console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock.mockRejectedValue(new Error('network down'));

      const result = await fetchUsdPrices([ETH, 'bsc:0xabc']);

      expect(result.get(ETH)).toBeNull();
      expect(result.get('bsc:0xabc')).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      // No retry storm: the next call inside the window stays offline.
      await fetchUsdPrices([ETH]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a non-2xx response settles unavailable with one console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);

      const result = await fetchUsdPrices([ETH]);

      expect(result.get(ETH)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a malformed payload settles unavailable without a warn (the API answered)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock.mockResolvedValue({ ok: true, json: async () => [] } as unknown as Response);

      const result = await fetchUsdPrices([ETH]);

      expect(result.get(ETH)).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('useNativeUsdPrice', () => {
  it('settles null without any network for an unmapped chain', () => {
    const { result } = renderHook(() => useNativeUsdPrice(9999));

    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes the snapshot once the request lands', async () => {
    fetchMock.mockResolvedValue(llamaResponse({ [ETH]: { price: 2740.68 } }));

    const { result } = renderHook(() => useNativeUsdPrice(1));

    await waitFor(() => {
      expect(result.current).not.toBeUndefined();
    });
    expect(result.current?.usd).toBe(2740.68);
    expect(result.current?.fetchedAt).toBeGreaterThan(0);
  });

  it('settles null when the price request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock.mockRejectedValue(new Error('offline'));

      const { result } = renderHook(() => useNativeUsdPrice(1));

      await waitFor(() => {
        expect(result.current).not.toBeUndefined();
      });
      expect(result.current).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('useTokenUsdPrices', () => {
  // Digits-only addresses: checksum-stable, so id expectations stay
  // literal.
  const TOKEN_A = `0x${'1'.repeat(40)}`;
  const TOKEN_B = `0x${'2'.repeat(40)}`;

  it('returns a settled empty map for an empty list, with no network', () => {
    const { result } = renderHook(() => useTokenUsdPrices(1, []));

    expect(result.current).toBeDefined();
    expect(result.current?.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a settled empty map for an unmapped chain, with no network', async () => {
    const { result } = renderHook(() => useTokenUsdPrices(9999, [TOKEN_A]));

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    expect(result.current?.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('batches all tokens into one request and keys results by lowercase address', async () => {
    fetchMock.mockResolvedValue(
      llamaResponse({
        [`ethereum:${TOKEN_A}`]: { price: 1.5 },
        // TOKEN_B intentionally absent: unknown to the API.
      }),
    );

    const { result } = renderHook(() =>
      useTokenUsdPrices(1, [TOKEN_A.toUpperCase(), TOKEN_B]),
    );

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      String(fetchMock.mock.calls[0][0]).endsWith(`/current/ethereum:${TOKEN_A},ethereum:${TOKEN_B}`),
    ).toBe(true);
    expect(result.current?.get(TOKEN_A)?.usd).toBe(1.5);
    expect(result.current?.has(TOKEN_B)).toBe(false);
  });

  it('drops invalid addresses from the request without failing the batch', async () => {
    fetchMock.mockResolvedValue(llamaResponse({}));

    const { result } = renderHook(() =>
      useTokenUsdPrices(1, ['not-an-address', TOKEN_A]),
    );

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('not-an-address');
  });
});

describe('amount arithmetic', () => {
  const price = { usd: 2500, fetchedAt: 0 };

  it('nativeAmountToUsd: 1 ETH at $2500 → 2500', () => {
    expect(nativeAmountToUsd(10n ** 18n, price)).toBe(2500);
  });

  it('tokenAmountToUsd applies the token decimals', () => {
    expect(tokenAmountToUsd(2n * 10n ** 6n, 6, { ...price, usd: 1.5 })).toBe(3);
  });

  it('gasTransferCostUsd prices a 21k-gas transfer at a gwei rate', () => {
    // 21000 gas × 2 gwei = 0.000042 ETH → $0.105 at $2500.
    expect(gasTransferCostUsd(21_000, 2, price)).toBeCloseTo(0.105, 12);
  });
});
