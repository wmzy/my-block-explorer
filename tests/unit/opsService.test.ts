// OpsService pure-helper contract: file-name → chain identity derivation
// (documented {name}-{id}.db pattern, including odd names), status-count
// folding (raw rows and pre-aggregated GROUP BY rows, driver-stringified
// counts), per-chain grouping, DATABASE_URL parsing (mirroring the
// adapter), and the real-fs storage scan over a temp tree (no DuckDB —
// the drizzle module is faked at import time, watchService.test.ts
// precedent).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@/database/drizzle', () => ({ db: {} }));

import {
  collectStorageSummary,
  countByStatus,
  deriveChainFileMeta,
  groupCountsByChain,
  parseMainDbPath,
  summarizeFiles,
} from '@/services/OpsService';

describe('summarizeFiles', () => {
  it('totals count and bytes over a listing', () => {
    expect(summarizeFiles([{ bytes: 100 }, { bytes: 28 }])).toEqual({
      files: 2,
      bytes: 128,
    });
  });

  it('returns explicit zeros for an empty listing', () => {
    expect(summarizeFiles([])).toEqual({ files: 0, bytes: 0 });
  });
});

describe('deriveChainFileMeta — documented pattern data/chains/{type}/{name}-{id}.db', () => {
  it('derives name and numeric id from a plain file', () => {
    expect(deriveChainFileMeta('mainnet', 'ethereum-1.db')).toEqual({
      chainType: 'mainnet',
      name: 'ethereum',
      chainId: 1,
    });
  });

  it('treats the LAST dash segment as the id (names may contain dashes)', () => {
    expect(deriveChainFileMeta('testnet', 'optimism-sepolia-11155420.db')).toEqual({
      chainType: 'testnet',
      name: 'optimism-sepolia',
      chainId: 11155420,
    });
  });

  it('accepts an uppercase .DB extension', () => {
    expect(deriveChainFileMeta('mainnet', 'Polygon-137.DB')).toEqual({
      chainType: 'mainnet',
      name: 'Polygon',
      chainId: 137,
    });
  });

  it('keeps the raw stem with chainId: null when there is no numeric tail', () => {
    expect(deriveChainFileMeta('mainnet', 'notes.db')).toEqual({
      chainType: 'mainnet',
      name: 'notes',
      chainId: null,
    });
    expect(deriveChainFileMeta('mainnet', 'weird-name.db')).toEqual({
      chainType: 'mainnet',
      name: 'weird-name',
      chainId: null,
    });
  });

  it('treats a trailing dash as unparseable (empty id segment)', () => {
    expect(deriveChainFileMeta('mainnet', 'chain-.db')).toEqual({
      chainType: 'mainnet',
      name: 'chain-',
      chainId: null,
    });
  });

  it('parses a leading-dash name into an empty name with the id', () => {
    expect(deriveChainFileMeta('mainnet', '-5.db')).toEqual({
      chainType: 'mainnet',
      name: '',
      chainId: 5,
    });
  });

  it('degrades an id beyond Number.isSafeInteger to chainId: null', () => {
    expect(deriveChainFileMeta('mainnet', 'chain-99999999999999999999.db')).toEqual({
      chainType: 'mainnet',
      name: 'chain-99999999999999999999',
      chainId: null,
    });
  });

  it('leaves a non-.db file name whole', () => {
    expect(deriveChainFileMeta('mainnet', 'foo.bar')).toEqual({
      chainType: 'mainnet',
      name: 'foo.bar',
      chainId: null,
    });
  });
});

describe('countByStatus', () => {
  it('counts raw rows (no count field) one each', () => {
    expect(
      countByStatus([
        { status: 'pending' },
        { status: 'error' },
        { status: 'pending' },
      ]),
    ).toEqual({ pending: 2, error: 1 });
  });

  it('folds pre-aggregated GROUP BY rows with numeric counts', () => {
    expect(
      countByStatus([
        { status: 'completed', count: 8 },
        { status: 'error', count: 2 },
      ]),
    ).toEqual({ completed: 8, error: 2 });
  });

  it('folds driver-stringified counts (bigint → string mapping)', () => {
    expect(countByStatus([{ status: 'completed', count: '12' }])).toEqual({
      completed: 12,
    });
  });

  it('accumulates repeated statuses and drops a malformed count to 0', () => {
    expect(
      countByStatus([
        { status: 'indexing', count: 3 },
        { status: 'indexing', count: 2 },
        { status: 'paused', count: 'not-a-number' },
        { status: 'paused' },
      ]),
    ).toEqual({ indexing: 5, paused: 1 });
  });
});

