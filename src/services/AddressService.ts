import { db } from "../database/init";
import { rpcManager } from "./RpcManager";
import { transactionService, type Transaction } from "./TransactionService";
import { contractSourceService } from "./ContractSourceService";

/**
 * 地址数据类型
 */
export type AddressInfo = {
  chainId: number;
  address: string;
  balance: string;
  transactionCount: number;
  isContract: boolean;
  contractCode?: string;
  contractName?: string;
  verificationStatus?: "verified" | "unverified" | "partial";
  hasSourceCode?: boolean;
  label?: string;
  firstSeenBlock?: bigint;
  lastSeenBlock?: bigint;
  lastQueried?: Date;
};

/**
 * 地址服务
 * 负责获取地址信息、余额和交易历史
 */
export class AddressService {
  // 获取地址基本信息
  async getAddressInfo(chainId: number, address: string): Promise<AddressInfo> {
    try {
      const client = await rpcManager.getClient(chainId);

      // 并行获取余额、交易数量和代码
      const [balance, transactionCount, code] = await Promise.all([
        client.getBalance({ address: address as `0x${string}` }),
        client.getTransactionCount({ address: address as `0x${string}` }),
        client.getCode({ address: address as `0x${string}` }).catch(() => "0x"),
      ]);

      const isContract = Boolean(code && code !== "0x" && code.length > 2);

      // 从数据库获取额外信息
      const dbInfo = await this.getAddressFromDB(chainId, address);

      // 如果是合约，获取源码信息
      let contractName: string | undefined;
      let verificationStatus: "verified" | "unverified" | "partial" | undefined;
      let hasSourceCode = false;

      if (isContract) {
        try {
          const contractSource = await contractSourceService.getContractSource(
            chainId,
            address
          );
          if (contractSource) {
            contractName = contractSource.name;
            verificationStatus = contractSource.verificationStatus;
            hasSourceCode = contractSource.sourceCode.length > 0;
          }
        } catch (error) {
          console.warn(`Failed to get contract source for ${address}:`, error);
        }
      }

      // 更新数据库中的地址信息
      await this.updateAddressInDB(chainId, address, {
        transactionCount: Number(transactionCount),
        lastQueried: new Date(),
      });

      return {
        chainId,
        address: address.toLowerCase(),
        balance: balance.toString(),
        transactionCount: Number(transactionCount),
        isContract,
        contractCode: isContract ? code : undefined,
        contractName,
        verificationStatus,
        hasSourceCode,
        label: dbInfo?.label,
        firstSeenBlock: dbInfo?.firstSeenBlock,
        lastSeenBlock: dbInfo?.lastSeenBlock,
        lastQueried: new Date(),
      };
    } catch (error) {
      console.error(`Failed to get address info for ${address}:`, error);
      throw new Error("Failed to get address information");
    }
  }

  // 获取地址余额
  async getAddressBalance(chainId: number, address: string): Promise<string> {
    try {
      const client = await rpcManager.getClient(chainId);
      const balance = await client.getBalance({
        address: address as `0x${string}`,
      });
      return balance.toString();
    } catch (error) {
      console.error(`Failed to get balance for ${address}:`, error);
      throw new Error("Failed to get address balance");
    }
  }

  // 获取地址交易历史（使用轻量级方法）
  async getAddressTransactions(
    chainId: number,
    address: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ transactions: Transaction[]; total: number; method: string }> {
    try {
      // 首先尝试从数据库获取已索引的交易
      const dbResult = await transactionService.getTransactionsByAddress(
        chainId,
        address,
        limit,
        offset
      );

      if (dbResult.transactions.length > 0) {
        return {
          ...dbResult,
          method: "database",
        };
      }

      // 如果数据库中没有数据，使用轻量级方法
      const lightweightResult = await this.getLightweightTransactionHistory(
        chainId,
        address,
        limit
      );

      return {
        transactions: lightweightResult,
        total: lightweightResult.length,
        method: "lightweight",
      };
    } catch (error) {
      console.error(`Failed to get transactions for ${address}:`, error);
      return { transactions: [], total: 0, method: "error" };
    }
  }

