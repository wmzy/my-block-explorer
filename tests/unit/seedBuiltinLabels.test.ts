// Built-in label seeding: first-startup gating (empty table seeds,
// non-empty table is untouched so user deletions stick), the SQL-layer
// never-overwrite guarantee (onConflictDoNothing on the PK target),
// failure swallowing (select or insert throwing never propagates), and
// dataset hygiene (lowercase well-formed addresses, unique keys, label
// length caps matching the varchar(64) column). The db is injected as a
// tiny structural fake — the seeder deliberately has no runtime db
// dependency, so no module mocks are needed.
import { describe, it, expect } from 'vitest';
import { seedBuiltinLabels, type LabelSeedDb } from '@/database/seedBuiltinLabels';
import { BUILTIN_LABELS } from '@/config/builtinLabels';
import { addressLabels } from '@/database/schema';

type InsertCall = {
  values: Array<Record<string, unknown>>;
  conflict: { target: unknown } | null;
};

// Builder-style fake mirroring the drizzle query chain shape the seeder
// uses: select().from().limit() and insert().values().onConflictDoNothing().
const makeFakeDb = (opts: { existingRows: number; failSelect?: boolean; failInsert?: boolean }) => {
  const inserts: InsertCall[] = [];
  const db = {
    select: () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        limit: () =>
          opts.failSelect === true
            ? Promise.reject(new Error('database is locked'))
            : Promise.resolve(Array.from({ length: opts.existingRows })),
      };
      return chain;
    },
    insert: () => {
      const chain: Record<string, unknown> = {
        values: (rows: Array<Record<string, unknown>>) => {
          const call: InsertCall = { values: rows, conflict: null };
          inserts.push(call);
          chain.onConflictDoNothing = (conflict: { target: unknown }) => {
            call.conflict = conflict;
            return opts.failInsert === true
              ? Promise.reject(new Error('constraint violation'))
              : Promise.resolve([]);
          };
          return chain;
        },
      };
      return chain;
    },
  };
  // The fake mirrors only the call shape the seeder uses; one structural
  // cast bridges the hand-rolled chain to the drizzle-derived param type.
  return { db: db as unknown as LabelSeedDb, inserts };
};

describe('seedBuiltinLabels', () => {
  it('seeds the full dataset with source builtin and a PK-targeted conflict clause on an empty table', async () => {
    const { db, inserts } = makeFakeDb({ existingRows: 0 });
    await seedBuiltinLabels(db);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toHaveLength(BUILTIN_LABELS.length);
    for (const row of inserts[0]?.values ?? []) {
      expect(row.source).toBe('builtin');
      expect(row.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(typeof row.label).toBe('string');
    }
    // Never-overwrite guarantee rides on the same PK the route upserts
    // against: (chainId, address).
    expect(inserts[0]?.conflict?.target).toEqual([
      addressLabels.chainId,
      addressLabels.address,
    ]);
  });

  it('maps absent notes to null (the column is NOT NULL-incompatible text, not undefined)', async () => {
    const { db, inserts } = makeFakeDb({ existingRows: 0 });
    await seedBuiltinLabels(db);
    for (const row of inserts[0]?.values ?? []) {
      expect(row.note === null || typeof row.note === 'string').toBe(true);
    }
  });

  it('is a no-op when the table already holds rows (deletions stick across restarts)', async () => {
    const { db, inserts } = makeFakeDb({ existingRows: 1 });
    await seedBuiltinLabels(db);
    expect(inserts).toHaveLength(0);
  });

  it('swallows a failing select (half-migrated database still boots)', async () => {
    const { db } = makeFakeDb({ existingRows: 0, failSelect: true });
    await expect(seedBuiltinLabels(db)).resolves.toBeUndefined();
  });

  it('swallows a failing insert', async () => {
    const { db } = makeFakeDb({ existingRows: 0, failInsert: true });
    await expect(seedBuiltinLabels(db)).resolves.toBeUndefined();
  });
});

describe('BUILTIN_LABELS dataset hygiene', () => {
  it('stores every address lowercase and well-formed (C-3 storage convention)', () => {
    for (const entry of BUILTIN_LABELS) {
      expect(entry.address).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });

  it('has no duplicate (chainId, address) keys', () => {
    const keys = BUILTIN_LABELS.map(e => `${e.chainId}:${e.address}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('fits the route/table caps: labels 1-64 chars, notes <= 500 chars', () => {
    for (const entry of BUILTIN_LABELS) {
      expect(entry.label.trim().length).toBeGreaterThanOrEqual(1);
      expect(entry.label.length).toBeLessThanOrEqual(64);
      if (entry.note !== undefined) expect(entry.note.length).toBeLessThanOrEqual(500);
    }
  });

  it('only seeds chains the curated set was verified for', () => {
    const allowed = new Set([1, 137, 42161, 10, 8453, 56, 43114]);
    for (const entry of BUILTIN_LABELS) expect(allowed.has(entry.chainId)).toBe(true);
  });
});
