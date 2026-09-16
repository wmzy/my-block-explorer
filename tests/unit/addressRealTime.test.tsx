// Observable behavior of the address realtime (direct-RPC) service layer:
// hook result shape, invalid-args gating, per-key loading reset on arg
// change, stale-resolve isolation between keys, and the 24h contract-code
// cache. This replaces the old useAddressData hook tests: the hand-rolled
// cancellation/reset machinery the old hook needed is native to the
// args-keyed query caches, so only consumer-visible behavior is pinned.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { clearAllCaches } from '@/util/useQuery';
import {
  fetchContractCode,
  fetchRealTimeAddressData,
  useContractCode,
  useRealTimeAddressData,
  type RealTimeAddressData,
} from '@/services/addressRealTime';
import { getContractCode, getRealTimeAddressData } from '@/utils/realTimeData';

// The service layer's only RPC dependency is utils/realTimeData; mocking it
// keeps these tests on the query layer's observable behavior.
vi.mock('@/utils/realTimeData');

const mockedRealTime = vi.mocked(getRealTimeAddressData);
const mockedGetCode = vi.mocked(getContractCode);

const testChainId = 1;
const testAddress = '0x1234567890123456789012345678901234567890';
const otherAddress = '0x9876543210987654321098765432109876543210';

const realTimeData = (balance: string): RealTimeAddressData => ({
  balance,
  balanceWei: `${balance}000000000000000000`,
  transactionCount: 42,
  latestBlock: 18_000_000,
  // The service stamps the real clock at success time; assertions compare
  // RPC fields and only require a numeric stamp (see honesty test below).
  lastUpdatedAt: Date.now(),
});

/** Full-value matcher that ignores the exact clock of the stamped timestamp. */
const settledLike = (balance: string) => ({
  ...realTimeData(balance),
  lastUpdatedAt: expect.any(Number) as number,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('addressRealTime fetch functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalid args resolve undefined without touching the RPC', async () => {
    expect(await fetchRealTimeAddressData(0, testAddress)).toBeUndefined();
    expect(await fetchRealTimeAddressData(testChainId, '')).toBeUndefined();
    expect(await fetchContractCode(0, testAddress)).toBeUndefined();
    expect(await fetchContractCode(testChainId, '')).toBeUndefined();
    expect(mockedRealTime).not.toHaveBeenCalled();
    expect(mockedGetCode).not.toHaveBeenCalled();
  });
});

describe('useRealTimeAddressData', () => {
  beforeEach(() => {
    clearAllCaches();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearAllCaches();
  });

  it('starts in the initial-load state and settles the RPC data', async () => {
    mockedRealTime.mockResolvedValue(realTimeData('1.0'));
    const { result } = renderHook(() =>
      useRealTimeAddressData(testChainId, testAddress),
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeUndefined();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(settledLike('1.0'));
    expect(result.current.error).toBeUndefined();
    expect(mockedRealTime).toHaveBeenCalledWith(testChainId, testAddress);
  });

  it('failure: error lands, data stays undefined', async () => {
    mockedRealTime.mockRejectedValue(new Error('Real-time data fetch failed'));
    const { result } = renderHook(() =>
      useRealTimeAddressData(testChainId, testAddress),
    );

    await waitFor(() =>
      expect(result.current.error?.message).toBe('Real-time data fetch failed'),
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it('stamps lastUpdatedAt at success time — never on failure', async () => {
    // Success path: the stamp is the clock at fetch completion.
    mockedRealTime.mockResolvedValue(realTimeData('1.0'));
    const before = Date.now();
    const success = renderHook(() => useRealTimeAddressData(testChainId, testAddress));
    await waitFor(() => expect(success.result.current.loading).toBe(false));
    const after = Date.now();
    const stamped = success.result.current.data?.lastUpdatedAt;
    expect(typeof stamped).toBe('number');
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
    success.unmount();

    // Failure path: no entry, hence no timestamp to mislead the UI with.
    mockedRealTime.mockRejectedValue(new Error('Real-time data fetch failed'));
    const failure = renderHook(() =>
      useRealTimeAddressData(testChainId, otherAddress),
    );
    await waitFor(() => expect(failure.result.current.loading).toBe(false));
    expect(failure.result.current.data).toBeUndefined();
  });

  it('switching address honestly re-enters loading until the new key settles', async () => {
    const forFirst = deferred<RealTimeAddressData>();
    const forSecond = deferred<RealTimeAddressData>();
    mockedRealTime
      .mockImplementationOnce(() => forFirst.promise)
      .mockImplementationOnce(() => forSecond.promise);

    const { result, rerender } = renderHook(
      ({ addr }: { addr: string }) => useRealTimeAddressData(testChainId, addr),
      { initialProps: { addr: testAddress } },
    );
    await act(async () => {
      forFirst.resolve(realTimeData('1.0'));
    });
    await waitFor(() => {
      expect(result.current.data).toEqual(settledLike('1.0'));
      expect(result.current.loading).toBe(false);
    });

    // New key in flight: the initial-load state is back until it settles.
    await act(async () => {
      rerender({ addr: otherAddress });
    });
    expect(result.current.loading).toBe(true);
    expect(mockedRealTime).toHaveBeenLastCalledWith(testChainId, otherAddress);

    await act(async () => {
      forSecond.resolve(realTimeData('2.0'));
    });
    await waitFor(() => {
      expect(result.current.data).toEqual(settledLike('2.0'));
      expect(result.current.loading).toBe(false);
    });
  });

  it('a late resolve for the previous address cannot clobber the newer entry', async () => {
    const resolvers: Array<(value: RealTimeAddressData) => void> = [];
    mockedRealTime.mockImplementation(
      () =>
        new Promise<RealTimeAddressData>(resolve => {
          resolvers.push(resolve);
        }),
    );

    const { result, rerender } = renderHook(
      ({ addr }: { addr: string }) => useRealTimeAddressData(testChainId, addr),
      { initialProps: { addr: testAddress } },
    );
    rerender({ addr: otherAddress });
    await act(async () => {});
    expect(resolvers).toHaveLength(2);

    // The newer entry settles first.
    await act(async () => {
      resolvers[1](realTimeData('2.0'));
    });
    await waitFor(() => expect(result.current.data).toEqual(settledLike('2.0')));

    // The stale entry resolves afterwards — the newer data stays put.
    await act(async () => {
      resolvers[0](realTimeData('1.0'));
    });
    expect(result.current.data).toEqual(settledLike('2.0'));
  });
});

describe('useContractCode', () => {
  beforeEach(() => {
    clearAllCaches();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearAllCaches();
  });

  it('settles the raw code from the RPC', async () => {
    mockedGetCode.mockResolvedValue('0xdeadbeef');
    const { result } = renderHook(() => useContractCode(testChainId, testAddress));

    await waitFor(() => expect(result.current.data).toBe('0xdeadbeef'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(mockedGetCode).toHaveBeenCalledWith(testChainId, testAddress);
  });

  it('code is immutable once deployed: a remount serves the 24h cache with no second RPC', async () => {
    mockedGetCode.mockResolvedValue('0xdeadbeef');
    const first = renderHook(() => useContractCode(testChainId, testAddress));
    await waitFor(() => expect(first.result.current.data).toBe('0xdeadbeef'));
    first.unmount();

    const second = renderHook(() => useContractCode(testChainId, testAddress));
    await act(async () => {});

    expect(second.result.current.data).toBe('0xdeadbeef');
    expect(second.result.current.loading).toBe(false);
    expect(mockedGetCode).toHaveBeenCalledTimes(1);
  });
});
