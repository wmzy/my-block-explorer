// The strict side of the signature service (the /signatures tool page's
// data path): fetchSignaturesStrict surfaces transport failures as
// rejections so the page can attribute backend-offline precisely, while
// the never-rejecting fetchSignatures twin keeps the enhancement-layer
// contract (every miss resolves { unavailable: true }, memoized facts
// stay visible). useSignatureLookup maps the query result onto the page's
// state machine. The HTTP layer is mocked — no network.
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
  fetchSignatures,
  fetchSignaturesStrict,
  resetSignatureOutcomeCacheForTests,
  signaturesCache,
  useSignatureLookup,
} from '@/services/signatures';

const FN_SELECTOR = '0xa9059cbb';
const FN_SELECTOR_2 = '0x23b872dd';
const EVENT_TOPIC0 = `0x${'cd'.repeat(32)}`;

const foundOutcome = {
  kind: 'function',
  signatures: ['transfer(address,uint256)'],
  source: 'openchain',
} as const;

const eventFoundOutcome = {
  kind: 'event',
  signatures: ['Transfer(address,address,uint256)'],
  source: 'openchain',
} as const;

const respond = (results: Record<string, unknown>) => mocks.get.mockResolvedValue({ results });

beforeEach(() => {
  vi.clearAllMocks();
  resetSignatureOutcomeCacheForTests();
  signaturesCache.clear();
});

describe('fetchSignaturesStrict - error surfacing', () => {
  it('rejects on transport failure instead of swallowing the error', async () => {
    mocks.get.mockRejectedValue(new Error('backend offline'));

    await expect(fetchSignaturesStrict(FN_SELECTOR)).rejects.toThrow('backend offline');
  });

  it('resolves { unavailable } when the backend answers but openchain did not', async () => {
    respond({ [FN_SELECTOR]: { unavailable: true } });

    const outcomes = await fetchSignaturesStrict(FN_SELECTOR);

    expect(outcomes[FN_SELECTOR]).toEqual({ unavailable: true });
  });

  it('does not memoize unavailable outcomes — a later call re-asks', async () => {
    respond({ [FN_SELECTOR]: { unavailable: true } });
    await fetchSignaturesStrict(FN_SELECTOR);

    respond({ [FN_SELECTOR]: foundOutcome });
    const outcomes = await fetchSignaturesStrict(FN_SELECTOR);

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(outcomes[FN_SELECTOR]).toEqual(foundOutcome);
  });

  it('memoizes found outcomes exactly like the enhancement layer', async () => {
    respond({ [FN_SELECTOR]: foundOutcome });
    await fetchSignaturesStrict(FN_SELECTOR);

    await fetchSignaturesStrict(FN_SELECTOR);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});

describe('fetchSignatures - never-reject parity with the strict core', () => {
  it('resolves misses as unavailable where the strict core rejects, keeping memo hits visible', async () => {
    // Prime the memo with a settled fact for one selector.
    respond({ [FN_SELECTOR]: foundOutcome });
    await fetchSignaturesStrict(FN_SELECTOR);

    mocks.get.mockRejectedValue(new Error('backend offline'));
    const outcomes = await fetchSignatures([FN_SELECTOR, FN_SELECTOR_2].join(','));

    // The memoized fact survives the outage; only the miss degrades.
    expect(outcomes[FN_SELECTOR]).toEqual(foundOutcome);
    expect(outcomes[FN_SELECTOR_2]).toEqual({ unavailable: true });
  });
});

describe('useSignatureLookup - page state machine', () => {
  it('resolves idle without any request when no valid selector is given', () => {
    const { result } = renderHook(() => useSignatureLookup(undefined));

    expect(result.current.status).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('reports loading while the lookup is in flight', async () => {
    // The deferred pre-exists the render (useQuery.test.ts pattern): the
    // runner starts the fetch a tick after mount, so the resolve handle
    // must be bound before renderHook — releasing an already-resolved
    // promise also settles a fetch that starts late.
    let resolveGet!: (value: { results: Record<string, unknown> }) => void;
    const pending = new Promise<{ results: Record<string, unknown> }>(resolve => {
      resolveGet = resolve;
    });
    mocks.get.mockReturnValue(pending);

    const { result } = renderHook(() => useSignatureLookup(FN_SELECTOR));
    expect(result.current.status).toBe('loading');

    await act(async () => {
      resolveGet({ results: { [FN_SELECTOR]: foundOutcome } });
    });
    expect(result.current.status).toBe('found');
  });

  it('carries the settled outcome once the registry answers', async () => {
    respond({ [EVENT_TOPIC0]: eventFoundOutcome });

    const { result } = renderHook(() => useSignatureLookup(EVENT_TOPIC0));

    await waitFor(() => expect(result.current.status).toBe('found'));
    if (result.current.status !== 'found') throw new Error('unreachable');
    expect(result.current.outcome).toEqual(eventFoundOutcome);
  });

  it('maps an honest registry miss to its own miss state', async () => {
    respond({ [FN_SELECTOR]: { kind: 'function', signatures: [], notFound: true } });

    const { result } = renderHook(() => useSignatureLookup(FN_SELECTOR));

    await waitFor(() => expect(result.current.status).toBe('miss'));
  });

  it('surfaces upstream unavailability as its own retryable state', async () => {
    respond({ [FN_SELECTOR]: { unavailable: true } });

    const { result } = renderHook(() => useSignatureLookup(FN_SELECTOR));

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
  });

  it('surfaces transport failures as the error state', async () => {
    mocks.get.mockRejectedValue(new Error('backend offline'));

    const { result } = renderHook(() => useSignatureLookup(FN_SELECTOR));

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect((result.current.error as Error).message).toBe('backend offline');
  });

  it('never serves the previous selector settle after an argument switch', async () => {
    // Selector A settles found; selector B's fetch stays pending. The
    // store keeps A's settle across the switch, but B must render loading
    // — never A's outcome (per-key presence is the settle guard).
    respond({ [FN_SELECTOR]: foundOutcome });
    const { result, rerender } = renderHook(
      ({ selector }: { selector: string | undefined }) => useSignatureLookup(selector),
      { initialProps: { selector: FN_SELECTOR } },
    );
    await waitFor(() => expect(result.current.status).toBe('found'));

    // Deferred pre-exists the rerender (see the loading test above).
    let resolveGet!: (value: { results: Record<string, unknown> }) => void;
    const pending = new Promise<{ results: Record<string, unknown> }>(resolve => {
      resolveGet = resolve;
    });
    mocks.get.mockReturnValue(pending);
    rerender({ selector: FN_SELECTOR_2 });

    expect(result.current.status).toBe('loading');
    await act(async () => {
      resolveGet({ results: { [FN_SELECTOR_2]: foundOutcome } });
    });
    expect(result.current.status).toBe('found');
  });
});
