import { eq, and, or, sql, gte, lte, desc, ne, type SQL } from 'drizzle-orm';
import { db } from '../database/drizzle';
import {
  indexingProgress,
  contractEvents,
  contractCreationInfo,
  indexingRanges,
} from '../database/schema';
import { rpcManager } from './RpcManager';
import { decodeEventLog, TransactionReceiptNotFoundError, type Abi, type Log } from 'viem';
import { getContractCreationBlock } from '../utils/events';
import { inputToStoredValue, resolveToBlock } from '../utils/blockTagUtils';
// Relative path on purpose: vite.config.ts bundles the api-app backend graph
// with esbuild, which does not resolve the '@/' alias for runtime imports.
import { createLogger } from '../server/logger';
import type { BlockTagInput } from '@/types/events';

const logger = createLogger('event-indexing-service');

const BATCH_SIZE = 2000;
const MAX_RETRY = 3;
const RETRY_DELAY_MS = 2000;

type _IndexingState = {
  chainId: number;
  address: `0x${string}`;
  status: 'idle' | 'indexing' | 'error';
  creationBlock: bigint;
  lastIndexedBlock: bigint;
  lastFinalizedBlock: bigint;
  totalEventsIndexed: number;
  errorMessage?: string;
};

type RangeStatus = 'pending' | 'indexing' | 'paused' | 'completed' | 'error';
type RangeDirection = 'forward' | 'backward';

type IndexingRange = {
  chainId: number;
  address: `0x${string}`;
  rangeId: number;
  fromBlock: bigint;
  toBlock: bigint;
  direction: RangeDirection;
  currentBlock: bigint | null;
  status: RangeStatus;
  totalEventsIndexed: number;
  errorMessage: string | null;
  priority: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type RangeOverlap = {
  rangeId: number;
  fromBlock: bigint;
  toBlock: bigint;
  overlapStart: bigint;
  overlapEnd: bigint;
};

const activeJobs = new Map<string, { abort: boolean }>();

const rangeJobKey = (chainId: number, address: string, rangeId: number) =>
  `${chainId}:${address.toLowerCase()}:range:${rangeId}`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const fetchLogsWithRetry = async (
  chainId: number,
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> => {
  const client = await rpcManager.getClient(chainId);
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      return await client.getLogs({ address, fromBlock, toBlock });
    } catch (err) {
      if (attempt === MAX_RETRY - 1) throw err;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  return [];
};

// Max parallel getBlock calls when resolving timestamps for one batch.
const BLOCK_TIMESTAMP_CONCURRENCY = 8;

const fetchBlockTimestamps = async (
  chainId: number,
  blockNumbers: bigint[],
): Promise<Map<bigint, number | null>> => {
  const client = await rpcManager.getClient(chainId);
  const map = new Map<bigint, number | null>();
  const unique = [...new Set(blockNumbers)];

  // Bounded worker pool over a shared cursor: a batch of BATCH_SIZE logs could
  // otherwise fire one getBlock request per block all at once.
  let cursor = 0;
  const worker = async () => {
    while (cursor < unique.length) {
      const bn = unique[cursor];
      cursor += 1;
      try {
        const block = await client.getBlock({ blockNumber: bn });
        map.set(bn, Number(block.timestamp));
      } catch {
        // Honest-data policy: when a block timestamp cannot be fetched we
        // record null instead of fabricating a value. The row is stored with
        // a NULL block_timestamp and gets backfilled on a later re-scan.
        map.set(bn, null);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BLOCK_TIMESTAMP_CONCURRENCY, unique.length) }, () => worker()),
  );
  return map;
};

const decodeLogs = (logs: Log[], abi: Abi, blockTimestamps: Map<bigint, number | null>) => {
  const decoded: Array<{
    blockNumber: bigint;
    // null when the block timestamp could not be fetched; never fabricated
    blockTimestamp: number | null;
    transactionHash: `0x${string}`;
    transactionIndex: number;
    logIndex: number;
    eventName: string;
    eventSignature: string;
    decodedArgs: string;
    topic0: string;
    topic1: string | null;
    topic2: string | null;
    topic3: string | null;
    data: string;
  }> = [];

  for (const log of logs) {
    try {
      const result = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: false });
      if (!result) continue;

      const args: Record<string, string> = {};
      if (result.args && typeof result.args === 'object') {
        for (const [k, v] of Object.entries(result.args as object)) {
          args[k] = typeof v === 'bigint' ? v.toString() : String(v);
        }
      }

      decoded.push({
        blockNumber: log.blockNumber ?? 0n,
        blockTimestamp: blockTimestamps.get(log.blockNumber ?? 0n) ?? null,
        transactionHash: log.transactionHash ?? ('0x'),
        transactionIndex: log.transactionIndex ?? 0,
        logIndex: log.logIndex ?? 0,
        eventName: result.eventName ?? 'Unknown',
        eventSignature: (log.topics[0] as string) ?? '',
        decodedArgs: JSON.stringify(args),
        topic0: (log.topics[0] as string) ?? '',
        topic1: (log.topics[1] as string) ?? null,
        topic2: (log.topics[2] as string) ?? null,
        topic3: (log.topics[3] as string) ?? null,
        data: log.data ?? '0x',
      });
    } catch {
      decoded.push({
        blockNumber: log.blockNumber ?? 0n,
        blockTimestamp: blockTimestamps.get(log.blockNumber ?? 0n) ?? null,
        transactionHash: log.transactionHash ?? ('0x'),
        transactionIndex: log.transactionIndex ?? 0,
        logIndex: log.logIndex ?? 0,
        eventName: 'Unknown',
        eventSignature: (log.topics[0] as string) ?? '',
        decodedArgs: '{}',
        topic0: (log.topics[0] as string) ?? '',
        topic1: (log.topics[1] as string) ?? null,
        topic2: (log.topics[2] as string) ?? null,
        topic3: (log.topics[3] as string) ?? null,
        data: log.data ?? '0x',
      });
    }
  }
  return decoded;
};

const INSERT_CHUNK_SIZE = 50;

