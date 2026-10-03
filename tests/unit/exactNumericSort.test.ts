// Numeric sort columns must compare EXACTLY, not through a double.
//
// EventTable's client-side sort marks its Value column `type: 'numeric'`
// over EventData.value, which is a wei decimal STRING. The comparator
// ran parseFloat on both sides and subtracted, so every amount whose
// difference falls below the double's ulp compares as equal: at 1e18 wei
// the ulp is 128, so 1000000000000000001 and 1000000000000000128 are the
// same double and the comparator returns 0. A descending Value sort then
// leaves the two in INPUT order, i.e. arbitrary — while looking correct,
// because 0.01 ETH already puts the column past 2^53.
//
// The tie is not a cosmetic edge: it is the normal case for real event
// rows, whose values cluster far above 2^53.

import { describe, it, expect } from 'vitest';
import { OptimizedSorter, type SortConfig } from '@/utils/sorting-optimization';

const DESC_VALUE: SortConfig[] = [{ key: 'value', direction: 'desc', type: 'numeric' }];

type WeiRow = { value: string; id: number };

// Two wei amounts 50 apart at the 1e19 scale. The double ulp there is
// ~2048 wei, so BOTH parse to exactly 10000000000000000000 and the
// comparator sees a tie. Verified empirically, not reasoned about.
const SMALL = '10000000000000000000';
const LARGE = '10000000000000000050';

describe('numeric sort over wei-scale values', () => {
  it('orders two wei amounts that are distinct but equal as doubles', () => {
    const sorter = new OptimizedSorter();
    // Input order is the WRONG order for a descending sort.
    const rows: WeiRow[] = [
      { value: SMALL, id: 0 },
      { value: LARGE, id: 1 },
    ];

    const { sortedData } = sorter.sort(rows, DESC_VALUE, { threshold: 1000 });

    expect(sortedData[0].value).toBe(LARGE);
    expect(sortedData[1].value).toBe(SMALL);
  });

  it('orders the same pair in ascending direction', () => {
    const sorter = new OptimizedSorter();
    const rows: WeiRow[] = [
      { value: LARGE, id: 0 },
      { value: SMALL, id: 1 },
    ];

    const { sortedData } = sorter.sort(
      rows,
      [{ key: 'value', direction: 'asc', type: 'numeric' }],
      { threshold: 1000 },
    );

    expect(sortedData[0].value).toBe(SMALL);
    expect(sortedData[1].value).toBe(LARGE);
  });

  it('orders a realistic page of wei amounts exactly, not approximately', () => {
    const sorter = new OptimizedSorter();
    // Values one wei apart across the 1e18 range: every adjacent pair is
    // a double-tie, so a float comparator preserves input order and a
    // correct one produces exact descending order.
    const rows: WeiRow[] = Array.from({ length: 500 }, (_, i) => ({
      value: (10_000_000_000_000_000_000n + BigInt(i)).toString(),
      id: i,
    }));

    const { sortedData } = sorter.sort(rows, DESC_VALUE, { threshold: 1000 });

    const expected = [...rows]
      .map(r => BigInt(r.value))
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    expect(sortedData.map(r => BigInt(r.value))).toEqual(expected);
  });

  it('still sorts ordinary small numbers correctly', () => {
    const sorter = new OptimizedSorter();
    const rows = [{ value: '2' }, { value: '10' }, { value: '1' }];

    const { sortedData } = sorter.sort(rows, DESC_VALUE, { threshold: 1000 });

    // Numeric, not lexicographic: 10 > 2.
    expect(sortedData.map(r => r.value)).toEqual(['10', '2', '1']);
  });

  it('handles negative and fractional numeric values without breaking the order', () => {
    const sorter = new OptimizedSorter();
    const rows = [{ value: '-5' }, { value: '2.5' }, { value: '0' }];

    const { sortedData } = sorter.sort(rows, DESC_VALUE, { threshold: 1000 });

    expect(sortedData.map(r => r.value)).toEqual(['2.5', '0', '-5']);
  });
});
