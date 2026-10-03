// The segmented progress bar weighted INCLUSIVE block bounds as if they
// were exclusive.
//
// Segment.fromBlock/toBlock are the row's own stored bounds, and every
// other reader in the feature treats them as INCLUSIVE: the walk
// completes when `current > end` (EventIndexingService.ts:1345, i.e. end
// itself is walked), IndexingRangeManager's own coveredBlocksOf uses
// `to - from + 1`, and getTooltipText prints "from - to".
//
// The bar's own arithmetic used the EXCLUSIVE span, `toBlock - fromBlock`,
// in both the total and each segment's width. Three consequences, in
// increasing severity:
//
//  1. a single-block range (fromBlock === toBlock — created by quick
//     'catchup' when the chain head already equals the furthest
//     existing toBlock) measured 0 blocks wide, so `totalBlocks` could
//     be 0 and the bar rendered COMPLETELY EMPTY, and a single-block
//     segment among wide ones measured 0% and was invisible;
//  2. every other segment was understated by one block relative to its
//     true inclusive span, so segments were mis-proportioned against
//     each other (a 1-block range beside a 1,000,000-block range read as
//     0% instead of 0.0001%);
//  3. the component was internally inconsistent — the per-segment
//     `progress` fill handed to it is already inclusive (100% of a
//     single-block range that is complete), so a completed range could
//     show a full fill inside a zero-width box.
//
// A zero-width COMPLETED range is the honest repro: the data says the
// work is done, and the bar says there is nothing there.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SegmentedProgressBar, type Segment } from '@/components/ui/SegmentedProgressBar';

const segment = (over: Partial<Segment> & { rangeId: number; fromBlock: number; toBlock: number }): Segment => ({
  currentBlock: null,
  status: 'completed',
  progress: 100,
  ...over,
});

/** The per-segment track elements carry the width; the inner fill does not. */
const widths = (): string[] => {
  const tracks = document.querySelectorAll<HTMLElement>('[data-tooltip]');
  return Array.from(tracks).map(el => el.style.width);
};

describe('SegmentedProgressBar — inclusive block bounds', () => {
  it('gives a single-block range a real width instead of 0%', () => {
    render(
      <SegmentedProgressBar
        segments={[
          segment({ rangeId: 1, fromBlock: 100, toBlock: 100 }),
          segment({ rangeId: 2, fromBlock: 200, toBlock: 300 }),
        ]}
      />,
    );

    // Inclusive widths are 1 and 101 blocks, so the first segment is
    // 1/102 ≈ 0.98% — visible. Exclusive math gave it 0/(0+100) = 0%.
    const [first, second] = widths();
    expect(first).not.toBe('0%');
    expect(Number.parseFloat(first)).toBeGreaterThan(0);
    // The complement must agree to within float noise, not a literal.
    expect(Number.parseFloat(second)).toBeCloseTo(100 - Number.parseFloat(first), 6);
  });

  it('renders a non-empty track when every range is a single block', () => {
    // All-pending vs completed: the old total was 0, so the bar rendered
    // the "nothing here" width even though ranges exist and are done.
    render(
      <SegmentedProgressBar
        segments={[
          segment({ rangeId: 1, fromBlock: 100, toBlock: 100 }),
          segment({ rangeId: 2, fromBlock: 200, toBlock: 200 }),
        ]}
      />,
    );
    const [first, second] = widths();
    expect(first).toBe('50%');
    expect(second).toBe('50%');
  });

  it('fills the track for a single-block range that is complete', () => {
    // The internal inconsistency: progress is already 100% (inclusive),
    // so a 0%-wide box showed "done" inside nothing.
    render(
      <SegmentedProgressBar
        segments={[segment({ rangeId: 1, fromBlock: 42, toBlock: 42, currentBlock: 42 })]}
      />,
    );
    expect(widths()).toEqual(['100%']);
  });

  it('weights segments by their true inclusive block counts', () => {
    // 1000 + 3000 = 4000 inclusive blocks → exactly 25% / 75%.
    render(
      <SegmentedProgressBar
        segments={[
          segment({ rangeId: 1, fromBlock: 0, toBlock: 999 }),
          segment({ rangeId: 2, fromBlock: 1000, toBlock: 3999 }),
        ]}
      />,
    );
    expect(widths()).toEqual(['25%', '75%']);
  });

  it('handles the genesis range (block 0) inclusively', () => {
    // fromBlock 0 is a real block, not "absent" — exclusive math on a
    // 0..999 range undercounts it by one.
    render(
      <SegmentedProgressBar
        segments={[
          segment({ rangeId: 1, fromBlock: 0, toBlock: 999 }),
          segment({ rangeId: 2, fromBlock: 1000, toBlock: 1999 }),
        ]}
      />,
    );
    expect(widths()).toEqual(['50%', '50%']);
  });

  it('still reports every range in the tooltip and legend', () => {
    render(
      <SegmentedProgressBar
        segments={[segment({ rangeId: 1, fromBlock: 100, toBlock: 100 })]}
      />,
    );
    // The tooltip range text lives in data-tooltip, not in text content,
    // and is unchanged by the width fix.
    const track = document.querySelector<HTMLElement>('[data-tooltip]');
    expect(track?.dataset.tooltip).toBe('100 - 100 (Completed)');
    expect(screen.getByText('Completed')).toBeDefined();
  });
});
