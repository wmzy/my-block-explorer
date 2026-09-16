// Address realtime service: the direct-RPC (viem) channel of the data
// separation architecture — live balance/nonce/block reads and raw contract
// code. The indexer-backed persistent channel lives in addresses.ts; this
// module wraps src/utils/realTimeData.ts on the query layer
// (createQueryCache + bindQueryFn + createQueryHook), so args-keyed caches
// give the old useAddressData hook's race-safety for free: a param change
// is a new cache key, and a late resolve for the old key cannot overwrite
// the newer entry. The hand-rolled cancellation/reset logic of the old
// hook is gone with it.
import { getContractCode, getRealTimeAddressData } from '@/utils/realTimeData';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

import { IMMUTABLE_CACHE_TIME } from './contracts';

export type RealTimeAddressData = {
  balance: string;
  balanceWei: string;
  transactionCount: number;
  latestBlock: number;
};

// viem's getCode resolves the deployed bytecode hex ('0x' for EOAs) or
// undefined for an account without code.
export type ContractCode = Awaited<ReturnType<typeof getContractCode>>;

// Gated fetches: invalid args resolve undefined without touching the RPC —
// the same disabled shape the other services use for gated keys.
export function fetchRealTimeAddressData(
  chainId: number,
  address: string,
): Promise<RealTimeAddressData | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return getRealTimeAddressData(chainId, address);
}

export function fetchContractCode(
  chainId: number,
  address: string,
): Promise<ContractCode | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return getContractCode(chainId, address);
}

// Live values change every block → default cache (5min) + default 2s
// staleTime. Contract code for a given address is immutable once deployed
// → 24h cache like the contracts.ts immutable endpoints.
export const realTimeAddressCache = createQueryCache<
  RealTimeAddressData | undefined,
  [number, string]
>('address-realtime');

export const contractCodeCache = createQueryCache<ContractCode | undefined, [
  number,
  string,
]>('address-contract-code', IMMUTABLE_CACHE_TIME);

const queryRealTimeAddressData = bindQueryFn(
  fetchRealTimeAddressData,
  realTimeAddressCache,
);
const queryContractCode = bindQueryFn(fetchContractCode, contractCodeCache);

const useRealTimeAddressDataQuery = createQueryHook({
  queryFn: queryRealTimeAddressData,
});
const useContractCodeQuery = createQueryHook({ queryFn: queryContractCode });

// Old positional call signatures kept; the scenario hooks take args tuples.
export function useRealTimeAddressData(chainId: number, address: string) {
  return useRealTimeAddressDataQuery([chainId, address]);
}

export function useContractCode(chainId: number, address: string) {
  return useContractCodeQuery([chainId, address]);
}
