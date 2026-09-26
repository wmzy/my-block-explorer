// Server-side narrowing filters of the address transactions pipeline:
// the pure applyDiscoveredTxFilters unit over a fixture discovered set
// (from/to/min/max/combined, BigInt boundaries, contract-creation `to`),
// its wiring through getAddressTransactions (fresh scan AND cached
// re-read — filters reuse the SAME canonical discovery, never a new
// scan), and the guarantee that the unfiltered call shape stays
// byte-identical for existing consumers.
import { describe, it, expect, vi } from 'vitest';
import {
  applyDiscoveredTxFilters,
  createAddressService,
  type DiscoveredTransaction,
} from '@/services/AddressService';

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';
const HUGE = 2n ** 70n;

const tx = (fields: Partial<DiscoveredTransaction>): DiscoveredTransaction => ({
  hash: `0xhash-${fields.blockNumber ?? 0n}`,
  blockNumber: 100n,
  fromAddress: A,
  toAddress: B,
  value: '1000',
  timestamp: '2026-01-01T00:00:00.000Z',
  ...fields,
});

// Newest-first (service order). Five discovered rows exercising every
// filter dimension: incoming/outgoing/self/creation/other-party, tiny
// and beyond-2^64 wei values.
const FIXTURE: DiscoveredTransaction[] = [
  tx({ blockNumber: 100n, fromAddress: A, toAddress: B, value: '1000' }),
  tx({ blockNumber: 80n, fromAddress: B, toAddress: A, value: '2000000000000000000' }),
  tx({ blockNumber: 60n, fromAddress: A, toAddress: A, value: '5' }),
  tx({ blockNumber: 40n, fromAddress: A, toAddress: '', value: '0' }),
  tx({ blockNumber: 20n, fromAddress: C, toAddress: A, value: HUGE.toString() }),
];

const hashes = (rows: readonly DiscoveredTransaction[]) =>
  rows.map(row => row.blockNumber.toString());

describe('applyDiscoveredTxFilters (pure)', () => {
  it('returns an equal-content list when no filter is given', () => {
    expect(applyDiscoveredTxFilters(FIXTURE, undefined)).toEqual(FIXTURE);
    expect(applyDiscoveredTxFilters(FIXTURE, {})).toEqual(FIXTURE);
  });

  it('fromAddress only keeps transactions initiated by that address', () => {
    const rows = applyDiscoveredTxFilters(FIXTURE, { fromAddress: A });
    expect(hashes(rows)).toEqual(['100', '60', '40']);
  });

  it('toAddress only keeps transactions received by that address', () => {
    const rows = applyDiscoveredTxFilters(FIXTURE, { toAddress: A });
    expect(hashes(rows)).toEqual(['80', '60', '20']);
  });

  it('a contract creation (null `to`, stored as "") never matches a toAddress filter', () => {
    const rows = applyDiscoveredTxFilters(FIXTURE, { toAddress: B });
    expect(hashes(rows)).toEqual(['100']);
  });

  it('from+to intersect (both must hold)', () => {
    expect(hashes(applyDiscoveredTxFilters(FIXTURE, { fromAddress: B, toAddress: A })))
      .toEqual(['80']);
    expect(hashes(applyDiscoveredTxFilters(FIXTURE, { fromAddress: A, toAddress: A })))
      .toEqual(['60']);
  });

  it('matches addresses case-insensitively on both ends', () => {
    const rows = applyDiscoveredTxFilters(FIXTURE, { fromAddress: A.toUpperCase() });
    expect(hashes(rows)).toEqual(['100', '60', '40']);
  });

  it('minValue is inclusive and BigInt-exact', () => {
    // Exactly 1000 is kept (boundary), 5 and 0 dropped.
    expect(hashes(applyDiscoveredTxFilters(FIXTURE, { minValue: 1000n })))
      .toEqual(['100', '80', '20']);
    // minValue 0 keeps everything (0 is a valid floor).
    expect(applyDiscoveredTxFilters(FIXTURE, { minValue: 0n })).toHaveLength(5);
    // Beyond 2^64: only the huge incoming transfer survives.
    expect(hashes(applyDiscoveredTxFilters(FIXTURE, { minValue: 2n ** 64n })))
      .toEqual(['20']);
  });

  it('maxValue is inclusive and BigInt-exact', () => {
    expect(hashes(applyDiscoveredTxFilters(FIXTURE, { maxValue: 5n })))
      .toEqual(['60', '40']);
    expect(hashes(applyDiscoveredTxFilters(FIXTURE, { maxValue: HUGE })))
      .toEqual(['100', '80', '60', '40', '20']);
    expect(hashes(applyDiscoveredTxFilters(FIXTURE, { maxValue: HUGE - 1n })))
      .toEqual(['100', '80', '60', '40']);
  });

  it('combined filters intersect all dimensions', () => {
    expect(
      hashes(applyDiscoveredTxFilters(FIXTURE, { fromAddress: A, maxValue: 5n })),
    ).toEqual(['60', '40']);
    expect(
      hashes(applyDiscoveredTxFilters(FIXTURE, { toAddress: A, minValue: 1000n })),
    ).toEqual(['80', '20']);
  });

  it('an over-narrow combination yields an honest empty list', () => {
    expect(applyDiscoveredTxFilters(FIXTURE, { fromAddress: C, toAddress: B })).toEqual([]);
    expect(applyDiscoveredTxFilters(FIXTURE, { minValue: 5n, maxValue: 5n, fromAddress: B }))
      .toEqual([]);
  });
});

