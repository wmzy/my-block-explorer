import { db, transactions, blocks } from '../database/init';
import { eq, and, sql, count } from 'drizzle-orm';
import { rpcManager } from './RpcManager';
import type { Address, Transaction as ViemTransaction, TransactionReceipt } from 'viem';

/**
 * Transaction data types
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

  // The `timestamp` column is the repo's unix-SECONDS customType
  // (database/db-types.ts: TIMESTAMP_S, data: number) — `new Date(number)`
  // reads a number as MILLIseconds, so the old conversion reported January
  // 1970 for every DB-served transaction. A Date passes through, a bare
  // decimal string is seconds, anything else parses as written.
  const secondsToDate = (value: unknown): Date | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
    if (typeof value === 'number') return Number.isNaN(value) ? undefined : new Date(value * 1000);
    const text = String(value);
    if (/^\d+$/.test(text)) return new Date(Number(text) * 1000);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };

  // drizzle returns camelCase keys (casing: 'snake_case' applies to
  // generated SQL column names, not to the JS row). The old formatter read
  // snake_case keys that never exist, so EVERY field but the two written
  // verbatim came back undefined — transaction lists served a bare hash and
  // value, and formatTransactionForApi then dropped blockNumber, gas
  // fields, nonce, status and timestamp as "null". Both spellings are
  // accepted so raw/plain rows keep working too.
  const pick = (tx: Record<string, unknown>, camel: string, snake: string): unknown =>
    tx[camel] ?? tx[snake];

  const num = (tx: Record<string, unknown>, camel: string, snake: string): number | undefined => {
    const value = pick(tx, camel, snake);
    return typeof value === 'number' ? value : undefined;
  };
  const str = (tx: Record<string, unknown>, camel: string, snake: string): string | undefined => {
    const value = pick(tx, camel, snake);
    return typeof value === 'string' ? value : undefined;
  };
  const addr = (tx: Record<string, unknown>, camel: string, snake: string): Address | undefined =>
    str(tx, camel, snake) as Address | undefined;
  const big = (
    tx: Record<string, unknown>,
    camel: string,
    snake: string,
  ): bigint | undefined => {
    const value = pick(tx, camel, snake);
    if (value === null || value === undefined || value === '') return undefined;
    try {
      return BigInt(value as string | number | bigint);
    } catch {
      return undefined;
    }
  };
  // BIGNUM columns can arrive as bigint; the wire contract is a decimal string.
  const bigToDecimal = (value: unknown): string =>
    typeof value === 'bigint' || typeof value === 'number' ? String(value) : '0';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatTransaction = (dbTx: any): Transaction => {
    const row = dbTx as Record<string, unknown>;
    return {
      chainId: num(row, 'chainId', 'chain_id') ?? 0,
      hash: str(row, 'hash', 'hash') ?? '',
      blockNumber: big(row, 'blockNumber', 'block_number'),
      transactionIndex: num(row, 'transactionIndex', 'transaction_index'),
      fromAddress: addr(row, 'fromAddress', 'from_address'),
      toAddress: addr(row, 'toAddress', 'to_address'),
      // `value` is a BIGNUM column: drizzle hands it back as a bigint (the
      // adapter stringifies its own bigints, but a real row keeps the
      // driver's type) and the API contract is a decimal STRING — so it is
      // stringified here rather than narrowed to string, which silently
      // flattened every non-string value to the '0' default.
      value: str(row, 'value', 'value') ?? bigToDecimal(row.value),
      gasLimit: big(row, 'gasLimit', 'gas_limit'),
      gasPrice: big(row, 'gasPrice', 'gas_price'),
      maxFeePerGas: big(row, 'maxFeePerGas', 'max_fee_per_gas'),
      maxPriorityFeePerGas: big(row, 'maxPriorityFeePerGas', 'max_priority_fee_per_gas'),
      gasUsed: big(row, 'gasUsed', 'gas_used'),
      effectiveGasPrice: big(row, 'effectiveGasPrice', 'effective_gas_price'),
      status: num(row, 'status', 'status'),
      type: num(row, 'type', 'type') ?? 0,
      nonce: big(row, 'nonce', 'nonce'),
      inputData: str(row, 'inputData', 'input_data'),
      logsCount: num(row, 'logsCount', 'logs_count') ?? 0,
      contractAddress: str(row, 'contractAddress', 'contract_address'),
      cumulativeGasUsed: big(row, 'cumulativeGasUsed', 'cumulative_gas_used'),
      timestamp: secondsToDate(row.timestamp),
      indexedAt: secondsToDate(pick(row, 'indexedAt', 'indexed_at')),
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

  // viem receipt.status is the string 'success' | 'reverted'; the DB column
  // is an integer (1 success / 0 failed). Null only when no receipt exists
  // (pending) — the raw string made every insert throw a DuckDB conversion
  // error, silently breaking tx-by-hash search and block tx caching.
  const toDbTxStatus = (receipt: TransactionReceipt | null | undefined): 0 | 1 | null =>
    receipt ? (receipt.status === 'success' ? 1 : 0) : null;

  // viem tx.type is a label ('eip1559', ...) or hex string; the column is an
  // integer. Unknown labels fall back to 0 (legacy).
  const toDbTxType = (txType: ViemTransaction['type']): number => {
    if (typeof txType === 'number') return txType;
    if (txType === 'eip2930') return 1;
    if (txType === 'eip1559') return 2;
    if (txType === 'eip4844') return 3;
    if (txType === 'eip7702') return 4;
    if (txType === 'legacy' || txType === undefined || txType === null) return 0;
    const parsed = Number(txType);
    return Number.isFinite(parsed) ? parsed : 0;
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
      status: toDbTxStatus(receipt),
      type: toDbTxType(tx.type),
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

    getLatestTransactions: async (
      chainId: number,
      limit: number = 20,
      offset: number = 0,
    ): Promise<{ transactions: Transaction[]; total: number }> => {
      try {
        const txResults = await db
          .select()
          .from(transactions)
          .where(eq(transactions.chainId, chainId))
          .orderBy(
            sql`${transactions.timestamp} DESC, ${transactions.blockNumber} DESC, ${transactions.transactionIndex} DESC`,
          )
          .limit(limit)
          .offset(offset);

        const countResult = await db
          .select({ value: count() })
          .from(transactions)
          .where(eq(transactions.chainId, chainId));

        return {
          transactions: txResults.map(tx => formatTransaction(tx)),
          // drizzle's count() casts DuckDB's BIGINT to a JS number — the
          // raw sql`count(*)` came out as a string, diverging from the
          // blocks list response this endpoint mirrors.
          total: countResult[0]?.value || 0,
        };
      } catch (error) {
        console.error('Failed to get latest transactions:', error);
        return { transactions: [], total: 0 };
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
