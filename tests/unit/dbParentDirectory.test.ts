// The DuckDB adapter must create the PARENT DIRECTORY OF THE DATABASE IT
// WAS ASKED TO OPEN, not a hardcoded `data/`.
//
// It mkdir'd `join(process.cwd(), 'data')` regardless of the connection
// string, so any database in a nested path — the per-chain event stores at
// `data/chains/{mainnet,testnet}/{name}-{id}.db` — failed to open with
// "Cannot open file ...: No such file or directory" on a fresh install,
// and ChainDatabaseManager.initialize() compounded it by creating only
// `data/chains`, never the `{type}` level below it.
//
// The parent must be derived from the resolved dbPath, which also covers a
// relative DATABASE_URL (the documented default 'duckdb://data/blockchain.db')
// whose dirname is relative to cwd.
//
// These tests drive the real adapter against a temp directory.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, relative } from 'path';

import { createDuckDBAdapter } from '@/database/duckdb-postgres-adapter';

const created: string[] = [];

const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-dirs-'));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createDuckDBAdapter creates the parent directory of its own path', () => {
  it('opens a database in a two-level nested path that does not exist yet', async () => {
    const root = tempRoot();
    // Exactly the shape ChainDatabaseManager builds: data/chains/mainnet/x.db
    const dbPath = join(root, 'data', 'chains', 'mainnet', 'ethereum-1.db');

    const adapter = createDuckDBAdapter(`duckdb://${dbPath}`);
    try {
      await adapter.unsafe('CREATE TABLE t (id INTEGER)');
      await adapter.unsafe('INSERT INTO t VALUES (1)');

      const rows = (await adapter.unsafe('SELECT * FROM t')) as unknown[];
      expect(rows).toHaveLength(1);
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      await adapter.end();
    }
  });

  it('creates every missing level, not just the first', async () => {
    const root = tempRoot();
    const dbPath = join(root, 'a', 'b', 'c', 'deep.db');

    const adapter = createDuckDBAdapter(`duckdb://${dbPath}`);
    try {
      await adapter.unsafe('SELECT 1');
      expect(existsSync(join(root, 'a', 'b', 'c'))).toBe(true);
    } finally {
      await adapter.end();
    }
  });

  it('still works for the single-level default path (no regression)', async () => {
    const root = tempRoot();
    const dbPath = join(root, 'blockchain.db');

    const adapter = createDuckDBAdapter(`duckdb://${dbPath}`);
    try {
      await adapter.unsafe('CREATE TABLE t (id INTEGER)');
      expect((await adapter.unsafe('SELECT * FROM t')) as unknown[]).toHaveLength(0);
    } finally {
      await adapter.end();
    }
  });

  it('creates the parent of a relative connection string resolved against cwd', async () => {
    const root = tempRoot();
    const previousCwd = process.cwd();
    // A symlink keeps ./drizzle (migrations are resolved relative to cwd)
    // reachable while the relative path itself lands in the temp tree.
    const workDir = join(root, 'work');
    mkdirSync(workDir, { recursive: true });
    symlinkSync(join(process.cwd(), 'drizzle'), join(workDir, 'drizzle'), 'dir');
    process.chdir(workDir);
    try {
      // The documented default shape: duckdb://data/blockchain.db
      // (relative — dirname() is 'data', which mkdir resolves against
      // cwd). A full open proves the awaited directory creation happened
      // BEFORE the file was touched; the assertion is on the directory
      // because DuckDB may not flush the .db file until close.
      const adapter = createDuckDBAdapter('duckdb://data/blockchain.db');
      try {
        await adapter.unsafe('CREATE TABLE t (id INTEGER)');
        // Relative paths resolve against cwd, which is workDir here.
        expect(existsSync(join(workDir, 'data'))).toBe(true);
      } finally {
        await adapter.end();
      }
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('ChainDatabaseManager.initialize creates the chain-type directory', () => {
  it('creates data/chains/{type} before opening the chain database', async () => {
    const root = tempRoot();
    // A symlink keeps ./drizzle (migrations are resolved relative to cwd)
    // reachable while the chain database itself lands in the temp tree.
    const workDir = join(root, 'work');
    mkdirSync(workDir, { recursive: true });
    symlinkSync(join(process.cwd(), 'drizzle'), join(workDir, 'drizzle'), 'dir');

    const previousCwd = process.cwd();
    process.chdir(workDir);
    try {
      const { ChainDatabaseManager } = await import('@/database/chain-database-manager');
      const manager = new ChainDatabaseManager(1);
      try {
        // The failure this pins: initialize() created only `data/chains`,
        // so the `mainnet/` level below it was missing and the open threw
        // "Cannot open file .../data/chains/mainnet/ethereum-1.db".
        await expect(manager.initialize()).resolves.toBeUndefined();

        const path = manager.getDatabasePath();
        expect(existsSync(dirname(path))).toBe(true);
        expect(relative(root, path)).toContain(join('chains', 'mainnet'));
      } finally {
        await manager.close().catch(() => undefined);
      }
    } finally {
      process.chdir(previousCwd);
    }
  });
});
