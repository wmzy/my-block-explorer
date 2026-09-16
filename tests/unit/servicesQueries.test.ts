// Observable behavior of the frontend data-services layer: fetch guards,
// hook result shape, immutable-cache serving across mounts, and the
// loader↔hook shared cache.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import * as http from '@/util/http';
import { ApiError } from '@/util/apiError';
import { clearAllCaches } from '@/util/useQuery';
import {
  fetchAddressInfo,
  fetchAddressTransactions,
  useAddressInfo,
} from '@/services/addresses';
import { fetchStorageLayout, useContractSource } from '@/services/contracts';
import { fetchSearch, fetchChainSearch } from '@/services/search';
import {
  contractSourceLoader,
  useContractSourceData,
} from '@/services/dataloaders';

// The service layer's only network dependency is util/http; mocking it keeps
// these tests on the query layer's observable behavior.
vi.mock('@/util/http', () => {
  const get = vi.fn().mockResolvedValue(undefined);
  const post = vi.fn().mockResolvedValue(undefined);
  const put = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(undefined);
  const withSignal = <T extends object>(o: T, signal?: AbortSignal): T => ({
    ...o,
    signal,
  });
  const api = {};
  return { api, get, post, put, del, withSignal };
});

const mockedGet = vi.mocked(http.get);

describe('service fetch functions', () => {
  beforeEach(() => {
    mockedGet.mockReset().mockResolvedValue(undefined);
  });

  it('fetchAddressTransactions converts offset to the page param', async () => {
    mockedGet.mockResolvedValue({ transactions: [], total: 0 });
    await fetchAddressTransactions(1, '0xabc', 25, 50);
    // The endpoint reads `page` only — an `offset` param here would
    // silently pin every call to page 1.
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/chains/1/addresses/0xabc/transactions',
      { limit: 25, page: 3 },
      expect.anything(),
    );
  });

  it('invalid-args guards resolve undefined without a request', async () => {
    expect(await fetchAddressInfo(1, '')).toBeUndefined();
    expect(await fetchChainSearch(0, 'q')).toBeUndefined();
    expect(await fetchSearch('')).toBeUndefined();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('fetchStorageLayout unwraps the {found, layout} envelope', async () => {
    const layout = { storage: [], types: {} };
    mockedGet.mockResolvedValue({ found: true, layout });

    await expect(fetchStorageLayout(1, '0xabc')).resolves.toEqual(layout);
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/chains/1/contracts/0xabc/storage-layout',
      undefined,
      expect.anything(),
    );
  });

  it('fetch fns surface the http layer errors untouched', async () => {
    mockedGet.mockRejectedValue(new ApiError('boom', 500));
    await expect(fetchStorageLayout(1, '0xabc')).rejects.toMatchObject({
      message: 'boom',
      status: 500,
    });
  });
});

describe('scenario hooks (result shape + caching)', () => {
  beforeEach(() => {
    clearAllCaches();
    mockedGet.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearAllCaches();
  });

  it('useAddressInfo: {data, loading, error} settles loading→data', async () => {
    mockedGet.mockResolvedValue({ balance: '1' });
    const { result } = renderHook(() => useAddressInfo(1, '0xabc'));

    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeUndefined();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ balance: '1' });
    expect(result.current.error).toBeUndefined();
  });

  it('useAddressInfo failure: error lands, data stays undefined', async () => {
    mockedGet.mockRejectedValue(new ApiError('down', 503));
    const { result } = renderHook(() => useAddressInfo(1, '0xabc'));

    await waitFor(() => expect(result.current.error).toMatchObject({ message: 'down' }));
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it('immutable endpoint: cached data serves a remount with no second request', async () => {
    mockedGet.mockResolvedValue({ contractSource: { name: 'ERC20' } });
    const first = renderHook(() => useContractSource(1, '0xabc'));
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    first.unmount();

    const second = renderHook(() => useContractSource(1, '0xabc'));
    await act(async () => {});
    // The 24h cache served the remount: settled data, no second request.
    expect(second.result.current.data).toEqual({ contractSource: { name: 'ERC20' } });
    expect(second.result.current.loading).toBe(false);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('keyed args: switching address refetches and isolates data', async () => {
    mockedGet.mockImplementation(async (url: string) =>
      url.includes('0xaaa') ? { balance: '1' } : { balance: '2' },
    );
    const { result, rerender } = renderHook(
      ({ addr }: { addr: string }) => useAddressInfo(1, addr),
      { initialProps: { addr: '0xaaa' } },
    );
    await waitFor(() => expect(result.current.data).toEqual({ balance: '1' }));

    rerender({ addr: '0xbbb' });
    await waitFor(() => expect(result.current.data).toEqual({ balance: '2' }));
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});

describe('route data loaders (immutable triplets)', () => {
  beforeEach(() => {
    clearAllCaches();
    mockedGet.mockReset().mockResolvedValue(undefined);
  });

  it('exports the loader triplet', () => {
    expect(typeof contractSourceLoader).toBe('function');
    expect(typeof useContractSourceData).toBe('function');
  });

  it('loader normalizes string route params into the fetch key', async () => {
    mockedGet.mockResolvedValue({ contractSource: { name: 'Token' } });
    const data = await contractSourceLoader({
      params: { chainId: '1', address: '0xabc' },
      signal: undefined,
    });

    expect(data).toEqual({ contractSource: { name: 'Token' } });
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/chains/1/contracts/0xabc/source',
      undefined,
      expect.anything(),
    );
  });

  it('loader shares the entity cache with the scenario hook', async () => {
    mockedGet.mockResolvedValue({ contractSource: { name: 'Token' } });
    await contractSourceLoader({ params: { chainId: '1', address: '0xabc' } });

    const { result } = renderHook(() => useContractSource(1, '0xabc'));
    await act(async () => {});

    // Cache hit from the loader's entry: no second request, data served.
    expect(result.current.data).toEqual({ contractSource: { name: 'Token' } });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('malformed chainId params hit the fetch guard, not the network', async () => {
    const data = await contractSourceLoader({
      params: { chainId: 'NaN', address: '0xabc' },
    });
    expect(data).toBeUndefined();
    expect(mockedGet).not.toHaveBeenCalled();
  });
});
