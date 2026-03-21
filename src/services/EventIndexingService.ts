import { eq, and, sql, gte, lte, desc, isNull, ne } from 'drizzle-orm';
import { db } from '../database/drizzle';
import {
  indexingProgress,
  contractEvents,
  contractCreationInfo,
  indexingRanges,
} from '../database/schema';
import { rpcManager } from './RpcManager';
import { decodeEventLog, type Abi, type Log } from 'viem';
import { getContractCreationBlock } from '../utils/events';

const BATCH_SIZE = 2000;
const MAX_RETRY = 3;
const RETRY_DELAY_MS = 2000;

type IndexingState = {
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
    }
    catch (err) {
      if (attempt === MAX_RETRY - 1) throw err;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  return [];
};

const fetchBlockTimestamps = async (
  chainId: number,
  blockNumbers: bigint[],
): Promise<Map<bigint, number>> => {
  const client = await rpcManager.getClient(chainId);
  const map = new Map<bigint, number>();
  const unique = [...new Set(blockNumbers)];

  const results = await Promise.allSettled(
    unique.map(async (bn) => {
      const block = await client.getBlock({ blockNumber: bn });
      return { bn, ts: Number(block.timestamp) };
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      map.set(r.value.bn, r.value.ts);
    }
  }
  return map;
};

const decodeLogs = (logs: Log[], abi: Abi, blockTimestamps: Map<bigint, number>) => {
  const decoded: Array<{
    blockNumber: bigint;
    blockTimestamp: number;
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
        blockTimestamp: blockTimestamps.get(log.blockNumber ?? 0n) ?? Math.floor(Date.now() / 1000),
        transactionHash: log.transactionHash ?? ('0x' as `0x${string}`),
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
    }
    catch {
      decoded.push({
        blockNumber: log.blockNumber ?? 0n,
        blockTimestamp: blockTimestamps.get(log.blockNumber ?? 0n) ?? Math.floor(Date.now() / 1000),
        transactionHash: log.transactionHash ?? ('0x' as `0x${string}`),
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

const insertEvents = async (
  chainId: number,
  contractAddress: `0x${string}`,
  events: ReturnType<typeof decodeLogs>,
  isFinalized: boolean,
) => {
  if (events.length === 0) return 0;

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
      await db.insert(contractEvents).values(chunk).onConflictDoNothing();
    }
    catch {
      for (const row of chunk) {
        try {
          await db.insert(contractEvents).values(row).onConflictDoNothing();
        }
        catch {
          // skip duplicates
        }
      }
    }
  }

  return rows.length;
};

const handleReorgs = async (
  chainId: number,
  contractAddress: `0x${string}`,
  lastFinalizedBlock: bigint,
) => {
  const nonFinalized = await db
    .select()
    .from(contractEvents)
    .where(
      and(
        eq(contractEvents.chainId, chainId),
        eq(contractEvents.contractAddress, contractAddress),
        eq(contractEvents.isFinalized, false),
        lte(contractEvents.blockNumber, lastFinalizedBlock),
      ),
    );

  if (nonFinalized.length === 0) return;

  const client = await rpcManager.getClient(chainId);
  const blockNumbers = [...new Set(nonFinalized.map(e => e.blockNumber))];

  for (const bn of blockNumbers) {
    try {
      const block = await client.getBlock({ blockNumber: bn });
      const eventsInBlock = nonFinalized.filter(e => e.blockNumber === bn);

      const blockTxHashes = new Set(block.transactions as string[]);

      const reorgedEvents = eventsInBlock.filter(e => !blockTxHashes.has(e.transactionHash));

      if (reorgedEvents.length > 0) {
        console.warn(
          `[EventIndexing] Reorg detected at block ${bn}, removing ${reorgedEvents.length} events`,
        );
        for (const e of reorgedEvents) {
          await db
            .delete(contractEvents)
            .where(
              and(
                eq(contractEvents.chainId, chainId),
                eq(contractEvents.transactionHash, e.transactionHash),
                eq(contractEvents.logIndex, e.logIndex),
              ),
            );
        }
      }
    }
    catch {
      // skip block verification on error
    }
  }

  await db
    .update(contractEvents)
    .set({ isFinalized: true })
    .where(
      and(
        eq(contractEvents.chainId, chainId),
        eq(contractEvents.contractAddress, contractAddress),
        eq(contractEvents.isFinalized, false),
        lte(contractEvents.blockNumber, lastFinalizedBlock),
      ),
    );
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
  }
  catch {
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

  const ranges: RangeSummary[] = rangeRows.map((r) => {
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
          const progress
            = r.direction === 'forward' ? currentBlock - fromBlock : toBlock - currentBlock;
          indexedBlocks += Math.max(0, progress);
        }
        break;
      case 'pending':
        pendingRanges++;
        break;
      case 'paused':
        pausedRanges++;
        if (currentBlock !== null) {
          const progress
            = r.direction === 'forward' ? currentBlock - fromBlock : toBlock - currentBlock;
          indexedBlocks += Math.max(0, progress);
        }
        break;
      case 'error':
        errorRanges++;
        if (currentBlock !== null) {
          const progress
            = r.direction === 'forward' ? currentBlock - fromBlock : toBlock - currentBlock;
          indexedBlocks += Math.max(0, progress);
        }
        break;
    }

    const progress
      = rangeSize > 0
        ? (() => {
            if (r.status === 'completed') return 100;
            if (currentBlock === null) return 0;
            const completed
              = r.direction === 'forward' ? currentBlock - fromBlock : toBlock - currentBlock;
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
  const derivedStatus
    = rows.length === 0 && totalRanges > 0
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

export const getContractEvents = async (
  chainId: number,
  address: `0x${string}`,
  options: {
    page?: number;
    pageSize?: number;
    eventName?: string;
    fromBlock?: number;
    toBlock?: number;
  } = {},
) => {
  const { page = 1, pageSize = 50, eventName, fromBlock, toBlock } = options;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(contractEvents.chainId, chainId),
    eq(contractEvents.contractAddress, address),
  ];

  if (eventName) {
    conditions.push(eq(contractEvents.eventName, eventName));
  }
  if (fromBlock !== undefined) {
    conditions.push(gte(contractEvents.blockNumber, BigInt(fromBlock)));
  }
  if (toBlock !== undefined) {
    conditions.push(lte(contractEvents.blockNumber, BigInt(toBlock)));
  }

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

  return {
    events,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((countResult[0]?.count ?? 0) / pageSize),
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

const getContractCreationBlockCached = async (
  chainId: number,
  address: `0x${string}`,
): Promise<bigint> => {
  const rows = await db
    .select()
    .from(contractCreationInfo)
    .where(
      and(eq(contractCreationInfo.chainId, chainId), eq(contractCreationInfo.address, address)),
    )
    .limit(1);

  if (rows.length > 0 && rows[0].creationBlockNumber) {
    return rows[0].creationBlockNumber;
  }

  try {
    const client = await rpcManager.getClient(chainId);
    const block = await getContractCreationBlock(client, address);
    return block;
  }
  catch {
    const client = await rpcManager.getClient(chainId);
    const latest = await client.getBlockNumber();
    return latest > 100_000n ? latest - 100_000n : 0n;
  }
};

export const addIndexingRange = async (
  chainId: number,
  address: `0x${string}`,
  range: {
    fromBlock: number;
    toBlock: number;
    direction?: RangeDirection;
    priority?: number;
  },
): Promise<{
  success: boolean;
  rangeId?: number;
  overlaps?: RangeOverlap[];
  error?: string;
}> => {
  const { fromBlock, toBlock, direction = 'forward', priority = 0 } = range;

  if (fromBlock >= toBlock) {
    return { success: false, error: 'fromBlock must be less than toBlock' };
  }

  const creationBlock = await getContractCreationBlockCached(chainId, address);

  if (fromBlock < Number(creationBlock)) {
    return {
      success: false,
      error: `fromBlock cannot be before contract creation block (${creationBlock})`,
    };
  }

  const overlaps = await checkRangeOverlaps(chainId, address, BigInt(fromBlock), BigInt(toBlock));

  const rangeId = await getNextRangeId(chainId, address);

  await db.insert(indexingRanges).values({
    chainId,
    address,
    rangeId,
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
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
    fromBlock?: number;
    toBlock?: number;
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

  const newFromBlock
    = updates.fromBlock !== undefined ? BigInt(updates.fromBlock) : range.fromBlock;
  const newToBlock = updates.toBlock !== undefined ? BigInt(updates.toBlock) : range.toBlock;

  if (newFromBlock >= newToBlock) {
    return { success: false, error: 'fromBlock must be less than toBlock' };
  }

  const creationBlock = await getContractCreationBlockCached(chainId, address);

  if (newFromBlock < creationBlock) {
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
      fromBlock: updates.fromBlock !== undefined ? BigInt(updates.fromBlock) : undefined,
      toBlock: updates.toBlock !== undefined ? BigInt(updates.toBlock) : undefined,
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

  if (range.status === 'completed') {
    return { success: false, error: 'Range is already completed' };
  }

  const job = { abort: false };
  activeJobs.set(key, job);

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

    let currentBlock: bigint;
    let endBlock: bigint;
    let step: (n: bigint) => bigint;
    let isComplete: (current: bigint, end: bigint) => boolean;

    if (direction === 'forward') {
      currentBlock = range.currentBlock ? range.currentBlock + 1n : range.fromBlock;
      endBlock = range.toBlock;
      step = n => n + BigInt(BATCH_SIZE);
      isComplete = (current, end) => current > end;
    }
    else {
      currentBlock = range.currentBlock ? range.currentBlock - 1n : range.toBlock;
      endBlock = range.fromBlock;
      step = n => n - BigInt(BATCH_SIZE);
      isComplete = (current, end) => current < end;
    }

    let totalInserted = range.totalEventsIndexed ?? 0;

    let finalizedBlockNumber: bigint;
    try {
      const finalizedBlock = await client.getBlock({ blockTag: 'finalized' });
      finalizedBlockNumber = finalizedBlock.number;
    }
    catch {
      const latestBlock = await client.getBlockNumber();
      finalizedBlockNumber = latestBlock - 64n;
    }

    while (!isComplete(currentBlock, endBlock) && !job.abort) {
      let batchFrom: bigint;
      let batchTo: bigint;

      if (direction === 'forward') {
        batchFrom = currentBlock;
        batchTo = currentBlock + BigInt(BATCH_SIZE) - 1n;
        if (batchTo > endBlock) batchTo = endBlock;
      }
      else {
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
        const inserted = await insertEvents(chainId, address, decoded, isFinalized);
        totalInserted += inserted;
      }

      await updateRange({
        currentBlock: direction === 'forward' ? batchTo : batchFrom,
        totalEventsIndexed: totalInserted,
        status: 'indexing',
      });

      currentBlock = step(currentBlock);
    }

    const finalBlock = direction === 'forward' ? range.toBlock : range.fromBlock;
    await updateRange({
      currentBlock: finalBlock,
      status: job.abort ? 'paused' : 'completed',
      totalEventsIndexed: totalInserted,
    });

    return { success: true };
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EventIndexing] Error indexing range ${key}:`, msg);
    await updateRange({ status: 'error', errorMessage: msg });
    return { success: false, error: msg };
  }
  finally {
    activeJobs.delete(key);
  }
};

export const pauseIndexingRange = (chainId: number, address: string, rangeId: number): void => {
  const key = rangeJobKey(chainId, address, rangeId);
  const job = activeJobs.get(key);
  if (job) job.abort = true;
};

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
