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
 * its TTL window. Bespoke TTL tiers stay at each call site; the shared
 * NOT_FOUND tier (both signature and storage-layout caches) is
 * NOT_FOUND_CACHE_TTL_HOURS below.
 */
export function negativeEntryFresh(fetchedAt: Date | null | undefined, ttlHours: number): boolean {
  return ageHours(fetchedAt) < ttlHours;
}

// The NOT_FOUND tier shared by the signature and storage-layout caches:
// a miss recorded today can become a hit as the upstream database (or
// the bytecode inference tool) grows, and 24h caps a hot unknown at one
// upstream round trip per day.
export const NOT_FOUND_CACHE_TTL_HOURS = 24;