// Insert rows with a timestamp-only backfill upsert: on PK conflict the stored
// block_timestamp is kept unless it is NULL, so later scans covering the same
// blocks (overlapping or re-created ranges) repair rows whose getBlock call
// previously failed while never overwriting a known-good timestamp. Dedup
// semantics are otherwise unchanged. A plain resume continues past the
// checkpoint, so rows skipped there are only repaired by such a re-scan —
// preferred over storing a fabricated timestamp.
const insertEventChunk = async (rows: Array<typeof contractEvents.$inferInsert>) => {
  await db
    .insert(contractEvents)
    .values(rows)
    .onConflictDoUpdate({
      target: [contractEvents.chainId, contractEvents.transactionHash, contractEvents.logIndex],
      set: {
        blockTimestamp: sql`coalesce(${contractEvents.blockTimestamp}, excluded.block_timestamp)`,
      },
    });
};

const insertEvents = async (
  chainId: number,
  contractAddress: `0x${string}`,
  events: ReturnType<typeof decodeLogs>,
  isFinalized: boolean,
): Promise<void> => {
  if (events.length === 0) return;

  const rows = events.map(e => ({
    chainId,
    contractAddress,
    blockNumber: e.blockNumber,
    blockTimestamp: e.blockTimestamp,
    transactionHash: e.transactionHash,
    transactionIndex: e.transactionIndex,
    logIndex: e.logIndex,
    eventName: e.eventName,
    eventSignature: e.eventSignature,
    decodedArgs: e.decodedArgs,
    topic0: e.topic0,
    topic1: e.topic1,
    topic2: e.topic2,
    topic3: e.topic3,
    data: e.data,
    isFinalized,
    indexedAt: new Date(),
  }));

  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    try {
      await insertEventChunk(chunk);
    } catch {
      for (const row of chunk) {
        try {
          await insertEventChunk([row]);
        } catch {
          // skip duplicates
        }
      }
    }
  }
};

// ============================================
// Reorg reconciliation
// ============================================

// Cap on rows verified per pass: a large unfinalized backlog must not stall
// the indexing job loop (or startup) behind unbounded receipt fetches. Later
// passes drain the remainder oldest-first.
export const REORG_RECONCILE_ROW_CAP = 500;

export type ReorgReconciliationResult = {
  // Rows picked up this pass (bounded by REORG_RECONCILE_ROW_CAP)
  inspected: number;
  // Rows whose log no longer exists on chain (reorged out) and was deleted
  deleted: number;
  // Rows whose log was receipt-verified and promoted to isFinalized = true
  promoted: number;
};

// Current finalized head. Falls back to latest - 64 (two finality epochs)
// when a node does not serve the 'finalized' tag — the same estimate the
// indexing loop uses. Receipt verification, not the head estimate, is
// authoritative for promotion, so an approximate head only changes which
// rows get checked.
const fetchFinalizedBlockNumber = async (chainId: number): Promise<bigint> => {
  const client = await rpcManager.getClient(chainId);
  try {
    const block = await client.getBlock({ blockTag: 'finalized' });
    return block.number;
  } catch {
    const latestBlock = await client.getBlockNumber();
    return latestBlock - 64n;
  }
};

// Unfinalized predicate shared by the reconciliation queries: the adapter
// rewrites drizzle's column DEFAULT to NULL on insert, so rows written
// without an explicit value carry NULL — treat them as not-yet-finalized.
const unfinalizedPredicate = sql`coalesce(${contractEvents.isFinalized}, false) = false`;

/**
 * Reconcile a contract's unfinalized rows that sit at or below the current
 * finalized head. Rows indexed before their blocks finalized can be orphaned
 * by a reorg: for each row, verify the transaction receipt still exists and
 * still carries that log (txHash + logIndex). Vanished rows are deleted and
 * logged with their tx hashes; verified rows are promoted to
 * isFinalized = true. A receipt fetch that fails without a definitive
 * not-found answer (e.g. transport error) leaves its rows untouched for a
 * later pass — transient RPC noise must never delete good rows.
 */
export const reconcileReorgedEvents = async (
  chainId: number,
  contractAddress: `0x${string}`,
): Promise<ReorgReconciliationResult> => {
  const finalizedBlockNumber = await fetchFinalizedBlockNumber(chainId);

  // Oldest first so a backlog drains in order and the cap bounds RPC work.
  const pending = await db
    .select()
    .from(contractEvents)
    .where(
      and(
        eq(contractEvents.chainId, chainId),
        eq(contractEvents.contractAddress, contractAddress),
        unfinalizedPredicate,
        lte(contractEvents.blockNumber, finalizedBlockNumber),
      ),
    )
    .orderBy(contractEvents.blockNumber)
    .limit(REORG_RECONCILE_ROW_CAP);

  if (pending.length === 0) return { inspected: 0, deleted: 0, promoted: 0 };

  const client = await rpcManager.getClient(chainId);

  // One receipt covers every row of a transaction; group before fetching.
  const rowsByTxHash = new Map<`0x${string}`, typeof pending>();
  for (const row of pending) {
    const rows = rowsByTxHash.get(row.transactionHash);
    if (rows) rows.push(row);
    else rowsByTxHash.set(row.transactionHash, [row]);
  }

  const vanished: Array<{ transactionHash: `0x${string}`; logIndex: number }> = [];
  const survived: Array<{ transactionHash: `0x${string}`; logIndex: number }> = [];

  for (const [txHash, rows] of rowsByTxHash) {
    let logIndexes: Set<number>;
    try {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      logIndexes = new Set(receipt.logs.map(log => log.logIndex));
    } catch (err) {
      if (err instanceof TransactionReceiptNotFoundError) {
        // The node answered: the transaction no longer exists. Every row of
        // it was reorged out.
        vanished.push(
          ...rows.map(r => ({ transactionHash: r.transactionHash, logIndex: r.logIndex })),
        );
      } else {
        // Inconclusive: leave the rows unfinalized for a later pass.
        logger.warn(
          { chainId, contractAddress, txHash, err },
          'Receipt fetch failed during reorg reconciliation; rows left unfinalized',
        );
      }
      continue;
    }
    for (const row of rows) {
      if (logIndexes.has(row.logIndex)) {
        survived.push({ transactionHash: row.transactionHash, logIndex: row.logIndex });
      } else {
        vanished.push({ transactionHash: row.transactionHash, logIndex: row.logIndex });
      }
    }
  }

  const rowKey = (r: { transactionHash: `0x${string}`; logIndex: number }) =>
    and(
      eq(contractEvents.transactionHash, r.transactionHash),
      eq(contractEvents.logIndex, r.logIndex),
    );

  if (vanished.length > 0) {
    await db
      .delete(contractEvents)
      .where(and(eq(contractEvents.chainId, chainId), or(...vanished.map(rowKey))));
    logger.warn(
      {
        chainId,
        contractAddress,
        deleted: vanished.length,
        transactionHashes: vanished.map(r => r.transactionHash),
      },
      'Reorg reconciliation deleted events whose logs vanished from finalized blocks',
    );
  }

  if (survived.length > 0) {
    await db
      .update(contractEvents)
      .set({ isFinalized: true })
      .where(and(eq(contractEvents.chainId, chainId), or(...survived.map(rowKey))));
  }

  return { inspected: pending.length, deleted: vanished.length, promoted: survived.length };
};

