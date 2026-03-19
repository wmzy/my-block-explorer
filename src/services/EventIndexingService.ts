import { eq, and, sql, gte, lte, desc } from "drizzle-orm";
import { db } from "../database/drizzle";
import {
  indexingProgress,
  contractEvents,
  contractCreationInfo,
} from "../database/schema";
import { rpcManager } from "./RpcManager";
import { decodeEventLog, type Abi, type Log } from "viem";
import { getContractCreationBlock } from "../utils/events";

const BATCH_SIZE = 2000;
const MAX_RETRY = 3;
const RETRY_DELAY_MS = 2000;

type IndexingState = {
  chainId: number;
  address: `0x${string}`;
  status: "idle" | "indexing" | "error";
  creationBlock: bigint;
  lastIndexedBlock: bigint;
  lastFinalizedBlock: bigint;
  totalEventsIndexed: number;
  errorMessage?: string;
};

const activeJobs = new Map<string, { abort: boolean }>();

const jobKey = (chainId: number, address: string) =>
  `${chainId}:${address.toLowerCase()}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getOrCreateProgress = async (
  chainId: number,
  address: `0x${string}`,
  creationBlock: bigint
): Promise<IndexingState> => {
  const rows = await db
    .select()
    .from(indexingProgress)
    .where(
      and(
        eq(indexingProgress.chainId, chainId),
        eq(indexingProgress.address, address)
      )
    )
    .limit(1);

  if (rows.length > 0) {
    const row = rows[0];
    const storedCreation = row.creationBlock ?? 0n;
    const effectiveCreation = storedCreation > 0n ? storedCreation : creationBlock;

    if (storedCreation === 0n && creationBlock > 0n) {
      await db
        .update(indexingProgress)
        .set({ creationBlock, updatedAt: new Date() })
        .where(
          and(
            eq(indexingProgress.chainId, chainId),
            eq(indexingProgress.address, address)
          )
        );
    }

    const lastIndexed = row.lastIndexedBlock ?? effectiveCreation;
    const resumeFrom = lastIndexed < effectiveCreation ? effectiveCreation : lastIndexed;

    return {
      chainId: row.chainId,
      address: row.address as `0x${string}`,
      status: (row.status as IndexingState["status"]) ?? "idle",
      creationBlock: effectiveCreation,
      lastIndexedBlock: resumeFrom,
      lastFinalizedBlock: row.lastFinalizedBlock ?? 0n,
      totalEventsIndexed: row.totalEventsIndexed ?? 0,
      errorMessage: row.errorMessage ?? undefined,
    };
  }

  await db.insert(indexingProgress).values({
    chainId,
    address,
    creationBlock,
    lastIndexedBlock: creationBlock,
    lastFinalizedBlock: 0n,
    totalEventsIndexed: 0,
    status: "idle",
    updatedAt: new Date(),
  });

  return {
    chainId,
    address,
    status: "idle",
    creationBlock,
    lastIndexedBlock: creationBlock,
    lastFinalizedBlock: 0n,
    totalEventsIndexed: 0,
  };
};

const updateProgress = async (
  chainId: number,
  address: `0x${string}`,
  updates: Partial<{
    lastIndexedBlock: bigint;
    lastFinalizedBlock: bigint;
    totalEventsIndexed: number;
    status: string;
    errorMessage: string | null;
  }>
) => {
  await db
    .update(indexingProgress)
    .set({ ...updates, updatedAt: new Date() })
    .where(
      and(
        eq(indexingProgress.chainId, chainId),
        eq(indexingProgress.address, address)
      )
    );
};

const fetchLogsWithRetry = async (
  chainId: number,
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint
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

const fetchBlockTimestamps = async (
  chainId: number,
  blockNumbers: bigint[]
): Promise<Map<bigint, number>> => {
  const client = await rpcManager.getClient(chainId);
  const map = new Map<bigint, number>();
  const unique = [...new Set(blockNumbers)];

  const results = await Promise.allSettled(
    unique.map(async (bn) => {
      const block = await client.getBlock({ blockNumber: bn });
      return { bn, ts: Number(block.timestamp) };
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      map.set(r.value.bn, r.value.ts);
    }
  }
  return map;
};

const decodeLogs = (
  logs: Log[],
  abi: Abi,
  blockTimestamps: Map<bigint, number>
) => {
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
      if (result.args && typeof result.args === "object") {
        for (const [k, v] of Object.entries(result.args as object)) {
          args[k] = typeof v === "bigint" ? v.toString() : String(v);
        }
      }

      decoded.push({
        blockNumber: log.blockNumber ?? 0n,
        blockTimestamp:
          blockTimestamps.get(log.blockNumber ?? 0n) ??
          Math.floor(Date.now() / 1000),
        transactionHash: log.transactionHash ?? ("0x" as `0x${string}`),
        transactionIndex: log.transactionIndex ?? 0,
        logIndex: log.logIndex ?? 0,
        eventName: result.eventName ?? "Unknown",
        eventSignature: (log.topics[0] as string) ?? "",
        decodedArgs: JSON.stringify(args),
        topic0: (log.topics[0] as string) ?? "",
        topic1: (log.topics[1] as string) ?? null,
        topic2: (log.topics[2] as string) ?? null,
        topic3: (log.topics[3] as string) ?? null,
        data: log.data ?? "0x",
      });
    } catch {
      decoded.push({
        blockNumber: log.blockNumber ?? 0n,
        blockTimestamp:
          blockTimestamps.get(log.blockNumber ?? 0n) ??
          Math.floor(Date.now() / 1000),
        transactionHash: log.transactionHash ?? ("0x" as `0x${string}`),
        transactionIndex: log.transactionIndex ?? 0,
        logIndex: log.logIndex ?? 0,
        eventName: "Unknown",
        eventSignature: (log.topics[0] as string) ?? "",
        decodedArgs: "{}",
        topic0: (log.topics[0] as string) ?? "",
        topic1: (log.topics[1] as string) ?? null,
        topic2: (log.topics[2] as string) ?? null,
        topic3: (log.topics[3] as string) ?? null,
        data: log.data ?? "0x",
      });
    }
  }
  return decoded;
};

const insertEvents = async (
  chainId: number,
  contractAddress: `0x${string}`,
  events: ReturnType<typeof decodeLogs>,
  isFinalized: boolean
) => {
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
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

  try {
    await db
      .insert(contractEvents)
      .values(rows)
      .onConflictDoNothing();
  } catch (err) {
    console.error("[EventIndexing] Insert error, falling back to individual inserts:", err);
    for (const row of rows) {
      try {
        await db.insert(contractEvents).values(row).onConflictDoNothing();
      } catch {
        // skip duplicates
      }
    }
  }

  return rows.length;
};

const handleReorgs = async (
  chainId: number,
  contractAddress: `0x${string}`,
  lastFinalizedBlock: bigint
) => {
  const nonFinalized = await db
    .select()
    .from(contractEvents)
    .where(
      and(
        eq(contractEvents.chainId, chainId),
        eq(contractEvents.contractAddress, contractAddress),
        eq(contractEvents.isFinalized, false),
        lte(contractEvents.blockNumber, lastFinalizedBlock)
      )
    );

  if (nonFinalized.length === 0) return;

  const client = await rpcManager.getClient(chainId);
  const blockNumbers = [
    ...new Set(nonFinalized.map((e) => e.blockNumber)),
  ];

  for (const bn of blockNumbers) {
    try {
      const block = await client.getBlock({ blockNumber: bn });
      const eventsInBlock = nonFinalized.filter(
        (e) => e.blockNumber === bn
      );

      const blockTxHashes = new Set(
        block.transactions as string[]
      );

      const reorgedEvents = eventsInBlock.filter(
        (e) => !blockTxHashes.has(e.transactionHash)
      );

      if (reorgedEvents.length > 0) {
        console.warn(
          `[EventIndexing] Reorg detected at block ${bn}, removing ${reorgedEvents.length} events`
        );
        for (const e of reorgedEvents) {
          await db
            .delete(contractEvents)
            .where(
              and(
                eq(contractEvents.chainId, chainId),
                eq(contractEvents.transactionHash, e.transactionHash),
                eq(contractEvents.logIndex, e.logIndex!)
              )
            );
        }
      }
    } catch {
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
        lte(contractEvents.blockNumber, lastFinalizedBlock)
      )
    );
};

export const startIndexing = async (
  chainId: number,
  address: `0x${string}`,
  abi: Abi
): Promise<void> => {
  const key = jobKey(chainId, address);

  if (activeJobs.has(key)) {
    console.log(`[EventIndexing] Already indexing ${key}`);
    return;
  }

  const job = { abort: false };
  activeJobs.set(key, job);

  try {
    const creationRows = await db
      .select()
      .from(contractCreationInfo)
      .where(
        and(
          eq(contractCreationInfo.chainId, chainId),
          eq(contractCreationInfo.address, address)
        )
      )
      .limit(1);

    let creationBlock = creationRows[0]?.creationBlockNumber ?? 0n;

    if (creationBlock === 0n) {
      try {
        const client = await rpcManager.getClient(chainId);
        creationBlock = await getContractCreationBlock(client, address);
      } catch {
        // fallback: start from a recent range
        const client = await rpcManager.getClient(chainId);
        const latest = await client.getBlockNumber();
        creationBlock = latest > 100_000n ? latest - 100_000n : 0n;
      }
    }

    const state = await getOrCreateProgress(chainId, address, creationBlock);

    await updateProgress(chainId, address, { status: "indexing", errorMessage: null });

    const client = await rpcManager.getClient(chainId);

    let finalizedBlockNumber: bigint;
    try {
      const finalizedBlock = await client.getBlock({
        blockTag: "finalized",
      });
      finalizedBlockNumber = finalizedBlock.number;
    } catch {
      const latestBlock = await client.getBlockNumber();
      finalizedBlockNumber = latestBlock - 64n;
    }

    const latestBlock = await client.getBlockNumber();

    if (state.lastFinalizedBlock > 0n) {
      await handleReorgs(chainId, address, finalizedBlockNumber);
    }

    let fromBlock = state.lastIndexedBlock > creationBlock
      ? state.lastIndexedBlock + 1n
      : creationBlock;
    let totalInserted = state.totalEventsIndexed;

    while (fromBlock <= latestBlock && !job.abort) {
      const toBlock =
        fromBlock + BigInt(BATCH_SIZE) - 1n > latestBlock
          ? latestBlock
          : fromBlock + BigInt(BATCH_SIZE) - 1n;

      const logs = await fetchLogsWithRetry(chainId, address, fromBlock, toBlock);

      if (logs.length > 0) {
        const blockNumbers = logs
          .map((l) => l.blockNumber)
          .filter((n): n is bigint => n != null);
        const timestamps = await fetchBlockTimestamps(chainId, blockNumbers);
        const decoded = decodeLogs(logs, abi, timestamps);
        const isFinalized = toBlock <= finalizedBlockNumber;
        const inserted = await insertEvents(
          chainId,
          address,
          decoded,
          isFinalized
        );
        totalInserted += inserted;
      }

      await updateProgress(chainId, address, {
        lastIndexedBlock: toBlock,
        lastFinalizedBlock:
          toBlock <= finalizedBlockNumber ? toBlock : state.lastFinalizedBlock,
        totalEventsIndexed: totalInserted,
        status: "indexing",
      });

      fromBlock = toBlock + 1n;
    }

    await updateProgress(chainId, address, {
      lastIndexedBlock: latestBlock,
      totalEventsIndexed: totalInserted,
      status: "idle",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EventIndexing] Error indexing ${key}:`, msg);
    await updateProgress(chainId, address, {
      status: "error",
      errorMessage: msg,
    }).catch(() => {});
  } finally {
    activeJobs.delete(key);
  }
};

