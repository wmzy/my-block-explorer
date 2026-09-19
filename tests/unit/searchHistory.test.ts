// Search history storage contract: entries record the chain the search
// actually landed on, legacy entries (written before per-chain recording)
// stay readable and re-run on the currently selected chain, and the
// newest-first / dedupe / cap rules hold across both generations.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearSearchHistory,
  readSearchHistory,
  recordSearchHistoryEntry,
  removeSearchHistoryEntry,
  SEARCH_HISTORY_MAX_ENTRIES,
  SEARCH_HISTORY_STORAGE_KEY,
} from '@/services/searchHistory';

describe('searchHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records an entry with the chain it landed on, newest first', () => {
    recordSearchHistoryEntry('vitalik.eth', 1);
    recordSearchHistoryEntry('0xabc', 137);

    expect(readSearchHistory()).toEqual([
      { query: '0xabc', chainId: 137 },
      { query: 'vitalik.eth', chainId: 1 },
    ]);
  });

  it('trims queries and ignores blank ones', () => {
    recordSearchHistoryEntry('  uniswap  ', 5000);
    const unchanged = recordSearchHistoryEntry('   ', 1);

    expect(readSearchHistory()).toEqual([{ query: 'uniswap', chainId: 5000 }]);
    expect(unchanged).toEqual([{ query: 'uniswap', chainId: 5000 }]);
  });

  it('dedupes by query+chainId but keeps the same query on other chains', () => {
    recordSearchHistoryEntry('0xabc', 137);
    recordSearchHistoryEntry('0xdef', 1);
    recordSearchHistoryEntry('0xabc', 137);
    recordSearchHistoryEntry('0xabc', 5000);

    expect(readSearchHistory()).toEqual([
      { query: '0xabc', chainId: 5000 },
      { query: '0xabc', chainId: 137 },
      { query: '0xdef', chainId: 1 },
    ]);
  });

  it('caps the list at the newest 10 entries', () => {
    for (let i = 0; i < SEARCH_HISTORY_MAX_ENTRIES + 3; i++) {
      recordSearchHistoryEntry(`query-${i}`, 1);
    }

    const stored = readSearchHistory();
    expect(stored).toHaveLength(SEARCH_HISTORY_MAX_ENTRIES);
    expect(stored[0]).toEqual({ query: `query-${SEARCH_HISTORY_MAX_ENTRIES + 2}`, chainId: 1 });
    expect(stored[SEARCH_HISTORY_MAX_ENTRIES - 1]).toEqual({ query: 'query-3', chainId: 1 });
  });

  it('reads legacy entries that predate the chainId field', () => {
    // Entries written before destinations were recorded carry no chain —
    // they must survive the read (consumers fall back to the current
    // chain), not be filtered out as corrupt.
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([{ query: 'old-search' }, { query: '0xnew', chainId: 137 }]),
    );

    expect(readSearchHistory()).toEqual([
      { query: 'old-search' },
      { query: '0xnew', chainId: 137 },
    ]);
  });

  it('still drops corrupt entries while keeping legacy ones', () => {
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { query: 'legacy' },
        { chainId: 137 }, // no query
        { query: 42, chainId: 1 }, // query not a string
        { query: 'bad-chain', chainId: '137' }, // chain not a number
        { query: 'fractional', chainId: 13.7 }, // chain not an integer
      ]),
    );

    expect(readSearchHistory()).toEqual([{ query: 'legacy' }]);
  });

  it('supersedes a legacy same-query entry when recording a real destination', () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify([{ query: 'uniswap' }]));

    recordSearchHistoryEntry('uniswap', 137);

    // The new record carries strictly more information; the unknown-chain
    // duplicate must not linger beside it.
    expect(readSearchHistory()).toEqual([{ query: 'uniswap', chainId: 137 }]);
  });

  it('removes a single entry, legacy or not, by query+chainId', () => {
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { query: 'legacy' },
        { query: '0xabc', chainId: 137 },
        { query: '0xabc', chainId: 1 },
      ]),
    );

    removeSearchHistoryEntry('legacy');
    expect(readSearchHistory()).toEqual([
      { query: '0xabc', chainId: 137 },
      { query: '0xabc', chainId: 1 },
    ]);

    removeSearchHistoryEntry('0xabc', 137);
    expect(readSearchHistory()).toEqual([{ query: '0xabc', chainId: 1 }]);
  });

  it('clears the whole history', () => {
    recordSearchHistoryEntry('uniswap', 1);
    clearSearchHistory();
    expect(readSearchHistory()).toEqual([]);
  });

  it('degrades to an empty list on a corrupt payload', () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, '{not json');
    expect(readSearchHistory()).toEqual([]);
  });
});
