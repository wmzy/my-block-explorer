import { eq, and, sql, desc, count } from "drizzle-orm";
import { createLogger } from "../server/logger";

const logger = createLogger("block-service");

/**
 * 区块数据类型
 */
export type Block = {
  chainId: number;
  number: bigint;
  hash: string;
  parentHash?: string;
  timestamp?: Date;
  miner?: string;
  gasLimit?: bigint;
  gasUsed?: bigint;
  baseFeePerGas?: bigint;
  transactionCount?: number;
  sizeBytes?: number;
  difficulty?: string;
  totalDifficulty?: string;
  extraData?: string;
  logsBloom?: string;
  stateRoot?: string;
  transactionsRoot?: string;
  receiptsRoot?: string;
  indexedAt?: Date;
};

type BlockServiceDeps = {
  db: typeof import("../database/init").db;
  blocks: typeof import("../database/init").blocks;
  rpcManager: typeof import("./RpcManager").rpcManager;
  blockCache: typeof import("../utils/cache").blockCache;
  createRetryableRpcCall: typeof import("../utils/errorHandler").createRetryableRpcCall;
  createRetryableDbCall: typeof import("../utils/errorHandler").createRetryableDbCall;
  logError: typeof import("../utils/errorHandler").logError;
};

const createBlockService = (deps: BlockServiceDeps) => {
  const { db, blocks, rpcManager, blockCache } = deps;
  const { createRetryableRpcCall: retryableRpc, createRetryableDbCall: retryableDb, logError: logErr } = deps;

  const formatBlock = (dbBlock: Record<string, unknown>): Block => {
    const get = (camel: string, snake: string) => dbBlock[camel] ?? dbBlock[snake];
    return {
      chainId: Number(get("chainId", "chain_id")),
      number: BigInt((get("number", "number") as string | number) || 0),
      hash: get("hash", "hash") as string,
      parentHash: (get("parentHash", "parent_hash") as string) || undefined,
      timestamp: get("timestamp", "timestamp")
        ? new Date(get("timestamp", "timestamp") as string | number)
        : undefined,
      miner: (get("miner", "miner") as string) || undefined,
      gasLimit: get("gasLimit", "gas_limit")
        ? BigInt(get("gasLimit", "gas_limit") as string)
        : undefined,
      gasUsed: get("gasUsed", "gas_used")
        ? BigInt(get("gasUsed", "gas_used") as string)
        : undefined,
      baseFeePerGas: get("baseFeePerGas", "base_fee_per_gas")
        ? BigInt(get("baseFeePerGas", "base_fee_per_gas") as string)
        : undefined,
      transactionCount: (get("transactionCount", "transaction_count") as number) || undefined,
      sizeBytes: (get("sizeBytes", "size_bytes") as number) || undefined,
      difficulty: (get("difficulty", "difficulty") as string) || undefined,
      totalDifficulty: (get("totalDifficulty", "total_difficulty") as string) || undefined,
      extraData: (get("extraData", "extra_data") as string) || undefined,
      logsBloom: (get("logsBloom", "logs_bloom") as string) || undefined,
      stateRoot: (get("stateRoot", "state_root") as string) || undefined,
      transactionsRoot: (get("transactionsRoot", "transactions_root") as string) || undefined,
      receiptsRoot: (get("receiptsRoot", "receipts_root") as string) || undefined,
      indexedAt: get("indexedAt", "indexed_at")
        ? new Date(get("indexedAt", "indexed_at") as string | number)
        : undefined,
    } as Block;
  };

  const indexBlock = async (chainId: number, chainBlock: Record<string, unknown>): Promise<Block> => {
    const blockTimestamp = chainBlock.timestamp
      ? new Date(Number(chainBlock.timestamp) * 1000)
      : null;

    const values = {
      chainId,
      number: chainBlock.number?.toString() ?? "0",
      hash: chainBlock.hash as string,
      parentHash: (chainBlock.parentHash as string) ?? null,
      timestamp: blockTimestamp,
      miner: (chainBlock.miner as string) ?? null,
      gasLimit: chainBlock.gasLimit?.toString() ?? null,
      gasUsed: chainBlock.gasUsed?.toString() ?? null,
      baseFeePerGas: chainBlock.baseFeePerGas?.toString() ?? null,
      transactionCount: Array.isArray(chainBlock.transactions)
        ? chainBlock.transactions.length
        : 0,
      sizeBytes: chainBlock.size ? Number(chainBlock.size) : null,
      difficulty: chainBlock.difficulty?.toString() ?? null,
      totalDifficulty: chainBlock.totalDifficulty?.toString() ?? null,
      extraData: (chainBlock.extraData as string) ?? null,
      logsBloom: (chainBlock.logsBloom as string) ?? null,
      stateRoot: (chainBlock.stateRoot as string) ?? null,
      transactionsRoot: (chainBlock.transactionsRoot as string) ?? null,
      receiptsRoot: (chainBlock.receiptsRoot as string) ?? null,
    };

    await db
      .insert(blocks)
      .values(values as any)
      .onConflictDoUpdate({
        target: [blocks.chainId, blocks.number],
        set: values as any,
      });

    const inserted = await db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.chainId, chainId),
          eq(blocks.number, typeof chainBlock.number === "bigint" ? chainBlock.number : BigInt(Number(chainBlock.number) || 0))
        )
      )
      .limit(1);

    const row = inserted[0];
    if (!row) throw new Error("Failed to insert block");
    return formatBlock(row as Record<string, unknown>);
  };

  const service = {
    getLatestBlock: async (chainId: number): Promise<Block | null> => {
      const cacheKey = `latest-${chainId}`;

      try {
        const cached = blockCache.get(cacheKey);
        if (cached) {
          return cached as Block;
        }

        const dbQuery = retryableDb(async () => {
          return await db
            .select()
            .from(blocks)
            .where(eq(blocks.chainId, chainId))
            .orderBy(sql`${blocks.number} DESC`)
            .limit(1);
        });

        const dbResult = await dbQuery();

        if (dbResult.length > 0) {
          const row = dbResult[0] as Record<string, unknown>;
          const indexedAt = row.indexedAt ?? row.indexed_at;
          const cacheAge = indexedAt
            ? Date.now() - new Date(indexedAt as string | number).getTime()
            : Infinity;
          if (cacheAge < 30000) {
            const block = formatBlock(dbResult[0] as Record<string, unknown>);
            blockCache.set(cacheKey, block, 15000);
            return block;
          }
        }

        const fetchLatestBlock = retryableRpc(async () => {
          const client = await rpcManager.getClient(chainId);
          return await client.getBlock({ blockTag: "latest" });
        }, chainId);

        const latestBlock = await fetchLatestBlock();
        const block: Block = await indexBlock(chainId, latestBlock as Record<string, unknown>);

        blockCache.set(cacheKey, block, 15000);
        return block;
      } catch (error) {
        logErr(error, "BlockService.getLatestBlock", { chainId });
        throw new Error("Failed to fetch latest block");
      }
    },

    getBlockByNumber: async (
      chainId: number,
      blockNumber: bigint
    ): Promise<Block | null> => {
      try {
        const cached = await db
          .select()
          .from(blocks)
          .where(
            and(
              eq(blocks.chainId, chainId),
              eq(blocks.number, blockNumber)
            )
          )
          .limit(1);

        if (cached.length > 0) {
          return formatBlock(cached[0] as Record<string, unknown>);
        }

        const client = await rpcManager.getClient(chainId);
        const chainBlock = await client.getBlock({
          blockNumber,
          includeTransactions: false,
        });

        const block = await indexBlock(chainId, chainBlock as Record<string, unknown>);
        return block;
      } catch (error) {
        logErr(error, "BlockService.getBlockByNumber", { chainId, blockNumber: blockNumber.toString() });
        return null;
      }
    },

    getBlockByHash: async (
      chainId: number,
      blockHash: string
    ): Promise<Block | null> => {
      try {
        const cached = await db
          .select()
          .from(blocks)
          .where(
            and(
              eq(blocks.chainId, chainId),
              eq(blocks.hash, blockHash as `0x${string}`)
            )
          )
          .limit(1);

        if (cached.length > 0) {
          return formatBlock(cached[0] as Record<string, unknown>);
        }

        const client = await rpcManager.getClient(chainId);
        const chainBlock = await client.getBlock({
          blockHash: blockHash as `0x${string}`,
          includeTransactions: false,
        });

        const block = await indexBlock(chainId, chainBlock as Record<string, unknown>);
        return block;
      } catch (error) {
        logErr(error, "BlockService.getBlockByHash", { chainId, blockHash });
        return null;
      }
    },

    getBlocks: async (
      chainId: number,
      limit: number = 10,
      offset: number = 0
    ): Promise<{ blocks: Block[]; total: number }> => {
      try {
        const blockList = await db
          .select()
          .from(blocks)
          .where(eq(blocks.chainId, chainId))
          .orderBy(desc(blocks.number))
          .limit(limit)
          .offset(offset);

        const countResult = await db
          .select({ value: count() })
          .from(blocks)
          .where(eq(blocks.chainId, chainId));

        const total = countResult[0]?.value || 0;
        const formattedBlocks = blockList.map((b) => formatBlock(b as Record<string, unknown>));

        return { blocks: formattedBlocks, total };
      } catch (error) {
        logErr(error, "BlockService.getBlocks", { chainId });
        return { blocks: [], total: 0 };
      }
    },

    getLatestBlockNumber: async (chainId: number): Promise<bigint> => {
      try {
        const client = await rpcManager.getClient(chainId);
        return await client.getBlockNumber();
      } catch (error) {
        logger.error({ err: error }, "Failed to get latest block number");
        throw new Error("Failed to get latest block number");
      }
    },

    getBlockStats: async (chainId: number): Promise<{
      totalBlocks: number;
      latestBlock: bigint | null;
      avgBlockTime: number | null;
      avgGasUsed: string | null;
    }> => {
      try {
        const countResult = await db
          .select({ value: count() })
          .from(blocks)
          .where(eq(blocks.chainId, chainId));

        const latestResult = await db
          .select({ number: blocks.number })
          .from(blocks)
          .where(eq(blocks.chainId, chainId))
          .orderBy(desc(blocks.number))
          .limit(1);

        const recentBlocks = await db
          .select({
            number: blocks.number,
            timestamp: blocks.timestamp,
            gasUsed: blocks.gasUsed,
          })
          .from(blocks)
          .where(eq(blocks.chainId, chainId))
          .orderBy(desc(blocks.number))
          .limit(100);

        const totalBlocks = countResult[0]?.value || 0;
        const latestBlock = latestResult[0]?.number
          ? BigInt(latestResult[0].number)
          : null;

        let avgBlockTime: number | null = null;
        const blocksWithTimestamp = recentBlocks.filter((b) => b.timestamp != null);
        if (blocksWithTimestamp.length >= 2) {
          const timeDiffs: number[] = [];
          for (let i = 0; i < blocksWithTimestamp.length - 1; i++) {
            const current = new Date(blocksWithTimestamp[i].timestamp!);
            const next = new Date(blocksWithTimestamp[i + 1].timestamp!);
            const diff = (current.getTime() - next.getTime()) / 1000;
            timeDiffs.push(diff);
          }
          if (timeDiffs.length > 0) {
            avgBlockTime =
              timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
          }
        }

      let avgGasUsed: string | null = null;
      const gasValues = recentBlocks
        .map((block) => block.gasUsed)
        .filter((gas): gas is bigint => gas != null && gas !== 0n)
        .map((gas) => gas);

        if (gasValues.length > 0) {
          const totalGas = gasValues.reduce((a, b) => a + b, 0n);
          avgGasUsed = (totalGas / BigInt(gasValues.length)).toString();
        }

        return {
          totalBlocks,
          latestBlock,
          avgBlockTime,
          avgGasUsed,
        };
      } catch (error) {
        logErr(error, "BlockService.getBlockStats", { chainId });
        throw new Error("Failed to get block statistics");
      }
    },

    indexBlockRange: async (
      chainId: number,
      startBlock: bigint,
      endBlock: bigint,
      callback?: (progress: number) => void
    ): Promise<void> => {
      const total = Number(endBlock - startBlock) + 1;
      let processed = 0;

      for (let blockNum = startBlock; blockNum <= endBlock; blockNum++) {
        try {
          await service.getBlockByNumber(chainId, blockNum);
          processed++;

          if (callback) {
            callback((processed / total) * 100);
          }
        } catch (error) {
          logger.warn({ err: error, blockNum: blockNum.toString() }, "Failed to index block");
        }
      }
    },
  };

  return service;
};

export type BlockService = ReturnType<typeof createBlockService>;
export { createBlockService };

import { db, blocks } from "../database/init";
import { rpcManager } from "./RpcManager";
import { blockCache } from "../utils/cache";
import {
  createRetryableRpcCall,
  createRetryableDbCall,
  logError,
} from "../utils/errorHandler";

export const blockService = createBlockService({
  db,
  blocks,
  rpcManager,
  blockCache,
  createRetryableRpcCall,
  createRetryableDbCall,
  logError,
});
