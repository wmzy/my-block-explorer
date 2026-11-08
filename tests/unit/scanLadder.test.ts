// scanLadder contract tests: the single-sourced window/chunk ladder the
// transfers and approvals scans both consume, and the provider-ceiling
// memory whose anti-oscillation rule (growth stays below the highest
// REJECTED size) the two adaptive sweeps pin in their own tests — this
// pins the primitive itself.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_SCAN_CALLS,
  DEFAULT_SCAN_TIMEOUT_MS,
  DEFAULT_WINDOW_BLOCKS,
  INITIAL_CHUNK_BLOCKS,
  MAX_CHUNK_BLOCKS,
  MAX_WINDOW_BLOCKS,
  MIN_CHUNK_BLOCKS,
  MIN_WINDOW_BLOCKS,
  SCAN_TIMEOUT_GRACE_MS,
  createProviderCeilingMemory,
} from '@/utils/scanLadder';

describe('scan ladder constants', () => {
  it('exports the shared scan ladder values both services consume', () => {
    // The documented ladder: 100k default window clamped to 50M, 5k
    // initial chunk halving to a 10-block floor doubling to a 10k cap,
    // 40 actual getLogs calls / 25s honesty budgets + 5s race grace.
    expect(DEFAULT_WINDOW_BLOCKS).toBe(100_000);
    expect(MAX_WINDOW_BLOCKS).toBe(50_000_000);
    expect(MIN_WINDOW_BLOCKS).toBe(1);
    expect(INITIAL_CHUNK_BLOCKS).toBe(5_000);
    expect(MIN_CHUNK_BLOCKS).toBe(10);
    expect(MAX_CHUNK_BLOCKS).toBe(10_000);
    expect(DEFAULT_MAX_SCAN_CALLS).toBe(40);
    expect(DEFAULT_SCAN_TIMEOUT_MS).toBe(25_000);
    expect(SCAN_TIMEOUT_GRACE_MS).toBe(5_000);
  });
});

describe('createProviderCeilingMemory', () => {
  it('keeps growth below the highest rejected size (no oscillation)', () => {
    const ladder = createProviderCeilingMemory();

    // The initial 5k chunk is rejected (provider range cap).
    ladder.noteRejected(5_000);
    // After the halved 2.5k chunk succeeds, growth doubles but stays
    // under the learned ceiling (4_999) — without the memory the scan
    // would climb back to the rejected size and burn the call budget.
    expect(ladder.grow(2_500)).toBe(4_999);
    expect(ladder.grow(4_999)).toBe(4_999);
  });

  it('halves toward the 10-block floor without going under it', () => {
    const ladder = createProviderCeilingMemory();
    expect(ladder.halve(5_000)).toBe(2_500);
    expect(ladder.halve(20)).toBe(10);
    expect(ladder.halve(10)).toBe(10);
  });

  it('caps growth at MAX_CHUNK_BLOCKS when nothing was rejected yet', () => {
    const ladder = createProviderCeilingMemory();
    expect(ladder.grow(10_000)).toBe(10_000);
    expect(ladder.grow(9_999)).toBe(10_000);
  });

  it('lowers the ceiling on every later, smaller rejection', () => {
    const ladder = createProviderCeilingMemory();
    ladder.noteRejected(5_000);
    ladder.noteRejected(156); // a tighter provider cap discovered later
    expect(ladder.grow(156)).toBe(155);
  });
});
