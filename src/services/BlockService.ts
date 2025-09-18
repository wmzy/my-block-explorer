import { eq, desc, and, gte, lte, asc } from "drizzle-orm";
import {
  db,
  blocks,
  transactions,
  type Block,
  type NewBlock,
} from "@/server/database/drizzle";
import { RpcManager } from "./RpcManager";
import type {
  PaginationParams,
  ListResponse,
  BlockRangeParams,
} from "@/shared/types/index";

/**
 * 区块服务
 * 负责区块数据的获取、存储和管理
 */
export class BlockService {
  constructor(private rpcManager: RpcManager) {}

  // 获取最新区块列表
  async getLatestBlocks(
    chainId: number,
    params: PaginationParams = {}
  ): Promise<ListResponse<Block>> {
    const { page = 1, limit = 20 } = params;
    const offset = (page - 1) * limit;

    try {
      // 从数据库获取
      const [blockList, totalCount] = await Promise.all([
        db
          .select()
          .from(blocks)
          .where(eq(blocks.chainId, chainId))
          .orderBy(desc(blocks.number))
          .limit(limit)
          .offset(offset),

        db
          .select({ count: blocks.number })
          .from(blocks)
          .where(eq(blocks.chainId, chainId)),
      ]);

      const total = totalCount.length;
      const totalPages = Math.ceil(total / limit);

      return {
        data: blockList,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      console.error("Failed to get latest blocks:", error);
      throw new Error("Failed to retrieve blocks");
    }
  }

  // 根据区块号获取区块
  async getBlockByNumber(
    chainId: number,
    blockNumber: number
  ): Promise<Block | null> {
    try {
      // 先从数据库查找
      const cachedBlock = await db
        .select()
        .from(blocks)
        .where(
          and(
            eq(blocks.chainId, chainId),
            eq(blocks.number, BigInt(blockNumber))
          )
        )
        .limit(1);

      if (cachedBlock.length > 0) {
        return cachedBlock[0];
      }

      // 数据库中没有，从RPC获取
      const block = await this.fetchAndStoreBlock(chainId, blockNumber);
      return block;
    } catch (error) {
      console.error(`Failed to get block ${blockNumber}:`, error);
      throw new Error(`Failed to retrieve block ${blockNumber}`);
    }
  }

  // 根据区块哈希获取区块
  async getBlockByHash(
    chainId: number,
    blockHash: string
  ): Promise<Block | null> {
    try {
      // 先从数据库查找
      const cachedBlock = await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.chainId, chainId), eq(blocks.hash, blockHash)))
        .limit(1);

      if (cachedBlock.length > 0) {
        return cachedBlock[0];
      }

      // 数据库中没有，从RPC获取
      const client = await this.rpcManager.getClient(chainId);
      const viemBlock = await client.getBlock({
        blockHash: blockHash as `0x${string}`,
      });

