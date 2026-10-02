// Falsy-zero on the DB write path: a quantity that can legitimately be 0
// must be tested for PRESENCE, not truthiness — `0n` and `0` are falsy.
//
// `indexTransaction` mapped two viem fields with truthiness:
//
//   blockNumber: tx.blockNumber ? BigInt(tx.blockNumber) : null
//   nonce:       tx.nonce       ? BigInt(tx.nonce)       : null
//
// Both are always present on a transaction: `nonce` is 0 for the FIRST
// transaction of every account, and `blockNumber` is 0n for any transaction
// in genesis. So the row was written with block_number = NULL / nonce = NULL
// for exactly those transactions — indistinguishable, in the stored data and
// in the API payload (formatTransactionForApi drops null fields), from a
// transaction whose position the indexer did not know. The sibling fields in
// the same object already use `??` correctly, which is what makes this pair
// the exception rather than the rule.
//
// `getBlockStats` had the same shape on a read path:
// `latestResult[0]?.number ? BigInt(...) : null` on a BIGNUM column, so a
// chain whose only indexed block is genesis (a freshly booted anvil/hardhat/
// local geth — the indexer's main dev target) reported latestBlock: null
// while its sibling totalBlocks said 1. The stats route turns that into
// `latestIndexedBlock: null` beside `isIndexed: true`.
//
// These tests drive the real service factories through their public entry
// points and capture the row handed to drizzle, so they assert what is
// actually persisted, not what a helper would return.

import { describe, it, expect, vi } from 'vitest';
import { createTransactionService } from '@/services/TransactionService';
import { createBlockService } from '@/services/BlockService';
import { formatTransactionForApi } from '@/utils/serialization';
import type { Transaction } from 'viem';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAny = (value: unknown): any => value;

const CHAIN_ID = 1;
const HASH = '0xfeed0000000000000000000000000000000000000000000000000000000000ff';

const genesisTx = {
  hash: HASH,
  blockNumber: 0n,
  transactionIndex: 0,
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: 0n,
  gas: 21_000n,
  nonce: 0,
  type: 'eip1559',
  input: '0x',
} as unknown as Transaction;

/**
 * Fake drizzle that captures inserted rows and serves them back on the
 * read-after-write, so the real formatter runs on what was persisted.
 */
const makeTransactionService = (client: unknown) => {
  const inserted: Array<Record<string, unknown>> = [];
  // Every chainable link returns the SAME node, so the terminal await
  // resolves the rows captured when the builder started. (Binding the
  // methods straight to the factory would feed each link's own argument —
  // `.limit(1)` -> rows = 1 — into the row slot.)
  const chain = (rows: unknown[]): unknown => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
      node[method] = () => node;
    }
    node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return node;
  };
  return {
    inserted,
    service: createTransactionService({
      db: {
        // Selects with a field list are the count queries; plain ones read rows.
        select: (...args: unknown[]) => {
          const withFields = args.length > 0;
          return chain(
            withFields
              ? [{ count: inserted.length, value: inserted.length }]
              : inserted.map(row => ({ chainId: CHAIN_ID, ...row })),
          );
        },
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            inserted.push(values);
            return { onConflictDoUpdate: async () => undefined };
          },
        }),
      } as never,
      transactions: asAny({}),
      blocks: asAny({}),
      rpcManager: asAny({ getClient: async () => client }),
    }),
  };
};

const genesisClient = (tx: unknown, receiptValue: unknown) => ({
  getTransaction: vi.fn().mockResolvedValue(tx),
  getTransactionReceipt: vi.fn().mockResolvedValue(receiptValue),
});

describe('indexing a genesis transaction', () => {
  it('stores blockNumber 0 rather than NULL, and serves it in the API payload', async () => {
    const { service, inserted } = makeTransactionService(genesisClient(genesisTx, null));

    const stored = await service.getTransactionByHash(CHAIN_ID, HASH);

    expect(inserted).toHaveLength(1);
    // null here is indistinguishable from "the indexer did not know".
    expect(inserted[0].blockNumber).toBe(0n);
    const payload = formatTransactionForApi(stored);
    expect(payload?.blockNumber).toBe('0');
  });

  it('stores nonce 0 (the first transaction of every account) rather than NULL', async () => {
    const { service, inserted } = makeTransactionService(genesisClient(genesisTx, null));

    const stored = await service.getTransactionByHash(CHAIN_ID, HASH);

    expect(inserted[0].nonce).toBe(0n);
    const payload = formatTransactionForApi(stored);
    expect(payload?.nonce).toBe('0');
  });

  it('still records a genuinely unknown block position as null', async () => {
    const pending = { ...genesisTx, blockNumber: null, nonce: 5 } as unknown as Transaction;
    const { service, inserted } = makeTransactionService(genesisClient(pending, null));

    await service.getTransactionByHash(CHAIN_ID, HASH);

    expect(inserted[0].blockNumber).toBeNull();
    expect(inserted[0].nonce).toBe(5n);
  });
});

describe('block statistics for a chain whose only indexed block is genesis', () => {
  it('reports latestBlock 0 rather than null', async () => {
    const genesisRow = {
      chainId: CHAIN_ID,
      number: 0n,
      hash: '0xgenesis',
      gasLimit: 30_000_000n,
      gasUsed: 0n,
      transactionCount: 0,
      sizeBytes: 540,
      timestamp: 1_700_000_000,
      indexedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    // getBlockStats runs count(*), the latest-block probe, then the recent
    // window; only the probe has a genesis row to find.
    let selectCount = 0;
    const chain = (rows: unknown[]): unknown => {
      const node: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
        node[method] = () => node;
      }
      node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject);
      return node;
    };
    const service = createBlockService({
      db: {
        select: () => {
          selectCount += 1;
          // 1 = count(*), 2 = latest-block probe, 3 = the recent window.
          if (selectCount === 1) return chain([{ value: 1 }]);
          return chain([genesisRow]);
        },
      } as never,
      blocks: asAny({}),
      rpcManager: asAny({}),
      blockCache: { get: () => undefined, set: () => undefined },
      createRetryableRpcCall: ((fn: unknown) => fn) as never,
      createRetryableDbCall: ((fn: unknown) => fn) as never,
      logError: () => undefined,
    } as never);

    const stats = await service.getBlockStats(CHAIN_ID);

    expect(stats.totalBlocks).toBe(1);
    // Genesis is a real position: null here contradicts totalBlocks.
    expect(stats.latestBlock).toBe(0n);
  });
});
