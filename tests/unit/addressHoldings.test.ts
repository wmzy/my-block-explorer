// Unit tests for the pure holdings aggregation: nets by standard and
// direction, strict decimal parsing, zero-holding filtering, and the
// documented ordering rules.
import { describe, it, expect } from 'vitest';

import {
  aggregateTokenHoldings,
  estimateHoldingsUsd,
  type SharedTokenClass,
} from '@/views/Address/holdings';
import type { TokenTransfer } from '@/services/tokenTransfers';

const TOKEN_A = `0x${'a'.repeat(40)}`;
const TOKEN_B = `0x${'b'.repeat(40)}`;
const TOKEN_UPPER_A = `0x${'A'.repeat(40)}`;

function row(fields: Partial<TokenTransfer>): TokenTransfer {
  return {
    txHash: '0xdead',
    blockNumber: 1,
    logIndex: 0,
    token: TOKEN_A,
    standard: 'erc20-or-erc721',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '0',
    direction: 'out',
    ...fields,
  };
}

// Injected classification stub: unknown unless the token maps otherwise.
const classify =
  (entries: Record<string, SharedTokenClass>) =>
    (token: string): SharedTokenClass =>
      entries[token.toLowerCase()] ?? 'unknown';

describe('aggregateTokenHoldings erc20', () => {
  it('nets rows by direction and counts contributing rows', () => {
    const result = aggregateTokenHoldings(
      [
        row({ value: '100', direction: 'in' }),
        row({ value: '30', direction: 'out' }),
        row({ value: '10', direction: 'in' }),
      ],
      classify({ [TOKEN_A]: 'erc20' }),
    );
    expect(result).toEqual([
      { kind: 'erc20', token: TOKEN_A, net: 80n, transferCount: 3 },
    ]);
  });

  it('drops holdings whose net cancels to zero', () => {
    const result = aggregateTokenHoldings(
      [row({ value: '100', direction: 'in' }), row({ value: '100', direction: 'out' })],
      classify({ [TOKEN_A]: 'erc20' }),
    );
    expect(result).toEqual([]);
  });

  it('skips rows with non-decimal values entirely', () => {
    const result = aggregateTokenHoldings(
      [
        row({ value: '100', direction: 'in' }),
        row({ value: 'abc', direction: 'in' }),
        row({ value: '', direction: 'in' }),
        row({ value: '0x10', direction: 'in' }),
        row({ value: '-5', direction: 'in' }),
      ],
      classify({ [TOKEN_A]: 'erc20' }),
    );
    expect(result).toEqual([
      { kind: 'erc20', token: TOKEN_A, net: 100n, transferCount: 1 },
    ]);
  });

  it('keeps values beyond 2^53 exact', () => {
    const huge = '340282366920938463463374607431768211456'; // 2^128
    const result = aggregateTokenHoldings(
      [
        row({ value: huge, direction: 'in' }),
        row({ value: '9007199254740993', direction: 'out' }), // 2^53 + 1
      ],
      classify({ [TOKEN_A]: 'erc20' }),
    );
    expect(result).toEqual([
      {
        kind: 'erc20',
        token: TOKEN_A,
        net: BigInt(huge) - 9007199254740993n,
        transferCount: 2,
      },
    ]);
  });
});

