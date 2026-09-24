import { db, indexedAddresses } from '../database/init';
import { eq, and } from 'drizzle-orm';
import { rpcManager } from './RpcManager';
import { contractSourceService } from './ContractSourceService';
import type { Address, PublicClient } from 'viem';
import { createLogger } from '../server/logger';

const logger = createLogger('address-service');

/**
 * 持久化地址数据类型（永不改变或很少改变的数据）
 */
export type PersistentAddressData = {
  isContract: boolean;
  contractCreationTx?: string;
  contractCreationBlock?: number;
  contractCreator?: string;
  contractName?: string;
  verificationStatus?: 'verified' | 'unverified' | 'partial';
  sourceCodeAvailable?: boolean;
  compilerVersion?: string;
  isProxy?: boolean;
  proxyType?: string;
  implementationAddress?: string;
  firstSeenBlock?: number;
  firstSeenTimestamp?: Date;
};

/**
 * 地址信息类型（getAddressInfo 返回类型）
 *
 * Balance and transaction count are deliberately absent: this payload is
 * the persistent/indexer channel only. Live values come from the realtime
 * RPC channel (services/addressRealTime.ts) — the API previously
 * hard-coded balance '0' / transactionCount 0 here, which no consumer
 * could trust.
 */
export type AddressInfo = PersistentAddressData & {
  chainId: number;
  address: Address;
  lastQueried: Date;
};

export type DiscoveredTransaction = {
  hash: string;
  blockNumber: bigint;
  fromAddress: string;
  toAddress: string;
  value: string;
  timestamp: string;
};

// Coverage semantics for getAddressTransactions: discovery is a heuristic
// (binary search over native-balance changes within a capped window), so
// callers need to know how complete any result is.
// - 'complete': reserved for an authoritative indexer channel — the
//   heuristic never emits it
// - 'partial': the heuristic ran, or the nonce shows no outgoing txs while
//   incoming activity stays undetectable; only native-token transfers
//   inside the searched window are visible
// - 'none': nothing could be discovered (zero balance or search failure)
export type AddressTransactionsResult = {
  transactions: DiscoveredTransaction[];
  // Count of DISCOVERED (deduped) transactions — never the RPC nonce,
  // which counts outgoing transactions only.
  total: number;
  method: string;
  coverage: 'complete' | 'partial' | 'none';
  reason?: 'no-outgoing-transactions' | 'zero-balance' | 'search-failed';
  searchWindowBlocks?: number;
  // Additive opt-in payload (?balanceHistory=1): per-block cumulative
  // discovered-delta points computed from the FULL cached discovery list
  // (never just the served page). Absent unless requested — existing
  // consumers see a byte-identical shape.
  balancePoints?: DiscoveredBalancePoint[];
};

// One step of the discovered balance series. Numeric fields are decimal
// strings so BigInt exactness survives JSON. Timestamps are ISO-8601 UTC
// (the block scan records new Date(blockTimestamp * 1000).toISOString()).
export type DiscoveredBalancePoint = {
  blockNumber: string;
  timestamp: string;
  // Running sum of signed native-value deltas (wei) from the oldest
  // discovered transaction up to and including this one. The leading
  // anchor point carries '0' — the discovered change BEFORE the oldest
  // discovered transaction. The address's ABSOLUTE balance at that point
  // is unknown from this scan (older activity may be undiscovered).
  cumulativeValue: string;
};

/**
 * Cumulative discovered-balance series for one address, computed from a
 * discovered transaction list. Pure: any input ordering is normalized to
 * newest→oldest (stable for same-block entries — intra-block order is
 * discovery order, not consensus index order), then walked oldest→newest
 * accumulating signed native-value deltas (+incoming, −outgoing;
 * self-transfers net 0). The result is chronological (oldest first) and
 * starts with the explicit 0 anchor at the oldest discovered transaction.
 * Token transfers are excluded by construction: discovery scans raw
 * native-value transactions only.
 */
export function computeDiscoveredBalancePoints(
  transactions: readonly DiscoveredTransaction[],
  address: string,
): DiscoveredBalancePoint[] {
  if (transactions.length === 0) return [];
  const lowerAddr = address.toLowerCase();
  const sorted = [...transactions].sort((a, b) =>
    a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
  );
  const oldest = sorted[sorted.length - 1];
  const points: DiscoveredBalancePoint[] = [
    {
      blockNumber: String(oldest.blockNumber),
      timestamp: oldest.timestamp,
      cumulativeValue: '0',
    },
  ];
  let cumulative = 0n;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const tx = sorted[i];
    let delta = 0n;
    if (tx.fromAddress.toLowerCase() === lowerAddr) delta -= BigInt(tx.value);
    if (tx.toAddress.toLowerCase() === lowerAddr) delta += BigInt(tx.value);
    cumulative += delta;
    points.push({
      blockNumber: String(tx.blockNumber),
      timestamp: tx.timestamp,
      cumulativeValue: cumulative.toString(),
    });
  }
  return points;
}