describe('groupCountsByChain', () => {
  it('groups per chain, sums totals, sorts by chainId', () => {
    expect(
      groupCountsByChain([
        { chainId: 137, status: 'completed', count: 4 },
        { chainId: 1, status: 'pending' },
        { chainId: 137, status: 'error', count: 1 },
        { chainId: 1, status: 'pending' },
        { chainId: 1, status: 'completed', count: '2' },
      ]),
    ).toEqual([
      { chainId: 1, statuses: { pending: 2, completed: 2 }, total: 4 },
      { chainId: 137, statuses: { completed: 4, error: 1 }, total: 5 },
    ]);
  });

  it('accepts string chain ids (driver normalization) but skips non-numeric ones', () => {
    expect(
      groupCountsByChain([
        { chainId: '137', status: 'pending' },
        { chainId: 'not-a-number', status: 'pending' },
      ]),
    ).toEqual([{ chainId: 137, statuses: { pending: 1 }, total: 1 }]);
  });

  it('returns an empty list for no rows', () => {
    expect(groupCountsByChain([])).toEqual([]);
  });
});

describe('parseMainDbPath (mirrors the adapter parseConnectionString)', () => {
  it('strips the duckdb:// scheme', () => {
    expect(parseMainDbPath('duckdb://data/blockchain.db')).toBe('data/blockchain.db');
    expect(parseMainDbPath('duckdb:///srv/explorer/main.db')).toBe('/srv/explorer/main.db');
  });

  it('falls back to the default path when unset or not a duckdb:// URL', () => {
    expect(parseMainDbPath(undefined)).toBe('data/blockchain.db');
    expect(parseMainDbPath('')).toBe('data/blockchain.db');
    expect(parseMainDbPath('postgres://localhost/x')).toBe('data/blockchain.db');
  });
});

describe('collectStorageSummary — real fs over a temp tree', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ops-storage-'));
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    await rm(root, { recursive: true, force: true });
  });

  it('scans the main db, per-chain .db files and the solc cache', async () => {
    await mkdir(join(root, 'chains', 'mainnet'), { recursive: true });
    await mkdir(join(root, 'chains', 'testnet'), { recursive: true });
    await mkdir(join(root, 'solc-cache'), { recursive: true });
    await writeFile(join(root, 'blockchain.db'), '0123456789');
    await writeFile(join(root, 'chains', 'mainnet', 'ethereum-1.db'), 'abcd');
    await writeFile(join(root, 'chains', 'mainnet', 'polygon-137.db'), 'abcdef');
    await writeFile(join(root, 'chains', 'mainnet', 'stray.txt'), 'xxx');
    await writeFile(join(root, 'chains', 'testnet', 'sepolia-11155111.db'), 'ab');
    await writeFile(join(root, 'solc-cache', 'soljson-v0.8.37.cjs'), 'abcdef');
    process.env.DATABASE_URL = `duckdb://${join(root, 'blockchain.db')}`;

    const summary = await collectStorageSummary();

    expect(summary.mainDbBytes).toBe(10);
    // Only .db files, sorted per chain-type directory, meta derived from
    // the documented pattern; the stray non-db file never appears.
    expect(summary.perChainDbFiles).toEqual([
      expect.objectContaining({ chainType: 'mainnet', name: 'ethereum', chainId: 1, bytes: 4 }),
      expect.objectContaining({ chainType: 'mainnet', name: 'polygon', chainId: 137, bytes: 6 }),
      expect.objectContaining({ chainType: 'testnet', name: 'sepolia', chainId: 11155111, bytes: 2 }),
    ]);
    expect(
      summary.perChainDbFiles.every(file => typeof file.mtime === 'string' && file.mtime.endsWith('Z')),
    ).toBe(true);
    expect(summary.solcCache).toEqual({ files: 1, bytes: 6 });
  });

  it('reports honest zeros/nulls for a fresh install with nothing on disk', async () => {
    process.env.DATABASE_URL = `duckdb://${join(root, 'blockchain.db')}`;

    const summary = await collectStorageSummary();

    // The main db file does not exist yet: unknown (null), never a
    // fabricated 0. Missing chains/ and solc-cache/ are empty facts.
    expect(summary.mainDbBytes).toBeNull();
    expect(summary.perChainDbFiles).toEqual([]);
    expect(summary.solcCache).toEqual({ files: 0, bytes: 0 });
  });
});
