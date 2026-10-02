// A FAILED receipt read was persisted as a set of FACTS and then served
// from the cache forever — the same class the RPC path already fixed
// (utils/rpcReadRetry.ts: retry an idempotent read once, never launder a
// surviving failure into a plausible value; utils/blockRpcData.readReceipt:
// viem's TransactionReceiptNotFoundError is DATA, every other failure is
// a transport failure). services/TransactionService.ts was the instance
// that stayed behind:
//
//   client.getTransactionReceipt({hash}).catch(() => null)
//
// fed that null straight into indexTransaction, so ONE dropped receipt
// wrote status = NULL (the column that means "no receipt yet"), logsCount
// = 0 and gasUsed = NULL, and getTransactionByHash short-circuits on any
// stored row — never refreshing it. The API then answered, for the rest of
// the process's life, "this transaction has 0 logs" / "no status" for a
// transaction that may have hundreds of logs, and /api/search relayed the
// same fabricated row as a hit.
//
// The distinction this pins, per read:
//   - receipt            → persisted, receipt fields are real
//   - not found yet      → DATA: nothing persisted (a pending tx has no
//                          receipt facts; a cached row could never learn
//                          them later either, so writing one would freeze
//                          "no receipt" as a permanent answer)
//   - transport failure  → NOT persisted, and the failure is reported
//                          (the route's 500), never answered 200/404
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTransactionService } from '@/services/TransactionService';

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const HASH: `0x${string}` = `0x${'11'.repeat(32)}`;
const BLOCK_TIMESTAMP = 1_700_000_000;

type RpcTx = Record<string, unknown>;

/** A mined transaction as viem hands it over. */
const minedTx = (): RpcTx => ({
  hash: HASH,
  blockNumber: 42n,
  transactionIndex: 7,
  from: ADDRESS,
  to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  value: 1_000n,
  gas: 21_000n,
  gasPrice: 5n,
  nonce: 0n,
  input: '0x',
  type: 'legacy',
});

const receipt = (logs = 3) => ({
  status: 'success' as const,
  blockNumber: 42n,
  gasUsed: 21_000n,
  effectiveGasPrice: 5n,
  cumulativeGasUsed: 21_000n,
  contractAddress: null,
  logs: Array.from({ length: logs }, (_, i) => ({ logIndex: i })),
});

type Harness = {
  service: ReturnType<typeof createTransactionService>;
  inserted: Array<Record<string, unknown>>;
  setReceipt: (impl: () => Promise<unknown>) => void;
};

/**
 * A minimal drizzle double. The SELECTs the service makes, in order, are
 * the stored-row lookup (call 0 — an empty answer is the cache miss that
 * sends us to RPC), the block-timestamp lookup and the post-insert
 * re-read; the re-read is answered with the row the test recorded.
 */
const harness = (): Harness => {
  const inserted: Array<Record<string, unknown>> = [];
  let selects = 0;

  const chainable = (rows: unknown[]) => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
      node[method] = () => node;
    }
    node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return node;
  };

  const db = {
    select: () => {
      const call = selects++;
      if (call === 0) return chainable([]);
      return chainable(inserted.length > 0 ? [...inserted] : [{ timestamp: BLOCK_TIMESTAMP }]);
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          onConflictDoUpdate: () => chainable([]),
        };
      },
    }),
  };

  const getTransactionReceipt = vi.fn(async () => receipt());

  const service = createTransactionService({
    db: db as never,
    transactions: {} as never,
    blocks: {} as never,
    rpcManager: {
      getClient: vi.fn(async () => ({
        getTransaction: vi.fn(async () => minedTx()),
        getTransactionReceipt,
        getBlock: vi.fn(async () => ({ timestamp: BigInt(BLOCK_TIMESTAMP) })),
        getBlockByNumber: vi.fn(async () => ({ timestamp: BigInt(BLOCK_TIMESTAMP) })),
      })),
    } as never,
  });

  return {
    service,
    inserted,
    setReceipt: impl => {
      getTransactionReceipt.mockImplementation(impl as never);
    },
  };
};

const transportFailure = () => new Error('fetch failed: ECONNRESET');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('TransactionService — a receipt that could not be read is never stored as a fact', () => {
  it('retries a dropped receipt read once and stores the real receipt', async () => {
    const { service, inserted, setReceipt } = harness();
    let attempts = 0;
    setReceipt(async () => {
      attempts += 1;
      if (attempts === 1) throw transportFailure();
      return receipt(5);
    });

    const result = await service.getTransactionByHash(CHAIN_ID, HASH);

    expect(attempts).toBe(2);
    expect(result?.status).toBe(1);
    expect(result?.logsCount).toBe(5);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.logsCount).toBe(5);
  });

  it('does not persist a row when the receipt read fails after the retry', async () => {
    const { service, inserted, setReceipt } = harness();
    setReceipt(async () => {
      throw transportFailure();
    });

    await expect(service.getTransactionByHash(CHAIN_ID, HASH)).rejects.toThrow();

    // The whole point: nothing was written. A persisted row here is served
    // verbatim by every later read of this hash.
    expect(inserted).toHaveLength(0);
  });

  it('reports the receipt failure instead of answering "not found"', async () => {
    const { service, setReceipt } = harness();
    setReceipt(async () => {
      throw transportFailure();
    });

    // 404 'Transaction not found' is the route's answer for a null service
    // result — indistinguishable from "this hash does not exist".
    await expect(service.getTransactionByHash(CHAIN_ID, HASH)).rejects.toThrow();
  });

  it('treats a not-yet-mined transaction as data and stores no receipt facts', async () => {
    const { service, inserted, setReceipt } = harness();
    setReceipt(async () => {
      const error = new Error('Transaction receipt could not be found.');
      error.name = 'TransactionReceiptNotFoundError';
      throw error;
    });

    const result = await service.getTransactionByHash(CHAIN_ID, HASH);

    // A pending transaction is a real answer…
    expect(result?.hash).toBe(HASH);
    expect(result?.status).toBeUndefined();
    expect(result?.logsCount).toBeUndefined();
    // …but never a cached one: this row would short-circuit every later
    // read of the hash and keep answering "no receipt" after mining.
    expect(inserted).toHaveLength(0);
  });

  it('keeps the mined receipt facts addressable through the API formatter', async () => {
    const { service, setReceipt } = harness();
    setReceipt(async () => receipt(2));

    const result = await service.getTransactionByHash(CHAIN_ID, HASH);

    expect(result?.blockNumber).toBe(42n);
    expect(result?.nonce).toBe(0n);
    expect(result?.gasUsed).toBe(21_000n);
    expect(result?.timestamp).toEqual(new Date(BLOCK_TIMESTAMP * 1000));
  });
});

