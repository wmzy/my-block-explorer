// Unit tests for the additive balance-history payload of the address
// transactions pipeline: the pure cumulative-delta computation over a
// discovered set, its opt-in wiring through getAddressTransactions
// (fresh search AND cached re-read — the chart must ride the same
// canonical list as the paginated tx response), and the guarantee that
// the default call shape stays byte-identical for existing consumers.
import { describe, it, expect, vi } from 'vitest';
import {
  computeDiscoveredBalancePoints,
  createAddressService,
  type DiscoveredTransaction,
} from '@/services/AddressService';

const TEST_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const OTHER = '0x9999999999999999999999999999999999999999';

const discovered = (fields: Partial<DiscoveredTransaction>): DiscoveredTransaction => ({
  hash: `0x${(fields.blockNumber ?? 0n).toString(16)}`,
  blockNumber: 100n,
  fromAddress: OTHER,
  toAddress: TEST_ADDRESS,
  value: '1000000000000000000',
  timestamp: '2026-01-01T00:00:00.000Z',
  ...fields,
});

describe('computeDiscoveredBalancePoints (pure)', () => {
  it('walks the discovered set oldest→newest from an explicit 0 anchor', () => {
    // Service order: newest first.
    const points = computeDiscoveredBalancePoints(
      [
        discovered({ blockNumber: 300n, value: '3000000000000000000' }),
        discovered({ blockNumber: 100n, value: '1000000000000000000', toAddress: OTHER, fromAddress: TEST_ADDRESS }),
        discovered({ blockNumber: 200n, value: '2000000000000000000' }),
      ],
      TEST_ADDRESS,
    );

    expect(points).toEqual([
      { blockNumber: '100', timestamp: '2026-01-01T00:00:00.000Z', cumulativeValue: '0' },
      { blockNumber: '100', timestamp: '2026-01-01T00:00:00.000Z', cumulativeValue: '-1000000000000000000' },
      { blockNumber: '200', timestamp: '2026-01-01T00:00:00.000Z', cumulativeValue: '1000000000000000000' },
      { blockNumber: '300', timestamp: '2026-01-01T00:00:00.000Z', cumulativeValue: '4000000000000000000' },
    ]);
  });

  it('normalizes any input ordering (stable within a block)', () => {
    const points = computeDiscoveredBalancePoints(
      [
        discovered({ blockNumber: 10n, value: '5' }),
        discovered({ blockNumber: 30n, value: '7' }),
        discovered({ blockNumber: 10n, value: '2' }),
      ],
      TEST_ADDRESS,
    );

    // Same-block pair keeps input order in the chronological walk
    // (reversed newest-first list): value 2 then 5.
    expect(points.map(p => p.cumulativeValue)).toEqual(['0', '2', '7', '14']);
  });

  it('nets self-transfers to zero', () => {
    const points = computeDiscoveredBalancePoints(
      [discovered({ blockNumber: 10n, fromAddress: TEST_ADDRESS, toAddress: TEST_ADDRESS, value: '42' })],
      TEST_ADDRESS,
    );

    expect(points.map(p => p.cumulativeValue)).toEqual(['0', '0']);
  });

  it('matches by address case-insensitively and stays exact beyond 2^64', () => {
    const huge = 2n ** 70n;
    const points = computeDiscoveredBalancePoints(
      [
        discovered({ blockNumber: 10n, value: huge.toString(), toAddress: TEST_ADDRESS.toUpperCase() }),
        discovered({ blockNumber: 20n, value: (huge + 1n).toString(), fromAddress: TEST_ADDRESS.toLowerCase(), toAddress: OTHER }),
      ],
      TEST_ADDRESS,
    );

    expect(points.map(p => p.cumulativeValue)).toEqual([
      '0',
      huge.toString(),
      '-1',
    ]);
  });

  it('returns an empty series for an empty discovery', () => {
    expect(computeDiscoveredBalancePoints([], TEST_ADDRESS)).toEqual([]);
  });
});

