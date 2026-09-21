// Frontend signature service: one batched GET per uncached set, the
// module-level per-selector memo (found/notFound persist, unavailable
// retries), and shape filtering so a malformed selector can never 400 the
// batch. The HTTP layer is mocked — no network.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  get: mocks.get,
  api: {},
  withSignal: (o: unknown) => o,
}));

import {
  fetchSignatures,
  resetSignatureOutcomeCacheForTests,
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
