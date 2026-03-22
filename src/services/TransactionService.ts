import { db, transactions, blocks } from '../database/init';
import { eq, and, sql } from 'drizzle-orm';
import { rpcManager } from './RpcManager';
import type { Address, Transaction as ViemTransaction, TransactionReceipt } from 'viem';

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

type TransactionServiceDeps = {
  db: typeof import('../database/init').db;
  transactions: typeof import('../database/init').transactions;
  blocks: typeof import('../database/init').blocks;
  rpcManager: typeof import('./RpcManager').rpcManager;
};

const createTransactionService = (deps: TransactionServiceDeps) => {
  const { db, transactions, blocks, rpcManager } = deps;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatTransaction = (dbTx: any): Transaction => {
    return {
      chainId: dbTx.chain_id,
      hash: dbTx.hash,
      blockNumber: dbTx.block_number ? BigInt(dbTx.block_number) : undefined,
      transactionIndex: dbTx.transaction_index ?? undefined,
      fromAddress: dbTx.from_address ?? undefined,
      toAddress: dbTx.to_address ?? undefined,
      value: dbTx.value ?? '0',
      gasLimit: dbTx.gas_limit ? BigInt(dbTx.gas_limit) : undefined,
      gasPrice: dbTx.gas_price ? BigInt(dbTx.gas_price) : undefined,
      maxFeePerGas: dbTx.max_fee_per_gas ? BigInt(dbTx.max_fee_per_gas) : undefined,
      maxPriorityFeePerGas: dbTx.max_priority_fee_per_gas
        ? BigInt(dbTx.max_priority_fee_per_gas)
        : undefined,
      gasUsed: dbTx.gas_used ? BigInt(dbTx.gas_used) : undefined,
      effectiveGasPrice: dbTx.effective_gas_price ? BigInt(dbTx.effective_gas_price) : undefined,
      status: dbTx.status ?? undefined,
      type: dbTx.type ?? 0,
      nonce: dbTx.nonce ? BigInt(dbTx.nonce) : undefined,
      inputData: dbTx.input_data ?? undefined,
      logsCount: dbTx.logs_count ?? 0,
      contractAddress: dbTx.contract_address ?? undefined,
      cumulativeGasUsed: dbTx.cumulative_gas_used ? BigInt(dbTx.cumulative_gas_used) : undefined,
      timestamp: dbTx.timestamp ? new Date(dbTx.timestamp) : undefined,
      indexedAt: dbTx.indexed_at ? new Date(dbTx.indexed_at) : undefined,
    };
  };

  const getBlockTimestamp = async (
    chainId: number,
    blockNumber: bigint,
  ): Promise<string | null> => {
    try {
      const blockResult = await db
        .select({ timestamp: blocks.timestamp })
        .from(blocks)
        .where(and(eq(blocks.chainId, chainId), eq(blocks.number, blockNumber)))
        .limit(1);

      const ts = blockResult[0]?.timestamp;
      return ts != null ? new Date(Number(ts) * 1000).toISOString() : null;
    } catch (error) {
      console.warn(`Failed to get block timestamp for ${blockNumber}:`, error);
      return null;
    }
  };

  const indexTransaction = async (
    chainId: number,
    tx: ViemTransaction,
    receipt?: TransactionReceipt | null,
  ): Promise<Transaction> => {
    const timestamp = receipt?.blockNumber
      ? await getBlockTimestamp(chainId, BigInt(receipt.blockNumber))
      : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactionData: any = {
      chainId,
      hash: tx.hash,
      blockNumber: tx.blockNumber ? BigInt(tx.blockNumber) : null,
      transactionIndex: tx.transactionIndex ?? null,
      fromAddress: tx.from ?? null,
      toAddress: tx.to ?? null,
      value: tx.value ? BigInt(tx.value) : 0n,
      gasLimit: tx.gas ? BigInt(tx.gas) : null,
      gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : null,
      maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : null,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : null,
      gasUsed: receipt?.gasUsed ? BigInt(receipt.gasUsed) : null,
      effectiveGasPrice: receipt?.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice) : null,
      status: receipt?.status ?? null,
      type: tx.type ?? 0,
      nonce: tx.nonce ? BigInt(tx.nonce) : null,
      inputData: tx.input ?? null,
      logsCount: receipt?.logs?.length ?? 0,
      contractAddress: receipt?.contractAddress ?? null,
      cumulativeGasUsed: receipt?.cumulativeGasUsed ? BigInt(receipt.cumulativeGasUsed) : null,
      timestamp,
      indexedAt: new Date(),
    };

    await db
      .insert(transactions)
      .values(transactionData)
      .onConflictDoUpdate({
        target: [transactions.chainId, transactions.hash],
        set: transactionData,
      });

    const inserted = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.chainId, chainId), eq(transactions.hash, tx.hash)))
      .limit(1);

    return formatTransaction(inserted[0]);
  };

  const indexBlockTransactions = async (chainId: number, blockNumber: bigint): Promise<void> => {
    try {
      const client = await rpcManager.getClient(chainId);
      const block = await client.getBlock({
        blockNumber,
        includeTransactions: true,
      });

      if (!block.transactions || block.transactions.length === 0) {
        return;
      }

      const receipts = await Promise.all(
        block.transactions.map(tx =>
          client
            .getTransactionReceipt({
              hash: typeof tx === 'string' ? (tx as `0x${string}`) : tx.hash,
            })
            .catch(() => null),
        ),
      );

      for (let i = 0; i < block.transactions.length; i++) {
        const tx = block.transactions[i];
        const receipt = receipts[i];

        if (typeof tx !== 'string') {
          await indexTransaction(chainId, tx, receipt);
        }
      }
    } catch (error) {
      console.error(`Failed to index transactions for block ${blockNumber}:`, error);
    }
  };

  const service = {
    getTransactionByHash: async (chainId: number, txHash: string): Promise<Transaction | null> => {
      try {
        const cached = await db
          .select()
          .from(transactions)
          .where(
            and(eq(transactions.chainId, chainId), eq(transactions.hash, txHash as `0x${string}`)),
          )
          .limit(1);

        if (cached.length > 0) {
          return formatTransaction(cached[0]);
        }

        const client = await rpcManager.getClient(chainId);
        const [tx, receipt] = await Promise.all([
          client.getTransaction({ hash: txHash as `0x${string}` }),
          client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null),
        ]);

        const transaction = await indexTransaction(chainId, tx, receipt);
        return transaction;
      } catch (error) {
        console.error(`Failed to get transaction ${txHash}:`, error);
        return null;
      }
    },

    getTransactionsByBlockNumber: async (
      chainId: number,
      blockNumber: bigint,
      limit: number = 50,
      offset: number = 0,
    ): Promise<{ transactions: Transaction[]; total: number }> => {
      try {
        const txResults = await db
          .select()
          .from(transactions)
          .where(and(eq(transactions.chainId, chainId), eq(transactions.blockNumber, blockNumber)))
          .orderBy(transactions.transactionIndex)
          .limit(limit)
          .offset(offset);

        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(transactions)
          .where(and(eq(transactions.chainId, chainId), eq(transactions.blockNumber, blockNumber)));

        const total = countResult[0]?.count || 0;

        if (txResults.length === 0 && offset === 0) {
          await indexBlockTransactions(chainId, blockNumber);

          const newTransactions = await db
            .select()
            .from(transactions)
            .where(
              and(eq(transactions.chainId, chainId), eq(transactions.blockNumber, blockNumber)),
            )
            .orderBy(transactions.transactionIndex)
            .limit(limit)
            .offset(offset);

          return {
            transactions: newTransactions.map(tx => formatTransaction(tx)),
            total: newTransactions.length,
          };
        }

        return {
          transactions: txResults.map(tx => formatTransaction(tx)),
          total,
        };
      } catch (error) {
        console.error(`Failed to get transactions for block ${blockNumber}:`, error);
        return { transactions: [], total: 0 };
      }
    },

    getTransactionsByAddress: async (
      chainId: number,
      address: Address,
      limit: number = 20,
      offset: number = 0,
    ): Promise<{ transactions: Transaction[]; total: number }> => {
      try {
        const txResults = await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              sql`(${transactions.fromAddress} = ${address} OR ${transactions.toAddress} = ${address})`,
            ),
          )
          .orderBy(
            sql`${transactions.timestamp} DESC, ${transactions.blockNumber} DESC, ${transactions.transactionIndex} DESC`,
          )
          .limit(limit)
          .offset(offset);

        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              sql`(${transactions.fromAddress} = ${address} OR ${transactions.toAddress} = ${address})`,
            ),
          );

        const total = countResult[0]?.count || 0;

        return {
          transactions: txResults.map(tx => formatTransaction(tx)),
          total,
        };
      } catch (error) {
        console.error(`Failed to get transactions for address ${address}:`, error);
        return { transactions: [], total: 0 };
      }
    },

    getLatestTransactions: async (chainId: number, limit: number = 20): Promise<Transaction[]> => {
      try {
        const txResults = await db
          .select()
          .from(transactions)
          .where(eq(transactions.chainId, chainId))
          .orderBy(
            sql`${transactions.timestamp} DESC, ${transactions.blockNumber} DESC, ${transactions.transactionIndex} DESC`,
          )
          .limit(limit);

        return txResults.map(tx => formatTransaction(tx));
      } catch (error) {
        console.error('Failed to get latest transactions:', error);
        return [];
      }
    },

    getTransactionStats: async (
      chainId: number,
    ): Promise<{
      totalTransactions: number;
      avgGasPrice: string | null;
      avgGasUsed: string | null;
      successRate: number;
    }> => {
      try {
        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(transactions)
          .where(eq(transactions.chainId, chainId));

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
              sql`${transactions.gasPrice} IS NOT NULL AND ${transactions.gasUsed} IS NOT NULL`,
            ),
          )
          .orderBy(sql`${transactions.timestamp} DESC`)
          .limit(1000);

        const totalTransactions = countResult[0]?.count || 0;

        let avgGasPrice: string | null = null;
        const gasPrices = statsResult
          .map(tx => tx.gasPrice)
          .filter((price): price is bigint => price != null && price !== 0n);

        if (gasPrices.length > 0) {
          const totalGasPrice = gasPrices.reduce((a: bigint, b: bigint) => a + b, 0n);
          avgGasPrice = (totalGasPrice / BigInt(gasPrices.length)).toString();
        }

        let avgGasUsed: string | null = null;
        const gasUsedValues = statsResult
          .map(tx => tx.gasUsed)
          .filter((gas): gas is bigint => gas != null && gas !== 0n);

        if (gasUsedValues.length > 0) {
          const totalGasUsed = gasUsedValues.reduce((a: bigint, b: bigint) => a + b, 0n);
          avgGasUsed = (totalGasUsed / BigInt(gasUsedValues.length)).toString();
        }

        const successfulTxs = statsResult.filter(tx => tx.status === 1).length;
        const successRate = statsResult.length > 0 ? (successfulTxs / statsResult.length) * 100 : 0;

        return {
          totalTransactions,
          avgGasPrice,
          avgGasUsed,
          successRate,
        };
      } catch (error) {
        console.error('Failed to get transaction stats:', error);
        throw new Error('Failed to get transaction statistics', { cause: error });
      }
    },
  };

  return service;
};

export type TransactionService = ReturnType<typeof createTransactionService>;
export { createTransactionService };

export const transactionService = createTransactionService({
  db,
  transactions,
  blocks,
  rpcManager,
});
