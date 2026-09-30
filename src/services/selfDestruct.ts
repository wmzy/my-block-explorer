// Server self-destruct: the backend half of "uninstall from the /ops
// page" (POST /api/ops/uninstall). The CLI uninstall refuses to delete
// while a server holds the DuckDB files open; the in-server flow inverts
// that constraint — THIS process is the live writer, so the only honest
// order is: stop background tickers → close the HTTP listener → close
// every DuckDB handle (per-chain event DBs, then the main adapter, whose
// end() checkpoints the WAL) → THEN delete the files the explorer wrote
// (same enumeration as the CLI: src/uninstall.ts) → exit.
//
// Import-direction note: this module imports src/uninstall.ts, which is
// now part of the api-app graph BY DESIGN (that graph already constructs
// the DuckDB adapter, so nothing new is fabricated). The invariant that
// still holds — and the one the CLI depends on — is the reverse edge:
// uninstall.ts itself must never import server-graph modules, so
// `my-block-explorer uninstall` never boots the adapter.
//
// Every step is fallible-but-non-fatal except deletion itself: a failing
// close is logged and the sequence continues (a file deleted under a
// half-closed handle is gone either way on Linux); the exit code reports
// whether every existing target was actually removed.
import { join } from 'node:path';

import { multiChainDb } from '../database/chain-database-manager';
import { db } from '../database/drizzle';
import {
  collectTargetStats,
  formatBytes,
  pruneEmptyDirs,
  removeTargets,
  resolveUninstallTargets,
} from '../uninstall';
import { watchService } from './WatchService';

/** How long the 202 response gets to reach the client before sockets die. */
export const SELF_DESTRUCT_GRACE_MS = 1500;

/** The exact body string POST /api/ops/uninstall demands (twin in services/opsSummary.ts). */
export const UNINSTALL_CONFIRM_PHRASE = 'uninstall';

type Closer = () => Promise<void>;

// The HTTP close callback, registered by src/server.ts after serve().
// null under the vite dev bridge (which loads api-app without server.ts):
// there the sequence simply skips the listener step and process.exit()
// ends the vite process — the operator asked for it via the confirmation.
let registeredCloser: Closer | null = null;

let scheduled = false;

export function registerSelfDestructCloser(closer: Closer): void {
  registeredCloser = closer;
}

/**
 * Arm the self-destruct. Returns false when one is already armed (the
 * route turns that into a 409 — the process is about to die either way,
 * but a double confirmation click must not double-run the sequence).
 */
export function scheduleSelfDestruct(
  options: { graceMs?: number; run?: () => Promise<void> } = {},
): boolean {
  if (scheduled) return false;
  scheduled = true;
  const { graceMs = SELF_DESTRUCT_GRACE_MS, run = () => runSelfDestruct() } = options;
  setTimeout(() => {
    void run().catch(error => {
      console.error('Self-destruct failed:', error);
      process.exit(1);
    });
  }, graceMs);
  return true;
}

/** Test seam: re-arm capability between cases (production never calls this). */
export function resetSelfDestructState(): void {
  scheduled = false;
  registeredCloser = null;
}

/**
 * The full shutdown-and-erase sequence. Every side effect is injectable
 * so the ordering contract is unit-testable without files or processes;
 * the defaults are the real ones this server runs with.
 */
export async function runSelfDestruct(options: {
  closer?: Closer | null;
  stopWatchers?: () => Promise<void>;
  closeChainDbs?: () => Promise<void>;
  closeMainDb?: () => Promise<void>;
  cwd?: string;
  databaseUrl?: string;
  collectStats?: typeof collectTargetStats;
  remove?: typeof removeTargets;
  prune?: typeof pruneEmptyDirs;
  log?: (line: string) => void;
  exit?: (code: number) => void;
} = {}): Promise<void> {
  const log = options.log ?? (() => {});
  const cwd = options.cwd ?? process.cwd();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  const step = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (error) {
      log(`Self-destruct: ${name} failed (${error instanceof Error ? error.message : String(error)}) — continuing.`);
    }
  };

  log('Self-destruct: erasing this explorer’s data and shutting down.');
  // Order matters: tickers first (they would otherwise write into a
  // closing database), then the listener, then the DuckDB handles — only
  // after every handle is gone is deletion not writing to unlinked inodes.
  await step('stop watchers', options.stopWatchers ?? (() => watchService.stop()));
  await step('close http server', async () => {
    await (options.closer ?? registeredCloser)?.();
  });
  await step('close per-chain databases', options.closeChainDbs ?? (() => multiChainDb.closeAll()));
  await step('close main database', options.closeMainDb ?? (async () => void (await db.$client.end?.())));

  const collect = options.collectStats ?? collectTargetStats;
  const remove = options.remove ?? removeTargets;
  const prune = options.prune ?? pruneEmptyDirs;

  const targets = resolveUninstallTargets({ cwd, databaseUrl });
  const stats = (await collect(targets)).filter(entry => entry.exists);
  const { results, freedBytes } = await remove(stats, cwd);
  for (const result of results) {
    if (result.removed) {
      log(`Self-destruct: removed ${result.target.label} (${formatBytes(result.bytes)}).`);
    } else {
      log(`Self-destruct: FAILED to remove ${result.target.label}: ${result.error ?? 'unknown error'}`);
    }
  }
  log(`Self-destruct: freed ${formatBytes(freedBytes)}.`);

  // Same cosmetic husk-removal as the CLI: drop an emptied data/ dir.
  await pruneEmptyDirs([join(cwd, 'data')]);

  const exit = options.exit ?? ((code: number) => process.exit(code));
  exit(results.every(result => result.removed) ? 0 : 1);
}
