// Unit tests for the Token Overview slice: the pure classification of
// name/symbol/decimals/totalSupply reads, BigInt-exact supply formatting,
// the discovered-holders netting, and the service's Multicall3 batch
// (honest nulls, caching, in-flight dedup, disabled = zero RPC). No
// network: the RPC client factory is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import {
  fetchTokenOverview,
  useTokenOverview,
  resetTokenMetadataCacheForTests,
} from '@/services/tokenMetadata';
import {
  classifyTokenOverview,
  formatTokenSupply,
  computeDiscoveredHolders,
} from '@/views/Address/tokenOverview';
import type { TokenTransfer } from '@/services/tokenTransfers';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  multicall: vi.fn(),
}));

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: (...args: unknown[]) => mocks.createClient(...args),
}));

const TOKEN = `0x${'a'.repeat(40)}`;
const OTHER_TOKEN = `0x${'b'.repeat(40)}`;
const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CAROL = '0x3333333333333333333333333333333333333333';
const ZERO = '0x0000000000000000000000000000000000000000';

// Per-functionName probe responses for the multicall mock: a listed name
// answers successfully, anything else reverts (the call-level honesty
// path). Keying by call identity (not slot index) keeps the mock
// behavioral — the service must map each probe to its own field.
const setProbes = (entries: Record<string, unknown>): void => {
  mocks.multicall.mockImplementation(
    async ({ contracts }: { contracts: Array<{ functionName: string }> }) =>
      contracts.map((contract) =>
        contract.functionName in entries
          ? { status: 'success', result: entries[contract.functionName] }
          : { status: 'failure', error: new Error('execution reverted') },
      ),
  );
};

function row(fields: Partial<TokenTransfer>): TokenTransfer {
  return {
    txHash: '0xdead',
    blockNumber: 1,
    logIndex: 0,
    token: TOKEN,
    standard: 'erc20-or-erc721',
    from: ALICE,
    to: BOB,
    value: '0',
    direction: 'out',
    ...fields,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTokenMetadataCacheForTests();
  mocks.createClient.mockResolvedValue({ multicall: mocks.multicall });
  setProbes({});
});

describe('classifyTokenOverview', () => {
  it('claims ERC-20 only when decimals AND totalSupply both responded', () => {
    const verdict = classifyTokenOverview({
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 1_000_000n,
    });
    expect(verdict).toEqual({
      isErc20: true,
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 1_000_000n,
    });
  });

  it('keeps missing name/symbol honest (null, never fabricated)', () => {
    const verdict = classifyTokenOverview({
      name: null,
      symbol: null,
      decimals: 18,
      totalSupply: 0n,
    });
    expect(verdict?.isErc20).toBe(true);
    expect(verdict?.name).toBeNull();
    expect(verdict?.symbol).toBeNull();
  });

  it('labels a name/symbol-only contract a token of unknown standard', () => {
    // The classic ERC-721 shape: name/symbol answer, decimals() reverts.
    const verdict = classifyTokenOverview({
      name: 'CryptoPunks',
      symbol: 'PUNK',
      decimals: null,
      totalSupply: null,
    });
    expect(verdict?.isErc20).toBe(false);
    expect(verdict?.name).toBe('CryptoPunks');
    expect(verdict?.decimals).toBeNull();
  });

  it('treats decimals without totalSupply as unproven (not ERC-20)', () => {
    const verdict = classifyTokenOverview({
      name: null,
      symbol: 'WEIRD',
      decimals: 18,
      totalSupply: null,
    });
    expect(verdict?.isErc20).toBe(false);
    expect(verdict?.decimals).toBe(18);
  });

  it('returns null for plain contracts and unsettled reads (no card)', () => {
    expect(
      classifyTokenOverview({ name: null, symbol: null, decimals: null, totalSupply: null }),
    ).toBeNull();
    expect(classifyTokenOverview(undefined)).toBeNull();
  });
});

describe('formatTokenSupply', () => {
  it('formats with the token own decimals, not native currency defaults', () => {
    expect(formatTokenSupply(1_234_567n, 6)).toBe('1.234567');
    expect(formatTokenSupply(1_000n, 0)).toBe('1000');
  });

  it('keeps raw base units when decimals is unknown', () => {
    expect(formatTokenSupply(1_234_567n, null)).toBe('1234567');
  });

  it('stays exact beyond 2^53', () => {
    expect(formatTokenSupply(10n ** 24n + 1n, 18)).toBe('1000000.000000000000000001');
  });
});

