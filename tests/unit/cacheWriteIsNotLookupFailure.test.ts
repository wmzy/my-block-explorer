// A read path that already HOLDS the answer must not report it as a FAILED
// or ABSENT lookup because the cache/index WRITE failed.
//
// The class shows up in two services, in the two flavors of the same
// mistake:
//
//  - services/BlockService.indexBlock persists the block it just read from
//    the RPC, and getBlockByNumber/getBlockByHash answer `null` for ANY
//    throw. A failed INSERT therefore reached routes/blocks.ts as `null`,
//    which renders 404 "Block not found" for a block that exists and whose
//    header was in hand.
//  - services/ContractSourceService.getContractSource awaited
//    saveToDatabase (the upsert of the source it just fetched from
//    Sourcify/Blockscan) inside the same try whose catch rethrows, so a
//    failed cache write discarded a verified answer and the route answered
//    500 'Failed to get contract source'.
//
// Both break the rule the sibling writers already follow — a cache write is
// an optimization
// (StorageLayoutService.saveToDatabase/cacheNotFound, ContractSourceService
// .saveProxyInfo/cacheCreationInfo/cacheFailedSearch all log and continue),
// so a failure degrades to a re-fetch and never changes the answer the
// request already earned.
//
// The other side of the boundary is pinned here too: the explicit WRITE
// APIs (saveManualVerification/saveLocalCompileVerification) must keep
// reporting a failed write — there the row IS the requested result — and a
// failed READ still rejects, because only `null` means "no deployed code".
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetClient = vi.hoisted(() => vi.fn());
vi.mock('@/services/RpcManager', () => ({ rpcManager: { getClient: mockGetClient } }));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return { ...actual, db: mockDb };
});

import { ContractSourceService } from '@/services/ContractSourceService';
import { createBlockService } from '@/services/BlockService';
import { createTransactionService } from '@/services/TransactionService';
import type { Address } from 'viem';

const CHAIN_ID = 1;
const CONTRACT = '0xabc0000000000000000000000000000000000001' as Address;
const IMPL = '0x1111111111111111111111111111111111111111' as Address;

/** DuckDB failure — a locked store, a bad migration, a column conversion. */
const dbFailure = () => new Error('Failed query: Catalog Error: Table with address does not exist');

// ---------------------------------------------------------------------------
// BlockService: the index write is a cache write
// ---------------------------------------------------------------------------

const BLOCK_NUMBER = 42n;
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const BLOCK_TIMESTAMP = 1_750_000_000n;

const chainBlock = {
  number: BLOCK_NUMBER,
  hash: BLOCK_HASH,
  parentHash: `0x${'cd'.repeat(32)}`,
  timestamp: BLOCK_TIMESTAMP,
  gasLimit: 30_000_000n,
  gasUsed: 21_000n,
  baseFeePerGas: 1n,
  transactions: [],
};

/** Fake drizzle that serves back what was inserted; the INSERT can be broken. */
const makeBlockService = (insertFails: boolean) => {
  const inserted: Array<Record<string, unknown>> = [];
  const chain = (rows: unknown[]): unknown => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
      node[method] = () => node;
    }
    node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return node;
  };
  return createBlockService({
    db: {
      select: () => chain(inserted),
      insert: () => {
        if (insertFails) throw dbFailure();
        return {
          values: (values: Record<string, unknown>) => {
            inserted.push(values);
            return { onConflictDoUpdate: async () => undefined };
          },
        };
      },
    } as never,
    blocks: { chainId: 0, number: 0, hash: 0, timestamp: 0, gasUsed: 0 } as never,
    rpcManager: {
      getClient: async () => ({ getBlock: async () => chainBlock }),
    } as never,
    blockCache: { get: () => undefined, set: () => undefined } as never,
    createRetryableRpcCall: ((fn: unknown) => fn) as never,
    createRetryableDbCall: ((fn: unknown) => fn) as never,
    logError: vi.fn(),
  } as never);
};