/**
 * Sweep every contract that has unfinalized rows through
 * reconcileReorgedEvents. Per-contract failures are logged and skipped so one
 * unreachable chain cannot block the rest.
 */
export const reconcileAllReorgedEvents = async (): Promise<void> => {
  const pairs = await db
    .select({
      chainId: contractEvents.chainId,
      contractAddress: contractEvents.contractAddress,
    })
    .from(contractEvents)
    .where(unfinalizedPredicate)
    .groupBy(contractEvents.chainId, contractEvents.contractAddress);

  for (const { chainId, contractAddress } of pairs) {
    try {
      await reconcileReorgedEvents(chainId, contractAddress);
    } catch (err) {
      logger.warn({ err, chainId, contractAddress }, 'Reorg reconciliation pass failed');
    }
  }
};

// Distinct event count for a block range (chainId, contract, from..to
// inclusive) — the honest basis for a range's totalEventsIndexed.
// insertEvents reports attempted rows even when the upsert conflicted, so an
// accumulated counter would double-count events that overlap/catchup re-walks
// re-inserted; a COUNT over the stored table cannot.
const countRangeEvents = async (
  chainId: number,
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<number> => {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(contractEvents)
    .where(
      and(
        eq(contractEvents.chainId, chainId),
        eq(contractEvents.contractAddress, address),
        gte(contractEvents.blockNumber, fromBlock <= toBlock ? fromBlock : toBlock),
        lte(contractEvents.blockNumber, fromBlock <= toBlock ? toBlock : fromBlock),
      ),
    );
  return Number(rows[0]?.count ?? 0);
};

type RangeSummary = {
  rangeId: number;
  fromBlock: number;
  toBlock: number;
  currentBlock: number | null;
  status: RangeStatus;
  progress: number;
};

export const getIndexingStatus = async (
  chainId: number,
  address: `0x${string}`,
): Promise<{
  chainId: number;
  contractAddress: string;
  status: string;
  creationBlock: number;
  lastIndexedBlock: number;
  latestBlock: number;
  lastFinalizedBlock: number;
  totalEventsIndexed: number;
  eventTypes: string[];
  errorMessage?: string;
  totalRanges: number;
  completedRanges: number;
  pendingRanges: number;
  indexingRanges: number;
  pausedRanges: number;
  errorRanges: number;
  totalProgress: number;
  ranges: RangeSummary[];
}> => {
  // Keep legacy indexingProgress query for backwards compatibility
  const rows = await db
    .select()
    .from(indexingProgress)
    .where(and(eq(indexingProgress.chainId, chainId), eq(indexingProgress.address, address)))
    .limit(1);

  let latestBlock = 0;
  try {
    const rpcTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RPC timeout')), 10_000),
    );
    const client = await Promise.race([rpcManager.getClient(chainId), rpcTimeout]);
    latestBlock = Number(await Promise.race([client.getBlockNumber(), rpcTimeout]));
  } catch {
    // ignore
  }

  // Query actual event count and types from contract_events table
  const [eventTypeRows, countResult] = await Promise.all([
    db
      .select({ eventName: contractEvents.eventName })
      .from(contractEvents)
      .where(and(eq(contractEvents.chainId, chainId), eq(contractEvents.contractAddress, address)))
      .groupBy(contractEvents.eventName),
    db
      .select({ count: sql<number>`count(*)` })
      .from(contractEvents)
      .where(and(eq(contractEvents.chainId, chainId), eq(contractEvents.contractAddress, address))),
  ]);

  const eventTypes = eventTypeRows.map(r => r.eventName).filter((n): n is string => !!n);
  const actualTotalEvents = countResult[0]?.count ?? 0;

  // Query indexingRanges for range-based aggregation
  const rangeRows = await db
    .select()
    .from(indexingRanges)
    .where(and(eq(indexingRanges.chainId, chainId), eq(indexingRanges.address, address)))
    .orderBy(desc(indexingRanges.priority), desc(indexingRanges.createdAt));

  // Aggregate range statistics
  let totalRanges = 0;
  let completedRanges = 0;
  let pendingRanges = 0;
  let indexingRangesCount = 0;
  let pausedRanges = 0;
  let errorRanges = 0;
  let totalBlocks = 0;
  let indexedBlocks = 0;

  const ranges: RangeSummary[] = rangeRows.map(r => {
    const fromBlock = Number(r.fromBlock);
    const toBlock = Number(r.toBlock);
    const currentBlock = r.currentBlock !== null ? Number(r.currentBlock) : null;
    const rangeSize = toBlock - fromBlock;

    totalRanges++;
    totalBlocks += rangeSize;

    switch (r.status) {
      case 'completed':
        completedRanges++;
        indexedBlocks += rangeSize;
        break;
      case 'indexing':
        indexingRangesCount++;
        if (currentBlock !== null) {
          const progress =
            r.direction === 'forward' ? currentBlock - fromBlock : toBlock - currentBlock;
          indexedBlocks += Math.max(0, progress);
        }
        break;
      case 'pending':
        pendingRanges++;
        break;
      case 'paused':
        pausedRanges++;
        if (currentBlock !== null) {
          const progress =
            r.direction === 'forward' ? currentBlock - fromBlock : toBlock - currentBlock;
          indexedBlocks += Math.max(0, progress);
        }
        break;
      case 'error':
        errorRanges++;
        if (currentBlock !== null) {
          const progress =
            r.direction === 'forward' ? currentBlock - fromBlock : toBlock - currentBlock;
          indexedBlocks += Math.max(0, progress);
        }
        break;
    }

    const progress =
      rangeSize > 0
        ? (() => {
            if (r.status === 'completed') return 100;
            if (currentBlock === null) return 0;
            const completed =
              r.direction === 'forward' ? currentBlock - fromBlock : toBlock - currentBlock;
            return Math.min(100, Math.max(0, (completed / rangeSize) * 100));
          })()
        : 0;

    return {
      rangeId: r.rangeId,
      fromBlock,
      toBlock,
      currentBlock,
      status: r.status as RangeStatus,
      progress,
    };
  });

  // Calculate weighted average progress
  const totalProgress = totalBlocks > 0 ? Math.round((indexedBlocks / totalBlocks) * 100) : 0;

  // Legacy compatibility: derive status from ranges if no indexingProgress row
  const legacyStatus = rows.length > 0 ? (rows[0].status ?? 'idle') : 'idle';
  const legacyCreationBlock = rows.length > 0 ? Number(rows[0].creationBlock ?? 0n) : 0;
  const legacyLastIndexedBlock = rows.length > 0 ? Number(rows[0].lastIndexedBlock ?? 0n) : 0;
  const legacyLastFinalizedBlock = rows.length > 0 ? Number(rows[0].lastFinalizedBlock ?? 0n) : 0;
  const legacyErrorMessage = rows.length > 0 ? (rows[0].errorMessage ?? undefined) : undefined;

  // If we have ranges but no legacy progress, derive from ranges
  const derivedStatus =
    rows.length === 0 && totalRanges > 0
      ? errorRanges > 0
        ? 'error'
        : indexingRangesCount > 0
          ? 'indexing'
          : pendingRanges > 0
            ? 'pending'
            : 'completed'
      : legacyStatus;

  return {
    chainId,
    contractAddress: address,
    status: derivedStatus,
    creationBlock: legacyCreationBlock,
    lastIndexedBlock: legacyLastIndexedBlock,
    latestBlock,
    lastFinalizedBlock: legacyLastFinalizedBlock,
    totalEventsIndexed: actualTotalEvents,
    eventTypes,
    errorMessage: legacyErrorMessage,
    totalRanges,
    completedRanges,
    pendingRanges,
    indexingRanges: indexingRangesCount,
    pausedRanges,
    errorRanges,
    totalProgress,
    ranges,
  };
};