describe('computeDiscoveredHolders', () => {
  it('nets from/to per participant and drops the mint/burn zero address', () => {
    const result = computeDiscoveredHolders(
      [
        row({ from: ZERO, to: ALICE, value: '100' }),
        row({ from: ALICE, to: BOB, value: '30' }),
        row({ from: BOB, to: CAROL, value: '10' }),
      ],
      TOKEN,
      true,
    );
    expect(result.holders).toEqual([
      { address: ALICE, net: 70n },
      { address: BOB, net: 20n },
      { address: CAROL, net: 10n },
    ]);
    expect(result.excludedTransfers).toBe(0);
  });

  it('ignores rows of other tokens entirely', () => {
    const result = computeDiscoveredHolders(
      [
        row({ from: ZERO, to: ALICE, value: '100' }),
        row({ token: OTHER_TOKEN, from: ALICE, to: CAROL, value: '999' }),
      ],
      TOKEN,
      true,
    );
    expect(result.holders).toEqual([{ address: ALICE, net: 100n }]);
    expect(result.excludedTransfers).toBe(0);
  });

  it('excludes ERC-721-classified rows from balances and counts them', () => {
    const result = computeDiscoveredHolders(
      [
        row({ from: ZERO, to: ALICE, value: '7' }),
        row({ from: ALICE, to: BOB, value: '9' }),
      ],
      TOKEN,
      false,
    );
    expect(result.holders).toEqual([]);
    expect(result.excludedTransfers).toBe(2);
  });

  it('excludes ERC-1155 rows of the same token from balances', () => {
    const result = computeDiscoveredHolders(
      [
        row({ from: ZERO, to: ALICE, value: '100' }),
        row({ standard: 'erc1155-single', tokenIds: ['1'], amounts: ['5'], value: '5' }),
        row({ standard: 'erc1155-batch', tokenIds: ['1', '2'], amounts: ['5', '6'], value: '2' }),
      ],
      TOKEN,
      true,
    );
    expect(result.holders).toEqual([{ address: ALICE, net: 100n }]);
    expect(result.excludedTransfers).toBe(2);
  });

  it('excludes rows with unparseable values instead of guessing', () => {
    const result = computeDiscoveredHolders(
      [row({ from: ALICE, to: BOB, value: '0x10' })],
      TOKEN,
      true,
    );
    expect(result.holders).toEqual([]);
    expect(result.excludedTransfers).toBe(1);
  });

  it('drops participants whose nets cancel to zero', () => {
    const result = computeDiscoveredHolders(
      [
        row({ from: ZERO, to: ALICE, value: '100' }),
        row({ from: ALICE, to: BOB, value: '100' }),
      ],
      TOKEN,
      true,
    );
    expect(result.holders).toEqual([{ address: BOB, net: 100n }]);
  });

  it('orders by net descending (ties by address) and caps at the limit', () => {
    const result = computeDiscoveredHolders(
      [
        row({ from: ZERO, to: CAROL, value: '50' }),
        row({ from: ZERO, to: BOB, value: '100' }),
        row({ from: ZERO, to: ALICE, value: '90' }),
        row({ from: ALICE, to: BOB, value: '10' }),
      ],
      TOKEN,
      true,
      2,
    );
    // BOB nets 110, ALICE 80 (90 in, 10 out), CAROL 50 — the limit cuts
    // CAROL off.
    expect(result.holders).toEqual([
      { address: BOB, net: 110n },
      { address: ALICE, net: 80n },
    ]);
  });

  it('breaks equal nets by ascending address for determinism', () => {
    const result = computeDiscoveredHolders(
      [
        row({ from: ZERO, to: CAROL, value: '100' }),
        row({ from: ZERO, to: ALICE, value: '100' }),
        row({ from: ZERO, to: BOB, value: '100' }),
      ],
      TOKEN,
      true,
    );
    expect(result.holders.map(holder => holder.address)).toEqual([ALICE, BOB, CAROL]);
  });

  it('keeps negative nets visible (honest scan-window artifact)', () => {
    const result = computeDiscoveredHolders(
      [row({ from: ALICE, to: BOB, value: '50' })],
      TOKEN,
      true,
    );
    expect(result.holders).toEqual([
      { address: BOB, net: 50n },
      { address: ALICE, net: -50n },
    ]);
  });

  it('nets token-mode rows exactly like participant rows (direction is ignored)', () => {
    // Token-mode scan rows: every row carries token === viewed address
    // and direction 'none' wherever the contract is not a participant —
    // the netting keys on from/to exclusively, so the mode is invisible
    // to it. Same ledger as the participant fixtures, relabeled.
    const result = computeDiscoveredHolders(
      [
        row({ from: ZERO, to: ALICE, value: '100', direction: 'none' }),
        row({ from: ALICE, to: BOB, value: '30', direction: 'none' }),
        row({ from: BOB, to: CAROL, value: '10', direction: 'in' }),
      ],
      TOKEN,
      true,
    );
    // ALICE +70, BOB +20, CAROL +10; the mint/burn zero address never
    // becomes a holder row.
    expect(result.holders).toEqual([
      { address: ALICE, net: 70n },
      { address: BOB, net: 20n },
      { address: CAROL, net: 10n },
    ]);
    expect(result.excludedTransfers).toBe(0);
  });
});

