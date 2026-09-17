// Pending-only polling of the transaction detail query (P1-7): while the
// transaction has no receipt yet (status -1) the hook re-fetches the
// transaction AND its receipt (one getTransactionByHash call carries both)
// on the poll interval; once a receipt lands the cadence stops, and ticks
// are skipped while the tab is hidden (react-toolroom usePolling default).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { clearAllCaches } from '@/util/useQuery';
import { useTransactionByHash } from '@/services/chainRpc';

const mockGetTransactionByHash = vi.fn<(...args: unknown[]) => Promise<unknown>>();

// The RPC walk in utils/blockRpcData is the only network edge here; keeping
// the rest of the module real exercises the real fetch guard + query layer.
// The indirection keeps the mock reference lazy (the factory runs during
// module resolution, before test-body constants initialize).
vi.mock('@/utils/blockRpcData', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/blockRpcData')>();
  return {
    ...actual,
    getTransactionByHash: (...args: unknown[]) => mockGetTransactionByHash(...args),
  };
});

const TX_HASH = '0xabc0000000000000000000000000000000000000000000000000000000000def';

const pendingTx = { hash: TX_HASH, status: -1 };
const confirmedTx = { hash: TX_HASH, status: 1, gasUsed: '21000' };

describe('useTransactionByHash pending polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearAllCaches();
    mockGetTransactionByHash.mockReset().mockResolvedValue(pendingTx);
  });

  afterEach(() => {
    clearAllCaches();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls while pending and stops once the receipt lands', async () => {
    const { result } = renderHook(() => useTransactionByHash(1, TX_HASH));

    // Initial useRun fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(1);
    expect(result.current.data).toMatchObject({ status: -1 });

    // Two pending ticks re-fetch transaction + receipt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(3);

    // The next tick observes the mined receipt.
    mockGetTransactionByHash.mockResolvedValue(confirmedTx);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(result.current.data).toMatchObject({ status: 1, gasUsed: '21000' });

    // Confirmed: the cadence stopped — a long idle window fetches nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(4);
  });

  it('never polls a transaction that already has a receipt', async () => {
    mockGetTransactionByHash.mockResolvedValue(confirmedTx);
    renderHook(() => useTransactionByHash(1, TX_HASH));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(1);
  });

  it('skips ticks while the tab is hidden and resumes when visible', async () => {
    renderHook(() => useTransactionByHash(1, TX_HASH));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(1);

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(1);

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(mockGetTransactionByHash).toHaveBeenCalledTimes(2);
  });
});
