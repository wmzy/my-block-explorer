// `my-block-explorer uninstall` contract: target enumeration (DATABASE_URL
// layouts — the same parse as the adapter's), on-disk stats, removal with
// per-target failure surfacing, the running-server probe, and the full
// decision flow (never delete without an explicit yes; non-interactive
// sessions keep data; a server on the discovery ports blocks deletion
// unless --force). Filesystem paths are exercised against real temp dirs.
import { describe, it, expect } from 'vitest';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectTargetStats,
  defaultProbePorts,
  formatBytes,
  probeRunningServers,
  removeTargets,
  resolveUninstallTargets,
  runUninstall,
} from '@/uninstall';

async function makeDataDir(root: string): Promise<void> {
  await mkdir(join(root, 'data', 'chains', 'mainnet'), { recursive: true });
  await mkdir(join(root, 'data', 'solc-cache'), { recursive: true });
  await writeFile(join(root, 'data', 'blockchain.db'), 'main-db'); // 8 bytes
  await writeFile(join(root, 'data', 'blockchain.db.wal'), 'wal'); // 3 bytes
  await writeFile(join(root, 'data', 'chains', 'mainnet', 'ethereum-1.db'), 'events'); // 6 bytes... see totals below
  await writeFile(join(root, 'data', 'solc-cache', 'soljson.cjs'), 'compiler'); // 8 bytes
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'be-uninstall-'));
  await makeDataDir(root);
  return root;
}

const DATA_BYTES =
  'main-db'.length + 'wal'.length + 'events'.length + 'compiler'.length; // 24

/** Always-refusing fetch stub — never touch real loopback ports in tests. */
const offlineFetch = (async () => {
  throw new Error('offline');
}) as typeof fetch;

describe('resolveUninstallTargets', () => {
  const tmpRoot = '/tmp/uninstall-test-root';

  it('default layout: the whole cwd/data dir plus the IDE scratch dir', () => {
    const targets = resolveUninstallTargets({ cwd: '/proj', databaseUrl: undefined, tmpRoot });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ kind: 'data-dir', path: '/proj/data', label: 'data' });
    expect(targets[1]).toMatchObject({
      kind: 'tmp-scratch',
      path: join(tmpRoot, 'block-explorer-contracts'),
    });
  });

  it('DATABASE_URL inside cwd/data still collapses to the single data-dir target', () => {
    const targets = resolveUninstallTargets({
      cwd: '/proj',
      databaseUrl: 'duckdb://data/custom.db',
      tmpRoot,
    });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ kind: 'data-dir', path: '/proj/data' });
  });

  it('custom absolute DATABASE_URL: main db + wal separately, chains/solc stay cwd-based', () => {
    const targets = resolveUninstallTargets({
      cwd: '/proj',
      databaseUrl: 'duckdb:///srv/explorer/main.db',
      tmpRoot,
    });
    expect(targets.map(t => t.kind)).toEqual([
      'main-db',
      'main-db-wal',
      'chains',
      'solc-cache',
      'tmp-scratch',
    ]);
    expect(targets[0].path).toBe('/srv/explorer/main.db');
    expect(targets[1].path).toBe('/srv/explorer/main.db.wal');
    expect(targets[2].path).toBe('/proj/data/chains');
    expect(targets[3].path).toBe('/proj/data/solc-cache');
    expect(targets[0].label).toBe('/srv/explorer/main.db'); // outside cwd → absolute label
  });

  it(':memory: main db has no file of its own — the data-dir target still covers chains/solc', () => {
    const targets = resolveUninstallTargets({
      cwd: '/proj',
      databaseUrl: 'duckdb://:memory:',
      tmpRoot,
    });
    expect(targets.map(t => t.kind)).toEqual(['data-dir', 'tmp-scratch']);
    expect(targets[0].path).toBe('/proj/data');
  });

  it('non-duckdb DATABASE_URL falls back to the default layout (adapter parse)', () => {
    const targets = resolveUninstallTargets({
      cwd: '/proj',
      databaseUrl: 'postgres://localhost/x',
      tmpRoot,
    });
    expect(targets[0]).toMatchObject({ kind: 'data-dir', path: '/proj/data' });
  });
});