describe('aggregateTokenHoldings erc721', () => {
  it('holds an id whose in/out counts stay positive and dedupes it', () => {
    const result = aggregateTokenHoldings(
      [
        row({ value: '7', direction: 'in' }),
        row({ value: '7', direction: 'in' }),
        row({ value: '7', direction: 'out' }),
        row({ value: '8', direction: 'in' }),
        row({ value: '8', direction: 'out' }),
        row({ value: '8', direction: 'out' }),
      ],
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(result).toEqual([
      { kind: 'erc721', token: TOKEN_A, heldIds: ['7'], transferCount: 6 },
    ]);
  });

  it('drops holdings when every id cancels out', () => {
    const result = aggregateTokenHoldings(
      [
        row({ value: '9', direction: 'in' }),
        row({ value: '9', direction: 'out' }),
        row({ value: '9', direction: 'out' }),
        row({ value: '9', direction: 'in' }),
      ],
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(result).toEqual([]);
  });

  it('sorts held ids numerically with numeric ids before everything else', () => {
    const result = aggregateTokenHoldings(
      [
        row({ value: '10', direction: 'in' }),
        row({ value: '2', direction: 'in' }),
        row({ value: '0x1f', direction: 'in' }),
        row({ value: 'zzz', direction: 'in' }),
        row({ value: '1000000000000000000000000000001', direction: 'in' }),
      ],
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(result).toEqual([
      {
        kind: 'erc721',
        token: TOKEN_A,
        heldIds: ['2', '10', '1000000000000000000000000000001', '0x1f', 'zzz'],
        transferCount: 5,
      },
    ]);
  });
});

describe('aggregateTokenHoldings erc1155', () => {
  it('aggregates single rows with id and amount fallbacks', () => {
    const result = aggregateTokenHoldings(
      [
        row({ standard: 'erc1155-single', tokenIds: ['3'], amounts: ['50'], direction: 'in' }),
        // Missing tokenIds/amounts: id falls back to '?', amount to value.
        row({ standard: 'erc1155-single', value: '20', direction: 'in' }),
        // Empty arrays: same fallbacks, direction out.
        row({ standard: 'erc1155-single', tokenIds: [], amounts: [], value: '5', direction: 'out' }),
      ],
      classify({}),
    );
    expect(result).toEqual([
      { kind: 'erc1155', token: TOKEN_A, tokenId: '3', net: 50n, transferCount: 3 },
      { kind: 'erc1155', token: TOKEN_A, tokenId: '?', net: 15n, transferCount: 3 },
    ]);
  });

  it('skips single rows with unparseable amounts', () => {
    const result = aggregateTokenHoldings(
      [
        row({ standard: 'erc1155-single', tokenIds: ['1'], amounts: ['abc'], direction: 'in' }),
        row({ standard: 'erc1155-single', tokenIds: ['1'], value: '0x10', direction: 'in' }),
        row({ standard: 'erc1155-single', tokenIds: ['1'], amounts: ['7'], direction: 'in' }),
      ],
      classify({}),
    );
    expect(result).toEqual([
      { kind: 'erc1155', token: TOKEN_A, tokenId: '1', net: 7n, transferCount: 1 },
    ]);
  });

  it('zips batch slots, skipping unparseable ones and taking the min length', () => {
    const result = aggregateTokenHoldings(
      [
        row({
          standard: 'erc1155-batch',
          tokenIds: ['1', '2', '3'],
          amounts: ['10', 'abc', '30'],
          direction: 'in',
        }),
        // amounts shorter than ids: only id '1' gets the out amount.
        row({ standard: 'erc1155-batch', tokenIds: ['1', '2'], amounts: ['5'], direction: 'out' }),
        // ids shorter than amounts: only id '2' gets the in amount.
        row({ standard: 'erc1155-batch', tokenIds: ['2'], amounts: ['2', '99'], direction: 'in' }),
      ],
      classify({}),
    );
    expect(result).toEqual([
      { kind: 'erc1155', token: TOKEN_A, tokenId: '3', net: 30n, transferCount: 3 },
      { kind: 'erc1155', token: TOKEN_A, tokenId: '1', net: 5n, transferCount: 3 },
      { kind: 'erc1155', token: TOKEN_A, tokenId: '2', net: 2n, transferCount: 3 },
    ]);
  });

  it('drops zero nets per (token, id) and keeps nonzero ones, negative included', () => {
    const result = aggregateTokenHoldings(
      [
        row({ standard: 'erc1155-single', tokenIds: ['9'], amounts: ['40'], direction: 'in' }),
        row({ standard: 'erc1155-single', tokenIds: ['9'], amounts: ['40'], direction: 'out' }),
        row({ standard: 'erc1155-single', tokenIds: ['8'], amounts: ['10'], direction: 'in' }),
        row({ standard: 'erc1155-single', tokenIds: ['7'], amounts: ['3'], direction: 'in' }),
        row({ standard: 'erc1155-single', tokenIds: ['7'], amounts: ['9'], direction: 'out' }),
      ],
      classify({}),
    );
    expect(result).toEqual([
      { kind: 'erc1155', token: TOKEN_A, tokenId: '8', net: 10n, transferCount: 5 },
      { kind: 'erc1155', token: TOKEN_A, tokenId: '7', net: -6n, transferCount: 5 },
    ]);
  });

  it('merges transfer counts across single and batch rows of one token', () => {
    const result = aggregateTokenHoldings(
      [
        row({ standard: 'erc1155-single', tokenIds: ['1'], amounts: ['1'], direction: 'in' }),
        row({ standard: 'erc1155-batch', tokenIds: ['2'], amounts: ['2'], direction: 'in' }),
      ],
      classify({}),
    );
    expect(result).toEqual([
      { kind: 'erc1155', token: TOKEN_A, tokenId: '2', net: 2n, transferCount: 2 },
      { kind: 'erc1155', token: TOKEN_A, tokenId: '1', net: 1n, transferCount: 2 },
    ]);
  });
});

describe('aggregateTokenHoldings unclassified', () => {
  it('routes unknown-classified tokens with erc20 net semantics', () => {
    const result = aggregateTokenHoldings(
      [
        row({ value: '1000', direction: 'in' }),
        row({ value: '250', direction: 'out' }),
      ],
      classify({}),
    );
    expect(result).toEqual([
      { kind: 'unclassified', token: TOKEN_A, net: 750n, transferCount: 2 },
    ]);
  });

  it('drops unknown-classified holdings that cancel to zero', () => {
    const result = aggregateTokenHoldings(
      [row({ value: '42', direction: 'in' }), row({ value: '42', direction: 'out' })],
      classify({}),
    );
    expect(result).toEqual([]);
  });

  it('skips rows with unparseable values', () => {
    const result = aggregateTokenHoldings(
      [
        row({ value: '100', direction: 'in' }),
        row({ value: 'xyz', direction: 'in' }),
      ],
      classify({}),
    );
    expect(result).toEqual([
      { kind: 'unclassified', token: TOKEN_A, net: 100n, transferCount: 1 },
    ]);
  });

  it('splits mixed classifications across buckets in one run', () => {
    const result = aggregateTokenHoldings(
      [
        row({ value: '10', direction: 'in' }),
        row({ token: TOKEN_B, value: '20', direction: 'in' }),
      ],
      classify({ [TOKEN_A]: 'erc20' }),
    );
    expect(result).toEqual([
      { kind: 'erc20', token: TOKEN_A, net: 10n, transferCount: 1 },
      { kind: 'unclassified', token: TOKEN_B, net: 20n, transferCount: 1 },
    ]);
  });
});

describe('aggregateTokenHoldings grouping and ordering', () => {
  it('groups rows by lowercased token and keeps the first-seen spelling', () => {
    const result = aggregateTokenHoldings(
      [
        row({ token: TOKEN_UPPER_A, value: '10', direction: 'in' }),
        row({ value: '4', direction: 'out' }),
      ],
      classify({ [TOKEN_A]: 'erc20' }),
    );
    expect(result).toEqual([
      { kind: 'erc20', token: TOKEN_UPPER_A, net: 6n, transferCount: 2 },
    ]);
  });

  it('sorts by transferCount desc, then lowercase token asc', () => {
    const TOKEN_Z = `0x${'Z'.repeat(40)}`;
    const result = aggregateTokenHoldings(
      [
        // TOKEN_Z: 2 rows. Uppercase 'Z' < lowercase 'a' byte-wise, but the
        // lowercase comparison must still put TOKEN_A first.
        row({ token: TOKEN_Z, value: '1', direction: 'in' }),
        row({ token: TOKEN_Z, value: '1', direction: 'in' }),
        row({ value: '1', direction: 'in' }),
        row({ value: '1', direction: 'in' }),
        // TOKEN_B: 3 rows, most transfers.
        row({ token: TOKEN_B, value: '1', direction: 'in' }),
        row({ token: TOKEN_B, value: '1', direction: 'in' }),
        row({ token: TOKEN_B, value: '1', direction: 'in' }),
      ],
      classify({ [TOKEN_A]: 'erc20', [TOKEN_Z]: 'erc20', [TOKEN_B]: 'erc20' }),
    );
    expect(result.map((h) => h.token)).toEqual([TOKEN_B, TOKEN_A, TOKEN_Z]);
  });

  it('orders erc1155 entries of one token by |net| desc then id asc', () => {
    const result = aggregateTokenHoldings(
      [
        row({ standard: 'erc1155-single', tokenIds: ['10'], amounts: ['5'], direction: 'in' }),
        row({ standard: 'erc1155-single', tokenIds: ['2'], amounts: ['5'], direction: 'in' }),
        row({ standard: 'erc1155-single', tokenIds: ['3'], amounts: ['100'], direction: 'in' }),
        row({ standard: 'erc1155-single', tokenIds: ['1'], amounts: ['5'], direction: 'in' }),
      ],
      classify({}),
    );
    expect(result.map((h) => (h.kind === 'erc1155' ? h.tokenId : null))).toEqual([
      '3',
      '1',
      '2',
      '10',
    ]);
  });

  it('returns an empty list for no transfers', () => {
    expect(aggregateTokenHoldings([], classify({}))).toEqual([]);
  });
});

describe('estimateHoldingsUsd', () => {
  const price = (usd: number, fetchedAt = 1_000) => ({ usd, fetchedAt });

  it('sums only rows with both decimals and a usable price', () => {
    // 1.5 tokens (18 decimals) at $2 and 3 tokens (6 decimals) at $1.5.
    const estimate = estimateHoldingsUsd([
      { amount: 15n * 10n ** 17n, decimals: 18, price: price(2) },
      { amount: 3n * 10n ** 6n, decimals: 6, price: price(1.5) },
    ]);

    expect(estimate).not.toBeNull();
    expect(estimate?.totalUsd).toBe(7.5);
    expect(estimate?.pricedTokens).toBe(2);
    expect(estimate?.erc20Tokens).toBe(2);
  });

  it('returns null when no row priced — the card renders nothing', () => {
    expect(
      estimateHoldingsUsd([
        { amount: 1n, decimals: 18, price: null },
        { amount: 1n, decimals: 18, price: undefined },
        // Unpriced by missing decimals too (cannot value honestly).
        { amount: 1n, decimals: undefined, price: price(2) },
      ]),
    ).toBeNull();
  });

  it('counts unpriced rows against erc20Tokens for the partial-pricing caveat', () => {
    const estimate = estimateHoldingsUsd([
      { amount: 10n ** 18n, decimals: 18, price: price(2) },
      { amount: 10n ** 18n, decimals: 18, price: null },
    ]);

    expect(estimate?.pricedTokens).toBe(1);
    expect(estimate?.erc20Tokens).toBe(2);
  });

  it('carries the newest fetch timestamp backing the total', () => {
    const estimate = estimateHoldingsUsd([
      { amount: 10n ** 18n, decimals: 18, price: price(2, 1_000) },
      { amount: 10n ** 18n, decimals: 18, price: price(3, 5_000) },
    ]);

    expect(estimate?.fetchedAt).toBe(5_000);
  });

  it('returns null for an empty row list', () => {
    expect(estimateHoldingsUsd([])).toBeNull();
  });
});
