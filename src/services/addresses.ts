// Addresses service: info and paginated transactions.
import type { Transaction } from '@/types/index';

import { api, get, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// Honesty fields come from the heuristic-history backend when it ran:
// coverage 'complete' is the only trusted-empty signal; 'partial'/'none'
// carry reason/searchWindowBlocks. Absent on legacy cached payloads.
export type AddressTransactionPage = {
  transactions: Transaction[];
  total: number;
  method?: string;
  coverage?: 'complete' | 'partial' | 'none';
  reason?: 'no-transactions' | 'zero-balance' | 'search-failed';
  searchWindowBlocks?: number;
};

// Response envelope of GET /api/chains/:chainId/addresses/:address. The
// `address` member carries only persistent/indexer fields: balance and
// transaction count are deliberately absent from this payload (the API
// used to hard-code '0'/0 here) — live values come from the realtime RPC
// channel in addressRealTime.ts. Date fields arrive JSON-serialized.
export type AddressInfoResponse = {
  chainId: number;
  chainName: string;
  timestamp: string;
  address: {
    address: string;
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
    firstSeenTimestamp?: string;
    lastQueried?: string;
  };
};

export function fetchAddressInfo(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<AddressInfoResponse | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return get<AddressInfoResponse>(
    `/api/chains/${chainId}/addresses/${address}`,
    undefined,
    withSignal(api, signal),
  );
}

export function fetchAddressTransactions(
  chainId: number,
  address: string,
  limit: number,
  offset: number,
  signal?: AbortSignal,
): Promise<AddressTransactionPage | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  // Backend route paginates by `page` (derives offset itself) and ignores
  // an `offset` query param — translate or every page returns page 1.
  return get<AddressTransactionPage>(
    `/api/chains/${chainId}/addresses/${address}/transactions`,
    { limit, page: Math.floor(offset / limit) + 1 },
    withSignal(api, signal),
  );
}

export const addressInfoCache = createQueryCache<AddressInfoResponse | undefined, [
  number,
  string,
]>('addresses-info');

export const addressTransactionsCache = createQueryCache<
  AddressTransactionPage | undefined,
  [number, string, number, number]
>('addresses-transactions');

const queryAddressInfo = bindQueryFn(fetchAddressInfo, addressInfoCache);
const queryAddressTransactions = bindQueryFn(
  fetchAddressTransactions,
  addressTransactionsCache,
);

const useAddressInfoQuery = createQueryHook({ queryFn: queryAddressInfo });
const useAddressTransactionsQuery = createQueryHook({
  queryFn: queryAddressTransactions,
});

// Old positional call signatures kept; the scenario hooks take args tuples.
export function useAddressInfo(chainId: number, address: string) {
  return useAddressInfoQuery([chainId, address]);
}

export function useAddressTransactions(
  chainId: number,
  address: string,
  limit: number,
  offset: number,
) {
  return useAddressTransactionsQuery([chainId, address, limit, offset]);
}
