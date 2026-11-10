// useConditionalPolling + POLL_DISABLED_INTERVAL (services/polledQuery):
// the conditional-poll idiom chainRpc's useTransactionByHash and
// addressScan's useScanJob previously re-declared — active ticks fire on
// the interval, an inactive hook swaps to the never-firing disabled
// interval (swapping the interval re-arms the timer, so the cadence
// resumes the moment the condition flips back on). Exercised against a
// plain injectable so only react-toolroom's own timer semantics are
// under test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInjectable, useRun } from 'react-toolroom/async';

import { POLL_DISABLED_INTERVAL, useConditionalPolling } from '@/services/polledQuery';

const fetcher = vi.fn(async () => 'ok');

function useHarness(active: boolean) {
  const injectable = useInjectable(fetcher);
  useRun(injectable, []);
  useConditionalPolling(injectable, active, 1_000, []);
}

describe('POLL_DISABLED_INTERVAL', () => {
  it('is the largest delay environments accept without clamping to 1 ms', () => {
    // Just under the signed 32-bit ceiling (2_147_483_647) that browsers
    // clamp over — ~24.8 days: the timer exists but never fires.
    expect(POLL_DISABLED_INTERVAL).toBe(2_147_483_000);
  });
});

describe('useConditionalPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ticks on the interval while active and stops when the condition turns off', async () => {
    const { result, rerender, unmount } = renderHook(({ active }) => useHarness(active), {
      initialProps: { active: true },
    });
    expect(result.current).toBeUndefined();

    // Initial useRun fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Two active ticks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);

    // Inactive: the disabled interval never fires within any realistic
    // horizon (60s here — far below its ~24.8 days).
    rerender({ active: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);

    unmount();
  });

  it('re-arms the cadence the moment the condition flips back on', async () => {
    const { rerender, unmount } = renderHook(({ active }) => useHarness(active), {
      initialProps: { active: false },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Flip on: the NEXT interval boundary ticks (not the disabled one).
    rerender({ active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    unmount();
  });
});
