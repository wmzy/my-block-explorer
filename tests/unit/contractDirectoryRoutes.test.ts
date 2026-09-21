// Route-level contract of GET /api/chains/:chainId/contracts (the cached
// contract directory): pagination follows the transactions list
// conventions — default limit 50 / offset 0, junk 400s, negative offset
// clamps to 0, runaway offsets clamp at the scan cap — except an over-cap
// limit 400s instead of clamping. ?q= reaches the SQL layer as the shared
// name-substring-or-address-prefix filter (lowercased needle), and rows
// map to the honest summary shape (null names stay null, null isVerified
// reads as false, datetimes normalize to ISO). The db layer is mocked
// with a chainable stub, pinning the route↔SQL contract without DuckDB.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  const state = {
    // Per db.select() call result queue (first = the page rows, second =
    // the count rows); shift()ed in order.
    results: [] as Row[][],
    whereFilters: [] as unknown[],
    limitArgs: [] as unknown[],
    offsetArgs: [] as unknown[],
    rejectNext: false,
  };

  // One select()'s chainable tail: the list path walks
  // where→orderBy→limit→offset (thenable), the count path stops at where
  // and awaits the tail itself — both must resolve the call's own rows.
  const makeTail = (rows: Row[]) => {
    const tail: Record<string, unknown> = {
      orderBy: () => tail,
      limit: (v: unknown) => {
        state.limitArgs.push(v);
        return tail;
      },
      offset: (v: unknown) => {
        state.offsetArgs.push(v);
        return state.rejectNext
          ? Promise.reject(new Error('duckdb exploded'))
          : Promise.resolve(rows);
      },
      then: (onFulfilled?: never, onRejected?: never) =>
        state.rejectNext
          ? Promise.reject(new Error('duckdb exploded')).then(onFulfilled, onRejected)
          : Promise.resolve(rows).then(onFulfilled, onRejected),
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

// The route module pulls the RPC/verification-oriented services for its
// OTHER endpoints; stubbed so this test imports only the directory path's
// real code (SearchService's listCachedContracts over the mocked db). The
// three lookup services behind SearchService's singleton are stubbed for
// the same reason — this test never runs a remote search.
vi.mock('@/services/ContractSourceService', () => ({ contractSourceService: {} }));
vi.mock('@/services/ContractInteractionService', () => ({ contractInteractionService: {} }));
vi.mock('@/services/IdeService', () => ({
  detectInstalledIdes: () => [],
  getDetectedIdesInfo: () => ({}),
  openInIde: vi.fn(),
}));
vi.mock('@/services/BlockService', () => ({ blockService: {} }));
vi.mock('@/services/TransactionService', () => ({ transactionService: {} }));
vi.mock('@/services/AddressService', () => ({ addressService: {} }));

import app from '@/routes/contracts';

// Walks a drizzle SQL condition and collects every raw literal embedded
// into its queryChunks (the eq() chainId, the contains()/starts_with()
// needles) — the observable surface of the ?q= filter without a database.
// StringChunks are objects (their text lives in .value, not in the chunk
// list), so only genuine interpolations surface here.
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

const makeRow = (overrides: Partial<Row> = {}): Row => ({
  address: '0xabc0000000000000000000000000000000000001',
  contractName: 'Uniswap V2',
  isVerified: true,
  verificationSource: 'sourcify',
  lastUpdated: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
});

const COUNT = [{ value: 12 }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.results = [[makeRow()], COUNT];
  mocks.state.whereFilters = [];
  mocks.state.limitArgs = [];
  mocks.state.offsetArgs = [];
  mocks.state.rejectNext = false;
});

describe('GET /chains/:chainId/contracts', () => {
  it('returns one honest summary row with total and echoed params', async () => {
    const res = await app.request('/chains/1/contracts');

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Data-Source')).toBe('database');
    const body = await res.json();
    expect(body.chainId).toBe(1);
    expect(body.chainName).toBe('Ethereum');
    expect(body.contracts).toEqual([
      {
        chainId: 1,
        address: '0xabc0000000000000000000000000000000000001',
        name: 'Uniswap V2',
        isVerified: true,
        verificationSource: 'sourcify',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    expect(body.total).toBe(12);
    // Echo of the applied filter/offset (absent filter reads null, not '').
    expect(body.q).toBeNull();
    expect(body.offset).toBe(0);
  });

  it('keeps null names null and reads a null isVerified as false', async () => {
    mocks.state.results = [[makeRow({ contractName: null, isVerified: null, verificationSource: null })], COUNT];

    const body = await (await app.request('/chains/1/contracts')).json();
    expect(body.contracts[0].name).toBeNull();
    expect(body.contracts[0].isVerified).toBe(false);
    expect(body.contracts[0].verificationSource).toBeNull();
  });

  it('defaults limit to 50 and offset to 0', async () => {
    await app.request('/chains/1/contracts');
    expect(mocks.state.limitArgs).toHaveLength(1);
    expect(mocks.state.limitArgs[0]).toBe(50);
    expect(mocks.state.offsetArgs).toEqual([0]);
  });

  it('pushes explicit limit/offset into the query', async () => {
    const res = await app.request('/chains/1/contracts?limit=7&offset=5');
    expect(res.status).toBe(200);
    expect(mocks.state.limitArgs[0]).toBe(7);
    expect(mocks.state.offsetArgs[0]).toBe(5);
    expect((await res.json()).offset).toBe(5);
  });

  it('clamps negative offsets to 0 and runaway offsets at 100_000', async () => {
    await app.request('/chains/1/contracts?offset=-5');
    expect(mocks.state.offsetArgs[0]).toBe(0);

    await app.request('/chains/1/contracts?offset=999999999');
    expect(mocks.state.offsetArgs[1]).toBe(100_000);
  });

  it('rejects a non-numeric offset with 400 instead of silently paging from 0', async () => {
    const res = await app.request('/chains/1/contracts?offset=abc');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid offset');
    // Failed validation never reaches the db.
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it('rejects junk, non-positive, and over-cap limits with 400', async () => {
    for (const bad of ['0', '-1', 'abc', '101']) {
      const res = await app.request(`/chains/1/contracts?limit=${bad}`);
      expect(res.status, `limit=${bad}`).toBe(400);
      expect((await res.json()).error).toBe('invalid_limit');
    }
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it('builds the ?q= filter as a lowercased name-substring-or-address-prefix match', async () => {
    const res = await app.request('/chains/1/contracts?q=Uni');
    expect(res.status).toBe(200);

    const body = await res.json();
    // The filter survives the round trip as the trimmed query.
    expect(body.q).toBe('Uni');

    // Both selects (rows + count) carry the same filter; its literals are
    // the scoped chainId and the lowercased needle (once for contains()
    // on the name, once for starts_with() on the address).
    expect(mocks.state.whereFilters).toHaveLength(2);
    const params = collectSqlParams(mocks.state.whereFilters[0]);
    expect(params).toContain(1);
    expect(params.filter(p => p === 'uni')).toHaveLength(2);
  });

  it('omits the name filter entirely without ?q=', async () => {
    await app.request('/chains/1/contracts');
    const params = collectSqlParams(mocks.state.whereFilters[0]);
    // Only the chainId scope — no needle literals.
    expect(params.filter(p => typeof p === 'string')).toEqual([]);
    expect(params).toContain(1);
  });

  it('answers 500 with a JSON error when the db read fails', async () => {
    mocks.state.rejectNext = true;
    const res = await app.request('/chains/1/contracts');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to list cached contracts');
  });
});
