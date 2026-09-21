// Additive-merge contract of the global /api/search's localContracts
// field: free-text queries ALSO return this explorer's cached contract
// hits (at most 5, the directory's matching rule, chainId-scoped when
// ?chainId= is present — unscoped hits carry their own chainId), while
// every other query shape (hash, block number, ENS) keeps the exact
// pre-existing response with NO localContracts key and NO cache read at
// all. A failing cache read drops the field silently — the remote search
// result stands on its own. The three lookup services and the db layer
// are mocked; no network, no DuckDB.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  const state = {
    results: [] as Row[][],
    whereFilters: [] as unknown[],
    limitArgs: [] as unknown[],
  };

  const makeTail = (rows: Row[]) => {
    const tail: Record<string, unknown> = {
      orderBy: () => tail,
      limit: (v: unknown) => {
        state.limitArgs.push(v);
        return tail;
      },
      offset: () => Promise.resolve(rows),
      then: (onFulfilled?: never, onRejected?: never) =>
        Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return tail;
  };

  const dbSelect = vi.fn(() => {
    const rows = state.results.shift() ?? [];
    const tail = makeTail(rows);
    return {
      from: () => ({
        where: (filter: unknown) => {
          state.whereFilters.push(filter);
          return tail;
        },
      }),
    };
  });

  return { dbSelect, state };
});

vi.mock('@/database/init', () => ({
  db: { select: () => mocks.dbSelect() },
  contractSources: {
    chainId: { name: 'chain_id' },
    address: { name: 'address' },
    contractName: { name: 'contract_name' },
    isVerified: { name: 'is_verified' },
    verificationSource: { name: 'verification_source' },
    lastUpdated: { name: 'last_updated' },
  },
}));

const lookups = vi.hoisted(() => ({
  getBlockByNumber: vi.fn(),
  getBlockByHash: vi.fn(),
  getLatestBlock: vi.fn(),
  getTransactionByHash: vi.fn(),
  getLatestTransactions: vi.fn(),
  getAddressInfo: vi.fn(),
}));

vi.mock('@/services/BlockService', () => ({
  blockService: {
    getBlockByNumber: lookups.getBlockByNumber,
    getBlockByHash: lookups.getBlockByHash,
    getLatestBlock: lookups.getLatestBlock,
  },
}));
vi.mock('@/services/TransactionService', () => ({
  transactionService: {
    getTransactionByHash: lookups.getTransactionByHash,
    getLatestTransactions: lookups.getLatestTransactions,
  },
}));
vi.mock('@/services/AddressService', () => ({
  addressService: { getAddressInfo: lookups.getAddressInfo },
}));

import searchRoutes from '@/routes/search';

// Raw literals interpolated into a drizzle condition's queryChunks (see
// contractDirectoryRoutes.test.ts for the shape notes).
const collectSqlParams = (node: unknown, out: unknown[] = []): unknown[] => {
  if (node === null || typeof node !== 'object') {
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') {
      out.push(node);
    }
    return out;
  }
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.queryChunks)) {
    for (const chunk of record.queryChunks) collectSqlParams(chunk, out);
  }
  return out;
};

const TX_HASH = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060';

beforeEach(() => {
  vi.clearAllMocks();
  // Every remote lookup misses cleanly: the free-text searches produce
  // the unknown/not-found aggregate with suggestions.
  lookups.getBlockByNumber.mockResolvedValue(null);
  lookups.getBlockByHash.mockResolvedValue(null);
  lookups.getLatestBlock.mockResolvedValue(null);
  lookups.getTransactionByHash.mockResolvedValue(null);
  lookups.getLatestTransactions.mockResolvedValue({ transactions: [], total: 0 });
  lookups.getAddressInfo.mockResolvedValue(null);
  mocks.state.results = [[]];
  mocks.state.whereFilters = [];
  mocks.state.limitArgs = [];
});

