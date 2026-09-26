// Ops aggregation service: the read-only data behind GET /api/ops/summary
// (src/routes/ops.ts). Pure derivation helpers (no fs, no DB, no env, no
// clock) are separated from the collectors so filename parsing, count
// folding and size summarization are unit-testable with injected
// listings/rows; the collectors compose them with node:fs scans and
// read-only DuckDB queries against the main database.
//
// Honesty rules: a collector reports exactly what it can see and throws
// only when its section genuinely cannot be assembled (the route degrades
// that ONE section to {error:'unavailable'} via Promise.allSettled).
// Missing directories are facts about a fresh install (empty lists, zero
// totals — not errors); a per-chain file name that does not match the
// documented pattern keeps its raw stem with chainId: null rather than
// being silently dropped; a main database whose size cannot be stat'ed
// reports mainDbBytes: null, never a fabricated number.
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
// Relative imports on purpose: this module rides the api-app import graph
// (also bundled into vite.config.ts's dev bridge via esbuild, which does
// not resolve the '@/' alias for runtime imports).
import { addressScanJobs, db, indexingRanges } from '../database/init';
import { appVersion } from '../version';

// --- Pure helpers (unit-tested with injected inputs) ---

/** Count + total size of a file listing — the shape of every fs section. */
export function summarizeFiles(
  files: readonly { bytes: number }[],
): { files: number; bytes: number } {
  let bytes = 0;
  for (const file of files) bytes += file.bytes;
  return { files: files.length, bytes };
}

/**
 * Per-chain database file identity from the documented layout
 * (docs/INSTALLATION.md): data/chains/{type}/{name}-{id}.db. The chain
 * NAME may itself contain dashes (`optimism-sepolia-11155420.db`), so the
 * id is the LAST dash-delimited segment. A stem without a numeric tail
 * (`weird-name.db`) keeps the whole stem with chainId: null — reported,
 * not dropped, because the file still occupies disk; an id outside
 * Number.isSafeInteger is equally untrusted and degrades the same way.
 */
export function deriveChainFileMeta(
  chainType: string,
  fileName: string,
): { chainType: string; name: string; chainId: number | null } {
  const stem = fileName.toLowerCase().endsWith('.db')
    ? fileName.slice(0, -'.db'.length)
    : fileName;
  const separator = stem.lastIndexOf('-');
  if (separator !== -1) {
    const tail = stem.slice(separator + 1);
    if (tail !== '' && /^\d+$/.test(tail)) {
      const chainId = Number(tail);
      if (Number.isSafeInteger(chainId)) {
        return { chainType, name: stem.slice(0, separator), chainId };
      }
    }
  }
  return { chainType, name: stem, chainId: null };
}

/**
 * Fold rows into per-status counts. Rows may carry a pre-aggregated
 * `count` (a GROUP BY result — number, or string when the driver
 * stringified a bigint) or omit it (each row counts 1). A malformed count
 * contributes 0 instead of poisoning the total with NaN.
 */
export function countByStatus(
  rows: readonly { status: string; count?: number | string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const weight = row.count === undefined ? 1 : Number(row.count);
    const safe = Number.isFinite(weight) ? Math.trunc(weight) : 0;
    out[row.status] = (out[row.status] ?? 0) + safe;
  }
  return out;
}

/** Per-chain status counts, chains sorted by id (stable response shape). */
export function groupCountsByChain(
  rows: readonly { chainId: number | string; status: string; count?: number | string }[],
): Array<{ chainId: number; statuses: Record<string, number>; total: number }> {
  const byChain = new Map<number, Array<{ status: string; count?: number | string }>>();
  for (const row of rows) {
    const chainId = Number(row.chainId);
    // chain_id is INTEGER NOT NULL in the schema; a non-numeric value means
    // the row did not come from that table — skip rather than emit NaN.
    if (!Number.isSafeInteger(chainId)) continue;
    const existing = byChain.get(chainId);
    if (existing === undefined) {
      byChain.set(chainId, [{ status: row.status, count: row.count }]);
    } else {
      existing.push({ status: row.status, count: row.count });
    }
  }
  return [...byChain.entries()]
    .map(([chainId, chainRows]) => {
      const statuses = countByStatus(chainRows);
      let total = 0;
      for (const count of Object.values(statuses)) total += count;
      return { chainId, statuses, total };
    })
    .sort((a, b) => a.chainId - b.chainId);
}

/**
 * The main database file path from DATABASE_URL, mirroring the adapter's
 * own parseConnectionString (src/database/duckdb-postgres-adapter.ts):
 * strip the duckdb:// scheme, fall back to the default relative path for
 * anything else (including unset).
 */
export function parseMainDbPath(databaseUrl: string | undefined): string {
  if (databaseUrl?.startsWith('duckdb://')) {
    return databaseUrl.slice('duckdb://'.length);
  }
  return 'data/blockchain.db';
}

// --- Section types (mirrored by the frontend service, src/services/opsSummary.ts) ---

export type ChainDbFile = {
  chainType: string;
  name: string;
  chainId: number | null;
  bytes: number;
  mtime: string;
};

