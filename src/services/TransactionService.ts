import { db, transactions, blocks } from '../database/init';
import { eq, and, sql, count } from 'drizzle-orm';
import { rpcManager } from './RpcManager';
import { withOneRetry } from '../utils/rpcReadRetry';
import { createLogger } from '../server/logger';
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

// viem rejects getTransactionReceipt for a transaction that is not mined
// yet with TransactionReceiptNotFoundError. That answer is DATA ("no
// receipt yet"), not a transport failure: it must not be retried (pending
// lookups would double their RPC traffic) and must not be reported as an
// error. The name/message shape (rather than `instanceof`) matches the
// RPC-path sibling in utils/blockRpcData.ts, which has to work across
// duplicate viem copies.
const isReceiptNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? String(error.name) : '';
  if (name === 'TransactionReceiptNotFoundError') return true;
  const message = 'message' in error ? String(error.message) : '';
  return /could not be found/i.test(message);
};

/** What one receipt read actually established. */
type ReceiptOutcome =
  | { kind: 'receipt'; receipt: TransactionReceipt }
  // Not mined yet — a real answer that carries no receipt facts.
  | { kind: 'pending' }
  // The read itself failed. This must never be turned into "0 logs".
  | { kind: 'failed'; error: unknown };

const logger = createLogger('transaction-service');

