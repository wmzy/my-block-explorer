// `my-block-explorer uninstall` — data cleanup, shared by the CLI and the
// in-server flow (POST /api/ops/uninstall via services/selfDestruct.ts).
// Import-direction invariant: this module must never import server-graph
// modules (only the import-free leaf database/dbPath) and must never be
// re-exported through the src/utils barrel (the browser bundle can pull
// that) — the CLI imports it BEFORE deciding to start a server, and any
// server-graph import would construct the DuckDB adapter, whose
// constructor mkdirs data/, fabricating the very thing this command
// measures. Being imported BY the api-app graph is fine and now by
// design: that graph already constructs the adapter, so nothing new is
// fabricated.
//
// Honesty rules (same posture as OpsService): only the paths the explorer
// itself writes are enumerated — the main DuckDB file (via DATABASE_URL,
// same parse as the adapter), the always-cwd-based per-chain event DBs
// under data/chains/, the solc wasm cache under data/solc-cache/, and the
// open-in-IDE scratch dir under the OS tmpdir. Nothing is deleted without
// an explicit yes; a non-interactive session keeps data by default; a
// server that answers on the discovery ports blocks deletion (DuckDB holds
// the files open — deleting under a live writer leaves it writing to
// unlinked inodes) unless --force is passed.
import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseMainDbPath } from './database/dbPath';

export type UninstallTargetKind =
  | 'data-dir'
  | 'main-db'
  | 'main-db-wal'
  | 'chains'
  | 'solc-cache'
  | 'tmp-scratch';

export type UninstallTarget = {
  kind: UninstallTargetKind;
  /** Absolute path on disk. */
  path: string;
  /** Display form — cwd-relative when the path lives under cwd. */
  label: string;
};

export type TargetStats = {
  target: UninstallTarget;
  exists: boolean;
  /** Recursive byte total; 0 for a missing path. */
  bytes: number;
  /** Recursive regular-file count; 0 for a missing path. */
  files: number;
};

export type RemovalResult = {
  target: UninstallTarget;
  removed: boolean;
  bytes: number;
  error?: string;
};

export type UninstallOutcome =
  | 'no-data'
  | 'kept'
  | 'cleaned'
  | 'aborted-server-running'
  | 'partial-error';

export type UninstallResult = {
  outcome: UninstallOutcome;
  /** Stats for every enumerated target (missing ones included, exists:false). */
  stats: TargetStats[];
  freedBytes: number;
  runningPorts: number[];
};

/** Ports the frontend's auto-discovery scans — where our server lives. */
export const DEFAULT_PROBE_PORTS: readonly number[] = [8201, 8202, 8203, 8204, 8205];

/** Probe ports + the PORT env override, de-duplicated, ascending. */
export function defaultProbePorts(envPort: string | undefined): number[] {
  const ports = new Set<number>(DEFAULT_PROBE_PORTS);
  const parsed = envPort === undefined ? Number.NaN : Number.parseInt(envPort, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) ports.add(parsed);
  return [...ports].sort((a, b) => a - b);
}

function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  if (rel === '') return path;
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

/**
 * Enumerate everything the explorer may have written. Pure — no fs.
 *
 * Default layout (main db under `<cwd>/data`): the whole `data/` dir is one
 * target, covering the main db, its `.wal` sibling, `chains/` and
 * `solc-cache/`. A custom DATABASE_URL outside that layout removes the main
 * db (+ its `.wal`) individually — the per-chain DBs and solc cache are
 * always cwd-based regardless of DATABASE_URL, so they stay separate
 * targets. `:memory:` main DBs have no file to remove.
 */