describe('BlockService — the index write is a cache write, not the lookup', () => {
  it('serves the RPC block when the index insert fails', async () => {
    const service = makeBlockService(true);

    const block = await service.getBlockByNumber(CHAIN_ID, BLOCK_NUMBER);

    expect(block).not.toBeNull();
    expect(block?.number).toBe(BLOCK_NUMBER);
    expect(block?.hash).toBe(BLOCK_HASH);
    // The timestamp still goes through the seconds contract: a Date, not
    // January 1970 and not a raw number.
    expect(block?.timestamp?.getTime()).toBe(Number(BLOCK_TIMESTAMP) * 1000);
  });

  it('serves the RPC block by hash when the index insert fails', async () => {
    const service = makeBlockService(true);

    const block = await service.getBlockByHash(CHAIN_ID, BLOCK_HASH);

    expect(block?.number).toBe(BLOCK_NUMBER);
    expect(block?.hash).toBe(BLOCK_HASH);
  });

  it('is byte-identical when the write succeeds (the row is still preferred)', async () => {
    const service = makeBlockService(false);

    const block = await service.getBlockByNumber(CHAIN_ID, BLOCK_NUMBER);

    expect(block?.number).toBe(BLOCK_NUMBER);
    expect(block?.transactionCount).toBe(0);
  });

  it('serves the latest RPC block when the index insert fails', async () => {
    const service = makeBlockService(true);

    const block = await service.getLatestBlock(CHAIN_ID);

    expect(block?.number).toBe(BLOCK_NUMBER);
    expect(block?.hash).toBe(BLOCK_HASH);
  });
});

// ---------------------------------------------------------------------------
// TransactionService: the row upsert is a cache write on the tx-by-hash path
// ---------------------------------------------------------------------------

const TX_HASH: `0x${string}` = `0x${'11'.repeat(32)}`;
const TX_BLOCK_TIMESTAMP = 1_700_000_000;

const minedTx = {
  hash: TX_HASH,
  blockNumber: 42n,
  transactionIndex: 7,
  from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  value: 1_000n,
  gas: 21_000n,
  gasPrice: 5n,
  nonce: 0n,
  input: '0x',
  type: 'legacy',
};

const minedReceipt = {
  status: 'success' as const,
  blockNumber: 42n,
  gasUsed: 21_000n,
  effectiveGasPrice: 5n,
  cumulativeGasUsed: 21_000n,
  contractAddress: null,
  logs: [{ logIndex: 0 }, { logIndex: 1 }, { logIndex: 2 }],
};

/**
 * The service's SELECTs in order: the stored-row lookup (empty = cache
 * miss), the block-timestamp lookup, then the post-insert re-read. The
 * INSERT is what each case breaks.
 */
const makeTransactionService = (insertFails: boolean) => {
  let selects = 0;
  const inserted: Array<Record<string, unknown>> = [];
  const chainable = (rows: unknown[]) => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
      node[method] = () => node;
    }
    node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return node;
  };
  return createTransactionService({
    db: {
      select: () => {
        const call = selects++;
        // 0: stored-row lookup (empty = cache miss) — 1: block timestamp —
        // 2+: the post-insert re-read, answered with the recorded row.
        if (call === 0) return chainable([]);
        return chainable(inserted.length > 0 ? [...inserted] : [{ timestamp: TX_BLOCK_TIMESTAMP }]);
      },
      insert: () => {
        if (insertFails) throw dbFailure();
        return {
          values: (row: Record<string, unknown>) => {
            inserted.push(row);
            return { onConflictDoUpdate: () => chainable([]) };
          },
        };
      },
    } as never,
    transactions: {} as never,
    blocks: {} as never,
    rpcManager: {
      getClient: async () => ({
        getTransaction: async () => minedTx,
        getTransactionReceipt: async () => minedReceipt,
        getBlock: async () => ({ timestamp: BigInt(TX_BLOCK_TIMESTAMP) }),
      }),
    } as never,
  });
};

