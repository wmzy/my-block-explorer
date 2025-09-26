import { db, transactions, blocks } from "../database/init";
import { eq, and, sql } from "drizzle-orm";
import { rpcManager } from "./RpcManager";
import { formatAddress } from "../utils/address";
import type { Address } from "viem";

/**
 * 交易数据类型
 */
export type Transaction = {
  chainId: number;
  hash: string;
  blockNumber?: bigint;
  transactionIndex?: number;
  fromAddress?: Address;
  toAddress?: Address;
  value?: string;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
  status?: number;
  type?: number;
  nonce?: bigint;
  inputData?: string;
  logsCount?: number;
  contractAddress?: string;
  cumulativeGasUsed?: bigint;
  timestamp?: Date;
  indexedAt?: Date;
};

/**
 * 交易服务
 * 负责获取和索引交易数据
 */
export class TransactionService {
  // 根据交易哈希获取交易
  async getTransactionByHash(
    chainId: number,
    txHash: string
  ): Promise<Transaction | null> {
    try {
      // 先从数据库获取
      const cached = await db
        .select()
        .from(transactions)
        .where(
          and(eq(transactions.chainId, chainId), eq(transactions.hash, txHash))
        )
        .limit(1);

      if (cached.length > 0) {
        return this.formatTransaction(cached[0]);
      }

      // 从链上获取
      const client = await rpcManager.getClient(chainId);
      const [tx, receipt] = await Promise.all([
        client.getTransaction({ hash: txHash as `0x${string}` }),
        client
          .getTransactionReceipt({ hash: txHash as `0x${string}` })
          .catch(() => null),
      ]);

      const transaction = await this.indexTransaction(chainId, tx, receipt);
      return transaction;
    } catch (error) {
      console.error(`Failed to get transaction ${txHash}:`, error);
      return null;
    }
  }

