// The one consecutive-slice chunking primitive (utils/chunk) behind the
// signatures request cap, the DefiLlama id batches and the event insert
// batches. Order preservation and the size guard are the whole contract.
import { describe, it, expect } from 'vitest';
import { chunk } from '@/utils/chunk';

describe('chunk — consecutive slicing', () => {
  it('returns no chunks for an empty list', () => {
    expect(chunk([], 25)).toEqual([]);
  });

  it('keeps a list under the size as one chunk, order preserved', () => {
    expect(chunk(['a', 'b', 'c'], 25)).toEqual([['a', 'b', 'c']]);
  });

  it('splits at the size: 26 items under a 25 size become 25 + 1', () => {
    const items = Array.from({ length: 26 }, (_, i) => `s${i}`);
    const chunks = chunk(items, 25);

    expect(chunks.map(part => part.length)).toEqual([25, 1]);
    // Order is preserved across the split.
    expect(chunks.flat()).toEqual(items);
  });

  it('throws on a size below 1 or non-integer instead of mis-slicing', () => {
    expect(() => chunk(['a', 'b'], 0)).toThrow(/integer >= 1/);
    expect(() => chunk(['a', 'b'], -3)).toThrow(/integer >= 1/);
    expect(() => chunk(['a', 'b'], 2.5)).toThrow(/integer >= 1/);
  });
});
