// Token-directory service tests: the viewed-token store (checksumming,
// newest-first dedupe, firstSeen preservation, hint merging, the 50-entry
// cap, corrupt-payload degradation, best-effort writes), the pure
// merge/filter helpers, and the ONE-Multicall3 enrichment fetch (honest
// nulls for reverted calls, a rejecting transport failure, the disabled
// key). The only network edge — the viem client from utils/realTimeData —
// is mocked; the service code under test is real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

import {
  VIEWED_TOKENS_MAX_ENTRIES,
  directoryStandardLabel,
  fetchTokenDirectoryReads,
  filterByQuery,
  mergeDirectory,
  mergeViewedEntries,
  parseViewedTokens,
  readViewedTokens,
  recordViewedToken,
  tokenDirectoryAddressesKey,
  tokenDirectoryReadsCache,
  type ViewedTokenEntry,
  type ViewedTokenStorage,
} from '@/services/tokenDirectory';
import type { KnownToken } from '@/config/knownTokens';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

const TOKEN = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // mainnet WETH (checksummed)
const TOKEN_LOWER = TOKEN.toLowerCase();
const OTHER = getAddress(`0x${'bb'.repeat(20)}`); // checksummed via the lowercase convention
const OTHER_LOWER = OTHER.toLowerCase();
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

type MulticallParams = {
  contracts: Array<{ address: string; functionName: string }>;
  allowFailure: boolean;
  multicallAddress: string;
};

const multicall = vi.fn<(params: MulticallParams) => Promise<readonly unknown[]>>();

// Map-backed storage double: proves the injected-storage seam keeps the
// real localStorage untouched (GettingStarted's convention).
const fakeStorage = (): ViewedTokenStorage & { backing: Map<string, string> } => {
  const backing = new Map<string, string>();
  return {
    backing,
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, value),
  };
};

const entry = (address: string, overrides: Partial<ViewedTokenEntry> = {}): ViewedTokenEntry => ({
  address,
  firstSeen: '2026-09-25T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  tokenDirectoryReadsCache.clear();
  vi.mocked(createRpcClient).mockResolvedValue({ multicall } as never);
});

// viem's allowFailure success shape: the decoded value wrapped with status.
const ok = (result: unknown): { status: 'success'; result: unknown } => ({
  status: 'success',
  result,
});

const reverted = { status: 'failure', error: new Error('revert') };

describe('viewed-token store', () => {
  it('records a token checksummed, newest-first', () => {
    recordViewedToken(1, TOKEN_LOWER, { symbol: 'WETH', name: 'Wrapped Ether' });
    const entries = recordViewedToken(1, OTHER, {});

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ address: OTHER });
    expect(entries[1]).toMatchObject({ address: TOKEN, symbol: 'WETH', name: 'Wrapped Ether' });
    // Stored checksummed even from a lowercase input.
    expect(entries[1].address).toBe(TOKEN);
    expect(typeof entries[0].firstSeen).toBe('string');
  });

  it('re-recording dedupes by address: front of the list, firstSeen kept, hints merged', () => {
    const first = recordViewedToken(1, TOKEN_LOWER, { symbol: 'WETH' });
    const originalFirstSeen = first[0].firstSeen;

    const second = recordViewedToken(1, TOKEN, { name: 'Wrapped Ether' });

    expect(second).toHaveLength(1);
    expect(second[0].firstSeen).toBe(originalFirstSeen);
    // The revisit resolved only the name — the earlier symbol hint survives.
    expect(second[0]).toMatchObject({ symbol: 'WETH', name: 'Wrapped Ether' });
  });

  it('caps the list at 50 entries, oldest viewed dropped first', () => {
    recordViewedToken(1, TOKEN, {});
    for (let i = 0; i < VIEWED_TOKENS_MAX_ENTRIES; i += 1) {
      recordViewedToken(
        1,
        getAddress(`0x${(i + 0x10).toString(16).padStart(40, '0')}`),
        {},
      );
    }
    const entries = readViewedTokens(1);
    expect(entries).toHaveLength(VIEWED_TOKENS_MAX_ENTRIES);
    // The very first (oldest) entry was pushed out by the cap.
    expect(entries.some((e) => e.address.toLowerCase() === TOKEN_LOWER)).toBe(false);
  });

  it('scopes storage per chain', () => {
    recordViewedToken(1, TOKEN, { symbol: 'WETH' });
    recordViewedToken(137, OTHER, {});

    expect(readViewedTokens(1).map((e) => e.address)).toEqual([TOKEN]);
    expect(readViewedTokens(137).map((e) => e.address)).toEqual([OTHER]);
    expect(localStorage.getItem('be:viewedTokens:1')).not.toBeNull();
    expect(localStorage.getItem('be:viewedTokens:137')).not.toBeNull();
  });

  it('performs no write for a malformed (non-address) input', () => {
    const entries = recordViewedToken(1, 'not-an-address', { symbol: 'X' });
    expect(entries).toEqual([]);
    expect(localStorage.getItem('be:viewedTokens:1')).toBeNull();
  });

  it('normalizes a wrong-checksum mixed-case input to its checksummed form', () => {
    // viem's getAddress silently corrects hex-shaped input (the watchlist
    // store's convention) — the directory only ever stores checksummed.
    const wrongChecksum = `0x${'c0'.repeat(19)}Ab`;
    const entries = recordViewedToken(1, wrongChecksum, { symbol: 'X' });
    expect(entries).toHaveLength(1);
    expect(entries[0].address).toBe(getAddress(wrongChecksum));
    expect(entries[0].address).not.toBe(wrongChecksum);
  });

  it('degrades a corrupt payload to [] without throwing', () => {
    localStorage.setItem('be:viewedTokens:1', '{not json');
    expect(readViewedTokens(1)).toEqual([]);

    localStorage.setItem('be:viewedTokens:1', JSON.stringify([{ address: 'nope' }, 7, null]));
    expect(readViewedTokens(1)).toEqual([]);

    // Rows that fail validation are dropped; valid ones survive.
    localStorage.setItem(
      'be:viewedTokens:1',
      JSON.stringify([{ address: TOKEN, firstSeen: 'x' }, { address: 'zz', firstSeen: 'y' }]),
    );
    expect(readViewedTokens(1).map((e) => e.address)).toEqual([TOKEN]);
  });

  it('swallows a failing setItem while still returning the updated list', () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error('quota exceeded');
    };
    const entries = recordViewedToken(1, TOKEN, { symbol: 'WETH' }, storage);
    expect(entries.map((e) => e.address)).toEqual([TOKEN]);
  });

  it('keeps the real localStorage untouched through the injected-storage seam', () => {
    const storage = fakeStorage();
    recordViewedToken(1, TOKEN, { symbol: 'WETH' }, storage);
    expect(storage.backing.get('be:viewedTokens:1')).not.toBeNull();
    expect(localStorage.getItem('be:viewedTokens:1')).toBeNull();
  });

  it('parseViewedTokens applies the cap on read (hand-edited storage)', () => {
    const oversized = Array.from({ length: 80 }, (_, i) =>
      entry(getAddress(`0x${(i + 0x10).toString(16).padStart(40, '0')}`)),
    );
    expect(parseViewedTokens(JSON.stringify(oversized))).toHaveLength(
      VIEWED_TOKENS_MAX_ENTRIES,
    );
  });
});

