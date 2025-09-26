import { PublicClient } from "viem";
import { db, blocks } from "../database/init";
import { eq, and, sql } from "drizzle-orm";
import { rpcManager } from "./RpcManager";
import { blockCache } from "../utils/cache";
import {
  createRetryableRpcCall,
  createRetryableDbCall,
  logError,
} from "../utils/errorHandler";

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

/**
 * 区块服务
 * 负责获取和索引区块数据
 */
export class BlockService {
  // 获取最新区块
  async getLatestBlock(chainId: number): Promise<Block | null> {
    const cacheKey = `latest-${chainId}`;

    try {
      // 先从内存缓存获取
      const cached = blockCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      // 从数据库获取
      const dbQuery = createRetryableDbCall(async () => {
        return await db
          .select()
          .from(blocks)
          .where(eq(blocks.chainId, chainId))
          .orderBy(sql`${blocks.number} DESC`)
          .limit(1);
      });

      const dbResult = await dbQuery();

      if (dbResult.length > 0) {
        // 检查数据库缓存是否过期（超过30秒）
        const cacheAge =
          Date.now() - new Date(dbResult[0].indexed_at).getTime();
        if (cacheAge < 30000) {
          const block = this.formatBlock(dbResult[0]);
          blockCache.set(cacheKey, block, 15000); // 缓存15秒
          return block;
        }
      }

      // 从链上获取最新区块
      const fetchLatestBlock = createRetryableRpcCall(async () => {
        const client = await rpcManager.getClient(chainId);
        return await client.getBlock({ blockTag: "latest" });
      }, chainId);

      const latestBlock = await fetchLatestBlock();
      const block = await this.indexBlock(chainId, latestBlock);

      // 缓存结果
      blockCache.set(cacheKey, block, 15000); // 缓存15秒
      return block;
    } catch (error) {
      logError(error, "BlockService.getLatestBlock", { chainId });
      throw new Error("Failed to fetch latest block");
    }
  }

  // 根据区块号获取区块
  async getBlockByNumber(
    chainId: number,
    blockNumber: bigint
  ): Promise<Block | null> {
    try {
      // 先从数据库获取
      const cached = await db.query<any>(
        `
        SELECT * FROM blocks 
        WHERE chain_id = ? AND number = ?
        LIMIT 1
      `,
        [chainId, blockNumber.toString()]
      );

      if (cached.length > 0) {
        return this.formatBlock(cached[0]);
      }

      // 从链上获取
      const client = await rpcManager.getClient(chainId);
      const chainBlock = await client.getBlock({
        blockNumber,
        includeTransactions: false,
      });

      const block = await this.indexBlock(chainId, chainBlock);
      return block;
    } catch (error) {
      console.error(`Failed to get block ${blockNumber}:`, error);
      return null;
    }
  }

  // 根据区块哈希获取区块
  async getBlockByHash(
    chainId: number,
    blockHash: string
  ): Promise<Block | null> {
    try {
      // 先从数据库获取
      const cached = await db.query<any>(
        `
        SELECT * FROM blocks 
        WHERE chain_id = ? AND hash = ?
        LIMIT 1
      `,
        [chainId, blockHash]
      );

      if (cached.length > 0) {
        return this.formatBlock(cached[0]);
      }

      // 从链上获取
      const client = await rpcManager.getClient(chainId);
      const chainBlock = await client.getBlock({
        blockHash: blockHash as `0x${string}`,
        includeTransactions: false,
      });

      const block = await this.indexBlock(chainId, chainBlock);
      return block;
    } catch (error) {
      console.error(`Failed to get block ${blockHash}:`, error);
      return null;
    }
  }

  // 获取区块列表
  async getBlocks(
    chainId: number,
    limit: number = 10,
    offset: number = 0
  ): Promise<{ blocks: Block[]; total: number }> {
    try {
      const blockList = await db.query<any>(
        `
        SELECT * FROM blocks 
        WHERE chain_id = ? 
        ORDER BY number DESC 
        LIMIT ? OFFSET ?
      `,
        [chainId, limit, offset]
      );

      // 获取总数
      const countResult = await db.query<{ count: number }>(
        `
        SELECT COUNT(*) as count FROM blocks WHERE chain_id = ?
      `,
        [chainId]
      );

      const total = countResult[0]?.count || 0;
      const blocks = blockList.map((b) => this.formatBlock(b));

      return { blocks, total };
    } catch (error) {
      console.error("Failed to get blocks:", error);
      return { blocks: [], total: 0 };
    }
  }

  // 获取最新区块号
  async getLatestBlockNumber(chainId: number): Promise<bigint> {
    try {
      const client = await rpcManager.getClient(chainId);
      return await client.getBlockNumber();
    } catch (error) {
      console.error("Failed to get latest block number:", error);
      throw new Error("Failed to get latest block number");
    }
  }

