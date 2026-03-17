import { db, indexedAddresses } from "../database/init";
import { eq, and } from "drizzle-orm";
import { rpcManager } from "./RpcManager";
import { contractSourceService } from "./ContractSourceService";
import type { Address } from "viem";

/**
 * 持久化地址数据类型（永不改变或很少改变的数据）
 */
export type PersistentAddressData = {
  isContract: boolean;
  contractCreationTx?: string;
  contractCreationBlock?: number;
  contractCreator?: string;
  contractName?: string;
  verificationStatus?: "verified" | "unverified" | "partial";
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

type AddressServiceDeps = {
  db: typeof import("../database/init").db;
  indexedAddresses: typeof import("../database/init").indexedAddresses;
  rpcManager: typeof import("./RpcManager").rpcManager;
  contractSourceService: typeof import("./ContractSourceService").contractSourceService;
};

const createAddressService = (deps: AddressServiceDeps) => {
  const { db, indexedAddresses, rpcManager, contractSourceService } = deps;

  const getPersistentDataFromDB = async (
    chainId: number,
    address: Address
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
  };

  const savePersistentDataToDB = async (
    chainId: number,
    address: Address,
    persistentData: PersistentAddressData
  ): Promise<void> => {
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
  };

  const service = {
    getPersistentAddressData: async (
      chainId: number,
      address: Address
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
            `Failed to determine contract status for ${address}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        const isContract = Boolean(code && code !== "0x" && code.length > 2);
        console.log(
          `🔍 Contract code check for ${address}: ${isContract ? "CONTRACT" : "EOA"} (code length: ${code?.length || 0})`
        );

        let persistentData: PersistentAddressData = { isContract };

        if (isContract) {
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
      offset = 0
    ): Promise<{ transactions: any[]; total: number; method: string }> => {
      try {
        const client = await rpcManager.getClient(chainId);
        const txCount = await client.getTransactionCount({ address });

        return {
          transactions: [],
          total: Number(txCount),
          method: "rpc",
        };
      } catch (error) {
        console.warn(`Failed to get address transactions for ${address}:`, error);
        return {
          transactions: [],
          total: 0,
          method: "fallback",
        };
      }
    },

    getAddressInfo: async (
      chainId: number,
      address: Address
    ): Promise<AddressInfo> => {
      const persistentData = await service.getPersistentAddressData(
        chainId,
        address
      );

      return {
        chainId,
        address,
        balance: "0",
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
