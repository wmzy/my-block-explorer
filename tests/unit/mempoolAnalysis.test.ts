// Pure mempool-analysis tests (utils/mempoolAnalysis): the conflict
// grouping ((from, nonce), case-insensitive), the likely-winner heuristic
// (effective cap with the 1559 tip tie-break, legacy gasPrice, mixed
// groups, fee-less entries), the BigInt-exact index-pick percentiles
// (empty / 1 / 2 / 3 / n entries, values past 2^53), the honest counts,
// and the render plan the grouped view consumes.
import { describe, it, expect } from 'vitest';

import {
  analyzeMempool,
  effectiveGasCap,
  effectiveTip,
} from '@/utils/mempoolAnalysis';
import type { PoolEntry } from '@/services/txpool';

const GWEI = 1_000_000_000n;

// Same address in two casings — EIP-55 is presentation, not identity.
const ADDR_LOWER = '0xabc1111111111111111111111111111111111111';
const ADDR_UPPER = '0xABC1111111111111111111111111111111111111';
const ADDR_OTHER = '0x2222222222222222222222222222222222222222';

const entry = (overrides: Partial<PoolEntry> & { hash: string }): PoolEntry => ({
  from: ADDR_LOWER,
  to: ADDR_OTHER,
  value: 0n,
  nonce: 0,
  account: ADDR_LOWER,
  accountNonce: 0,
  ...overrides,
});

const hashOf = (tag: string): string => `0x${tag.padEnd(64, '0')}`.slice(0, 66);

describe('effectiveGasCap / effectiveTip', () => {
  it('uses the 1559 fee cap when present, else the legacy gas price, else nothing', () => {
    const eip1559 = entry({
      hash: hashOf('a'),
      gasPrice: 1n * GWEI,
      maxFeePerGas: 30n * GWEI,
      maxPriorityFeePerGas: 2n * GWEI,
    });
    const legacy = entry({ hash: hashOf('b'), gasPrice: 10n * GWEI });
    const bare = entry({ hash: hashOf('c') });

    expect(effectiveGasCap(eip1559)).toBe(30n * GWEI);
    expect(effectiveGasCap(legacy)).toBe(10n * GWEI);
    expect(effectiveGasCap(bare)).toBeUndefined();
  });

  it('exposes a tip only for 1559 entries — legacy pricing has no isolable tip', () => {
    const eip1559 = entry({
      hash: hashOf('a'),
      maxFeePerGas: 30n * GWEI,
      maxPriorityFeePerGas: 2n * GWEI,
    });
    const legacy = entry({ hash: hashOf('b'), gasPrice: 10n * GWEI });
    // A 1559 tx whose tip the node omitted: honest absence.
    const tipless1559 = entry({ hash: hashOf('d'), maxFeePerGas: 5n * GWEI });

    expect(effectiveTip(eip1559)).toBe(2n * GWEI);
    expect(effectiveTip(legacy)).toBeUndefined();
    expect(effectiveTip(tipless1559)).toBeUndefined();
  });
});

