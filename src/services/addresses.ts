// Addresses service: info and paginated transactions.
import type { AddressInfo, Transaction } from '@/types/index';

import { api, get, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

export type AddressTransactionPage = { transactions: Transaction[]; total: number };

export function fetchAddressInfo(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<AddressInfo | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return get<AddressInfo>(
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

export const addressInfoCache = createQueryCache<AddressInfo | undefined, [
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
