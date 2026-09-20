// Token-metadata service tests: multicall aggregation (symbol/decimals),
// honest-null decoding for reverted calls and transport failures, the 1h
// module cache, in-flight dedupe, and the useTokenMetadata hook's
// empty-list fast path. The only network edge — the viem client from
// utils/realTimeData — is mocked; the service code under test is real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import {
  fetchTokenMetadata,
  resetTokenMetadataCacheForTests,
  useTokenMetadata,
} from '@/services/tokenMetadata';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

const TOKEN = '0xaaa0000000000000000000000000000000000001';
const TOKEN_LOWER = TOKEN.toLowerCase();
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

type MulticallParams = {
  contracts: Array<{ address: string; functionName: string }>;
  allowFailure: boolean;
  multicallAddress: string;
};

const multicall = vi.fn<(params: MulticallParams) => Promise<readonly unknown[]>>();

beforeEach(() => {
  vi.clearAllMocks();
  resetTokenMetadataCacheForTests();
  vi.mocked(createRpcClient).mockResolvedValue({ multicall } as never);
});

// viem's allowFailure success shape: the decoded value wrapped with status.
const ok = (result: unknown): { status: 'success'; result: unknown } => ({
  status: 'success',
  result,
});

describe('fetchTokenMetadata', () => {
  it('aggregates symbol and decimals for an ERC-20 in one multicall', async () => {
    multicall.mockResolvedValue([ok('WETH'), ok(18)]);

    const metadata = await fetchTokenMetadata(1, [
      { address: TOKEN, includeDecimals: true },
    ]);

    expect(multicall).toHaveBeenCalledTimes(1);
    const [params] = multicall.mock.calls[0];
    expect(params.multicallAddress).toBe(MULTICALL3);
    expect(params.allowFailure).toBe(true);
    expect(params.contracts.map((contract) => contract.functionName)).toEqual([
      'symbol',
      'decimals',
    ]);
    expect(params.contracts.map((contract) => contract.address)).toEqual([
      TOKEN,
      TOKEN,
    ]);
    expect(metadata.get(TOKEN_LOWER)).toEqual({ symbol: 'WETH', decimals: 18 });
  });

  it('skips decimals() for non-ERC-20 tokens (it would revert)', async () => {
    multicall.mockResolvedValue([ok('BAYC')]);

    const metadata = await fetchTokenMetadata(1, [
      { address: TOKEN, includeDecimals: false },
    ]);

    expect(multicall).toHaveBeenCalledTimes(1);
    expect(
      multicall.mock.calls[0][0].contracts.map(
        (contract) => contract.functionName,
      ),
    ).toEqual(['symbol']);
    expect(metadata.get(TOKEN_LOWER)).toEqual({
      symbol: 'BAYC',
      decimals: null,
    });
  });

  it('decodes a reverted call to null fields without throwing', async () => {
    multicall.mockResolvedValue([null, null]);

    const metadata = await fetchTokenMetadata(1, [
      { address: TOKEN, includeDecimals: true },
    ]);

    expect(metadata.get(TOKEN_LOWER)).toEqual({ symbol: null, decimals: null });
  });

  it('keeps the successful field when only one call of the pair reverts', async () => {
    multicall.mockResolvedValue([
      ok('WETH'),
      { status: 'failure', error: new Error('reverted') },
    ]);

    const metadata = await fetchTokenMetadata(1, [
      { address: TOKEN, includeDecimals: true },
    ]);

    expect(metadata.get(TOKEN_LOWER)).toEqual({
      symbol: 'WETH',
      decimals: null,
    });
  });

  it('resolves all-null metadata when the multicall transport fails', async () => {
    multicall.mockRejectedValue(new Error('RPC down'));

    const metadata = await fetchTokenMetadata(1, [
      { address: TOKEN, includeDecimals: true },
    ]);

    expect(metadata.get(TOKEN_LOWER)).toEqual({ symbol: null, decimals: null });
  });

  it('does not cache transport failures: the next fetch retries the RPC', async () => {
    multicall
      .mockRejectedValueOnce(new Error('RPC down'))
      .mockResolvedValueOnce([ok('WETH'), ok(18)]);

    await fetchTokenMetadata(1, [{ address: TOKEN, includeDecimals: true }]);
    const second = await fetchTokenMetadata(1, [
      { address: TOKEN, includeDecimals: true },
    ]);

    expect(multicall).toHaveBeenCalledTimes(2);
    expect(second.get(TOKEN_LOWER)).toEqual({ symbol: 'WETH', decimals: 18 });
  });

  it('serves a second fetch within the TTL from cache without a new multicall', async () => {
    multicall.mockResolvedValue([ok('WETH'), ok(18)]);

    const first = await fetchTokenMetadata(1, [
      { address: TOKEN, includeDecimals: true },
    ]);
    const second = await fetchTokenMetadata(1, [
      { address: TOKEN, includeDecimals: true },
    ]);

    expect(multicall).toHaveBeenCalledTimes(1);
    expect(second.get(TOKEN_LOWER)).toEqual(first.get(TOKEN_LOWER));
  });

  it('keys the cache by chain: the same address on another chain refetches', async () => {
    multicall.mockResolvedValue([ok('WETH'), ok(18)]);

    await fetchTokenMetadata(1, [{ address: TOKEN, includeDecimals: true }]);
    await fetchTokenMetadata(10, [{ address: TOKEN, includeDecimals: true }]);

    expect(multicall).toHaveBeenCalledTimes(2);
  });

  it('shares one multicall between concurrent fetches of the same token', async () => {
    multicall.mockResolvedValue([ok('TKN'), ok(6)]);

    const [a, b] = await Promise.all([
      fetchTokenMetadata(1, [{ address: TOKEN, includeDecimals: true }]),
      fetchTokenMetadata(1, [{ address: TOKEN, includeDecimals: true }]),
    ]);

    expect(multicall).toHaveBeenCalledTimes(1);
    expect(a.get(TOKEN_LOWER)).toEqual({ symbol: 'TKN', decimals: 6 });
    expect(b.get(TOKEN_LOWER)).toEqual({ symbol: 'TKN', decimals: 6 });
  });

  it('returns an empty map without touching the network for an empty request list', async () => {
    const metadata = await fetchTokenMetadata(1, []);

    expect(metadata.size).toBe(0);
    expect(createRpcClient).not.toHaveBeenCalled();
    expect(multicall).not.toHaveBeenCalled();
  });

  it('returns an empty map without touching the network for chainId <= 0', async () => {
    const metadata = await fetchTokenMetadata(0, [
      { address: TOKEN, includeDecimals: true },
    ]);

    expect(metadata.size).toBe(0);
    expect(createRpcClient).not.toHaveBeenCalled();
    expect(multicall).not.toHaveBeenCalled();
  });
});