describe('analyzeMempool — grouping', () => {
  it('groups only exact (from, nonce) collisions, case-insensitively', () => {
    const analysis = analyzeMempool([
      entry({ hash: hashOf('a'), nonce: 5 }),
      // Same sender, different casing, same nonce → same slot.
      entry({ hash: hashOf('b'), from: ADDR_UPPER, nonce: 5 }),
      // Same sender, different nonce → its own slot.
      entry({ hash: hashOf('c'), nonce: 6 }),
      // Different sender, same nonce → its own slot.
      entry({ hash: hashOf('d'), from: ADDR_OTHER, nonce: 5, account: ADDR_OTHER }),
    ]);

    expect(analysis.total).toBe(4);
    expect(analysis.conflictGroupCount).toBe(1);
    expect(analysis.replaceableCount).toBe(2);
    expect(analysis.distinctAccounts).toBe(2);

    const group = analysis.groups[0];
    expect(group.size).toBe(2);
    expect(group.nonce).toBe(5);
    // from is reported casing of the first member, not a normalized one.
    expect(group.from).toBe(ADDR_LOWER);
    expect(group.members.map(m => m.hash)).toEqual([hashOf('a'), hashOf('b')]);
  });

  it('flags every conflict member replaceable — including the winner', () => {
    const analysis = analyzeMempool([
      entry({ hash: hashOf('win'), nonce: 1, maxFeePerGas: 30n * GWEI }),
      entry({ hash: hashOf('lose'), nonce: 1, maxFeePerGas: 10n * GWEI }),
    ]);

    const byHash = new Map(analysis.entries.map(e => [e.hash, e]));
    expect(byHash.get(hashOf('win'))?.conflict).toEqual({
      size: 2,
      winnerHash: hashOf('win'),
      isWinner: true,
    });
    expect(byHash.get(hashOf('lose'))?.conflict).toEqual({
      size: 2,
      winnerHash: hashOf('win'),
      isWinner: false,
    });
    // Unopposed entries carry no verdict object at all.
    const solo = analyzeMempool([entry({ hash: hashOf('solo') })]);
    expect(solo.entries[0].conflict).toBeNull();
    expect(solo.groups).toEqual([]);
  });
});

describe('analyzeMempool — winner selection', () => {
  it('picks the higher 1559 cap, tie-breaking on the tip', () => {
    const analysis = analyzeMempool([
      entry({
        hash: hashOf('lowtip'),
        nonce: 3,
        maxFeePerGas: 30n * GWEI,
        maxPriorityFeePerGas: 1n * GWEI,
      }),
      entry({
        hash: hashOf('hightip'),
        nonce: 3,
        maxFeePerGas: 30n * GWEI,
        maxPriorityFeePerGas: 3n * GWEI,
      }),
      entry({
        hash: hashOf('lowcap'),
        nonce: 3,
        maxFeePerGas: 20n * GWEI,
        maxPriorityFeePerGas: 9n * GWEI,
      }),
    ]);

    expect(analysis.groups[0].winnerHash).toBe(hashOf('hightip'));
    expect(analysis.groups[0].members.map(m => m.hash)).toEqual([
      hashOf('hightip'),
      hashOf('lowtip'),
      hashOf('lowcap'),
    ]);
  });

  it('picks the higher gas price among legacy entries', () => {
    const analysis = analyzeMempool([
      entry({ hash: hashOf('cheap'), nonce: 0, gasPrice: 10n * GWEI }),
      entry({ hash: hashOf('dear'), nonce: 0, gasPrice: 20n * GWEI }),
    ]);

    expect(analysis.groups[0].winnerHash).toBe(hashOf('dear'));
  });

  it('compares the applicable cap directly in mixed 1559/legacy groups', () => {
    const analysis = analyzeMempool([
      entry({ hash: hashOf('legacy40'), nonce: 7, gasPrice: 40n * GWEI }),
      entry({ hash: hashOf('f1559'), nonce: 7, maxFeePerGas: 30n * GWEI }),
    ]);

    // The legacy entry's 40 gwei cap beats the 1559 cap of 30 — fee type
    // confers no bonus, only the cap compared.
    expect(analysis.groups[0].winnerHash).toBe(hashOf('legacy40'));
  });

  it('drops fee-less entries below any capped member; keeps snapshot order as the floor', () => {
    const analysis = analyzeMempool([
      entry({ hash: hashOf('blind'), nonce: 9 }),
      entry({ hash: hashOf('capped'), nonce: 9, gasPrice: 1n * GWEI }),
    ]);
    expect(analysis.groups[0].winnerHash).toBe(hashOf('capped'));

    // No member reports a fee: the first in snapshot order heads the
    // group — deterministic, never invented.
    const allBlind = analyzeMempool([
      entry({ hash: hashOf('first'), nonce: 4 }),
      entry({ hash: hashOf('second'), nonce: 4 }),
    ]);
    expect(allBlind.groups[0].winnerHash).toBe(hashOf('first'));

    // Identical caps and tips also fall back to snapshot order.
    const tied = analyzeMempool([
      entry({ hash: hashOf('t1'), nonce: 2, maxFeePerGas: 5n * GWEI, maxPriorityFeePerGas: 1n * GWEI }),
      entry({ hash: hashOf('t2'), nonce: 2, maxFeePerGas: 5n * GWEI, maxPriorityFeePerGas: 1n * GWEI }),
    ]);
    expect(tied.groups[0].winnerHash).toBe(hashOf('t1'));
  });
});

