// ChainCacheService contract: a dev-chain reset clear deletes ONLY the
// chain's rows in the two immutable fetch caches (contract_sources,
// storage_layouts), counts each table immediately before its delete and
// reports those counts verbatim (normalizing DuckDB's string count(*)),
// and lets failures propagate so the route can answer 500. The drizzle
// client is faked (storageLayoutService.test.ts pattern) with the REAL
// schema tables, so the captured predicates carry genuine drizzle
// columns and bind values.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contractSources, storageLayouts } from '@/database/schema';

const state = vi.hoisted(() => {
  // rows per table as count(*) would report them (string on purpose for
  // one table: the adapter surfaces DuckDB counts as strings; the record
  // type stays wide so per-table lookups and resets mix both shapes —
  // declared, not asserted, so tsc and eslint agree).
  const counts: Record<string, number | string> = {
    contract_sources: 3,
    storage_layouts: '2',
  };
  return {
    counts,
    // ordered log of db operations: ['count:contract_sources', 'delete:...', ...]
    ops: [] as Array<string>,
    // raw where-predicate per op, in call order
    conditions: [] as Array<unknown>,
    // when set, db.delete rejects with this error
    deleteError: null as Error | null,
  };
});

const tableNameOf = (table: unknown): string => {
  if (table === contractSources) return 'contract_sources';
  if (table === storageLayouts) return 'storage_layouts';
  return String(table);
};

vi.mock('@/database/drizzle', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          const name = tableNameOf(table);
          state.ops.push(`count:${name}`);
          state.conditions.push(condition);
          return {
            then: (resolve: unknown, reject: unknown) =>
              Promise.resolve([{ count: state.counts[name] ?? 0 }]).then(
                resolve as never,
                reject as never,
              ),
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (condition: unknown) => {
        const name = tableNameOf(table);
        state.ops.push(`delete:${name}`);
        state.conditions.push(condition);
        if (state.deleteError) return Promise.reject(state.deleteError);
        return Promise.resolve([]);
      },
    }),
  },
}));

import { chainCacheService } from '@/services/ChainCacheService';

const CHAIN = 31337;

// drizzle lays an eq() predicate out as queryChunks
// [glue, column, glue, Param(value), glue]. Scanning for the known
// column identities (reference equality against the real schema) and for
// the Param (the only chunk with both `value` and `encoder`) keeps the
// scoping assertion independent of the glue ordering.
function predicateParts(condition: unknown): { column: unknown; value: unknown } {
  const chunks
    = (condition as { queryChunks?: ReadonlyArray<unknown> } | null)?.queryChunks ?? [];
  let column: unknown = null;
  let value: unknown = undefined;
  for (const chunk of chunks) {
    if (chunk === contractSources.chainId || chunk === storageLayouts.chainId) {
      column = chunk;
    }
    if (
      typeof chunk === 'object'
      && chunk !== null
      && 'value' in chunk
      && 'encoder' in chunk
    ) {
      value = (chunk as { value: unknown }).value;
    }
  }
  return { column, value };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.counts = { contract_sources: 3, storage_layouts: '2' };
  state.ops.length = 0;
  state.conditions.length = 0;
  state.deleteError = null;
});

describe('clearChainCachedData', () => {
  it('counts each table immediately before deleting it, and only those two tables', async () => {
    await chainCacheService.clearChainCachedData(CHAIN);

    expect(state.ops).toEqual([
      'count:contract_sources',
      'delete:contract_sources',
      'count:storage_layouts',
      'delete:storage_layouts',
    ]);
  });

  it('scopes every predicate (count and delete) to exactly this chain', async () => {
    await chainCacheService.clearChainCachedData(CHAIN);

    expect(state.conditions).toHaveLength(4);
    for (const condition of state.conditions) {
      const { column, value } = predicateParts(condition);
      expect(value).toBe(CHAIN);
      expect([contractSources.chainId, storageLayouts.chainId]).toContain(column);
    }
  });

  it('reports the counted rows verbatim, normalizing string counts to numbers', async () => {
    const cleared = await chainCacheService.clearChainCachedData(CHAIN);

    expect(cleared).toEqual({ contractSources: 3, storageLayouts: 2 });
  });

  it('reports honest zeros when nothing was cached for the chain', async () => {
    state.counts = { contract_sources: 0, storage_layouts: 0 };

    const cleared = await chainCacheService.clearChainCachedData(CHAIN);

    expect(cleared).toEqual({ contractSources: 0, storageLayouts: 0 });
  });

  it('propagates a database failure so the route can answer 500', async () => {
    state.deleteError = new Error('duckdb: database is locked');

    await expect(chainCacheService.clearChainCachedData(CHAIN)).rejects.toThrow(
      'duckdb: database is locked',
    );
  });
});
