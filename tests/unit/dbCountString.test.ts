// DuckDB `count(*)` arrives as a STRING through the custom adapter.
// Verified against the real adapter, not by reading types:
//   `sql<number>`count(*)`` → "3"   (the BIGINT cell is stringified)
//   drizzle's own `count()` helper → 3 (a real number)
// Three TransactionService sites declared `total: number` yet returned that
// string verbatim, so:
//   - the transactions API served `total: "3"` where the contract (and the
//     OpenAPI spec) say integer, and
//   - /api/stats/overview's `reduce((sum, ch) => sum + ch.indexedTransactions, 0)`
//     STRING-CONCATENATED the cross-chain totals (`0 + "3"` → `"03"`).
// The services are driven through their factory with a scripted fake drizzle
// client, so the count returns exactly the shape the adapter produces.
import { describe, it, expect } from 'vitest';
import { createTransactionService } from '@/services/TransactionService';

// One awaited select() consumes the next scripted result set (each service
// call issues its queries sequentially).
const scriptedDb = (results: unknown[][]) => {
  let cursor = 0;
  const chain = (): unknown => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
      node[method] = chain;
    }
    node.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(results[cursor++] ?? []).then(resolve);
    return node;
  };
  return { select: () => chain() };
};

const ADDRESS = '0x1111111111111111111111111111111111111111';
const COUNT_AS_STRING = '3';

const makeService = (results: unknown[][]) =>
  createTransactionService({
    db: scriptedDb(results) as never,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transactions: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpcManager: {} as any,
  });

describe('DuckDB count(*) strings are normalized to numbers', () => {
  it('getTransactionsByBlockNumber returns a numeric total', async () => {
    const service = makeService([[{ hash: '0xdead' }], [{ count: COUNT_AS_STRING }]]);

    const { total } = await service.getTransactionsByBlockNumber(1, 1n);

    expect(total).toBe(3);
    // The class's visible failure: arithmetic on the string concatenates.
    expect(total + 1).toBe(4);
  });

  it('getTransactionsByAddress returns a numeric total', async () => {
    const service = makeService([[{ hash: '0xdead' }], [{ count: COUNT_AS_STRING }]]);

    const { total } = await service.getTransactionsByAddress(1, ADDRESS);

    expect(total).toBe(3);
    expect(total + 1).toBe(4);
  });

  it('getTransactionStats returns a numeric totalTransactions (the /stats/overview input)', async () => {
    const service = makeService([[{ count: COUNT_AS_STRING }], []]);

    const stats = await service.getTransactionStats(1);

    expect(stats).toEqual({
      totalTransactions: 3,
      avgGasPrice: null,
      avgGasUsed: null,
      successRate: 0,
    });
  });

  it('an absent count row still reads as the number 0', async () => {
    const service = makeService([[]]);

    const stats = await service.getTransactionStats(1);

    expect(stats.totalTransactions).toBe(0);
  });
});
