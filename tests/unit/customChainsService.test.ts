// Frontend custom-chain service: fetched rows register into the runtime
// registry (so getChainInfo resolves custom chains browser-side, the
// mirror of the backend's RpcManager bootstrap), malformed rows are
// dropped rather than fabricated, addCustomChain registers locally on
// success and rejects with ApiError otherwise, and the
// ensureCustomChainsLoaded gate is one-shot and failure-tolerant (a dead
// backend settles silently — the unsupported state it guards stands).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/util/apiError';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  api: { apiChain: true },
  get: mocks.get,
  post: mocks.post,
  // Pass-through mirroring the real combinator (undefined signal allowed).
  withSignal: (o: unknown, signal?: AbortSignal) => ({ ...(o as object), signal }),
}));

import {
  fetchCustomChains,
  ensureCustomChainsLoaded,
  addCustomChain,
  resetCustomChainsServiceForTests,
} from '@/services/customChains';
import { getChainInfo } from '@/config/chains';
import { resetCustomChainsForTests } from '@/config/customChains';

const ANVIL_ROW = {
  chainId: 31337,
  name: 'Anvil Local',
  symbol: 'ETH',
  decimals: 18,
  rpcUrl: 'http://127.0.0.1:8545',
  urlRedacted: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCustomChainsForTests();
  resetCustomChainsServiceForTests();
});

describe('fetchCustomChains', () => {
  it('returns the served rows and registers them for getChainInfo', async () => {
    mocks.get.mockResolvedValue({ chains: [ANVIL_ROW] });

    const views = await fetchCustomChains();

    expect(mocks.get).toHaveBeenCalledWith(
      '/api/chains/custom',
      undefined,
      expect.objectContaining({ apiChain: true }),
    );
    expect(views).toEqual([ANVIL_ROW]);
    expect(getChainInfo(31337)?.name).toBe('Anvil Local');
    expect(getChainInfo(31337)?.rpcUrls.default.http).toEqual(['http://127.0.0.1:8545']);
  });

  it('drops malformed rows instead of fabricating chains', async () => {
    mocks.get.mockResolvedValue({
      chains: [
        { chainId: 'not-a-number', name: 'x', symbol: 'y', rpcUrl: 'http://z' },
        { chainId: 31337 }, // missing name/symbol/rpcUrl
        null,
        ANVIL_ROW,
      ],
    });

    const views = await fetchCustomChains();

    expect(views.map(v => v.chainId)).toEqual([31337]);
    expect(getChainInfo(31337)).not.toBeNull();
  });

  it('propagates transport failures (the hook surfaces the error branch)', async () => {
    mocks.get.mockRejectedValue(new ApiError('backend unreachable', 0));

    await expect(fetchCustomChains()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('addCustomChain', () => {
  it('registers the echoed chain locally and returns its registry entry', async () => {
    mocks.post.mockResolvedValue(ANVIL_ROW);

    const chain = await addCustomChain({ rpcUrl: 'http://127.0.0.1:8545' });

    expect(mocks.post).toHaveBeenCalledWith('/api/chains/custom', {
      rpcUrl: 'http://127.0.0.1:8545',
    });
    expect(chain.chainId).toBe(31337);
    expect(getChainInfo(31337)?.nativeCurrency.symbol).toBe('ETH');
  });

  it('rejects with the ApiError (409 already-known etc.) and registers nothing', async () => {
    mocks.post.mockRejectedValue(
      new ApiError('The RPC reports chain ID 137, which this explorer already knows as "Polygon".', 409),
    );

    await expect(addCustomChain({ rpcUrl: 'https://polygon-rpc.example' })).rejects.toMatchObject({
      status: 409,
    });
    // Nothing registered: viem's own placeholder answer still stands.
    expect(getChainInfo(31337)?.rpcUrls.default.http).toEqual(['http://127.0.0.1:8545']);
  });

  it('rejects on a malformed echo instead of trusting it', async () => {
    mocks.post.mockResolvedValue({ nope: true });

    await expect(addCustomChain({ rpcUrl: 'http://127.0.0.1:8545' })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(getChainInfo(31337)?.rpcUrls.default.http).toEqual(['http://127.0.0.1:8545']);
  });
});

describe('ensureCustomChainsLoaded', () => {
  it('settles silently when the backend is unreachable, then stays one-shot', async () => {
    mocks.get.mockRejectedValue(new ApiError('backend unreachable', 0));

    await expect(ensureCustomChainsLoaded()).resolves.toBeUndefined();

    // Second call must not refire the failed request.
    await expect(ensureCustomChainsLoaded()).resolves.toBeUndefined();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('settles after a successful fetch that registered the rows', async () => {
    mocks.get.mockResolvedValue({ chains: [ANVIL_ROW] });

    await ensureCustomChainsLoaded();

    expect(getChainInfo(31337)).not.toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
