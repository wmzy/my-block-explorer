// Unit tests for the Token page's pure math: the ranked holders with
// share-of-discovered-supply percentages and the mint/burn aggregation
// over token-mode scan rows. BigInt-exactness is the point — fixtures use
// values past 2^53 so a Number-float implementation would fail — plus the
// empty-scan / zero-net / zero-address-sentinel edge cases.
import { describe, it, expect } from 'vitest';

import type { TokenTransfer } from '@/services/tokenTransfers';
import {
  aggregateMintBurn,
  formatSharePct,
  rankHolderShares,
} from '@/views/Token/tokenMath';

const TOKEN = `0x${'aa'.repeat(20)}`;
const OTHER_TOKEN = `0x${'bb'.repeat(20)}`;
const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CAROL = '0x3333333333333333333333333333333333333333';
const ZERO = '0x0000000000000000000000000000000000000000';

// Token-mode row shape: the viewed contract emitted the log (token ===
// TOKEN, direction 'none') — exactly what the scan hands the page.
function row(fields: Partial<TokenTransfer>): TokenTransfer {
  return {
    txHash: `0x${'00'.repeat(32)}`,
    blockNumber: 18_000_000,
    logIndex: 0,
    token: TOKEN,
    standard: 'erc20-or-erc721',
    from: ALICE,
    to: BOB,
    value: '1',
    direction: 'none',
    ...fields,
  };
}

describe('rankHolderShares', () => {
  it('returns an empty ranking and zero supply for an empty scan', () => {
    const result = rankHolderShares([], TOKEN, true);
    expect(result.shares).toEqual([]);
    expect(result.discoveredSupply).toBe(0n);
    expect(result.excludedTransfers).toBe(0);
  });

  it('drops participants whose nets cancel to zero (zero-net holders)', () => {
    const result = rankHolderShares(
      [
        row({ from: ALICE, to: BOB, value: '5' }),
        row({ from: BOB, to: ALICE, value: '5' }),
      ],
      TOKEN,
      true,
    );
    expect(result.shares).toEqual([]);
    expect(result.discoveredSupply).toBe(0n);
  });

  it('nets, ranks and shares a mint/transfer/burn fixture BigInt-exactly', () => {
    // Mint 1000 to Alice; Alice sends 400 to Bob and 50 to Carol; Bob
    // burns 100. Nets: Alice +550, Bob +300, Carol +50 → supply 900.
    const result = rankHolderShares(
      [
        row({ from: ZERO, to: ALICE, value: '1000' }),
        row({ from: ALICE, to: BOB, value: '400' }),
        row({ from: BOB, to: ZERO, value: '100' }),
        row({ from: ALICE, to: CAROL, value: '50' }),
      ],
      TOKEN,
      true,
    );
    expect(result.discoveredSupply).toBe(900n);
    expect(result.shares.map(s => s.address)).toEqual([ALICE, BOB, CAROL]);
    expect(result.shares.map(s => s.net)).toEqual([550n, 300n, 50n]);
    // Truncated basis points: 550*10000/900 = 6111.11 → 6111, etc.
    expect(result.shares.map(s => s.shareBps)).toEqual([6111, 3333, 555]);
  });

  it('stays exact for values past 2^53 (no Number float math)', () => {
    // 2^80 and 2^79 are far past Number's safe integer range; two mints
    // keep the nets distinct so the ranking is deterministic.
    const mintedAlice = 2n ** 80n;
    const mintedBob = 2n ** 79n;
    const result = rankHolderShares(
      [
        row({ from: ZERO, to: ALICE, value: mintedAlice.toString() }),
        row({ from: ZERO, to: BOB, value: mintedBob.toString() }),
      ],
      TOKEN,
      true,
    );
    expect(result.discoveredSupply).toBe(mintedAlice + mintedBob);
    expect(result.shares.map(s => s.net)).toEqual([mintedAlice, mintedBob]);
    // 2^80 / (2^80 + 2^79) = 2/3 → 6666 bps (truncated); 1/3 → 3333.
    expect(result.shares.map(s => s.shareBps)).toEqual([6666, 3333]);
  });

  it('caps the ranking at topN but divides by the FULL discovered supply', () => {
    // 12 recipients of 1..12 units (12 distinct mints) — top 10 excludes
    // the two smallest nets, yet the denominator stays 78 (sum of all).
    const transfers = Array.from({ length: 12 }, (_, i) =>
      row({ from: ZERO, to: `0x${(i + 1).toString(16).padStart(40, '0')}`, value: String(i + 1) }),
    );
    const result = rankHolderShares(transfers, TOKEN, true, 10);
    expect(result.shares).toHaveLength(10);
    expect(result.discoveredSupply).toBe(78n);
    // Strongest net is 12: 12*10000/78 = 1538.46 → 1538 (truncated).
    expect(result.shares[0]?.net).toBe(12n);
    expect(result.shares[0]?.shareBps).toBe(1538);
    // The excluded nets (1, 2) must not appear in the ranking.
    expect(result.shares.some(s => s.net === 1n || s.net === 2n)).toBe(false);
  });

  it('gives negative-net participants no share (they hold nothing)', () => {
    // Alice distributes 10 she never received within the window: her net
    // is -10, Bob ends with +10 — only positive nets form the supply.
    const result = rankHolderShares(
      [row({ from: ALICE, to: BOB, value: '10' })],
      TOKEN,
      true,
    );
    expect(result.shares.map(s => s.address)).toEqual([BOB, ALICE]);
    expect(result.discoveredSupply).toBe(10n);
    expect(result.shares[0]?.shareBps).toBe(10000);
    expect(result.shares[1]?.shareBps).toBeNull();
  });

  it('never ranks the zero-address sentinel as a holder', () => {
    const result = rankHolderShares(
      [row({ from: ZERO, to: ALICE, value: '100' })],
      TOKEN,
      true,
    );
    expect(result.shares.map(s => s.address)).toEqual([ALICE]);
  });

  it('ignores other tokens entirely and counts non-ERC-20 rows as excluded', () => {
    const result = rankHolderShares(
      [
        row({ token: OTHER_TOKEN, from: ZERO, to: ALICE, value: '100' }),
        row({ standard: 'erc1155-single', tokenIds: ['7'], from: ZERO, to: BOB, value: '1' }),
      ],
      TOKEN,
      true,
    );
    expect(result.shares).toEqual([]);
    expect(result.discoveredSupply).toBe(0n);
    expect(result.excludedTransfers).toBe(1);
  });

  it('excludes every row when the standard is not ERC-20-proven', () => {
    const result = rankHolderShares(
      [row({ from: ZERO, to: ALICE, value: '100' })],
      TOKEN,
      false,
    );
    expect(result.shares).toEqual([]);
    expect(result.excludedTransfers).toBe(1);
  });
});

