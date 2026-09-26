// Dev-chain reset detection contract (PM-review P0): the pure verdict
// (no baseline / progression / sub-threshold reorg ignored / threshold
// regression detected), the localStorage high-water mark (only ever
// advances; frozen while a reset is suspected), head-keyed dismissal
// (a NEW regression re-arms the banner), the clear client's honest-count
// parsing, and the observing hook's state machine end-to-end against
// jsdom localStorage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { setApiBase } from '@/util/apiBase';
import { ApiError } from '@/util/apiError';
import {
  CHAIN_RESET_THRESHOLD_BLOCKS,
  clearChainCachedData,
  detectChainReset,
  dismissalStorageKey,
  dismissChainReset,
  isResetDismissed,
  lastHeadStorageKey,
  acknowledgeChainReset,
  readStoredHead,
  storeHead,
  useChainResetDetection,
} from '@/services/chainReset';

const CHAIN = 31337;

// fetch stand-in response (tests/unit/http.test.ts shape: only the
// members fetch-fun's JSON reader actually consumes).
function mockResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    url: '/api/test',
    type: 'basic' as const,
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('detectChainReset — pure verdict', () => {
  it('reads no reset without a stored baseline (first visit, unreadable storage)', () => {
    expect(detectChainReset(null, 5_000_000)).toBe(false);
  });

  it('reads no reset while no head is observed (feeds still loading)', () => {
    expect(detectChainReset({ blockNumber: 100, updatedAt: 1 }, null)).toBe(false);
    expect(detectChainReset(null, null)).toBe(false);
  });

  it('reads progression (head at or above the baseline) as no reset', () => {
    const stored = { blockNumber: 100, updatedAt: 1 };
    expect(detectChainReset(stored, 100)).toBe(false);
    expect(detectChainReset(stored, 101)).toBe(false);
    expect(detectChainReset(stored, 5_000_000)).toBe(false);
  });

  it(`ignores reorgs shallower than ${CHAIN_RESET_THRESHOLD_BLOCKS} blocks`, () => {
    const stored = { blockNumber: 100, updatedAt: 1 };
    expect(detectChainReset(stored, 99)).toBe(false);
    expect(detectChainReset(stored, 100 - (CHAIN_RESET_THRESHOLD_BLOCKS - 1))).toBe(false);
  });

  it('detects a head at or beyond the threshold below the baseline', () => {
    const stored = { blockNumber: 100, updatedAt: 1 };
    expect(detectChainReset(stored, 100 - CHAIN_RESET_THRESHOLD_BLOCKS)).toBe(true);
    expect(detectChainReset(stored, 3)).toBe(true);
    expect(detectChainReset(stored, 0)).toBe(true);
  });
});

describe('stored high-water head', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a stored head', () => {
    storeHead(CHAIN, 1_234);
    expect(readStoredHead(CHAIN)).toEqual({
      blockNumber: 1_234,
      updatedAt: expect.any(Number),
    });
  });

  it('keys the baseline per chain', () => {
    storeHead(1, 900);
    storeHead(CHAIN, 100);
    expect(readStoredHead(1)?.blockNumber).toBe(900);
    expect(readStoredHead(CHAIN)?.blockNumber).toBe(100);
    expect(readStoredHead(999)).toBeNull();
  });

  it('degrades malformed or wrong-shaped payloads to no baseline instead of guessing', () => {
    const bad: Array<string> = [
      'not json',
      'null',
      '"100"',
      JSON.stringify({ blockNumber: '100', updatedAt: 1 }),
      JSON.stringify({ blockNumber: -5, updatedAt: 1 }),
      JSON.stringify({ blockNumber: 100 }),
      JSON.stringify({ blockNumber: Number.NaN, updatedAt: 1 }),
    ];
    for (const raw of bad) {
      localStorage.setItem(lastHeadStorageKey(CHAIN), raw);
      expect(readStoredHead(CHAIN)).toBeNull();
    }
  });
});

describe('dismissal is keyed by the stored (regressed-from) head', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records and reads a dismissal for that exact head', () => {
    expect(isResetDismissed(CHAIN, 1_000)).toBe(false);
    dismissChainReset(CHAIN, 1_000);
    expect(isResetDismissed(CHAIN, 1_000)).toBe(true);
    expect(localStorage.getItem(dismissalStorageKey(CHAIN, 1_000))).toBe('1');
  });

  it('re-arms for a different regression (a new high-water head keys differently)', () => {
    dismissChainReset(CHAIN, 1_000);
    expect(isResetDismissed(CHAIN, 2_000)).toBe(false);
  });

  it('scopes dismissals per chain', () => {
    dismissChainReset(CHAIN, 1_000);
    expect(isResetDismissed(1, 1_000)).toBe(false);
  });
});

