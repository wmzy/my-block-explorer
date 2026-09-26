// Pure slot/epoch derivation tests. The known cross-check values pin the
// schedule constants to public chain data: the beacon genesis Unix time
// and the first post-Merge mainnet block (Etherscan block 15537394,
// timestamp 1663224179 = 2022-09-15 06:42:59 UTC, reported Slot 4700013 /
// Epoch 146875 — exactly the floor((ts − genesis)/12) this module
// computes). Undefined contracts (unmapped chain, pre-genesis timestamp,
// unparseable input) must collapse to undefined, never a fabricated slot.
import { describe, it, expect } from 'vitest';

import { deriveSlotEpoch, deriveSlotEpochFromIso } from '@/utils/slotEpoch';

// Ethereum mainnet (chainId 1) — the only mapped schedule.
const MAINNET_GENESIS = 1_606_824_023; // 2020-12-01 12:00:23 UTC
// First post-Merge block 15537394: 2022-09-15 06:42:59 UTC.
const MERGE_TIMESTAMP = 1_663_224_179;
const MERGE_SLOT = 4_700_013;
const MERGE_EPOCH = 146_875;

describe('deriveSlotEpoch known cross-checks', () => {
  it('derives the documented merge slot/epoch for the first post-merge block', () => {
    expect(deriveSlotEpoch(1, MERGE_TIMESTAMP)).toEqual({
      slot: MERGE_SLOT,
      epoch: MERGE_EPOCH,
    });
  });

  it('derives slot 0 / epoch 0 at exactly the beacon genesis', () => {
    expect(deriveSlotEpoch(1, MAINNET_GENESIS)).toEqual({ slot: 0, epoch: 0 });
  });
});

describe('deriveSlotEpoch slot boundaries', () => {
  it('treats a slot-start timestamp as the slot it opens (floor, not ceiling)', () => {
    // The merge timestamp sits exactly on a slot start: 56,400,156 = 12 × 4,700,013.
    expect((MERGE_TIMESTAMP - MAINNET_GENESIS) % 12).toBe(0);
    expect(deriveSlotEpoch(1, MERGE_TIMESTAMP)?.slot).toBe(MERGE_SLOT);
  });

  it('keeps the same slot through the last second before the next boundary', () => {
    expect(deriveSlotEpoch(1, MERGE_TIMESTAMP + 11)?.slot).toBe(MERGE_SLOT);
    // One second into the next window flips to the next slot.
    expect(deriveSlotEpoch(1, MERGE_TIMESTAMP + 12)?.slot).toBe(MERGE_SLOT + 1);
  });
});

describe('deriveSlotEpoch epoch floor boundaries', () => {
  it('maps slot 31 to epoch 0 and slot 32 to epoch 1', () => {
    // Genesis + 31×12s and + 32×12s: the exact epoch-1 boundary.
    expect(deriveSlotEpoch(1, MAINNET_GENESIS + 31 * 12)).toEqual({ slot: 31, epoch: 0 });
    expect(deriveSlotEpoch(1, MAINNET_GENESIS + 32 * 12)).toEqual({ slot: 32, epoch: 1 });
  });

  it('keeps the merge block in epoch 146875 and starts 146876 at slot 4,700,032', () => {
    // Slot 4,700,031 is the last slot of epoch 146,875 (4,700,000 + 31);
    // slot 4,700,032 opens epoch 146,876.
    const lastOfMergeEpoch = deriveSlotEpoch(1, MAINNET_GENESIS + 4_700_031 * 12);
    expect(lastOfMergeEpoch).toEqual({ slot: 4_700_031, epoch: 146_875 });
    expect(deriveSlotEpoch(1, MAINNET_GENESIS + 4_700_032 * 12)?.epoch).toBe(146_876);
  });
});

describe('deriveSlotEpoch undefined contracts', () => {
  it('returns undefined one second before genesis', () => {
    expect(deriveSlotEpoch(1, MAINNET_GENESIS - 1)).toBeUndefined();
  });

  it('returns undefined for an unmapped chain (no schedule is ever guessed)', () => {
    // A supported explorer chain (Polygon) with a post-genesis timestamp:
    // no published-in-this-map schedule, so no slot.
    expect(deriveSlotEpoch(137, MERGE_TIMESTAMP)).toBeUndefined();
    expect(deriveSlotEpoch(11155111, MERGE_TIMESTAMP)).toBeUndefined();
  });

  it('returns undefined for non-finite inputs', () => {
    expect(deriveSlotEpoch(1, Number.NaN)).toBeUndefined();
    expect(deriveSlotEpoch(1, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('still derives for pre-merge mainnet timestamps (documented contract)', () => {
    // A PoW-era block (2021) maps onto the beacon grid the same way: the
    // slot names the window the timestamp falls in. The row's caveat copy
    // carries the honesty burden, not a hidden gate here.
    const powEra = deriveSlotEpoch(1, Date.parse('2021-05-01T00:00:00Z') / 1000);
    expect(powEra).toBeDefined();
    expect(powEra?.slot).toBeGreaterThanOrEqual(0);
  });
});

describe('deriveSlotEpochFromIso', () => {
  it('matches the Unix-seconds variant for a merge-block ISO timestamp', () => {
    expect(deriveSlotEpochFromIso(1, '2022-09-15T06:42:59.000Z')).toEqual({
      slot: MERGE_SLOT,
      epoch: MERGE_EPOCH,
    });
  });

  it('floors fractional seconds into the containing slot', () => {
    // 12:00:35.9Z is inside slot 1's window [12:00:35, 12:00:47).
    expect(deriveSlotEpochFromIso(1, '2020-12-01T12:00:35.900Z')).toEqual({ slot: 1, epoch: 0 });
    expect(deriveSlotEpochFromIso(1, '2020-12-01T12:00:34.999Z')).toEqual({ slot: 0, epoch: 0 });
  });

  it('collapses unparseable timestamps to undefined, never a fabricated slot', () => {
    expect(deriveSlotEpochFromIso(1, '')).toBeUndefined();
    expect(deriveSlotEpochFromIso(1, 'not-a-timestamp')).toBeUndefined();
  });

  it('honors the unmapped-chain contract for ISO inputs too', () => {
    expect(deriveSlotEpochFromIso(137, '2022-09-15T06:42:59.000Z')).toBeUndefined();
  });
});