export const stopIndexing = (chainId: number, address: string) => {
  const key = jobKey(chainId, address);
  const job = activeJobs.get(key);
  if (job) job.abort = true;
};

export const getIndexingStatus = async (
  chainId: number,
  address: `0x${string}`
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
}> => {
  const rows = await db
    .select()
    .from(indexingProgress)
    .where(
      and(
        eq(indexingProgress.chainId, chainId),
        eq(indexingProgress.address, address)
      )
    )
    .limit(1);

  let latestBlock = 0;
  try {
    const rpcTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("RPC timeout")), 10_000)
    );
    const client = await Promise.race([rpcManager.getClient(chainId), rpcTimeout]);
    latestBlock = Number(await Promise.race([client.getBlockNumber(), rpcTimeout]));
  } catch {
    // ignore
  }

  const eventTypeRows = await db
    .select({ eventName: contractEvents.eventName })
    .from(contractEvents)
    .where(
      and(
        eq(contractEvents.chainId, chainId),
        eq(contractEvents.contractAddress, address)
      )
    )
    .groupBy(contractEvents.eventName);

  const eventTypes = eventTypeRows
    .map((r) => r.eventName)
    .filter((n): n is string => !!n);

  if (rows.length === 0) {
    return {
      chainId,
      contractAddress: address,
      status: "idle",
      creationBlock: 0,
      lastIndexedBlock: 0,
      latestBlock,
      lastFinalizedBlock: 0,
      totalEventsIndexed: 0,
      eventTypes,
    };
  }

  const row = rows[0];
  return {
    chainId,
    contractAddress: address,
    status: row.status ?? "idle",
    creationBlock: Number(row.creationBlock ?? 0n),
    lastIndexedBlock: Number(row.lastIndexedBlock ?? 0n),
    latestBlock,
    lastFinalizedBlock: Number(row.lastFinalizedBlock ?? 0n),
    totalEventsIndexed: row.totalEventsIndexed ?? 0,
    eventTypes,
    errorMessage: row.errorMessage ?? undefined,
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
  } = {}
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

export const getEventStatistics = async (
  chainId: number,
  address: `0x${string}`
) => {
  const [countResult, typeResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(contractEvents)
      .where(
        and(
          eq(contractEvents.chainId, chainId),
          eq(contractEvents.contractAddress, address)
        )
      ),
    db
      .select({
        eventName: contractEvents.eventName,
        count: sql<number>`count(*)`,
      })
      .from(contractEvents)
      .where(
        and(
          eq(contractEvents.chainId, chainId),
          eq(contractEvents.contractAddress, address)
        )
      )
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
