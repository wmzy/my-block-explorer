import { rpcManager } from './RpcManager';
import { db, contractCreationInfo, contractSources } from '../database/init';
import { eq, and, sql } from 'drizzle-orm';
import { createRetryableRpcCall } from '../utils/errorHandler';
import { createLogger } from '../server/logger';

const logger = createLogger('contract-source-service');
import { addressEquals, formatAddress } from '../utils/address';
import type { Address } from 'viem';
import { analyzeRpcError, shouldRetryRpcError } from '../utils/rpcErrorHandler';

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

export type ContractSource = {
  chainId: number;
  address: Address;
  name?: string;
  compilerVersion?: string;
  optimizationEnabled?: boolean;
  optimizationRuns?: number;
  sourceCode: string;
  abi: string;
  constructorArguments?: string;
  verificationStatus: 'verified' | 'unverified' | 'partial';
  verificationSource: 'sourcify' | 'etherscan' | 'mantle-explorer' | 'manual' | 'unknown';
  verifiedAt?: Date;
  lastChecked: Date;
  isProxy?: boolean;
  proxyType?: ProxyType;
  implementationAddress?: Address;
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

export type ContractFile = {
  filename: string;
  content: string;
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
        logger.info(
          { address, reason: row.creationMethod ?? 'unknown' },
          'Found cached failed search',
        );
        // 抛出特殊错误表示这是缓存的失败结果
        throw new Error(`CACHED_FAILURE:${row.creationMethod ?? 'unknown'}`);
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
              "Contract doesn't exist at block, searching later",
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
          logger.info("Due to error, assuming contract doesn't exist and searching later");
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
                "Contract address doesn't match",
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
      if (cached) {
        return cached;
      }

      const sourcifyResult = await this.fetchFromSourcify(chainId, address);
      if (sourcifyResult) {
        await this.saveToDatabase(sourcifyResult);
        return sourcifyResult;
      }

      const explorerResult = await this.fetchFromChainExplorer(chainId, address);
      if (explorerResult) {
        await this.saveToDatabase(explorerResult);
        return explorerResult;
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

      const response = await fetch(contractUrl);

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
        }
      }

      const result: ContractSource = {
        chainId,
        address,
        name: contractName,
        compilerVersion,
        sourceCode,
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

        logger.info(
          { proxyType: proxy.proxyType, mapped: result.proxyType, implementation: implAddress },
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

  // 从链特定的区块浏览器获取合约源码
  private async fetchFromChainExplorer(
    chainId: number,
    address: Address,
  ): Promise<ContractSource | null> {
    try {
      // 根据链ID选择对应的API
      const explorerConfig = this.getExplorerConfig(chainId);
      if (!explorerConfig) {
        return null;
      }

      const url = `${explorerConfig.apiUrl}?module=contract&action=getsourcecode&address=${address}`;
      const response = await fetch(url);

      if (!response.ok) {
        logger.error({ status: response.status }, 'Explorer API error');
        return null;
      }

      const data = await response.json();

      if (data.status !== '1' || !data.result || data.result.length === 0) {
        return null;
      }

      const contractData = data.result[0];

      // 检查是否有源码
      if (!contractData.SourceCode || contractData.SourceCode.trim() === '') {
        return null;
      }

      return {
        chainId,
        address,
        name: contractData.ContractName ?? 'Unknown',
        compilerVersion: contractData.CompilerVersion ?? 'Unknown',
        optimizationEnabled: contractData.OptimizationUsed === '1',
        optimizationRuns: parseInt(contractData.Runs ?? '200'),
        sourceCode: contractData.SourceCode ?? '',
        abi: contractData.ABI ?? '[]',
        constructorArguments: contractData.ConstructorArguments ?? '',
        verificationStatus: 'verified',
        verificationSource: explorerConfig.name,
        verifiedAt: new Date(),
        lastChecked: new Date(),
      };
    } catch (error) {
      logger.error({ err: error }, 'Chain explorer fetch error');
      return null;
    }
  }

  // 获取链特定的区块浏览器配置
  private getExplorerConfig(
    chainId: number,
  ): { name: 'mantle-explorer' | 'etherscan'; apiUrl: string } | null {
    const configs: Record<number, { name: 'mantle-explorer' | 'etherscan'; apiUrl: string }> = {
      5000: {
        // Mantle
        name: 'mantle-explorer',
        apiUrl: 'https://explorer.mantle.xyz/api',
      },
      // 可以添加更多链的配置
      // 1: { // Ethereum
      //   name: "etherscan",
      //   apiUrl: "https://api.etherscan.io/api"
      // },
    };

    return configs[chainId] || null;
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

  // 专门处理代理合约
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
      // 获取代理合约本身的源码
      let proxyContract: ContractSource | null = null;

      // 尝试从 Sourcify 获取代理合约源码
      proxyContract = await this.fetchFromSourcify(chainId, address);

      // 如果 Sourcify 没有，尝试从区块浏览器获取
      if (!proxyContract) {
        const explorerResult = await this.fetchFromChainExplorer(chainId, address);

        // 检查区块浏览器返回的是否是代理合约本身的源码
        // 如果返回的地址与请求的地址不同，说明返回的是实现合约的源码
        if (explorerResult && addressEquals(explorerResult.address, address)) {
          proxyContract = explorerResult;
        }
      }

      // 如果还是没有，创建基本的代理合约信息
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
        verificationStatus: 'verified' as const,
        verificationSource: 'manual' as const,
        lastChecked: new Date(),
      };

      // 获取实现合约的源码
      let implementationContract: ContractSource | null = null;
      if (proxyInfo.implementationAddress) {
        implementationContract = await this.getContractSource(
          chainId,
          proxyInfo.implementationAddress,
        );
      }

      // 返回增强的代理合约信息
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
      // 如果没有传入代理信息，则检测
      if (!proxyInfo) {
        proxyInfo = await this.detectProxy(contract.chainId, contract.address);

        // 如果通过存储槽检测没有发现代理，尝试通过名称检测
        if (!proxyInfo.isProxy && contract.name?.toLowerCase().includes('proxy')) {
          proxyInfo = {
            isProxy: true,
            proxyType: 'unknown',
          };
        }
      }

      if (!proxyInfo.isProxy) {
        return contract;
      }

      // 获取实现合约的源码
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

  // 检测代理合约类型和实现地址
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

      // 首先验证地址是否为合约
      const isContract = await this.isContractAddress(chainId, address);
      if (!isContract) {
        return { isProxy: false };
      }

      // 检查常见的代理存储槽
      // EIP-1967: 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
      const implementationSlot =
        '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

      try {
        const implementationData = await client.getStorageAt({
          address,
          slot: implementationSlot as `0x${string}`,
        });

        if (
          implementationData &&
          implementationData !==
            '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) {
          // 提取地址（后20字节）
          const implementationAddress = `0x${implementationData.slice(-40)}`;

          // 验证实现地址是否为有效合约
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

      // 检查 UUPS 代理（EIP-1822）
      // 实现合约可能在相同的槽位

      // 检查 Beacon 代理
      // EIP-1967 Beacon: 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
      const beaconSlot = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

      try {
        const beaconData = await client.getStorageAt({
          address,
          slot: beaconSlot as `0x${string}`,
        });

        if (
          beaconData &&
          beaconData !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) {
          const beaconAddress = `0x${beaconData.slice(-40)}`;

          // 从 Beacon 获取实现地址
          // Beacon 通常有一个 implementation() 函数
          // 这里简化处理，标记为 beacon 类型
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
          slot: zeppelinSlot as `0x${string}`,
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
      return {
        chainId: row.chainId,
        address: row.address,
        name: row.contractName ?? undefined,
        compilerVersion: row.compilerVersion ?? undefined,
        optimizationEnabled: row.optimizationUsed ?? undefined,
        optimizationRuns: row.runs ?? undefined,
        sourceCode: row.sourceCode ?? '',
        abi: row.abi ?? '',
        constructorArguments: row.constructorArguments ?? undefined,
        verificationStatus: row.isVerified ? 'verified' : 'unverified',
        verificationSource: 'unknown',
        verifiedAt: row.verificationDate ?? undefined,
        lastChecked: row.lastUpdated ?? new Date(),
        isProxy: row.proxy ? true : false,
        proxyType: (row.proxy as ProxyType) ?? undefined,
        implementationAddress: row.implementation ?? undefined,
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

      await db
        .insert(contractSources)
        .values({
          chainId: contractSource.chainId,
          address: contractSource.address,
          contractName: contractSource.name ?? null,
          compilerVersion: contractSource.compilerVersion ?? null,
          optimizationUsed: contractSource.optimizationEnabled ?? null,
          runs: contractSource.optimizationRuns ?? null,
          sourceCode: contractSource.sourceCode ?? null,
          abi: contractSource.abi ?? null,
          constructorArguments: constructorArgs,
          isVerified: contractSource.verificationStatus === 'verified',
          proxy: contractSource.proxyType ?? null,
          implementation: implAddress,
          verificationDate: contractSource.verifiedAt ?? new Date(),
        })
        .onConflictDoUpdate({
          target: [contractSources.chainId, contractSources.address],
          set: {
            contractName: contractSource.name ?? null,
            compilerVersion: contractSource.compilerVersion ?? null,
            optimizationUsed: contractSource.optimizationEnabled ?? null,
            runs: contractSource.optimizationRuns ?? null,
            sourceCode: contractSource.sourceCode ?? null,
            abi: contractSource.abi ?? null,
            constructorArguments: constructorArgs,
            isVerified: contractSource.verificationStatus === 'verified',
            proxy: contractSource.proxyType ?? null,
            implementation: implAddress,
            verificationDate: contractSource.verifiedAt ?? new Date(),
            lastUpdated: contractSource.lastChecked,
          },
        });
    } catch (error) {
      logger.error({ err: error }, 'Failed to save contract source');
    }
  }

  // 检查缓存是否有效
  private isCacheValid(contractSource: ContractSource): boolean {
    const now = new Date();
    const lastChecked = contractSource.lastChecked;
    const hoursDiff = (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);

    // 缓存策略：
    // - 已验证的合约：30天（合约源码不会变）
    // - 未验证的合约：3天（可能后续会被验证）
    // - 代理合约：30天（代理关系通常不会变）
    let maxHours: number;

    if (contractSource.verificationStatus === 'verified' || contractSource.isProxy) {
      maxHours = 24 * 30; // 30天
    } else {
      maxHours = 24 * 3; // 3天
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
}

export const contractSourceService = new ContractSourceService();