describe('aggregateMintBurn', () => {
  it('returns zero counts and sums for an empty scan', () => {
    expect(aggregateMintBurn([], TOKEN, true)).toEqual({
      mintCount: 0,
      burnCount: 0,
      minted: 0n,
      burned: 0n,
      excludedTransfers: 0,
    });
  });

  it('counts and sums mints and burns BigInt-exactly', () => {
    const result = aggregateMintBurn(
      [
        row({ from: ZERO, to: ALICE, value: '1000' }),
        row({ from: ALICE, to: BOB, value: '400' }),
        row({ from: BOB, to: ZERO, value: '100' }),
      ],
      TOKEN,
      true,
    );
    // The plain transfer (neither mint nor burn) touches nothing.
    expect(result.mintCount).toBe(1);
    expect(result.burnCount).toBe(1);
    expect(result.minted).toBe(1000n);
    expect(result.burned).toBe(100n);
    expect(result.excludedTransfers).toBe(0);
  });

  it('stays exact for sums past 2^53', () => {
    const a = 2n ** 80n;
    const b = 2n ** 79n + 1n;
    const result = aggregateMintBurn(
      [
        row({ from: ZERO, to: ALICE, value: a.toString() }),
        row({ from: ZERO, to: BOB, value: b.toString() }),
        row({ from: ALICE, to: ZERO, value: b.toString() }),
      ],
      TOKEN,
      true,
    );
    expect(result.mintCount).toBe(2);
    expect(result.burnCount).toBe(1);
    expect(result.minted).toBe(a + b);
    expect(result.burned).toBe(b);
  });

  it('treats a from-and-to zero-address row as both a mint and a burn', () => {
    const result = aggregateMintBurn(
      [row({ from: ZERO, to: ZERO, value: '7' })],
      TOKEN,
      true,
    );
    expect(result.mintCount).toBe(1);
    expect(result.burnCount).toBe(1);
    expect(result.minted).toBe(7n);
    expect(result.burned).toBe(7n);
  });

  it('counts events for any standard but sums only ERC-20 rows', () => {
    const result = aggregateMintBurn(
      [
        row({ standard: 'erc1155-single', tokenIds: ['5'], from: ZERO, to: ALICE, value: '3' }),
        row({ from: ZERO, to: BOB, value: 'not-a-number' }),
      ],
      TOKEN,
      true,
    );
    expect(result.mintCount).toBe(2);
    expect(result.burnCount).toBe(0);
    expect(result.minted).toBe(0n);
    expect(result.excludedTransfers).toBe(2);
  });

  it('reports null sums (never a guessed amount) for an unproven standard', () => {
    const result = aggregateMintBurn(
      [row({ from: ZERO, to: ALICE, value: '100' })],
      TOKEN,
      false,
    );
    expect(result.mintCount).toBe(1);
    expect(result.minted).toBeNull();
    expect(result.burned).toBeNull();
    expect(result.excludedTransfers).toBe(1);
  });

  it('ignores other tokens entirely', () => {
    const result = aggregateMintBurn(
      [row({ token: OTHER_TOKEN, from: ZERO, to: ALICE, value: '100' })],
      TOKEN,
      true,
    );
    expect(result.mintCount).toBe(0);
    expect(result.minted).toBe(0n);
  });
});

describe('formatSharePct', () => {
  it('renders basis points as a two-decimal percentage', () => {
    expect(formatSharePct(6111)).toBe('61.11%');
    expect(formatSharePct(3333)).toBe('33.33%');
    expect(formatSharePct(555)).toBe('5.55%');
    expect(formatSharePct(10000)).toBe('100.00%');
    expect(formatSharePct(0)).toBe('0.00%');
  });
});