  // 获取区块统计信息
  async getBlockStats(chainId: number): Promise<{
    totalBlocks: number;
    latestBlock: bigint | null;
    avgBlockTime: number | null;
    avgGasUsed: string | null;
  }> {
    try {
      // 获取总区块数
      const countResult = await db.query<{ count: number }>(
        `
        SELECT COUNT(*) as count FROM blocks WHERE chain_id = ?
      `,
        [chainId]
      );

      // 获取最新区块
      const latestResult = await db.query<{ number: string }>(
        `
        SELECT number FROM blocks 
        WHERE chain_id = ? 
        ORDER BY number DESC 
        LIMIT 1
      `,
        [chainId]
      );

      // 获取最近100个区块用于计算统计信息
      const recentBlocks = await db.query<{
        number: string;
        timestamp: string;
        gas_used: string;
      }>(
        `
        SELECT number, timestamp, gas_used 
        FROM blocks 
        WHERE chain_id = ? AND timestamp IS NOT NULL
        ORDER BY number DESC 
        LIMIT 100
      `,
        [chainId]
      );

      const totalBlocks = countResult[0]?.count || 0;
      const latestBlock = latestResult[0]?.number
        ? BigInt(latestResult[0].number)
        : null;

      // 计算平均出块时间
      let avgBlockTime: number | null = null;
      if (recentBlocks.length >= 2) {
        const timeDiffs: number[] = [];
        for (let i = 0; i < recentBlocks.length - 1; i++) {
          const current = new Date(recentBlocks[i].timestamp);
          const next = new Date(recentBlocks[i + 1].timestamp);
          const diff = (current.getTime() - next.getTime()) / 1000;
          timeDiffs.push(diff);
        }
        if (timeDiffs.length > 0) {
          avgBlockTime =
            timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
        }
      }

      // 计算平均Gas使用量
      let avgGasUsed: string | null = null;
      const gasValues = recentBlocks
        .map((block) => block.gas_used)
        .filter((gas) => gas && gas !== "0")
        .map((gas) => BigInt(gas));

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

  // 索引区块到数据库
  private async indexBlock(chainId: number, chainBlock: any): Promise<Block> {
    const timestamp = chainBlock.timestamp
      ? new Date(Number(chainBlock.timestamp) * 1000).toISOString()
      : null;

    // 使用参数化查询避免SQL注入
    await db.query(
      `
      INSERT OR REPLACE INTO blocks (
        chain_id, number, hash, parent_hash, timestamp, miner,
        gas_limit, gas_used, base_fee_per_gas, transaction_count,
        size_bytes, difficulty, total_difficulty, extra_data,
        logs_bloom, state_root, transactions_root, receipts_root,
        indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        chainId,
        chainBlock.number?.toString() || null,
        chainBlock.hash,
        chainBlock.parentHash || null,
        timestamp,
        chainBlock.miner || null,
        chainBlock.gasLimit?.toString() || null,
        chainBlock.gasUsed?.toString() || null,
        chainBlock.baseFeePerGas?.toString() || null,
        chainBlock.transactions?.length || 0,
        chainBlock.size ? Number(chainBlock.size) : null,
        chainBlock.difficulty?.toString() || null,
        chainBlock.totalDifficulty?.toString() || null,
        chainBlock.extraData || null,
        chainBlock.logsBloom || null,
        chainBlock.stateRoot || null,
        chainBlock.transactionsRoot || null,
        chainBlock.receiptsRoot || null,
        new Date().toISOString(),
      ]
    );

    // 返回插入的数据
    const inserted = await db.query<any>(
      `
      SELECT * FROM blocks 
      WHERE chain_id = ? AND number = ?
      LIMIT 1
    `,
      [chainId, chainBlock.number?.toString()]
    );

    return this.formatBlock(inserted[0]);
  }

  // 格式化区块数据
  private formatBlock(dbBlock: any): Block {
    return {
      chainId: dbBlock.chain_id,
      number: BigInt(dbBlock.number || 0),
      hash: dbBlock.hash,
      parentHash: dbBlock.parent_hash || undefined,
      timestamp: dbBlock.timestamp ? new Date(dbBlock.timestamp) : undefined,
      miner: dbBlock.miner || undefined,
      gasLimit: dbBlock.gas_limit ? BigInt(dbBlock.gas_limit) : undefined,
      gasUsed: dbBlock.gas_used ? BigInt(dbBlock.gas_used) : undefined,
      baseFeePerGas: dbBlock.base_fee_per_gas
        ? BigInt(dbBlock.base_fee_per_gas)
        : undefined,
      transactionCount: dbBlock.transaction_count || undefined,
      sizeBytes: dbBlock.size_bytes || undefined,
      difficulty: dbBlock.difficulty || undefined,
      totalDifficulty: dbBlock.total_difficulty || undefined,
      extraData: dbBlock.extra_data || undefined,
      logsBloom: dbBlock.logs_bloom || undefined,
      stateRoot: dbBlock.state_root || undefined,
      transactionsRoot: dbBlock.transactions_root || undefined,
      receiptsRoot: dbBlock.receipts_root || undefined,
      indexedAt: dbBlock.indexed_at ? new Date(dbBlock.indexed_at) : undefined,
    };
  }

  // 批量索引区块
  async indexBlockRange(
    chainId: number,
    startBlock: bigint,
    endBlock: bigint,
    callback?: (progress: number) => void
  ): Promise<void> {
    const total = Number(endBlock - startBlock) + 1;
    let processed = 0;

    for (let blockNum = startBlock; blockNum <= endBlock; blockNum++) {
      try {
        await this.getBlockByNumber(chainId, blockNum);
        processed++;

        if (callback) {
          callback((processed / total) * 100);
        }
      } catch (error) {
        console.warn(`Failed to index block ${blockNum}:`, error);
      }
    }
  }
}

// 导出全局实例
export const blockService = new BlockService();
