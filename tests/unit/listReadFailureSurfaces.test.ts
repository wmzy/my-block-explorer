// A list READ that could not be completed must not be answered as an empty
// success.
//
// The class was already pinned for /api/stats/overview (a failed database
// read answered `503 stats_unavailable` instead of zeros) and for the
// events GET (a failure answers 500, not an empty page), but the two list
// services still swallowed the same failure:
//
//   BlockService.getBlocks          → { blocks: [], total: 0 }
//   TransactionService.getLatestTransactions
//   TransactionService.getTransactionsByBlockNumber
//   TransactionService.getTransactionsByAddress
//
// Both routes that call them (routes/blocks.ts, routes/transactions.ts)
// carry a try/catch answering 500 — unreachable, because the service
// already turned the failure into a plausible empty page. A database
// outage therefore rendered as "this chain has no indexed blocks" with no
// retry affordance, which is the one thing the frontend cannot tell apart
// from a genuinely empty index.
//
// The other side is pinned too: a genuinely empty table is an ANSWER
// (empty list, total 0), not an error.
import { describe, it, expect, vi } from 'vitest';

import { createBlockService } from '@/services/BlockService';
import { createTransactionService } from '@/services/TransactionService';

const dbReadFailure = () =>
  new Error('Failed query: Catalog Error: Table with address does not exist');

/** A chainable drizzle double whose SELECT is broken (or empty). */
const chainable = (rows: unknown[]) => {
  const node: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
    node[method] = () => node;
  }
  node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return node;
};

const makeBlockService = (select: () => unknown) =>
  createBlockService({
    db: { select } as never,
    blocks: {} as never,
    rpcManager: { getClient: vi.fn() } as never,
    blockCache: { get: () => undefined, set: () => undefined } as never,
    createRetryableRpcCall: ((fn: unknown) => fn) as never,
    createRetryableDbCall: ((fn: unknown) => fn) as never,
    logError: vi.fn(),
  } as never);

const makeTransactionService = (select: () => unknown) =>
  createTransactionService({
    db: { select } as never,
    transactions: {} as never,
    blocks: {} as never,
    rpcManager: { getClient: vi.fn() } as never,
  });

describe('a failed list read is not an empty list', () => {
  it('BlockService.getBlocks rejects instead of answering an empty page', async () => {
    const service = makeBlockService(() => {
      throw dbReadFailure();
    });

    await expect(service.getBlocks(1, 20, 0)).rejects.toThrow(/Failed query/);
  });

  it('BlockService.getBlocks still answers an empty page for an empty table', async () => {
    const service = makeBlockService(() => chainable([]));

    await expect(service.getBlocks(1, 20, 0)).resolves.toEqual({ blocks: [], total: 0 });
  });

  it('TransactionService.getLatestTransactions rejects instead of an empty page', async () => {
    const service = makeTransactionService(() => {
      throw dbReadFailure();
    });

    await expect(service.getLatestTransactions(1, 20, 0)).rejects.toThrow(/Failed query/);
  });

  it('TransactionService.getLatestTransactions still answers an empty page for an empty table', async () => {
    const service = makeTransactionService(() => chainable([]));

    await expect(service.getLatestTransactions(1, 20, 0)).resolves.toEqual({
      transactions: [],
      total: 0,
    });
  });

  it('TransactionService.getTransactionsByBlockNumber rejects on a failed read', async () => {
    const service = makeTransactionService(() => {
      throw dbReadFailure();
    });

    await expect(service.getTransactionsByBlockNumber(1, 42n, 20, 0)).rejects.toThrow(
      /Failed query/,
    );
  });

  it('TransactionService.getTransactionsByAddress rejects on a failed read', async () => {
    const service = makeTransactionService(() => {
      throw dbReadFailure();
    });

    await expect(
      service.getTransactionsByAddress(1, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 20, 0),
    ).rejects.toThrow(/Failed query/);
  });
});
