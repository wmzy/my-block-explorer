import { useState, useEffect } from 'react';
import { getRealTimeAddressData, getContractCode } from '@/utils/realTimeData';

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
    null,
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

    let cancelled = false;

    setPersistent(null);
    setRealTime(null);
    setLoading({ persistent: true, realTime: true });
    setError({ persistent: null, realTime: null });

    fetchPersistentData(chainId, address)
      .then((data) => {
        if (!cancelled) setPersistent(data);
      })
      .catch(async (err) => {
        if (cancelled) return;
        try {
          const code = await getContractCode(chainId, address);
          const isContract = Boolean(code && code !== '0x' && code.length > 2);
          if (!cancelled) setPersistent({ isContract });
        }
        catch {
          if (!cancelled)
            setError(prev => ({
              ...prev,
              persistent: err?.message || 'Failed to fetch persistent data',
            }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(prev => ({ ...prev, persistent: false }));
      });

    fetchRealTimeData(chainId, address)
      .then((data) => {
        if (!cancelled) setRealTime(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(prev => ({
            ...prev,
            realTime: err?.message || 'Failed to fetch real-time data',
          }));
      })
      .finally(() => {
        if (!cancelled) setLoading(prev => ({ ...prev, realTime: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [chainId, address]);

  return {
    persistent,
    realTime,
    loading,
    error,
  };
}

const PERSISTENT_TIMEOUT_MS = 15_000;

async function fetchPersistentData(
  chainId: number,
  address: string,
): Promise<PersistentAddressData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PERSISTENT_TIMEOUT_MS);

  try {
    const response = await fetch(
      `/api/chains/${chainId}/addresses/${address}/persistent`,
      { signal: controller.signal },
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
  catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  }
  finally {
    clearTimeout(timer);
  }
}

/**
 * 直接从RPC获取实时地址数据
 */
async function fetchRealTimeData(
  chainId: number,
  address: string,
): Promise<RealTimeAddressData> {
  try {
    return await getRealTimeAddressData(chainId, address);
  }
  catch (error) {
    console.error('Failed to fetch real-time data:', error);
    throw error;
  }
}