describe('useTokenMetadata', () => {
  it('returns a defined empty Map for an empty token list, with no network access', () => {
    const { result } = renderHook(() => useTokenMetadata(1, []));

    expect(result.current).toBeDefined();
    expect(result.current?.size).toBe(0);
    expect(createRpcClient).not.toHaveBeenCalled();
    expect(multicall).not.toHaveBeenCalled();
  });

  it('loads metadata for a token list and exposes it as a Map', async () => {
    multicall.mockResolvedValue([ok('WETH'), ok(18)]);

    const { result } = renderHook(() =>
      useTokenMetadata(1, [{ address: TOKEN, kind: 'erc20' }]),
    );

    // Undefined while the fetch is in flight.
    expect(result.current).toBeUndefined();

    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.get(TOKEN_LOWER)).toEqual({
      symbol: 'WETH',
      decimals: 18,
    });
    expect(multicall).toHaveBeenCalledTimes(1);
  });

  it('does not refetch when the parent passes a fresh but equal token array', async () => {
    multicall.mockResolvedValue([ok('WETH'), ok(18)]);

    const { result, rerender } = renderHook(
      ({ tokens }) => useTokenMetadata(1, tokens),
      {
        initialProps: { tokens: [{ address: TOKEN, kind: 'erc20' as const }] },
      },
    );

    await waitFor(() => expect(result.current).toBeDefined());
    expect(multicall).toHaveBeenCalledTimes(1);

    // Same content, new array identity — the digest key is unchanged.
    rerender({ tokens: [{ address: TOKEN, kind: 'erc20' as const }] });
    expect(multicall).toHaveBeenCalledTimes(1);
  });
});
