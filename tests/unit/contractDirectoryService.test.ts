// contractDirectory fetch contract: FLAT positional args (chainId, q,
// offset, signal). The query layer spreads the hook's args tuple onto the
// queryFn, so an options-object parameter here would silently shift —
// offset landing in the signal slot (observed in a browser smoke: page 1
// worked only because offset 0 is falsy; offset 50 made fetch-fun's
// AbortSignal.any throw). These tests pin the params that actually reach
// the http layer.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('@/util/http', () => ({
  api: { apiChain: true },
  get: mockGet,
  // Pass-through mirroring the real combinator (undefined signal allowed).
  withSignal: (o: unknown, signal?: AbortSignal) => ({ ...(o as object), signal }),
}));

import {
  fetchContractDirectory,
  CONTRACT_DIRECTORY_PAGE_SIZE,
} from '@/services/contractDirectory';

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(undefined);
});

describe('fetchContractDirectory', () => {
  it('maps flat args onto q/offset/limit params with the signal on the client', async () => {
    await fetchContractDirectory(1, 'uni', 50);

    expect(mockGet).toHaveBeenCalledTimes(1);
    const [url, params, client] = mockGet.mock.calls[0];
    expect(url).toBe('/api/chains/1/contracts');
    // Pre-fix this was { q: undefined, offset: 0, limit: 50 } — the query
    // string 'uni' sat in the options-object slot and never reached the
    // params. Offset must land in params, not on the signal.
    expect(params).toEqual({
      q: 'uni',
      offset: 50,
      limit: CONTRACT_DIRECTORY_PAGE_SIZE,
    });
    expect(client).toEqual({ apiChain: true });
  });

  it('trims the filter and drops it when empty, defaults offset', async () => {
    await fetchContractDirectory(137, '  uni  ', undefined);
    expect(mockGet.mock.calls[0][1]).toEqual({
      q: 'uni',
      offset: undefined,
      limit: CONTRACT_DIRECTORY_PAGE_SIZE,
    });
    expect(mockGet.mock.calls[0][0]).toBe('/api/chains/137/contracts');

    await fetchContractDirectory(137, '   ');
    expect(mockGet.mock.calls[1][1]).toEqual({
      q: undefined,
      offset: undefined,
      limit: CONTRACT_DIRECTORY_PAGE_SIZE,
    });
  });

  it('resolves undefined without a request for non-positive chain ids', async () => {
    await expect(fetchContractDirectory(0, 'uni', 0)).resolves.toBeUndefined();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