describe('mergeViewedEntries (pure)', () => {
  it('moves a duplicate to the front and keeps firstSeen', () => {
    const merged = mergeViewedEntries(
      [entry(TOKEN, { firstSeen: '2020-01-01T00:00:00.000Z' }), entry(OTHER)],
      entry(TOKEN, { firstSeen: '2026-09-25T00:00:00.000Z', symbol: 'WETH' }),
    );
    expect(merged.map((e) => e.address)).toEqual([TOKEN, OTHER]);
    expect(merged[0].firstSeen).toBe('2020-01-01T00:00:00.000Z');
  });

  it('dedupes case-insensitively and honors a custom cap', () => {
    const a = entry(getAddress(`0x${'11'.repeat(20)}`));
    const b = entry(getAddress(`0x${'22'.repeat(20)}`));
    const merged = mergeViewedEntries([a, b], entry(a.address.toLowerCase()), 2);
    expect(merged).toHaveLength(2);
    expect(merged[0].address).toBe(a.address);
  });
});

describe('mergeDirectory (pure)', () => {
  const known: readonly KnownToken[] = [
    { address: TOKEN, symbol: 'WETH' },
    { address: OTHER, symbol: 'LINK' },
  ];

  it('curated first with provenance, then viewed rows newest-first', () => {
    const viewedAddr = getAddress(`0x${'33'.repeat(20)}`);
    const rows = mergeDirectory(known, [
      entry(viewedAddr, { symbol: 'PEPE', name: 'Pepe' }),
    ]);
    expect(rows.map((r) => r.address)).toEqual([TOKEN, OTHER, viewedAddr]);
    expect(rows.map((r) => r.provenance)).toEqual(['curated', 'curated', 'viewed']);
  });

  it('a curated address outranks its viewed copy but adopts the visited name hint', () => {
    const rows = mergeDirectory(known, [
      entry(TOKEN, { symbol: 'weth-fake', name: 'Wrapped Ether' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      address: TOKEN,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      provenance: 'curated',
    });
  });

  it('dedupes a viewed entry against curated case-insensitively', () => {
    const rows = mergeDirectory(known, [entry(TOKEN.toLowerCase(), {})]);
    expect(rows.filter((r) => r.address.toLowerCase() === TOKEN_LOWER)).toHaveLength(1);
    expect(rows.every((r) => r.provenance === 'curated')).toBe(true);
  });
});

describe('filterByQuery (pure)', () => {
  const rows = [
    { address: TOKEN, symbol: 'WETH', name: 'Wrapped Ether' },
    { address: OTHER, symbol: 'LINK', name: 'Chainlink Token' },
    { address: getAddress(`0x${'44'.repeat(20)}`), symbol: null, name: null },
  ];

  it('matches symbol, name and address substrings case-insensitively', () => {
    expect(filterByQuery(rows, 'weth').map((r) => r.symbol)).toEqual(['WETH']);
    expect(filterByQuery(rows, 'chainlink').map((r) => r.symbol)).toEqual(['LINK']);
    expect(filterByQuery(rows, TOKEN_LOWER.slice(0, 10)).map((r) => r.symbol)).toEqual(['WETH']);
  });

  it('an empty or whitespace query returns every row', () => {
    expect(filterByQuery(rows, undefined)).toHaveLength(3);
    expect(filterByQuery(rows, '   ')).toHaveLength(3);
  });

  it('a non-matching query returns nothing', () => {
    expect(filterByQuery(rows, 'zzz')).toEqual([]);
  });
});

describe('tokenDirectoryAddressesKey', () => {
  it('dedupes case-insensitively and sorts (order-insensitive identity)', () => {
    expect(tokenDirectoryAddressesKey([OTHER, TOKEN_LOWER, TOKEN])).toBe(
      [TOKEN_LOWER, OTHER_LOWER].sort().join(','),
    );
    expect(tokenDirectoryAddressesKey([])).toBe('');
  });
});

describe('fetchTokenDirectoryReads', () => {
  it('reads name/symbol/decimals/totalSupply for every token in ONE multicall', async () => {
    // The key's sorted order (OTHER 'bb…' < WETH 'c0…') governs the batch.
    multicall.mockResolvedValue([
      ok('Other'), ok('OTH'), ok(6), ok(42n),
      ok('Wrapped Ether'), ok('WETH'), ok(18), ok(1_000_000n),
    ]);

    const page = await fetchTokenDirectoryReads(
      1,
      tokenDirectoryAddressesKey([OTHER, TOKEN]),
    );

    expect(multicall).toHaveBeenCalledTimes(1);
    const [params] = multicall.mock.calls[0];
    expect(params.multicallAddress).toBe(MULTICALL3);
    expect(params.allowFailure).toBe(true);
    expect(params.contracts.map((contract) => contract.functionName)).toEqual([
      'name', 'symbol', 'decimals', 'totalSupply',
      'name', 'symbol', 'decimals', 'totalSupply',
    ]);
    // The key's sorted order governs the call order.
    expect(params.contracts.map((contract) => contract.address)).toEqual([
      OTHER_LOWER, OTHER_LOWER, OTHER_LOWER, OTHER_LOWER,
      TOKEN_LOWER, TOKEN_LOWER, TOKEN_LOWER, TOKEN_LOWER,
    ]);
    expect(page.chainId).toBe(1);
    expect(page.addressesKey).toBe([OTHER_LOWER, TOKEN_LOWER].join(','));
    expect(page.reads.get(TOKEN_LOWER)).toEqual({
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
      totalSupply: 1_000_000n,
    });
  });

  it('decodes reverted calls to honest nulls', async () => {
    multicall.mockResolvedValue([
      ok('Pepe'), ok('PEPE'), reverted, reverted,
    ]);

    const page = await fetchTokenDirectoryReads(
      1,
      tokenDirectoryAddressesKey([TOKEN]),
    );

    expect(page.reads.get(TOKEN_LOWER)).toEqual({
      name: 'Pepe',
      symbol: 'PEPE',
      decimals: null,
      totalSupply: null,
    });
  });

  it('rejects on a transport-level failure (retryable error, no fabricated nulls)', async () => {
    vi.mocked(createRpcClient).mockRejectedValue(new Error('RPC unreachable'));

    await expect(
      fetchTokenDirectoryReads(1, tokenDirectoryAddressesKey([TOKEN])),
    ).rejects.toThrow('Could not read token details from the RPC');
  });

  it('settles an empty page with zero network for the disabled key', async () => {
    const page = await fetchTokenDirectoryReads(0, '');
    expect(page).toEqual({ chainId: 0, addressesKey: '', reads: new Map() });
    expect(multicall).not.toHaveBeenCalled();
  });
});

describe('directoryStandardLabel', () => {
  it('claims \'ERC-20\' only when decimals AND totalSupply responded', () => {
    expect(
      directoryStandardLabel({ name: null, symbol: null, decimals: 18, totalSupply: 1n }),
    ).toBe('ERC-20');
    expect(
      directoryStandardLabel({ name: 'X', symbol: 'X', decimals: 18, totalSupply: null }),
    ).toBeNull();
    expect(
      directoryStandardLabel({ name: 'X', symbol: null, decimals: null, totalSupply: 1n }),
    ).toBeNull();
    expect(directoryStandardLabel(undefined)).toBeNull();
  });
});
