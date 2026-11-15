/**
 * Migration re-apply regression (2026-11-15 round-10 smoke find): the
 * adapter used to re-verify a RECORDED migration by checking its CREATE
 * TABLE names still exist — but migration 0017 legitimately DROPS four
 * tables older migrations created, so every boot after 0017 applied
 * re-ran those migrations, recreated dropped tables, duplicated journal
 * rows, and hard-failed on ALTER ... ADD COLUMN ("already exists"),
 * aborting the remaining chain mid-boot. This pinned the recurring
 * "trashed journal / non-contiguous ids" incident (2026-11-13/14 waves)
 * as a single-opener bug, not a concurrent-writer artifact.
 *
 * The contract: booting a fully-migrated database a second (and third)
 * time must not re-apply anything — the journal stays contiguous with
 * unique names, tables dropped by later migrations stay dropped, and
 * ALTER-added columns survive.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'be-migration-reapply-'));
const dbPath = join(tempDir, 'chain.db');
const MIGRATION_FILE_COUNT = readdirSync('drizzle').filter(f => f.endsWith('.sql')).length;

// The four tables migration 0017 dropped (created by earlier migrations —
// the exact shape that used to trip the re-apply verifier).
const DROPPED_BY_0017 = [
  'access_history',
  'event_table_registry',
  'index_status',
  'user_preferences',
];

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const { createDuckDBAdapter } = await import('@/database/duckdb-postgres-adapter');

type Probe = {
  journal: Array<{ id: number; name: string | null }>;
  tables: string[];
  hasColumn: (table: string, column: string) => boolean;
};

/** One full boot cycle on the file: connect → migrate → inspect → end. */
async function bootAndInspect(): Promise<Probe> {
  const adapter = createDuckDBAdapter(`duckdb://${dbPath}`);
  try {
    const duck = await adapter.getDuckDB();
    const conn = await duck.connect();
    try {
      const journal = (
        await conn.runAndReadAll('SELECT id, name FROM "drizzle"."__drizzle_migrations" ORDER BY id')
      ).getRowObjects() as Array<{ id: number; name: string | null }>;
      const tables = (
        await conn.runAndReadAll(
          'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
          ['main'],
        )
      ).getRowObjects() as Array<{ table_name: string }>;
      const columns = (
        await conn.runAndReadAll(
          'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1',
          ['main'],
        )
      ).getRowObjects() as Array<{ table_name: string; column_name: string }>;
      return {
        journal,
        tables: tables.map(r => r.table_name),
        hasColumn: (table, column) =>
          columns.some(r => r.table_name === table && r.column_name === column),
      };
    } finally {
      conn.disconnectSync();
    }
  } finally {
    await adapter.end();
  }
}

describe('adapter migration re-apply guard', () => {
  it('applies the full chain once and records a contiguous journal', async () => {
    const first = await bootAndInspect();
    expect(first.journal).toHaveLength(MIGRATION_FILE_COUNT);
    first.journal.forEach((row, index) => expect(row.id).toBe(index + 1));
    expect(new Set(first.journal.map(r => r.name)).size).toBe(MIGRATION_FILE_COUNT);
  });

  it('second boot of a fully-migrated db re-applies nothing', async () => {
    // Pre-fix behavior: 0000/0001 re-applied, dropped tables resurrected,
    // ALTER creation_timestamp hard-failed and aborted the chain.
    const second = await bootAndInspect(); // must not throw

    expect(second.journal).toHaveLength(MIGRATION_FILE_COUNT); // no duplicate rows appended
    second.journal.forEach((row, index) => expect(row.id).toBe(index + 1)); // ids untouched
    for (const dropped of DROPPED_BY_0017) {
      expect(second.tables).not.toContain(dropped);
    }
  });

  it('third boot keeps the file stable and ALTER-added columns alive', async () => {
    const third = await bootAndInspect();
    expect(third.journal).toHaveLength(MIGRATION_FILE_COUNT);
    // creation_timestamp comes from an ALTER in an early migration — the
    // exact statement class whose "already exists" error used to abort
    // boots. Its presence proves the column-add path stayed intact.
    expect(third.hasColumn('contract_creation_info', 'creation_timestamp')).toBe(true);
  });
});
