// Negative-cache freshness: the shared age math for cache rows that
// record a MISS (signature NOT_FOUND rows, storage-layout NOT_FOUND
// rows, failed contract-creation searches). A NULL timestamp is EXPIRED,
// never fresh — the legacy hand-rolled shape
// `(Date.now() - row?.fetchedAt?.getTime() ?? 0) / MS_PER_HOUR < TTL`
// bound a null fetchedAt to age 0 and pinned negative entries in the
// cache forever.

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Age of a timestamp in hours. A null/undefined timestamp reads as
 * infinitely old (never fresh), so callers cannot mistake "we never
 * recorded when" for "recorded just now".
 */
export function ageHours(date: Date | null | undefined): number {
  if (date === null || date === undefined) return Number.POSITIVE_INFINITY;
  return (Date.now() - date.getTime()) / MS_PER_HOUR;
}

/**
 * Whether a negative-cache row recorded at `fetchedAt` is still inside
 * its TTL window. TTL tier values stay at each call site — this is only
 * the freshness math.
 */
export function negativeEntryFresh(fetchedAt: Date | null | undefined, ttlHours: number): boolean {
  return ageHours(fetchedAt) < ttlHours;
}