// ============================================
// Event query filtering (shared by list, count, and CSV export)
// ============================================

/** Decoded-arg filter values: JSON scalars only. */
export type EventArgFilters = Record<string, string | number | boolean>;

/** Exact-match raw topic filters; hex values compare case-insensitively. */
export type EventTopicFilters = {
  topic0?: string;
  topic1?: string;
  topic2?: string;
  topic3?: string;
};

export type EventQueryFilters = {
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  argFilters?: EventArgFilters;
  topics?: EventTopicFilters;
};

// Arg names addressable as a DuckDB JSON path: Solidity identifiers plus the
// positional digit keys viem produces for unnamed indexed params. Anything
// else could alter path semantics, so such names are skipped.
const JSON_PATH_SAFE_ARG_NAME = /^[A-Za-z0-9_$]+$/;

const NUMERIC_STRING = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * decoded_args is a JSON text column whose values the indexer stores as JSON
 * strings (see decodeLogs: bigint -> decimal string, everything else ->
 * String(v)). Per-entry semantics (entries AND-combine):
 * - string/boolean value: exact, case-insensitive comparison of the extracted
 *   JSON string ("true"/"false" covers booleans);
 * - numeric value (or numeric string): the exact string form OR the numeric
 *   cast (try_cast(extracted as double) = value), so {"value": 1000} (JSON
 *   number) and {"value": "1000"} (string) both match filter 1000 and "1000".
 *   The numeric arm is double precision; beyond 2^53 only the string arm
 *   matches exactly.
 * try_cast(decoded_args as json) keeps NULL/invalid-JSON rows non-matching
 * instead of erroring. The JSON path is a bound parameter, never interpolated.
 */
const argFilterCondition = (name: string, value: string | number | boolean): SQL => {
  const extracted = sql`json_extract_string(try_cast(${contractEvents.decodedArgs} as json), ${`$.${name}`})`;

  if (typeof value === 'boolean') {
    return sql`lower(${extracted}) = ${value ? 'true' : 'false'}`;
  }

  const arms: SQL[] = [sql`lower(${extracted}) = ${String(value).toLowerCase()}`];
  const numeric =
    typeof value === 'number' ? value : NUMERIC_STRING.test(value) ? Number(value) : undefined;
  if (numeric !== undefined && Number.isFinite(numeric)) {
    arms.push(sql`try_cast(${extracted} as double) = ${numeric}`);
  }
  return sql`(${sql.join(arms, sql` or `)})`;
};

/**
 * Build the WHERE conditions shared by the events list, count, and CSV export
 * queries so all three agree on what a filter matches.
 */
export const buildEventFilterConditions = (
  chainId: number,
  address: `0x${string}`,
  filters: EventQueryFilters,
): SQL[] => {
  const conditions: SQL[] = [
    eq(contractEvents.chainId, chainId),
    eq(contractEvents.contractAddress, address),
  ];

  if (filters.eventName) {
    conditions.push(eq(contractEvents.eventName, filters.eventName));
  }
  if (filters.fromBlock !== undefined) {
    conditions.push(gte(contractEvents.blockNumber, BigInt(filters.fromBlock)));
  }
  if (filters.toBlock !== undefined) {
    conditions.push(lte(contractEvents.blockNumber, BigInt(filters.toBlock)));
  }

  for (const [name, value] of Object.entries(filters.argFilters ?? {})) {
    if (JSON_PATH_SAFE_ARG_NAME.test(name)) {
      conditions.push(argFilterCondition(name, value));
    }
  }

  const topicColumns = [
    ['topic0', contractEvents.topic0],
    ['topic1', contractEvents.topic1],
    ['topic2', contractEvents.topic2],
    ['topic3', contractEvents.topic3],
  ] as const;
  for (const [key, column] of topicColumns) {
    const topic = filters.topics?.[key];
    if (topic) {
      conditions.push(eq(column, topic.toLowerCase()));
    }
  }

  return conditions;
};

