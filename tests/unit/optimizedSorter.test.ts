// The k-way merge behind OptimizedSorter's large-dataset path
// (src/utils/sorting-optimization.ts). EventTable's client-side sort routes
// through it once a page holds >= threshold rows, so a misordered merge
// renders the events table in a wrong order — the sorter's whole contract.
//
// The invariant pinned here is total ordering: whatever the input size and
// whatever the number of sort keys, the result must be a permutation of the
// input that satisfies the SAME comparator the small-dataset path uses.

import { describe, it, expect } from 'vitest';
import { OptimizedSorter, type SortConfig } from '@/utils/sorting-optimization';

// EventTable's client-side sort passes `type: 'numeric'` for
// block_number, so the merge path compares numbers, not strings.
const ASC_N: SortConfig[] = [{ key: 'n', direction: 'asc', type: 'numeric' }];

// Reference comparator: the small-dataset (standard) path's semantics,
// applied directly by Array.prototype.sort.
const isSortedBy = (rows: Array<{ n: number }>): boolean =>
  rows.every((row, index) => index === 0 || rows[index - 1].n <= row.n);

const makeRows = (count: number, salt: number): Array<{ n: number; id: number }> =>
  Array.from({ length: count }, (_, id) => ({ n: (id * salt) % count, id }));

describe('OptimizedSorter large-dataset merge', () => {
  it('keeps a 15k-row page fully ordered (3 chunks, merge path)', () => {
    const sorter = new OptimizedSorter();
    const rows = makeRows(15_000, 7919);

    // threshold 1000 → 15k rows take the chunked/merge path.
    const { sortedData, metrics } = sorter.sort(rows, ASC_N, { threshold: 1000 });

    expect(metrics.algorithmUsed).toBe('optimized');
    expect(sortedData).toHaveLength(rows.length);
    expect(isSortedBy(sortedData)).toBe(true);
  });

  it('keeps a 12k-row page ordered when the key repeats (ties exercise the heap path)', () => {
    const sorter = new OptimizedSorter();
    // Only 7 distinct keys across 12k rows: heavy ties, so the merge cannot
    // accidentally look ordered because every element was unique.
    const rows = Array.from({ length: 12_000 }, (_, id) => ({ n: id % 7, id }));

    const { sortedData } = sorter.sort(rows, ASC_N, { threshold: 1000 });

    expect(sortedData).toHaveLength(rows.length);
    expect(isSortedBy(sortedData)).toBe(true);
  });

  it('honors every sort config in priority order, not just the first', () => {
    const sorter = new OptimizedSorter();
    // Two keys: a coarser primary (group) and a secondary (seq). A merge
    // that only compares the primary key leaves the secondary order as
    // whatever the chunking happened to produce.
    const rows = Array.from({ length: 11_000 }, (_, i) => ({
      group: i % 4,
      seq: (i * 31) % 977,
    }));
    const configs: SortConfig[] = [
      { key: 'group', direction: 'asc', type: 'numeric', priority: 0 },
      { key: 'seq', direction: 'asc', type: 'numeric', priority: 1 },
    ];

    const { sortedData } = sorter.sort(rows, configs, { threshold: 1000 });

    const expected = [...rows].sort((a, b) => a.group - b.group || a.seq - b.seq);
    expect(sortedData).toEqual(expected);
  });

  it('orders descending pages like the ascending path', () => {
    const sorter = new OptimizedSorter();
    const rows = makeRows(11_000, 4099);

    const { sortedData } = sorter.sort(
      rows,
      [{ key: 'n', direction: 'desc', type: 'numeric' }],
      { threshold: 1000 },
    );

    expect(sortedData.every((row, i) => i === 0 || sortedData[i - 1].n >= row.n)).toBe(true);
  });

  it('is a permutation: no row is lost or duplicated by the merge', () => {
    const sorter = new OptimizedSorter();
    const rows = makeRows(10_500, 65537);

    const { sortedData } = sorter.sort(rows, ASC_N, { threshold: 1000 });

    expect(new Set(sortedData.map(r => r.id)).size).toBe(rows.length);
  });
});
