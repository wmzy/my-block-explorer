import { rpcManager } from "./RpcManager";
import { db } from "../database/init";
import { createRetryableRpcCall } from "../utils/errorHandler";
import {
  analyzeRpcError,
  formatRpcErrorForUser,
  shouldRetryRpcError,
  type RpcErrorDetails,
} from "../utils/rpcErrorHandler";

export type ContractSource = {
  chainId: number;
  address: string;
  name?: string;
  compilerVersion?: string;
  optimizationEnabled?: boolean;
  optimizationRuns?: number;
  sourceCode: string;
  abi: string;
  constructorArguments?: string;
  verificationStatus: "verified" | "unverified" | "partial";
  verificationSource:
    | "sourcify"
    | "etherscan"
    | "mantle-explorer"
    | "manual"
    | "unknown";
  verifiedAt?: Date;
  lastChecked: Date;
  // Proxy contract support
  isProxy?: boolean;
  proxyType?: "transparent" | "uups" | "beacon" | "minimal" | "unknown";
  implementationAddress?: string;
  implementationContract?: ContractSource;
  // Contract creation info
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
    address: string
  ): Promise<ContractCreationInfo | null> {
    console.log(
      `🔍 Starting contract creation search for ${address} on chain ${chainId}`
    );

    try {
      // 1. 先从数据库查找缓存的创建信息
      console.log(`📋 Step 1: Checking database cache for creation info...`);
      try {
        const cachedInfo = await this.getCachedCreationInfo(chainId, address);
        if (cachedInfo) {
          console.log(
            `✅ Found cached creation info for ${address}: tx ${cachedInfo.txHash} in block ${cachedInfo.blockNumber}`
          );
          return cachedInfo;
        }
        console.log(
          `📋 No cached creation info found, starting fresh search...`
        );
      } catch (error) {
        if (error.message.startsWith("CACHED_FAILURE:")) {
          const reason = error.message.replace("CACHED_FAILURE:", "");
          console.log(
            `❌ Found cached failed search for ${address}, reason: ${reason}`
          );
          return null; // 直接返回null，不重新搜索
        }
        // 其他错误继续处理
        console.warn(`Cache check failed for ${address}:`, error.message);
      }

      // 2. 如果缓存中没有，执行搜索
      console.log(`📋 Step 2: Checking if ${address} is a contract...`);
      const isContract = await this.isContractAddress(chainId, address);
      console.log(`📋 Contract check result: ${isContract}`);

      if (!isContract) {
        console.log(`❌ Address ${address} is not a contract`);
        // 缓存失败结果，避免重复检查
        await this.cacheFailedSearch(chainId, address, "not_a_contract");
        return null;
      }

      // 3. 使用二分法查找合约创建的区块
      console.log(`📋 Step 3: Starting binary search for creation block...`);
      const creationBlock = await this.findContractCreationBlock(
        chainId,
        address
      );
      console.log(
        `📋 Binary search result: ${creationBlock ? `Block ${creationBlock}` : "Not found"}`
      );

      if (!creationBlock) {
        console.log(`❌ Could not find creation block for ${address}`);
        // 缓存失败结果
        await this.cacheFailedSearch(
          chainId,
          address,
          "creation_block_not_found"
        );
        return null;
      }

      // 4. 在创建区块中查找创建交易
      console.log(
        `📋 Step 4: Searching for creation transaction in block ${creationBlock}...`
      );
      const creationTx = await this.findContractCreationTransaction(
        chainId,
        address,
        creationBlock
      );
      console.log(
        `📋 Transaction search result: ${creationTx ? `Found tx ${creationTx.txHash}` : "Not found"}`
      );

      if (!creationTx) {
        console.log(
          `❌ Could not find creation transaction for ${address} in block ${creationBlock}`
        );
        // 缓存失败结果
        await this.cacheFailedSearch(
          chainId,
          address,
          "creation_transaction_not_found"
        );
        return null;
      }

      console.log(
        `✅ Successfully found creation info for ${address}: tx ${creationTx.txHash} in block ${creationTx.blockNumber}`
      );

      // 5. 保存到数据库缓存
      console.log(`📋 Step 5: Caching creation info to database...`);
      await this.cacheCreationInfo(chainId, address, creationTx);
      console.log(`✅ Creation info cached successfully`);

      return creationTx;
    } catch (error) {
      console.error(
        `❌ Failed to get contract creation info for ${address}:`,
        error
      );
      return null;
    }
  }

  // 从数据库获取缓存的创建信息
  private async getCachedCreationInfo(
    chainId: number,
    address: string
  ): Promise<ContractCreationInfo | null> {
    try {
      const result = await db.query(
        `SELECT * FROM contract_creation_info WHERE chain_id = ? AND contract_address = ?`,
        [chainId, address.toLowerCase()]
      );

      if (result.length === 0) {
        return null;
      }

      const row = result[0];

      // 检查是否是失败的搜索记录
      if (row.tx_hash === null || row.tx_hash === "") {
        console.log(
          `Found cached failed search for ${address}: ${row.failure_reason || "unknown reason"}`
        );
        // 抛出特殊错误表示这是缓存的失败结果
        throw new Error(`CACHED_FAILURE:${row.failure_reason || "unknown"}`);
      }

      return {
        txHash: row.tx_hash,
        blockNumber: row.block_number,
        creator: row.creator,
        timestamp: row.timestamp,
        gasUsed: BigInt(row.gas_used),
        gasPrice: BigInt(row.gas_price || 0),
      };
    } catch (error) {
      console.warn(`Failed to get cached creation info for ${address}:`, error);
      return null;
    }
  }

  // 缓存创建信息到数据库
  private async cacheCreationInfo(
    chainId: number,
    address: string,
    creationInfo: ContractCreationInfo
  ): Promise<void> {
    try {
      // 先检查是否已存在
      const existing = await db.query(
        `SELECT id FROM contract_creation_info WHERE chain_id = ? AND contract_address = ?`,
        [chainId, address.toLowerCase()]
      );

      if (existing.length > 0) {
        console.log(`Creation info for ${address} already cached, skipping`);
        return;
      }

      // 插入新记录
      await db.query(
        `INSERT INTO contract_creation_info 
         (chain_id, contract_address, tx_hash, block_number, creator, timestamp, gas_used, gas_price, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chainId,
          address.toLowerCase(),
          creationInfo.txHash,
          creationInfo.blockNumber,
          creationInfo.creator,
          creationInfo.timestamp,
          creationInfo.gasUsed.toString(),
          creationInfo.gasPrice?.toString() || "0",
          new Date().toISOString(),
        ]
      );
    } catch (error) {
      console.warn(`Failed to cache creation info for ${address}:`, error);
      // 不抛出错误，缓存失败不应该影响主要功能
    }
  }

  // 缓存失败的搜索结果
  private async cacheFailedSearch(
    chainId: number,
    address: string,
    reason: string
  ): Promise<void> {
    try {
      // 先检查是否已存在
      const existing = await db.query(
        `SELECT id FROM contract_creation_info WHERE chain_id = ? AND contract_address = ?`,
        [chainId, address.toLowerCase()]
      );

      if (existing.length > 0) {
        return; // 已存在记录，不重复插入
      }

      // 插入失败记录（tx_hash为null表示失败）
      await db.query(
        `INSERT INTO contract_creation_info 
         (chain_id, contract_address, tx_hash, failure_reason, created_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          chainId,
          address.toLowerCase(),
          null, // tx_hash为null表示搜索失败
          reason,
          new Date().toISOString(),
        ]
      );
      console.log(`Cached failed search for ${address}: ${reason}`);
    } catch (error) {
      console.warn(`Failed to cache failed search for ${address}:`, error);
    }
  }

  // 使用二分法查找合约创建的区块号
  private async findContractCreationBlock(
    chainId: number,
    address: string
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
      let searchRange = 20000000n; // 开始搜索最近2000万个区块
      let left =
        latestBlockNumber > searchRange ? latestBlockNumber - searchRange : 0n;
      let right = latestBlockNumber;
      let creationBlock: number | null = null;

      // 如果搜索范围仍然很大，先检查合约在最早区块是否存在
      if (left > 1000000n) {
        console.log(
          `📋 Checking if contract exists at early block ${Number(left)}...`
        );
        const earlyCode = createRetryableRpcCall(async () => {
          return await client.getCode({
            address: address as `0x${string}`,
            blockNumber: left,
          });
        }, chainId);

        const earlyCodeResult = await earlyCode();
        const hasEarlyCode =
          earlyCodeResult &&
          earlyCodeResult !== "0x" &&
          earlyCodeResult.length > 2;

        if (hasEarlyCode) {
          console.log(
            `📋 Contract already exists at block ${Number(left)}, expanding search range...`
          );
          // 如果在搜索起点就存在，继续扩大搜索范围
          // 基于RPC测试，我们知道10M以下的区块会失败，所以限制搜索范围
          const maxSafeRange = 50000000n; // 最多搜索5000万个区块
          const expandedRange = Math.min(
            Number(maxSafeRange),
            Number(latestBlockNumber)
          );
          left = latestBlockNumber - BigInt(expandedRange);
          console.log(
            `📋 Expanded search range to ${expandedRange} blocks (${Number(left)} to ${Number(right)})`
          );
        }
      }

      console.log(
        `Starting binary search for contract ${address} creation between blocks ${left} and ${right}`
      );

      // 二分查找
      let iterations = 0;
      while (left <= right) {
        iterations++;
        const mid = (left + right) / 2n;
        const midNumber = Number(mid);

        console.log(
          `📋 Binary search iteration ${iterations}: checking block ${midNumber} (range: ${left} - ${right})`
        );

        try {
          // 检查在 mid 区块时合约是否存在
          const getCode = createRetryableRpcCall(async () => {
            return await client.getCode({
              address: address as `0x${string}`,
              blockNumber: mid,
            });
          }, chainId);

          const code = await getCode();
          const hasCode = code && code !== "0x" && code.length > 2;

          console.log(
            `📋 Block ${midNumber} check result: ${hasCode ? "Contract EXISTS" : "Contract DOES NOT EXIST"}`
          );

          if (hasCode) {
            // 合约存在，创建区块在 mid 或之前
            creationBlock = midNumber;
            right = mid - 1n;
            console.log(
              `📋 Contract exists at block ${midNumber}, searching earlier... New range: ${left} - ${right}`
            );
          } else {
            // 合约不存在，创建区块在 mid 之后
            left = mid + 1n;
            console.log(
              `📋 Contract doesn't exist at block ${midNumber}, searching later... New range: ${left} - ${right}`
            );
          }
        } catch (error) {
          console.error(`❌ Error checking block ${midNumber}:`, error.message);

          // 分析RPC错误并提供详细反馈
          const rpcClient = await rpcManager.getClient(chainId);
          const rpcUrl = rpcClient.transport?.url || "unknown";

          const errorDetails = analyzeRpcError(error, {
            blockNumber: midNumber,
            contractAddress: address,
            rpcUrl,
            chainId,
          });

          console.log(`📋 RPC错误分析:`);
          console.log(`   错误类型: ${errorDetails.error}`);
          console.log(`   建议: ${errorDetails.suggestion}`);
          console.log(`   可重试: ${errorDetails.retryable}`);
          if (errorDetails.castCommand) {
            console.log(`   验证命令: ${errorDetails.castCommand}`);
          }

          // 如果是可重试的错误，记录但继续搜索
          if (shouldRetryRpcError(errorDetails)) {
            console.log(`📋 错误可重试，继续搜索...`);
          } else {
            console.log(`📋 错误不可重试，这可能影响搜索结果的准确性`);
          }

          // 无论如何，假设合约在此区块不存在，向右搜索
          console.log(
            `📋 Due to error, assuming contract doesn't exist and searching later...`
          );
          left = mid + 1n;
        }

        // 防止无限循环，但允许更大的搜索范围
        if (right - left > 50000000n) {
          console.warn("Binary search range too large (>50M blocks), stopping");
          break;
        }

        // 如果搜索了超过30次迭代，停止搜索
        if (iterations > 30) {
          console.warn("Binary search iterations exceeded limit, stopping");
          break;
        }

        // 检查是否还有搜索空间
        if (left > right) {
          console.log(
            `📋 Search space exhausted (left ${left} > right ${right}), stopping search`
          );
          break;
        }
      }

      console.log(`📋 Binary search completed after ${iterations} iterations`);
      console.log(
        `📋 Final result: ${creationBlock ? `Found creation block ${creationBlock}` : "Creation block not found"}`
      );

      if (creationBlock !== null) {
        console.log(`Found contract creation block: ${creationBlock}`);

        // 验证找到的创建区块是否正确
        console.log(`📋 Verifying creation block ${creationBlock}...`);
        try {
          // 检查前一个区块合约是否不存在
          const prevCode = createRetryableRpcCall(async () => {
            return await client.getCode({
              address: address as `0x${string}`,
              blockNumber: BigInt(creationBlock - 1),
            });
          }, chainId);

          const prevCodeResult = await prevCode();
          const hasPrevCode =
            prevCodeResult &&
            prevCodeResult !== "0x" &&
            prevCodeResult.length > 2;

          console.log(
            `📋 Block ${creationBlock - 1}: Contract ${hasPrevCode ? "EXISTS" : "DOES NOT EXIST"}`
          );

          if (hasPrevCode) {
            console.log(
              `⚠️ Warning: Contract already exists in previous block, may not be the true creation block`
            );
          }
        } catch (error) {
          console.log(`📋 Could not verify previous block: ${error.message}`);
        }
      }

      return creationBlock;
    } catch (error) {
      console.error("Error in binary search:", error);
      return null;
    }
  }

  // 在指定区块中查找合约创建交易
  private async findContractCreationTransaction(
    chainId: number,
    contractAddress: string,
    blockNumber: number
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

      if (!block || !block.transactions) {
        return null;
      }

      console.log(
        `Searching ${block.transactions.length} transactions in block ${blockNumber} for contract creation`
      );
      console.log(`Target contract: ${contractAddress.toLowerCase()}`);

      // 遍历区块中的所有交易
      for (let i = 0; i < block.transactions.length; i++) {
        const tx = block.transactions[i];
        if (typeof tx === "string") continue;

        console.log(
          `📋 Checking tx ${i + 1}/${block.transactions.length}: ${tx.hash}`
        );
        console.log(
          `   From: ${tx.from}, To: ${tx.to || "null (contract creation)"}`
        );

        try {
          // 检查是否为合约创建交易（to 为 null 或 undefined）
          if (tx.to === null || tx.to === undefined) {
            console.log(`📋 Found contract creation tx: ${tx.hash}`);

            // 获取交易回执以确认合约地址
            const getReceipt = createRetryableRpcCall(async () => {
              return await client.getTransactionReceipt({ hash: tx.hash });
            }, chainId);

            const receipt = await getReceipt();
            console.log(
              `📋 Receipt contract address: ${receipt.contractAddress?.toLowerCase()}`
            );

            if (
              receipt &&
              receipt.contractAddress &&
              receipt.contractAddress.toLowerCase() ===
                contractAddress.toLowerCase()
            ) {
              console.log(`🎉 Found matching contract creation transaction!`);
              console.log(
                `Found contract creation transaction: ${tx.hash} created ${contractAddress}`
              );

              return {
                txHash: tx.hash,
                blockNumber: Number(block.number),
                creator: tx.from,
                timestamp: Number(block.timestamp),
                gasUsed: receipt.gasUsed,
                gasPrice: tx.gasPrice || 0n,
              };
            } else {
              console.log(
                `📋 Contract address doesn't match (expected: ${contractAddress.toLowerCase()}, got: ${receipt.contractAddress?.toLowerCase()})`
              );
            }
          } else {
            // 检查是否是通过工厂合约或其他方式创建的
            console.log(
              `📋 Checking if tx creates contract via factory or internal transaction...`
            );

            const getReceipt = createRetryableRpcCall(async () => {
              return await client.getTransactionReceipt({ hash: tx.hash });
            }, chainId);

            const receipt = await getReceipt();

            // 方法1: 检查交易日志中是否有我们目标合约的相关事件
            const hasContractEvent = receipt.logs.some(
              (log) =>
                log.address?.toLowerCase() === contractAddress.toLowerCase()
            );

            if (hasContractEvent) {
              console.log(
                `📋 Found factory/internal creation in tx: ${tx.hash}`
              );
              console.log(
                `   Transaction created events for contract: ${contractAddress}`
              );
              return {
                txHash: tx.hash,
                blockNumber: Number(block.number),
                creator: tx.from,
                timestamp: Number(block.timestamp),
                gasUsed: receipt.gasUsed,
                gasPrice: tx.gasPrice || 0n,
              };
            }

            // 方法2: 检查是否有CREATE2或CREATE操作码创建了这个合约
            console.log(
              `📋 Checking for internal contract creation via trace...`
            );

            try {
              // 使用debug_traceTransaction来获取交易的详细执行轨迹
              const trace = await client.request({
                method: "debug_traceTransaction",
                params: [tx.hash, { tracer: "callTracer" }],
              });

              // 递归检查trace中的所有调用，查找合约创建
              const findContractCreation = (call: any): boolean => {
                // 检查当前调用是否创建了目标合约
                if (call.type === "CREATE" || call.type === "CREATE2") {
                  if (
                    call.to?.toLowerCase() === contractAddress.toLowerCase()
                  ) {
                    console.log(
                      `📋 Found CREATE/CREATE2 operation creating ${contractAddress}`
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
                console.log(
                  `📋 Found internal contract creation in tx: ${tx.hash}`
                );
                return {
                  txHash: tx.hash,
                  blockNumber: Number(block.number),
                  creator: tx.from,
                  timestamp: Number(block.timestamp),
                  gasUsed: receipt.gasUsed,
                  gasPrice: tx.gasPrice || 0n,
                };
              }
            } catch (traceError) {
              console.log(
                `📋 debug_traceTransaction not supported or failed:`,
                traceError.message
              );
              // 如果trace不支持，继续检查其他方法
            }
          }
        } catch (error) {
          console.warn(`Error processing transaction ${tx.hash}:`, error);

          // 分析RPC错误
          const rpcClient = await rpcManager.getClient(chainId);
          const rpcUrl = rpcClient.transport?.url || "unknown";

          const errorDetails = analyzeRpcError(error, {
            contractAddress,
            rpcUrl,
            chainId,
          });

          console.log(`📋 Transaction check error analysis:`);
          console.log(`   Error: ${errorDetails.error}`);
          if (errorDetails.castCommand) {
            console.log(`   Verify with: ${errorDetails.castCommand}`);
          }

          continue;
        }
      }

      console.log(
        `No contract creation transaction found in block ${blockNumber}`
      );
      return null;
    } catch (error) {
      console.error("Error finding contract creation transaction:", error);
      return null;
    }
  }

  // 获取合约源码（优先级：数据库 -> Sourcify -> 返回未验证状态）
  async getContractSource(
    chainId: number,
    address: string
  ): Promise<ContractSource | null> {
    console.log(
      `🔍 Getting contract source for ${address} on chain ${chainId}`
    );

    try {
      // 1. 先从数据库查找缓存的合约信息
      console.log(`📋 Step 1: Checking database cache for contract source...`);
      const cached = await this.getFromDatabase(chainId, address);
      if (cached && this.isCacheValid(cached)) {
        console.log(`✅ Found cached contract source for ${address}`);
        console.log(`   Verification status: ${cached.verificationStatus}`);
        console.log(`   Is proxy: ${cached.isProxy || false}`);
        console.log(`   Last checked: ${cached.lastChecked}`);

        // 对于已验证的合约，直接返回缓存（包括代理信息）
        if (cached.verificationStatus === "verified") {
          console.log(
            `✅ Returning cached verified contract (no proxy re-check needed)`
          );
          return cached;
        }

        // 对于未验证的合约，检查是否需要更新代理信息
        if (!cached.isProxy) {
          console.log(
            `📋 Checking if cached unverified contract is actually a proxy...`
          );
          const proxyInfo = await this.detectProxy(chainId, address);
          if (proxyInfo.isProxy) {
            console.log(
              `⚠️ Cached contract is actually a proxy, need to refresh cache`
            );
            // 继续执行重新获取逻辑
          } else {
            console.log(
              `✅ Returning cached contract source (verified non-proxy)`
            );
            return cached;
          }
        } else {
          console.log(`✅ Returning cached proxy contract source`);
          return cached;
        }
      } else if (cached) {
        console.log(`📋 Found cached contract but cache is invalid/expired`);
        console.log(`   Last checked: ${cached.lastChecked}`);
      } else {
        console.log(`📋 No cached contract source found`);
      }

      // 2. 检查是否为合约
      const isContract = await this.isContractAddress(chainId, address);
      if (!isContract) {
        return null;
      }

      // 2.5. 检查是否为代理合约
      const proxyInfo = await this.detectProxy(chainId, address);

      // 如果是代理合约，使用特殊处理
      if (proxyInfo.isProxy) {
        console.log(`📋 Step 2.5: Handling proxy contract...`);
        console.log(`   Proxy type: ${proxyInfo.proxyType}`);
        console.log(`   Implementation: ${proxyInfo.implementationAddress}`);

        const proxyContract = await this.handleProxyContract(
          chainId,
          address,
          proxyInfo
        );
        if (proxyContract) {
          console.log(`✅ Successfully processed proxy contract`);
          console.log(`📋 Step 3: Caching proxy contract to database...`);
          await this.saveToDatabase(proxyContract);
          console.log(`✅ Proxy contract cached successfully`);
          return proxyContract;
        } else {
          console.log(
            `⚠️ Failed to process proxy contract, continuing with normal flow`
          );
        }
      } else {
        console.log(
          `📋 Contract is not a proxy, proceeding with normal source lookup`
        );
      }

      console.log(
        `📋 Step 3: Fetching contract source from external sources...`
      );

      // 3. 尝试从 Sourcify 获取（非代理合约）
      console.log(`📋 Trying Sourcify...`);
      const sourcifyResult = await this.fetchFromSourcify(chainId, address);
      if (sourcifyResult) {
        console.log(`✅ Found contract source from Sourcify`);
        console.log(`📋 Step 4: Caching contract source to database...`);
        await this.saveToDatabase(sourcifyResult);
        console.log(`✅ Contract source cached successfully`);
        return sourcifyResult;
      }

      // 3.5. 尝试从链特定的区块浏览器获取（非代理合约）
      console.log(`📋 Trying chain-specific explorer...`);
      const explorerResult = await this.fetchFromChainExplorer(
        chainId,
        address
      );
      if (explorerResult) {
        console.log(`✅ Found contract source from chain explorer`);
        console.log(`📋 Step 4: Caching contract source to database...`);
        await this.saveToDatabase(explorerResult);
        console.log(`✅ Contract source cached successfully`);
        return explorerResult;
      }

      // 4. 如果都没找到，返回未验证状态
      console.log(`📋 No verified source found, creating unverified record`);
      const unverifiedContract: ContractSource = {
        chainId,
        address: address.toLowerCase(),
        sourceCode: "",
        abi: "[]",
        verificationStatus: "unverified",
        verificationSource: "unknown",
        lastChecked: new Date(),
      };

      console.log(`📋 Step 4: Caching unverified contract to database...`);
      await this.saveToDatabase(unverifiedContract);
      console.log(`✅ Unverified contract cached (to avoid future lookups)`);
      return unverifiedContract;
    } catch (error) {
      console.error(`Failed to get contract source for ${address}:`, error);
      return null;
    }
  }

  // 从 Sourcify 获取合约源码
  private async fetchFromSourcify(
    chainId: number,
    address: string
  ): Promise<ContractSource | null> {
    try {
      const baseUrl = "https://sourcify.dev/server";

      // 检查合约是否在 Sourcify 中验证
      const checkUrl = `${baseUrl}/check-by-addresses?addresses=${address}&chainIds=${chainId}`;
      const checkResponse = await fetch(checkUrl);

      if (!checkResponse.ok) {
        return null;
      }

      const checkResult = await checkResponse.json();
      if (!checkResult || checkResult.length === 0) {
        return null;
      }

      const contractInfo = checkResult[0];
      if (
        contractInfo.status !== "perfect" &&
        contractInfo.status !== "partial"
      ) {
        return null;
      }

      // 获取源码文件
      const filesUrl = `${baseUrl}/files/any/${chainId}/${address}`;
      const filesResponse = await fetch(filesUrl);

      if (!filesResponse.ok) {
        return null;
      }

      const files = await filesResponse.json();

      // 查找主合约文件和 ABI
      let sourceCode = "";
      let abi = "[]";
      let contractName = "";
      let compilerVersion = "";

      // 查找 metadata.json
      const metadataFile = files.find((f: any) => f.name === "metadata.json");
      if (metadataFile) {
        try {
          const metadata = JSON.parse(metadataFile.content);
          abi = JSON.stringify(metadata.output?.abi || []);
          compilerVersion = metadata.compiler?.version || "";

          // 获取合约名称
          if (metadata.settings?.compilationTarget) {
            const target = Object.keys(metadata.settings.compilationTarget)[0];
            contractName = metadata.settings.compilationTarget[target];
          }
        } catch (e) {
          console.warn("Failed to parse metadata:", e);
        }
      }

      // 查找 Solidity 源码文件
      const solidityFiles = files.filter((f: any) => f.name.endsWith(".sol"));
      if (solidityFiles.length > 0) {
        // 如果有多个文件，合并所有源码
        if (solidityFiles.length === 1) {
          sourceCode = solidityFiles[0].content;
        } else {
          sourceCode = solidityFiles
            .map((f: any) => `// File: ${f.name}\n${f.content}`)
            .join("\n\n");
        }
      }

      return {
        chainId,
        address: address.toLowerCase(),
        name: contractName,
        compilerVersion,
        sourceCode,
        abi,
        verificationStatus:
          contractInfo.status === "perfect" ? "verified" : "partial",
        verificationSource: "sourcify",
        verifiedAt: new Date(),
        lastChecked: new Date(),
      };
    } catch (error) {
      console.error("Sourcify fetch error:", error);
      return null;
    }
  }

  // 从链特定的区块浏览器获取合约源码
  private async fetchFromChainExplorer(
    chainId: number,
    address: string
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
        console.error(`Explorer API error: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.status !== "1" || !data.result || data.result.length === 0) {
        return null;
      }

      const contractData = data.result[0];

      // 检查是否有源码
      if (!contractData.SourceCode || contractData.SourceCode.trim() === "") {
        return null;
      }

      return {
        chainId,
        address: address.toLowerCase(),
        name: contractData.ContractName || "Unknown",
        compilerVersion: contractData.CompilerVersion || "Unknown",
        optimizationEnabled: contractData.OptimizationUsed === "1",
        optimizationRuns: parseInt(contractData.Runs || "200"),
        sourceCode: contractData.SourceCode,
        abi: contractData.ABI || "[]",
        constructorArguments: contractData.ConstructorArguments || "",
        verificationStatus: "verified",
        verificationSource: explorerConfig.name,
        verifiedAt: new Date(),
        lastChecked: new Date(),
      };
    } catch (error) {
      console.error("Chain explorer fetch error:", error);
      return null;
    }
  }

  // 获取链特定的区块浏览器配置
  private getExplorerConfig(
    chainId: number
  ): { name: "mantle-explorer" | "etherscan"; apiUrl: string } | null {
    const configs: Record<
      number,
      { name: "mantle-explorer" | "etherscan"; apiUrl: string }
    > = {
      5000: {
        // Mantle
        name: "mantle-explorer",
        apiUrl: "https://explorer.mantle.xyz/api",
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
  private async isContractAddress(
    chainId: number,
    address: string
  ): Promise<boolean> {
    try {
      const client = await rpcManager.getClient(chainId);
      const code = await client.getCode({ address: address as `0x${string}` });
      return Boolean(code && code !== "0x" && code.length > 2);
    } catch (error) {
      console.error("Failed to check contract address:", error);
      return false;
    }
  }

  // 专门处理代理合约
  private async handleProxyContract(
    chainId: number,
    address: string,
    proxyInfo: {
      isProxy: boolean;
      proxyType?: "transparent" | "uups" | "beacon" | "minimal" | "unknown";
      implementationAddress?: string;
    }
  ): Promise<ContractSource | null> {
    try {
      // 获取代理合约本身的源码
      let proxyContract: ContractSource | null = null;

      // 尝试从 Sourcify 获取代理合约源码
      proxyContract = await this.fetchFromSourcify(chainId, address);

      // 如果 Sourcify 没有，尝试从区块浏览器获取
      if (!proxyContract) {
        const explorerResult = await this.fetchFromChainExplorer(
          chainId,
          address
        );

        // 检查区块浏览器返回的是否是代理合约本身的源码
        // 如果返回的地址与请求的地址不同，说明返回的是实现合约的源码
        if (
          explorerResult &&
          explorerResult.address.toLowerCase() === address.toLowerCase()
        ) {
          proxyContract = explorerResult;
        }
      }

      // 如果还是没有，创建基本的代理合约信息
      if (!proxyContract) {
        proxyContract = {
          chainId,
          address: address.toLowerCase(),
          name: `TransparentUpgradeableProxy`,
          sourceCode:
            "// This is a proxy contract. The actual implementation is at the implementation address.",
          abi: JSON.stringify([
            {
              inputs: [],
              name: "implementation",
              outputs: [{ internalType: "address", name: "", type: "address" }],
              stateMutability: "view",
              type: "function",
            },
          ]),
          verificationStatus: "verified" as const,
          verificationSource: "manual" as const,
          lastChecked: new Date(),
        };
      }

      // 获取实现合约的源码
      let implementationContract: ContractSource | null = null;
      if (proxyInfo.implementationAddress) {
        implementationContract = await this.getContractSource(
          chainId,
          proxyInfo.implementationAddress
        );
      }

      // 返回增强的代理合约信息
      return {
        ...proxyContract,
        isProxy: true,
        proxyType: proxyInfo.proxyType,
        implementationAddress: proxyInfo.implementationAddress,
        implementationContract: implementationContract || undefined,
      };
    } catch (error) {
      console.error("Failed to handle proxy contract:", error);
      return null;
    }
  }

  // 增强合约信息，检测代理并获取实现合约
  private async enhanceWithProxyInfo(
    contract: ContractSource,
    proxyInfo?: {
      isProxy: boolean;
      proxyType?: "transparent" | "uups" | "beacon" | "minimal" | "unknown";
      implementationAddress?: string;
    }
  ): Promise<ContractSource> {
    try {
      // 如果没有传入代理信息，则检测
      if (!proxyInfo) {
        proxyInfo = await this.detectProxy(contract.chainId, contract.address);

        // 如果通过存储槽检测没有发现代理，尝试通过名称检测
        if (
          !proxyInfo.isProxy &&
          contract.name?.toLowerCase().includes("proxy")
        ) {
          proxyInfo = {
            isProxy: true,
            proxyType: "unknown",
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
          proxyInfo.implementationAddress
        );
      }

      return {
        ...contract,
        isProxy: true,
        proxyType: proxyInfo.proxyType,
        implementationAddress: proxyInfo.implementationAddress,
        implementationContract: implementationContract || undefined,
      };
    } catch (error) {
      console.error("Failed to enhance with proxy info:", error);
      return contract;
    }
  }

  // 检测代理合约类型和实现地址
  private async detectProxy(
    chainId: number,
    address: string
  ): Promise<{
    isProxy: boolean;
    proxyType?: "transparent" | "uups" | "beacon" | "minimal" | "unknown";
    implementationAddress?: string;
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
        "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

      try {
        const implementationData = await client.getStorageAt({
          address: address as `0x${string}`,
          slot: implementationSlot as `0x${string}`,
        });

        if (
          implementationData &&
          implementationData !==
            "0x0000000000000000000000000000000000000000000000000000000000000000"
        ) {
          // 提取地址（后20字节）
          const implementationAddress = "0x" + implementationData.slice(-40);

          // 验证实现地址是否为有效合约
          const isValidImplementation = await this.isContractAddress(
            chainId,
            implementationAddress
          );

          if (isValidImplementation) {
            return {
              isProxy: true,
              proxyType: "transparent",
              implementationAddress: implementationAddress.toLowerCase(),
            };
          }
        }
      } catch (error) {
        console.warn("Failed to check EIP-1967 implementation slot:", error);
      }

      // 检查 UUPS 代理（EIP-1822）
      // 实现合约可能在相同的槽位

      // 检查 Beacon 代理
      // EIP-1967 Beacon: 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
      const beaconSlot =
        "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

      try {
        const beaconData = await client.getStorageAt({
          address: address as `0x${string}`,
          slot: beaconSlot as `0x${string}`,
        });

        if (
          beaconData &&
          beaconData !==
            "0x0000000000000000000000000000000000000000000000000000000000000000"
        ) {
          const beaconAddress = "0x" + beaconData.slice(-40);

          // 从 Beacon 获取实现地址
          // Beacon 通常有一个 implementation() 函数
          // 这里简化处理，标记为 beacon 类型
          return {
            isProxy: true,
            proxyType: "beacon",
            implementationAddress: beaconAddress.toLowerCase(),
          };
        }
      } catch (error) {
        console.warn("Failed to check beacon slot:", error);
      }

      // 如果没有找到明确的代理模式，返回非代理
      // 注意：这里不能访问 contract 对象，因为这是一个独立的检测方法

      return { isProxy: false };
    } catch (error) {
      console.error("Failed to detect proxy:", error);
      return { isProxy: false };
    }
  }

  // 从数据库获取缓存的合约信息
  private async getFromDatabase(
    chainId: number,
    address: string
  ): Promise<ContractSource | null> {
    try {
      const rows = await db.query(
        `SELECT * FROM contract_sources WHERE chain_id = ? AND address = ?`,
        [chainId, address.toLowerCase()]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      return {
        chainId: row.chain_id,
        address: row.address,
        name: row.name,
        compilerVersion: row.compiler_version,
        optimizationEnabled: row.optimization_enabled,
        optimizationRuns: row.optimization_runs,
        sourceCode: row.source_code,
        abi: row.abi,
        constructorArguments: row.constructor_arguments,
        verificationStatus: row.verification_status,
        verificationSource: row.verification_source,
        verifiedAt: row.verified_at ? new Date(row.verified_at) : undefined,
        lastChecked: new Date(row.last_checked),
        isProxy: row.is_proxy || false,
        proxyType: row.proxy_type || undefined,
        implementationAddress: row.implementation_address || undefined,
        // 注意：implementationContract 不从数据库加载，需要时动态获取
      };
    } catch (error) {
      console.error("Database query error:", error);
      return null;
    }
  }

  // 保存到数据库
  private async saveToDatabase(contractSource: ContractSource): Promise<void> {
    try {
      await db.query(
        `
        INSERT OR REPLACE INTO contract_sources (
          chain_id, address, name, compiler_version, optimization_enabled,
          optimization_runs, source_code, abi, constructor_arguments,
          verification_status, verification_source, verified_at, last_checked,
          is_proxy, proxy_type, implementation_address
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          contractSource.chainId,
          contractSource.address,
          contractSource.name,
          contractSource.compilerVersion,
          contractSource.optimizationEnabled,
          contractSource.optimizationRuns,
          contractSource.sourceCode,
          contractSource.abi,
          contractSource.constructorArguments,
          contractSource.verificationStatus,
          contractSource.verificationSource,
          contractSource.verifiedAt?.toISOString(),
          contractSource.lastChecked.toISOString(),
          contractSource.isProxy || false,
          contractSource.proxyType || null,
          contractSource.implementationAddress || null,
        ]
      );
    } catch (error) {
      console.error("Failed to save contract source:", error);
    }
  }

  // 检查缓存是否有效
  private isCacheValid(contractSource: ContractSource): boolean {
    const now = new Date();
    const lastChecked = contractSource.lastChecked;
    const hoursDiff =
      (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);

    // 缓存策略：
    // - 已验证的合约：30天（合约源码不会变）
    // - 未验证的合约：3天（可能后续会被验证）
    // - 代理合约：30天（代理关系通常不会变）
    let maxHours: number;

    if (
      contractSource.verificationStatus === "verified" ||
      contractSource.isProxy
    ) {
      maxHours = 24 * 30; // 30天
    } else {
      maxHours = 24 * 3; // 3天
    }

    const isValid = hoursDiff < maxHours;

    if (!isValid) {
      console.log(`📋 Cache expired for ${contractSource.address}:`);
      console.log(`   Hours since last check: ${hoursDiff.toFixed(1)}`);
      console.log(`   Max hours allowed: ${maxHours}`);
      console.log(
        `   Verification status: ${contractSource.verificationStatus}`
      );
      console.log(`   Is proxy: ${contractSource.isProxy || false}`);
    }

    return isValid;
  }

  // 解析 ABI 并提取函数信息
  async getContractFunctions(chainId: number, address: string) {
    try {
      const contractSource = await this.getContractSource(chainId, address);
      if (!contractSource || !contractSource.abi) {
        return { functions: [], events: [], errors: [] };
      }

      const abi = JSON.parse(contractSource.abi);

      const functions = abi.filter((item: any) => item.type === "function");
      const events = abi.filter((item: any) => item.type === "event");
      const errors = abi.filter((item: any) => item.type === "error");

      return {
        functions: functions.map((f: any) => ({
          name: f.name,
          type: f.stateMutability || "nonpayable",
          inputs: f.inputs || [],
          outputs: f.outputs || [],
          signature: this.generateFunctionSignature(f),
        })),
        events: events.map((e: any) => ({
          name: e.name,
          inputs: e.inputs || [],
          signature: this.generateEventSignature(e),
        })),
        errors: errors.map((e: any) => ({
          name: e.name,
          inputs: e.inputs || [],
        })),
      };
    } catch (error) {
      console.error("Failed to parse contract ABI:", error);
      return { functions: [], events: [], errors: [] };
    }
  }

  // 生成函数签名
  private generateFunctionSignature(func: any): string {
    const inputs =
      func.inputs?.map((input: any) => input.type).join(", ") || "";
    return `${func.name}(${inputs})`;
  }

  // 生成事件签名
  private generateEventSignature(event: any): string {
    const inputs =
      event.inputs?.map((input: any) => input.type).join(", ") || "";
    return `${event.name}(${inputs})`;
  }

  // 获取合约统计信息
  async getContractStats(chainId: number) {
    try {
      const rows = await db.query(
        `
        SELECT 
          verification_status,
          COUNT(*) as count
        FROM contract_sources 
        WHERE chain_id = ?
        GROUP BY verification_status
      `,
        [chainId]
      );

      const stats = {
        total: 0,
        verified: 0,
        unverified: 0,
        partial: 0,
      };

      rows.forEach((row: any) => {
        stats.total += row.count;
        if (row.verification_status === "verified") {
          stats.verified = row.count;
        } else if (row.verification_status === "unverified") {
          stats.unverified = row.count;
        } else if (row.verification_status === "partial") {
          stats.partial = row.count;
        }
      });

      return stats;
    } catch (error) {
      console.error("Failed to get contract stats:", error);
      return { total: 0, verified: 0, unverified: 0, partial: 0 };
    }
  }
}

export const contractSourceService = new ContractSourceService();