      const block = await this.storeBlock(chainId, viemBlock);
      return block;
    } catch (error) {
      console.error(`Failed to get block by hash ${blockHash}:`, error);
      throw new Error(`Failed to retrieve block by hash`);
    }
  }

  // 获取区块范围内的所有区块
  async getBlocksInRange(
    chainId: number,
    range: BlockRangeParams,
    params: PaginationParams = {}
  ): Promise<ListResponse<Block>> {
    const { fromBlock, toBlock } = range;
    const { page = 1, limit = 20 } = params;
    const offset = (page - 1) * limit;

    try {
      let query = db.select().from(blocks).where(eq(blocks.chainId, chainId));

      // 应用区块范围过滤
      if (fromBlock !== undefined) {
        query = query.where(
          and(
            eq(blocks.chainId, chainId),
            gte(blocks.number, BigInt(fromBlock))
          )
        );
      }
      if (toBlock !== undefined) {
        query = query.where(
          and(eq(blocks.chainId, chainId), lte(blocks.number, BigInt(toBlock)))
        );
      }

      const [blockList, totalCount] = await Promise.all([
        query.orderBy(desc(blocks.number)).limit(limit).offset(offset),
        db
          .select({ count: blocks.number })
          .from(blocks)
          .where(eq(blocks.chainId, chainId)),
      ]);

      const total = totalCount.length;
      const totalPages = Math.ceil(total / limit);

      return {
        data: blockList,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      console.error("Failed to get blocks in range:", error);
      throw new Error("Failed to retrieve blocks in range");
    }
  }

  // 获取最新区块号（从RPC）
  async getLatestBlockNumber(chainId: number): Promise<number> {
    try {
      const client = await this.rpcManager.getClient(chainId);
      const blockNumber = await client.getBlockNumber();
      return Number(blockNumber);
    } catch (error) {
      console.error("Failed to get latest block number:", error);
      throw new Error("Failed to get latest block number");
    }
  }

  // 从RPC获取并存储区块
  private async fetchAndStoreBlock(
    chainId: number,
    blockNumber: number
  ): Promise<Block> {
    try {
      const client = await this.rpcManager.getClient(chainId);
      const viemBlock = await client.getBlock({
        blockNumber: BigInt(blockNumber),
        includeTransactions: false, // 不包含完整交易数据，只要数量
      });

      return await this.storeBlock(chainId, viemBlock);
    } catch (error) {
      console.error(`Failed to fetch block ${blockNumber}:`, error);
      throw new Error(`Failed to fetch block ${blockNumber} from RPC`);
    }
  }

  // 存储区块到数据库
  private async storeBlock(chainId: number, viemBlock: any): Promise<Block> {
    try {
      const blockData: NewBlock = {
        chainId,
        number: viemBlock.number,
        hash: viemBlock.hash,
        parentHash: viemBlock.parentHash,
        timestamp: viemBlock.timestamp
          ? new Date(Number(viemBlock.timestamp) * 1000)
          : null,
        miner: viemBlock.miner || null,
        gasLimit: viemBlock.gasLimit,
        gasUsed: viemBlock.gasUsed,
        baseFeePerGas: viemBlock.baseFeePerGas || null,
        transactionCount: viemBlock.transactions?.length || 0,
        sizeBytes: viemBlock.size ? Number(viemBlock.size) : null,
        difficulty: viemBlock.difficulty?.toString() || null,
        totalDifficulty: viemBlock.totalDifficulty?.toString() || null,
        extraData: viemBlock.extraData || null,
        logsBloom: viemBlock.logsBloom || null,
        stateRoot: viemBlock.stateRoot || null,
        transactionsRoot: viemBlock.transactionsRoot || null,
        receiptsRoot: viemBlock.receiptsRoot || null,
      };

      const [insertedBlock] = await db
        .insert(blocks)
        .values(blockData)
        .onConflictDoUpdate({
          target: [blocks.chainId, blocks.number],
          set: {
            gasUsed: blockData.gasUsed,
            baseFeePerGas: blockData.baseFeePerGas,
            transactionCount: blockData.transactionCount,
            indexedAt: new Date(),
          },
        })
        .returning();

      return insertedBlock;
    } catch (error) {
      console.error("Failed to store block:", error);
      throw new Error("Failed to store block");
    }
  }

  // 批量存储区块（用于初始同步）
  async storeBlocks(chainId: number, viemBlocks: any[]): Promise<Block[]> {
    try {
      const blockDataList: NewBlock[] = viemBlocks.map((viemBlock) => ({
        chainId,
        number: viemBlock.number,
        hash: viemBlock.hash,
        parentHash: viemBlock.parentHash,
        timestamp: viemBlock.timestamp
          ? new Date(Number(viemBlock.timestamp) * 1000)
          : null,
        miner: viemBlock.miner || null,
        gasLimit: viemBlock.gasLimit,
        gasUsed: viemBlock.gasUsed,
        baseFeePerGas: viemBlock.baseFeePerGas || null,
        transactionCount: viemBlock.transactions?.length || 0,
        sizeBytes: viemBlock.size ? Number(viemBlock.size) : null,
        difficulty: viemBlock.difficulty?.toString() || null,
        totalDifficulty: viemBlock.totalDifficulty?.toString() || null,
        extraData: viemBlock.extraData || null,
        logsBloom: viemBlock.logsBloom || null,
        stateRoot: viemBlock.stateRoot || null,
        transactionsRoot: viemBlock.transactionsRoot || null,
        receiptsRoot: viemBlock.receiptsRoot || null,
      }));

      const insertedBlocks = await db
        .insert(blocks)
        .values(blockDataList)
        .onConflictDoNothing() // 避免重复插入
        .returning();

      return insertedBlocks;
    } catch (error) {
      console.error("Failed to store blocks:", error);
      throw new Error("Failed to store blocks");
    }
  }

  // 获取已索引的区块数量
  async getIndexedBlockCount(chainId: number): Promise<number> {
    try {
      const result = await db
        .select({ count: blocks.number })
        .from(blocks)
        .where(eq(blocks.chainId, chainId));

      return result.length;
    } catch (error) {
      console.error("Failed to get indexed block count:", error);
      return 0;
    }
  }

  // 获取区块统计信息
  async getBlockStats(chainId: number): Promise<{
    totalBlocks: number;
    latestBlock: number | null;
    avgBlockTime: number | null;
    avgGasUsed: string | null;
  }> {
    try {
      const [countResult, latestResult, timeResult] = await Promise.all([
        db
          .select({ count: blocks.number })
          .from(blocks)
          .where(eq(blocks.chainId, chainId)),
        db
          .select({ number: blocks.number })
          .from(blocks)
          .where(eq(blocks.chainId, chainId))
          .orderBy(desc(blocks.number))
          .limit(1),
        db
          .select({
            timestamp: blocks.timestamp,
            number: blocks.number,
            gasUsed: blocks.gasUsed,
          })
          .from(blocks)
          .where(eq(blocks.chainId, chainId))
          .orderBy(desc(blocks.number))
          .limit(100), // 使用最近100个区块计算平均值
      ]);

      const totalBlocks = countResult.length;
      const latestBlock = latestResult[0]?.number
        ? Number(latestResult[0].number)
        : null;

      // 计算平均出块时间
      let avgBlockTime: number | null = null;
      if (timeResult.length >= 2) {
        const timeDiffs: number[] = [];
        for (let i = 0; i < timeResult.length - 1; i++) {
          const current = timeResult[i];
          const next = timeResult[i + 1];
          if (current.timestamp && next.timestamp) {
            const diff =
              (current.timestamp.getTime() - next.timestamp.getTime()) / 1000;
            timeDiffs.push(diff);
          }
        }
        if (timeDiffs.length > 0) {
          avgBlockTime =
            timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
        }
      }

      // 计算平均Gas使用量
      let avgGasUsed: string | null = null;
      const gasValues = timeResult
        .map((block) => block.gasUsed)
        .filter((gas) => gas !== null) as bigint[];

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
      console.error("Failed to get block stats:", error);
      throw new Error("Failed to get block statistics");
    }
  }
}
