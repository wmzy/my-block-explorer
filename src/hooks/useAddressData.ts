import { useState, useEffect } from "react";
import { getRealTimeAddressData } from "@/utils/realTimeData";

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

export type RealTimeAddressData = {
  balance: string;
  balanceWei: string;
  transactionCount: number;
  latestBlock: number;
};

export type AddressData = {
  persistent: PersistentAddressData | null;
  realTime: RealTimeAddressData | null;
  loading: {
    persistent: boolean;
    realTime: boolean;
  };
  error: {
    persistent: string | null;
    realTime: string | null;
  };
};

/**
 * 使用新的数据分离架构获取地址信息
 * 持久化数据从后端数据库获取，实时数据直接从RPC获取
 */
export function useAddressData(chainId: number, address: string): AddressData {
  const [persistent, setPersistent] = useState<PersistentAddressData | null>(
    null
  );
  const [realTime, setRealTime] = useState<RealTimeAddressData | null>(null);
  const [loading, setLoading] = useState({
    persistent: true,
    realTime: true,
  });
  const [error, setError] = useState({
    persistent: null as string | null,
    realTime: null as string | null,
  });

  useEffect(() => {
    if (!chainId || !address) return;

    // 重置状态
    setPersistent(null);
    setRealTime(null);
    setLoading({ persistent: true, realTime: true });
    setError({ persistent: null, realTime: null });

    // 并行获取持久化数据和实时数据
    Promise.allSettled([
      fetchPersistentData(chainId, address),
      fetchRealTimeData(chainId, address),
    ]).then(([persistentResult, realTimeResult]) => {
      // 处理持久化数据结果
      if (persistentResult.status === "fulfilled") {
        setPersistent(persistentResult.value);
      } else {
        setError((prev) => ({
          ...prev,
          persistent:
            persistentResult.reason?.message ||
            "Failed to fetch persistent data",
        }));
      }
      setLoading((prev) => ({ ...prev, persistent: false }));

      // 处理实时数据结果
      if (realTimeResult.status === "fulfilled") {
        setRealTime(realTimeResult.value);
      } else {
        setError((prev) => ({
          ...prev,
          realTime:
            realTimeResult.reason?.message || "Failed to fetch real-time data",
        }));
      }
      setLoading((prev) => ({ ...prev, realTime: false }));
    });
  }, [chainId, address]);

  return {
    persistent,
    realTime,
    loading,
    error,
  };
}

/**
 * 从后端API获取持久化地址数据
 */
async function fetchPersistentData(
  chainId: number,
  address: string
): Promise<PersistentAddressData> {
  const response = await fetch(
    `/api/chains/${chainId}/addresses/${address}/persistent`
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

/**
 * 直接从RPC获取实时地址数据
 */
async function fetchRealTimeData(
  chainId: number,
  address: string
): Promise<RealTimeAddressData> {
  try {
    return await getRealTimeAddressData(chainId, address);
  } catch (error) {
    console.error("Failed to fetch real-time data:", error);
    throw error;
  }
}