/**
 * Union of the heuristic discovery list with persisted deep-scan findings:
 * dedup by tx hash (heuristic entry wins — it carries data from the same
 * live scan), sorted by blockNumber descending (stable for same-block
 * entries). Pure: any input ordering is normalized. This is the merge the
 * transactions endpoint applies when a deep-scan job has persisted
 * findings, so `total` is the merged count.
 */
export function mergeDiscoveredTransactions(
  heuristic: readonly DiscoveredTransaction[],
  findings: readonly DiscoveredTransaction[],
): DiscoveredTransaction[] {
  if (findings.length === 0) return [...heuristic];
  const seen = new Set(heuristic.map(tx => tx.hash.toLowerCase()));
  const merged = [...heuristic];
  for (const tx of findings) {
    if (!seen.has(tx.hash.toLowerCase())) {
      seen.add(tx.hash.toLowerCase());
      merged.push(tx);
    }
  }
  merged.sort((a, b) =>
    a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
  );
  return merged;
}

const SCAN_THRESHOLD = 64n;
const MAX_RPC_CALLS = 200;
const BATCH_CONCURRENCY = 8;
const TX_SEARCH_TIMEOUT_MS = 30_000;

// Discovery budget. Pages are sliced from one canonical result list per
// (chain, address, window), so the discovered list must not depend on
// which page happened to be requested first — the old offset+limit budget
// made consecutive pages disagree.
const DISCOVERY_LIMIT = 200;
// Per-request discovery budget: the slice being served plus a lookahead
// (so hasNext stays honest without an immediate re-search), bounded by the
// hard limit. A flat-200 first page regularly blew the 30s search timeout
// on slow public RPCs for active addresses; paging deeper escalates the
// budget monotonically and replaces the cached list with the wider one.
const DISCOVERY_LOOKAHEAD = 15;
const discoveryBudgetFor = (offset: number, limit: number): number =>
  Math.min(offset + limit + DISCOVERY_LOOKAHEAD, DISCOVERY_LIMIT);
// Hard clamp for an explicit search-window override (?window=). The
// txCount-tiered defaults in getSearchRange stay far below it.
const MAX_SEARCH_WINDOW_BLOCKS = 50_000_000;
// Deterministic pagination: each request used to re-run the capped search
// (per-block failures silently swallowed), so consecutive pages could
// disagree. A short-lived canonical result per (chain, address, window)
// makes paging stable; the TTL bounds staleness, the LRU bound memory.
const TX_RESULT_TTL_MS = 60_000;
const TX_RESULT_MAX_ENTRIES = 20;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);

const getSearchRange = (txCount: number): bigint => {
  if (txCount > 100) return 200_000n;
  if (txCount > 10) return 600_000n;
  return 2_500_000n;
};

// Effective search window: the txCount-tiered default unless the caller
// widens it explicitly (?window=). Explicit values clamp to 1..MAX.
const resolveSearchWindow = (txCount: number, requested?: number): bigint => {
  if (requested === undefined) return getSearchRange(txCount);
  const clamped = Math.min(Math.max(Math.trunc(requested), 1), MAX_SEARCH_WINDOW_BLOCKS);
  return BigInt(clamped);
};

// Balance at a block boundary — the shared primitive of BOTH discovery
// paths: the heuristic binary search above and the deep-scan forward walk
// (services/AddressScanService.ts) verify "segment contains no
// balance-changing tx" through equality of two boundary reads.
export const getBalanceAt = async (
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
): Promise<bigint> => client.getBalance({ address, blockNumber });

