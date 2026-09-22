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
  // Freshness stamp (ms since epoch) of the successful RPC read that
  // produced this payload. Recorded only on the success path, so views can
  // render an honest "Updated <relative time>" and stay silent before the
  // first successful fetch. Cached entries keep the stamp of the fetch
  // that filled them — the moment the shown numbers were actually read.
  lastUpdatedAt: number;
};

// viem's getCode resolves the deployed bytecode hex or undefined — for an
// account WITHOUT code it folds the raw '0x' answer into undefined (see
// fetchContractCode, which restores '0x' so a successful no-code read
// stays distinguishable from "not read" at the consumers' boundary).
export type ContractCode = Awaited<ReturnType<typeof getContractCode>>;

// Gated fetches: invalid args resolve undefined without touching the RPC —
// the same disabled shape the other services use for gated keys.
export async function fetchRealTimeAddressData(
  chainId: number,
  address: string,
): Promise<RealTimeAddressData | undefined> {
  if (!(chainId > 0) || address.length === 0) return undefined;
  const data = await getRealTimeAddressData(chainId, address);
  // Success-only stamp: reached only after the RPC reads resolve, so a
  // failed or in-flight fetch never records an update time.
  return { ...data, lastUpdatedAt: Date.now() };
}

export async function fetchContractCode(
  chainId: number,
  address: string,
): Promise<ContractCode | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  const code = await getContractCode(chainId, address);
  // viem folds a successful no-code read ('0x') into undefined, which the
  // type classifier reads as "not read". Restoring '0x' keeps the two
  // states apart: undefined = not read (gated args / never settled), '0x'
  // = the RPC answered and the account carries no code. The distinction
  // is load-bearing offline — with the persistent channel errored, the
  // code read alone classifies the address, and an EOA must not fall back
  // to "Unknown" after a successful read (the documented offline residual).
  return code ?? '0x';
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