export const getContractEvents = async (
  chainId: number,
  address: `0x${string}`,
  options: {
    page?: number;
    pageSize?: number;
    eventName?: string;
    fromBlock?: number;
    toBlock?: number;
    argFilters?: EventArgFilters;
    topics?: EventTopicFilters;
  } = {},
) => {
  const { page = 1, pageSize = 50, ...filters } = options;
  const offset = (page - 1) * pageSize;

  const conditions = buildEventFilterConditions(chainId, address, filters);

  const [events, countResult] = await Promise.all([
    db
      .select()
      .from(contractEvents)
      .where(and(...conditions))
      .orderBy(desc(contractEvents.blockNumber), desc(contractEvents.logIndex))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(contractEvents)
      .where(and(...conditions)),
  ]);

  // The adapter surfaces DuckDB count(*) as a string; normalize so callers
  // get a real number (string totals break numeric comparisons downstream).
  const total = Number(countResult[0]?.count ?? 0);

  return {
    events,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
};

export const getEventStatistics = async (chainId: number, address: `0x${string}`) => {
  const [countResult, typeResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(contractEvents)
      .where(and(eq(contractEvents.chainId, chainId), eq(contractEvents.contractAddress, address))),
    db
      .select({
        eventName: contractEvents.eventName,
        count: sql<number>`count(*)`,
      })
      .from(contractEvents)
      .where(and(eq(contractEvents.chainId, chainId), eq(contractEvents.contractAddress, address)))
      .groupBy(contractEvents.eventName),
  ]);

  const eventsByType: Record<string, number> = {};
  for (const row of typeResult) {
    if (row.eventName) {
      eventsByType[row.eventName] = row.count;
    }
  }

  return {
    totalEvents: countResult[0]?.count ?? 0,
    eventsByType,
    uniqueEventTypes: typeResult.length,
  };
};

// ============================================
// Range-based indexing functions
// ============================================

const getNextRangeId = async (chainId: number, address: `0x${string}`): Promise<number> => {
  const rows = await db
    .select({ maxId: sql<number>`coalesce(max(range_id), 0)` })
    .from(indexingRanges)
    .where(and(eq(indexingRanges.chainId, chainId), eq(indexingRanges.address, address)));
  return (rows[0]?.maxId ?? 0) + 1;
};

const checkRangeOverlaps = async (
  chainId: number,
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  excludeRangeId?: number,
): Promise<RangeOverlap[]> => {
  const conditions = [
    eq(indexingRanges.chainId, chainId),
    eq(indexingRanges.address, address),
    sql`${indexingRanges.fromBlock} <= ${toBlock}`,
    sql`${indexingRanges.toBlock} >= ${fromBlock}`,
  ];

  if (excludeRangeId !== undefined) {
    conditions.push(ne(indexingRanges.rangeId, excludeRangeId));
  }

  const overlapping = await db
    .select()
    .from(indexingRanges)
    .where(and(...conditions));

  return overlapping.map(r => ({
    rangeId: r.rangeId,
    fromBlock: r.fromBlock,
    toBlock: r.toBlock,
    overlapStart: fromBlock > r.fromBlock ? fromBlock : r.fromBlock,
    overlapEnd: toBlock < r.toBlock ? toBlock : r.toBlock,
  }));
};

// Creation block when known, null when unknown. Null is the honest answer:
// callers must never receive a fabricated boundary (e.g. latest - 100k).
const getContractCreationBlockCached = async (
  chainId: number,
  address: `0x${string}`,
): Promise<bigint | null> => {
  const rows = await db
    .select()
    .from(contractCreationInfo)
    .where(
      and(eq(contractCreationInfo.chainId, chainId), eq(contractCreationInfo.address, address)),
    )
    .limit(1);

  // != null rather than truthiness: a genesis-created contract (0n) is known.
  if (rows.length > 0 && rows[0].creationBlockNumber != null) {
    return rows[0].creationBlockNumber;
  }

  try {
    const client = await rpcManager.getClient(chainId);
    return await getContractCreationBlock(client, address);
  } catch {
    return null;
  }
};

