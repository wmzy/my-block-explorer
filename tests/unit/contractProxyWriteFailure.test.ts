// A failed CACHE WRITE in ContractSourceService was reported to the user
// as a failed LOOKUP, and a failed lookup is a factual verdict the routes
// act on (404 not_a_contract).
//
// The service separates "the source cache" from "the source answer": the
// answer can be re-fetched from Sourcify/Blockscan on every request, while
// the row write is only an optimization. Live dev smoke (2026-10-03) showed
// the two are conflated — `saveProxyInfo` swallowed its own failure, and the
// very next `UPDATE` the request made — the one `saveToDatabase` issues
// with a JS Date bound to the TIMESTAMP_MS `last_updated` column — was
// reported as `Failed query: update "contract_sources" set "proxy" = …`
// (DuckDB conversion error, code 42000), and THAT one propagated straight
// through the outer catch to the caller. A request whose only problem was a
// cache write therefore lost the source it had just read.
//
// The contract these tests pin: a cache write that fails is LOGGED and
// degrades to a re-fetch; it is never reported as a failed lookup. The
// tests drive the real service with a db whose writes reject.
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
import type { Address } from 'viem';

const CHAIN_ID = 1;
const CONTRACT = '0xabc0000000000000000000000000000000000001' as Address;

const IMPL = '0x1111111111111111111111111111111111111111' as Address;

const service = new ContractSourceService();

const writeFailure = () =>
  new Error(
    'Failed query: update "contract_sources" set "proxy" = $1, "implementation" = $2, "last_updated" = $3',
  );

/** The DuckDB conversion error a JS Date bound to TIMESTAMP_MS produces. */
const timestampConversionFailure = () =>
  new Error(
    'Failed query: update "contract_sources" set "last_updated" = $1\nparams: Wed Oct 01 2025 21:20:23 GMT+0800',
  );

// The answer must come from the verifier, not from the cache row: the read
// is driven through fetch, so a stubbed 404 (both verifiers miss) plus
// on-chain code sends the request down the save path whose write is broken.
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
  // The upsert the source answer is written through: it succeeds here, and
  // the UPDATE that follows it (proxy info / last_updated) is what each
  // case breaks.
  mockDb.insert.mockReturnValue({
    values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
  });
  // Cache miss: every source read goes to the verifiers, which is the path
  // whose write this test breaks.
  mockDb.select.mockImplementation(() => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
      node[method] = () => node;
    }
    node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject);
    return node;
  });
});

describe('ContractSourceService — a failed cache write is not a failed lookup', () => {
  it('serves the Sourcify source when the proxy-info write fails', async () => {
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
    mockDb.update.mockImplementation(() => {
      throw writeFailure();
    });

    const result = await service.getContractSource(CHAIN_ID, CONTRACT);

    // The write is a cache concern; the answer came from the verifier.
    expect(result?.verificationStatus).toBe('verified');
  });

  it('serves the Sourcify source when the write dies on a TIMESTAMP_MS conversion', async () => {
    // The exact error the dev smoke produced.
    vi.stubGlobal('fetch', vi.fn(async () => sourcifyHit()));
    mockDb.update.mockImplementation(() => {
      throw timestampConversionFailure();
    });

    await expect(service.getContractSource(CHAIN_ID, CONTRACT)).resolves.toMatchObject({
      verificationStatus: 'verified',
    });
  });

  it('still reports a failed READ, which no cache write can fix', async () => {
    mockDb.select.mockImplementation(() => {
      throw new Error('Failed query: Catalog Error: Table with address does not exist');
    });

    // The read failure is the one verdict the routes must not read as
    // "not a contract" (see tests/unit/contractLookupFailure.test.ts).
    await expect(service.getContractSource(CHAIN_ID, CONTRACT)).rejects.toThrow();
  });
});
