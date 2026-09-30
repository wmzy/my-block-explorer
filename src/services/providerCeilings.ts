/**
 * Persisted provider log-span ceilings — the DuckDB-backed twin of the
 * per-chain in-memory ceiling map EventIndexingService's getLogs ladder
 * learns by halving spans on provider range-cap errors (provider_limits
 * table, migration 0016).
 *
 * Semantics:
 * - load-once: the first getter on a cold process seeds the in-memory map
 *   from the table (one SELECT). The load promise is cached — including a
 *   failed one: a DB hiccup at boot must not turn every getter into a
 *   retry loop. Failures warn and continue in-memory-only.
 * - record: updates the in-memory map IMMEDIATELY (the walk must start
 *   using the smaller span on its very next sub-span, not after a write
 *   round-trip) and persists fire-and-forget; a persist failure warns and
 *   is otherwise dropped — the ceiling is an optimization, and indexing
 *   must never break because a limits table is unavailable.
 *
 * Only EventIndexingService consumes this module (its ceiling halves and
 * converges downward); the transfer/approval services keep their own
 * ladder semantics.
 */

import { db } from '../database/drizzle';
import { providerLimits } from '../database/schema';
// Relative path on purpose: same rule as the other services — the
// vite.config esbuild bundle of the api-app graph must not need the '@/'
// alias.
import { createLogger } from '../server/logger';

const logger = createLogger('provider-ceilings');

// In-memory mirror: the authoritative fast path once seeded.
const memory = new Map<number, bigint>();

// Cached load-once promise (failure included — see module doc).
let loaded: Promise<void> | null = null;

const loadOnce = (): Promise<void> => {
  loaded ??= (async () => {
    try {
      const rows = await db.select().from(providerLimits);
      for (const row of rows) {
        // First seed wins: a walk that already shrank mid-process holds a
        // tighter (more recent) verdict than a stale persisted row.
        if (row.maxLogSpan != null && !memory.has(row.chainId)) {
          memory.set(row.chainId, row.maxLogSpan);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load provider_limits; continuing in-memory-only');
    }
  })();
  return loaded;
};

const persist = async (chainId: number, span: bigint): Promise<void> => {
  try {
    await db
      .insert(providerLimits)
      .values({ chainId, maxLogSpan: span, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: providerLimits.chainId,
        set: { maxLogSpan: span, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, chainId, span }, 'Failed to persist provider log-span ceiling');
  }
};

/** Learned max eth_getLogs block span for a chain, undefined when unknown. */
export const getProviderLogSpanCeiling = async (chainId: number): Promise<bigint | undefined> => {
  const cached = memory.get(chainId);
  if (cached !== undefined) return cached;
  await loadOnce();
  return memory.get(chainId);
};

/** Remember a provider-accepted span: memory now, DB fire-and-forget. */
export const recordProviderLogSpanCeiling = (chainId: number, span: bigint): void => {
  memory.set(chainId, span);
  void persist(chainId, span);
};