export type StorageSummary = {
  /** null = the configured file could not be stat'ed — unknown, not zero. */
  mainDbBytes: number | null;
  perChainDbFiles: ChainDbFile[];
  solcCache: { files: number; bytes: number };
};

export type IndexingSummary = {
  total: number;
  chains: Array<{ chainId: number; statuses: Record<string, number>; total: number }>;
};

export type WatchSubscriptionSummary = {
  chainId: number;
  address: string;
  webhookConfigured: boolean;
};

export type WatchSummary = {
  total: number;
  subscriptions: WatchSubscriptionSummary[];
};

export type DeepScanSummary = {
  total: number;
  byStatus: Record<string, number>;
};

export type MetaSummary = {
  version: string;
  uptimeSeconds: number;
  timestamp: string;
};

// --- Collectors (fs + read-only DuckDB; one section each) ---

const listDir = async (path: string): Promise<string[]> => {
  try {
    return await readdir(path);
  } catch {
    // Missing (or momentarily unreadable) directory: an empty listing is
    // the honest answer for a fresh install, not a section failure.
    return [];
  }
};

const fileSize = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
};

/** data/ footprint: main db size, per-chain event DBs, solc compiler cache. */
export async function collectStorageSummary(): Promise<StorageSummary> {
  const mainDbPath = parseMainDbPath(process.env.DATABASE_URL);
  const dataRoot = dirname(mainDbPath);
  const chainsRoot = join(dataRoot, 'chains');

  const mainDbBytes = await fileSize(mainDbPath);

  const perChainDbFiles: ChainDbFile[] = [];
  const chainTypes = (await listDir(chainsRoot)).sort();
  for (const chainType of chainTypes) {
    const files = (await listDir(join(chainsRoot, chainType)))
      .filter(fileName => fileName.toLowerCase().endsWith('.db'))
      .sort();
    for (const fileName of files) {
      try {
        const info = await stat(join(chainsRoot, chainType, fileName));
        perChainDbFiles.push({
          ...deriveChainFileMeta(chainType, fileName),
          bytes: info.size,
          mtime: info.mtime.toISOString(),
        });
      } catch {
        // Vanished between the readdir and the stat: nothing honest to
        // report for it — skip rather than emit a zero size.
      }
    }
  }

  const solcCacheFiles: Array<{ bytes: number }> = [];
  const solcCacheRoot = join(dataRoot, 'solc-cache');
  for (const entry of await listDir(solcCacheRoot)) {
    const bytes = await fileSize(join(solcCacheRoot, entry));
    if (bytes !== null) solcCacheFiles.push({ bytes });
  }

  return {
    mainDbBytes,
    perChainDbFiles,
    solcCache: summarizeFiles(solcCacheFiles),
  };
}

/** Indexing ranges per chain by status — a read-only GROUP BY, no jobs touched. */
export async function collectIndexingSummary(): Promise<IndexingSummary> {
  const rows = await db
    .select({
      chainId: indexingRanges.chainId,
      status: indexingRanges.status,
      count: sql<number>`count(*)`,
    })
    .from(indexingRanges)
    .groupBy(indexingRanges.chainId, indexingRanges.status);

  const chains = groupCountsByChain(rows);
  let total = 0;
  for (const chain of chains) total += chain.total;
  return { total, chains };
}

/**
 * Watch subscriptions straight from the table — NOT WatchService: the ops
 * snapshot must not depend on the watcher's in-memory state, and the
 * webhook_url column is arriving in a sibling change, so a database from
 * before that migration makes this select throw (unknown column). The
 * caller degrades exactly this section to {error:'unavailable'}.
 */
export async function collectWatchSummary(): Promise<WatchSummary> {
  const result: unknown = await db.execute(
    sql`select chain_id, address, webhook_url from watch_subscriptions order by chain_id, address`,
  );
  const rows: unknown[] = Array.isArray(result) ? result : [];

  const subscriptions: WatchSubscriptionSummary[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const record = row as Record<string, unknown>;
    const chainId = Number(record.chain_id);
    if (!Number.isSafeInteger(chainId)) continue;
    subscriptions.push({
      chainId,
      address: typeof record.address === 'string' ? record.address : String(record.address),
      // Unset is NULL by writer convention (empty string on PUT means
      // "clear" and stores NULL), but a defensive trim covers any stray.
      webhookConfigured:
        typeof record.webhook_url === 'string' && record.webhook_url.trim() !== '',
    });
  }
  return { total: subscriptions.length, subscriptions };
}

/** Deep-scan job counts by status — same main DB, same read-only posture. */
export async function collectDeepScanSummary(): Promise<DeepScanSummary> {
  const rows = await db
    .select({
      status: addressScanJobs.status,
      count: sql<number>`count(*)`,
    })
    .from(addressScanJobs)
    .groupBy(addressScanJobs.status);

  const byStatus = countByStatus(rows);
  let total = 0;
  for (const count of Object.values(byStatus)) total += count;
  return { total, byStatus };
}

/** Process facts for the header card — never fails (appVersion degrades to 'unknown'). */
export function collectMetaSummary(): MetaSummary {
  return {
    version: appVersion(),
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
