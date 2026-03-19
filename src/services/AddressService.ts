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
 */
export type AddressInfo = PersistentAddressData & {
  chainId: number;
  address: Address;
  balance: string;
  transactionCount: number;
  lastQueried: Date;
};

type DiscoveredTransaction = {
  hash: string;
  blockNumber: bigint;
  fromAddress: string;
  toAddress: string;
  value: string;
  timestamp: string;
};

const SCAN_THRESHOLD = 64n;
const MAX_RPC_CALLS = 200;
const BATCH_CONCURRENCY = 8;
const TX_SEARCH_TIMEOUT_MS = 30_000;

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

const getBalanceAt = async (
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
): Promise<bigint> =>
  client.getBalance({ address, blockNumber });

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
  const lowerAddr = address.toLowerCase();
  const results: DiscoveredTransaction[] = [];

  const blockNumbers: bigint[] = [];
  for (let b = toBlock; b >= fromBlock && blockNumbers.length < 256; b--) {
    blockNumbers.push(b);
  }

  for (let i = 0; i < blockNumbers.length; i += BATCH_CONCURRENCY) {
    if (results.length >= limit || rpcCallCount.value >= MAX_RPC_CALLS) break;

    const batch = blockNumbers.slice(i, i + BATCH_CONCURRENCY);
    const blocks = await Promise.all(
      batch.map(async (bn) => {
        rpcCallCount.value++;
        return client
          .getBlock({ blockNumber: bn, includeTransactions: true })
          .catch(() => null);
      }),
    );

    for (const block of blocks) {
      if (!block?.transactions || results.length >= limit) continue;
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
            timestamp: new Date(
              Number(block.timestamp) * 1000,
            ).toISOString(),
          });
        }
      }
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
      client, address, mid, hi, limit - results.length, rpcCallCount,
    );
    results.push(...rightResults);
  }

  if (leftChanged && results.length < limit) {
    const leftResults = await binarySearchBalanceChanges(
      client, address, lo, mid, limit - results.length, rpcCallCount,
    );
    results.push(...leftResults);
  }

  return results;
};

type AddressServiceDeps = {
  db: typeof import('../database/init').db;
  indexedAddresses: typeof import('../database/init').indexedAddresses;
  rpcManager: typeof import('./RpcManager').rpcManager;
  contractSourceService: typeof import('./ContractSourceService').contractSourceService;
};