  // 获取区块中的所有交易
  async getTransactionsByBlockNumber(
    chainId: number,
    blockNumber: bigint,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ transactions: Transaction[]; total: number }> {
    try {
      // 先从数据库获取
      const txResults = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.chainId, chainId),
            eq(transactions.blockNumber, blockNumber)
          )
        )
        .orderBy(transactions.transactionIndex)
        .limit(limit)
        .offset(offset);

      // 获取总数
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.chainId, chainId),
            eq(transactions.blockNumber, blockNumber)
          )
        );

      const total = countResult[0]?.count || 0;

      // 如果数据库中没有交易，尝试从链上获取
      if (txResults.length === 0 && offset === 0) {
        await this.indexBlockTransactions(chainId, blockNumber);

        // 重新查询
        const newTransactions = await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              eq(transactions.blockNumber, blockNumber)
            )
          )
          .orderBy(transactions.transactionIndex)
          .limit(limit)
          .offset(offset);

        return {
          transactions: newTransactions.map((tx) => this.formatTransaction(tx)),
          total: newTransactions.length,
        };
      }

      return {
        transactions: txResults.map((tx) => this.formatTransaction(tx)),
        total,
      };
    } catch (error) {
      console.error(
        `Failed to get transactions for block ${blockNumber}:`,
        error
      );
      return { transactions: [], total: 0 };
    }
  }

  // 获取地址相关的交易
  async getTransactionsByAddress(
    chainId: number,
    address: Address,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ transactions: Transaction[]; total: number }> {
    try {
      const txResults = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.chainId, chainId),
            sql`(${transactions.fromAddress} = ${address} OR ${transactions.toAddress} = ${address})`
          )
        )
        .orderBy(
          sql`${transactions.timestamp} DESC, ${transactions.blockNumber} DESC, ${transactions.transactionIndex} DESC`
        )
        .limit(limit)
        .offset(offset);

      // 获取总数
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.chainId, chainId),
            sql`(${transactions.fromAddress} = ${address} OR ${transactions.toAddress} = ${address})`
          )
        );

      const total = countResult[0]?.count || 0;

      return {
        transactions: txResults.map((tx) => this.formatTransaction(tx)),
        total,
      };
    } catch (error) {
      console.error(
        `Failed to get transactions for address ${address}:`,
        error
      );
      return { transactions: [], total: 0 };
    }
  }

  // 获取最新交易
  async getLatestTransactions(
    chainId: number,
    limit: number = 20
  ): Promise<Transaction[]> {
    try {
      const txResults = await db
        .select()
        .from(transactions)
        .where(eq(transactions.chainId, chainId))
        .orderBy(
          sql`${transactions.timestamp} DESC, ${transactions.blockNumber} DESC, ${transactions.transactionIndex} DESC`
        )
        .limit(limit);

      return txResults.map((tx) => this.formatTransaction(tx));
    } catch (error) {
      console.error("Failed to get latest transactions:", error);
      return [];
    }
  }

  // 获取交易统计信息
  async getTransactionStats(chainId: number): Promise<{
    totalTransactions: number;
    avgGasPrice: string | null;
    avgGasUsed: string | null;
    successRate: number;
  }> {
    try {
      // 获取总交易数
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(eq(transactions.chainId, chainId));

      // 获取最近1000个交易的统计信息
      const statsResult = await db
        .select({
          gasPrice: transactions.gasPrice,
          gasUsed: transactions.gasUsed,
          status: transactions.status,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.chainId, chainId),
            sql`${transactions.gasPrice} IS NOT NULL AND ${transactions.gasUsed} IS NOT NULL`
          )
        )
        .orderBy(sql`${transactions.timestamp} DESC`)
        .limit(1000);

      const totalTransactions = countResult[0]?.count || 0;

      // 计算平均Gas价格
      let avgGasPrice: string | null = null;
      const gasPrices = statsResult
        .map((tx) => tx.gasPrice)
        .filter((price) => price && price !== 0n)
        .map((price) => price);

      if (gasPrices.length > 0) {
        const totalGasPrice = gasPrices.reduce((a, b) => a + b, 0n);
        avgGasPrice = (totalGasPrice / BigInt(gasPrices.length)).toString();
      }

      // 计算平均Gas使用量
      let avgGasUsed: string | null = null;
      const gasUsedValues = statsResult
        .map((tx) => tx.gasUsed)
        .filter((gas) => gas && gas !== 0n)
        .map((gas) => gas);

      if (gasUsedValues.length > 0) {
        const totalGasUsed = gasUsedValues.reduce((a, b) => a + b, 0n);
        avgGasUsed = (totalGasUsed / BigInt(gasUsedValues.length)).toString();
      }

      // 计算成功率
      const successfulTxs = statsResult.filter((tx) => tx.status === 1).length;
      const successRate =
        statsResult.length > 0 ? (successfulTxs / statsResult.length) * 100 : 0;

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

  // 索引区块中的所有交易
  private async indexBlockTransactions(
    chainId: number,
    blockNumber: bigint
  ): Promise<void> {
    try {
      const client = await rpcManager.getClient(chainId);
      const block = await client.getBlock({
        blockNumber,
        includeTransactions: true,
      });

      if (!block.transactions || block.transactions.length === 0) {
        return;
      }

      // 获取所有交易的receipt
      const receipts = await Promise.all(
        block.transactions.map((tx) =>
          client
            .getTransactionReceipt({
              hash: typeof tx === "string" ? (tx as `0x${string}`) : tx.hash,
            })
            .catch(() => null)
        )
      );

      // 索引所有交易
      for (let i = 0; i < block.transactions.length; i++) {
        const tx = block.transactions[i];
        const receipt = receipts[i];

        if (typeof tx !== "string") {
          await this.indexTransaction(chainId, tx, receipt);
        }
      }
    } catch (error) {
      console.error(
        `Failed to index transactions for block ${blockNumber}:`,
        error
      );
    }
  }

  // 索引单个交易到数据库
  private async indexTransaction(
    chainId: number,
    tx: any,
    receipt?: any
  ): Promise<Transaction> {
    const timestamp = receipt?.blockNumber
      ? await this.getBlockTimestamp(chainId, BigInt(receipt.blockNumber))
      : null;

    const transactionData = {
      chainId,
      hash: tx.hash,
      blockNumber: tx.blockNumber ? BigInt(tx.blockNumber) : null,
      transactionIndex: tx.transactionIndex || null,
      fromAddress: tx.from || null,
      toAddress: tx.to || null,
      value: tx.value ? BigInt(tx.value) : 0n,
      gasLimit: tx.gas ? BigInt(tx.gas) : null,
      gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : null,
      maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : null,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas
        ? BigInt(tx.maxPriorityFeePerGas)
        : null,
      gasUsed: receipt?.gasUsed ? BigInt(receipt.gasUsed) : null,
      effectiveGasPrice: receipt?.effectiveGasPrice
        ? BigInt(receipt.effectiveGasPrice)
        : null,
      status: receipt?.status || null,
      type: tx.type || 0,
      nonce: tx.nonce ? BigInt(tx.nonce) : null,
      inputData: tx.input || null,
      logsCount: receipt?.logs?.length || 0,
      contractAddress: receipt?.contractAddress
        ? (receipt.contractAddress as Address)
        : null,
      cumulativeGasUsed: receipt?.cumulativeGasUsed
        ? BigInt(receipt.cumulativeGasUsed)
        : null,
      timestamp: timestamp,
      indexedAt: new Date(),
    };

    // 使用 Drizzle ORM 的 upsert 功能
    await db
      .insert(transactions)
      .values(transactionData)
      .onConflictDoUpdate({
        target: [transactions.chainId, transactions.hash],
        set: transactionData,
      });

    // 返回插入的数据
    const inserted = await db
      .select()
      .from(transactions)
      .where(
        and(eq(transactions.chainId, chainId), eq(transactions.hash, tx.hash))
      )
      .limit(1);

    return this.formatTransaction(inserted[0]);
  }

  // 获取区块时间戳
  private async getBlockTimestamp(
    chainId: number,
    blockNumber: bigint
  ): Promise<string | null> {
    try {
      const blockResult = await db
        .select({ timestamp: blocks.timestamp })
        .from(blocks)
        .where(and(eq(blocks.chainId, chainId), eq(blocks.number, blockNumber)))
        .limit(1);

      return blockResult[0]?.timestamp?.toISOString() || null;
    } catch (error) {
      console.warn(`Failed to get block timestamp for ${blockNumber}:`, error);
      return null;
    }
  }

  // 格式化交易数据
  private formatTransaction(dbTx: any): Transaction {
    return {
      chainId: dbTx.chain_id,
      hash: dbTx.hash,
      blockNumber: dbTx.block_number ? BigInt(dbTx.block_number) : undefined,
      transactionIndex: dbTx.transaction_index || undefined,
      fromAddress: dbTx.from_address || undefined,
      toAddress: dbTx.to_address || undefined,
      value: dbTx.value || "0",
      gasLimit: dbTx.gas_limit ? BigInt(dbTx.gas_limit) : undefined,
      gasPrice: dbTx.gas_price ? BigInt(dbTx.gas_price) : undefined,
      maxFeePerGas: dbTx.max_fee_per_gas
        ? BigInt(dbTx.max_fee_per_gas)
        : undefined,
      maxPriorityFeePerGas: dbTx.max_priority_fee_per_gas
        ? BigInt(dbTx.max_priority_fee_per_gas)
        : undefined,
      gasUsed: dbTx.gas_used ? BigInt(dbTx.gas_used) : undefined,
      effectiveGasPrice: dbTx.effective_gas_price
        ? BigInt(dbTx.effective_gas_price)
        : undefined,
      status: dbTx.status || undefined,
      type: dbTx.type || 0,
      nonce: dbTx.nonce ? BigInt(dbTx.nonce) : undefined,
      inputData: dbTx.input_data || undefined,
      logsCount: dbTx.logs_count || 0,
      contractAddress: dbTx.contract_address || undefined,
      cumulativeGasUsed: dbTx.cumulative_gas_used
        ? BigInt(dbTx.cumulative_gas_used)
        : undefined,
      timestamp: dbTx.timestamp ? new Date(dbTx.timestamp) : undefined,
      indexedAt: dbTx.indexed_at ? new Date(dbTx.indexed_at) : undefined,
    };
  }
}

// 导出全局实例
export const transactionService = new TransactionService();