describe('analyzeMempool — percentiles (BigInt-exact index picks)', () => {
  it('returns all-null statistics for an empty pool', () => {
    const analysis = analyzeMempool([]);

    expect(analysis.total).toBe(0);
    expect(analysis.distinctAccounts).toBe(0);
    expect(analysis.capStats).toEqual({ count: 0, min: null, p25: null, median: null, max: null });
    expect(analysis.tipStats).toEqual({ count: 0, p25: null, median: null });
  });

  it('degenerates every percentile onto the single value', () => {
    const analysis = analyzeMempool([entry({ hash: hashOf('only'), gasPrice: 7n * GWEI })]);

    expect(analysis.capStats).toEqual({
      count: 1,
      min: 7n * GWEI,
      p25: 7n * GWEI,
      median: 7n * GWEI,
      max: 7n * GWEI,
    });
  });

  it('picks the lower middle for an even count (exact index math)', () => {
    // n = 2: p25 → floor(0.25·1) = 0, median → floor(0.5·1) = 0, max → 1.
    const analysis = analyzeMempool([
      entry({ hash: hashOf('hi'), gasPrice: 20n * GWEI }),
      entry({ hash: hashOf('lo'), gasPrice: 10n * GWEI }),
    ]);

    expect(analysis.capStats).toEqual({
      count: 2,
      min: 10n * GWEI,
      p25: 10n * GWEI,
      median: 10n * GWEI,
      max: 20n * GWEI,
    });
  });

  it('picks exact indexes for odd counts (n = 3)', () => {
    // n = 3: p25 → floor(0.25·2) = 0, median → floor(0.5·2) = 1, max → 2.
    // Input order scrambled — the stats sort, the listing does not.
    const analysis = analyzeMempool([
      entry({ hash: hashOf('mid'), gasPrice: 20n * GWEI }),
      entry({ hash: hashOf('lo'), gasPrice: 10n * GWEI }),
      entry({ hash: hashOf('hi'), gasPrice: 30n * GWEI }),
    ]);

    expect(analysis.capStats).toEqual({
      count: 3,
      min: 10n * GWEI,
      p25: 10n * GWEI,
      median: 20n * GWEI,
      max: 30n * GWEI,
    });
    // The listing itself keeps the snapshot order untouched.
    expect(analysis.entries.map(e => e.hash)).toEqual([
      hashOf('mid'),
      hashOf('lo'),
      hashOf('hi'),
    ]);
  });

  it('picks exact indexes for n = 5 and stays exact past 2^53', () => {
    // n = 5: p25 → floor(0.25·4) = 1, median → floor(0.5·4) = 2, max → 4.
    // Caps beyond Number precision: an averaging/Number path would fold
    // 2^60 + 1 onto 2^60 and fail the exact pick.
    const huge = 2n ** 60n;
    const analysis = analyzeMempool([
      entry({ hash: hashOf('e5'), gasPrice: 2n ** 61n }),
      entry({ hash: hashOf('e1'), gasPrice: huge }),
      entry({ hash: hashOf('e3'), gasPrice: huge + 1n }),
      entry({ hash: hashOf('e2'), gasPrice: huge - 1n }),
      entry({ hash: hashOf('e4'), gasPrice: huge + 2n }),
    ]);

    expect(analysis.capStats.min).toBe(huge - 1n);
    expect(analysis.capStats.p25).toBe(huge);
    expect(analysis.capStats.median).toBe(huge + 1n);
    expect(analysis.capStats.max).toBe(2n ** 61n);
  });

  it('computes tips over 1559 entries only, skipping tip-less 1559 and legacy alike', () => {
    const analysis = analyzeMempool([
      // Legacy: cap counts, tip never.
      entry({ hash: hashOf('l1'), gasPrice: 10n * GWEI }),
      // 1559 with a tip.
      entry({ hash: hashOf('c1'), maxFeePerGas: 30n * GWEI, maxPriorityFeePerGas: 3n * GWEI }),
      // 1559 whose tip the node omitted: cap counts, tip skipped.
      entry({ hash: hashOf('c2'), maxFeePerGas: 20n * GWEI }),
      // 1559 with another tip.
      entry({ hash: hashOf('c3'), maxFeePerGas: 40n * GWEI, maxPriorityFeePerGas: 1n * GWEI }),
    ]);

    expect(analysis.capStats.count).toBe(4);
    // Tips: [1, 3] gwei → p25 = 1, median = 1 (lower-middle convention).
    expect(analysis.tipStats).toEqual({ count: 2, p25: 1n * GWEI, median: 1n * GWEI });
  });
});

