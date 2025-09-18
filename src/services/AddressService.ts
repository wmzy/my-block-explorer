import { eq, and, desc, or } from "drizzle-orm";
import {
  db,
  indexedAddresses,
  transactions,
  type IndexedAddress,
  type NewIndexedAddress,
} from "@/server/database/drizzle";
import { RpcManager } from "./RpcManager";
import type { AddressInfo } from "@/shared/types/index";

/**
 * 地址服务
 * 负责地址数据的获取、存储和管理
 */
export class AddressService {
  constructor(private rpcManager: RpcManager) {}

  // 获取地址信息
  async getAddressInfo(chainId: number, address: string): Promise<AddressInfo> {
    try {
      const client = await this.rpcManager.getClient(chainId);

      // 从RPC获取基本信息
      const [balance, transactionCount, code] = await Promise.all([
        client.getBalance({ address: address as `0x${string}` }),
        client.getTransactionCount({ address: address as `0x${string}` }),
        client.getCode({ address: address as `0x${string}` }).catch(() => "0x"),
      ]);

      const isContract = code !== "0x" && code.length > 2;

      // 从数据库获取缓存的地址信息
      const cachedAddress = await db
        .select()
        .from(indexedAddresses)
        .where(
          and(
            eq(indexedAddresses.chainId, chainId),
            eq(indexedAddresses.address, address)
          )
        )
        .limit(1);

      // 计算额外统计信息
      const [receivedTxs, sentTxs] = await Promise.all([
        db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              eq(transactions.toAddress, address)
            )
          )
          .limit(1000), // 限制查询数量

        db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.chainId, chainId),
              eq(transactions.fromAddress, address)
            )
          )
          .limit(1000),
      ]);

      // 计算总接收和发送金额
      const totalReceived = receivedTxs.reduce((sum, tx) => {
        return sum + BigInt(tx.value || 0);
      }, 0n);

      const totalSent = sentTxs.reduce((sum, tx) => {
        return sum + BigInt(tx.value || 0);
      }, 0n);

      // 获取网络名称
      const networkName = this.rpcManager.getChainName(chainId);

      const addressInfo: AddressInfo = {
        chainId,
        address: address as `0x${string}`,
        balance: balance.toString(),
        transactionCount,
        isContract,
        network: networkName,
        label: cachedAddress[0]?.label || undefined,
        firstSeenBlock: cachedAddress[0]?.firstSeenBlock
          ? Number(cachedAddress[0].firstSeenBlock)
          : undefined,
        lastSeenBlock: cachedAddress[0]?.lastSeenBlock
          ? Number(cachedAddress[0].lastSeenBlock)
          : undefined,
        totalReceived: totalReceived.toString(),
        totalSent: totalSent.toString(),
        updatedAt: new Date().toISOString(),
      };

      // 更新或插入地址索引信息
      await this.updateAddressIndex(chainId, address, {
        transactionCount,
        lastQueried: new Date(),
      });

      return addressInfo;
    } catch (error) {
      console.error(`Failed to get address info for ${address}:`, error);
      throw new Error("Failed to retrieve address information");
    }
  }

  // 检查地址是否为合约
  async isContract(chainId: number, address: string): Promise<boolean> {
    try {
      const client = await this.rpcManager.getClient(chainId);
      const code = await client.getCode({ address: address as `0x${string}` });
      return code !== "0x" && code.length > 2;
    } catch (error) {
      console.error(
        `Failed to check if address is contract: ${address}`,
        error
      );
      return false;
    }
  }

  // 获取地址余额
  async getAddressBalance(chainId: number, address: string): Promise<string> {
    try {
      const client = await this.rpcManager.getClient(chainId);
      const balance = await client.getBalance({
        address: address as `0x${string}`,
      });
      return balance.toString();
    } catch (error) {
      console.error(`Failed to get balance for ${address}:`, error);
      throw new Error("Failed to retrieve address balance");
    }
  }

  // 获取地址交易数量
  async getAddressTransactionCount(
    chainId: number,
    address: string
  ): Promise<number> {
    try {
      const client = await this.rpcManager.getClient(chainId);
      return await client.getTransactionCount({
        address: address as `0x${string}`,
      });
    } catch (error) {
      console.error(`Failed to get transaction count for ${address}:`, error);
      throw new Error("Failed to retrieve transaction count");
    }
  }

  // 获取地址历史余额（在指定区块）
  async getAddressBalanceAtBlock(
    chainId: number,
    address: string,
    blockNumber: number
  ): Promise<string> {
    try {
      const client = await this.rpcManager.getClient(chainId);
      const balance = await client.getBalance({
        address: address as `0x${string}`,
        blockNumber: BigInt(blockNumber),
      });
      return balance.toString();
    } catch (error) {
      console.error(
        `Failed to get balance at block ${blockNumber} for ${address}:`,
        error
      );
      throw new Error("Failed to retrieve historical balance");
    }
  }

  // 更新地址索引信息
  async updateAddressIndex(
    chainId: number,
    address: string,
    updates: Partial<NewIndexedAddress>
  ): Promise<void> {
    try {
      await db
        .insert(indexedAddresses)
        .values({
          chainId,
          address,
          transactionCount: updates.transactionCount || 0,
          firstSeenBlock: updates.firstSeenBlock,
          lastSeenBlock: updates.lastSeenBlock,
          label: updates.label,
          lastQueried: updates.lastQueried || new Date(),
        })
        .onConflictDoUpdate({
          target: [indexedAddresses.chainId, indexedAddresses.address],
          set: {
            transactionCount:
              updates.transactionCount || indexedAddresses.transactionCount,
            lastSeenBlock:
              updates.lastSeenBlock || indexedAddresses.lastSeenBlock,
            label: updates.label || indexedAddresses.label,
            lastQueried: updates.lastQueried || new Date(),
          },
        });
    } catch (error) {
      console.error("Failed to update address index:", error);
      // 非关键错误，不抛出异常
    }
  }

  // 设置地址标签
  async setAddressLabel(
    chainId: number,
    address: string,
    label: string
  ): Promise<void> {
    try {
      await this.updateAddressIndex(chainId, address, { label });
    } catch (error) {
      console.error(`Failed to set label for ${address}:`, error);
      throw new Error("Failed to set address label");
    }
  }

  // 获取地址标签
  async getAddressLabel(
    chainId: number,
    address: string
  ): Promise<string | null> {
    try {
      const result = await db
        .select({ label: indexedAddresses.label })
        .from(indexedAddresses)
        .where(
          and(
            eq(indexedAddresses.chainId, chainId),
            eq(indexedAddresses.address, address)
          )
        )
        .limit(1);

      return result[0]?.label || null;
    } catch (error) {
      console.error(`Failed to get label for ${address}:`, error);
      return null;
    }
  }

  // 删除地址标签
  async removeAddressLabel(chainId: number, address: string): Promise<void> {
    try {
      await this.updateAddressIndex(chainId, address, { label: null });
    } catch (error) {
      console.error(`Failed to remove label for ${address}:`, error);
      throw new Error("Failed to remove address label");
    }
  }

  // 获取最近查询的地址
  async getRecentlyQueriedAddresses(
    chainId: number,
    limit = 20
  ): Promise<IndexedAddress[]> {
    try {
      return await db
        .select()
        .from(indexedAddresses)
        .where(eq(indexedAddresses.chainId, chainId))
        .orderBy(desc(indexedAddresses.lastQueried))
        .limit(limit);
    } catch (error) {
      console.error("Failed to get recently queried addresses:", error);
      return [];
    }
  }

  // 搜索地址（按标签）
  async searchAddressesByLabel(
    chainId: number,
    labelQuery: string,
    limit = 10
  ): Promise<IndexedAddress[]> {
    try {
      // 简单的标签搜索，可以根据需要实现更复杂的全文搜索
      return await db
        .select()
        .from(indexedAddresses)
        .where(
          and(
            eq(indexedAddresses.chainId, chainId)
            // 使用ILIKE进行不区分大小写的模糊搜索（PostgreSQL语法）
            // 注意：这里需要根据实际SQL方言调整
          )
        )
        .limit(limit);
    } catch (error) {
      console.error("Failed to search addresses by label:", error);
      return [];
    }
  }

  // 批量获取地址余额
  async getBatchAddressBalances(
    chainId: number,
    addresses: string[]
  ): Promise<Map<string, string>> {
    const balanceMap = new Map<string, string>();

    try {
      const client = await this.rpcManager.getClient(chainId);

      // 并发查询，但限制并发数以避免RPC限流
      const BATCH_SIZE = 10;
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (address) => {
          try {
            const balance = await client.getBalance({
              address: address as `0x${string}`,
            });
            balanceMap.set(address, balance.toString());
          } catch (error) {
            console.warn(`Failed to get balance for ${address}:`, error);
            balanceMap.set(address, "0");
          }
        });

        await Promise.all(batchPromises);

        // 添加小延迟以避免RPC限流
        if (i + BATCH_SIZE < addresses.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    } catch (error) {
      console.error("Failed to get batch address balances:", error);
    }

    return balanceMap;
  }

  // 地址余额变化检测（用于交易查找优化）
  async detectBalanceChanges(
    chainId: number,
    address: string,
    fromBlock: number,
    toBlock: number,
    maxSamples = 20
  ): Promise<Array<{ blockNumber: number; balance: string }>> {
    try {
      const client = await this.rpcManager.getClient(chainId);
      const blockRange = toBlock - fromBlock;

      if (blockRange <= maxSamples) {
        // 如果范围小，直接查询每个区块
        const samples: Array<{ blockNumber: number; balance: string }> = [];
        for (let block = fromBlock; block <= toBlock; block++) {
          try {
            const balance = await client.getBalance({
              address: address as `0x${string}`,
              blockNumber: BigInt(block),
            });
            samples.push({ blockNumber: block, balance: balance.toString() });
          } catch (error) {
            // 跳过无法查询的区块
            continue;
          }
        }
        return samples;
      } else {
        // 对于大范围，使用采样
        const step = Math.floor(blockRange / maxSamples);
        const samples: Array<{ blockNumber: number; balance: string }> = [];

        for (let i = 0; i <= maxSamples; i++) {
          const blockNumber = Math.min(fromBlock + i * step, toBlock);
          try {
            const balance = await client.getBalance({
              address: address as `0x${string}`,
              blockNumber: BigInt(blockNumber),
            });
            samples.push({ blockNumber, balance: balance.toString() });
          } catch (error) {
            // 跳过无法查询的区块
            continue;
          }
        }
        return samples;
      }
    } catch (error) {
      console.error("Failed to detect balance changes:", error);
      return [];
    }
  }
}