describe('TransactionService — the row upsert is a cache write, not the lookup', () => {
  it('serves the fetched transaction when the row upsert fails', async () => {
    const service = makeTransactionService(true);

    const tx = await service.getTransactionByHash(CHAIN_ID, TX_HASH);

    // The receipt was read and the hash resolved: the transaction exists,
    // so a failed index write must not surface as a failed lookup (500).
    expect(tx?.hash).toBe(TX_HASH);
    expect(tx?.status).toBe(1);
    expect(tx?.logsCount).toBe(3);
    expect(tx?.timestamp?.getTime()).toBe(TX_BLOCK_TIMESTAMP * 1000);
  });

  it('is byte-identical when the write succeeds', async () => {
    const service = makeTransactionService(false);

    const tx = await service.getTransactionByHash(CHAIN_ID, TX_HASH);

    expect(tx?.hash).toBe(TX_HASH);
    expect(tx?.status).toBe(1);
    expect(tx?.nonce).toBe(0n);
  });

  it('still reports a transaction that does not exist', async () => {
    const service = createTransactionService({
      db: {
        select: () => {
          const node: Record<string, unknown> = {};
          for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
            node[method] = () => node;
          }
          node.then = (resolve: (value: unknown) => unknown, reject?: (r: unknown) => unknown) =>
            Promise.resolve([]).then(resolve, reject);
          return node;
        },
        insert: () => {
          throw new Error('insert must not be called on the not-found path');
        },
      } as never,
      transactions: {} as never,
      blocks: {} as never,
      rpcManager: {
        getClient: async () => ({
          getTransaction: async () => {
            throw new Error('Transaction with hash ... could not be found');
          },
          getTransactionReceipt: async () => ({}),
          getBlock: async () => ({}),
        }),
      } as never,
    });

    // Only the not-found answer maps to the route's 404; a failed cache
    // write never may.
    await expect(service.getTransactionByHash(CHAIN_ID, TX_HASH)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ContractSourceService: the source upsert is a cache write on the GET path
// ---------------------------------------------------------------------------

const sourcifyHit = (proxyResolution?: Record<string, unknown>) =>
  new Response(
    JSON.stringify({
      match: 'match',
      abi: [{ type: 'function', name: 'transfer', inputs: [], outputs: [] }],
      compilation: { name: 'X', compilerVersion: 'v0.8.20' },
      sources: {},
      ...(proxyResolution ? { proxyResolution } : {}),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const blockscanMiss = () => new Response('{}', { status: 404 });

const service = new ContractSourceService();

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClient.mockResolvedValue({
    getCode: vi.fn(async () => '0x6080'),
    getStorageAt: vi.fn(async () => `0x${'0'.repeat(64)}`),
    readContract: vi.fn(async () => {
      throw new Error('execution reverted');
    }),
  });
  mockDb.delete.mockReturnValue({ where: () => Promise.resolve() });
  mockDb.update.mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
  // Cache miss: every source read goes to the verifiers, which is the path
  // whose write these cases break.
  mockDb.select.mockImplementation(() => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
      node[method] = () => node;
    }
    node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject);
    return node;
  });
  mockDb.insert.mockReturnValue({
    values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
  });
});

describe('ContractSourceService — a failed cache write is not a failed lookup', () => {
  it('serves the Sourcify source when the source upsert fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).includes('sourcify.dev')
          ? // Only the contract itself is a proxy; its implementation is an
        // ordinary verified contract (a self-referencing implementation
        // payload would recurse forever).
          String(url).toLowerCase().includes(IMPL.toLowerCase())
            ? sourcifyHit()
            : sourcifyHit({
                isProxy: true,
                proxyType: 'EIP1967Proxy',
                implementations: [{ address: IMPL }],
              })
          : blockscanMiss(),
      ),
    );
    mockDb.insert.mockImplementation(() => {
      throw dbFailure();
    });

    const result = await service.getContractSource(CHAIN_ID, CONTRACT);

    // The answer came from the verifier; the failed row write cannot change
    // it, and the next request simply re-fetches.
    expect(result?.verificationStatus).toBe('verified');
    expect(result?.abi).toContain('transfer');
  });

  it('serves an unverified-but-real contract when its cache row cannot be written', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => blockscanMiss()));
    mockDb.insert.mockImplementation(() => {
      throw dbFailure();
    });

    const result = await service.getContractSource(CHAIN_ID, CONTRACT);

    // Both verifiers missed and the address HAS code: "unverified" is the
    // honest answer even though the row could not be persisted.
    expect(result?.verificationStatus).toBe('unverified');
  });

  it('still reports an explicit user write that did not land', async () => {
    mockDb.insert.mockImplementation(() => {
      throw dbFailure();
    });

    // saveManualVerification's row IS the requested result: telling the user
    // "saved" while nothing was stored would be the opposite laundering.
    await expect(
      service.saveManualVerification(CHAIN_ID, CONTRACT, { abi: '[]' }),
    ).rejects.toThrow();
  });

  it('still reports a failed READ, which no cache write can fix', async () => {
    mockDb.select.mockImplementation(() => {
      throw dbFailure();
    });

    // Only `null` means "no deployed code" (404 not_a_contract): a read that
    // could not be completed must reject.
    await expect(service.getContractSource(CHAIN_ID, CONTRACT)).rejects.toThrow();
  });
});
