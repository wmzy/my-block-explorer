import { useState, useEffect, useCallback } from 'react';
import type { StorageLayout } from '@/types/storage';

type Hex = `0x${string}`;

type UseStorageLayoutResult = {
  layout: StorageLayout | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

type UseStorageAtResult = {
  value: Hex | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

const FETCH_TIMEOUT_MS = 15_000;

export function useStorageLayout(
  chainId: number | undefined,
  address: string | undefined,
): UseStorageLayoutResult {
  const [layout, setLayout] = useState<StorageLayout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!chainId || !address) {
      setLayout(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    setLayout(null);
    setLoading(true);
    setError(null);

    fetchStorageLayout(chainId, address)
      .then(data => {
        if (!cancelled) setLayout(data);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to fetch storage layout');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chainId, address, refetchTrigger]);

  return { layout, loading, error, refetch };
}

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

async function fetchStorageLayout(chainId: number, address: string): Promise<StorageLayout> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/chains/${chainId}/contracts/${address}/storage-layout`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    if (!data.found || !data.layout) {
      throw new Error('Storage layout not found');
    }

    return data.layout;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStorageAt(chainId: number, address: string, slot: string): Promise<Hex> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/chains/${chainId}/contracts/${address}/storage/${slot}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return data.value as Hex;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