// Extract the transactions of one already-fetched block that involve the
// target address (lowercase compare on both ends). Shared by the
// heuristic's scanBlocksForAddress and the deep-scan walk's per-change
// block scan so the two paths can never disagree on what counts as a hit.
export const scanBlockForAddressTransactions = (
  block: {
    number?: bigint | null;
    timestamp: bigint;
    transactions: readonly (string | { hash: string; from: string; to?: string | null; value: bigint })[];
  },
  address: Address,
): DiscoveredTransaction[] => {
  const lowerAddr = address.toLowerCase();
  const results: DiscoveredTransaction[] = [];
  for (const tx of block.transactions) {
    if (typeof tx === 'string') continue;
    const from = tx.from?.toLowerCase();
    const to = tx.to?.toLowerCase();
    if (from === lowerAddr || to === lowerAddr) {
      results.push({
        hash: tx.hash,
        blockNumber: block.number ?? 0n,
        fromAddress: tx.from,
        toAddress: tx.to ?? '',
        value: tx.value.toString(),
        timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      });
    }
  }
  return results;
};

/**
 * Scan a contiguous range of blocks and extract transactions involving the target address.
 * Fetches blocks in parallel batches to reduce latency.
 */
const scanBlocksForAddress = async (
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
  limit: number,
  rpcCallCount: { value: number },
): Promise<DiscoveredTransaction[]> => {
  const results: DiscoveredTransaction[] = [];

  const blockNumbers: bigint[] = [];
  for (let b = toBlock; b >= fromBlock && blockNumbers.length < 256; b--) {
    blockNumbers.push(b);
  }

  for (let i = 0; i < blockNumbers.length; i += BATCH_CONCURRENCY) {
    if (results.length >= limit || rpcCallCount.value >= MAX_RPC_CALLS) break;

    const batch = blockNumbers.slice(i, i + BATCH_CONCURRENCY);
    const blocks = await Promise.all(
      batch.map(async bn => {
        rpcCallCount.value++;
        return client.getBlock({ blockNumber: bn, includeTransactions: true }).catch(() => null);
      }),
    );

    for (const block of blocks) {
      if (!block?.transactions || results.length >= limit) continue;
      const remaining = limit - results.length;
      results.push(...scanBlockForAddressTransactions(block, address).slice(0, remaining));
    }
  }

  return results;
};

/**
 * Binary-search for blocks where the native-token balance of `address` changed.
 * When a range is narrow enough (<=SCAN_THRESHOLD), do a linear scan.
 */
const binarySearchBalanceChanges = async (
  client: PublicClient,
  address: Address,
  lo: bigint,
  hi: bigint,
  limit: number,
  rpcCallCount: { value: number },
): Promise<DiscoveredTransaction[]> => {
  if (rpcCallCount.value >= MAX_RPC_CALLS || limit <= 0 || lo >= hi) return [];

  if (hi - lo <= SCAN_THRESHOLD) {
    return scanBlocksForAddress(client, address, lo, hi, limit, rpcCallCount);
  }

  rpcCallCount.value += 3;
  const [balLo, balHi, balMid] = await Promise.all([
    getBalanceAt(client, address, lo),
    getBalanceAt(client, address, hi),
    getBalanceAt(client, address, (lo + hi) / 2n),
  ]);

  const mid = (lo + hi) / 2n;
  const leftChanged = balLo !== balMid;
  const rightChanged = balMid !== balHi;

  if (!leftChanged && !rightChanged) return [];

  // Search the right half first (more recent blocks)
  const results: DiscoveredTransaction[] = [];

  if (rightChanged) {
    const rightResults = await binarySearchBalanceChanges(
      client,
      address,
      mid,
      hi,
      limit - results.length,
      rpcCallCount,
    );
    results.push(...rightResults);
  }

  if (leftChanged && results.length < limit) {
    const leftResults = await binarySearchBalanceChanges(
      client,
      address,
      lo,
      mid,
      limit - results.length,
      rpcCallCount,
    );
    results.push(...leftResults);
  }

  return results;
};

// Cached canonical search result. `transactions` holds the FULL deduped
// discovery list (not a page); request-time pagination slices into it.
// `budget` is the discovery limit the list was produced under — a deeper
// page may need a wider search than the cached entry covers.
type TxSearchCacheEntry = {
  expiresAt: number;
  result: AddressTransactionsResult;
  budget: number;
};

type AddressServiceDeps = {
  db: typeof import('../database/init').db;
  indexedAddresses: typeof import('../database/init').indexedAddresses;
  rpcManager: typeof import('./RpcManager').rpcManager;
  contractSourceService: typeof import('./ContractSourceService').contractSourceService;
};