describe('GET /search localContracts (additive merge)', () => {
  it('returns mapped cache hits for a free-text query, LIMIT 5', async () => {
    mocks.state.results = [[
      {
        chainId: 1,
        address: '0xabc0000000000000000000000000000000000001',
        contractName: 'Uniswap V2',
        isVerified: true,
      },
      {
        chainId: 137,
        address: '0xdef0000000000000000000000000000000000002',
        contractName: null,
        isVerified: null,
      },
    ]];

    const res = await searchRoutes.request('/search?q=uni');
    expect(res.status).toBe(200);

    const body = await res.json();
    // The remote miss keeps its shape: unknown type, suggestions, chain.
    expect(body.found).toBe(false);
    expect(body.type).toBe('unknown');
    expect(body.searchedChainId).toBe(1);
    expect(Array.isArray(body.suggestions)).toBe(true);
    // The additive field: hits with their own chainId (null name stays
    // null, null isVerified reads as false).
    expect(body.localContracts).toEqual([
      {
        chainId: 1,
        address: '0xabc0000000000000000000000000000000000001',
        name: 'Uniswap V2',
        isVerified: true,
      },
      {
        chainId: 137,
        address: '0xdef0000000000000000000000000000000000002',
        name: null,
        isVerified: false,
      },
    ]);
    // Capped at the search-section limit, not the directory page size.
    expect(mocks.state.limitArgs).toEqual([5]);
  });

  it('scopes the cache read to ?chainId= when present', async () => {
    mocks.state.results = [[
      { chainId: 137, address: '0xdef0000000000000000000000000000000000002', contractName: 'Uniswap', isVerified: false },
    ]];

    const res = await searchRoutes.request('/search?q=uni&chainId=137');
    expect(res.status).toBe(200);

    const params = collectSqlParams(mocks.state.whereFilters[0]);
    // Scoped: the filter carries the requested chainId beside the needle
    // (the unscoped variant carries needles only).
    expect(params).toContain(137);
    expect(params.filter(p => p === 'uni')).toHaveLength(2);
    expect((await res.json()).localContracts).toHaveLength(1);
  });

  it('does not include the chain scope when no ?chainId= is present', async () => {
    await searchRoutes.request('/search?q=uni');

    const params = collectSqlParams(mocks.state.whereFilters[0]);
    expect(params.filter(p => typeof p === 'number')).toEqual([]);
    expect(params.filter(p => p === 'uni')).toHaveLength(2);
  });

  it('keeps hash/block/ens responses byte-compatible: no localContracts, no cache read', async () => {
    // Hash with a chain hint (would otherwise short-circuit to needsChain).
    const hashRes = await searchRoutes.request(`/search?q=${TX_HASH}&chainId=1`);
    const hashBody = await hashRes.json();
    expect(hashBody.found).toBe(false);
    expect('localContracts' in hashBody).toBe(false);

    // Block number without a hint: needsChain.
    const needsRes = await searchRoutes.request('/search?q=18000000');
    const needsBody = await needsRes.json();
    expect(needsBody.needsChain).toBe(true);
    expect('localContracts' in needsBody).toBe(false);

    // ENS: answered locally, never touches the db.
    const ensRes = await searchRoutes.request('/search?q=vitalik.eth');
    const ensBody = await ensRes.json();
    expect(ensBody.type).toBe('ens');
    expect('localContracts' in ensBody).toBe(false);

    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it('drops the field when the cache read fails — the remote result stands', async () => {
    mocks.dbSelect.mockImplementationOnce(() => {
      throw new Error('duckdb exploded');
    });

    const res = await searchRoutes.request('/search?q=uni');
    expect(res.status).toBe(200);

    const body = await res.json();
    // Key absent (not an empty array): "no local matches" was never
    // actually checked, so the response must not assert it.
    expect('localContracts' in body).toBe(false);
    expect(body.found).toBe(false);
    expect(body.type).toBe('unknown');
    expect(Array.isArray(body.suggestions)).toBe(true);
  });

  it('returns an empty array (field present) when the read succeeds with no matches', async () => {
    mocks.state.results = [[]];

    const res = await searchRoutes.request('/search?q=nomatch');
    expect(res.status).toBe(200);
    const body = await res.json();
    // A successful read with zero hits is a checked fact: [] (the view
    // renders nothing either way, but the payload stays honest).
    expect(body.localContracts).toEqual([]);
  });
});