export const addIndexingRange = async (
  chainId: number,
  address: `0x${string}`,
  range: {
    fromBlock: BlockTagInput;
    toBlock: BlockTagInput;
    direction?: RangeDirection;
    priority?: number;
  },
): Promise<{
  success: boolean;
  rangeId?: number;
  overlaps?: RangeOverlap[];
  error?: string;
  // Resolved concrete bounds of the stored row (success only), so quick
  // creators can report what was actually created.
  fromBlock?: number;
  toBlock?: number;
  // Set when a numeric toBlock overshot the chain head and was clamped.
  truncatedToBlock?: number;
}> => {
  const { fromBlock, toBlock, direction = 'forward', priority = 0 } = range;

  const client = await rpcManager.getClient(chainId);

  // Resolve block tags to concrete numbers once, at the boundary: rows stored
  // from now on only ever contain concrete >= 0 block numbers, so overlap
  // checks and progress math never see sentinel values.
  const resolvedFromBlock = await resolveToBlock(client, inputToStoredValue(fromBlock));
  const resolvedToBlock = await resolveToBlock(client, inputToStoredValue(toBlock));

  if (resolvedFromBlock >= resolvedToBlock) {
    return { success: false, error: 'fromBlock must be less than toBlock' };
  }

  // A numeric toBlock may overshoot the chain head (typo, a stale head in
  // the caller's UI): clamp the stored bound to the head instead of
  // walking (and polling for) blocks that cannot exist, and say so in the
  // response. Tag inputs are exempt — resolveToBlock resolves them against
  // live chain state, which is at or below the head by construction.
  let storedToBlock = resolvedToBlock;
  let truncatedToBlock: number | undefined;
  if (typeof toBlock === 'number') {
    const head = await client.getBlockNumber();
    if (resolvedToBlock > head) {
      if (resolvedFromBlock >= head) {
        return {
          success: false,
          error: `fromBlock must be below the chain head (${head})`,
        };
      }
      storedToBlock = head;
      truncatedToBlock = Number(head);
    }
  }

  const creationBlock = await getContractCreationBlockCached(chainId, address);

  // Unknown creation block: skip the clamp rather than invent a boundary.
  if (creationBlock !== null && resolvedFromBlock < creationBlock) {
    return {
      success: false,
      error: `fromBlock cannot be before contract creation block (${creationBlock})`,
    };
  }

  const overlaps = await checkRangeOverlaps(
    chainId,
    address,
    resolvedFromBlock,
    storedToBlock,
  );

  const rangeId = await getNextRangeId(chainId, address);

  await db.insert(indexingRanges).values({
    chainId,
    address,
    rangeId,
    fromBlock: resolvedFromBlock,
    toBlock: storedToBlock,
    direction,
    currentBlock: null,
    status: 'pending',
    totalEventsIndexed: 0,
    errorMessage: null,
    priority,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    success: true,
    rangeId,
    overlaps: overlaps.length > 0 ? overlaps : undefined,
    fromBlock: Number(resolvedFromBlock),
    toBlock: Number(storedToBlock),
    truncatedToBlock,
  };
};

export const getIndexingRanges = async (
  chainId: number,
  address: `0x${string}`,
): Promise<IndexingRange[]> => {
  const rows = await db
    .select()
    .from(indexingRanges)
    .where(and(eq(indexingRanges.chainId, chainId), eq(indexingRanges.address, address)))
    .orderBy(desc(indexingRanges.priority), desc(indexingRanges.createdAt));

  return rows.map(r => ({
    chainId: r.chainId,
    address: r.address,
    rangeId: r.rangeId,
    fromBlock: r.fromBlock,
    toBlock: r.toBlock,
    direction: r.direction as RangeDirection,
    currentBlock: r.currentBlock,
    status: r.status as RangeStatus,
    totalEventsIndexed: r.totalEventsIndexed ?? 0,
    errorMessage: r.errorMessage,
    priority: r.priority ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
};

export const updateIndexingRange = async (
  chainId: number,
  address: `0x${string}`,
  rangeId: number,
  updates: {
    fromBlock?: BlockTagInput;
    toBlock?: BlockTagInput;
    direction?: RangeDirection;
    priority?: number;
  },
): Promise<{
  success: boolean;
  overlaps?: RangeOverlap[];
  error?: string;
}> => {
  const existing = await db
    .select()
    .from(indexingRanges)
    .where(
      and(
        eq(indexingRanges.chainId, chainId),
        eq(indexingRanges.address, address),
        eq(indexingRanges.rangeId, rangeId),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return { success: false, error: 'Range not found' };
  }

  const range = existing[0];

  if (range.status === 'indexing') {
    return { success: false, error: 'Cannot update range while indexing' };
  }

  const client = await rpcManager.getClient(chainId);

  // An updated bound may be a block tag; an untouched bound may be a legacy
  // sentinel left by an older row. Resolve both so the stored row always
  // comes out with concrete numbers.
  const resolveBound = (update: BlockTagInput | undefined, current: bigint): Promise<bigint> =>
    resolveToBlock(client, update !== undefined ? inputToStoredValue(update) : Number(current));

  const newFromBlock = await resolveBound(updates.fromBlock, range.fromBlock);
  const newToBlock = await resolveBound(updates.toBlock, range.toBlock);

  if (newFromBlock >= newToBlock) {
    return { success: false, error: 'fromBlock must be less than toBlock' };
  }

  const creationBlock = await getContractCreationBlockCached(chainId, address);

  // Unknown creation block: skip the clamp rather than invent a boundary.
  if (creationBlock !== null && newFromBlock < creationBlock) {
    return {
      success: false,
      error: `fromBlock cannot be before contract creation block (${creationBlock})`,
    };
  }

  const overlaps = await checkRangeOverlaps(chainId, address, newFromBlock, newToBlock, rangeId);

  await db
    .update(indexingRanges)
    .set({
      ...updates,
      fromBlock: newFromBlock,
      toBlock: newToBlock,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(indexingRanges.chainId, chainId),
        eq(indexingRanges.address, address),
        eq(indexingRanges.rangeId, rangeId),
      ),
    );

  return {
    success: true,
    overlaps: overlaps.length > 0 ? overlaps : undefined,
  };
};

export const deleteIndexingRange = async (
  chainId: number,
  address: `0x${string}`,
  rangeId: number,
): Promise<{ success: boolean; error?: string }> => {
  const existing = await db
    .select()
    .from(indexingRanges)
    .where(
      and(
        eq(indexingRanges.chainId, chainId),
        eq(indexingRanges.address, address),
        eq(indexingRanges.rangeId, rangeId),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return { success: false, error: 'Range not found' };
  }

  if (existing[0].status === 'indexing') {
    return { success: false, error: 'Cannot delete range while indexing' };
  }

  await db
    .delete(indexingRanges)
    .where(
      and(
        eq(indexingRanges.chainId, chainId),
        eq(indexingRanges.address, address),
        eq(indexingRanges.rangeId, rangeId),
      ),
    );

  return { success: true };
};

export const startIndexingRange = async (
  chainId: number,
  address: `0x${string}`,
  rangeId: number,
  abi: Abi,
): Promise<{ success: boolean; error?: string }> => {
  const key = rangeJobKey(chainId, address, rangeId);

  if (activeJobs.has(key)) {
    return { success: false, error: 'Range is already being indexed' };
  }

  // Reserve the job key synchronously, before the first await below: two
  // concurrent start calls must not both pass the has() check and run the
  // indexing loop twice for the same range. Early-error returns release the
  // reservation so the range stays startable.
  const job = { abort: false };
  activeJobs.set(key, job);

  const existing = await db
    .select()
    .from(indexingRanges)
    .where(
      and(
        eq(indexingRanges.chainId, chainId),
        eq(indexingRanges.address, address),
        eq(indexingRanges.rangeId, rangeId),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    activeJobs.delete(key);
    return { success: false, error: 'Range not found' };
  }

  const range = existing[0];

  if (range.status === 'completed') {
    activeJobs.delete(key);
    return { success: false, error: 'Range is already completed' };
  }

  const updateRange = async (
    updates: Partial<{
      currentBlock: bigint;
      status: RangeStatus;
      totalEventsIndexed: number;
      errorMessage: string | null;
    }>,
  ) => {
    await db
      .update(indexingRanges)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(indexingRanges.chainId, chainId),
          eq(indexingRanges.address, address),
          eq(indexingRanges.rangeId, rangeId),
        ),
      );
  };

  try {
    await updateRange({ status: 'indexing', errorMessage: null });

    const client = await rpcManager.getClient(chainId);
    const direction = range.direction as RangeDirection;

    // Legacy rows may still carry negative block-tag sentinels; resolve them
    // defensively so the loop never calls getLogs with negative bounds.
    const resolvedFromBlock = await resolveToBlock(client, Number(range.fromBlock));
    const resolvedToBlock = await resolveToBlock(client, Number(range.toBlock));

    let currentBlock: bigint;
    let endBlock: bigint;
    let step: (n: bigint) => bigint;
    let isComplete: (current: bigint, end: bigint) => boolean;

    if (direction === 'forward') {
      currentBlock = range.currentBlock ? range.currentBlock + 1n : BigInt(resolvedFromBlock);
      endBlock = BigInt(resolvedToBlock);
      step = n => n + BigInt(BATCH_SIZE);
      isComplete = (current, end) => current > end;
    } else {
      currentBlock = range.currentBlock ? range.currentBlock - 1n : BigInt(resolvedToBlock);
      endBlock = BigInt(resolvedFromBlock);
      step = n => n - BigInt(BATCH_SIZE);
      isComplete = (current, end) => current < end;
    }

    let totalInserted = range.totalEventsIndexed ?? 0;

    const finalizedBlockNumber = await fetchFinalizedBlockNumber(chainId);

    while (!isComplete(currentBlock, endBlock) && !job.abort) {
      let batchFrom: bigint;
      let batchTo: bigint;

      if (direction === 'forward') {
        batchFrom = currentBlock;
        batchTo = currentBlock + BigInt(BATCH_SIZE) - 1n;
        if (batchTo > endBlock) batchTo = endBlock;
      } else {
        batchTo = currentBlock;
        batchFrom = currentBlock - BigInt(BATCH_SIZE) + 1n;
        if (batchFrom < endBlock) batchFrom = endBlock;
      }

      const logs = await fetchLogsWithRetry(chainId, address, batchFrom, batchTo);

      if (logs.length > 0) {
        const blockNumbers = logs.map(l => l.blockNumber).filter((n): n is bigint => n != null);
        const timestamps = await fetchBlockTimestamps(chainId, blockNumbers);
        const decoded = decodeLogs(logs, abi, timestamps);
        const isFinalized = batchTo <= finalizedBlockNumber;
        await insertEvents(chainId, address, decoded, isFinalized);
        totalInserted += decoded.length;
      }

      await updateRange({
        currentBlock: direction === 'forward' ? batchTo : batchFrom,
        totalEventsIndexed: totalInserted,
        status: 'indexing',
      });

      currentBlock = step(currentBlock);
    }

    // Reorg reconciliation: the finalized-head snapshot above was taken at
    // job start, so rows indexed near the tip may have finalized since (or
    // been reorged out). Verify unfinalized rows below the current finalized
    // head before closing out the range; a failure here must not lose the
    // completed indexing work.
    try {
      await reconcileReorgedEvents(chainId, address);
    } catch (err) {
      logger.warn(
        { err, chainId, address, rangeId },
        'Post-range reorg reconciliation failed',
      );
    }

    const finalBlock =
      direction === 'forward' ? BigInt(resolvedToBlock) : BigInt(resolvedFromBlock);
    // insertEvents counts attempted rows even when the upsert conflicted, so
    // overlap/catchup re-walks inflate totalInserted. Close out with the
    // distinct stored count over the range instead.
    const totalEventsIndexed = await countRangeEvents(
      chainId,
      address,
      resolvedFromBlock,
      resolvedToBlock,
    );
    await updateRange({
      currentBlock: finalBlock,
      status: job.abort ? 'paused' : 'completed',
      totalEventsIndexed,
    });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, key, msg }, 'Error indexing range');
    await updateRange({ status: 'error', errorMessage: msg });
    return { success: false, error: msg };
  } finally {
    activeJobs.delete(key);
  }
};

export const pauseIndexingRange = (chainId: number, address: string, rangeId: number): void => {
  const key = rangeJobKey(chainId, address, rangeId);
  const job = activeJobs.get(key);
  if (job) job.abort = true;
};

// resumeIndexingRange re-validates the persisted range status (which requires
// an await) and then delegates to startIndexingRange. The synchronous
// activeJobs reservation at the top of startIndexingRange is the gate that
// keeps two racing resumes from double-starting the same range.
export const resumeIndexingRange = async (
  chainId: number,
  address: `0x${string}`,
  rangeId: number,
  abi: Abi,
): Promise<{ success: boolean; error?: string }> => {
  const existing = await db
    .select()
    .from(indexingRanges)
    .where(
      and(
        eq(indexingRanges.chainId, chainId),
        eq(indexingRanges.address, address),
        eq(indexingRanges.rangeId, rangeId),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return { success: false, error: 'Range not found' };
  }

  const range = existing[0];

  if (range.status !== 'paused' && range.status !== 'error') {
    return { success: false, error: 'Can only resume paused or errored ranges' };
  }

  return startIndexingRange(chainId, address, rangeId, abi);
};

export const getActiveRangeJob = (chainId: number, address: string, rangeId: number): boolean => {
  const key = rangeJobKey(chainId, address, rangeId);
  return activeJobs.has(key);
};

export const updateRangeStatus = async (
  chainId: number,
  address: `0x${string}`,
  rangeId: number,
  status: RangeStatus,
): Promise<{ success: boolean; error?: string }> => {
  const existing = await db
    .select()
    .from(indexingRanges)
    .where(
      and(
        eq(indexingRanges.chainId, chainId),
        eq(indexingRanges.address, address),
        eq(indexingRanges.rangeId, rangeId),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return { success: false, error: 'Range not found' };
  }

  await db
    .update(indexingRanges)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(indexingRanges.chainId, chainId),
        eq(indexingRanges.address, address),
        eq(indexingRanges.rangeId, rangeId),
      ),
    );

  return { success: true };
};

// Ranges left in status 'indexing' by a previous process (crash or restart)
// can never recover on their own: the in-memory job died with the process,
// resumeIndexingRange only accepts paused/error, and the range UI exposes no
// action for a range that claims to be indexing. Flip them to 'error' with a
// resume hint so the user can continue. Idempotent by construction (a second
// run finds no 'indexing' rows), so the vite-bridge instance and a standalone
// server can both run it against the same database.
//
// The same startup hook also runs the reorg reconciliation sweep: unfinalized
// rows below the finalized head get receipt-verified, promoted, or deleted
// without waiting for the next range job on that contract.
export const reconcileInterruptedRanges = async (): Promise<void> => {
  await db
    .update(indexingRanges)
    .set({
      status: 'error',
      errorMessage: 'Interrupted by server restart — resume to continue',
      updatedAt: new Date(),
    })
    .where(eq(indexingRanges.status, 'indexing'));

  await reconcileAllReorgedEvents();
};

export type QuickCreateResult = {
  success: boolean;
  rangeId?: number;
  fromBlock?: number;
  toBlock?: number;
  error?: string;
  // Full-history gate (createRangeAll): the create was refused because the
  // span exceeds FULL_HISTORY_GATE_BLOCKS without an explicit confirmation.
  reason?: 'full-history-unconfirmed';
  spanBlocks?: number;
  head?: number;
  // Set by addIndexingRange when the stored toBlock was clamped to the head.
  truncatedToBlock?: number;
};

// Spans beyond this many blocks (creation → head) are treated as "full
// history": indexing them is a hours-to-days commitment that quick mode
// must not start silently.
export const FULL_HISTORY_GATE_BLOCKS = 1_000_000;

export const createRangeAll = async (
  chainId: number,
  address: `0x${string}`,
  options?: {
    direction?: RangeDirection;
    priority?: number;
    confirmFullHistory?: boolean;
  },
): Promise<QuickCreateResult> => {
  const creationBlock = await getContractCreationBlockCached(chainId, address);

  // Known creation: start exactly there. Unknown: index from genesis
  // rather than refusing or guessing a boundary.
  const fromBlock = creationBlock !== null ? Number(creationBlock) : 0;

  const client = await rpcManager.getClient(chainId);
  const head = await client.getBlockNumber();
  const spanBlocks = Number(head) - fromBlock;

  if (spanBlocks > FULL_HISTORY_GATE_BLOCKS && options?.confirmFullHistory !== true) {
    return {
      success: false,
      error: `Indexing the full history spans about ${spanBlocks.toLocaleString()} blocks — confirm with confirmFullHistory: true`,
      reason: 'full-history-unconfirmed',
      spanBlocks,
      fromBlock,
      head: Number(head),
    };
  }

  return addIndexingRange(chainId, address, {
    fromBlock,
    toBlock: 'latest',
    direction: options?.direction,
    priority: options?.priority,
  });
};

export const createRangeRecent = async (
  chainId: number,
  address: `0x${string}`,
  blockCount: number,
  options?: { direction?: RangeDirection; priority?: number },
): Promise<QuickCreateResult> => {
  const client = await rpcManager.getClient(chainId);
  const latestBlock = await client.getBlockNumber();

  const fromBlock = latestBlock >= BigInt(blockCount) ? latestBlock - BigInt(blockCount) : 0n;

  return addIndexingRange(chainId, address, {
    fromBlock: Number(fromBlock),
    toBlock: Number(latestBlock),
    direction: options?.direction ?? 'forward',
    priority: options?.priority,
  });
};

export const createRangeFirst = async (
  chainId: number,
  address: `0x${string}`,
  blockCount: number,
  options?: { direction?: RangeDirection; priority?: number },
): Promise<QuickCreateResult> => {
  const creationBlock = await getContractCreationBlockCached(chainId, address);

  if (creationBlock === null) {
    return {
      success: false,
      error: 'Contract creation block unknown — enter a start block manually',
    };
  }

  return addIndexingRange(chainId, address, {
    fromBlock: Number(creationBlock),
    toBlock: Number(creationBlock) + blockCount,
    direction: options?.direction ?? 'forward',
    priority: options?.priority,
  });
};

export const createRangeContinue = async (
  chainId: number,
  address: `0x${string}`,
  blockCount: number,
  options?: { direction?: RangeDirection; priority?: number },
): Promise<QuickCreateResult> => {
  const ranges = await getIndexingRanges(chainId, address);

  if (ranges.length === 0) {
    return { success: false, error: 'No previous range found. Cannot continue.' };
  }

  // Continue from the FURTHEST block any existing range reached, not from
  // the first listed range: the list is priority/createdAt-desc, so
  // ranges[0] is just the newest row and may end far below an older,
  // longer range — continuing there would silently skip the gap between
  // them. Inclusive start, same semantics catchup uses.
  const furthest = ranges.reduce((max, r) => (r.toBlock > max.toBlock ? r : max), ranges[0]);
  const continueFromBlock = Number(furthest.toBlock);
  const continueToBlock = continueFromBlock + blockCount;

  return addIndexingRange(chainId, address, {
    fromBlock: continueFromBlock,
    toBlock: continueToBlock,
    direction: options?.direction ?? furthest.direction,
    priority: options?.priority,
  });
};

// Catch up: from the furthest block any existing range reached (inclusive
// start, like Continue) up to the current chain tip, resolved to a number.
export const createRangeCatchup = async (
  chainId: number,
  address: `0x${string}`,
  options?: { direction?: RangeDirection; priority?: number },
): Promise<QuickCreateResult> => {
  const ranges = await getIndexingRanges(chainId, address);

  if (ranges.length === 0) {
    return { success: false, error: 'No previous range found. Cannot catch up.' };
  }

  const maxToBlock = ranges.reduce(
    (max, r) => (r.toBlock > max ? r.toBlock : max),
    ranges[0].toBlock,
  );

  const client = await rpcManager.getClient(chainId);
  const latestBlock = await client.getBlockNumber();

  return addIndexingRange(chainId, address, {
    fromBlock: Number(maxToBlock),
    toBlock: Number(latestBlock),
    direction: options?.direction ?? 'forward',
    priority: options?.priority,
  });
};