describe('fetchTokenOverview', () => {
  it('decodes all four probes from one multicall', async () => {
    setProbes({
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 1_000_000n,
    });
    const reads = await fetchTokenOverview(1, TOKEN.toUpperCase());
    expect(reads).toEqual({
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 1_000_000n,
    });
    expect(mocks.multicall).toHaveBeenCalledTimes(1);
    const request = mocks.multicall.mock.calls[0][0] as {
      contracts: Array<{ functionName: string }>;
      allowFailure: boolean;
      multicallAddress: string;
    };
    expect(request.contracts.map((contract) => contract.functionName)).toEqual([
      'name',
      'symbol',
      'decimals',
      'totalSupply',
    ]);
    expect(request.allowFailure).toBe(true);
    expect(request.multicallAddress).toBe('0xcA11bde05977b3631167028862bE2a173976CA11');
  });

  it('decodes reverted probes to honest nulls', async () => {
    setProbes({ name: 'CryptoPunks', symbol: 'PUNK' });
    const reads = await fetchTokenOverview(1, TOKEN);
    expect(reads).toEqual({
      name: 'CryptoPunks',
      symbol: 'PUNK',
      decimals: null,
      totalSupply: null,
    });
  });

  it('caches answered reads for the TTL and dedups in-flight callers', async () => {
    setProbes({ symbol: 'USDC', decimals: 6, totalSupply: 10n });
    const [first, second] = await Promise.all([
      fetchTokenOverview(1, TOKEN),
      fetchTokenOverview(1, TOKEN),
    ]);
    expect(second).toEqual(first);
    expect(mocks.multicall).toHaveBeenCalledTimes(1);
    // Settled entry: a later call reuses the cache.
    await fetchTokenOverview(1, TOKEN);
    expect(mocks.multicall).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined on transport failure and does NOT cache it', async () => {
    mocks.multicall.mockRejectedValue(new Error('fetch failed'));
    await expect(fetchTokenOverview(1, TOKEN)).resolves.toBeUndefined();
    await expect(fetchTokenOverview(1, TOKEN)).resolves.toBeUndefined();
    expect(mocks.multicall).toHaveBeenCalledTimes(2);
  });

  it('issues no RPC for a disabled chainId or blank address', async () => {
    await expect(fetchTokenOverview(0, TOKEN)).resolves.toBeUndefined();
    await expect(fetchTokenOverview(1, '')).resolves.toBeUndefined();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe('useTokenOverview', () => {
  it('issues no RPC at all while disabled (the EOA path)', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useTokenOverview(1, TOKEN, enabled),
      { initialProps: { enabled: false } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBeUndefined();
    expect(mocks.createClient).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toBeDefined());
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });

  it('stays undefined on a transport-level failure (no wrong verdict)', async () => {
    mocks.multicall.mockRejectedValue(new Error('fetch failed'));
    const { result } = renderHook(() => useTokenOverview(1, TOKEN, true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toBeUndefined();
  });
});
