/**
 * reconcileInterruptedRanges: ranges stranded in 'indexing' by a dead
 * process must flip to 'error' with a resume hint (their only recovery
 * path — the UI exposes no action for a range that claims to be indexing),
 * other statuses must stay untouched, and a second run must be a no-op.
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

const insertRange = async (status: string) => {
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
    })
    .returning({ rangeId: indexingRanges.rangeId });
  return rows[0].rangeId;
};

describe('reconcileInterruptedRanges', () => {
  it('flips stranded indexing ranges to error with resume hint; idempotent', async () => {
    const stranded = await insertRange('indexing');
    const completed = await insertRange('completed');
    const pending = await insertRange('pending');

    await reconcileInterruptedRanges();

    const flipped = await db
      .select()
      .from(indexingRanges)
      .where(eq(indexingRanges.rangeId, stranded));
    expect(flipped[0].status).toBe('error');
    expect(flipped[0].errorMessage).toBe(
      'Interrupted by server restart — resume to continue',
    );

    // Second run finds no 'indexing' rows: statuses (and message) unchanged.
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
});
