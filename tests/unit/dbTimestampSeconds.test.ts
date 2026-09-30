// DB-served block/transaction timestamps are unix SECONDS (the `timestamp`
// customType in src/database/db-types.ts is TIMESTAMP_S with
// fromDriver: seconds). Both row formatters ran the raw seconds through
// `new Date(...)`, which treats a number as MILLIseconds — so every
// DB-served block and transaction reported January 1970 instead of its
// real block time (a ~56-year error), and formatBlockForApi happily
// serialized the bogus Date as an ISO string.
//
// Verified against a real adapter: `db.select().from(blocks)` yields
// camelCase keys and `timestamp` as a plain number of seconds.
//
// The services are exercised through their factories with a faked drizzle
// client, so the formatter runs on exactly the shape the DB produces.
import { describe, it, expect } from 'vitest';
import { createBlockService } from '@/services/BlockService';
import { createTransactionService } from '@/services/TransactionService';
import { formatBlockForApi, formatTransactionForApi } from '@/utils/serialization';

// 2025-10-01T13:20:23Z — a seconds value no ms/s confusion can fake.
const SECONDS = 1759324823;
const ISO = '2025-10-01T13:20:23.000Z';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (extra: Record<string, unknown>): any => ({
  chainId: 1,
  number: 23_500_000n,
  hash: '0xabc',
  gasLimit: 36_000_000n,
  gasUsed: 12_345_678n,
  transactionCount: 180,
  sizeBytes: 4096,
  timestamp: SECONDS,
  indexedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...extra,
});

// Minimal fake of the drizzle chain both services drive:
// select()…from().where().orderBy().limit().offset() — every link returns
// the same awaitable node, which resolves to the seeded rows. Count
// queries are indistinguishable in this fake and resolve to the same rows;
// the assertions only read the formatted rows.
const fakeDb = (rows: unknown[]) => {
  const chain = (): unknown => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
      node[method] = chain;
    }
    node.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return node;
  };
  return { select: () => chain() };
};

const makeBlockService = (rows: unknown[]) =>
  createBlockService({
    db: {
      ...fakeDb(rows),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: async () => undefined,
          onConflictDoNothing: async () => undefined,
        }),
      }),
    } as never,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpcManager: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blockCache: { get: () => undefined, set: () => undefined } as any,
    createRetryableRpcCall: ((fn: unknown) => fn) as never,
    createRetryableDbCall: ((fn: unknown) => fn) as never,

    logError: () => undefined,
  });

const makeTransactionService = (rows: unknown[]) =>
  createTransactionService({
    db: fakeDb(rows) as never,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transactions: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpcManager: {} as any,
  });

describe('DB timestamps are unix seconds, not milliseconds', () => {
  it('formatBlock turns the stored seconds into the real block time', async () => {
    const service = makeBlockService([row({})]);

    const block = await service.getBlockByNumber(1, 23_500_000n);

    expect(block?.timestamp?.toISOString()).toBe(ISO);
  });

  it('getBlocks (list endpoint) keeps the same real timestamp', async () => {
    const service = makeBlockService([row({})]);

    const { blocks: rows } = await service.getBlocks(1, 10, 0);

    expect(rows[0].timestamp?.toISOString()).toBe(ISO);
  });

  it('formatTransaction turns the stored seconds into the real block time', async () => {
    const service = makeTransactionService([
      row({ hash: '0xdead', blockNumber: 23_500_000n, transactionIndex: 0, value: '5' }),
    ]);

    const { transactions } = await service.getTransactionsByBlockNumber(1, 23_500_000n);

    expect(transactions[0].timestamp?.toISOString()).toBe(ISO);
  });

  it('the API payload carries the real ISO timestamp, not 1970', async () => {
    const service = makeBlockService([row({})]);
    const block = await service.getBlockByNumber(1, 23_500_000n);

    const payload = formatBlockForApi(block);

    expect(payload?.timestamp).toBe(ISO);
  });

  it('the transaction API payload carries the real ISO timestamp', async () => {
    const service = makeTransactionService([
      row({ hash: '0xdead', blockNumber: 23_500_000n, transactionIndex: 0, value: '5' }),
    ]);
    const { transactions } = await service.getTransactionsByBlockNumber(1, 23_500_000n);

    const payload = formatTransactionForApi(transactions[0]);

    expect(payload?.timestamp).toBe(ISO);
  });

  it('indexedAt survives the row round-trip as a Date', async () => {
    const service = makeBlockService([row({})]);

    const block = await service.getBlockByNumber(1, 23_500_000n);

    expect(block?.indexedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('drizzle returns camelCase rows, and every field survives the round-trip', async () => {
    // The formatter used to read snake_case keys, which drizzle never
    // produces, so transaction lists served a bare hash + value with
    // blockNumber, gas fields, status, nonce and timestamp all dropped.
    const service = makeTransactionService([
      row({
        hash: '0xdead',
        blockNumber: 23_500_000n,
        transactionIndex: 4,
        fromAddress: '0x1111111111111111111111111111111111111111',
        toAddress: '0x2222222222222222222222222222222222222222',
        value: 1234567890123456789n,
        gasLimit: 21_000n,
        gasPrice: 1_000_000_007n,
        gasUsed: 20_000n,
        effectiveGasPrice: 999_999_999n,
        status: 1,
        type: 2,
        nonce: 7n,
        inputData: '0xdeadbeef',
        contractAddress: '0x3333333333333333333333333333333333333333',
      }),
    ]);

    const { transactions } = await service.getTransactionsByBlockNumber(1, 23_500_000n);
    const [tx] = transactions;

    expect(tx.chainId).toBe(1);
    expect(tx.blockNumber).toBe(23_500_000n);
    expect(tx.transactionIndex).toBe(4);
    expect(tx.fromAddress).toBe('0x1111111111111111111111111111111111111111');
    expect(tx.toAddress).toBe('0x2222222222222222222222222222222222222222');
    expect(tx.value).toBe('1234567890123456789');
    expect(tx.gasLimit).toBe(21_000n);
    expect(tx.gasPrice).toBe(1_000_000_007n);
    expect(tx.gasUsed).toBe(20_000n);
    expect(tx.effectiveGasPrice).toBe(999_999_999n);
    expect(tx.status).toBe(1);
    expect(tx.type).toBe(2);
    expect(tx.nonce).toBe(7n);
    expect(tx.inputData).toBe('0xdeadbeef');
    expect(tx.contractAddress).toBe('0x3333333333333333333333333333333333333333');
  });

  it('a bigint `value` column is stringified exactly, never flattened to 0', async () => {
    const service = makeTransactionService([
      row({ hash: '0xdead', blockNumber: 1n, transactionIndex: 0, value: 1n }),
    ]);

    const { transactions } = await service.getTransactionsByBlockNumber(1, 1n);

    expect(transactions[0].value).toBe('1');
  });
});