export function resolveUninstallTargets(options: {
  cwd: string;
  databaseUrl?: string;
  tmpRoot?: string;
}): UninstallTarget[] {
  const cwd = resolve(options.cwd);
  const raw = parseMainDbPath(options.databaseUrl);
  const mainDb =
    raw === ':memory:' ? null : isAbsolute(raw) ? raw : resolve(cwd, raw);
  const dataRoot = mainDb === null ? join(cwd, 'data') : dirname(mainDb);
  const scratch = join(options.tmpRoot ?? tmpdir(), 'block-explorer-contracts');
  const label = (path: string) => displayPath(path, cwd);

  if (dataRoot === join(cwd, 'data')) {
    return [
      { kind: 'data-dir', path: dataRoot, label: label(dataRoot) },
      { kind: 'tmp-scratch', path: scratch, label: label(scratch) },
    ];
  }

  const targets: UninstallTarget[] = [];
  if (mainDb !== null) {
    targets.push({ kind: 'main-db', path: mainDb, label: label(mainDb) });
    targets.push({
      kind: 'main-db-wal',
      path: `${mainDb}.wal`,
      label: label(`${mainDb}.wal`),
    });
  }
  const chains = join(cwd, 'data', 'chains');
  const solcCache = join(cwd, 'data', 'solc-cache');
  targets.push({ kind: 'chains', path: chains, label: label(chains) });
  targets.push({ kind: 'solc-cache', path: solcCache, label: label(solcCache) });
  targets.push({ kind: 'tmp-scratch', path: scratch, label: label(scratch) });
  return targets;
}

/** Recursive size/file count of one path; null-ish absence → {exists:false}. */
async function walkSize(path: string): Promise<{ bytes: number; files: number } | null> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  if (!info.isDirectory()) return { bytes: info.size, files: 1 };
  let bytes = 0;
  let files = 0;
  const stack: string[] = [path];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // vanished mid-walk: count what we saw
    }
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) {
        files += 1;
        try {
          bytes += (await stat(entryPath)).size;
        } catch {
          // vanished between readdir and stat — nothing honest to add
        }
      }
      // symlinks and other odd types: not counted, never followed
    }
  }
  return { bytes, files };
}

export async function collectTargetStats(
  targets: readonly UninstallTarget[],
): Promise<TargetStats[]> {
  return Promise.all(
    targets.map(async target => {
      const walked = await walkSize(target.path);
      return {
        target,
        exists: walked !== null,
        bytes: walked?.bytes ?? 0,
        files: walked?.files ?? 0,
      };
    }),
  );
}

/** Defense in depth: refuse paths we must never rm -rf. */
function assertRemovable(path: string, cwd: string): void {
  const resolved = resolve(path);
  const forbidden = new Set(['/', resolve(cwd), homedir(), tmpdir(), process.cwd()]);
  if (forbidden.has(resolved)) {
    throw new Error(`Refusing to remove protected path: ${resolved}`);
  }
}

/**
 * Remove the given (existing) targets. Missing targets are skipped rather
 * than counted as errors; per-target failures surface in the result so one
 * locked file (a live writer on Windows, a permission issue) never hides
 * the rest.
 */
