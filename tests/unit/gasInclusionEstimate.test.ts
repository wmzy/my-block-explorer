// Inclusion estimates ("~N blocks (est.)") for the Home gas panel tiers:
// the pure wei-exact estimator plus its wiring into the panel's data model.
// Everything here is integer wei — the tests exist largely to pin that no
// gwei float ever round-trips into a comparison.
import { describe, it, expect } from 'vitest';

import {
  buildGasHistory,
  estimateInclusionBlocks,
  estimateTierInclusion,
} from '@/services/gasHistory';

const GWEI = 1_000_000_000n;

// --- pure estimator: p boundaries and rounding ---

describe('estimateInclusionBlocks', () => {
  it('returns undefined for an empty sample — no basis, never a guess', () => {
    expect(estimateInclusionBlocks([], 1n * GWEI)).toBeUndefined();
  });

  it('returns undefined when no sampled block paid at or under the tip (p = 0)', () => {
    expect(estimateInclusionBlocks([2n * GWEI, 3n * GWEI], 1n * GWEI)).toBeUndefined();
  });

  it('a single-block sample is a complete basis when covered', () => {
    expect(estimateInclusionBlocks([5n * GWEI], 5n * GWEI)).toBe(1);
    expect(estimateInclusionBlocks([5n * GWEI], 4n * GWEI)).toBeUndefined();
  });

  it('a fully covered sample (p = 1) is "~1 block", not ceil(1/1) theater', () => {
    expect(estimateInclusionBlocks([1n, 2n * GWEI, 3n * GWEI], 3n * GWEI)).toBe(1);
    expect(estimateInclusionBlocks([0n, 0n], 0n)).toBe(1);
  });

  it('counts a paid tip exactly equal to the tip as included (<=, wei-exact)', () => {
    // Sub-gwei spacing: 1.000000001 vs 1.000000002 gwei.
    expect(
      estimateInclusionBlocks([1_000_000_001n, 1_000_000_002n], 1_000_000_001n),
    ).toBe(2); // 1 of 2 included → ceil(2/1) = 2
  });

  it('compares BigInts exactly where a Number round-trip would collapse them', () => {
    // 2^53 + 1 wei: Number(2^53 + 1) === Number(2^53), so a float path
    // would call these equal and "include" the block. BigInt does not.
    const above = 9_007_199_254_740_993n;
    const at = 9_007_199_254_740_992n;
    expect(estimateInclusionBlocks([above], at)).toBeUndefined();
    // BigInt distinguishes: only `at` counts → 1/2 → 2 blocks. A float
    // path would collapse both to 2^53 → "fully covered" → 1 block.
    expect(estimateInclusionBlocks([above, at], at)).toBe(2);
  });

  it('rounds expected blocks up: ceil(1/p) over a ten-block sample', () => {
    const sample = Array.from({ length: 10 }, (_, i) => BigInt(i + 1) * GWEI);
    expect(estimateInclusionBlocks(sample, 3n * GWEI)).toBe(4); // 3/10 → ceil(10/3)
    expect(estimateInclusionBlocks(sample, 4n * GWEI)).toBe(3); // 4/10 → ceil(2.5)
    expect(estimateInclusionBlocks(sample, 9n * GWEI)).toBe(2); // 9/10 → ceil(10/9)
    expect(estimateInclusionBlocks(sample, 1n * GWEI)).toBe(10); // 1/10 → 10
  });
});

// --- per-tier derivation from the fee-history rewards ---