const createAddressService = (deps: AddressServiceDeps) => {
  const { db, indexedAddresses, rpcManager, contractSourceService } = deps;

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
        .where(
          and(
            eq(indexedAddresses.chainId, chainId),
            eq(indexedAddresses.address, address),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      const isContract = row.type === 'contract';

      const persistentData: PersistentAddressData = {
        isContract,
        firstSeenBlock: row.firstSeen || undefined,
        firstSeenTimestamp: row.indexedAt || undefined,
      };

      if (isContract) {
        try {
          const sourceInfo = await contractSourceService.getContractSource(
            chainId,
            address,
          );
          if (sourceInfo) {
            persistentData.contractName = sourceInfo.name;
            persistentData.verificationStatus = sourceInfo.verificationStatus;
            persistentData.sourceCodeAvailable
              = sourceInfo.sourceCode.length > 0;
            persistentData.compilerVersion = sourceInfo.compilerVersion;
            persistentData.isProxy = sourceInfo.isProxy;
            persistentData.proxyType = sourceInfo.proxyType;
            persistentData.implementationAddress
              = sourceInfo.implementationAddress;
          }
        }
        catch (error) {
          console.warn(
            `Failed to get contract source from cache for ${address}:`,
            error,
          );
        }
      }

      return persistentData;
    }
    catch (error) {
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
          firstSeen: persistentData.firstSeenBlock || null,
          indexedAt: persistentData.firstSeenTimestamp || new Date(),
        })
        .onConflictDoUpdate({
          target: [indexedAddresses.chainId, indexedAddresses.address],
          set: {
            type: persistentData.isContract ? 'contract' : 'EOA',
            firstSeen: persistentData.firstSeenBlock || null,
            indexedAt: persistentData.firstSeenTimestamp || new Date(),
          },
        });
    }
    catch (error) {
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
        }
        catch (error) {
          console.warn(`Failed to get contract code for ${address}:`, error);
          throw new Error(
            `Failed to determine contract status for ${address}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const isContract = Boolean(code && code !== '0x' && code.length > 2);
        console.log(
          `🔍 Contract code check for ${address}: ${isContract ? 'CONTRACT' : 'EOA'} (code length: ${code?.length || 0})`,
        );

        const persistentData: PersistentAddressData = { isContract };

        if (isContract) {
          try {
            const creationInfo
              = await contractSourceService.getContractCreationInfo(
                chainId,
                address,
              );
            if (creationInfo) {
              persistentData.contractCreationTx = creationInfo.txHash;
              persistentData.contractCreationBlock = creationInfo.blockNumber;
              persistentData.contractCreator = creationInfo.creator;
            }
          }
          catch (error) {
            console.warn(
              `Failed to get contract creation info for ${address}:`,
              error,
            );
          }

          try {
            const sourceInfo = await contractSourceService.getContractSource(
              chainId,
              address,
            );
            if (sourceInfo) {
              persistentData.contractName = sourceInfo.name;
              persistentData.verificationStatus = sourceInfo.verificationStatus;
              persistentData.sourceCodeAvailable
                = sourceInfo.sourceCode.length > 0;
              persistentData.compilerVersion = sourceInfo.compilerVersion;
              persistentData.isProxy = sourceInfo.isProxy;
              persistentData.proxyType = sourceInfo.proxyType;
              persistentData.implementationAddress
                = sourceInfo.implementationAddress;
            }
          }
          catch (error) {
            console.warn(`Failed to get contract source for ${address}:`, error);
          }
        }

        persistentData.firstSeenTimestamp = new Date();

        await savePersistentDataToDB(chainId, address, persistentData);
        console.log(`✅ Cached persistent data to DB for ${address}`);

        return persistentData;
      }
      catch (error) {
        console.error(`Failed to get persistent data for ${address}:`, error);
        throw error;
      }
    },

    getAddressTransactions: async (
      chainId: number,
      address: Address,
      limit = 20,
      offset = 0,
    ): Promise<{ transactions: DiscoveredTransaction[]; total: number; method: string }> => {
      const doSearch = async (): Promise<{ transactions: DiscoveredTransaction[]; total: number; method: string }> => {
        const client = await rpcManager.getClient(chainId);
        const [txCount, latestBlock, currentBalance] = await Promise.all([
          client.getTransactionCount({ address }),
          client.getBlockNumber(),
          client.getBalance({ address }),
        ]);

        if (txCount === 0) {
          return { transactions: [], total: 0, method: 'binary-search' };
        }

        if (currentBalance === 0n) {
          logger.info(
            `Skipping binary search for ${address}: balance is 0, `
            + `algorithm relies on balance changes`,
          );
          return {
            transactions: [],
            total: Number(txCount),
            method: 'binary-search-skipped',
          };
        }

        const searchRange = getSearchRange(txCount);
        const lo = latestBlock > searchRange ? latestBlock - searchRange : 0n;
        const rpcCallCount = { value: 3 };

        const fetchLimit = offset + limit;

        logger.info(
          `Binary search for ${address} on chain ${chainId}: `
          + `txCount=${txCount}, range=[${lo}..${latestBlock}], fetchLimit=${fetchLimit}`,
        );

        const allTxs = await binarySearchBalanceChanges(
          client, address, lo, latestBlock, fetchLimit, rpcCallCount,
        );

        allTxs.sort((a, b) => {
          if (b.blockNumber > a.blockNumber) return 1;
          if (b.blockNumber < a.blockNumber) return -1;
          return 0;
        });

        const deduped = allTxs.filter(
          (tx, i, arr) => i === 0 || tx.hash !== arr[i - 1].hash,
        );

        const paged = deduped.slice(offset, offset + limit);

        logger.info(
          `Binary search complete: found ${deduped.length} txs, `
          + `returning ${paged.length} (offset=${offset}), rpcCalls=${rpcCallCount.value}`,
        );

        return {
          transactions: paged,
          total: Number(txCount),
          method: 'binary-search',
        };
      };

      try {
        return await withTimeout(doSearch(), TX_SEARCH_TIMEOUT_MS, 'Address transaction search');
      }
      catch (error) {
        logger.error({ err: error }, `Binary search failed for ${address}`);
        return {
          transactions: [],
          total: 0,
          method: 'fallback',
        };
      }
    },

    getAddressInfo: async (
      chainId: number,
      address: Address,
    ): Promise<AddressInfo> => {
      const persistentData = await service.getPersistentAddressData(
        chainId,
        address,
      );

      return {
        chainId,
        address,
        balance: '0',
        transactionCount: 0,
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