// Builds a service whose discovery scan finds one outgoing tx per step
// block (same balance-step shape as addressServiceSimple.test.ts).
const makeDiscoveryService = () => {
  const latestBlock = 128n;
  const txBlocks = [100n, 60n, 20n];
  const client = {
    getTransactionCount: vi.fn().mockResolvedValue(5),
    getBlockNumber: vi.fn().mockResolvedValue(latestBlock),
    getBalance: vi.fn(async ({ blockNumber }: { blockNumber?: bigint }) => {
      if (blockNumber === undefined || blockNumber >= 100n) return 3n;
      if (blockNumber >= 60n) return 2n;
      if (blockNumber >= 20n) return 1n;
      return 0n;
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      timestamp: 1_700_000_000n,
      transactions: txBlocks.includes(blockNumber)
        ? [
            {
              hash: `0xtx-${blockNumber.toString()}`,
              from: TEST_ADDRESS,
              to: OTHER,
              value: blockNumber * 1_000n,
            },
          ]
        : [],
    })),
  };
  const service = createAddressService({
    db: undefined as unknown as Parameters<typeof createAddressService>[0]['db'],
    indexedAddresses: undefined as unknown as Parameters<typeof createAddressService>[0]['indexedAddresses'],
    rpcManager: { getClient: vi.fn().mockResolvedValue(client) } as unknown as Parameters<
      typeof createAddressService
    >[0]['rpcManager'],
    contractSourceService: undefined as unknown as Parameters<typeof createAddressService>[0]['contractSourceService'],
  });
  return { service, client };
};

describe('getAddressTransactions — balancePoints opt-in', () => {
  it('computes points over the FULL discovered set, not the served page', async () => {
    const { service } = makeDiscoveryService();

    // Page of 2 from a 3-tx discovery: the series must still cover all 3
    // (+ the anchor) — the chart never depends on which page it fetched.
    const result = await service.getAddressTransactions(
      1,
      TEST_ADDRESS,
      2,
      0,
      undefined,
      { includeBalancePoints: true },
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.balancePoints).toHaveLength(4);
    // All outgoing → deltas negative; cumulative descends towards the present.
    expect(result.balancePoints?.map(p => p.blockNumber)).toEqual(['20', '20', '60', '100']);
    expect(result.balancePoints?.map(p => p.cumulativeValue)).toEqual([
      '0',
      '-20000',
      '-80000',
      '-180000',
    ]);
  });

  it('keeps the default call shape byte-identical (no balancePoints key)', async () => {
    const { service } = makeDiscoveryService();

    const result = await service.getAddressTransactions(1, TEST_ADDRESS);

    expect(result.total).toBe(3);
    expect('balancePoints' in result).toBe(false);
    // The cached canonical entry stays free of the derived payload.
    const again = await service.getAddressTransactions(1, TEST_ADDRESS);
    expect('balancePoints' in again).toBe(false);
  });

  it('serves points from the cache on re-read — no second scan', async () => {
    const { service, client } = makeDiscoveryService();

    await service.getAddressTransactions(1, TEST_ADDRESS);
    const firstScanBlocks = client.getBlock.mock.calls.length;

    const cached = await service.getAddressTransactions(
      1,
      TEST_ADDRESS,
      20,
      0,
      undefined,
      { includeBalancePoints: true },
    );

    expect(client.getBlock.mock.calls.length).toBe(firstScanBlocks);
    expect(cached.balancePoints).toHaveLength(4);
    expect(cached.transactions).toHaveLength(3);
  });

  it('emits an empty series for the failed-search fallback', async () => {
    const client = {
      getTransactionCount: vi.fn().mockRejectedValue(new Error('rpc down')),
      getBlockNumber: vi.fn().mockRejectedValue(new Error('rpc down')),
      getBalance: vi.fn().mockRejectedValue(new Error('rpc down')),
    };
    const service = createAddressService({
      db: undefined as unknown as Parameters<typeof createAddressService>[0]['db'],
      indexedAddresses: undefined as unknown as Parameters<typeof createAddressService>[0]['indexedAddresses'],
      rpcManager: { getClient: vi.fn().mockResolvedValue(client) } as unknown as Parameters<
        typeof createAddressService
      >[0]['rpcManager'],
      contractSourceService: undefined as unknown as Parameters<typeof createAddressService>[0]['contractSourceService'],
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS, 20, 0, undefined, {
      includeBalancePoints: true,
    });

    expect(result.coverage).toBe('none');
    expect(result.balancePoints).toEqual([]);
  });
});
