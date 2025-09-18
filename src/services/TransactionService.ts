import { eq, desc, and, gte, lte, or } from "drizzle-orm";
import {
  db,
  transactions,
  blocks,
  type Transaction,
  type NewTransaction,
} from "@/server/database/drizzle";
import { RpcManager } from "./RpcManager";
import type {
  PaginationParams,
  ListResponse,
  BlockRangeParams,
} from "@/shared/types/index";

/**
 * 交易服务
 * 负责交易数据的获取、存储和管理
 */
export class TransactionService {
  constructor(private rpcManager: RpcManager) {}

  // 根据交易哈希获取交易
  async getTransactionByHash(
    chainId: number,
    txHash: string
  ): Promise<Transaction | null> {
    try {
      // 先从数据库查找
      const cachedTx = await db
        .select()
        .from(transactions)
        .where(
          and(eq(transactions.chainId, chainId), eq(transactions.hash, txHash))
        )
        .limit(1);

      if (cachedTx.length > 0) {
        return cachedTx[0];
      }

      // 数据库中没有，从RPC获取
      const transaction = await this.fetchAndStoreTransaction(chainId, txHash);
      return transaction;
    } catch (error) {
      console.error(`Failed to get transaction ${txHash}:`, error);
      return null;
    }
  }

  // 获取区块内的所有交易
  async getTransactionsByBlock(
    chainId: number,
    blockNumber: number,
    params: PaginationParams = {}
  ): Promise<ListResponse<Transaction>> {
    const { page = 1, limit = 20 } = params;
    const offset = (page - 1) * limit;

    try {
      const [txList, totalCount] = await Promise.all([
        db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              eq(transactions.blockNumber, BigInt(blockNumber))
            )
          )
          .orderBy(transactions.transactionIndex)
          .limit(limit)
          .offset(offset),

        db
          .select({ count: transactions.hash })
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              eq(transactions.blockNumber, BigInt(blockNumber))
            )
          ),
      ]);

      const total = totalCount.length;
      const totalPages = Math.ceil(total / limit);

      return {
        data: txList,
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
      console.error("Failed to get transactions by block:", error);
      throw new Error("Failed to retrieve transactions");
    }
  }

  // 获取地址相关的交易（发送或接收）
  async getTransactionsByAddress(
    chainId: number,
    address: string,
    params: PaginationParams = {}
  ): Promise<ListResponse<Transaction>> {
    const { page = 1, limit = 20 } = params;
    const offset = (page - 1) * limit;

    try {
      const [txList, totalCount] = await Promise.all([
        db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              or(
                eq(transactions.fromAddress, address),
                eq(transactions.toAddress, address)
              )
            )
          )
          .orderBy(desc(transactions.timestamp))
          .limit(limit)
          .offset(offset),

        db
          .select({ count: transactions.hash })
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              or(
                eq(transactions.fromAddress, address),
                eq(transactions.toAddress, address)
              )
            )
          ),
      ]);

      const total = totalCount.length;
      const totalPages = Math.ceil(total / limit);

      return {
        data: txList,
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
      console.error("Failed to get transactions by address:", error);
      throw new Error("Failed to retrieve transactions");
    }
  }

  // 获取最新交易列表
  async getLatestTransactions(
    chainId: number,
    params: PaginationParams = {}
  ): Promise<ListResponse<Transaction>> {
    const { page = 1, limit = 20 } = params;
    const offset = (page - 1) * limit;

    try {
      const [txList, totalCount] = await Promise.all([
        db
          .select()
          .from(transactions)
          .where(eq(transactions.chainId, chainId))
          .orderBy(desc(transactions.timestamp))
          .limit(limit)
          .offset(offset),

        db
          .select({ count: transactions.hash })
          .from(transactions)
          .where(eq(transactions.chainId, chainId)),
      ]);

      const total = totalCount.length;
      const totalPages = Math.ceil(total / limit);

      return {
        data: txList,
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
      console.error("Failed to get latest transactions:", error);
      throw new Error("Failed to retrieve transactions");
    }
  }

  // 根据区块范围获取交易
  async getTransactionsInRange(
    chainId: number,
    range: BlockRangeParams,
    params: PaginationParams = {}
  ): Promise<ListResponse<Transaction>> {
    const { fromBlock, toBlock } = range;
    const { page = 1, limit = 20 } = params;
    const offset = (page - 1) * limit;

    try {
      let query = db
        .select()
        .from(transactions)
        .where(eq(transactions.chainId, chainId));

      // 应用区块范围过滤
      if (fromBlock !== undefined) {
        query = query.where(
          and(
            eq(transactions.chainId, chainId),
            gte(transactions.blockNumber, BigInt(fromBlock))
          )
        );
      }
      if (toBlock !== undefined) {
        query = query.where(
          and(
            eq(transactions.chainId, chainId),
            lte(transactions.blockNumber, BigInt(toBlock))
          )
        );
      }

      const [txList, totalCount] = await Promise.all([
        query.orderBy(desc(transactions.timestamp)).limit(limit).offset(offset),
        db
          .select({ count: transactions.hash })
          .from(transactions)
          .where(eq(transactions.chainId, chainId)),
      ]);

      const total = totalCount.length;
      const totalPages = Math.ceil(total / limit);

      return {
        data: txList,
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
      console.error("Failed to get transactions in range:", error);
      throw new Error("Failed to retrieve transactions in range");
    }
  }

  // 从RPC获取并存储交易
  private async fetchAndStoreTransaction(
    chainId: number,
    txHash: string
  ): Promise<Transaction> {
    try {
      const client = await this.rpcManager.getClient(chainId);

      // 获取交易详情和收据
      const [viemTx, viemReceipt] = await Promise.all([
        client.getTransaction({ hash: txHash as `0x${string}` }),
        client
          .getTransactionReceipt({ hash: txHash as `0x${string}` })
          .catch(() => null),
      ]);

      // 获取区块时间戳
      let timestamp: Date | null = null;
      if (viemTx.blockNumber) {
        const block = await client.getBlock({
          blockNumber: viemTx.blockNumber,
        });
        timestamp = new Date(Number(block.timestamp) * 1000);
      }

      return await this.storeTransaction(
        chainId,
        viemTx,
        viemReceipt,
        timestamp
      );
    } catch (error) {
      console.error(`Failed to fetch transaction ${txHash}:`, error);
      throw new Error(`Failed to fetch transaction ${txHash} from RPC`);
    }
  }

  // 存储交易到数据库
  private async storeTransaction(
    chainId: number,
    viemTx: any,
    viemReceipt: any = null,
    timestamp: Date | null = null
  ): Promise<Transaction> {
    try {
      const txData: NewTransaction = {
        chainId,
        hash: viemTx.hash,
        blockNumber: viemTx.blockNumber,
        transactionIndex: viemTx.transactionIndex,
        fromAddress: viemTx.from,
        toAddress: viemTx.to || null,
        value: viemTx.value?.toString() || "0",
        gasLimit: viemTx.gas || viemTx.gasLimit,
        gasPrice: viemTx.gasPrice || null,
        maxFeePerGas: viemTx.maxFeePerGas || null,
        maxPriorityFeePerGas: viemTx.maxPriorityFeePerGas || null,
        gasUsed: viemReceipt?.gasUsed || null,
        effectiveGasPrice: viemReceipt?.effectiveGasPrice || null,
        status: viemReceipt?.status
          ? viemReceipt.status === "success"
            ? 1
            : 0
          : null,
        type: viemTx.type ? Number(viemTx.type) : 0,
        nonce: viemTx.nonce,
        inputData: viemTx.input || null,
        logsCount: viemReceipt?.logs?.length || 0,
        contractAddress: viemReceipt?.contractAddress || null,
        cumulativeGasUsed: viemReceipt?.cumulativeGasUsed || null,
        timestamp,
      };

      const [insertedTx] = await db
        .insert(transactions)
        .values(txData)
        .onConflictDoUpdate({
          target: [transactions.chainId, transactions.hash],
          set: {
            gasUsed: txData.gasUsed,
            effectiveGasPrice: txData.effectiveGasPrice,
            status: txData.status,
            logsCount: txData.logsCount,
            contractAddress: txData.contractAddress,
            cumulativeGasUsed: txData.cumulativeGasUsed,
            indexedAt: new Date(),
          },
        })
        .returning();

      return insertedTx;
    } catch (error) {
      console.error("Failed to store transaction:", error);
      throw new Error("Failed to store transaction");
    }
  }

  // 批量存储交易（用于区块同步）
  async storeTransactions(
    chainId: number,
    viemTxs: any[],
    blockTimestamp: Date
  ): Promise<Transaction[]> {
    try {
      const txDataList: NewTransaction[] = viemTxs.map((viemTx) => ({
        chainId,
        hash: viemTx.hash,
        blockNumber: viemTx.blockNumber,
        transactionIndex: viemTx.transactionIndex,
        fromAddress: viemTx.from,
        toAddress: viemTx.to || null,
        value: viemTx.value?.toString() || "0",
        gasLimit: viemTx.gas || viemTx.gasLimit,
        gasPrice: viemTx.gasPrice || null,
        maxFeePerGas: viemTx.maxFeePerGas || null,
        maxPriorityFeePerGas: viemTx.maxPriorityFeePerGas || null,
        type: viemTx.type ? Number(viemTx.type) : 0,
        nonce: viemTx.nonce,
        inputData: viemTx.input || null,
        timestamp: blockTimestamp,
        // 注意：批量插入时没有receipt信息，需要后续补充
      }));

      const insertedTxs = await db
        .insert(transactions)
        .values(txDataList)
        .onConflictDoNothing() // 避免重复插入
        .returning();

      return insertedTxs;
    } catch (error) {
      console.error("Failed to store transactions:", error);
      throw new Error("Failed to store transactions");
    }
  }

  // 获取交易统计信息
  async getTransactionStats(chainId: number): Promise<{
    totalTransactions: number;
    avgGasPrice: string | null;
    avgGasUsed: string | null;
    successRate: number | null;
  }> {
    try {
      const [countResult, priceResult, gasResult, statusResult] =
        await Promise.all([
          db
            .select({ count: transactions.hash })
            .from(transactions)
            .where(eq(transactions.chainId, chainId)),

          db
            .select({ gasPrice: transactions.gasPrice })
            .from(transactions)
            .where(eq(transactions.chainId, chainId))
            .limit(1000), // 最近1000笔交易

          db
            .select({ gasUsed: transactions.gasUsed })
            .from(transactions)
            .where(eq(transactions.chainId, chainId))
            .limit(1000),

          db
            .select({ status: transactions.status })
            .from(transactions)
            .where(eq(transactions.chainId, chainId))
            .limit(1000),
        ]);

      const totalTransactions = countResult.length;

      // 计算平均Gas价格
      let avgGasPrice: string | null = null;
      const gasPrices = priceResult
        .map((tx) => tx.gasPrice)
        .filter((price) => price !== null) as bigint[];

      if (gasPrices.length > 0) {
        const totalGasPrice = gasPrices.reduce((a, b) => a + b, 0n);
        avgGasPrice = (totalGasPrice / BigInt(gasPrices.length)).toString();
      }

      // 计算平均Gas使用量
      let avgGasUsed: string | null = null;
      const gasUsages = gasResult
        .map((tx) => tx.gasUsed)
        .filter((gas) => gas !== null) as bigint[];

      if (gasUsages.length > 0) {
        const totalGasUsed = gasUsages.reduce((a, b) => a + b, 0n);
        avgGasUsed = (totalGasUsed / BigInt(gasUsages.length)).toString();
      }

      // 计算成功率
      let successRate: number | null = null;
      const statuses = statusResult
        .map((tx) => tx.status)
        .filter((status) => status !== null);

      if (statuses.length > 0) {
        const successCount = statuses.filter((status) => status === 1).length;
        successRate = (successCount / statuses.length) * 100;
      }

      return {
        totalTransactions,
        avgGasPrice,
        avgGasUsed,
        successRate,
      };
    } catch (error) {
      console.error("Failed to get transaction stats:", error);
      throw new Error("Failed to get transaction statistics");
    }
  }

  // 地址交易历史简化查询（基于平衡变化的二分查找）
  async getAddressTransactionHistory(
    chainId: number,
    address: string,
    fromBlock?: number,
    toBlock?: number,
    maxAttempts = 10
  ): Promise<{
    transactions: Transaction[];
    isComplete: boolean;
    suggestion?: string;
  }> {
    try {
      const client = await this.rpcManager.getClient(chainId);

      // 获取当前区块号和交易数量
      const [currentBlock, txCount] = await Promise.all([
        client.getBlockNumber(),
        client.getTransactionCount({ address: address as `0x${string}` }),
      ]);

      const searchFromBlock =
        fromBlock || Math.max(0, Number(currentBlock) - 10000); // 默认搜索最近10000个区块
      const searchToBlock = toBlock || Number(currentBlock);

      // 如果交易数量很少，直接从数据库查询已索引的交易
      if (txCount <= 50) {
        const existingTxs = await this.getTransactionsByAddress(
          chainId,
          address,
          { limit: 100 }
        );
        return {
          transactions: existingTxs.data,
          isComplete: true,
        };
      }

      // 对于交易量大的地址，建议用户提供更精确的范围
      const suggestion =
        txCount > 1000
          ? "This address has many transactions. Please provide a specific block range or time period for better results."
          : undefined;

      // 从数据库中查询指定范围内的交易
      const rangeQuery = and(
        eq(transactions.chainId, chainId),
        or(
          eq(transactions.fromAddress, address),
          eq(transactions.toAddress, address)
        ),
        gte(transactions.blockNumber, BigInt(searchFromBlock)),
        lte(transactions.blockNumber, BigInt(searchToBlock))
      );

      const foundTxs = await db
        .select()
        .from(transactions)
        .where(rangeQuery)
        .orderBy(desc(transactions.timestamp))
        .limit(100);

      return {
        transactions: foundTxs,
        isComplete: foundTxs.length < 100, // 如果查到的结果少于限制，认为是完整的
        suggestion,
      };
    } catch (error) {
      console.error("Failed to get address transaction history:", error);
      throw new Error("Failed to get address transaction history");
    }
  }
}
