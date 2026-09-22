// Unit tests for the pure NFT-holdings aggregation: 721 per-id set math,
// 1155 BigInt amount deltas (incl. the negative-net clamp + flag),
// shared-signature classification handling, party matching by from/to,
// and the documented deterministic ordering.
import { describe, it, expect } from 'vitest';

import { aggregateNftHoldings, type NftContractHolding } from '@/views/Address/nftHoldings';
import type { SharedTokenClass } from '@/views/Address/holdings';
import type { TokenTransfer } from '@/services/tokenTransfers';

const TOKEN_A = `0x${'a'.repeat(40)}`;
const TOKEN_B = `0x${'b'.repeat(40)}`;
const TOKEN_C = `0x${'c'.repeat(40)}`;
const HOLDER = '0x1234567890abcdef1234567890abcdef12345678';
// Checksummed spelling of HOLDER (same bytes) — party matching and
// grouping must be case-insensitive.
const HOLDER_CHECKSUMMED = '0x1234567890AbCdEf1234567890aBcDeF12345678';
const OTHER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function row(fields: Partial<TokenTransfer>): TokenTransfer {
  return {
    txHash: '0xdead',
    blockNumber: 1,
    logIndex: 0,
    token: TOKEN_A,
    standard: 'erc20-or-erc721',
    from: OTHER,
    to: HOLDER,
    value: '0',
    direction: 'in',
    ...fields,
  };
}

// Injected classification stub: unknown unless the token maps otherwise.
const classify =
  (entries: Record<string, SharedTokenClass>) =>
    (token: string): SharedTokenClass =>
      entries[token.toLowerCase()] ?? 'unknown';

// Discriminated-union narrowing helpers (fail loudly if the shape drifts).
const asErc721 = (holding: NftContractHolding | undefined) => {
  if (holding?.standard !== 'erc721') {
    throw new Error(`expected an erc721 holding, got ${JSON.stringify(holding)}`);
  }
  return holding;
};

const asErc1155 = (holding: NftContractHolding | undefined) => {
  if (holding?.standard !== 'erc1155') {
    throw new Error(`expected an erc1155 holding, got ${JSON.stringify(holding)}`);
  }
  return holding;
};

