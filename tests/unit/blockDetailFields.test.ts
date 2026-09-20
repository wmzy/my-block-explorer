// Pure-logic tests for the block detail's fee/blob/withdrawal formatters:
// burnt fees are baseFeePerGas × gasUsed with unparseable RPC values
// collapsing to undefined (the row is skipped, never fabricated); the ETH
// formatters are lossless on the gwei/wei integers viem's formatUnits is
// given; and the blob utilization percentage is exact basis-point math
// against the EIP-4844 per-block blob gas capacity. The polling cadence
// constants pin the public polling contract the view's effect consumes.
import { describe, it, expect } from 'vitest';

import {
  blobCountFromGas,
  computeBurntFees,
  formatEthValue,
  formatWithdrawalEth,
  FUTURE_BLOCK_POLL_BUDGET_MS,
  FUTURE_BLOCK_POLL_INTERVAL_MS,
} from '@/views/Blocks/Detail';

describe('computeBurntFees', () => {
  it('multiplies the wei base fee by the gas used', () => {
    expect(computeBurntFees('20000000000', '15000000')).toBe(300_000_000_000_000_000n);
  });

  it('handles zero base fee honestly (0 wei burnt, not skipped)', () => {
    expect(computeBurntFees('0', '15000000')).toBe(0n);
  });

  it('collapses unparseable RPC values to undefined', () => {
    expect(computeBurntFees('not-a-number', '15000000')).toBeUndefined();
    expect(computeBurntFees('20000000000', '')).toBeUndefined();
    expect(computeBurntFees('', '')).toBeUndefined();
  });

  it('tolerates surrounding whitespace in decimal fields', () => {
    expect(computeBurntFees(' 20000000000 ', '15000000')).toBe(300_000_000_000_000_000n);
  });

  it('is exact past Number precision', () => {
    const huge = computeBurntFees('9007199254740993', '9007199254740993');
    expect(huge).toBe(9007199254740993n * 9007199254740993n);
  });
});

describe('formatEthValue', () => {
  it('formats wei as trimmed decimal ETH', () => {
    expect(formatEthValue(300_000_000_000_000_000n)).toBe('0.3');
    expect(formatEthValue(1_000_000_000_000_000_000n)).toBe('1');
  });

  it('keeps full precision for dust amounts', () => {
    expect(formatEthValue(1n)).toBe('0.000000000000000001');
    expect(formatEthValue(0n)).toBe('0');
  });
});

describe('formatWithdrawalEth', () => {
  it('converts gwei strings to exact ETH', () => {
    expect(formatWithdrawalEth('1159655')).toBe('0.001159655');
    expect(formatWithdrawalEth('1000000000')).toBe('1');
    expect(formatWithdrawalEth('0')).toBe('0');
  });

  it('falls back to the raw string instead of fabricating on garbage', () => {
    expect(formatWithdrawalEth('n/a')).toBe('n/a');
    expect(formatWithdrawalEth('')).toBe('');
  });
});

describe('blobCountFromGas', () => {
  it('expresses the used blob gas as an exact blob count (131,072/blob)', () => {
    expect(blobCountFromGas('786432')).toBe(6);
    expect(blobCountFromGas('393216')).toBe(3);
    expect(blobCountFromGas('0')).toBe(0);
    // Post-Prague blocks exceed the launch-era 6-blob schedule — the count
    // stays honest where the old fixed-cap percentage rendered >100%.
    expect(blobCountFromGas('1441792')).toBe(11);
  });

  it('floors malformed non-multiples to a sane count', () => {
    expect(blobCountFromGas('524288')).toBe(4);
    expect(blobCountFromGas('1')).toBe(0);
  });

  it('collapses unparseable values to undefined', () => {
    expect(blobCountFromGas('not-gas')).toBeUndefined();
    expect(blobCountFromGas('')).toBeUndefined();
  });
});

describe('future-block polling contract', () => {
  it('probes the head every 4 s for a ~5 minute budget', () => {
    expect(FUTURE_BLOCK_POLL_INTERVAL_MS).toBe(4_000);
    expect(FUTURE_BLOCK_POLL_BUDGET_MS).toBe(5 * 60_000);
  });
});
