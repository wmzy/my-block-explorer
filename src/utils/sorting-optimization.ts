/**
 * Stable multi-key sorting for client-side table rows (EventTable).
 *
 * The chunked k-way-merge path and TTL result cache this module once
 * carried are gone, deliberately: the only product caller caps
 * client-side sorting at 1000 rows, where a plain stable Array.sort is
 * as fast and far simpler; and the cache key had to serialize EVERY row
 * (O(n) string work) before every sort just to skip the O(n log n) sort
 * it was warming for. What stays is what was load-bearing: the
 * comparator semantics (BigInt-exact numerics included) and honest
 * per-sort metrics.
 */

export type SortConfig = {
  key: string;
  direction: 'asc' | 'desc';
  type?: 'numeric' | 'text' | 'address' | 'timestamp';
  priority?: number;
};

/** Honest per-sort facts: how many rows, by which keys, over how long. */
export type SortMetrics = {
  rowCount: number;
  sortKeys: string[];
  durationMs: number;
};

/**
 * A value that is exactly a plain decimal integer, or null otherwise.
 * Used to detect the wei-scale strings this module must compare exactly.
 */
const EXACT_DECIMAL = /^-?\d+$/;

/**
 * Compare two numeric values EXACTLY.
 *
 * 'numeric' columns carry wei decimal strings, and a double's ulp at
 * 1e18 is ~128 wei — amounts closer than that parse to the SAME double,
 * so a parseFloat subtraction returns 0 and the rows keep input order.
 * For real event rows (values clustered far above 2^53) that tie is the
 * normal case, not an edge.
 *
 * Both plain integer literals → BigInt comparison (exact at any
 * magnitude); anything else → parseFloat subtraction, still correct for
 * the small numbers and fractions other callers use. A non-finite parse
 * keeps NaN → 0, so a junk cell can never scramble the order; nullish
 * inputs make the helper total regardless of caller narrowing.
 */
function compareNumbersExactly(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const aStr = a.toString();
  const bStr = b.toString();
  if (EXACT_DECIMAL.test(aStr) && EXACT_DECIMAL.test(bStr)) {
    const aBig = BigInt(aStr);
    const bBig = BigInt(bStr);
    return aBig > bBig ? 1 : aBig < bBig ? -1 : 0;
  }
  return parseFloat(aStr) - parseFloat(bStr);
}

/** Extract a value from an object by dotted key path. */
function extractValue(obj: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((current, key) => {
    if (current !== null && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Compare two values by a config's type and direction. Null/undefined
 * sort first ascending and last descending; 'text' and 'address' share
 * the case-insensitive lexicographic comparison.
 */
function compareValues(a: unknown, b: unknown, config: SortConfig): number {
  if (a == null && b == null) return 0;
  if (a == null) return config.direction === 'asc' ? -1 : 1;
  if (b == null) return config.direction === 'asc' ? 1 : -1;

  let comparison: number;

  switch (config.type) {
    case 'numeric':
      comparison = compareNumbersExactly(a, b);
      break;
    case 'timestamp':
      comparison = new Date(String(a)).getTime() - new Date(String(b)).getTime();
      break;
    case 'address':
    case 'text':
    default:
      comparison = a.toString().toLowerCase().localeCompare(b.toString().toLowerCase());
      break;
  }

  return config.direction === 'desc' ? -comparison : comparison;
}

/**
 * Stable multi-key sort: configs apply in ascending priority order
 * (declaration order breaks priority ties), rows comparing equal under
 * every config keep their input order (Array.prototype.sort is stable),
 * and the input array is never mutated. Returns the sorted copy plus
 * per-sort metrics.
 */
export function multiKeySort<T>(
  data: readonly T[],
  sortConfigs: readonly SortConfig[],
): { rows: T[]; metrics: SortMetrics } {
  const start = performance.now();
  const configs = [...sortConfigs].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const rows = [...data].sort((a, b) => {
    for (const config of configs) {
      const result = compareValues(
        extractValue(a as Record<string, unknown>, config.key),
        extractValue(b as Record<string, unknown>, config.key),
        config,
      );
      if (result !== 0) return result;
    }
    return 0;
  });

  return {
    rows,
    metrics: {
      rowCount: rows.length,
      sortKeys: configs.map(config => config.key),
      durationMs: performance.now() - start,
    },
  };
}