describe('estimateTierInclusion', () => {
  it('is null exactly when there is no usable reward sample', () => {
    expect(estimateTierInclusion(undefined)).toBeNull();
    expect(estimateTierInclusion([])).toBeNull();
    expect(estimateTierInclusion([[], [], []])).toBeNull();
    expect(estimateTierInclusion([[1n, 2n]])).toBeNull();
  });

  it('derives each tier against the sampled blocks’ median paid tip', () => {
    // Two usable blocks: [p25, p50, p75] = [1G,2G,10G] and [3G,4G,10G].
    // Tips: slow = avg p25 = 2G, standard = avg p50 = 3G, fast = 10G.
    // Paid tips (p50 column): 2G and 4G.
    const rewards = [[1n * GWEI, 2n * GWEI, 10n * GWEI], [3n * GWEI, 4n * GWEI, 10n * GWEI]];
    expect(estimateTierInclusion(rewards)).toEqual({
      sampleBlocks: 2,
      slow: 2, // only the first block's 2G ≤ 2G → 1/2 → 2 blocks
      standard: 2, // 2G ≤ 3G only → 1/2 → 2 blocks
      fast: 1, // both covered → 1 block
    });
  });

  it('skips incomplete triples inside the window and reports the usable count', () => {
    const rewards = [
      [], // incomplete → excluded from the sample
      [1n * GWEI, 2n * GWEI, 10n * GWEI],
      [3n * GWEI, 4n * GWEI, 10n * GWEI],
    ];
    const estimate = estimateTierInclusion(rewards, 3);
    expect(estimate?.sampleBlocks).toBe(2);
    expect(estimate?.slow).toBe(2);
  });

  it('samples only the newest blocks, like the tier averages do', () => {
    // Two ancient blocks with huge paid tips sit outside the 4-block
    // window; if the slicing leaked, standard could not be "~1 block".
    const ancient = [100n * GWEI, 200n * GWEI, 300n * GWEI];
    const calm = [1n * GWEI, 2n * GWEI, 3n * GWEI];
    const rewards = [ancient, ancient, calm, calm, calm, calm];
    expect(estimateTierInclusion(rewards, 4)).toEqual({
      sampleBlocks: 4,
      // slow tip = avg p25 = 1G never reached a block’s 2G median: the
      // sample gives the slow tier no basis at all → no estimate, no guess.
      slow: undefined,
      standard: 1, // tip 2G == every sampled median → covered
      fast: 1,
    });
  });

  it('stays wei-exact when a tier average is fractional wei', () => {
    // p25 column sums to 2G wei over 3 blocks → average 666,666,666.̄6 wei,
    // floor 666,666,666n. The first block’s median (666,666,667n = the
    // ceiling) is ABOVE the true average and must NOT count. A gwei float
    // round-trip (0.6666666666666666 gwei → round → 666,666,667n) would
    // count it and report "~1 block".
    const rewards = [
      [666_666_666n, 666_666_667n, 900_000_000n],
      [666_666_666n, 1n, 900_000_000n],
      [666_666_668n, 5n, 900_000_000n],
    ];
    expect(estimateTierInclusion(rewards, 3)).toEqual({
      sampleBlocks: 3,
      slow: 2, // 2 of 3 medians at or under 666,666,666.̄6 wei
      standard: 2,
      fast: 1, // 666,666,667n ≤ 900,000,000n → all covered
    });
  });
});

// --- snapshot wiring ---

describe('buildGasHistory tierInclusionBlocks', () => {
  it('rides along with the tiers: present when rewards are, null when not', () => {
    const withoutRewards = buildGasHistory(1, {
      oldestBlock: 100n,
      baseFeePerGas: Array.from({ length: 121 }, (_, i) => BigInt(i + 1) * GWEI),
      reward: [],
    });
    expect(withoutRewards.status).toBe('ok');
    if (withoutRewards.status !== 'ok') return;
    expect(withoutRewards.snapshot.tiers).toBeNull();
    expect(withoutRewards.snapshot.tierInclusionBlocks).toBeNull();

    const withRewards = buildGasHistory(1, {
      oldestBlock: 100n,
      baseFeePerGas: [1n * GWEI, 2n * GWEI],
      reward: [[1n * GWEI, 2n * GWEI, 3n * GWEI]],
    });
    expect(withRewards.status).toBe('ok');
    if (withRewards.status !== 'ok') return;
    // One usable block: its 2G median is at or under the standard (2G) and
    // fast (3G) tips but not the slow (1G) tip — slow honestly abstains.
    expect(withRewards.snapshot.tierInclusionBlocks).toEqual({
      sampleBlocks: 1,
      slow: undefined,
      standard: 1,
      fast: 1,
    });
  });
});