  // 轻量级交易历史获取（基于余额变化的二分查找）
  private async getLightweightTransactionHistory(
    chainId: number,
    address: string,
    limit: number = 20
  ): Promise<Transaction[]> {
    try {
      const client = await rpcManager.getClient(chainId);

      // 获取当前交易数量
      const currentNonce = await client.getTransactionCount({
        address: address as `0x${string}`,
      });

      if (currentNonce === 0) {
        return [];
      }

      // 获取最新的几个区块，寻找包含该地址的交易
      const latestBlockNumber = await client.getBlockNumber();
      const searchBlocks = Math.min(Number(currentNonce) * 2, 20); // 减少搜索范围到20个区块
      const startBlock = latestBlockNumber - BigInt(searchBlocks);

      const transactions: Transaction[] = [];
      let processedBlocks = 0;
      const maxProcessedBlocks = 10; // 最多处理10个区块

      for (
        let i = 0;
        i < searchBlocks &&
        transactions.length < limit &&
        processedBlocks < maxProcessedBlocks;
        i++
      ) {
        const blockNumber = latestBlockNumber - BigInt(i);
        if (blockNumber < startBlock) break;

        try {
          processedBlocks++;
          const block = await client.getBlock({
            blockNumber,
            includeTransactions: true,
          });

          if (block.transactions) {
            // 只处理前50个交易，避免处理太多交易
            const txsToProcess = Array.isArray(block.transactions)
              ? block.transactions.slice(0, 50)
              : [block.transactions];

            for (const tx of txsToProcess) {
              if (
                typeof tx === "object" &&
                (tx.from?.toLowerCase() === address.toLowerCase() ||
                  tx.to?.toLowerCase() === address.toLowerCase())
              ) {
                // 简化：不获取receipt以减少RPC调用
                transactions.push({
                  chainId,
                  hash: tx.hash,
                  blockNumber: tx.blockNumber,
                  transactionIndex: tx.transactionIndex,
                  fromAddress: tx.from?.toLowerCase(),
                  toAddress: tx.to?.toLowerCase(),
                  value: tx.value?.toString() || "0",
                  gasLimit: tx.gas,
                  gasPrice: tx.gasPrice,
                  gasUsed: undefined, // 跳过receipt查询
                  status: 1, // 假设成功
                  type: tx.type || 0,
                  nonce: tx.nonce,
                  timestamp: new Date(Number(block.timestamp) * 1000),
                });

                if (transactions.length >= limit) break;
              }
            }
          }
        } catch (error) {
          console.warn(`Failed to get block ${blockNumber}:`, error);
        }
      }

      return transactions.sort((a, b) => {
        if (a.blockNumber && b.blockNumber) {
          return Number(b.blockNumber - a.blockNumber);
        }
        return 0;
      });
    } catch (error) {
      console.error("Failed to get lightweight transaction history:", error);
      return [];
    }
  }

  // 检查地址是否为合约
  async isContract(chainId: number, address: string): Promise<boolean> {
    try {
      const client = await rpcManager.getClient(chainId);
      const code = await client.getCode({ address: address as `0x${string}` });
      return Boolean(code && code !== "0x" && code.length > 2);
    } catch (error) {
      console.error(`Failed to check if ${address} is contract:`, error);
      return false;
    }
  }

  // 获取合约代码
  async getContractCode(
    chainId: number,
    address: string
  ): Promise<string | null> {
    try {
      const client = await rpcManager.getClient(chainId);
      const code = await client.getCode({ address: address as `0x${string}` });
      return code !== "0x" ? code : null;
    } catch (error) {
      console.error(`Failed to get contract code for ${address}:`, error);
      return null;
    }
  }

