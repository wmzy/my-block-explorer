/**
 * Parity tests for the precomputed chain search/sort index in
 * @/config/chains (chainIdToType map, popular-id set, SORTED_CHAINS and
 * SEARCH_ORDER caches).
 *
 * The reference implementations below are verbatim copies of the original
 * per-call logic (linear getChainType scan, inline dedupe + full five-tier
 * comparator). They pin down that the optimized module-level index produces
 * identical classification and ordering for every query shape — the change
 * is performance-only.
 */
import { describe, it, expect } from 'vitest';
import type { Chain } from 'viem';
import {
  SUPPORTED_CHAINS,
  POPULAR_CHAINS,
  getChainType,
  getSortedChains,
  isPopularChain,
  searchChains,
} from '@/config/chains';

// ---------------------------------------------------------------------------
// Reference (old) implementation
// ---------------------------------------------------------------------------

type ReferenceChainType = 'mainnet' | 'testnet' | 'unknown';

function referenceChainType(chainId: number): ReferenceChainType {
  const candidates = SUPPORTED_CHAINS.filter(chain => chain.id === chainId);
  if (candidates.length === 0) return 'unknown';

  if (candidates.some(chain => chain.testnet === true)) {
    return 'testnet';
  }

  const testnetIds = [
    80001, 97, 421611, 421613, 421614, 84531, 84532, 420, 69, 43113, 4002,
    44787, 62320, 10200,
  ];
  if (testnetIds.includes(chainId)) return 'testnet';

  const name = candidates[0].name.toLowerCase();
  if (
    name.includes('test')
    || name.includes('sepolia')
    || name.includes('goerli')
    || name.includes('holesky')
    || name.includes('mumbai')
    || name.includes('fuji')
    || name.includes('chiado')
  ) {
    return 'testnet';
  }

  return 'mainnet';
}

function referenceIsPopular(chainId: number): boolean {
  return POPULAR_CHAINS.some(chain => chain.id === chainId);
}

function referenceSortedChains(): Chain[] {
  const seen = new Set<number>();
  const unique = SUPPORTED_CHAINS.filter((chain) => {
    if (seen.has(chain.id)) return false;
    seen.add(chain.id);
    return true;
  });

  return unique.sort((a, b) => {
    const aIsPopular = referenceIsPopular(a.id);
    const bIsPopular = referenceIsPopular(b.id);
    if (aIsPopular && !bIsPopular) return -1;
    if (!aIsPopular && bIsPopular) return 1;

    const aType = referenceChainType(a.id);
    const bType = referenceChainType(b.id);
    if (aType === 'mainnet' && bType !== 'mainnet') return -1;
    if (aType !== 'mainnet' && bType === 'mainnet') return 1;

    return a.name.localeCompare(b.name);
  });
}

function referenceSearchChains(query: string): Chain[] {
  if (!query.trim()) return referenceSortedChains();

  const lowerQuery = query.toLowerCase();
  const numericQuery = parseInt(query);

  const results = SUPPORTED_CHAINS.filter((chain) => {
    if (!isNaN(numericQuery) && chain.id === numericQuery) return true;
    if (chain.name.toLowerCase().includes(lowerQuery)) return true;
    if (chain.id.toString().includes(query)) return true;
    if (chain.nativeCurrency.symbol.toLowerCase().includes(lowerQuery)) return true;
    if (chain.name.toLowerCase().replace(/\s+/g, '').includes(lowerQuery.replace(/\s+/g, '')))
      return true;
    return false;
  });

  return results.sort((a, b) => {
    if (!isNaN(numericQuery)) {
      if (a.id === numericQuery && b.id !== numericQuery) return -1;
      if (a.id !== numericQuery && b.id === numericQuery) return 1;
    }

    const aStartsWith = a.name.toLowerCase().startsWith(lowerQuery);
    const bStartsWith = b.name.toLowerCase().startsWith(lowerQuery);
    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;

    const aIsPopular = referenceIsPopular(a.id);
    const bIsPopular = referenceIsPopular(b.id);
    if (aIsPopular && !bIsPopular) return -1;
    if (!aIsPopular && bIsPopular) return 1;

    const aType = referenceChainType(a.id);
    const bType = referenceChainType(b.id);
    if (aType === 'mainnet' && bType !== 'mainnet') return -1;
    if (aType !== 'mainnet' && bType === 'mainnet') return 1;

    return a.name.localeCompare(b.name);
  });
}

/** Stable per-entry projection: captures id AND name (alias exports share ids). */
const fingerprint = (chains: readonly Chain[]): string[] => chains.map(c => `${c.id}:${c.name}`);