describe('clearChainCachedData client', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    localStorage.clear();
    setApiBase('http://unit.test:1');
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setApiBase('http://localhost:8201');
  });

  it('DELETEs the chain-scoped endpoint and returns the honest counts', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ cleared: { contractSources: 3, storageLayouts: 1 } }),
    );

    const counts = await clearChainCachedData(CHAIN);

    expect(counts).toEqual({ contractSources: 3, storageLayouts: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://unit.test:1/api/chains/${CHAIN}/cached-data`,
      expect.objectContaining({ method: 'delete' }),
    );
  });

  it('rejects with ApiError on a 403 (admin token missing/wrong)', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ message: 'Forbidden', description: 'Invalid admin token.' }, false, 403),
    );

    const error = await clearChainCachedData(CHAIN).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
  });

  it('never fabricates counts from a shapeless 200 body', async () => {
    const bad: Array<unknown> = [
      {},
      { cleared: null },
      { cleared: {} },
      { cleared: { contractSources: '3', storageLayouts: 1 } },
      { cleared: { contractSources: 3 } },
    ];
    for (const body of bad) {
      fetchMock.mockResolvedValue(mockResponse(body));
      await expect(clearChainCachedData(CHAIN)).rejects.toThrow(
        /without (honest|a cleared)/i,
      );
    }
  });
});

describe('useChainResetDetection — observing hook', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('baselines the first observed head and stays quiet', async () => {
    const { result } = renderHook(() => useChainResetDetection(CHAIN, 1_200n));
    await act(async () => {});

    expect(result.current.suspected).toBe(false);
    expect(result.current.storedHead?.blockNumber).toBe(1_200);
    expect(readStoredHead(CHAIN)?.blockNumber).toBe(1_200);
  });

  it('observes nothing while the head is unknown (feeds loading)', async () => {
    const { result } = renderHook(() => useChainResetDetection(CHAIN, null));
    await act(async () => {});

    expect(result.current.suspected).toBe(false);
    expect(result.current.storedHead).toBeNull();
    expect(readStoredHead(CHAIN)).toBeNull();
  });

  it('advances the baseline on progression and freezes it during suspicion', async () => {
    const { result, rerender } = renderHook(
      ({ head }: { head: bigint | null }) => useChainResetDetection(CHAIN, head),
      { initialProps: { head: 1_200n } },
    );
    await act(async () => {});

    act(() => rerender({ head: 1_250n }));
    expect(result.current.suspected).toBe(false);
    expect(readStoredHead(CHAIN)?.blockNumber).toBe(1_250);

    // Reset: head rewinds far below the mark.
    act(() => rerender({ head: 4n }));
    expect(result.current.suspected).toBe(true);
    expect(result.current.storedHead?.blockNumber).toBe(1_250);
    // The mark stays frozen at the pre-reset high (stable dismissal key).
    expect(readStoredHead(CHAIN)?.blockNumber).toBe(1_250);
  });

  it('ignores a sub-threshold reorg without downgrading the mark', async () => {
    const { result, rerender } = renderHook(
      ({ head }: { head: bigint | null }) => useChainResetDetection(CHAIN, head),
      { initialProps: { head: 500n } },
    );
    await act(async () => {});

    act(() => rerender({ head: 500n - BigInt(CHAIN_RESET_THRESHOLD_BLOCKS - 1) }));
    expect(result.current.suspected).toBe(false);
    // Cumulative honesty: the high-water mark survives the shallow dip,
    // so a following regression deeper than the threshold still detects
    // against the real pre-reorg head.
    expect(readStoredHead(CHAIN)?.blockNumber).toBe(500);
  });

  it('stops suspecting after the reset is acknowledged (re-baselined)', async () => {
    const { result, rerender } = renderHook(
      ({ head }: { head: bigint | null }) => useChainResetDetection(CHAIN, head),
      { initialProps: { head: 1_000n } },
    );
    await act(async () => {});
    act(() => rerender({ head: 2n }));
    expect(result.current.suspected).toBe(true);

    // The banner's success path: acknowledge re-baselines to the current
    // (post-reset) head, so the next observation is plain progression.
    acknowledgeChainReset(CHAIN, 2);
    act(() => rerender({ head: 3n }));
    expect(result.current.suspected).toBe(false);
    expect(readStoredHead(CHAIN)?.blockNumber).toBe(3);
  });

  it('keeps baselines per chain across a chain switch', async () => {
    const { result, rerender } = renderHook(
      ({ chainId, head }: { chainId: number; head: bigint | null }) =>
        useChainResetDetection(chainId, head),
      { initialProps: { chainId: CHAIN, head: 1_000n } },
    );
    await act(async () => {});

    // Chain 1 has no baseline: a tiny head there is not a regression.
    act(() => rerender({ chainId: 1, head: 4n }));
    expect(result.current.suspected).toBe(false);
    expect(readStoredHead(CHAIN)?.blockNumber).toBe(1_000);
    expect(readStoredHead(1)?.blockNumber).toBe(4);

    // Back on the reset chain: the suspicion is still armed.
    act(() => rerender({ chainId: CHAIN, head: 4n }));
    expect(result.current.suspected).toBe(true);
    expect(result.current.storedHead?.blockNumber).toBe(1_000);
  });
});
