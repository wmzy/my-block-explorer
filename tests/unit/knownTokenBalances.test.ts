// Unit tests for the Known Tokens pure shaping logic (zero-filter,
// USD-known-first ordering, cap + remainder) and the config's structural
// absence for chains without a curated list — no RPC or hook harness
// needed, which is exactly why the shaping lives in pure functions.
import { describe, it, expect } from 'vitest';

import {
  capKnownTokenRows,
  filterNonZeroKnownTokenBalances,
  KNOWN_TOKEN_ROW_CAP,
  orderKnownTokenRows,
  type KnownTokenBalance,
} from '@/services/knownTokenBalances';
import { knownTokensForChain } from '@/config/knownTokens';

const token = (suffix: string): string => `0x${suffix.padStart(40, '0')}`;

const row = (address: string, balance: bigint): KnownTokenBalance => ({
  address,
  balance,
});

// Injected pricing stub: maps lowercase address → USD value; everything
// else stays unpriced (what the view passes while prices settle or for
// tokens DefiLlama does not cover).
const usdOfPrices =
  (prices: Record<string, number>) =>
    (r: KnownTokenBalance): number | null =>
      prices[r.address.toLowerCase()] ?? null;

describe('filterNonZeroKnownTokenBalances', () => {
  it('drops zero balances and keeps positive ones', () => {
    const result = filterNonZeroKnownTokenBalances([
      row(token('a'), 100n),
      row(token('b'), 0n),
      row(token('c'), 1n),
    ]);
    expect(result).toEqual([row(token('a'), 100n), row(token('c'), 1n)]);
  });

  it('drops negative balances (balanceOf cannot produce them, but the filter never invents rows)', () => {
    expect(filterNonZeroKnownTokenBalances([row(token('a'), -5n)])).toEqual([]);
  });

  it('preserves input order — ordering is a separate step', () => {
    const result = filterNonZeroKnownTokenBalances([
      row(token('b'), 2n),
      row(token('a'), 9n),
    ]);
    expect(result.map((r) => r.address)).toEqual([token('b'), token('a')]);
  });

  it('returns an empty list for an empty input (structural absence)', () => {
    expect(filterNonZeroKnownTokenBalances([])).toEqual([]);
  });
});

describe('orderKnownTokenRows', () => {
  it('sorts USD-known rows first, descending by value, before unpriced rows', () => {
    const rows = [
      row(token('unpriced-large'), 10_000_000n),
      row(token('cheap'), 5n),
      row(token('expensive'), 1n),
      row(token('unpriced-small'), 3n),
    ];
    const result = orderKnownTokenRows(
      rows,
      usdOfPrices({ [token('cheap')]: 2, [token('expensive')]: 500 }),
    );
    expect(result.map((r) => r.address)).toEqual([
      token('expensive'), // $500
      token('cheap'), // $2
      token('unpriced-large'), // no price: balance desc
      token('unpriced-small'),
    ]);
  });

  it('orders unpriced rows by raw balance descending', () => {
    const rows = [row(token('a'), 10n), row(token('b'), 900n), row(token('c'), 100n)];
    const result = orderKnownTokenRows(rows, () => null);
    expect(result.map((r) => r.address)).toEqual([token('b'), token('c'), token('a')]);
  });

  it('falls back to balance order while prices settle, then resorts once they land', () => {
    const rows = [row(token('a'), 50n), row(token('b'), 5n)];
    const unpriced = orderKnownTokenRows(rows, () => null);
    expect(unpriced.map((r) => r.address)).toEqual([token('a'), token('b')]);
    const priced = orderKnownTokenRows(rows, usdOfPrices({ [token('b')]: 999 }));
    expect(priced.map((r) => r.address)).toEqual([token('b'), token('a')]);
  });

  it('keeps input order for full ties (priced equal, or equal balances)', () => {
    const rows = [
      row(token('first'), 7n),
      row(token('second'), 7n),
      row(token('third'), 7n),
    ];
    const result = orderKnownTokenRows(rows, usdOfPrices({
      [token('first')]: 1,
      [token('second')]: 1,
      [token('third')]: 1,
    }));
    expect(result.map((r) => r.address)).toEqual([token('first'), token('second'), token('third')]);
  });

  it('returns an empty list for an empty input (structural absence)', () => {
    expect(orderKnownTokenRows([], usdOfPrices({}))).toEqual([]);
  });
});

describe('capKnownTokenRows', () => {
  it('caps at 8 rows by default and reports the remainder count', () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(token(String(i)), BigInt(i)));
    const { shown, hidden } = capKnownTokenRows(rows);
    expect(shown).toHaveLength(KNOWN_TOKEN_ROW_CAP);
    expect(hidden).toBe(11 - KNOWN_TOKEN_ROW_CAP);
    // The cap keeps the FRONT of the ordered list (highest-value rows).
    expect(shown[0]?.address).toBe(rows[0]?.address);
  });

  it('reports zero remainder when the list fits the cap', () => {
    const rows = [row(token('a'), 1n), row(token('b'), 2n)];
    const { shown, hidden } = capKnownTokenRows(rows);
    expect(shown).toEqual(rows);
    expect(hidden).toBe(0);
  });

  it('honors an explicit cap', () => {
    const rows = [row(token('a'), 1n), row(token('b'), 2n), row(token('c'), 3n)];
    expect(capKnownTokenRows(rows, 2)).toEqual({
      shown: rows.slice(0, 2),
      hidden: 1,
    });
  });

  it('returns structural absence for an empty list — no rows, no remainder', () => {
    expect(capKnownTokenRows([])).toEqual({ shown: [], hidden: 0 });
  });
});

describe('knownTokensForChain', () => {
  it('resolves an empty list for chains without a curated set (nothing to check, never an error)', () => {
    expect(knownTokensForChain(0)).toEqual([]);
    expect(knownTokensForChain(999999)).toEqual([]);
  });

  it('curates a list for every POPULAR_CHAINS member with non-empty checksummed addresses', () => {
    // Spot members from each end of the curated map: mainnet and celo.
    for (const chainId of [1, 42220]) {
      const tokens = knownTokensForChain(chainId);
      expect(tokens.length).toBeGreaterThan(0);
      for (const entry of tokens) {
        expect(entry.address).toMatch(/^0x[0-9a-fA-F]{40}$/u);
        expect(entry.symbol.length).toBeGreaterThan(0);
      }
    }
  });
});