// Covers: empty/whitespace, exact ids, id substrings, mixed numerics
// (parseInt prefixes), case-insensitive names/symbols, duplicate-id aliases
// (Base 8453, Kaia/Klaytn 8217, Localhost/Tempo 1337, Bitlayer 200901),
// testnet keywords, whitespace-stripped alias matching, and no-match.
const QUERY_BATTERY = [
  '',
  ' ',
  '1',
  '10',
  '42',
  '137',
  '999',
  '1337',
  '8453',
  '31337',
  '1abc',
  'eth',
  'ETH',
  'Ethereum',
  'ETHEREUM',
  'ethereum',
  'ethereumclassic',
  'base',
  'Base',
  'base sepolia',
  'sepolia',
  'test',
  'polygon',
  'poly',
  'klaytn',
  'kaia',
  'bitlayer',
  'arbitrum',
  'optimism',
  'zzzNoSuchChain999xyz',
];

describe('chains precomputed index', () => {
  describe('chainIdToType map correctness (via getChainType)', () => {
    it('agrees with the reference classification for every supported chain id', () => {
      const ids = new Set(SUPPORTED_CHAINS.map(chain => chain.id));
      // Sanity: the corpus is the full viem barrel, not a stub.
      expect(ids.size).toBeGreaterThan(500);
      for (const id of ids) {
        expect(getChainType(id)).toBe(referenceChainType(id));
      }
    });

    it('returns unknown for ids absent from the corpus', () => {
      expect(getChainType(3)).toBe('unknown'); // Ropsten, removed from viem
      expect(getChainType(4)).toBe('unknown'); // Rinkeby, removed from viem
      expect(getChainType(999_999)).toBe('unknown');
      expect(getChainType(1_234_567)).toBe('unknown');
    });

    it('classifies every id in the sorted list as mainnet or testnet', () => {
      for (const chain of getSortedChains()) {
        const type = getChainType(chain.id);
        expect(type === 'mainnet' || type === 'testnet').toBe(true);
      }
    });
  });

  describe('isPopularChain parity', () => {
    it('agrees with the reference check for every exported chain', () => {
      for (const chain of SUPPORTED_CHAINS) {
        expect(isPopularChain(chain.id)).toBe(referenceIsPopular(chain.id));
      }
    });
  });

  describe('getSortedChains ordering parity', () => {
    it('matches the reference implementation exactly (id:name sequence)', () => {
      expect(fingerprint(getSortedChains())).toEqual(fingerprint(referenceSortedChains()));
    });

    it('returns a fresh array per call so callers cannot poison the cached order', () => {
      const first = getSortedChains();
      const second = getSortedChains();
      expect(first).not.toBe(second);

      first.reverse();
      expect(getSortedChains()[0]).toBe(second[0]);
    });
  });

  describe('searchChains ordering parity', () => {
    it('matches the reference implementation for every battery query', () => {
      for (const query of QUERY_BATTERY) {
        const actual = fingerprint(searchChains(query));
        const expected = fingerprint(referenceSearchChains(query));
        // Prefix the diff with the query so failures are attributable.
        expect(actual, `query: ${JSON.stringify(query)}`).toEqual(expected);
      }
    });
  });

  describe('search filter semantics (unchanged behavior)', () => {
    it('is case-insensitive across name matches', () => {
      const lower = searchChains('ethereum');
      const upper = searchChains('ETHEREUM');
      const mixed = searchChains('Ethereum');
      expect(lower.length).toBeGreaterThan(0);
      expect(upper.length).toBe(lower.length);
      expect(mixed.length).toBe(lower.length);
      expect(fingerprint(upper)).toEqual(fingerprint(lower));
      expect(fingerprint(mixed)).toEqual(fingerprint(lower));
    });

    it('matches by chain id substring, not just name', () => {
      // "137" hits Polygon exactly; ids containing 137 also qualify —
      // the reference battery pins exact ordering.
      const results = searchChains('137');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(137); // exact id match ranks first
    });

    it('matches by native token symbol, case-insensitively', () => {
      const results = searchChains('eth');
      expect(results.some(chain => chain.nativeCurrency.symbol === 'ETH')).toBe(true);
    });

    it('matches names ignoring whitespace differences (alias rule)', () => {
      // "ethereumclassic" (no space) must find "Ethereum Classic" via the
      // whitespace-stripped alias comparison, not the plain name include.
      const results = searchChains('ethereumclassic');
      expect(results.some(chain => chain.id === 61)).toBe(true);
    });

    it('keeps duplicate-id exports in results (search has never deduped)', () => {
      // The viem barrel exports both "Localhost" and "Tempo" under id 1337.
      const corpusCount = SUPPORTED_CHAINS.filter(chain => chain.id === 1337).length;
      expect(corpusCount).toBeGreaterThan(1);
      const results = searchChains('1337');
      expect(results.filter(chain => chain.id === 1337)).toHaveLength(corpusCount);
    });

    it('returns the full sorted list for empty and whitespace-only queries', () => {
      expect(fingerprint(searchChains(''))).toEqual(fingerprint(getSortedChains()));
      expect(fingerprint(searchChains('   '))).toEqual(fingerprint(getSortedChains()));
    });

    it('returns an empty array when nothing matches', () => {
      expect(searchChains('zzzNoSuchChain999xyz')).toEqual([]);
    });
  });
});