describe('block indexing — one unreadable receipt never writes a half-row', () => {
  it('writes no row at all when the block’s receipt read keeps failing', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const chainable = (rows: unknown[]) => {
      const node: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
        node[method] = () => node;
      }
      node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject);
      return node;
    };
    let attempts = 0;

    // The cold block path: nothing stored, so the service indexes the
    // block first. The transaction IS in the block — only its receipt is
    // unreadable, and that must never become a stored "no logs" row.
    const cold = chainable([]);
    const coldDb = {
      select: () => cold,
      insert: () => {
        throw new Error('no row may be inserted for an unreadable receipt');
      },
    };
    const coldService = createTransactionService({
      db: coldDb as never,
      transactions: {} as never,
      blocks: {} as never,
      rpcManager: {
        getClient: vi.fn(async () => ({
          getBlock: vi.fn(async () => ({
            timestamp: BigInt(BLOCK_TIMESTAMP),
            transactions: [minedTx()],
          })),
          getTransactionReceipt: vi.fn(async () => {
            attempts += 1;
            throw transportFailure();
          }),
        })),
      } as never,
    });

    const page = await coldService.getTransactionsByBlockNumber(CHAIN_ID, 42n, 50, 0);

    expect(attempts).toBeGreaterThan(0);
    expect(page.transactions).toEqual([]);
    // Nothing was claimed about the transaction, and nothing was written.
    expect(inserted).toHaveLength(0);
  });

  it('reports the block’s transaction count, not the length of the page served', async () => {
    // The cold path indexed the block; a busy block has more transactions
    // than `limit`, and the count has to describe the whole block or
    // pagination hides everything after the first page.
    const storedRows = [
      { ...toStored(0), blockNumber: 42n, transactionIndex: 0 },
      { ...toStored(1), blockNumber: 42n, transactionIndex: 1 },
      { ...toStored(2), blockNumber: 42n, transactionIndex: 2 },
    ];
    const chainable = (rows: unknown[]) => {
      const node: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
        node[method] = () => node;
      }
      node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject);
      return node;
    };
    // Answered by SHAPE, not by call order, so the test pins the service's
    // contract rather than its internal sequence: a count query is one
    // that only groups; the first block query sees nothing stored, later
    // ones see the indexed rows.
    let countsServed = 0;
    let rowQueries = 0;
    let servedLimit = 50;
    const paginated = (rows: unknown[]) => {
      const node: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'groupBy']) node[method] = () => node;
      node.limit = (value: number) => {
        servedLimit = value;
        return node;
      };
      node.offset = (value: number) => {
        const start = value;
        node.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(rows.slice(start, start + servedLimit)).then(resolve, reject);
        return node;
      };
      node.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject);
      return node;
    };

    const service = createTransactionService({
      db: {
        select: (fields?: Record<string, unknown>) => {
          // drizzle's count query selects a single aliased column; the row
          // query selects whole rows.
          const isCount = fields !== undefined && Object.keys(fields).length === 1;
          if (isCount) {
            // The FIRST count is the pre-index one: the block looked empty.
            // Later counts must re-read, which is the whole point — the
            // old code returned the page length instead of re-reading.
            const preIndex = countsServed === 0;
            countsServed += 1;
            return chainable(preIndex ? [{ count: 0 }] : [{ count: 3 }]);
          }
          // The first ROW query is the cold one: nothing indexed yet, so
          // the service walks the block; the rows it re-reads afterwards
          // are all three.
          rowQueries += 1;
          return paginated(rowQueries === 1 ? [] : storedRows);
        },
        insert: () => ({ values: () => ({ onConflictDoUpdate: () => chainable([]) }) }),
      } as never,
      transactions: {} as never,
      blocks: {} as never,
      rpcManager: {
        getClient: vi.fn(async () => ({
          getBlock: vi.fn(async () => ({ timestamp: BigInt(BLOCK_TIMESTAMP), transactions: [] })),
          getTransactionReceipt: vi.fn(async () => receipt()),
        })),
      } as never,
    });

    const page = await service.getTransactionsByBlockNumber(CHAIN_ID, 42n, 2, 0);

    // Two served, three stored.
    expect(page.transactions).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});

const toStored = (index: number): Record<string, unknown> => ({
  chainId: CHAIN_ID,
  hash: `0x${index.toString(16).padStart(2, '0')}${'11'.repeat(31)}`,
  blockNumber: 42n,
  transactionIndex: index,
  fromAddress: ADDRESS,
  toAddress: ADDRESS,
  value: 0n,
  status: 1,
  type: 0,
  nonce: BigInt(index),
  inputData: '0x',
  logsCount: 0,
  timestamp: BLOCK_TIMESTAMP,
  indexedAt: BLOCK_TIMESTAMP,
});
