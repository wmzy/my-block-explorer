import { useState, useEffect, useCallback } from 'react';
import { get } from '@/util/http';

type Hex = `0x${string}`;

type UseStorageAtResult = {
  value: Hex | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

// Live storage slot read for a contract address. Slot values track chain
// state (unlike the immutable storage layout served by services/contracts),
// so this stays a plain effect-based hook over the http helpers rather than
// a query cache. `chainId: undefined` parks the hook (components pass
// undefined while values are hidden).
export function useStorageAt(
  chainId: number | undefined,
  address: string | undefined,
  slot: string | undefined,
): UseStorageAtResult {
  const [value, setValue] = useState<Hex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!chainId || !address || !slot) {
      setValue(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    setValue(null);
    setLoading(true);
    setError(null);

    fetchStorageAt(chainId, address, slot)
      .then(data => {
        if (!cancelled) setValue(data);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to fetch storage slot');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chainId, address, slot, refetchTrigger]);

  return { value, loading, error, refetch };
}

async function fetchStorageAt(chainId: number, address: string, slot: string): Promise<Hex> {
  const data = await get<{ error?: string; value?: Hex }>(
    `/api/chains/${chainId}/contracts/${address}/storage/${slot}`,
  );

  if (data.error) {
    throw new Error(data.error);
  }

  return data.value as Hex;
}
