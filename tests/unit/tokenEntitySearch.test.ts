// Token/label entity hits of the global /api/search: the PURE matcher
// (matchTokenEntityHits) owns every rule — case-insensitive substring on
// the curated symbol or the label text, dedup by address with the label
// winning, cap 5 — and is exercised here with plain fixtures, no
// database. The route-level describes pin the additive-merge contract:
// free-text responses ALSO carry tokenHits (label read scoped to
// ?chainId= when present), every other query shape (hash, ENS) keeps the
// exact pre-existing response with NO tokenHits key and NO label read at
// all, and a failing label read drops the field silently while
// localContracts stands on its own. Lookup services and the db layer are
// mocked; no network, no DuckDB.
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  matchTokenEntityHits,
  TOKEN_ENTITY_SEARCH_LIMIT,
  type KnownTokenEntry,
  type LabelEntry,
} from '@/services/SearchService';

// Real curated mainnet USDC address (static data in config/knownTokens):
// checksummed in the curated list, lowercase in label storage — the exact
// pair the dedup rule must fold together.
const USDC_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_MAINNET_LOWER = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const TOKENS: readonly KnownTokenEntry[] = [
  { chainId: 1, address: USDC_MAINNET, symbol: 'USDC' },
  { chainId: 1, address: '0xabc00000000000000000000000000000000000001', symbol: 'WETH' },
  { chainId: 137, address: '0xdef00000000000000000000000000000000000002', symbol: 'USDC' },
];

describe('matchTokenEntityHits (pure matcher, fixtures only)', () => {
  it('matches known-token symbols by case-insensitive substring', () => {
    expect(matchTokenEntityHits('usdc', TOKENS, [])).toEqual([
      { chainId: 1, address: USDC_MAINNET, matchText: 'USDC', source: 'known-token' },
      { chainId: 137, address: '0xdef00000000000000000000000000000000000002', matchText: 'USDC', source: 'known-token' },
    ]);
    // Non-matching symbols stay out; the needle is not a prefix/rx.
    expect(matchTokenEntityHits('weth', TOKENS, [])).toHaveLength(1);
    expect(matchTokenEntityHits('nope', TOKENS, [])).toEqual([]);
  });

  it('matches labels by case-insensitive substring on the label text', () => {
    const labels: readonly LabelEntry[] = [
      { chainId: 1, address: '0x1110000000000000000000000000000000000001', label: 'Metamask vault' },
      { chainId: 1, address: '0x2220000000000000000000000000000000000002', label: 'treasury' },
    ];
    expect(matchTokenEntityHits('VAULT', TOKENS, labels)).toEqual([
      { chainId: 1, address: '0x1110000000000000000000000000000000000001', matchText: 'Metamask vault', source: 'label' },
    ]);
    expect(matchTokenEntityHits('meta', [], labels)).toHaveLength(1);
  });

  it('dedups by address with the label winning over the known-token hint', () => {
    // Same entity: curated checksummed address vs lowercase label key.
    // Mainnet-only token fixtures so the dedup (not cross-chain scoping)
    // is the thing under test.
    const labels: readonly LabelEntry[] = [
      { chainId: 1, address: USDC_MAINNET_LOWER, label: 'usdc stash' },
    ];
    const mainnetTokens: readonly KnownTokenEntry[] = [
      { chainId: 1, address: USDC_MAINNET, symbol: 'USDC' },
      { chainId: 1, address: '0xabc00000000000000000000000000000000000001', symbol: 'WETH' },
    ];
    expect(matchTokenEntityHits('usdc', mainnetTokens, labels)).toEqual([
      { chainId: 1, address: USDC_MAINNET_LOWER, matchText: 'usdc stash', source: 'label' },
    ]);
  });

  it('does not dedup the same address across different chains', () => {
    // A mainnet label on USDC's address suppresses only mainnet's token;
    // polygon's USDC at the "same" matched symbol stays a hit.
    const labels: readonly LabelEntry[] = [
      { chainId: 1, address: USDC_MAINNET_LOWER, label: 'usdc stash' },
    ];
    const hits = matchTokenEntityHits('usdc', TOKENS, labels);
    expect(hits).toHaveLength(2);
    expect(hits.map(h => h.source)).toEqual(['label', 'known-token']);
    expect(hits[1]?.chainId).toBe(137);
  });

  it('merges labels first, caps at TOKEN_ENTITY_SEARCH_LIMIT (5)', () => {
    const labels: readonly LabelEntry[] = [1, 2, 3].map(i => ({
      chainId: 1,
      address: `0x${String(i).padStart(2, '0')}00000000000000000000000000000000000000${String(i).padEnd(2, '0')}`,
      label: `usd vault ${i}`,
    }));
    const tokens: readonly KnownTokenEntry[] = [1, 2, 3, 4].map(i => ({
      chainId: 1,
      address: `0x${String(i + 10).padStart(2, '0')}00000000000000000000000000000000000000${String(i + 10).padEnd(2, '0')}`,
      symbol: `USDX${i}`,
    }));

    const hits = matchTokenEntityHits('usd', tokens, labels);
    expect(hits).toHaveLength(TOKEN_ENTITY_SEARCH_LIMIT);
    // Label precedence is also the visible order: the 3 label hits lead,
    // known-token entries fill the remainder of the cap.
    expect(hits.map(h => h.source)).toEqual(['label', 'label', 'label', 'known-token', 'known-token']);
  });

  it('returns [] for empty or whitespace-only queries', () => {
    expect(matchTokenEntityHits('', TOKENS, [{ chainId: 1, address: USDC_MAINNET_LOWER, label: 'usdc' }])).toEqual([]);
    expect(matchTokenEntityHits('   ', TOKENS, [])).toEqual([]);
  });

  it('honors an explicit smaller limit', () => {
    const labels: readonly LabelEntry[] = [1, 2].map(i => ({
      chainId: 1,
      address: `0x${String(i).padStart(2, '0')}00000000000000000000000000000000000000${String(i).padEnd(2, '0')}`,
      label: `vault ${i}`,
    }));
    expect(matchTokenEntityHits('vault', [], labels, 1)).toHaveLength(1);
  });
});

