import { db, indexedAddresses } from "../database/init";
import { eq, and } from "drizzle-orm";
import { rpcManager } from "./RpcManager";
import { contractSourceService } from "./ContractSourceService";
import type { Address } from "viem";

/**
 * 持久化地址数据类型（永不改变或很少改变的数据）
 */
export type PersistentAddressData = {
  // 合约基本信息（永不改变）
  isContract: boolean;
  contractCreationTx?: string;
  contractCreationBlock?: number;
  contractCreator?: string;

  // 合约验证信息（很少改变，值得缓存）
  contractName?: string;
  verificationStatus?: "verified" | "unverified" | "partial";
  sourceCodeAvailable?: boolean;
  compilerVersion?: string;

  // 代理合约信息（永不改变）
  isProxy?: boolean;
  proxyType?: string;
  implementationAddress?: string;

  // 首次发现信息
  firstSeenBlock?: number;
  firstSeenTimestamp?: Date;
};

/**
 * 地址服务
 * 专注于持久化数据的管理，实时数据由前端直接获取
 */
export class AddressService {
  // 获取持久化地址数据（数据库缓存）
  async getPersistentAddressData(
    chainId: number,
    address: Address
  ): Promise<PersistentAddressData> {
    try {
      // 1. 先从数据库查找缓存的持久化数据
      const cached = await this.getPersistentDataFromDB(chainId, address);
      if (cached) {
        console.log(`📋 Using cached persistent data for ${address}`);
        return cached;
      }

      console.log(`🔍 Fetching persistent data for ${address}`);

      const client = await rpcManager.getClient(chainId);

      // 检查是否为合约
      let code: string;
      try {
        code = await client.getCode({ address });
      } catch (error) {
        console.warn(`Failed to get contract code for ${address}:`, error);
        // RPC调用失败，但不应该假设是EOA，应该重试或抛出错误
        throw new Error(
          `Failed to determine contract status for ${address}: ${error.message}`
        );
      }
      const isContract = Boolean(code && code !== "0x" && code.length > 2);
      console.log(
        `🔍 Contract code check for ${address}: ${isContract ? "CONTRACT" : "EOA"} (code length: ${code?.length || 0})`
      );

      let persistentData: PersistentAddressData = { isContract };

      if (isContract) {
        // 获取合约创建信息（一次性，永不改变）
        try {
          const creationInfo =
            await contractSourceService.getContractCreationInfo(
              chainId,
              address
            );
          if (creationInfo) {
            persistentData.contractCreationTx = creationInfo.txHash;
            persistentData.contractCreationBlock = creationInfo.blockNumber;
            persistentData.contractCreator = creationInfo.creator;
          }
        } catch (error) {
          console.warn(
            `Failed to get contract creation info for ${address}:`,
            error
          );
        }

        // 获取合约验证信息（很少改变，值得缓存）
        try {
          const sourceInfo = await contractSourceService.getContractSource(
            chainId,
            address
          );
          if (sourceInfo) {
            persistentData.contractName = sourceInfo.name;
            persistentData.verificationStatus = sourceInfo.verificationStatus;
            persistentData.sourceCodeAvailable =
              sourceInfo.sourceCode.length > 0;
            persistentData.compilerVersion = sourceInfo.compilerVersion;
            persistentData.isProxy = sourceInfo.isProxy;
            persistentData.proxyType = sourceInfo.proxyType;
            persistentData.implementationAddress =
              sourceInfo.implementationAddress;
          }
        } catch (error) {
          console.warn(`Failed to get contract source for ${address}:`, error);
        }
      }

      // 记录首次发现信息
      persistentData.firstSeenTimestamp = new Date();

      // 保存到数据库
      await this.savePersistentDataToDB(chainId, address, persistentData);
      console.log(`✅ Cached persistent data to DB for ${address}`);

      return persistentData;
    } catch (error) {
      console.error(`Failed to get persistent data for ${address}:`, error);
      throw error;
    }
  }

  // 从数据库获取持久化数据
  private async getPersistentDataFromDB(
    chainId: number,
    address: Address
  ): Promise<PersistentAddressData | null> {
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
            eq(indexedAddresses.address, address)
          )
        )
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      const isContract = row.type === "contract";

      let persistentData: PersistentAddressData = {
        isContract,
        firstSeenBlock: row.firstSeen || undefined,
        firstSeenTimestamp: row.indexedAt || undefined,
      };

      // 如果是合约，尝试获取合约信息
      if (isContract) {
        try {
          const sourceInfo = await contractSourceService.getContractSource(
            chainId,
            address
          );
          if (sourceInfo) {
            persistentData.contractName = sourceInfo.name;
            persistentData.verificationStatus = sourceInfo.verificationStatus;
            persistentData.sourceCodeAvailable =
              sourceInfo.sourceCode.length > 0;
            persistentData.compilerVersion = sourceInfo.compilerVersion;
            persistentData.isProxy = sourceInfo.isProxy;
            persistentData.proxyType = sourceInfo.proxyType;
            persistentData.implementationAddress =
              sourceInfo.implementationAddress;
          }
        } catch (error) {
          // 忽略错误，返回基本信息
          console.warn(
            `Failed to get contract source from cache for ${address}:`,
            error
          );
        }
      }

      return persistentData;
    } catch (error) {
      console.warn(`Failed to get persistent data from DB:`, error);
      return null;
    }
  }

  // 保存持久化数据到数据库
  private async savePersistentDataToDB(
    chainId: number,
    address: Address,
    persistentData: PersistentAddressData
  ): Promise<void> {
    try {
      await db
        .insert(indexedAddresses)
        .values({
          chainId,
          address,
          type: persistentData.isContract ? "contract" : "EOA",
          firstSeen: persistentData.firstSeenBlock || null,
          indexedAt: persistentData.firstSeenTimestamp || new Date(),
        })
        .onConflictDoUpdate({
          target: [indexedAddresses.chainId, indexedAddresses.address],
          set: {
            type: persistentData.isContract ? "contract" : "EOA",
            firstSeen: persistentData.firstSeenBlock || null,
            indexedAt: persistentData.firstSeenTimestamp || new Date(),
          },
        });
    } catch (error) {
      console.warn("Failed to save persistent data to DB:", error);
    }
  }

  // 兼容性方法 - 获取完整地址信息（保持向后兼容）
  async getAddressInfo(chainId: number, address: Address) {
    const persistentData = await this.getPersistentAddressData(
      chainId,
      address
    );

    // 注意：余额和交易数量应该由前端直接获取
    return {
      chainId,
      address,
      balance: "0", // 前端应该直接调用 RPC 获取
      transactionCount: 0, // 前端应该直接调用 RPC 获取
      ...persistentData,
      lastQueried: new Date(),
    };
  }
}

// 导出全局实例
export const addressService = new AddressService();
