import { rpcManager } from './RpcManager';
import { db, contractCreationInfo, contractSources } from '../database/init';
import { eq, and, sql } from 'drizzle-orm';
import { createRetryableRpcCall } from '../utils/errorHandler';
import { createLogger } from '../server/logger';

const logger = createLogger('contract-source-service');
import { addressEquals, formatAddress, isValidAddress } from '../utils/address';
import type { Address } from 'viem';
import { analyzeRpcError, shouldRetryRpcError } from '../utils/rpcErrorHandler';

// ABI for the implementation() view function exposed by beacon contracts
const IMPLEMENTATION_ABI = [
  {
    inputs: [],
    name: 'implementation',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ABI for the masterCopy() view function exposed by Gnosis Safe proxies
const MASTER_COPY_ABI = [
  {
    inputs: [],
    name: 'masterCopy',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Guard for readContract() results: must be a non-zero 0x-prefixed 20-byte address
const isValidResultAddress = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);

const MS_PER_HOUR = 1000 * 60 * 60;

// Cache TTL tiers (in hours) for contract source records.
// Verified non-proxy source code is immutable on-chain, so it caches long.
export const VERIFIED_CACHE_TTL_HOURS = 24 * 30;
// A proxy's implementation can change at any time via an upgrade, so
// "immutable" does not hold for proxy entries — keep them short-lived
// even when the proxy itself is verified.
export const PROXY_CACHE_TTL_HOURS = 24;
// Unverified contracts may get verified later; re-check soon. The lookup
// is one cheap Sourcify/Blockscan round trip, and a verification done in
// another tab should surface here within the hour — the contract page's
// Force Refresh covers the in-between window.
export const UNVERIFIED_CACHE_TTL_HOURS = 1;
// Failed contract-creation searches must not stick forever: a contract
// queried seconds before its deployment would otherwise stay "not found"
// until the row is manually cleared.
export const CREATION_FAILURE_CACHE_TTL_HOURS = 24;

type CallTracerCall = {
  type: string;
  to?: string;
  calls?: CallTracerCall[];
};

type AbiFunction = {
  type: 'function';
  name: string;
  inputs: Array<{ type: string; name?: string }>;
  outputs: Array<{ type: string; name?: string }>;
  stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
};

type AbiEvent = {
  type: 'event';
  name: string;
  inputs: Array<{ type: string; name?: string; indexed?: boolean }>;
};

type AbiError = {
  type: 'error';
  name: string;
  inputs: Array<{ type: string; name?: string }>;
};

export type ProxyType =
  | 'transparent'
  | 'uups'
  | 'beacon'
  | 'minimal'
  | 'zeppelinos'
  | 'gnosis-safe'
  | 'diamond'
  | 'eip1167'
  | 'unknown';

export type ContractFile = {
  filename: string;
  content: string;
};

export type ContractSource = {
  chainId: number;
  address: Address;
  name?: string;
  compilerVersion?: string;
  // EVM target version from the compile settings (e.g. 'shanghai');
  // persisted in contract_sources.evm_version, read back on cache hits.
  evmVersion?: string;
  optimizationEnabled?: boolean;
  optimizationRuns?: number;
  sourceCode: string;
  sourceFiles?: ContractFile[];
  abi: string;
  constructorArguments?: string;
  verificationStatus: 'verified' | 'unverified' | 'partial';
  // Mirrors the frontend union: 'sourcify' and 'blockscan' are the two
  // remote verifiers (the latter is the vscode.blockscan.com source
  // cache); 'manual' marks locally-pasted trust, 'local-compile' a real
  // local recompile match (CompileVerifyService), 'unknown'/'none' missing
  // provenance.
  verificationSource:
    | 'sourcify'
    | 'blockscan'
    | 'manual'
    | 'local-compile'
    | 'unknown'
    | 'none';
  verifiedAt?: Date;
  lastChecked: Date;
  isProxy?: boolean;
  proxyType?: ProxyType;
  implementationAddress?: Address;
  // Full facet list for multi-implementation proxies (EIP-2535 diamonds).
  // Persisted as a JSON array in contract_sources.implementation_addresses,
  // so cache hits read the facet list back instead of degrading a diamond
  // to its facet[0]; rows written before the column existed read as
  // undefined until the next refetch repopulates them.
  implementationAddresses?: Address[];
  implementationContract?: ContractSource;
  creationTxHash?: string;
  creationBlockNumber?: number;
  creator?: string;
};

export type ContractCreationInfo = {
  txHash: string;
  blockNumber: number;
  creator: string;
  timestamp: number;
  gasUsed: bigint;
  gasPrice: bigint;
};

export class ContractSourceService {
  // 获取合约创建信息
  async getContractCreationInfo(
    chainId: number,
    address: Address,
  ): Promise<ContractCreationInfo | null> {
    logger.info({ address, chainId }, 'Starting contract creation search');

    try {
      // 1. 先从数据库查找缓存的创建信息
      logger.info('Step 1: Checking database cache for creation info');
      try {
        const cachedInfo = await this.getCachedCreationInfo(chainId, address);
        if (cachedInfo) {
          logger.info(
            { address, txHash: cachedInfo.txHash, blockNumber: cachedInfo.blockNumber },
            'Found cached creation info',
          );
          return cachedInfo;
        }
        logger.info('No cached creation info found, starting fresh search');
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('CACHED_FAILURE:')) {
          const reason = error.message.replace('CACHED_FAILURE:', '');
          logger.info({ address, reason }, 'Found cached failed search');
          return null; // 直接返回null，不重新搜索
        }
        // 其他错误继续处理
        logger.warn({ err: error, address }, 'Cache check failed');
      }

      // 2. 如果缓存中没有，执行搜索
      logger.info({ address }, 'Step 2: Checking if address is a contract');
      const isContract = await this.isContractAddress(chainId, address);
      logger.info({ address, isContract }, 'Contract check result');

      if (!isContract) {
        logger.info({ address }, 'Address is not a contract');
        // 缓存失败结果，避免重复检查
        await this.cacheFailedSearch(chainId, address, 'not_a_contract');
        return null;
      }

      // 3. 使用二分法查找合约创建的区块
      logger.info({ address }, 'Step 3: Starting binary search for creation block');
      const creationBlock = await this.findContractCreationBlock(chainId, address);
      logger.info({ address, creationBlock }, 'Binary search result');

      if (!creationBlock) {
        logger.info({ address }, 'Could not find creation block');
        // 缓存失败结果
        await this.cacheFailedSearch(chainId, address, 'creation_block_not_found');
        return null;
      }

      // 4. 在创建区块中查找创建交易
      logger.info(
        { address, creationBlock },
        'Step 4: Searching for creation transaction in block',
      );
      const creationTx = await this.findContractCreationTransaction(
        chainId,
        address,
        creationBlock,
      );
      logger.info({ address, creationTx: creationTx?.txHash }, 'Transaction search result');

      if (!creationTx) {
        logger.info({ address, creationBlock }, 'Could not find creation transaction in block');
        // 缓存失败结果
        await this.cacheFailedSearch(chainId, address, 'creation_transaction_not_found');
        return null;
      }

      logger.info(
        { address, txHash: creationTx.txHash, blockNumber: creationTx.blockNumber },
        'Successfully found creation info',
      );

      // 5. 保存到数据库缓存
      logger.info('Step 5: Caching creation info to database');
      await this.cacheCreationInfo(chainId, address, creationTx);
      logger.info('Creation info cached successfully');

      return creationTx;
    } catch (error) {
      logger.error({ err: error, address }, 'Failed to get contract creation info');
      return null;
    }
  }

  // 从数据库获取缓存的创建信息
  private async getCachedCreationInfo(
    chainId: number,
    address: Address,
  ): Promise<ContractCreationInfo | null> {
    try {
      const result = await db
        .select()
        .from(contractCreationInfo)
        .where(
          and(eq(contractCreationInfo.chainId, chainId), eq(contractCreationInfo.address, address)),
        )
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const row = result[0];

      // 检查是否是失败的搜索记录
      if (!row.creationTxHash) {
        // Failure rows expire after CREATION_FAILURE_CACHE_TTL_HOURS: a
        // contract queried seconds before deployment/verification must not
        // stay "not found" forever. lastUpdated is the failure timestamp.
        const ageHours = (Date.now() - (row.lastUpdated?.getTime() ?? 0)) / MS_PER_HOUR;
        if (ageHours < CREATION_FAILURE_CACHE_TTL_HOURS) {
          logger.info(
            { address, reason: row.creationMethod ?? 'unknown', ageHours: ageHours.toFixed(1) },
            'Found fresh cached failed search',
          );
          // 抛出特殊错误表示这是缓存的失败结果
          throw new Error(`CACHED_FAILURE:${row.creationMethod ?? 'unknown'}`);
        }

        // Expired failure entry: drop it so the fresh search below can run
        // and re-cache (cacheFailedSearch skips inserts when a row exists).
        logger.info(
          { address, reason: row.creationMethod ?? 'unknown', ageHours: ageHours.toFixed(1) },
          'Cached failed search expired, removing entry',
        );
        await db
          .delete(contractCreationInfo)
          .where(
            and(
              eq(contractCreationInfo.chainId, chainId),
              eq(contractCreationInfo.address, address),
            ),
          );
        return null;
      }

      return {
        txHash: row.creationTxHash,
        blockNumber: Number(row.creationBlockNumber),
        creator: row.creatorAddress ? String(row.creatorAddress) : '',
        timestamp: row.creationTimestamp ?? 0,
        gasUsed: BigInt(0),
        gasPrice: BigInt(0),
      };
    } catch (error) {
      // The failure sentinel must reach the caller's CACHED_FAILURE handler
      // so a fresh failure row short-circuits the search; swallowing it here
      // would make the failure cache a no-op.
      if (error instanceof Error && error.message.startsWith('CACHED_FAILURE:')) {
        throw error;
      }
      logger.warn({ err: error, address }, 'Failed to get cached creation info');
      return null;
    }
  }

  // 缓存创建信息到数据库
  private async cacheCreationInfo(
    chainId: number,
    address: Address,
    creationInfo: ContractCreationInfo,
  ): Promise<void> {
    try {
      // 先检查是否已存在
      const existing = await db
        .select()
        .from(contractCreationInfo)
        .where(
          and(eq(contractCreationInfo.chainId, chainId), eq(contractCreationInfo.address, address)),
        )
        .limit(1);

      if (existing.length > 0) {
        logger.info({ address }, 'Creation info already cached, skipping');
        return;
      }

      await db.insert(contractCreationInfo).values({
        chainId,
        address,
        creationTxHash: creationInfo.txHash as `0x${string}`,
        creationBlockNumber: BigInt(creationInfo.blockNumber),
        creationTimestamp: creationInfo.timestamp,
        creatorAddress: creationInfo.creator ? formatAddress(creationInfo.creator) : null,
        factoryAddress: null,
        creationMethod: 'binary_search',
        lastUpdated: new Date(),
      });
    } catch (error) {
      logger.warn({ err: error, address }, 'Failed to cache creation info');
      // 不抛出错误，缓存失败不应该影响主要功能
    }
  }

  // 缓存失败的搜索结果
  private async cacheFailedSearch(
    chainId: number,
    address: Address,
    reason: string,
  ): Promise<void> {
    try {
      // 先检查是否已存在
      const existing = await db
        .select()
        .from(contractCreationInfo)
        .where(
          and(eq(contractCreationInfo.chainId, chainId), eq(contractCreationInfo.address, address)),
        )
        .limit(1);

      if (existing.length > 0) {
        return; // 已存在记录，不重复插入
      }

      // 插入失败记录（creationTxHash为null表示失败）
      await db.insert(contractCreationInfo).values({
        chainId,
        address,
        creationTxHash: null, // null表示搜索失败
        creationBlockNumber: null,
        creatorAddress: null,
        factoryAddress: null,
        creationMethod: reason,
        lastUpdated: new Date(),
      });
      logger.info({ address, reason }, 'Cached failed search');
    } catch (error) {
      logger.warn({ err: error, address }, 'Failed to cache failed search');
    }
  }

  // 使用二分法查找合约创建的区块号
  private async findContractCreationBlock(
    chainId: number,
    address: Address,
  ): Promise<number | null> {
    const client = await rpcManager.getClient(chainId);
    if (!client) {
      throw new Error(`No RPC client available for chain ${chainId}`);
    }

    try {
      // 获取当前最新区块号
      const getLatestBlock = createRetryableRpcCall(async () => {
        return await client.getBlockNumber();
      }, chainId);

      const latestBlockNumber = await getLatestBlock();

      // 动态调整搜索范围
      // 基于测试结果，扩大初始搜索范围以覆盖更多历史区块
      const searchRange = 20000000n; // 开始搜索最近2000万个区块
      let left = latestBlockNumber > searchRange ? latestBlockNumber - searchRange : 0n;
      let right = latestBlockNumber;
      let creationBlock: number | null = null;

      // 如果搜索范围仍然很大，先检查合约在最早区块是否存在
      if (left > 1000000n) {
        logger.info({ earlyBlock: Number(left) }, 'Checking if contract exists at early block');
        const earlyCode = createRetryableRpcCall(async () => {
          return await client.getCode({
            address,
            blockNumber: left,
          });
        }, chainId);

        const earlyCodeResult = await earlyCode();
        const hasEarlyCode =
          earlyCodeResult && earlyCodeResult !== '0x' && earlyCodeResult.length > 2;

        if (hasEarlyCode) {
          logger.info(
            { block: Number(left) },
            'Contract already exists at block, expanding search range',
          );
          // 如果在搜索起点就存在，继续扩大搜索范围
          // 基于RPC测试，我们知道10M以下的区块会失败，所以限制搜索范围
          const maxSafeRange = 50000000n; // 最多搜索5000万个区块
          const expandedRange = Math.min(Number(maxSafeRange), Number(latestBlockNumber));
          left = latestBlockNumber - BigInt(expandedRange);
          logger.info(
            { expandedRange, left: Number(left), right: Number(right) },
            'Expanded search range',
          );
        }
      }

      logger.info(
        { address, left: left.toString(), right: right.toString() },
        'Starting binary search for contract creation',
      );

      // 二分查找
      let iterations = 0;
      while (left <= right) {
        iterations++;
        const mid = (left + right) / 2n;
        const midNumber = Number(mid);

        logger.info(
          { iterations, midNumber, left: left.toString(), right: right.toString() },
          'Binary search iteration',
        );

        try {
          // 检查在 mid 区块时合约是否存在
          const getCode = createRetryableRpcCall(async () => {
            return await client.getCode({
              address,
              blockNumber: mid,
            });
          }, chainId);

          const code = await getCode();
          const hasCode = code && code !== '0x' && code.length > 2;

          logger.info({ midNumber, hasCode }, 'Block check result');

          if (hasCode) {
            // 合约存在，创建区块在 mid 或之前
            creationBlock = midNumber;
            right = mid - 1n;
            logger.info(
              { midNumber, left: left.toString(), right: right.toString() },
              'Contract exists at block, searching earlier',
            );
          } else {
            // 合约不存在，创建区块在 mid 之后
            left = mid + 1n;
            logger.info(
              { midNumber, left: left.toString(), right: right.toString() },
              `Contract doesn't exist at block, searching later`,
            );
          }
        } catch (error) {
          logger.error({ err: error, midNumber }, 'Error checking block');

          // 分析RPC错误并提供详细反馈
          const rpcClient = await rpcManager.getClient(chainId);
          const rpcUrl = rpcClient.transport?.url ?? 'unknown';

          const errorDetails = analyzeRpcError(error, {
            blockNumber: midNumber,
            contractAddress: address,
            rpcUrl,
            chainId,
          });

          logger.info(
            {
              error: errorDetails.error,
              suggestion: errorDetails.suggestion,
              retryable: errorDetails.retryable,
              castCommand: errorDetails.castCommand,
            },
            'RPC error analysis',
          );

          // 如果是可重试的错误，记录但继续搜索
          if (shouldRetryRpcError(errorDetails)) {
            logger.info('Error is retryable, continuing search');
          } else {
            logger.info('Error is not retryable, may affect search accuracy');
          }

          // 无论如何，假设合约在此区块不存在，向右搜索
          logger.info(`Due to error, assuming contract doesn't exist and searching later`);
          left = mid + 1n;
        }

        // 防止无限循环，但允许更大的搜索范围
        if (right - left > 50000000n) {
          logger.warn('Binary search range too large (>50M blocks), stopping');
          break;
        }

        // 如果搜索了超过30次迭代，停止搜索
        if (iterations > 30) {
          logger.warn('Binary search iterations exceeded limit, stopping');
          break;
        }

        // 检查是否还有搜索空间
        if (left > right) {
          logger.info(
            { left: left.toString(), right: right.toString() },
            'Search space exhausted, stopping search',
          );
          break;
        }
      }

      logger.info({ iterations, creationBlock }, 'Binary search completed');
      logger.info({ creationBlock }, 'Final result');

      if (creationBlock !== null) {
        logger.info({ creationBlock }, 'Found contract creation block');

        // 验证找到的创建区块是否正确
        logger.info({ creationBlock }, 'Verifying creation block');
        try {
          // 检查前一个区块合约是否不存在
          const prevCode = createRetryableRpcCall(async () => {
            return await client.getCode({
              address,
              blockNumber: BigInt(creationBlock - 1),
            });
          }, chainId);

          const prevCodeResult = await prevCode();
          const hasPrevCode =
            prevCodeResult && prevCodeResult !== '0x' && prevCodeResult.length > 2;

          logger.info({ block: creationBlock - 1, hasPrevCode }, 'Previous block check result');

          if (hasPrevCode) {
            logger.warn(
              'Contract already exists in previous block, may not be the true creation block',
            );
          }
        } catch (error) {
          logger.info({ err: error }, 'Could not verify previous block');
        }
      }

      return creationBlock;
    } catch (error) {
      logger.error({ err: error }, 'Error in binary search');
      return null;
    }
  }

  // 在指定区块中查找合约创建交易
  private async findContractCreationTransaction(
    chainId: number,
    contractAddress: Address,
    blockNumber: number,
  ): Promise<ContractCreationInfo | null> {
    const client = await rpcManager.getClient(chainId);
    if (!client) {
      throw new Error(`No RPC client available for chain ${chainId}`);
    }

    try {
      // 获取区块信息
      const getBlock = createRetryableRpcCall(async () => {
        return await client.getBlock({
          blockNumber: BigInt(blockNumber),
          includeTransactions: true,
        });
      }, chainId);

      const block = await getBlock();

      if (!block?.transactions) {
        return null;
      }

      logger.info(
        { txCount: block.transactions.length, blockNumber, contractAddress },
        'Searching transactions in block for contract creation',
      );

      // 遍历区块中的所有交易
      for (let i = 0; i < block.transactions.length; i++) {
        const tx = block.transactions[i];
        if (typeof tx === 'string') continue;

        logger.info(
          {
            index: i + 1,
            total: block.transactions.length,
            txHash: tx.hash,
            from: tx.from,
            to: tx.to,
          },
          'Checking transaction',
        );

        try {
          // 检查是否为合约创建交易（to 为 null 或 undefined）
          if (tx.to === null || tx.to === undefined) {
            logger.info({ txHash: tx.hash }, 'Found contract creation tx');

            // 获取交易回执以确认合约地址
            const getReceipt = createRetryableRpcCall(async () => {
              return await client.getTransactionReceipt({ hash: tx.hash });
            }, chainId);

            const receipt = await getReceipt();
            logger.info(
              { contractAddress: receipt.contractAddress?.toLowerCase() },
              'Receipt contract address',
            );

            if (
              receipt?.contractAddress &&
              addressEquals(receipt.contractAddress, contractAddress)
            ) {
              logger.info('Found matching contract creation transaction');
              logger.info(
                { txHash: tx.hash, contractAddress },
                'Contract creation transaction found',
              );

              return {
                txHash: tx.hash,
                blockNumber: Number(block.number),
                creator: tx.from,
                timestamp: Number(block.timestamp),
                gasUsed: receipt.gasUsed,
                gasPrice: tx.gasPrice ?? 0n,
              };
            } else {
              logger.info(
                {
                  expected: contractAddress,
                  got: receipt.contractAddress ? formatAddress(receipt.contractAddress) : 'null',
                },
                `Contract address doesn't match`,
              );
            }
          } else {
            // 检查是否是通过工厂合约或其他方式创建的
            logger.info('Checking if tx creates contract via factory or internal transaction');

            const getReceipt = createRetryableRpcCall(async () => {
              return await client.getTransactionReceipt({ hash: tx.hash });
            }, chainId);

            const receipt = await getReceipt();

            // 方法1: 检查交易日志中是否有我们目标合约的相关事件
            const hasContractEvent = receipt.logs.some(log =>
              addressEquals(log.address || '', contractAddress),
            );

            if (hasContractEvent) {
              logger.info({ txHash: tx.hash }, 'Found factory/internal creation');
              logger.info({ contractAddress }, 'Transaction created events for contract');
              return {
                txHash: tx.hash,
                blockNumber: Number(block.number),
                creator: tx.from,
                timestamp: Number(block.timestamp),
                gasUsed: receipt.gasUsed,
                gasPrice: tx.gasPrice ?? 0n,
              };
            }

            // 方法2: 检查是否有CREATE2或CREATE操作码创建了这个合约
            logger.info('Checking for internal contract creation via trace');

            try {
              type CallTrace = {
                type: string;
                to?: string;
                calls?: CallTrace[];
              };
              // debug_traceTransaction is a Geth-specific debug method
              const trace = await (
                client as unknown as {
                  request: (args: { method: string; params: unknown[] }) => Promise<CallTrace>;
                }
              ).request({
                method: 'debug_traceTransaction',
                params: [tx.hash, { tracer: 'callTracer' }],
              });

              // 递归检查trace中的所有调用，查找合约创建
              const findContractCreation = (call: CallTracerCall): boolean => {
                // 检查当前调用是否创建了目标合约
                if (call.type === 'CREATE' || call.type === 'CREATE2') {
                  if (addressEquals(call.to ?? '', contractAddress)) {
                    logger.info(
                      { contractAddress },
                      'Found CREATE/CREATE2 operation creating contract',
                    );
                    return true;
                  }
                }

                // 递归检查子调用
                if (call.calls && Array.isArray(call.calls)) {
                  return call.calls.some(findContractCreation);
                }

                return false;
              };

              if (findContractCreation(trace)) {
                logger.info({ txHash: tx.hash }, 'Found internal contract creation');
                return {
                  txHash: tx.hash,
                  blockNumber: Number(block.number),
                  creator: tx.from,
                  timestamp: Number(block.timestamp),
                  gasUsed: receipt.gasUsed,
                  gasPrice: tx.gasPrice ?? 0n,
                };
              }
            } catch (traceError) {
              logger.info({ err: traceError }, 'debug_traceTransaction not supported or failed');
              // 如果trace不支持，继续检查其他方法
            }
          }
        } catch (error) {
          logger.warn({ err: error, txHash: tx.hash }, 'Error processing transaction');

          // 分析RPC错误
          const rpcClient = await rpcManager.getClient(chainId);
          const rpcUrl = rpcClient.transport?.url ?? 'unknown';

          const errorDetails = analyzeRpcError(error, {
            contractAddress,
            rpcUrl,
            chainId,
          });

          logger.info(
            { error: errorDetails.error, castCommand: errorDetails.castCommand },
            'Transaction check error analysis',
          );

          continue;
        }
      }

      logger.info({ blockNumber }, 'No contract creation transaction found in block');
      return null;
    } catch (error) {
      logger.error({ err: error }, 'Error finding contract creation transaction');
      return null;
    }
  }

  async getContractSource(chainId: number, address: Address): Promise<ContractSource | null> {
    try {
      const cached = await this.getFromDatabase(chainId, address);
      logger.info(
        {
          chainId,
          address,
          cached: cached
            ? {
                verificationStatus: cached.verificationStatus,
                hasSource: !!cached.sourceCode,
                isProxy: cached.isProxy,
              }
            : null,
        },
        'getContractSource: cache lookup result',
      );
      // Manual marks ('verificationSource: manual', written by the
      // verify/manual route) are served from this DB shortcut like any
      // verified row — including ABI-only marks whose sourceCode is ''.
      // They must not permanently block remote verification though: once
      // the mark is older than the unverified TTL, the GET re-probes
      // Sourcify once — a remote match overwrites the manual row
      // (cryptographic verification supersedes local trust), a miss
      // keeps the mark and refreshes lastChecked so the cadence stays
      // roughly one probe per hour.
      if (cached?.verificationSource === 'manual') {
        if (this.isCacheValid(cached)) {
          return cached;
        }
        const remote = await this.fetchFromSourcify(chainId, address);
        if (remote) {
          await this.saveToDatabase(remote);
          return this.enhanceWithProxyInfo(remote);
        }
        await this.refreshManualMark(chainId, address);
        cached.lastChecked = new Date();
        return cached;
      }

      if (cached?.verificationStatus === 'verified' && cached.sourceCode) {
        if (cached.isProxy) {
          return await this.enhanceWithProxyInfo(cached);
        }
        return cached;
      }

      const sourcifyResult = await this.fetchFromSourcify(chainId, address);
      if (sourcifyResult) {
        await this.saveToDatabase(sourcifyResult);
        return this.enhanceWithProxyInfo(sourcifyResult);
      }

      const blockscanResult = await this.fetchFromBlockscan(chainId, address);
      if (blockscanResult) {
        await this.saveToDatabase(blockscanResult);
        return this.enhanceWithProxyInfo(blockscanResult);
      }

      // Both verifiers missed. Before caching an "unverified" record, make
      // sure the address even has deployed code (same check as
      // getContractCreationInfo): an EOA must surface as null — the routes
      // translate that into 404 not_a_contract — and must not poison the
      // source cache. Drop any stale row a pre-fix lookup may have written.
      // An RPC failure is NOT "not a contract" though: it keeps the legacy
      // unverified fallback so a flaky node never hard-404s real contracts.
      try {
        const client = await rpcManager.getClient(chainId);
        const code = await client.getCode({ address });
        if (!code || code === '0x' || code.length <= 2) {
          logger.info(
            { chainId, address },
            'Address has no deployed code; not caching as unverified',
          );
          await this.clearCache(chainId, address);
          return null;
        }
      } catch (error) {
        logger.warn(
          { err: error, chainId, address },
          'On-chain code check failed; falling back to unverified',
        );
      }

      const unverifiedContract: ContractSource = {
        chainId,
        address,
        sourceCode: '',
        abi: '[]',
        verificationStatus: 'unverified',
        verificationSource: 'unknown',
        lastChecked: new Date(),
      };
      await this.saveToDatabase(unverifiedContract);
      return unverifiedContract;
    } catch (error) {
      logger.error({ err: error, address }, 'Failed to get contract source');
      return null;
    }
  }

  // Saves a manual (local-trust) verification mark: the user-pasted ABI
  // plus optional source/name, recorded as verified with
  // verificationSource 'manual'. This is an annotation, not a
  // cryptographic match — the UI badge and panel copy both say so. The
  // write goes through the same saveToDatabase upsert every other
  // source uses (serialization, implementation_addresses JSON column,
  // onConflictDoUpdate on (chainId, address)), so a re-save replaces
  // the mark wholesale and proxy fields stay null.
  async saveManualVerification(
    chainId: number,
    address: Address,
    input: { abi: string; sourceCode?: string; name?: string },
  ): Promise<ContractSource> {
    const now = new Date();
    const manualSource: ContractSource = {
      chainId,
      address: formatAddress(address),
      ...(input.name ? { name: input.name } : {}),
      sourceCode: input.sourceCode ?? '',
      abi: input.abi,
      verificationStatus: 'verified',
      verificationSource: 'manual',
      verifiedAt: now,
      lastChecked: now,
    };
    await this.saveToDatabase(manualSource);
    return manualSource;
  }

  // Saves a local compile-verification record (CompileVerifyService): the
  // caller matched recompiled runtime bytecode against the chain, so
  // unlike the manual mark this IS a real match — the row records
  // verificationSource 'local-compile' plus the compiler settings that
  // produced it. Same saveToDatabase upsert every other source uses, so a
  // re-save replaces the record wholesale and proxy fields stay null.
  async saveLocalCompileVerification(
    chainId: number,
    address: Address,
    input: {
      name: string;
      abi: string;
      sourceFiles: ContractFile[];
      sourceCode: string;
      compilerVersion: string;
      optimizationEnabled?: boolean;
      optimizationRuns?: number;
      evmVersion?: string;
    },
  ): Promise<ContractSource> {
    const now = new Date();
    const source: ContractSource = {
      chainId,
      address: formatAddress(address),
      name: input.name,
      compilerVersion: input.compilerVersion,
      ...(input.evmVersion !== undefined ? { evmVersion: input.evmVersion } : {}),
      ...(input.optimizationEnabled !== undefined
        ? { optimizationEnabled: input.optimizationEnabled }
        : {}),
      ...(input.optimizationRuns !== undefined
        ? { optimizationRuns: input.optimizationRuns }
        : {}),
      sourceCode: input.sourceCode,
      sourceFiles: input.sourceFiles,
      abi: input.abi,
      verificationStatus: 'verified',
      verificationSource: 'local-compile',
      verifiedAt: now,
      lastChecked: now,
    };
    await this.saveToDatabase(source);
    return source;
  }

  // Removes a manual mark. Deletes ONLY rows whose verificationSource is
  // 'manual' — a sourcify/blockscan row answers false (the route maps
  // that to 404) and is never touched. The delete reuses clearCache, so
  // the next GET re-probes the remote verifiers from scratch.
  async deleteManualVerification(chainId: number, address: Address): Promise<boolean> {
    try {
      const existing = await this.getFromDatabase(chainId, address);
      if (existing?.verificationSource !== 'manual') {
        return false;
      }
      await this.clearCache(chainId, address);
      return true;
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Failed to delete manual verification');
      return false;
    }
  }

  private mapSourcifyProxyType(sourcifyType: string): ProxyType {
    const mapping: Record<string, ProxyType> = {
      EIP1967Proxy: 'transparent',
      ZeppelinOSProxy: 'zeppelinos',
      EIP1167Proxy: 'eip1167',
      GnosisSafeProxy: 'gnosis-safe',
      DiamondProxy: 'diamond',
      PROXIABLEProxy: 'uups',
      FixedProxy: 'minimal',
      SequenceWalletProxy: 'minimal',
    };
    return mapping[sourcifyType] || 'unknown';
  }

  // 从 Sourcify v2 API 获取合约源码
  private async fetchFromSourcify(
    chainId: number,
    address: Address,
  ): Promise<ContractSource | null> {
    try {
      const baseUrl = 'https://sourcify.dev/server/v2';
      const contractUrl = `${baseUrl}/contract/${chainId}/${address}?fields=abi,sources,compilation,proxyResolution`;

      const response = await fetch(contractUrl, { signal: AbortSignal.timeout(10000) });

      if (!response.ok) {
        if (response.status === 404) {
          logger.info({ address, chainId }, 'Contract not found on Sourcify');
          return null;
        }
        logger.warn({ status: response.status }, 'Sourcify v2 API error');
        return null;
      }

      const data = await response.json();

      const isMatch = data.match === 'match';
      const isPartial = data.runtimeMatch === 'match' && data.creationMatch !== 'match';

      if (!isMatch && !isPartial) {
        return null;
      }

      const abi = data.abi ? JSON.stringify(data.abi) : '[]';
      const contractName = data.compilation?.name ?? '';
      const compilerVersion = data.compilation?.compilerVersion ?? '';

      let sourceCode = '';
      let sourceFiles: ContractFile[] | undefined;
      if (data.sources && typeof data.sources === 'object') {
        type SourceFile = { content?: string };
        type Sources = Record<string, SourceFile>;
        const sources = data.sources as Sources;
        const sourceEntries = Object.entries(sources);
        const solFiles = sourceEntries.filter(([name]) => name.endsWith('.sol'));

        if (solFiles.length === 1) {
          sourceCode = solFiles[0][1].content ?? '';
        } else if (solFiles.length > 1) {
          sourceCode = solFiles
            .map(([name, src]) => `// File: ${name}\n${src.content ?? ''}`)
            .join('\n\n');
          sourceFiles = solFiles.map(([name, src]) => ({
            filename: name,
            content: src.content ?? '',
          }));
        }
      }

      const result: ContractSource = {
        chainId,
        address,
        name: contractName,
        compilerVersion,
        sourceCode,
        sourceFiles,
        abi,
        verificationStatus: isPartial ? 'partial' : 'verified',
        verificationSource: 'sourcify',
        verifiedAt: data.verifiedAt ? new Date(data.verifiedAt) : new Date(),
        lastChecked: new Date(),
      };

      const proxy = data.proxyResolution;
      if (proxy?.isProxy && proxy.implementations?.length > 0) {
        const implAddress = proxy.implementations[0].address as Address;
        result.isProxy = true;
        result.proxyType = this.mapSourcifyProxyType(proxy.proxyType);
        result.implementationAddress = implAddress;
        // Diamonds (EIP-2535) resolve to multiple implementations; keep the
        // full facet list so the UI is not forced to present facet[0] as
        // the single implementation. implementationAddress stays facet[0]
        // for compatibility with single-implementation consumers.
        result.implementationAddresses = proxy.implementations.map(
          (impl: { address: Address }) => impl.address,
        );

        logger.info(
          {
            proxyType: proxy.proxyType,
            mapped: result.proxyType,
            implementation: implAddress,
            facetCount: proxy.implementations.length,
          },
          'Sourcify detected proxy contract',
        );

        const implContract = await this.getContractSource(chainId, implAddress);
        if (implContract) {
          result.implementationContract = implContract;
        }
      }

      return result;
    } catch (error) {
      logger.error({ err: error }, 'Sourcify v2 fetch error');
      return null;
    }
  }

  // 从 Blockscan 获取合约源码
  private async fetchFromBlockscan(
    chainId: number,
    address: Address,
  ): Promise<ContractSource | null> {
    try {
      const url = `https://vscode.blockscan.com/srcapi/${chainId}/${address}`;
      const response = await fetch(url);

      if (!response.ok) {
        logger.info({ address, chainId, status: response.status }, 'Blockscan API error');
        return null;
      }

      const data = await response.json();

      if (data.status !== '1' || !data.result) {
        return null;
      }

      let sourceData: {
        language?: string;
        sources?: Record<string, { content?: string }>;
        settings?: { optimizer?: { enabled?: boolean; runs?: number }; evmVersion?: string };
        compilerVersion?: string;
      };
      try {
        sourceData = JSON.parse(data.result);
      } catch {
        const ext = data.ext ?? 'sol';
        sourceData = {
          language: 'Solidity',
          sources: { [`contract.${ext}`]: { content: data.result } },
          settings: { optimizer: { enabled: false, runs: 200 } },
        };
      }

      let sourceCode = '';
      let sourceFiles: ContractFile[] | undefined;
      if (sourceData.sources && typeof sourceData.sources === 'object') {
        const solFiles = Object.entries(sourceData.sources).filter(([name]) =>
          name.endsWith('.sol'),
        );
        if (solFiles.length > 0) {
          sourceCode = solFiles
            .map(
              ([name, src]) => `// File: ${name}\n${(src).content ?? ''}`,
            )
            .join('\n\n');
        }
        if (solFiles.length > 1) {
          sourceFiles = solFiles.map(([name, src]) => ({
            filename: name,
            content: (src).content ?? '',
          }));
        }
      }

      const name = data.contractName ?? 'Unknown';

      let compilerVersion = sourceData.compilerVersion ?? '';
      if (!compilerVersion) {
        if (sourceData.sources) {
          for (const [, src] of Object.entries(sourceData.sources)) {
            const content = (src).content ?? '';
            const pragmaMatch = content.match(/pragma\s+solidity\s+\^?(\d+\.\d+\.\d+)/);
            if (pragmaMatch) {
              compilerVersion = pragmaMatch[1];
              break;
            }
          }
        }
        if (!compilerVersion) {
          const evmVersion = sourceData.settings?.evmVersion;
          if (evmVersion === 'paris' || evmVersion === 'shanghai') {
            compilerVersion = '0.8.20';
          } else {
            compilerVersion = '0.8.0';
          }
        }
      }

      const optimizationEnabled = sourceData.settings?.optimizer?.enabled ?? false;
      const optimizationRuns = sourceData.settings?.optimizer?.runs ?? 200;

      const abi = await this.fetchAbiFromExplorer(chainId, address);

      return {
        chainId,
        address,
        name,
        compilerVersion,
        optimizationEnabled,
        optimizationRuns,
        sourceCode,
        sourceFiles,
        abi,
        constructorArguments: '',
        verificationStatus: sourceCode ? 'verified' : 'partial',
        verificationSource: 'blockscan',
        verifiedAt: new Date(),
        lastChecked: new Date(),
      };
    } catch (error) {
      logger.error({ err: error }, 'Blockscan fetch error');
      return null;
    }
  }

  // 从 Explorer Etherscan-compatible API 获取 ABI
  private async fetchAbiFromExplorer(chainId: number, address: Address): Promise<string> {
    try {
      const url = `https://api.routescan.io/v2/network/mainnet/evm/${chainId}/etherscan?module=contract&action=getsourcecode&address=${address}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return '[]';

      const data = await response.json();
      if (data.status === '1' && Array.isArray(data.result) && data.result.length > 0) {
        const abi = data.result[0].ABI;
        if (abi && abi !== 'Contract source code not verified') {
          return abi;
        }
      }
    } catch {
      // ignore
    }
    return '[]';
  }

  // 检查地址是否为合约
  private async isContractAddress(chainId: number, address: Address): Promise<boolean> {
    try {
      const client = await rpcManager.getClient(chainId);
      const code = await client.getCode({ address });
      return Boolean(code && code !== '0x' && code.length > 2);
    } catch (error) {
      logger.error({ err: error }, 'Failed to check contract address');
      return false;
    }
  }

  // Handle proxy contracts specifically
  private async handleProxyContract(
    chainId: number,
    address: Address,
    proxyInfo: {
      isProxy: boolean;
      proxyType?: ProxyType;
      implementationAddress?: Address;
    },
  ): Promise<ContractSource | null> {
    try {
      // Fetch the proxy contract's own source code
      let proxyContract: ContractSource | null = null;

      // Try to fetch the proxy contract source from Sourcify
      proxyContract = await this.fetchFromSourcify(chainId, address);

      if (!proxyContract) {
        const blockscanResult = await this.fetchFromBlockscan(chainId, address);

        if (blockscanResult && addressEquals(blockscanResult.address, address)) {
          proxyContract = blockscanResult;
        }
      }

      // If still nothing, synthesize minimal proxy info — this is NOT a verified
      // source, so mark it unverified with no verification source
      proxyContract ??= {
        chainId,
        address,
        name: `TransparentUpgradeableProxy`,
        sourceCode:
          '// This is a proxy contract. The actual implementation is at the implementation address.',
        abi: JSON.stringify([
          {
            inputs: [],
            name: 'implementation',
            outputs: [{ internalType: 'address', name: '', type: 'address' }],
            stateMutability: 'view',
            type: 'function',
          },
        ]),
        verificationStatus: 'unverified' as const,
        verificationSource: 'none' as const,
        lastChecked: new Date(),
      };

      // Fetch the implementation contract's source code
      let implementationContract: ContractSource | null = null;
      if (proxyInfo.implementationAddress) {
        implementationContract = await this.getContractSource(
          chainId,
          proxyInfo.implementationAddress,
        );
      }

      // Return the enriched proxy contract info
      return {
        ...proxyContract,
        isProxy: true,
        proxyType: proxyInfo.proxyType,
        implementationAddress: proxyInfo.implementationAddress,
        implementationContract: implementationContract ?? undefined,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to handle proxy contract');
      return null;
    }
  }

  // 增强合约信息，检测代理并获取实现合约
  private async enhanceWithProxyInfo(
    contract: ContractSource,
    proxyInfo?: {
      isProxy: boolean;
      proxyType?: ProxyType;
      implementationAddress?: Address;
    },
  ): Promise<ContractSource> {
    try {
      if (!proxyInfo) {
        if (contract.isProxy && contract.implementationAddress) {
          proxyInfo = {
            isProxy: true,
            proxyType: contract.proxyType,
            implementationAddress: contract.implementationAddress,
          };
        } else if (contract.isProxy && !contract.implementationAddress) {
          proxyInfo = await this.detectProxy(contract.chainId, contract.address);
          if (!proxyInfo.isProxy && contract.name?.toLowerCase().includes('proxy')) {
            proxyInfo = {
              isProxy: true,
              proxyType: 'unknown',
            };
          }
        } else {
          proxyInfo = await this.detectProxy(contract.chainId, contract.address);
          if (!proxyInfo.isProxy && contract.name?.toLowerCase().includes('proxy')) {
            proxyInfo = {
              isProxy: true,
              proxyType: 'unknown',
            };
          }
        }
      }

      if (!proxyInfo.isProxy) {
        return contract;
      }

      await this.saveProxyInfo(
        contract.chainId,
        contract.address,
        proxyInfo.proxyType,
        proxyInfo.implementationAddress,
      );

      let implementationContract: ContractSource | null = null;
      if (proxyInfo.implementationAddress) {
        implementationContract = await this.getContractSource(
          contract.chainId,
          proxyInfo.implementationAddress,
        );
      }

      return {
        ...contract,
        isProxy: true,
        proxyType: proxyInfo.proxyType,
        implementationAddress: proxyInfo.implementationAddress,
        implementationContract: implementationContract ?? undefined,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to enhance with proxy info');
      return contract;
    }
  }

  // Detect proxy contract type and implementation address
  private async detectProxy(
    chainId: number,
    address: Address,
  ): Promise<{
    isProxy: boolean;
    proxyType?: ProxyType;
    implementationAddress?: Address;
  }> {
    const timeout = new Promise<{ isProxy: false }>(resolve =>
      setTimeout(() => resolve({ isProxy: false }), 15_000),
    );
    return Promise.race([this._detectProxyImpl(chainId, address), timeout]);
  }

  private async _detectProxyImpl(
    chainId: number,
    address: Address,
  ): Promise<{
    isProxy: boolean;
    proxyType?: ProxyType;
    implementationAddress?: Address;
  }> {
    try {
      const client = await rpcManager.getClient(chainId);

      // First verify the address is actually a contract
      const isContract = await this.isContractAddress(chainId, address);
      if (!isContract) {
        return { isProxy: false };
      }

      // Check well-known proxy storage slots
      // EIP-1967: 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
      const implementationSlot =
        '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

      try {
        const implementationData = await client.getStorageAt({
          address,
          slot: implementationSlot,
        });

        if (
          implementationData && implementationData !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) {
          // Extract the address (last 20 bytes)
          const implementationAddress = `0x${implementationData.slice(-40)}`;

          // Validate the implementation address is a real contract
          const isValidImplementation = await this.isContractAddress(
            chainId,
            implementationAddress as Address,
          );

          if (isValidImplementation) {
            return {
              isProxy: true,
              proxyType: 'transparent',
              implementationAddress: implementationAddress as Address,
            };
          }
        }
      } catch (error) {
        logger.warn({ err: error }, 'Failed to check EIP-1967 implementation slot');
      }

      // Check UUPS proxy (EIP-1822)
      // The implementation contract may live in the same slot

      // Check beacon proxy
      // EIP-1967 Beacon: 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
      const beaconSlot = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

      try {
        const beaconData = await client.getStorageAt({
          address,
          slot: beaconSlot,
        });

        if (
          beaconData &&
          beaconData !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) {
          const beaconAddress = `0x${beaconData.slice(-40)}`;

          // Resolve the implementation from the beacon contract itself via
          // its implementation() view function
          try {
            const beaconImpl = await client.readContract({
              address: beaconAddress as Address,
              abi: IMPLEMENTATION_ABI,
              functionName: 'implementation',
            });

            if (isValidResultAddress(beaconImpl)) {
              return {
                isProxy: true,
                proxyType: 'beacon',
                implementationAddress: formatAddress(beaconImpl),
              };
            }
            logger.warn(
              { beaconAddress, beaconImpl },
              'Beacon implementation() returned an invalid address',
            );
          } catch (error) {
            logger.warn(
              { err: error, beaconAddress },
              'Failed to read implementation() from beacon contract',
            );
          }

          // Fallback: no readable implementation() from the beacon, so surface
          // the beacon contract address itself as the pointer
          return {
            isProxy: true,
            proxyType: 'beacon',
            implementationAddress: formatAddress(beaconAddress),
          };
        }
      } catch (error) {
        logger.warn({ err: error }, 'Failed to check beacon slot');
      }

      // ZeppelinOS proxy: 0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3
      const zeppelinSlot = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';

      try {
        const zeppelinData = await client.getStorageAt({
          address,
          slot: zeppelinSlot,
        });

        if (
          zeppelinData &&
          zeppelinData !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) {
          const implAddress = `0x${zeppelinData.slice(-40)}`;
          const isValid = await this.isContractAddress(chainId, implAddress as Address);
          if (isValid) {
            return {
              isProxy: true,
              proxyType: 'zeppelinos',
              implementationAddress: implAddress as Address,
            };
          }
        }
      } catch (error) {
        logger.warn({ err: error }, 'Failed to check ZeppelinOS slot');
      }

      // EIP-1167 minimal proxy: bytecode starts with 363d3d373d3d3d363d73 + 20-byte address + 5af43d82803e903d91602b57fd5bf3
      try {
        const code = await client.getCode({ address });
        if (code) {
          const normalized = code.toLowerCase();
          const eip1167Prefix = '0x363d3d373d3d3d363d73';
          const eip1167Suffix = '5af43d82803e903d91602b57fd5bf3';
          if (normalized.startsWith(eip1167Prefix) && normalized.endsWith(eip1167Suffix)) {
            const implAddress = `0x${normalized.slice(22, 62)}`;
            return {
              isProxy: true,
              proxyType: 'eip1167',
              implementationAddress: implAddress as Address,
            };
          }
        }
      } catch (error) {
        logger.warn({ err: error }, 'Failed to check EIP-1167 bytecode');
      }

      // ABI fallback for proxies without well-known storage slots (e.g. Gnosis Safe):
      // try implementation() then masterCopy() on the contract itself
      for (const [abi, fnName] of [
        [IMPLEMENTATION_ABI, 'implementation'],
        [MASTER_COPY_ABI, 'masterCopy'],
      ] as const) {
        try {
          const result = await client.readContract({ address, abi, functionName: fnName });
          if (isValidResultAddress(result)) {
            const implAddress = formatAddress(result);
            const isValid = await this.isContractAddress(chainId, implAddress);
            if (isValid) {
              return {
                isProxy: true,
                proxyType: 'unknown',
                implementationAddress: implAddress,
              };
            }
          }
        } catch (error) {
          logger.debug({ err: error, address, fnName }, 'ABI fallback probe failed');
        }
      }

      return { isProxy: false };
    } catch (error) {
      logger.error({ err: error }, 'Failed to detect proxy');
      return { isProxy: false };
    }
  }

  // 从数据库获取缓存的合约信息
  private async getFromDatabase(chainId: number, address: Address): Promise<ContractSource | null> {
    try {
      const rows = await db
        .select()
        .from(contractSources)
        .where(and(eq(contractSources.chainId, chainId), eq(contractSources.address, address)))
        .limit(1);

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      let sourceFiles: ContractFile[] | undefined;
      if (row.sourceFiles) {
        try {
          sourceFiles = JSON.parse(row.sourceFiles);
        } catch {
          // ignore malformed JSON
        }
      }
      // Restore the persisted facet list (EIP-2535 diamonds). Rows written
      // before the column existed have NULL here — read that back as
      // undefined rather than failing the whole cache hit.
      let implementationAddresses: Address[] | undefined;
      if (row.implementationAddresses) {
        try {
          const parsed: unknown = JSON.parse(row.implementationAddresses);
          if (Array.isArray(parsed)) {
            const addresses = parsed.filter(
              (value): value is Address => typeof value === 'string' && isValidAddress(value),
            );
            if (addresses.length > 0) {
              implementationAddresses = addresses;
            }
          }
        } catch {
          // ignore malformed JSON
        }
      }
      return {
        chainId: row.chainId,
        address: row.address,
        name: row.contractName ?? undefined,
        compilerVersion: row.compilerVersion ?? undefined,
        evmVersion: row.evmVersion ?? undefined,
        optimizationEnabled: row.optimizationUsed ?? undefined,
        optimizationRuns: row.runs ?? undefined,
        sourceCode: row.sourceCode ?? '',
        sourceFiles,
        abi: row.abi ?? '',
        constructorArguments: row.constructorArguments ?? undefined,
        verificationStatus: row.isVerified ? 'verified' : 'unverified',
        verificationSource:
          (row.verificationSource as
          | 'sourcify'
          | 'blockscan'
          | 'manual'
          | 'local-compile'
          | 'unknown') ?? 'unknown',
        verifiedAt: row.verificationDate ?? undefined,
        lastChecked: row.lastUpdated ?? new Date(),
        isProxy: row.proxy ? true : false,
        proxyType: (row.proxy as ProxyType) ?? undefined,
        implementationAddress: row.implementation ?? undefined,
        implementationAddresses,
      };
    } catch (error) {
      logger.error({ err: error }, 'Database query error');
      return null;
    }
  }

  // 保存到数据库
  private async saveToDatabase(contractSource: ContractSource): Promise<void> {
    try {
      const implAddress: `0x${string}` | null = contractSource.implementationAddress
        ? formatAddress(contractSource.implementationAddress)
        : null;

      const constructorArgs: `0x${string}` | null = contractSource.constructorArguments?.startsWith(
        '0x',
      )
        ? (contractSource.constructorArguments as `0x${string}`)
        : null;

      const sourceFilesJson = contractSource.sourceFiles?.length
        ? JSON.stringify(contractSource.sourceFiles)
        : null;

      // Facet list (EIP-2535 diamonds): persisted so a cache hit keeps the
      // multi-implementation view instead of degrading to facet[0].
      const implementationAddressesJson = contractSource.implementationAddresses?.length
        ? JSON.stringify(contractSource.implementationAddresses)
        : null;

      await db
        .insert(contractSources)
        .values({
          chainId: contractSource.chainId,
          address: contractSource.address,
          contractName: contractSource.name ?? null,
          compilerVersion: contractSource.compilerVersion ?? null,
          evmVersion: contractSource.evmVersion ?? null,
          optimizationUsed: contractSource.optimizationEnabled ?? null,
          runs: contractSource.optimizationRuns ?? null,
          sourceCode: contractSource.sourceCode ?? null,
          sourceFiles: sourceFilesJson,
          abi: contractSource.abi ?? null,
          constructorArguments: constructorArgs,
          isVerified: contractSource.verificationStatus === 'verified',
          verificationSource: contractSource.verificationSource ?? null,
          proxy: contractSource.proxyType ?? null,
          implementation: implAddress,
          implementationAddresses: implementationAddressesJson,
          verificationDate: contractSource.verifiedAt ?? new Date(),
          lastUpdated: contractSource.lastChecked ?? new Date(),
        })
        .onConflictDoUpdate({
          target: [contractSources.chainId, contractSources.address],
          set: {
            contractName: contractSource.name ?? null,
            compilerVersion: contractSource.compilerVersion ?? null,
            evmVersion: contractSource.evmVersion ?? null,
            optimizationUsed: contractSource.optimizationEnabled ?? null,
            runs: contractSource.optimizationRuns ?? null,
            sourceCode: contractSource.sourceCode ?? null,
            sourceFiles: sourceFilesJson,
            abi: contractSource.abi ?? null,
            constructorArguments: constructorArgs,
            isVerified: contractSource.verificationStatus === 'verified',
            verificationSource: contractSource.verificationSource ?? null,
            proxy: contractSource.proxyType ?? null,
            implementation: implAddress,
            implementationAddresses: implementationAddressesJson,
            verificationDate: contractSource.verifiedAt ?? new Date(),
            lastUpdated: contractSource.lastChecked,
          },
        });
    } catch (error) {
      logger.error({ err: error }, 'Failed to save contract source');
    }
  }

  private async saveProxyInfo(
    chainId: number,
    address: Address,
    proxyType: ProxyType | undefined,
    implementationAddress: Address | undefined,
  ): Promise<void> {
    try {
      const implAddress: `0x${string}` | null = implementationAddress
        ? formatAddress(implementationAddress)
        : null;

      await db
        .update(contractSources)
        .set({
          proxy: proxyType ?? null,
          implementation: implAddress,
          lastUpdated: new Date(),
        })
        .where(and(eq(contractSources.chainId, chainId), eq(contractSources.address, address)));
    } catch (error) {
      logger.error({ err: error }, 'Failed to save proxy info');
    }
  }

  // Pushes a stale manual mark's TTL window forward after a Sourcify
  // re-probe missed, so the ~1/h probe cadence from isCacheValid holds
  // without re-writing the whole row.
  private async refreshManualMark(chainId: number, address: Address): Promise<void> {
    try {
      await db
        .update(contractSources)
        .set({ lastUpdated: new Date() })
        .where(
          and(eq(contractSources.chainId, chainId), eq(contractSources.address, formatAddress(address))),
        );
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Failed to refresh manual mark timestamp');
    }
  }

  // 检查缓存是否有效
  private isCacheValid(contractSource: ContractSource): boolean {
    const now = new Date();
    const lastChecked = contractSource.lastChecked;
    const hoursDiff = (now.getTime() - lastChecked.getTime()) / MS_PER_HOUR;

    // Cache TTL policy (see the *_CACHE_TTL_HOURS constants above):
    // - Verified non-proxy contracts: 30 days (source code cannot change)
    // - Verified proxies: 24 hours — the implementation address can change
    //   at any time via an upgrade, so "immutable" does not hold even for
    //   a verified proxy
    // - Unverified/partial contracts: 1 hour — they may get verified at
    //   Sourcify at any moment, and that motive dominates the proxy flag
    //   (an unverified proxy has no cached source an upgrade could stale)
    // - Manual marks: 1 hour — a local trust annotation is not an
    //   immutable fact, so the GET pipeline re-probes Sourcify on the
    //   unverified cadence and lets a real match supersede it
    let maxHours: number;

    if (contractSource.verificationSource === 'manual') {
      maxHours = UNVERIFIED_CACHE_TTL_HOURS;
    } else if (contractSource.verificationStatus === 'verified') {
      maxHours = contractSource.isProxy ? PROXY_CACHE_TTL_HOURS : VERIFIED_CACHE_TTL_HOURS;
    } else {
      maxHours = UNVERIFIED_CACHE_TTL_HOURS;
    }

    const isValid = hoursDiff < maxHours;

    if (!isValid) {
      logger.info(
        {
          address: contractSource.address,
          hoursDiff: hoursDiff.toFixed(1),
          maxHours,
          verificationStatus: contractSource.verificationStatus,
          isProxy: contractSource.isProxy ?? false,
        },
        'Cache expired',
      );
    }

    return isValid;
  }

  // 解析 ABI 并提取函数信息
  async getContractFunctions(chainId: number, address: Address) {
    try {
      const contractSource = await this.getContractSource(chainId, address);
      if (!contractSource?.abi) {
        return { functions: [], events: [], errors: [] };
      }

      const abi = JSON.parse(contractSource.abi) as Array<AbiFunction | AbiEvent | AbiError>;

      const functions = abi.filter((item): item is AbiFunction => item.type === 'function');
      const events = abi.filter((item): item is AbiEvent => item.type === 'event');
      const errors = abi.filter((item): item is AbiError => item.type === 'error');

      return {
        functions: functions.map(f => ({
          name: f.name,
          type: f.stateMutability ?? 'nonpayable',
          inputs: f.inputs ?? [],
          outputs: f.outputs ?? [],
          signature: this.generateFunctionSignature(f),
        })),
        events: events.map(e => ({
          name: e.name,
          inputs: e.inputs ?? [],
          signature: this.generateEventSignature(e),
        })),
        errors: errors.map(e => ({
          name: e.name,
          inputs: e.inputs ?? [],
        })),
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to parse contract ABI');
      return { functions: [], events: [], errors: [] };
    }
  }

  // 生成函数签名
  private generateFunctionSignature(func: AbiFunction): string {
    const inputs = func.inputs?.map(input => input.type).join(', ') ?? '';
    return `${func.name}(${inputs})`;
  }

  // 生成事件签名
  private generateEventSignature(event: AbiEvent): string {
    const inputs = event.inputs?.map(input => input.type).join(', ') ?? '';
    return `${event.name}(${inputs})`;
  }

  // 获取合约统计信息
  async getContractStats(chainId: number) {
    try {
      const rows = await db
        .select({
          isVerified: contractSources.isVerified,
          count: sql`COUNT(*)`.as('count'),
        })
        .from(contractSources)
        .where(eq(contractSources.chainId, chainId))
        .groupBy(contractSources.isVerified);

      const stats = {
        total: 0,
        verified: 0,
        unverified: 0,
        partial: 0,
      };

      rows.forEach((row: { isVerified: boolean | null; count: unknown }) => {
        stats.total += Number(row.count);
        if (row.isVerified) {
          stats.verified = Number(row.count);
        } else {
          stats.unverified = Number(row.count);
        }
      });

      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get contract stats');
      return { total: 0, verified: 0, unverified: 0, partial: 0 };
    }
  }

  async clearCache(chainId: number, address: Address): Promise<void> {
    try {
      const formattedAddress = formatAddress(address);

      await db
        .delete(contractSources)
        .where(
          and(eq(contractSources.chainId, chainId), eq(contractSources.address, formattedAddress)),
        );

      logger.info({ chainId, address: formattedAddress }, 'Cleared contract source cache');
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Failed to clear contract source cache');
    }
  }
}

export const contractSourceService = new ContractSourceService();
