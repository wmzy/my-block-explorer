// The lean multi-key sorter behind EventTable's client-side sort
// (src/utils/sorting-optimization.ts). The chunk/heap machinery and the
// TTL result cache the module used to carry are gone; what these tests
// pin is the contract that survived: type-aware comparator semantics,
// multi-key precedence, direction, stability, and honest per-sort
// metrics. (Wei-scale exact numeric ordering has its own suite:
// tests/unit/exactNumericSort.test.ts.)

import { describe, it, expect } from 'vitest';
import { multiKeySort, type SortConfig } from '@/utils/sorting-optimization';

describe('multiKeySort', () => {
  it('sorts by a numeric key in both directions', () => {
    const data = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const asc: SortConfig[] = [{ key: 'id', direction: 'asc', type: 'numeric' }];
    const desc: SortConfig[] = [{ key: 'id', direction: 'desc', type: 'numeric' }];

    expect(multiKeySort(data, asc).rows.map(r => r.id)).toEqual([1, 2, 3]);
    expect(multiKeySort(data, desc).rows.map(r => r.id)).toEqual([3, 2, 1]);
  });

  it('sorts text case-insensitively, and numerically only under type numeric', () => {
    const names = [{ name: 'Charlie' }, { name: 'alice' }, { name: 'Bob' }];
    const byName: SortConfig[] = [{ key: 'name', direction: 'asc', type: 'text' }];
    expect(multiKeySort(names, byName).rows.map(r => r.name)).toEqual([
      'alice',
      'Bob',
      'Charlie',
    ]);

    // The same string values under a NUMERIC config compare as numbers,
    // not lexicographically: 10 sorts after 2.
    const nums = [{ name: '10' }, { name: '2' }];
    const byNumeric: SortConfig[] = [{ key: 'name', direction: 'asc', type: 'numeric' }];
    expect(multiKeySort(nums, byNumeric).rows.map(r => r.name)).toEqual(['2', '10']);
  });

  it('breaks ties with later configs (multi-key precedence)', () => {
    const data = [
      { category: 'B', value: 1 },
      { category: 'A', value: 3 },
      { category: 'A', value: 1 },
      { category: 'B', value: 2 },
      { category: 'A', value: 2 },
    ];
    const configs: SortConfig[] = [
      { key: 'category', direction: 'asc', type: 'text', priority: 0 },
      { key: 'value', direction: 'asc', type: 'numeric', priority: 1 },
    ];

    expect(multiKeySort(data, configs).rows).toEqual([
      { category: 'A', value: 1 },
      { category: 'A', value: 2 },
      { category: 'A', value: 3 },
      { category: 'B', value: 1 },
      { category: 'B', value: 2 },
    ]);
  });

  it('honors priority over declaration order', () => {
    const data = [
      { group: 1, seq: 1 },
      { group: 0, seq: 5 },
      { group: 0, seq: 2 },
    ];
    // Declared seq-first, but group carries the lower priority number, so
    // group is the primary key and seq only breaks its ties.
    const configs: SortConfig[] = [
      { key: 'seq', direction: 'asc', type: 'numeric', priority: 1 },
      { key: 'group', direction: 'asc', type: 'numeric', priority: 0 },
    ];

    expect(multiKeySort(data, configs).rows).toEqual([
      { group: 0, seq: 2 },
      { group: 0, seq: 5 },
      { group: 1, seq: 1 },
    ]);
  });

  it('keeps comparator-equal rows in input order (stable) and never mutates the input', () => {
    const data = [
      { k: 1, id: 'a' },
      { k: 0, id: 'b' },
      { k: 1, id: 'c' },
    ];
    const input = [...data];
    const byK: SortConfig[] = [{ key: 'k', direction: 'asc', type: 'numeric' }];

    const { rows } = multiKeySort(data, byK);

    // The two k=1 rows keep their input order (a before c).
    expect(rows.map(r => r.id)).toEqual(['b', 'a', 'c']);
    expect(data).toEqual(input);
  });

  it('returns an unchanged copy for no configs, and empty for empty input', () => {
    const data = [{ id: 3 }, { id: 1 }];
    expect(multiKeySort(data, []).rows).toEqual(data);
    expect(
      multiKeySort([], [{ key: 'id', direction: 'asc', type: 'numeric' }]).rows,
    ).toEqual([]);
  });

  it('sorts null/undefined values first ascending, last descending', () => {
    const data = [{ id: null }, { id: 2 }, { id: undefined }, { id: 1 }];
    const asc: SortConfig[] = [{ key: 'id', direction: 'asc', type: 'numeric' }];
    const desc: SortConfig[] = [{ key: 'id', direction: 'desc', type: 'numeric' }];

    expect(multiKeySort(data, asc).rows.map(r => r.id)).toEqual([null, undefined, 1, 2]);
    expect(multiKeySort(data, desc).rows.map(r => r.id)).toEqual([2, 1, null, undefined]);
  });

  it('sorts nested dotted key paths', () => {
    const data = [
      { user: { profile: { age: 30 } }, name: 'A' },
      { user: { profile: { age: 25 } }, name: 'B' },
      { user: { profile: { age: 35 } }, name: 'C' },
    ];
    const byAge: SortConfig[] = [{ key: 'user.profile.age', direction: 'asc', type: 'numeric' }];

    expect(multiKeySort(data, byAge).rows.map(r => r.name)).toEqual(['B', 'A', 'C']);
  });

  it('sorts timestamps chronologically and addresses case-insensitively', () => {
    const stamps = [
      { at: '2023-01-03T00:00:00Z' },
      { at: '2023-01-01T00:00:00Z' },
      { at: '2023-01-02T00:00:00Z' },
    ];
    const byTime: SortConfig[] = [{ key: 'at', direction: 'asc', type: 'timestamp' }];
    expect(multiKeySort(stamps, byTime).rows.map(r => r.at)).toEqual([
      '2023-01-01T00:00:00Z',
      '2023-01-02T00:00:00Z',
      '2023-01-03T00:00:00Z',
    ]);

    // The first two addresses lower-case to the same string, so the
    // stable sort keeps their input order after the smaller address.
    const addrs = [
      { a: '0xABCDEF1234567890' },
      { a: '0xabcdef1234567890' },
      { a: '0x1234567890ABCDEF' },
    ];
    const byAddr: SortConfig[] = [{ key: 'a', direction: 'asc', type: 'address' }];
    expect(multiKeySort(addrs, byAddr).rows.map(r => r.a)).toEqual([
      '0x1234567890ABCDEF',
      '0xABCDEF1234567890',
      '0xabcdef1234567890',
    ]);
  });

  it('reports honest per-sort metrics: rowCount, sortKeys in applied order, durationMs', () => {
    const configs: SortConfig[] = [
      { key: 'seq', direction: 'asc', type: 'numeric', priority: 1 },
      { key: 'group', direction: 'asc', type: 'numeric', priority: 0 },
    ];

    const { metrics } = multiKeySort([{ group: 0, seq: 1 }], configs);

    expect(metrics.rowCount).toBe(1);
    // Priority order, not declaration order.
    expect(metrics.sortKeys).toEqual(['group', 'seq']);
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(metrics.durationMs)).toBe(true);
  });
});