export async function removeTargets(
  stats: readonly TargetStats[],
  cwd: string,
): Promise<{ results: RemovalResult[]; freedBytes: number }> {
  const results: RemovalResult[] = [];
  let freedBytes = 0;
  for (const { target, exists, bytes } of stats) {
    if (!exists) continue;
    try {
      assertRemovable(target.path, cwd);
      await rm(target.path, { recursive: true, force: true });
      results.push({ target, removed: true, bytes });
      freedBytes += bytes;
    } catch (error) {
      results.push({
        target,
        removed: false,
        bytes: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { results, freedBytes };
}

/** rmdir a fixed candidate list if empty; failures are cosmetic, swallowed. */
export async function pruneEmptyDirs(candidates: readonly string[]): Promise<void> {
  for (const dir of new Set(candidates)) {
    try {
      await rmdir(dir);
    } catch {
      // not empty / vanished / locked — fine, an empty leftover dir is inert
    }
  }
}

/**
 * Which probe ports answer /api/health with ANY HTTP response. Any response
 * (not just 200) counts: something is listening on an explorer discovery
 * port, and --force exists for the false-positive case.
 */
export async function probeRunningServers(options?: {
  ports?: readonly number[];
  host?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<number[]> {
  const ports = options?.ports ?? defaultProbePorts(process.env.PORT);
  const host = options?.host ?? '127.0.0.1';
  const timeoutMs = options?.timeoutMs ?? 800;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const probed = await Promise.all(
    ports.map(async port => {
      try {
        await fetchImpl(`http://${host}:${port}/api/health`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        return port;
      } catch {
        return null;
      }
    }),
  );
  return probed.filter((port): port is number => port !== null);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * The uninstall flow, with every side effect injectable (prompt, log, fetch)
 * so tests drive the real decision logic. Deletion only ever happens on an
 * explicit yes — `assumeYes`, or the prompt answering true. No prompt
 * (non-interactive session) keeps the data and says how to override.
 */
export async function runUninstall(options: {
  cwd: string;
  databaseUrl?: string;
  assumeYes?: boolean;
  force?: boolean;
  tmpRoot?: string;
  prompt?: (question: string) => Promise<boolean>;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<UninstallResult> {
  const log = options.log ?? (() => {});
  const cwd = resolve(options.cwd);

  const targets = resolveUninstallTargets({
    cwd,
    databaseUrl: options.databaseUrl,
    tmpRoot: options.tmpRoot,
  });
  const stats = await collectTargetStats(targets);
  const existing = stats.filter(entry => entry.exists);

  if (existing.length === 0) {
    log(`No my-block-explorer data found under ${cwd} — nothing to clean.`);
    return { outcome: 'no-data', stats, freedBytes: 0, runningPorts: [] };
  }

  log(`my-block-explorer data under ${cwd}:`);
  for (const entry of existing) {
    const files = entry.files === 1 ? '1 file' : `${entry.files} files`;
    log(`  ${entry.target.label}  —  ${formatBytes(entry.bytes)} (${files})`);
  }
  const totalBytes = existing.reduce((sum, entry) => sum + entry.bytes, 0);
  log(`  Total: ${formatBytes(totalBytes)}`);

  const runningPorts = options.force
    ? []
    : await probeRunningServers({ fetchImpl: options.fetchImpl });
  if (runningPorts.length > 0) {
    const list = runningPorts.map(port => `:${port}`).join(', ');
    log('');
    log(
      `A server appears to be running on ${list} — it holds the database files open.`,
    );
    log('Stop it first, or re-run with --force to delete anyway.');
    return { outcome: 'aborted-server-running', stats, freedBytes: 0, runningPorts };
  }

  let deleteData: boolean;
  if (options.assumeYes === true) {
    deleteData = true;
  } else if (options.prompt === undefined) {
    log('');
    log('Non-interactive session — data kept (pass --yes to delete without asking).');
    return { outcome: 'kept', stats, freedBytes: 0, runningPorts: [] };
  } else {
    deleteData = await options.prompt(
      'Delete this data? This cannot be undone. [y/N] ',
    );
  }

  if (!deleteData) {
    log('Keeping the data — nothing was deleted.');
    return { outcome: 'kept', stats, freedBytes: 0, runningPorts: [] };
  }

  const { results, freedBytes } = await removeTargets(existing, cwd);
  for (const result of results) {
    if (result.removed) {
      log(`Removed ${result.target.label} (${formatBytes(result.bytes)})`);
    } else {
      log(`FAILED to remove ${result.target.label}: ${result.error ?? 'unknown error'}`);
    }
  }
  log(`Freed ${formatBytes(freedBytes)}.`);

  // Cosmetic: drop the now-empty data/ dir (custom layout: the custom db's
  // parent) so an uninstalled explorer leaves no husk behind.
  await pruneEmptyDirs([
    join(cwd, 'data'),
    ...existing
      .filter(entry => entry.target.kind === 'main-db')
      .map(entry => dirname(entry.target.path)),
  ]);

  const outcome: UninstallOutcome = results.every(result => result.removed)
    ? 'cleaned'
    : 'partial-error';
  return { outcome, stats, freedBytes, runningPorts: [] };
}