  // 估算地址的代币余额（如果是ERC20代币）
  async getTokenBalance(
    chainId: number,
    tokenAddress: string,
    holderAddress: string
  ): Promise<string | null> {
    try {
      const client = await rpcManager.getClient(chainId);

      // ERC20 balanceOf函数的调用数据
      const balanceOfData = `0x70a08231${holderAddress.slice(2).padStart(64, "0")}`;

      const result = await client.call({
        to: tokenAddress as `0x${string}`,
        data: balanceOfData as `0x${string}`,
      });

      if (result.data && result.data !== "0x") {
        // 解析返回的余额
        const balance = BigInt(result.data);
        return balance.toString();
      }

      return null;
    } catch (error) {
      console.error(`Failed to get token balance:`, error);
      return null;
    }
  }

  // 从数据库获取地址信息
  private async getAddressFromDB(
    chainId: number,
    address: string
  ): Promise<{
    label?: string;
    firstSeenBlock?: bigint;
    lastSeenBlock?: bigint;
  } | null> {
    try {
      const result = await db.query<{
        label: string;
        first_seen_block: string;
        last_seen_block: string;
      }>(
        `
        SELECT label, first_seen_block, last_seen_block 
        FROM indexed_addresses 
        WHERE chain_id = ? AND address = ?
        LIMIT 1
      `,
        [chainId, address.toLowerCase()]
      );

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        label: row.label || undefined,
        firstSeenBlock: row.first_seen_block
          ? BigInt(row.first_seen_block)
          : undefined,
        lastSeenBlock: row.last_seen_block
          ? BigInt(row.last_seen_block)
          : undefined,
      };
    } catch (error) {
      console.warn(`Failed to get address from DB:`, error);
      return null;
    }
  }

  // 更新数据库中的地址信息
  private async updateAddressInDB(
    chainId: number,
    address: string,
    info: {
      transactionCount?: number;
      lastQueried?: Date;
      firstSeenBlock?: bigint;
      lastSeenBlock?: bigint;
      label?: string;
    }
  ): Promise<void> {
    try {
      await db.query(
        `
        INSERT OR REPLACE INTO indexed_addresses (
          chain_id, address, label, first_seen_block, last_seen_block,
          transaction_count, last_queried, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          chainId,
          address.toLowerCase(),
          info.label || null,
          info.firstSeenBlock?.toString() || null,
          info.lastSeenBlock?.toString() || null,
          info.transactionCount || 0,
          info.lastQueried?.toISOString() || new Date().toISOString(),
          new Date().toISOString(),
        ]
      );
    } catch (error) {
      console.warn("Failed to update address in DB:", error);
    }
  }

  // 设置地址标签
  async setAddressLabel(
    chainId: number,
    address: string,
    label: string
  ): Promise<void> {
    try {
      await this.updateAddressInDB(chainId, address, { label });
    } catch (error) {
      console.error("Failed to set address label:", error);
      throw new Error("Failed to set address label");
    }
  }

  // 获取最近查询的地址
  async getRecentAddresses(
    chainId: number,
    limit: number = 10
  ): Promise<AddressInfo[]> {
    try {
      const result = await db.query<{
        address: string;
        label: string;
        transaction_count: number;
        last_queried: string;
      }>(
        `
        SELECT address, label, transaction_count, last_queried 
        FROM indexed_addresses 
        WHERE chain_id = ?
        ORDER BY last_queried DESC 
        LIMIT ?
      `,
        [chainId, limit]
      );

      const addresses: AddressInfo[] = [];

      for (const row of result) {
        try {
          const balance = await this.getAddressBalance(chainId, row.address);
          const isContract = await this.isContract(chainId, row.address);

          addresses.push({
            chainId,
            address: row.address,
            balance,
            transactionCount: row.transaction_count,
            isContract,
            label: row.label || undefined,
            lastQueried: new Date(row.last_queried),
          });
        } catch (error) {
          console.warn(`Failed to get info for address ${row.address}:`, error);
        }
      }

      return addresses;
    } catch (error) {
      console.error("Failed to get recent addresses:", error);
      return [];
    }
  }
}

// 导出全局实例
export const addressService = new AddressService();
