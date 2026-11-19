import { eq, and, sql, desc, count } from 'drizzle-orm';
import { createLogger } from '../server/logger';
import { secondsToDate } from '../utils/dbTime';

const logger = createLogger('block-service');

/**
 * Block data types
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
  db: typeof import('../database/init').db;
  blocks: typeof import('../database/init').blocks;
  rpcManager: typeof import('./RpcManager').rpcManager;
  blockCache: TtlLruCache<Block>;
  createRetryableRpcCall: typeof import('../utils/errorHandler').createRetryableRpcCall;
  createRetryableDbCall: typeof import('../utils/errorHandler').createRetryableDbCall;
  logError: typeof import('../utils/errorHandler').logError;
};

const createBlockService = (deps: BlockServiceDeps) => {
  const { db, blocks, rpcManager, blockCache } = deps;
  const {
    createRetryableRpcCall: retryableRpc,
    createRetryableDbCall: retryableDb,
    logError: logErr,
  } = deps;

  // A stored quantity mapped onto the API row: 0 is a VALUE, so only
  // null/undefined (and a non-finite read) mean "not recorded". The
  // integer columns reach this as numbers, but the adapter can hand back
  // a decimal string for an integer column, so both are accepted — and a
  // fractional read is dropped rather than served as a count.
  const toNumberOrUndefined = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  // A stored bignum. drizzle's fromDriver (real DB reads) and
  // buildBlockValues (the synthesized RPC path) both hand us bigint, but
  // fixture-shaped rows serve decimal strings — accept both. 0n is a VALUE
  // (a dev chain's genesis fields, post-merge 0n difficulty), so only
  // null/undefined/'' mean "not recorded".
  const toBigintOrUndefined = (value: unknown): bigint | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    return typeof value === 'bigint' ? value : BigInt(String(value));
  };

  const formatBlock = (dbBlock: Record<string, unknown>): Block => {
    const get = (camel: string, snake: string) => dbBlock[camel] ?? dbBlock[snake];
    return {
      chainId: Number(get('chainId', 'chain_id')),
      number: toBigintOrUndefined(get('number', 'number')) ?? 0n,
      hash: get('hash', 'hash') as string,
      parentHash: (get('parentHash', 'parent_hash') as string) || undefined,
      timestamp: secondsToDate(get('timestamp', 'timestamp')),
      miner: (get('miner', 'miner') as string) || undefined,
      gasLimit: toBigintOrUndefined(get('gasLimit', 'gas_limit')),
      gasUsed: toBigintOrUndefined(get('gasUsed', 'gas_used')),
      baseFeePerGas: toBigintOrUndefined(get('baseFeePerGas', 'base_fee_per_gas')),
      // `get(...) ? x : undefined` on these two would delete a REAL 0:
      // transaction_count is an integer column written as
      // `transactions.length`, so an empty block stores 0 and the mapper
      // used to report it as absent — a blank Txs cell in the blocks
      // list, "View  Transactions" on the detail page, and an
      // InternalTxnsSection whose `transactionCount === 0` branch never
      // ran. Only null/undefined mean "not recorded".
      transactionCount: toNumberOrUndefined(get('transactionCount', 'transaction_count')),
      sizeBytes: toNumberOrUndefined(get('sizeBytes', 'size_bytes')),
      difficulty: toBigintOrUndefined(get('difficulty', 'difficulty'))?.toString(),
      totalDifficulty: toBigintOrUndefined(get('totalDifficulty', 'total_difficulty'))?.toString(),
      extraData: (get('extraData', 'extra_data') as string) || undefined,
      logsBloom: (get('logsBloom', 'logs_bloom') as string) || undefined,
      stateRoot: (get('stateRoot', 'state_root') as string) || undefined,
      transactionsRoot: (get('transactionsRoot', 'transactions_root') as string) || undefined,
      receiptsRoot: (get('receiptsRoot', 'receipts_root') as string) || undefined,
      indexedAt: secondsToDate(get('indexedAt', 'indexed_at')),
    };
  };

  // The row an RPC block would be stored as, typed to the schema's insert
  // shape — bignum columns take bigint (their toDriver stringifies for
  // BIGNUM), hex columns `0x${string}`. Factored out of indexBlock so
  // the read path can answer from the same mapping WITHOUT the cache
  // write, which is why the values match a drizzle read row's shape
  // (bigint bignums), never the wire's decimal strings. Quantities are
  // presence-tested: 0n/0 are real values, not "unknown".
  //
  // SECONDS, matching the `timestamp` column's customType. The old code
  // passed a Date in, which toDriver (db-types.ts) only stringifies —
  // landing as a local-format "Wed Oct 01 2025 21:20:23 GMT+0800 …" string
  // that DuckDB rejects outright ("Could not convert string … to INT64"),
  // so indexing any block threw. viem's block timestamp is already seconds.
  const buildBlockValues = (
    chainId: number,
    chainBlock: Record<string, unknown>,
  ): typeof blocks.$inferInsert => {
    const blockTimestampSeconds =
      chainBlock.timestamp === null || chainBlock.timestamp === undefined
        ? null
        : Number(chainBlock.timestamp);

    // viem hands back bigint for every EVM quantity; decimal strings and
    // numbers are accepted so fixture-shaped inputs keep working.
    const bignumValue = (value: unknown): bigint | null => {
      if (value === null || value === undefined || value === '') return null;
      return typeof value === 'bigint' ? value : BigInt(String(value));
    };
    const hexValue = (value: unknown): `0x${string}` | null =>
      typeof value === 'string' && value !== '' ? (value as `0x${string}`) : null;

    return {
      chainId,
      number: bignumValue(chainBlock.number) ?? 0n,
      hash: chainBlock.hash as `0x${string}`,
      parentHash: hexValue(chainBlock.parentHash),
      timestamp: blockTimestampSeconds,
      miner: hexValue(chainBlock.miner),
      gasLimit: bignumValue(chainBlock.gasLimit),
      gasUsed: bignumValue(chainBlock.gasUsed),
      baseFeePerGas: bignumValue(chainBlock.baseFeePerGas),
      transactionCount: Array.isArray(chainBlock.transactions) ? chainBlock.transactions.length : 0,
      sizeBytes:
        chainBlock.size === null || chainBlock.size === undefined ? null : Number(chainBlock.size),
      difficulty: bignumValue(chainBlock.difficulty),
      totalDifficulty: bignumValue(chainBlock.totalDifficulty),
      extraData: hexValue(chainBlock.extraData),
      logsBloom: hexValue(chainBlock.logsBloom),
      stateRoot: hexValue(chainBlock.stateRoot),
      transactionsRoot: hexValue(chainBlock.transactionsRoot),
      receiptsRoot: hexValue(chainBlock.receiptsRoot),
    };
  };

  const indexBlock = async (
    chainId: number,
    chainBlock: Record<string, unknown>,
  ): Promise<Block> => {
    const values = buildBlockValues(chainId, chainBlock);

    await db
      .insert(blocks)
      .values(values)
      .onConflictDoUpdate({
        target: [blocks.chainId, blocks.number],
        set: values,
      });

    const inserted = await db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.chainId, chainId),
          eq(
            blocks.number,
            typeof chainBlock.number === 'bigint'
              ? chainBlock.number
              : BigInt(Number(chainBlock.number) || 0),
          ),
        ),
      )
      .limit(1);

    const row = inserted[0];
    if (!row) throw new Error('Failed to insert block');
    return formatBlock(row);
  };

  // The READ path's cache write. A block that was just read from the RPC is
  // an ANSWER; indexing it is an optimization. Before this, the rejection
  // escaped the read path's catch, which answers `null` — and routes/blocks
  // renders `null` as a 404 "Block not found" for a block whose header the
  // RPC had just returned (and which a later request would index happily).
  // The mapping is shared with the write path, so the answer is identical
  // whether or not the row landed.
  const cacheBlock = async (
    chainId: number,
    chainBlock: Record<string, unknown>,
  ): Promise<Block> => {
    try {
      return await indexBlock(chainId, chainBlock);
    } catch (error) {
      logErr(error, 'BlockService.cacheBlock', {
        chainId,
        blockNumber: String(chainBlock.number ?? ''),
      });
      return formatBlock(buildBlockValues(chainId, chainBlock));
    }
  };

  const service = {
    getLatestBlock: async (chainId: number): Promise<Block | null> => {
      const cacheKey = `latest-${chainId}`;

      try {
        const cached = blockCache.get(cacheKey);
        if (cached) {
          return cached;
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
            const block = formatBlock(dbResult[0]);
            blockCache.set(cacheKey, block);
            return block;
          }
        }

        const fetchLatestBlock = retryableRpc(async () => {
          const client = await rpcManager.getClient(chainId);
          return await client.getBlock({ blockTag: 'latest' });
        }, chainId);

        const latestBlock = await fetchLatestBlock();
        const block: Block = await cacheBlock(chainId, latestBlock);

        blockCache.set(cacheKey, block);
        return block;
      } catch (error) {
        logErr(error, 'BlockService.getLatestBlock', { chainId });
        throw new Error('Failed to fetch latest block', { cause: error });
      }
    },

    getBlockByNumber: async (chainId: number, blockNumber: bigint): Promise<Block | null> => {
      try {
        const cached = await db
          .select()
          .from(blocks)
          .where(and(eq(blocks.chainId, chainId), eq(blocks.number, blockNumber)))
          .limit(1);

        if (cached.length > 0) {
          return formatBlock(cached[0]);
        }

        const client = await rpcManager.getClient(chainId);
        const chainBlock = await client.getBlock({
          blockNumber,
          includeTransactions: false,
        });

        return await cacheBlock(chainId, chainBlock);
      } catch (error) {
        logErr(error, 'BlockService.getBlockByNumber', {
          chainId,
          blockNumber: blockNumber.toString(),
        });
        return null;
      }
    },

    getBlockByHash: async (chainId: number, blockHash: string): Promise<Block | null> => {
      try {
        const cached = await db
          .select()
          .from(blocks)
          .where(and(eq(blocks.chainId, chainId), eq(blocks.hash, blockHash as `0x${string}`)))
          .limit(1);

        if (cached.length > 0) {
          return formatBlock(cached[0]);
        }

        const client = await rpcManager.getClient(chainId);
        const chainBlock = await client.getBlock({
          blockHash: blockHash as `0x${string}`,
          includeTransactions: false,
        });

        return await cacheBlock(chainId, chainBlock);
      } catch (error) {
        logErr(error, 'BlockService.getBlockByHash', { chainId, blockHash });
        return null;
      }
    },

    getBlocks: async (
      chainId: number,
      limit: number = 10,
      offset: number = 0,
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

        const total = sqlCountTotal(countResult);
        const formattedBlocks = blockList.map(b => formatBlock(b as Record<string, unknown>));

        return { blocks: formattedBlocks, total };
      } catch (error) {
        logErr(error, 'BlockService.getBlocks', { chainId });
        // The route's own catch answers 500 'Failed to get blocks'. An
        // error swallowed here reached the client as a 200 with an empty
        // page — indistinguishable from a chain with nothing indexed, and
        // with no retry affordance (same rule as /api/stats/overview).
        throw error;
      }
    },

    getLatestBlockNumber: async (chainId: number): Promise<bigint> => {
      try {
        const client = await rpcManager.getClient(chainId);
        return await client.getBlockNumber();
      } catch (error) {
        logger.error({ err: error }, 'Failed to get latest block number');
        throw new Error('Failed to get latest block number', { cause: error });
      }
    },

    getBlockStats: async (
      chainId: number,
    ): Promise<{
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

        const totalBlocks = sqlCountTotal(countResult);
        // Presence, not truthiness: `blocks.number` is a bignum column, so a
        // chain whose only indexed block is genesis yields 0n — falsy, and
        // the old test reported latestBlock: null beside totalBlocks: 1
        // (a self-contradictory payload for a freshly booted dev chain).
        const latestNumber = latestResult[0]?.number;
        const latestBlock = latestNumber != null ? BigInt(latestNumber) : null;

        let avgBlockTime: number | null = null;
        const blocksWithTimestamp = recentBlocks.filter(b => b.timestamp != null);
        if (blocksWithTimestamp.length >= 2) {
          const timeDiffs: number[] = [];
          for (let i = 0; i < blocksWithTimestamp.length - 1; i++) {
            // Same seconds contract as formatBlock: the column is unix
            // seconds, so both ends are scaled before subtracting. Reading
            // them as ms made every diff ~1000× too small, collapsing
            // avgBlockTime to fractions of a second on real chains.
            const current = secondsToDate(blocksWithTimestamp[i].timestamp)?.getTime() ?? NaN;
            const next = secondsToDate(blocksWithTimestamp[i + 1].timestamp)?.getTime() ?? NaN;
            const diff = (current - next) / 1000;
            if (Number.isFinite(diff)) timeDiffs.push(diff);
          }
          if (timeDiffs.length > 0) {
            avgBlockTime = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
          }
        }

        let avgGasUsed: string | null = null;
        const gasValues = recentBlocks
          .map(block => block.gasUsed)
          .filter((gas): gas is bigint => gas != null && gas !== 0n)
          .map(gas => gas);

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
        logErr(error, 'BlockService.getBlockStats', { chainId });
        throw new Error('Failed to get block statistics', { cause: error });
      }
    },

    indexBlockRange: async (
      chainId: number,
      startBlock: bigint,
      endBlock: bigint,
      callback?: (progress: number) => void,
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
          logger.warn({ err: error, blockNum: blockNum.toString() }, 'Failed to index block');
        }
      }
    },
  };

  return service;
};

export type BlockService = ReturnType<typeof createBlockService>;
export { createBlockService };

import { db, blocks, sqlCountTotal } from '../database/init';
import { rpcManager } from './RpcManager';
import { createTtlLruCache, type TtlLruCache } from '../utils/ttlLruCache';
import { createRetryableRpcCall, createRetryableDbCall, logError } from '../utils/errorHandler';

// The single block cache: 15s TTL (the freshness window every set site
// used), 500 entries — the former bespoke LRUCache (utils/cache.ts, deleted
// 2026-11-09) lived on the same numbers with a hybrid count+seconds eviction
// score; this is the canonical plain-LRU cache every other service shares.
const blockCache: TtlLruCache<Block> = createTtlLruCache<Block>({
  ttlMs: 15_000,
  maxEntries: 500,
});

export const blockService = createBlockService({
  db,
  blocks,
  rpcManager,
  blockCache,
  createRetryableRpcCall,
  createRetryableDbCall,
  logError,
});
