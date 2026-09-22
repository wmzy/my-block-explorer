// Built-in label seeding — plants the curated dataset from
// config/builtinLabels.ts into address_labels so a fresh local instance
// already "knows" the chain it is browsing. Called once per process start
// from RpcManager.loadUserConfigs (the one bootstrap both the standalone
// server and the vite dev bridge share); local-only, zero network.
//
// Semantics:
// - FIRST-STARTUP ONLY: seeding is gated on the table being empty. A
//   deleted built-in row must STAY deleted (the user said remove it), so
//   the seeder never re-runs against a table that already holds rows.
//   Within the one seeding pass the INSERT still carries
//   onConflictDoNothing — the never-overwrite guarantee (user-edited
//   rows, concurrent writers) is enforced at the SQL layer, not by the
//   emptiness check alone. The one re-arm edge: deleting EVERY label
//   (built-in and own) returns the table to "fresh" state and the next
//   start reseeds — an honest trade for keeping deletions sticky without
//   a tombstone table.
// - FAILURES ARE SWALLOWED (logged, never thrown): seeding is cosmetic
//   convenience — a locked or half-migrated database must still boot the
//   RPC layer, just without the bundled names.
import type { db as AppDatabase } from './init';
import { addressLabels } from './schema';
import { BUILTIN_LABELS } from '../config/builtinLabels';
import { createLogger } from '../server/logger';

const logger = createLogger('seed-builtin-labels');

// Structural slice of the drizzle database the seeder needs — keeps the
// function injectable for tests (a tiny fake beats module-level mocks).
export type LabelSeedDb = Pick<typeof AppDatabase, 'select' | 'insert'>;

/**
 * Seed the built-in label dataset. Idempotent: a table that already has
 * any row is left untouched, and the insert itself conflicts away rows
 * that appeared concurrently. Never throws.
 */
export async function seedBuiltinLabels(db: LabelSeedDb): Promise<void> {
  try {
    const existing = await db
      .select({ chainId: addressLabels.chainId })
      .from(addressLabels)
      .limit(1);
    if (existing.length > 0) return;

    await db
      .insert(addressLabels)
      .values(
        BUILTIN_LABELS.map(entry => ({
          chainId: entry.chainId,
          address: entry.address,
          label: entry.label,
          note: entry.note ?? null,
          source: 'builtin',
        })),
      )
      .onConflictDoNothing({
        target: [addressLabels.chainId, addressLabels.address],
      });
    logger.info({ count: BUILTIN_LABELS.length }, 'Seeded built-in address labels');
  }
  catch (error) {
    logger.error({ err: error }, 'Built-in label seeding failed (continuing without seeds)');
  }
}