// --- Route-level additive merge (mocked db, no DuckDB) ---

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  const state = {
    // One entry per db.select() call in request order (contracts read,
    // then labels read); an Error entry makes that read fail.
    results: [] as (Row[] | Error)[],
    whereFilters: [] as unknown[],
  };

  const makeTail = (rows: Row[]) => {
    const tail: Record<string, unknown> = {
      orderBy: () => tail,
      limit: () => tail,
      then: (onFulfilled?: never, onRejected?: never) =>
        Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return tail;
  };

  const dbSelect = vi.fn(() => {
    const entry = state.results.shift() ?? [];
    if (entry instanceof Error) throw entry;
    const tail = makeTail(entry);
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
  addressLabels: {
    chainId: { name: 'chain_id' },
    address: { name: 'address' },
    label: { name: 'label' },
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

// Raw literals interpolated into a drizzle condition's queryChunks (same
// shape notes as searchLocalContracts.test.ts).
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
  // Every remote lookup misses cleanly: free-text searches produce the
  // unknown/not-found aggregate with suggestions.
  lookups.getBlockByNumber.mockResolvedValue(null);
  lookups.getBlockByHash.mockResolvedValue(null);
  lookups.getLatestBlock.mockResolvedValue(null);
  lookups.getTransactionByHash.mockResolvedValue(null);
  lookups.getLatestTransactions.mockResolvedValue({ transactions: [], total: 0 });
  lookups.getAddressInfo.mockResolvedValue(null);
  mocks.state.results = [[], []];
  mocks.state.whereFilters = [];
});

describe('GET /search tokenHits (additive merge)', () => {
  it('returns label hits for a free-text query, deduped against curated tokens', async () => {
    // First select = contracts cache (empty), second = labels: a label on
    // mainnet USDC's own address. The curated USDC symbol matches 'usdc'
    // too — the label must win the dedup and be the ONLY hit.
    mocks.state.results = [
      [],
      [{ chainId: 1, address: USDC_MAINNET_LOWER, label: 'USDC vault' }],
    ];

    const res = await searchRoutes.request('/search?q=usdc&chainId=1');
    const body = await res.json();

    expect(body.found).toBe(false);
    expect(body.tokenHits).toEqual([
      { chainId: 1, address: USDC_MAINNET_LOWER, matchText: 'USDC vault', source: 'label' },
    ]);
    // The pre-existing additive field stands on its own (successful read,
    // zero matches).
    expect(body.localContracts).toEqual([]);
  });

  it('scopes the label read to ?chainId= when present, unscoped without', async () => {
    mocks.state.results = [
      [],
      [{ chainId: 137, address: '0xdef00000000000000000000000000000000000002', label: 'polygon vault' }],
    ];
    const scoped = await searchRoutes.request('/search?q=vault&chainId=137');
    const scopedBody = await scoped.json();
    expect(scopedBody.tokenHits).toEqual([
      { chainId: 137, address: '0xdef00000000000000000000000000000000000002', matchText: 'polygon vault', source: 'label' },
    ]);
    // whereFilters order follows the request's reads: [0] contracts,
    // [1] labels. Scoped: the chain id rides the labels filter.
    expect(collectSqlParams(mocks.state.whereFilters[1])).toContain(137);

    mocks.state.results = [
      [],
      [{ chainId: 56, address: '0xabc00000000000000000000000000000000000001', label: 'bsc vault' }],
    ];
    const unscoped = await searchRoutes.request('/search?q=vault');
    const unscopedBody = await unscoped.json();
    expect(unscopedBody.tokenHits).toEqual([
      { chainId: 56, address: '0xabc00000000000000000000000000000000000001', matchText: 'bsc vault', source: 'label' },
    ]);
    // Second request appended two more filters; its labels filter is the
    // LAST one and must carry no chain scope.
    const lastFilter = mocks.state.whereFilters[mocks.state.whereFilters.length - 1];
    expect(collectSqlParams(lastFilter)).not.toContain(56);
  });

  it('keeps hash/ens responses byte-compatible: no tokenHits, no label read', async () => {
    const hashRes = await searchRoutes.request(`/search?q=${TX_HASH}&chainId=1`);
    const hashBody = await hashRes.json();
    expect(hashBody.found).toBe(false);
    expect('tokenHits' in hashBody).toBe(false);
    expect('localContracts' in hashBody).toBe(false);

    const ensRes = await searchRoutes.request('/search?q=vitalik.eth');
    const ensBody = await ensRes.json();
    expect(ensBody.type).toBe('ens');
    expect('tokenHits' in ensBody).toBe(false);

    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it('drops tokenHits when the label read fails (localContracts unaffected)', async () => {
    mocks.state.results = [[], new Error('duckdb: lock')];

    const res = await searchRoutes.request('/search?q=vault&chainId=1');
    const body = await res.json();

    expect(body.found).toBe(false);
    // The contracts read succeeded: its field stays. The labels read
    // failed: an absent section never claims "no matches" was checked.
    expect(body.localContracts).toEqual([]);
    expect('tokenHits' in body).toBe(false);
  });
});
