// A contract lookup that FAILED was answered as a factual verdict.
//
// Since the 2026-09-20 fix, `getContractSource()` returning null means
// exactly one thing: the address has no deployed code, and the routes
// turn that into 404 `not_a_contract` so the frontend can render "This
// address is not a contract" (routes/contracts.ts documents that contract
// in three places). But the service's own outer catch ALSO returned null
// for every internal failure — a DuckDB read error, a serialization
// throw, a failed cache write — so an outage in those steps was reported
// to the user as an EOA verdict on a real contract, with the true cause
// visible only in the log. The method is careful everywhere else (it even
// keeps the unverified fallback when the on-chain code check itself fails,
// precisely so a flaky node never hard-404s a real contract) — the outer
// catch is the one place that rule was broken.
//
// The two siblings are the same defect on the other two surfaces: an
// unreadable contract's parsed function list came back as an empty list
// ("this contract has no functions") and an unreadable contract directory
// came back as all-zero stats ("0 contracts on this chain"). Empty and
// zero are the values those endpoints report for a contract that really
// has none, so the two are indistinguishable.
//
// Driven through the real service against a mocked db/rpc, so the
// assertions read the values the API would then serialize.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetClient = vi.hoisted(() => vi.fn());
vi.mock('@/services/RpcManager', () => ({ rpcManager: { getClient: mockGetClient } }));

// Partial mock: the real schema exports stay intact so drizzle operators
// receive real columns; only the db client is faked (the convention from
// tests/unit/contractSourceService.test.ts).
const mockDb = vi.hoisted(() => ({
  query: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return { ...actual, db: mockDb };
});

import { ContractSourceService } from '@/services/ContractSourceService';
import type { Address } from 'viem';

const CHAIN_ID = 1;
const CONTRACT = '0xabc0000000000000000000000000000000000001' as Address;

const service = new ContractSourceService();

/** DuckDB failure — the shape a locked/broken store or a bad migration throws. */
const dbFailure = () => new Error('Failed query: Catalog Error: Table with address does not exist');

/** An unverified record as the DB would hand it back. */
const unverifiedRow = (): Record<string, unknown> => ({
  chainId: CHAIN_ID,
  address: CONTRACT,
  sourceCode: '',
  sourceFiles: null,
  abi: '[]',
  contractName: null,
  compilerVersion: null,
  optimizationUsed: null,
  isVerified: false,
  isProxy: false,
  proxyType: null,
  implementationAddress: null,
  verificationSource: 'unknown',
  lastChecked: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  compilerSettings: null,
});

const selectRows = (rows: unknown[] | (() => never)) => {
  mockDb.select.mockImplementation(() => {
    if (typeof rows === 'function') rows();
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) node[method] = () => node;
    node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(typeof rows === 'function' ? [] : rows).then(resolve, reject);
    return node;
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  mockGetClient.mockResolvedValue({ getCode: vi.fn(async () => '0x60'), getStorageAt: vi.fn() });
  mockDb.insert.mockReturnValue({ values: () => ({ onConflictDoUpdate: () => undefined }) });
  mockDb.delete.mockReturnValue({ where: () => Promise.resolve() });
});

describe('getContractSource — a failed lookup is not an EOA verdict', () => {
  it('still answers null (and only null) for an address without deployed code', async () => {
    selectRows([]);
    mockGetClient.mockResolvedValue({ getCode: vi.fn(async () => '0x'), getStorageAt: vi.fn() });

    // The documented meaning of null: routes turn it into 404
    // not_a_contract so the frontend can render the EOA card.
    await expect(service.getContractSource(CHAIN_ID, CONTRACT)).resolves.toBeNull();
  });

  it('reports a failed source read instead of answering "not a contract"', async () => {
    selectRows(() => {
      throw dbFailure();
    });

    // The bug: this used to resolve to null, i.e. the API answered
    // 404 not_a_contract for a contract whose source row simply could not
    // be read.
    await expect(service.getContractSource(CHAIN_ID, CONTRACT)).rejects.toThrow();
  });

  it('serves the fetched answer when only the cache write fails', async () => {
    selectRows([]);
    mockDb.insert.mockImplementation(() => {
      throw dbFailure();
    });

    // The cache write is an OPTIMIZATION: it may not turn an answer the
    // request already holds into a failure, and above all not into `null`
    // (the routes' 404 not_a_contract). This used to expect a rejection —
    // the exact 500 "Failed to get contract source" the write caused; the
    // read path now logs and serves (see cacheWriteIsNotLookupFailure).
    // The fetch stubs here make this contract a REAL contract, so the
    // answer is the unverified verdict, never null.
    const result = await service.getContractSource(CHAIN_ID, CONTRACT);

    expect(result).not.toBeNull();
    expect(result?.verificationStatus).toBe('unverified');
  });
});

describe('getContractFunctions — an unreadable ABI is not an empty contract', () => {
  it('parses the function list of a real contract', async () => {
    selectRows([
      unverifiedRow(),
    ]);

    const result = await service.getContractFunctions(CHAIN_ID, CONTRACT);

    // An unverified record has an empty ABI, so the honest answer for this
    // fixture is an empty list — which is exactly why the failure path
    // below must be distinguishable from it.
    expect(result.functions).toEqual([]);
  });

  it('reports a failed source read instead of answering "no functions"', async () => {
    selectRows(() => {
      throw dbFailure();
    });

    await expect(service.getContractFunctions(CHAIN_ID, CONTRACT)).rejects.toThrow();
  });

  it('reports unparseable stored ABI JSON instead of answering "no functions"', async () => {
    // The unparseable value is on the object getContractFunctions
    // JSON.parses, so the read succeeds and only the parse fails. Serving
    // it through the verified fast path keeps the fixture independent of
    // the EOA branch (which purges an unverified record).
    const broken = {
      ...unverifiedRow(),
      verificationStatus: 'verified',
      sourceCode: 'contract X {}',
      abi: '{not json',
    };
    const sourceSpy = vi.spyOn(service, 'getContractSource').mockResolvedValue(broken as never);

    await expect(service.getContractFunctions(CHAIN_ID, CONTRACT)).rejects.toThrow();

    sourceSpy.mockRestore();
  });
});

describe('getContractStats — an unreadable directory is not an empty chain', () => {
  it('reports a failed count instead of answering zero contracts', async () => {
    selectRows(() => {
      throw dbFailure();
    });

    await expect(service.getContractStats(CHAIN_ID)).rejects.toThrow();
  });

  it('still counts a readable directory', async () => {
    selectRows([
      { isVerified: true, count: '2' },
      { isVerified: false, count: '5' },
    ]);

    await expect(service.getContractStats(CHAIN_ID)).resolves.toEqual({
      total: 7,
      verified: 2,
      unverified: 5,
      partial: 0,
    });
  });
});
