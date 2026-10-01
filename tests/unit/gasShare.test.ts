// A ratio with a zero (or unreadable) denominator is not a measurement,
// and the raw arithmetic rendered it as one: `(0 / 0 * 100).toFixed(1)`
// prints "NaN%" and `(15000000 / 0 * 100)` prints "Infinity%". Both
// reached the page: the block list's gas-usage cell, the Home stats bar's
// "Gas Used" card, and the block-progress segment widths.
//
// The repo already ships formatPercentage, which degrades a non-finite
// ratio to the shared placeholder. These tests drive the REAL derivation
// helpers (the ones the views call) rather than re-implementing the
// arithmetic, so they pin what the user sees.
import { describe, it, expect } from 'vitest';

import { gasUsageShare, gasUsedPercentLabel } from '@/utils/gasShare';
import { formatGasUsage } from '@/views/Blocks/List';
import { formatPercentage } from '@/utils/format';

describe('gas share of a block (gasUsed / gasLimit)', () => {
  it('renders a real share as a percentage', () => {
    // 15,000,000 of a 30,000,000 limit is exactly 50%.
    expect(gasUsageShare('15000000', '30000000')).toBe('15,000,000 (50.0%)');
  });

  it('never prints NaN% when both figures are zero', () => {
    // A genesis-shaped or quirky-RPC block: 0/0. The old code printed
    // "NaN%" inside the Gas Used cell.
    expect(gasUsageShare('0', '0')).not.toContain('NaN');
    expect(gasUsageShare('0', '0')).not.toContain('Infinity');
  });

  it('never prints Infinity% when the limit is zero but gas was used', () => {
    expect(gasUsageShare('15000000', '0')).not.toContain('Infinity');
    expect(gasUsageShare('15000000', '0')).not.toContain('NaN');
  });

  it('degrades an unreadable figure to the placeholder instead of a number', () => {
    expect(gasUsageShare('not-a-number', '30000000')).not.toContain('NaN');
    expect(gasUsageShare('15000000', '')).not.toContain('Infinity');
  });

  it('keeps the raw figure visible even when the share cannot be computed', () => {
    // The honest degrade: the measured number still shows, only the
    // ratio is omitted.
    expect(gasUsageShare('15000000', '0')).toContain('15,000,000');
  });
});

describe('Home gas-used stat card', () => {
  it('shows a real percentage', () => {
    expect(gasUsedPercentLabel('15000000', '30000000')).toBe('50.0%');
  });

  it('degrades a zero limit to the placeholder rather than "Infinity%"', () => {
    expect(gasUsedPercentLabel('15000000', '0')).toBe('—');
    expect(gasUsedPercentLabel('0', '0')).toBe('—');
  });

  it('degrades an unreadable figure to the placeholder', () => {
    expect(gasUsedPercentLabel(undefined, '30000000')).toBe('—');
    expect(gasUsedPercentLabel('15000000', undefined)).toBe('—');
  });
});

describe('formatPercentage is the shared guard', () => {
  it('degrades every non-finite ratio to the placeholder', () => {
    expect(formatPercentage(Number.NaN, 1)).toBe('—');
    expect(formatPercentage(Number.POSITIVE_INFINITY, 1)).toBe('—');
    expect(formatPercentage(Number.NEGATIVE_INFINITY, 1)).toBe('—');
  });
});

describe('the block list cell renders through the guarded formatter', () => {
  it('shows the measured figure and share for a normal block', () => {
    expect(formatGasUsage('15000000', '30000000')).toBe('15,000,000 (50.0%)');
  });

  it('shows the measured figure alone when the block reports no gas limit', () => {
    expect(formatGasUsage('15000000', '0')).toBe('15,000,000');
    expect(formatGasUsage('0', '0')).toBe('0');
  });
});
