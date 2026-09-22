// Frontend signature service: one batched GET per uncached set, the
// module-level per-selector memo (found/notFound persist, unavailable
// retries), and shape filtering so a malformed selector can never 400 the
// batch. The HTTP layer is mocked — no network.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  get: mocks.get,
  api: {},
  withSignal: (o: unknown) => o,
}));

import {
  MAX_SELECTORS_PER_REQUEST,
  chunkSelectors,
  fetchSignatures,
  resetSignatureOutcomeCacheForTests,
  useSignaturesBatched,
} from '@/services/signatures';

const FN_SELECTOR = '0xa9059cbb';
const FN_SELECTOR_2 = '0x23b872dd';
const EVENT_TOPIC0 = `0x${'cd'.repeat(32)}`;

const foundOutcome = {
  kind: 'function',
  signatures: ['transfer(address,uint256)'],
  source: 'openchain',
} as const;

const notFoundOutcome = { kind: 'event', signatures: [], notFound: true } as const;

const response = (results: Record<string, unknown>) =>
  mocks.get.mockResolvedValue({ results });

beforeEach(() => {
  vi.clearAllMocks();
  resetSignatureOutcomeCacheForTests();
});

describe('fetchSignatures - batching', () => {
  it('sends one GET with function and event params for a mixed set', async () => {
    response({});

    await fetchSignatures([FN_SELECTOR, EVENT_TOPIC0, FN_SELECTOR_2].join(','));

    expect(mocks.get).toHaveBeenCalledTimes(1);
    const [url, params] = mocks.get.mock.calls[0];
    expect(url).toBe('/api/signatures');
    expect(params).toEqual({
      function: `${FN_SELECTOR},${FN_SELECTOR_2}`,
      event: EVENT_TOPIC0,
    });
  });

  it('skips the request entirely when every selector is already known', async () => {
    response({ [FN_SELECTOR]: foundOutcome });

    await fetchSignatures(FN_SELECTOR);
    expect(mocks.get).toHaveBeenCalledTimes(1);

    // Second, overlapping set reuses the memoized fact — no new request.
    await fetchSignatures([FN_SELECTOR, FN_SELECTOR_2].join(','));
    expect(mocks.get).toHaveBeenCalledTimes(2); // only selector_2 was new
    const [, params] = mocks.get.mock.calls[1];
    expect(params).toEqual({ function: FN_SELECTOR_2 });
  });

  it('filters malformed selectors out of the request', async () => {
    response({});

    const outcomes = await fetchSignatures([FN_SELECTOR, 'nothex', '0x123'].join(','));

    expect(mocks.get).toHaveBeenCalledTimes(1);
    const [, params] = mocks.get.mock.calls[0];
    expect(params).toEqual({ function: FN_SELECTOR });
    // The malformed entries get no fabricated outcome — simply absent.
    expect(outcomes.nothex).toBeUndefined();
    expect(outcomes['0x123']).toBeUndefined();
  });

  it('returns an empty record without any request for an empty digest', async () => {
    const outcomes = await fetchSignatures('');

    expect(outcomes).toEqual({});
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('fetchSignatures - outcome honesty', () => {
  it('memoizes found and notFound outcomes as per-selector facts', async () => {
    response({ [FN_SELECTOR]: foundOutcome, [EVENT_TOPIC0]: notFoundOutcome });

    const outcomes = await fetchSignatures([FN_SELECTOR, EVENT_TOPIC0].join(','));

    expect(outcomes[FN_SELECTOR]).toEqual(foundOutcome);
    expect(outcomes[EVENT_TOPIC0]).toEqual(notFoundOutcome);

    // A later set containing both resolves from the memo with no request.
    await fetchSignatures([EVENT_TOPIC0, FN_SELECTOR].join(','));
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('resolves unavailable for a selector missing from the response body', async () => {
    response({ [FN_SELECTOR]: foundOutcome });

    const outcomes = await fetchSignatures([FN_SELECTOR, FN_SELECTOR_2].join(','));

    expect(outcomes[FN_SELECTOR_2]).toEqual({ unavailable: true });
  });

  it('does not memoize unavailable outcomes, so a later call retries', async () => {
    mocks.get.mockResolvedValue({ results: { [FN_SELECTOR]: { unavailable: true } } });

    await fetchSignatures(FN_SELECTOR);
    const outcomes = await fetchSignatures(FN_SELECTOR);

    expect(outcomes[FN_SELECTOR]).toEqual({ unavailable: true });
    // Not pinned by the memo: the second call went back to the API.
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('resolves every miss unavailable when the backend request rejects', async () => {
    mocks.get.mockRejectedValue(new Error('backend offline'));

    const outcomes = await fetchSignatures([FN_SELECTOR, EVENT_TOPIC0].join(','));

    expect(outcomes[FN_SELECTOR]).toEqual({ unavailable: true });
    expect(outcomes[EVENT_TOPIC0]).toEqual({ unavailable: true });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});

describe('chunkSelectors - request-cap chunking', () => {
  it('returns no chunks for an empty list', () => {
    expect(chunkSelectors([], MAX_SELECTORS_PER_REQUEST)).toEqual([]);
  });

  it('keeps a list under the cap as one chunk, order preserved', () => {
    expect(chunkSelectors(['a', 'b', 'c'], 25)).toEqual([['a', 'b', 'c']]);
  });

  it('splits at the cap: 26 items under a 25 cap become 25 + 1', () => {
    const items = Array.from({ length: 26 }, (_, i) => `s${i}`);
    const chunks = chunkSelectors(items, 25);

    expect(chunks.map(chunk => chunk.length)).toEqual([25, 1]);
    // Order is preserved across the split.
    expect(chunks.flat()).toEqual(items);
  });

  it('clamps a cap below 1 to one item per chunk', () => {
    expect(chunkSelectors(['a', 'b'], 0)).toEqual([['a'], ['b']]);
  });
});

describe('useSignaturesBatched - one GET per ≤25-selector chunk', () => {
  const selectorAt = (i: number): string => `0x${i.toString(16).padStart(8, '0')}`;

  // Responder that resolves every function selector it is asked about.
  const resolveAllAsked = () =>
    mocks.get.mockImplementation(async (_url: string, params?: Record<string, string>) => {
      const results: Record<string, unknown> = {};
      for (const selector of (params?.function ?? '').split(',').filter(Boolean)) {
        results[selector] = {
          kind: 'function',
          signatures: [`sig${selector.slice(2)}(uint256)`],
          source: 'openchain',
        };
      }
      return { results };
    });

  it('a 20-selector page is a single request covering the whole set', async () => {
    resolveAllAsked();
    const selectors = Array.from({ length: 20 }, (_, i) => selectorAt(i + 1));

    const { result } = renderHook(() => useSignaturesBatched(selectors));

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(20));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    const [, params] = mocks.get.mock.calls[0];
    expect(params?.function.split(',')).toHaveLength(20);
  });

  it('a 30-selector set splits into two requests, each within the 25 cap', async () => {
    resolveAllAsked();
    const selectors = Array.from({ length: 30 }, (_, i) => selectorAt(i + 100));

    const { result } = renderHook(() => useSignaturesBatched(selectors));

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(30));
    expect(mocks.get).toHaveBeenCalledTimes(2);
    const sizes = mocks.get.mock.calls.map(
      call => (call[1]?.function ?? '').split(',').filter(Boolean).length,
    );
    expect(sizes.every(size => size > 0 && size <= MAX_SELECTORS_PER_REQUEST)).toBe(true);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(30);
    // The merged map carries every selector's resolved outcome.
    const firstOutcome = result.current[selectors[0]];
    const lastOutcome = result.current[selectors[29]];
    expect('signatures' in firstOutcome ? firstOutcome.signatures[0] : undefined).toBe(
      `sig${selectors[0].slice(2)}(uint256)`,
    );
    expect('signatures' in lastOutcome ? lastOutcome.signatures[0] : undefined).toBe(
      `sig${selectors[29].slice(2)}(uint256)`,
    );
  });

  it('a set beyond the 4-slot ceiling resolves only the first 100 selectors', async () => {
    resolveAllAsked();
    const selectors = Array.from({ length: 120 }, (_, i) => selectorAt(i + 1000));

    const { result } = renderHook(() => useSignaturesBatched(selectors));

    // 4 slots × 25 = 100 resolved; the remaining 20 stay absent (raw
    // fallback in the UI) — the request count is never unbounded.
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(100));
    expect(mocks.get).toHaveBeenCalledTimes(4);
  });

  it('an empty selector set issues no request at all', async () => {
    const { result } = renderHook(() => useSignaturesBatched([]));

    await act(async () => {});
    expect(mocks.get).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });
});
