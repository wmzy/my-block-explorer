/**
 * reconcileInterruptedRanges: ranges stranded in 'indexing' by a dead
 * process must flip to 'error' with a resume hint (their only recovery
 * path — the UI exposes no action for a range that claims to be indexing),
 * other statuses must stay untouched, and a second run must be a no-op.
 * Only STALE rows flip: a row whose updated_at is fresh may belong to a
 * live walk in a peer process (the documented dual-process dev topology),
 * so flipping it would strand a second loop on the same range — see the
 * INTERRUPTED_ROW_STALE_MS rule in EventIndexingService.
 * Runs against a real in-memory DuckDB so the drizzle UPDATE is exercised.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/database/drizzle', async () => {
  const { createDuckDBAdapter } = await import('@/database/duckdb-postgres-adapter');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const schema = await import('@/database/schema');
  const db = drizzle(createDuckDBAdapter('duckdb://:memory:'), {
    schema,
    casing: 'snake_case',
  });
  return { db, ...schema };
});

vi.mock('@/database/init', async () => await import('@/database/drizzle'));

import { eq } from 'drizzle-orm';
import { db } from '@/database/drizzle';
import { indexingRanges } from '@/database/schema';
import { reconcileInterruptedRanges } from '@/services/EventIndexingService';

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// Older than the service's 2-minute staleness threshold.
const STALE_UPDATED_AT = () => new Date(Date.now() - 5 * 60 * 1000);

const insertRange = async (status: string, updatedAt: Date) => {
  const rows = await db
    .insert(indexingRanges)
    .values({
      chainId: CHAIN_ID,
      address: ADDRESS,
      rangeId: Math.floor(Math.random() * 1_000_000),
      fromBlock: 0n,
      toBlock: 100n,
      direction: 'forward',
      currentBlock: null,
      status,
      totalEventsIndexed: 0,
      errorMessage: null,
      priority: 0,
      createdAt: updatedAt,
      updatedAt,
    })
    .returning({ rangeId: indexingRanges.rangeId });
  return rows[0].rangeId;
};

describe('reconcileInterruptedRanges', () => {
  it('flips stranded indexing ranges to error with resume hint; idempotent', async () => {
    const stranded = await insertRange('indexing', STALE_UPDATED_AT());
    const completed = await insertRange('completed', STALE_UPDATED_AT());
    const pending = await insertRange('pending', STALE_UPDATED_AT());

    await reconcileInterruptedRanges();

    const flipped = await db
      .select()
      .from(indexingRanges)
      .where(eq(indexingRanges.rangeId, stranded));
    expect(flipped[0].status).toBe('error');
    expect(flipped[0].errorMessage).toBe('Interrupted by server restart — resume to continue');

    // Second run finds no stale 'indexing' rows: statuses (and message)
    // unchanged.
    await reconcileInterruptedRanges();
    const after = await db.select().from(indexingRanges);
    const byId = new Map(after.map(r => [r.rangeId, r]));
    expect(byId.get(stranded)?.status).toBe('error');
    expect(byId.get(stranded)?.errorMessage).toBe(
      'Interrupted by server restart — resume to continue',
    );
    expect(byId.get(completed)?.status).toBe('completed');
    expect(byId.get(pending)?.status).toBe('pending');
  });

  it('leaves fresh indexing rows alone (a peer process may be walking them)', async () => {
    const fresh = await insertRange('indexing', new Date());

    await reconcileInterruptedRanges();

    const row = await db.select().from(indexingRanges).where(eq(indexingRanges.rangeId, fresh));
    expect(row[0].status).toBe('indexing');
    expect(row[0].errorMessage).toBeNull();

    // A row with NULL updated_at (legacy rows predating the column) cannot
    // be proven fresh and still flips.
    const legacy = await insertRange('indexing', new Date());
    await db
      .update(indexingRanges)
      .set({ updatedAt: null })
      .where(eq(indexingRanges.rangeId, legacy));
    await reconcileInterruptedRanges();
    const legacyRow = await db
      .select()
      .from(indexingRanges)
      .where(eq(indexingRanges.rangeId, legacy));
    expect(legacyRow[0].status).toBe('error');
  });
});