const createTransactionService = (deps: TransactionServiceDeps) => {
  const { db, transactions, blocks, rpcManager } = deps;

  // One retry for the idempotent read (utils/rpcReadRetry: public RPCs drop
  // a single getReceipt under load; a failure that SURVIVES the retry is
  // real and must reach the caller, never be laundered into a plausible
  // value). 'pending' resolves on the first not-found instead of retrying.
  const readReceiptOutcome = async (
    client: { getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<TransactionReceipt> },
    hash: `0x${string}`,
  ): Promise<ReceiptOutcome> => {
    const attempt = async (): Promise<ReceiptOutcome> => {
      try {
        return { kind: 'receipt', receipt: await client.getTransactionReceipt({ hash }) };
      } catch (error) {
        if (isReceiptNotFound(error)) return { kind: 'pending' };
        throw error;
      }
    };
    try {
      return await withOneRetry(attempt);
    } catch (error) {
      return { kind: 'failed', error };
    }
  };

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
      // No default: 0 is a claim ("this transaction emitted no events"),
      // and a row stored without a receipt has none. The field is absent
      // in that case.
      logsCount: num(row, 'logsCount', 'logs_count'),
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

  // The row an indexed transaction would be stored as. Factored out of
  // indexTransaction so the pending path can answer from the same
  // mapping WITHOUT writing it.
  //
  // Presence, not truthiness: `0n` and `0` are falsy. `nonce` is 0 for the
  // FIRST transaction of every account and `blockNumber` is 0n for any
  // genesis transaction, so a truthiness test persisted NULL for fields
  // that are always present — the row then read back as "position unknown"
  // and the API dropped the field entirely. A nullable quantity is absent
  // only when it is null/undefined. (`value` uses ?? for the same reason:
  // a 0-value transaction is a real 0, not a missing value.)
  const toStoredRow = (chainId: number, tx: ViemTransaction, receipt: TransactionReceipt | null) => ({
    chainId,
    hash: tx.hash,
    blockNumber: tx.blockNumber != null ? BigInt(tx.blockNumber) : null,
    transactionIndex: tx.transactionIndex ?? null,
    fromAddress: tx.from ?? null,
    toAddress: tx.to ?? null,
    value: tx.value ?? 0n,
    gasLimit: tx.gas != null ? BigInt(tx.gas) : null,
    gasPrice: tx.gasPrice != null ? BigInt(tx.gasPrice) : null,
    maxFeePerGas: tx.maxFeePerGas != null ? BigInt(tx.maxFeePerGas) : null,
    maxPriorityFeePerGas:
      tx.maxPriorityFeePerGas != null ? BigInt(tx.maxPriorityFeePerGas) : null,
    gasUsed: receipt?.gasUsed != null ? BigInt(receipt.gasUsed) : null,
    effectiveGasPrice:
      receipt?.effectiveGasPrice != null ? BigInt(receipt.effectiveGasPrice) : null,
    status: toDbTxStatus(receipt),
    type: toDbTxType(tx.type),
    nonce: tx.nonce != null ? BigInt(tx.nonce) : null,
    inputData: tx.input ?? null,
    // Receipt-derived: a transaction whose receipt was never read carries
    // NULL here, and formatTransaction leaves the field undefined. Writing
    // 0 instead claimed "this transaction produced no events" — a fact we
    // never established.
    logsCount: receipt ? receipt.logs.length : null,
    contractAddress: receipt?.contractAddress ?? null,
    cumulativeGasUsed:
      receipt?.cumulativeGasUsed != null ? BigInt(receipt.cumulativeGasUsed) : null,
  });

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
      ...toStoredRow(chainId, tx, receipt ?? null),
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

      // A block header can name its transactions without their bodies
      // (includeTransactions silently downgrades on some providers) — the
      // indexer indexes what it can read, and never invents the rest.
      const readable = block.transactions.filter(
        (tx): tx is Exclude<typeof tx, string> => typeof tx !== 'string',
      );
      if (readable.length === 0) {
        logger.warn(
          { chainId, blockNumber },
          'Block returned transaction hashes only; receipts cannot be read',
        );
        return;
      }

      // One unreadable receipt is not a transaction with no receipt: the
      // same rule the hash path follows (retry once, then report). The
      // transactions whose receipts DO resolve are still indexed — a
      // provider hiccup on one of them must not drop the rest.
      const outcomes = await Promise.all(readable.map(tx => readReceiptOutcome(client, tx.hash)));
      let unreadable = 0;
      for (let i = 0; i < readable.length; i++) {
        const tx = readable[i];
        const outcome = outcomes[i];

        if (outcome.kind === 'failed') {
          logger.warn(
            { err: outcome.error, chainId, blockNumber, hash: tx.hash },
            'Transaction receipt could not be read; leaving it unindexed',
          );
          unreadable += 1;
          continue;
        }
        if (outcome.kind === 'pending') continue;

        await indexTransaction(chainId, tx, outcome.receipt);
      }
      if (unreadable > 0) {
        logger.warn(
          { chainId, blockNumber, unreadable },
          'Block indexed with unreadable receipts; those transactions are absent, not empty',
        );
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
        const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
        const outcome = await readReceiptOutcome(client, txHash as `0x${string}`);

        if (outcome.kind === 'failed') {
          // Report it. Swallowing into `null` is what turned one dropped
          // read into a 404 for a transaction that exists; persisting a
          // null receipt is worse, because that row claims status=NULL /
          // logsCount=0 and short-circuits every later read of the hash.
          throw outcome.error instanceof Error
            ? outcome.error
            : new Error('Failed to read transaction receipt', { cause: outcome.error });
        }

        if (outcome.kind === 'pending') {
          // A pending transaction is a real answer with NO receipt facts.
          // Nothing is cached: a stored row could never learn them later
          // (the read short-circuits on any stored row), so the "no
          // receipt" verdict would outlive the transaction's mining.
          return formatTransaction({
            ...toStoredRow(chainId, tx, null),
            timestamp: null,
            indexedAt: null,
          });
        }

        return await indexTransaction(chainId, tx, outcome.receipt);
      } catch (error) {
        logger.error({ err: error, chainId, txHash }, 'Failed to get transaction');
        if (isReceiptNotFound(error)) {
          // viem's transaction-not-found is DATA, and the ONLY answer that
          // may map to the route's 404.
          return null;
        }
        // A read that could not be completed is not a transaction that
        // does not exist. /api/search renders the rejection as its honest
        // degraded verdict; the hash route answers 500.
        throw error;
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

        const total = Number(countResult[0]?.count ?? 0);

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

          // The count above was taken BEFORE indexing, so it described an
          // empty block. Re-read it: `total` is the block's transaction
          // count, not the length of the page just served (which is capped
          // by `limit` and hid every later transaction of a busy block
          // from pagination).
          const indexedCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(transactions)
            .where(and(eq(transactions.chainId, chainId), eq(transactions.blockNumber, blockNumber)));

          return {
            transactions: newTransactions.map(tx => formatTransaction(tx)),
            total: Number(indexedCount[0]?.count ?? 0),
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

        // DuckDB count(*) arrives as a string through the adapter; normalize
        // so the declared numeric total is real (same rule as the event and
        // scan services).
        const total = Number(countResult[0]?.count ?? 0);

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

        // Raw `sql<number>`count(*)`` comes back as a string from the adapter
        // (drizzle's own count() helper does not). Without Number() the
        // stats payload carried a string total, and /api/stats/overview's
        // cross-chain `sum + ch.indexedTransactions` STRING-CONCATENATED it.
        const totalTransactions = Number(countResult[0]?.count ?? 0);

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