describe('aggregateNftHoldings erc721 set math', () => {
  it('holds an id once regardless of how many times it was received', () => {
    const result = aggregateNftHoldings(
      [row({ value: '7' }), row({ value: '7', blockNumber: 2 })],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(result.holdings).toEqual([
      {
        standard: 'erc721',
        contract: TOKEN_A,
        heldIds: ['7'],
        heldCount: 1,
        sampleIds: ['7'],
        lastActivityBlock: 2,
      },
    ]);
    expect(result.unclassifiedTransfers).toBe(0);
  });

  it('drops an id that was received then spent (net zero)', () => {
    const result = aggregateNftHoldings(
      [row({ value: '9' }), row({ value: '9', from: HOLDER, to: OTHER })],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    // The contract keeps its (zero-held) entry: the scanned activity is
    // real even when nothing is currently held.
    expect(result.holdings).toEqual([
      {
        standard: 'erc721',
        contract: TOKEN_A,
        heldIds: [],
        heldCount: 0,
        sampleIds: [],
        lastActivityBlock: 1,
      },
    ]);
  });

  it('re-buys back to held (in, out, in nets positive)', () => {
    const result = aggregateNftHoldings(
      [
        row({ value: '5' }),
        row({ value: '5', from: HOLDER, to: OTHER }),
        row({ value: '5' }),
      ],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(asErc721(result.holdings[0]).heldIds).toEqual(['5']);
    expect(asErc721(result.holdings[0]).heldCount).toBe(1);
  });

  it('treats a send-only id as not held (pre-window acquisition)', () => {
    const result = aggregateNftHoldings(
      [row({ value: '3', from: HOLDER, to: OTHER })],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(asErc721(result.holdings[0]).heldIds).toEqual([]);
    expect(asErc721(result.holdings[0]).heldCount).toBe(0);
  });

  it('derives in/out from from/to, case-insensitively, ignoring the direction tag', () => {
    // direction tags deliberately contradict from/to: the pure function
    // must trust the parties, not the tag.
    const result = aggregateNftHoldings(
      [
        row({ value: '1', to: HOLDER_CHECKSUMMED, direction: 'out' }),
        row({ value: '2', from: HOLDER_CHECKSUMMED, to: OTHER, direction: 'in' }),
        row({ value: '3', to: HOLDER, direction: 'out' }),
      ],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    // ids 1 and 3 received; id 2 sent — never received.
    expect(asErc721(result.holdings[0]).heldIds).toEqual(['1', '3']);
  });

  it('sorts held ids numerically and samples only the first three', () => {
    const result = aggregateNftHoldings(
      [10, 9, 2, 1].map(value => row({ value: String(value) })),
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(asErc721(result.holdings[0]).heldIds).toEqual(['1', '2', '9', '10']);
    expect(result.holdings[0]?.sampleIds).toEqual(['1', '2', '9']);
    expect(asErc721(result.holdings[0]).heldCount).toBe(4);
  });

  it('groups by lowercased contract and keeps the first-seen spelling', () => {
    const upper = `0x${'A'.repeat(40)}`;
    const result = aggregateNftHoldings(
      [row({ token: TOKEN_A, value: '1' }), row({ token: upper, value: '2' })],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(result.holdings).toHaveLength(1);
    expect(asErc721(result.holdings[0]).contract).toBe(TOKEN_A);
    expect(asErc721(result.holdings[0]).heldIds).toEqual(['1', '2']);
  });
});

describe('aggregateNftHoldings erc1155 amount deltas', () => {
  const single = (fields: Partial<TokenTransfer>) =>
    row({ standard: 'erc1155-single', ...fields });

  it('nets single-log amounts BigInt-exactly across rows', () => {
    const result = aggregateNftHoldings(
      [
        single({ tokenIds: ['5'], amounts: ['10'], value: '10' }),
        single({ tokenIds: ['5'], amounts: ['3'], value: '3', from: HOLDER, to: OTHER }),
      ],
      HOLDER,
      classify({}),
    );
    expect(result.holdings).toEqual([
      {
        standard: 'erc1155',
        contract: TOKEN_A,
        balances: [{ tokenId: '5', amount: 7n }],
        heldCount: 1,
        totalUnits: 7n,
        sampleIds: ['5'],
        lastActivityBlock: 1,
        dataInconsistent: false,
      },
    ]);
  });

  it('falls back to the raw value when a single log carries no amounts', () => {
    const result = aggregateNftHoldings(
      [single({ tokenIds: ['8'], value: '12', amounts: undefined })],
      HOLDER,
      classify({}),
    );
    expect(asErc1155(result.holdings[0]).balances).toEqual([{ tokenId: '8', amount: 12n }]);
  });

  it('zips batch ids with amounts and drops net-zero ids', () => {
    const result = aggregateNftHoldings(
      [
        row({
          standard: 'erc1155-batch',
          tokenIds: ['1', '2', '3'],
          amounts: ['5', '0', '2'],
          value: '7',
        }),
      ],
      HOLDER,
      classify({}),
    );
    expect(asErc1155(result.holdings[0]).balances).toEqual([
      { tokenId: '1', amount: 5n },
      { tokenId: '3', amount: 2n },
    ]);
    expect(asErc1155(result.holdings[0]).heldCount).toBe(2);
    expect(asErc1155(result.holdings[0]).totalUnits).toBe(7n);
    expect(asErc1155(result.holdings[0]).dataInconsistent).toBe(false);
  });

  it('keeps values beyond 2^53 exact (BigInt, never floats)', () => {
    const huge = '340282366920938463463374607431768211456'; // 2^128
    const result = aggregateNftHoldings(
      [
        single({ tokenIds: ['1'], amounts: [huge] }),
        single({ tokenIds: ['1'], amounts: ['1'], from: HOLDER, to: OTHER }),
        single({ tokenIds: ['2'], amounts: ['9007199254740993'] }), // 2^53 + 1
      ],
      HOLDER,
      classify({}),
    );
    expect(asErc1155(result.holdings[0]).balances).toEqual([
      { tokenId: '1', amount: BigInt(huge) - 1n },
      { tokenId: '2', amount: 9007199254740993n },
    ]);
    expect(asErc1155(result.holdings[0]).totalUnits).toBe(BigInt(huge) - 1n + 9007199254740993n);
  });

  it('clamps negative nets to not-held and flags dataInconsistent', () => {
    const result = aggregateNftHoldings(
      [
        // id 4: sent 10, received 2 → net -8 (pre-window acquisition).
        single({ tokenIds: ['4'], amounts: ['10'], from: HOLDER, to: OTHER }),
        single({ tokenIds: ['4'], amounts: ['2'] }),
        // id 6: cleanly held.
        single({ tokenIds: ['6'], amounts: ['1'] }),
      ],
      HOLDER,
      classify({}),
    );
    expect(result.holdings).toHaveLength(1);
    expect(asErc1155(result.holdings[0]).balances).toEqual([{ tokenId: '6', amount: 1n }]);
    expect(asErc1155(result.holdings[0]).heldCount).toBe(1);
    expect(asErc1155(result.holdings[0]).totalUnits).toBe(1n);
    expect(asErc1155(result.holdings[0]).dataInconsistent).toBe(true);
  });

  it('emits a zero-held flagged entry when every net is negative', () => {
    const result = aggregateNftHoldings(
      [single({ tokenIds: ['4'], amounts: ['10'], from: HOLDER, to: OTHER })],
      HOLDER,
      classify({}),
    );
    // The clamp must stay VISIBLE — a vanished contract would hide it.
    expect(result.holdings).toHaveLength(1);
    expect(asErc1155(result.holdings[0]).heldCount).toBe(0);
    expect(asErc1155(result.holdings[0]).totalUnits).toBe(0n);
    expect(asErc1155(result.holdings[0]).dataInconsistent).toBe(true);
  });

  it('skips rows whose amounts never parse', () => {
    const result = aggregateNftHoldings(
      [
        single({ tokenIds: ['5'], amounts: ['abc'] }),
        single({ tokenIds: ['6'], amounts: [''] }),
        row({ standard: 'erc1155-batch', tokenIds: ['7'], amounts: ['-1'] }),
      ],
      HOLDER,
      classify({}),
    );
    expect(result.holdings).toEqual([]);
    expect(result.unclassifiedTransfers).toBe(0);
  });
});

describe('aggregateNftHoldings classification and party filter', () => {
  it('ignores erc20-classified rows silently (not NFT, not unclassified)', () => {
    const result = aggregateNftHoldings(
      [row({ value: '100' }), row({ value: '200', blockNumber: 3 })],
      HOLDER,
      classify({ [TOKEN_A]: 'erc20' }),
    );
    expect(result.holdings).toEqual([]);
    expect(result.unclassifiedTransfers).toBe(0);
  });

  it('counts unknown-classified shared rows without aggregating them', () => {
    const result = aggregateNftHoldings(
      [row({ value: '7' }), row({ token: TOKEN_B, value: '8' })],
      HOLDER,
      classify({}),
    );
    expect(result.holdings).toEqual([]);
    expect(result.unclassifiedTransfers).toBe(2);
  });

  it('ignores rows where the address is neither sender nor recipient', () => {
    const result = aggregateNftHoldings(
      [
        row({ from: OTHER, to: '0x9999999999999999999999999999999999999999' }),
        row({ standard: 'erc1155-single', tokenIds: ['1'], amounts: ['5'], from: OTHER, to: OTHER }),
      ],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(result.holdings).toEqual([]);
    expect(result.unclassifiedTransfers).toBe(0);
  });

  it('nets self-transfers to zero without special-casing', () => {
    const result = aggregateNftHoldings(
      [row({ value: '7', from: HOLDER, to: HOLDER })],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(asErc721(result.holdings[0]).heldIds).toEqual([]);
  });
});

describe('aggregateNftHoldings ordering', () => {
  it('sorts by heldCount desc, then contract address asc — regardless of row order', () => {
    // TOKEN_B appears first and holds MORE ids; TOKEN_A holds fewer;
    // TOKEN_C ties with TOKEN_A and sorts after it by address.
    const result = aggregateNftHoldings(
      [
        row({ token: TOKEN_B, value: '1' }),
        row({ token: TOKEN_B, value: '2' }),
        row({ token: TOKEN_A, value: '9' }),
        row({ token: TOKEN_C, value: '4' }),
      ],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721', [TOKEN_B]: 'erc721', [TOKEN_C]: 'erc721' }),
    );
    expect(result.holdings.map(holding => holding.contract)).toEqual([
      TOKEN_B,
      TOKEN_A,
      TOKEN_C,
    ]);
    expect(result.holdings.map(holding => holding.heldCount)).toEqual([2, 1, 1]);
  });

  it('orders mixed-standard contracts deterministically on heldCount ties', () => {
    const result = aggregateNftHoldings(
      [
        row({ token: TOKEN_B, standard: 'erc1155-single', tokenIds: ['1'], amounts: ['4'] }),
        row({ token: TOKEN_A, value: '2' }),
      ],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(result.holdings.map(holding => holding.standard)).toEqual([
      'erc721',
      'erc1155',
    ]);
  });

  it('reports lastActivityBlock as the latest contributing row per contract', () => {
    const result = aggregateNftHoldings(
      [
        row({ token: TOKEN_A, value: '1', blockNumber: 5 }),
        row({ token: TOKEN_A, value: '2', blockNumber: 40, from: HOLDER, to: OTHER }),
        row({ token: TOKEN_A, value: '3', blockNumber: 12 }),
      ],
      HOLDER,
      classify({ [TOKEN_A]: 'erc721' }),
    );
    expect(asErc721(result.holdings[0]).lastActivityBlock).toBe(40);
  });
});