describe('collectTargetStats + removeTargets (real fs)', () => {
  it('walks sizes recursively, reports absence, and removes exactly the targets', async () => {
    const root = await tempWorkspace();
    const tmpRoot = await mkdtemp(join(tmpdir(), 'be-uninstall-tmp-'));
    const targets = resolveUninstallTargets({ cwd: root, databaseUrl: undefined, tmpRoot });

    const stats = await collectTargetStats(targets);
    const byKind = new Map(stats.map(entry => [entry.target.kind, entry]));
    expect(byKind.get('data-dir')).toMatchObject({ exists: true, files: 4 });
    expect(byKind.get('data-dir')?.bytes).toBe(DATA_BYTES);
    expect(byKind.get('tmp-scratch')).toMatchObject({ exists: false, bytes: 0, files: 0 });

    const { results, freedBytes } = await removeTargets(stats, root);
    expect(results.every(result => result.removed)).toBe(true);
    expect(freedBytes).toBe(DATA_BYTES);
    expect(await pathExists(join(root, 'data'))).toBe(false);
    // untouched: the workspace root itself
    expect(await pathExists(root)).toBe(true);
  });

  it('removeTargets refuses protected paths (cwd itself)', async () => {
    const root = await tempWorkspace();
    const evil = [
      {
        target: { kind: 'data-dir' as const, path: root, label: 'cwd' },
        exists: true,
        bytes: 0,
        files: 0,
      },
    ];
    const { results, freedBytes } = await removeTargets(evil, root);
    expect(results[0].removed).toBe(false);
    expect(results[0].error).toContain('Refusing to remove protected path');
    expect(freedBytes).toBe(0);
    expect(await pathExists(join(root, 'data'))).toBe(true);
  });
});

describe('defaultProbePorts', () => {
  it('merges the discovery range with the PORT env override, sorted', () => {
    expect(defaultProbePorts(undefined)).toEqual([8201, 8202, 8203, 8204, 8205]);
    expect(defaultProbePorts('9999')).toEqual([8201, 8202, 8203, 8204, 8205, 9999]);
    expect(defaultProbePorts('8203')).toEqual([8201, 8202, 8203, 8204, 8205]);
    expect(defaultProbePorts('not-a-port')).toEqual([8201, 8202, 8203, 8204, 8205]);
  });
});

describe('probeRunningServers (injected fetch)', () => {
  it('counts any HTTP answer, ignores rejects', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const text = String(url);
      if (text.includes(':8202')) return new Response('ok');
      if (text.includes(':8203')) return new Response('not found', { status: 404 });
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const ports = await probeRunningServers({ ports: [8201, 8202, 8203], fetchImpl });
    expect(ports).toEqual([8202, 8203]);
  });

  it('probes /api/health on the given host with a timeout signal', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(String(url));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new Error('refused');
    }) as typeof fetch;
    await probeRunningServers({ ports: [8201], host: 'localhost', fetchImpl });
    expect(seen).toEqual(['http://localhost:8201/api/health']);
  });
});

