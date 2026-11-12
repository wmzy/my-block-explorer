/**
 * Pure: split a list into consecutive chunks of at most `size` items,
 * order preserved. An empty list yields no chunks.
 *
 * `size` is a caller invariant (request caps, insert batch sizes — every
 * call site passes a module constant), so a non-integer or < 1 size throws
 * instead of silently mis-slicing or looping forever.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk: size must be an integer >= 1 (got ${size})`);
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
