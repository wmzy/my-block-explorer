/**
 * Adapter SQL-rewrite and migration-race tests.
 *
 * The DEFAULT→NULL rewrite exists only because drizzle's PostgreSQL dialect
 * emits a bare `default` token in INSERT column lists for .default() columns,
 * and DuckDB's prepared-statement API rejects DEFAULT mixed with $n params.
 * These tests pin the rewrite to that shape: INSERT-only and quote-aware, so
 * string literals like 'default' are never silently corrupted to NULL.
 *
 * The end-to-end cases run against a real in-memory DuckDB through the actual
 * adapter (no db mock), mirroring tests/integration/events/arg-filters-duckdb.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createDuckDBAdapter,
  isDuplicateClassError,
  rewriteInsertDefaultTokens,
} from '@/database/duckdb-postgres-adapter';

describe('rewriteInsertDefaultTokens (pure helper)', () => {
  it('leaves SELECT statements containing the word default untouched', () => {
    const sql = `SELECT * FROM labels WHERE label = 'default' AND kind = $1`;
    expect(rewriteInsertDefaultTokens(sql)).toBe(sql);
  });

  it('leaves WITH (CTE) statements containing the word default untouched', () => {
    const sql = `WITH d AS (SELECT 'default' AS v) SELECT * FROM d WHERE v = $1`;
    expect(rewriteInsertDefaultTokens(sql)).toBe(sql);
  });

  it('leaves UPDATE statements containing the word default untouched', () => {
    const sql = `UPDATE labels SET note = 'default' WHERE id = $1`;
    expect(rewriteInsertDefaultTokens(sql)).toBe(sql);
  });

  it('rewrites the bare default token in drizzle-shaped INSERTs to NULL', () => {
    expect(
      rewriteInsertDefaultTokens(
        `insert into "contract_events" ("id","name") values ($1, default)`,
      ),
    ).toBe(`insert into "contract_events" ("id","name") values ($1, NULL)`);
  });

  it('handles DEFAULT/default case variants', () => {
    expect(rewriteInsertDefaultTokens(`INSERT INTO t (a, b) VALUES (DEFAULT, default)`)).toBe(
      `INSERT INTO t (a, b) VALUES (NULL, NULL)`,
    );
  });

  it('preserves default string literals inside INSERT VALUES', () => {
    const sql = `INSERT INTO t (a, b) VALUES ('default', default)`;
    expect(rewriteInsertDefaultTokens(sql)).toBe(`INSERT INTO t (a, b) VALUES ('default', NULL)`);
  });

  it('preserves escaped quotes around default inside INSERT VALUES', () => {
    const sql = `INSERT INTO t (a) VALUES ('it''s default here')`;
    expect(rewriteInsertDefaultTokens(sql)).toBe(sql);
  });

  it('preserves default inside double-quoted identifiers in INSERTs', () => {
    const sql = `INSERT INTO t ("default", id) VALUES ($1, $2)`;
    expect(rewriteInsertDefaultTokens(sql)).toBe(sql);
  });

  it('ignores word-substring matches like defaults or defaulted', () => {
    const sql = `INSERT INTO t (a, b) VALUES ('defaults', default)`;
    expect(rewriteInsertDefaultTokens(sql)).toBe(`INSERT INTO t (a, b) VALUES ('defaults', NULL)`);
  });

  it('returns input unchanged for leading-whitespace non-INSERT statements', () => {
    const sql = `   select 'default'`;
    expect(rewriteInsertDefaultTokens(sql)).toBe(sql);
  });
});

describe('isDuplicateClassError (migration race matcher)', () => {
  it('matches DuckDB catalog conflicts and PK/unique violations', () => {
    expect(
      isDuplicateClassError(new Error('Catalog Error: Table with name "race" already exists.')),
    ).toBe(true);
    expect(
      isDuplicateClassError(
        new Error('Constraint Error: Duplicate key "id: 1" violates primary key constraint.'),
      ),
    ).toBe(true);
    expect(
      isDuplicateClassError(new Error('duplicate key value violates unique constraint "pk"')),
    ).toBe(true);
  });

  it('rejects other statement failures and non-error inputs', () => {
    expect(isDuplicateClassError(new Error('Parser Error: syntax error at or near "FROM"'))).toBe(
      false,
    );
    // Other constraint classes (23502/23503) must keep rethrowing
    expect(isDuplicateClassError(new Error('not null constraint failed: t.a'))).toBe(false);
    expect(isDuplicateClassError(new Error('violates foreign key constraint'))).toBe(false);
    expect(isDuplicateClassError('already exists')).toBe(true);
    expect(isDuplicateClassError(undefined)).toBe(false);
  });
});

describe('DuckDBPostgresAdapter end-to-end (in-memory DuckDB)', () => {
  const sql = createDuckDBAdapter('duckdb://:memory:');
  let migrationsDir = '';

  beforeAll(async () => {
    // First query boots the adapter (runs the repo's real migrations against
    // the in-memory database, same as the integration suite).
    await sql.unsafe(
      `CREATE TABLE sql_rewrite_probe (id integer PRIMARY KEY, label text, kind text)`,
    );
    await sql.unsafe(
      `CREATE TABLE quoted_ident_probe ("default" text, id integer PRIMARY KEY)`,
    );
    await sql.unsafe(
      `INSERT INTO sql_rewrite_probe (id, label, kind) VALUES
        (1, 'default', 'x'),
        (2, 'other', 'x'),
        (3, 'default', 'y')`,
    );

    migrationsDir = await mkdtemp(join(tmpdir(), 'duckdb-migrate-race-'));
    await writeFile(
      join(migrationsDir, '0000_race_probe.sql'),
      [
        `CREATE TABLE race_probe_a (id integer PRIMARY KEY);`,
        `--> statement-breakpoint`,
        `CREATE TABLE race_probe_b (id integer PRIMARY KEY);`,
      ].join('\n'),
    );
  }, 30_000);

  afterAll(async () => {
    await sql.end();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns the matching row for a parameterized SELECT with a default string literal', async () => {
    const rows = await sql.unsafe(
      `SELECT id, label FROM sql_rewrite_probe WHERE label = 'default' AND kind = $1`,
      ['x'],
    );
    // Before the fix the statement-wide rewrite produced label = 'NULL' and
    // silently returned zero rows.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, label: 'default' });
  });

  it('rewrites bare default tokens in parameterized INSERTs to NULL', async () => {
    await sql.unsafe(
      `INSERT INTO sql_rewrite_probe (id, label, kind) VALUES ($1, default, $2)`,
      [10, 'z'],
    );
    const rows = await sql.unsafe(`SELECT label FROM sql_rewrite_probe WHERE id = $1`, [10]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBeNull();
  });

  it('preserves default inside double-quoted identifiers end to end', async () => {
    await sql.unsafe(`INSERT INTO quoted_ident_probe ("default", id) VALUES ($1, $2)`, [
      'kept',
      1,
    ]);
    const rows = await sql.unsafe(`SELECT "default" AS v FROM quoted_ident_probe WHERE id = $1`, [
      1,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].v).toBe('kept');
  });

  it('preserves default string literals inside transactions', async () => {
    const rows = await sql.begin(tx =>
      tx.unsafe(`SELECT id FROM sql_rewrite_probe WHERE label = 'default' AND kind = $1`, ['y']),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(3);
  });

  it('tolerates a lost CREATE TABLE race when the table verifiably exists', async () => {
    await sql.migrate({ migrationsFolder: migrationsDir });

    // Simulate the losing process: the concurrent winner created the tables
    // and journal row, then this process' snapshot lost the journal row (the
    // loop-level existence check misses) — previously the re-run died on
    // DuckDB's 'already exists' catalog error.
    await sql.unsafe(`DELETE FROM "drizzle"."__drizzle_migrations" WHERE name = $1`, [
      '0000_race_probe',
    ]);

    await expect(sql.migrate({ migrationsFolder: migrationsDir })).resolves.toBeUndefined();

    const journal = await sql.unsafe(
      `SELECT name, hash FROM "drizzle"."__drizzle_migrations" WHERE name = $1`,
      ['0000_race_probe'],
    );
    expect(journal).toHaveLength(1);
    expect(journal[0].name).toBe('0000_race_probe');
  }, 30_000);

  it('still rethrows non-duplicate migration failures unchanged', async () => {
    const brokenDir = await mkdtemp(join(tmpdir(), 'duckdb-migrate-broken-'));
    try {
      await writeFile(join(brokenDir, '0000_broken_probe.sql'), `CREATE TABLE broken_probe (oops ;`);
      await expect(sql.migrate({ migrationsFolder: brokenDir })).rejects.toThrow(
        /broken_probe|syntax/i,
      );
    } finally {
      await rm(brokenDir, { recursive: true, force: true });
    }
  }, 30_000);
});