describe('runUninstall decision flow', () => {
  it('no data anywhere → no-data outcome, prompt never asked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'be-uninstall-'));
    const tmpRoot = await mkdtemp(join(tmpdir(), 'be-uninstall-tmp-'));
    const lines: string[] = [];
    let asked = false;
    const result = await runUninstall({
      cwd: root,
      tmpRoot,
      fetchImpl: offlineFetch,
      log: line => lines.push(line),
      prompt: async () => {
        asked = true;
        return true;
      },
    });
    expect(result.outcome).toBe('no-data');
    expect(asked).toBe(false);
    expect(lines.join('\n')).toContain('nothing to clean');
  });

  it('prompt answering no → kept, files intact', async () => {
    const root = await tempWorkspace();
    const result = await runUninstall({
      cwd: root,
      tmpRoot: await mkdtemp(join(tmpdir(), 'be-uninstall-tmp-')),
      fetchImpl: offlineFetch,
      prompt: async () => false,
      log: () => {},
    });
    expect(result.outcome).toBe('kept');
    expect(await pathExists(join(root, 'data', 'blockchain.db'))).toBe(true);
  });

  it('non-interactive without --yes → kept with the override hint', async () => {
    const root = await tempWorkspace();
    const lines: string[] = [];
    const result = await runUninstall({
      cwd: root,
      tmpRoot: await mkdtemp(join(tmpdir(), 'be-uninstall-tmp-')),
      fetchImpl: offlineFetch,
      log: line => lines.push(line),
    });
    expect(result.outcome).toBe('kept');
    expect(lines.join('\n')).toContain('--yes');
    expect(await pathExists(join(root, 'data'))).toBe(true);
  });

  it('prompt yes → cleaned, data/ and IDE scratch gone, summary logged before the question', async () => {
    const root = await tempWorkspace();
    const tmpRoot = await mkdtemp(join(tmpdir(), 'be-uninstall-tmp-'));
    await mkdir(join(tmpRoot, 'block-explorer-contracts'), { recursive: true });
    await writeFile(join(tmpRoot, 'block-explorer-contracts', 'x.sol'), 'contract {}');
    const lines: string[] = [];
    const questions: string[] = [];
    const result = await runUninstall({
      cwd: root,
      tmpRoot,
      fetchImpl: offlineFetch,
      log: line => lines.push(line),
      prompt: async question => {
        questions.push(question);
        return true;
      },
    });
    expect(result.outcome).toBe('cleaned');
    expect(result.freedBytes).toBe(DATA_BYTES + 'contract {}'.length);
    expect(await pathExists(join(root, 'data'))).toBe(false);
    expect(await pathExists(join(tmpRoot, 'block-explorer-contracts'))).toBe(false);
    // The size summary is shown BEFORE asking — the question is informed.
    expect(lines.findIndex(line => line.includes('Total:'))).toBeGreaterThanOrEqual(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('cannot be undone');
    // stats carry the pre-removal inventory
    expect(result.stats.find(s => s.target.kind === 'data-dir')?.bytes).toBe(DATA_BYTES);
  });

  it('assumeYes skips the prompt and cleans', async () => {
    const root = await tempWorkspace();
    let asked = false;
    const result = await runUninstall({
      cwd: root,
      tmpRoot: await mkdtemp(join(tmpdir(), 'be-uninstall-tmp-')),
      fetchImpl: offlineFetch,
      assumeYes: true,
      prompt: async () => {
        asked = true;
        return false;
      },
      log: () => {},
    });
    expect(result.outcome).toBe('cleaned');
    expect(asked).toBe(false);
    expect(await pathExists(join(root, 'data'))).toBe(false);
  });

  it('a server answering the probe blocks deletion; force overrides', async () => {
    const root = await tempWorkspace();
    const tmpRoot = await mkdtemp(join(tmpdir(), 'be-uninstall-tmp-'));
    const fetchImpl = (async () => new Response('ok')) as typeof fetch;
    const lines: string[] = [];
    let asked = false;

    const blocked = await runUninstall({
      cwd: root,
      tmpRoot,
      fetchImpl,
      log: line => lines.push(line),
      prompt: async () => {
        asked = true;
        return true;
      },
    });
    expect(blocked.outcome).toBe('aborted-server-running');
    expect(blocked.runningPorts).toEqual([8201, 8202, 8203, 8204, 8205]);
    expect(asked).toBe(false); // refused before asking
    expect(await pathExists(join(root, 'data'))).toBe(true);
    expect(lines.join('\n')).toContain('holds the database files open');

    const forced = await runUninstall({
      cwd: root,
      tmpRoot,
      fetchImpl,
      force: true,
      assumeYes: true,
      log: () => {},
    });
    expect(forced.outcome).toBe('cleaned');
    expect(await pathExists(join(root, 'data'))).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats the CLI summary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(15 * 1024 * 1024)).toBe('15.0 MB');
  });
});