// Builds a service whose discovery finds the FIXTURE rows for target A
// (A is involved in every row — from, to, or both — so the scan's own
// address-involvement filter keeps all five): one balance-changing block
// per row (same balance-step shape as addressBalancePoints.test.ts).
// The fixture client is address-agnostic otherwise; wiring tests pick
// DISTINCT chain ids so each gets a fresh module-level cache entry.
const makeDiscoveryService = () => {
  const stepBlocks = [100n, 80n, 60n, 40n, 20n];
  const client = {
    getTransactionCount: vi.fn().mockResolvedValue(5),
    getBlockNumber: vi.fn().mockResolvedValue(128n),
    getBalance: vi.fn(async ({ blockNumber }: { blockNumber?: bigint }) => {
      if (blockNumber === undefined || blockNumber >= 100n) return 5n;
      if (blockNumber >= 80n) return 4n;
      if (blockNumber >= 60n) return 3n;
      if (blockNumber >= 40n) return 2n;
      if (blockNumber >= 20n) return 1n;
      return 0n;
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      timestamp: 1_700_000_000n,
      transactions: stepBlocks.includes(blockNumber)
        ? [FIXTURE.find(row => row.blockNumber === blockNumber)]
            .filter((row): row is DiscoveredTransaction => row !== undefined)
            .map(row => ({
              hash: row.hash,
              from: row.fromAddress,
              // '' encodes a contract creation's null `to`.
              to: row.toAddress === '' ? null : row.toAddress,
              value: BigInt(row.value),
            }))
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

describe('getAddressTransactions — filters wiring', () => {
  it('applies a from-filter over the fresh scan: total is the filtered count', async () => {
    const { service } = makeDiscoveryService();

    const result = await service.getAddressTransactions(101, A, 20, 0, undefined, {
      filters: { fromAddress: A },
    });

    expect(hashes(result.transactions)).toEqual(['100', '60', '40']);
    expect(result.total).toBe(3);
    // Coverage semantics are untouched: a filtered view of a partial
    // discovery is still partial, with the same window report.
    expect(result.coverage).toBe('partial');
    expect(result.searchWindowBlocks).toBeDefined();
  });

  it('applies value filters with BigInt exactness past 2^64', async () => {
    const { service } = makeDiscoveryService();

    const result = await service.getAddressTransactions(102, A, 20, 0, undefined, {
      filters: { minValue: 2n ** 64n },
    });

    expect(hashes(result.transactions)).toEqual(['20']);
    expect(result.total).toBe(1);
  });

  it('paginates within the filtered list', async () => {
    const { service } = makeDiscoveryService();

    // limit 2, page 2 → offset 2 of the filtered [100, 60, 40] list.
    const page1 = await service.getAddressTransactions(103, A, 2, 0, undefined, {
      filters: { fromAddress: A },
    });
    const page2 = await service.getAddressTransactions(103, A, 2, 2, undefined, {
      filters: { fromAddress: A },
    });

    expect(page1.total).toBe(3);
    expect(hashes(page1.transactions)).toEqual(['100', '60']);
    expect(page2.total).toBe(3);
    expect(hashes(page2.transactions)).toEqual(['40']);
  });

  it('reuses the SAME cached discovery for a filtered read — no new scan', async () => {
    const { service, client } = makeDiscoveryService();

    await service.getAddressTransactions(104, A, 20, 0);
    const scanCallsAfterFirst = client.getBlock.mock.calls.length;

    const filtered = await service.getAddressTransactions(104, A, 20, 0, undefined, {
      filters: { toAddress: A },
    });

    // No additional block fetches: the filter narrowed the cached list.
    expect(client.getBlock.mock.calls.length).toBe(scanCallsAfterFirst);
    expect(hashes(filtered.transactions)).toEqual(['80', '60', '20']);
    expect(filtered.total).toBe(3);
  });

  it('a different filter re-reads the same cache entry (still no new scan)', async () => {
    const { service, client } = makeDiscoveryService();

    await service.getAddressTransactions(105, A, 20, 0, undefined, {
      filters: { fromAddress: B },
    });
    const callsAfterFirst = client.getBlock.mock.calls.length;

    const other = await service.getAddressTransactions(105, A, 20, 0, undefined, {
      filters: { minValue: 1000n },
    });

    expect(client.getBlock.mock.calls.length).toBe(callsAfterFirst);
    expect(other.total).toBe(3);
  });

  it('filter-empty result is an honest empty page, not an error', async () => {
    const { service } = makeDiscoveryService();

    const result = await service.getAddressTransactions(106, A, 20, 0, undefined, {
      filters: { fromAddress: C, toAddress: B },
    });

    expect(result.transactions).toEqual([]);
    expect(result.total).toBe(0);
    // Still a successful heuristic search: coverage stays 'partial' with
    // its window report — an empty FILTER is not a failed scan.
    expect(result.coverage).toBe('partial');
    expect(result.method).toBe('binary-search');
    expect(result.reason).toBeUndefined();
  });

  it('keeps the unfiltered call shape byte-identical (no filter side effects)', async () => {
    const { service } = makeDiscoveryService();

    const plain = await service.getAddressTransactions(107, A);
    const explicitNone = await service.getAddressTransactions(107, A, 20, 0, undefined, {
      filters: {},
    });

    expect(explicitNone.total).toBe(plain.total);
    expect(explicitNone.transactions).toEqual(plain.transactions);
    expect(Object.hasOwn(explicitNone, 'filtersApplied')).toBe(false);
    expect(plain.total).toBe(5);
  });

  it('balancePoints follow the served (filtered) set', async () => {
    const { service } = makeDiscoveryService();

    const result = await service.getAddressTransactions(108, A, 20, 0, undefined, {
      includeBalancePoints: true,
      filters: { fromAddress: A },
    });

    // The filtered rows are the 3 outgoing ones (creation 0 + self 5 +
    // plain 1000), walked oldest→newest behind the explicit 0 anchor.
    // The self-transfer nets 0, so the series is 0, 0, 0, -1000.
    expect(result.balancePoints).toHaveLength(4);
    expect(result.balancePoints?.map(p => p.blockNumber)).toEqual(['40', '40', '60', '100']);
    expect(result.balancePoints?.map(p => p.cumulativeValue)).toEqual([
      '0',
      '0',
      '0',
      '-1000',
    ]);
  });
});