describe('analyzeMempool — counts', () => {
  it('splits 1559 / legacy / no-fee and counts accounts case-insensitively', () => {
    const analysis = analyzeMempool([
      entry({ hash: hashOf('a'), maxFeePerGas: 1n * GWEI }),
      // Both fields present: 1559 semantics own the cap.
      entry({
        hash: hashOf('b'),
        from: ADDR_UPPER,
        gasPrice: 9n * GWEI,
        maxFeePerGas: 2n * GWEI,
      }),
      entry({ hash: hashOf('c'), from: ADDR_OTHER, account: ADDR_OTHER, gasPrice: 3n * GWEI }),
      entry({ hash: hashOf('d') }),
    ]);

    expect(analysis.total).toBe(4);
    expect(analysis.eip1559Count).toBe(2);
    expect(analysis.legacyCount).toBe(1);
    expect(analysis.noFeeDataCount).toBe(1);
    expect(analysis.distinctAccounts).toBe(2);
    // The no-fee entry stays out of the cap statistics.
    expect(analysis.capStats.count).toBe(3);
  });
});

describe('analyzeMempool — render plan', () => {
  it('collapses each conflict group at its first member, winner first inside', () => {
    const analysis = analyzeMempool([
      entry({ hash: hashOf('solo1'), nonce: 0 }),
      entry({ hash: hashOf('lose'), nonce: 5, gasPrice: 1n * GWEI }),
      entry({ hash: hashOf('win'), from: ADDR_UPPER, nonce: 5, gasPrice: 9n * GWEI }),
      entry({ hash: hashOf('solo2'), from: ADDR_OTHER, account: ADDR_OTHER, nonce: 0 }),
    ]);

    expect(analysis.renderPlan).toHaveLength(3);
    expect(analysis.renderPlan[0].kind).toBe('solo');
    expect(analysis.renderPlan[0].kind === 'solo' && analysis.renderPlan[0].entry.hash).toBe(
      hashOf('solo1'),
    );
    // The group unit sits where its FIRST member appeared, members
    // winner-first (win caps 9 > lose's 1).
    const groupUnit = analysis.renderPlan[1];
    expect(groupUnit.kind).toBe('group');
    expect(
      groupUnit.kind === 'group' && groupUnit.group.members.map(m => m.hash),
    ).toEqual([hashOf('win'), hashOf('lose')]);
    expect(analysis.renderPlan[2].kind === 'solo' && analysis.renderPlan[2].entry.hash).toBe(
      hashOf('solo2'),
    );
  });

  it('is all solos when no slot collides', () => {
    const analysis = analyzeMempool([
      entry({ hash: hashOf('a'), nonce: 0 }),
      entry({ hash: hashOf('b'), nonce: 1 }),
    ]);

    expect(analysis.renderPlan.every(unit => unit.kind === 'solo')).toBe(true);
    expect(analysis.renderPlan).toHaveLength(2);
  });
});