const createAddressService = (deps: AddressServiceDeps) => {
  const { db, indexedAddresses, rpcManager, contractSourceService } = deps;

  // Bounded LRU: Map preserves insertion order, so reads re-insert to
  // refresh recency and oversize inserts evict the oldest key first.
  const txSearchCache = new Map<string, TxSearchCacheEntry>();

  const readTxSearchCache = (
    key: string,
    neededItems: number,
  ): AddressTransactionsResult | null => {
    const entry = txSearchCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      txSearchCache.delete(key);
      return null;
    }
    txSearchCache.delete(key);
    txSearchCache.set(key, entry);
    // A list shorter than its discovery budget means the search exhausted
    // the window — nothing more to find, any page is servable. Otherwise
    // the budget must cover the requested slice.
    if (
      entry.result.transactions.length < entry.budget ||
      entry.budget >= neededItems
    ) {
      return entry.result;
    }
    return null;
  };

  const writeTxSearchCache = (
    key: string,
    result: AddressTransactionsResult,
    budget: number,
  ): void => {
    txSearchCache.delete(key);
    txSearchCache.set(key, { expiresAt: Date.now() + TX_RESULT_TTL_MS, result, budget });
    while (txSearchCache.size > TX_RESULT_MAX_ENTRIES) {
      const oldest = txSearchCache.keys().next().value;
      if (oldest === undefined) break;
      txSearchCache.delete(oldest);
    }
  };

  const getPersistentDataFromDB = async (
    chainId: number,
    address: Address,
  ): Promise<PersistentAddressData | null> => {
    try {
      const result = await db
        .select({
          type: indexedAddresses.type,
          firstSeen: indexedAddresses.firstSeen,
          indexedAt: indexedAddresses.indexedAt,
        })
        .from(indexedAddresses)
        .where(and(eq(indexedAddresses.chainId, chainId), eq(indexedAddresses.address, address)))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      const isContract = row.type === 'contract';

      const persistentData: PersistentAddressData = {
        isContract,
        firstSeenBlock: row.firstSeen ?? undefined,
        firstSeenTimestamp: row.indexedAt ?? undefined,
      };

      if (isContract) {
        try {
          const sourceInfo = await contractSourceService.getContractSource(chainId, address);
          if (sourceInfo) {
            persistentData.contractName = sourceInfo.name;
            persistentData.verificationStatus = sourceInfo.verificationStatus;
            persistentData.sourceCodeAvailable = sourceInfo.sourceCode.length > 0;
            persistentData.compilerVersion = sourceInfo.compilerVersion;
            persistentData.isProxy = sourceInfo.isProxy;
            persistentData.proxyType = sourceInfo.proxyType;
            persistentData.implementationAddress = sourceInfo.implementationAddress;
          }
        } catch (error) {
          console.warn(`Failed to get contract source from cache for ${address}:`, error);
        }
      }

      return persistentData;
    } catch (error) {
      console.warn(`Failed to get persistent data from DB:`, error);
      return null;
    }
  };

  const savePersistentDataToDB = async (
    chainId: number,
    address: Address,
    persistentData: PersistentAddressData,
  ): Promise<void> => {
    try {
      await db
        .insert(indexedAddresses)
        .values({
          chainId,
          address,
          type: persistentData.isContract ? 'contract' : 'EOA',
          firstSeen: persistentData.firstSeenBlock ?? null,
          indexedAt: persistentData.firstSeenTimestamp ?? new Date(),
        })
        .onConflictDoUpdate({
          target: [indexedAddresses.chainId, indexedAddresses.address],
          set: {
            type: persistentData.isContract ? 'contract' : 'EOA',
            firstSeen: persistentData.firstSeenBlock ?? null,
            indexedAt: persistentData.firstSeenTimestamp ?? new Date(),
          },
        });
    } catch (error) {
      console.warn('Failed to save persistent data to DB:', error);
    }
  };

  const service = {
    getPersistentAddressData: async (
      chainId: number,
      address: Address,
    ): Promise<PersistentAddressData> => {
      try {
        const cached = await getPersistentDataFromDB(chainId, address);
        if (cached) {
          console.log(`📋 Using cached persistent data for ${address}`);
          return cached;
        }

        console.log(`🔍 Fetching persistent data for ${address}`);

        const client = await rpcManager.getClient(chainId);

        let code: string | undefined;
        try {
          code = await client.getCode({ address });
        } catch (error) {
          console.warn(`Failed to get contract code for ${address}:`, error);
          throw new Error(
            `Failed to determine contract status for ${address}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        const isContract = Boolean(code && code !== '0x' && code.length > 2);
        console.log(
          `🔍 Contract code check for ${address}: ${isContract ? 'CONTRACT' : 'EOA'} (code length: ${code?.length ?? 0})`,
        );

        const persistentData: PersistentAddressData = { isContract };

        if (isContract) {
          try {
            const creationInfo = await contractSourceService.getContractCreationInfo(
              chainId,
              address,
            );
            if (creationInfo) {
              persistentData.contractCreationTx = creationInfo.txHash;
              persistentData.contractCreationBlock = creationInfo.blockNumber;
              persistentData.contractCreator = creationInfo.creator;
            }
          } catch (error) {
            console.warn(`Failed to get contract creation info for ${address}:`, error);
          }

          try {
            const sourceInfo = await contractSourceService.getContractSource(chainId, address);
            if (sourceInfo) {
              persistentData.contractName = sourceInfo.name;
              persistentData.verificationStatus = sourceInfo.verificationStatus;
              persistentData.sourceCodeAvailable = sourceInfo.sourceCode.length > 0;
              persistentData.compilerVersion = sourceInfo.compilerVersion;
              persistentData.isProxy = sourceInfo.isProxy;
              persistentData.proxyType = sourceInfo.proxyType;
              persistentData.implementationAddress = sourceInfo.implementationAddress;
            }
          } catch (error) {
            console.warn(`Failed to get contract source for ${address}:`, error);
          }
        }

        persistentData.firstSeenTimestamp = new Date();

        await savePersistentDataToDB(chainId, address, persistentData);
        console.log(`✅ Cached persistent data to DB for ${address}`);

        return persistentData;
      } catch (error) {
        console.error(`Failed to get persistent data for ${address}:`, error);
        throw error;
      }
    },

    getAddressTransactions: async (
      chainId: number,
      address: Address,
      limit = 20,
      offset = 0,
      windowBlocks?: number,
      options?: {
        includeBalancePoints?: boolean;
        // Persisted deep-scan findings for this address (hydrated
        // DiscoveredTransaction envelopes from AddressScanService). When
        // present, the served page slices the heuristic ∪ findings union
        // and `total` is the merged count — the additive deep-scan
        // contract of the transactions endpoint.
        deepScanFindings?: readonly DiscoveredTransaction[];
      },
    ): Promise<AddressTransactionsResult> => {
      // An explicit window is clamped into [1, MAX]; undefined stays
      // undefined so the txCount-tiered default range applies.
      let requestedWindow: number | undefined;
      if (windowBlocks !== undefined) {
        requestedWindow = Math.min(
          Math.max(Math.trunc(windowBlocks), 1),
          MAX_SEARCH_WINDOW_BLOCKS,
        );
      }
      // Distinct windows are distinct searches; the txCount-tiered default
      // gets its own key so an explicit window never aliases it.
      const cacheKey = `${chainId}:${address.toLowerCase()}:${requestedWindow ?? 'default'}`;
      // Findings merge into the page, so the cached heuristic list may
      // need to cover deeper than the naked slice (injected findings push
      // heuristic items down the merged order).
      const neededItems = offset + limit + (options?.deepScanFindings?.length ?? 0);

      const cached = readTxSearchCache(cacheKey, neededItems);
      if (cached) {
        logger.info(
          `Serving cached tx search for ${address} on chain ${chainId}`,
        );
        // Points are computed from the cached FULL list on demand, so a
        // chart request always agrees with the list served from the same
        // cache entry (the merge, when present, applies to both).
        const mergedFull = options?.deepScanFindings
          ? mergeDiscoveredTransactions(cached.transactions, options.deepScanFindings)
          : cached.transactions;
        // Honesty floor: a heuristic 'none' verdict ('zero-balance',
        // 'search-failed') is false when persisted deep-scan findings are
        // being served — the honest verdict for a non-empty merged list
        // is 'partial' (the route lifts it to 'complete' only for a
        // finished genesis-anchored walk).
        const coverageFloor =
          options?.deepScanFindings && mergedFull.length > 0 && cached.coverage === 'none'
            ? 'partial'
            : cached.coverage;
        return {
          ...cached,
          coverage: coverageFloor,
          transactions: mergedFull.slice(offset, offset + limit),
          total: mergedFull.length,
          ...(options?.includeBalancePoints
            ? { balancePoints: computeDiscoveredBalancePoints(mergedFull, address) }
            : {}),
        };
      }

      const doSearch = async (budget: number): Promise<AddressTransactionsResult> => {
        const client = await rpcManager.getClient(chainId);
        const [txCount, latestBlock, currentBalance] = await Promise.all([
          client.getTransactionCount({ address }),
          client.getBlockNumber(),
          client.getBalance({ address }),
        ]);

        if (txCount === 0) {
          // The nonce counts OUTGOING transactions only. An address that
          // never sent anything may still have received transfers, which
          // this heuristic cannot detect — so never claim complete here.
          return {
            transactions: [],
            total: 0,
            method: 'binary-search',
            coverage: 'partial',
            reason: 'no-outgoing-transactions',
          };
        }

        if (currentBalance === 0n) {
          logger.info(
            `Skipping binary search for ${address}: balance is 0, ` +
            `algorithm relies on balance changes`,
          );
          return {
            transactions: [],
            total: 0,
            method: 'binary-search-skipped',
            coverage: 'none',
            reason: 'zero-balance',
          };
        }

        const searchRange = resolveSearchWindow(txCount, requestedWindow);
        const lo = latestBlock > searchRange ? latestBlock - searchRange : 0n;
        const rpcCallCount = { value: 3 };

        logger.info(
          `Binary search for ${address} on chain ${chainId}: ` +
          `txCount=${txCount}, range=[${lo}..${latestBlock}], ` +
          `window=${searchRange}, discoveryLimit=${budget}`,
        );

        const allTxs = await binarySearchBalanceChanges(
          client,
          address,
          lo,
          latestBlock,
          budget,
          rpcCallCount,
        );

        allTxs.sort((a, b) => {
          if (b.blockNumber > a.blockNumber) return 1;
          if (b.blockNumber < a.blockNumber) return -1;
          return 0;
        });

        const deduped = allTxs.filter((tx, i, arr) => i === 0 || tx.hash !== arr[i - 1].hash);

        logger.info(
          `Binary search complete: found ${deduped.length} txs, ` +
          `rpcCalls=${rpcCallCount.value}`,
        );

        // total reports what discovery actually found. The nonce counts
        // outgoing txs only and must never masquerade as the list length.
        return {
          transactions: deduped,
          total: deduped.length,
          method: 'binary-search',
          // A successful search is still partial: the algorithm only sees
          // native-token balance changes within the searched window.
          coverage: 'partial',
          searchWindowBlocks: Number(searchRange),
        };
      };

      try {
        const budget = discoveryBudgetFor(neededItems, 0);
        const result = await withTimeout(
          doSearch(budget),
          TX_SEARCH_TIMEOUT_MS,
          'Address transaction search',
        );
        // Cache the canonical full-list result; failures stay uncached so
        // the next request retries instead of memorizing the error.
        writeTxSearchCache(cacheKey, result, budget);
        // The merge is applied at read time (the cache stays heuristic
        // only) so persisted findings surface even on heuristic-skip
        // paths like zero-balance.
        const mergedFull = options?.deepScanFindings
          ? mergeDiscoveredTransactions(result.transactions, options.deepScanFindings)
          : result.transactions;
        // Same honesty floor as the cached path: served findings disprove
        // a heuristic 'none' verdict.
        const coverageFloor =
          options?.deepScanFindings && mergedFull.length > 0 && result.coverage === 'none'
            ? 'partial'
            : result.coverage;
        return {
          ...result,
          coverage: coverageFloor,
          transactions: mergedFull.slice(offset, offset + limit),
          total: mergedFull.length,
          ...(options?.includeBalancePoints
            ? { balancePoints: computeDiscoveredBalancePoints(mergedFull, address) }
            : {}),
        };
      } catch (error) {
        logger.error({ err: error }, `Binary search failed for ${address}`);
        return {
          transactions: [],
          total: 0,
          method: 'fallback',
          coverage: 'none',
          reason: 'search-failed',
          // Shape consistency: a failed search discovered nothing, so the
          // series is empty rather than absent.
          ...(options?.includeBalancePoints ? { balancePoints: [] } : {}),
        };
      }
    },

    clearTransactionsCache: (): void => {
      txSearchCache.clear();
    },

    getAddressInfo: async (chainId: number, address: Address): Promise<AddressInfo> => {
      const persistentData = await service.getPersistentAddressData(chainId, address);

      return {
        chainId,
        address,
        ...persistentData,
        lastQueried: new Date(),
      };
    },
  };

  return service;
};

export type AddressService = ReturnType<typeof createAddressService>;
export { createAddressService };

export const addressService = createAddressService({
  db,
  indexedAddresses,
  rpcManager,
  contractSourceService,
});
