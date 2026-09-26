// Addresses service: info and paginated transactions.
import type { Transaction } from '@/types/index';

import { api, get, longRunningApi, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// Honesty fields come from the heuristic-history backend when it ran.
// Contract: `total` counts DISCOVERED (deduped) transactions — never the
// RPC nonce. coverage 'complete' is the only trusted-empty signal;
// 'partial' + reason 'no-outgoing-transactions' means nonce=0 (incoming
// activity is undetectable without a full indexer); 'partial'/'none'
// carry reason/searchWindowBlocks. searchWindowBlocks echoes the
// effective searched window; `window` echoes the requested ?window=
// widening when one was sent. Absent on legacy cached payloads.
export type AddressTransactionPage = {
  transactions: Transaction[];
  /** Discovered (deduped) transaction count — never the nonce. */
  total: number;
  method?: string;
  coverage?: 'complete' | 'partial' | 'none';
  reason?:
    | 'no-transactions'
    | 'no-outgoing-transactions'
    | 'zero-balance'
    | 'search-failed';
  searchWindowBlocks?: number;
  window?: number;
  /**
   * Echo of the server-side narrowing filters this response applied,
   * exactly as received — present ONLY when at least one filter param
   * was sent. `total` (and the served page) already describe the
   * FILTERED view of the same cached discovered set: filters narrow,
   * they never widen coverage or trigger a new scan.
   */
  filtersApplied?: {
    fromAddress?: string;
    toAddress?: string;
    minValue?: string;
    maxValue?: string;
    method?: string;
  };
  /**
   * Deep-scan job state when one exists for this address (absent on
   * legacy payloads — the backend drops the key when no job row exists).
   * Shape: the /scan job DTO; parsed defensively by the Deep Scan panel
   * (scanJobFromTxPayload in services/addressScan.ts), so this typed
   * surface is documentation + direct consumers, not a hard dependency.
   */
  deepScan?: {
    status: 'pending' | 'running' | 'paused' | 'error' | 'complete';
    fromBlock: number;
    toBlock: number;
    cursorBlock: number;
    blocksWalked: number;
    blocksTotal: number;
    txsFound: number;
    errorMessage: string | null;
    coverage: 'complete' | null;
    updatedAt: string;
  };
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

// Server-side narrowing filters forwarded as query params. String-typed
// twin of the backend's AddressTxFilters: wei amounts stay exact decimal
// strings (BigInt-exact on the server, never Number); `method` is a
// 0x-prefixed 4-byte selector compared lowercase-exact server-side. The
// backend applies them over the SAME cached discovered set for the
// window — no new scan.
export type AddressTxFilters = {
  fromAddress?: string;
  toAddress?: string;
  minValue?: string;
  maxValue?: string;
  method?: string;
};

export function fetchAddressTransactions(
  chainId: number,
  address: string,
  limit: number,
  offset: number,
  searchWindow?: number,
  filters?: AddressTxFilters,
  signal?: AbortSignal,
): Promise<AddressTransactionPage | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  // Backend route paginates by `page` (derives offset itself) and ignores
  // an `offset` query param — translate or every page returns page 1.
  // `window` widens the heuristic binary-search range (blocks, clamped
  // server-side); omitted → backend default window. Filter entries with
  // undefined values are dropped by `get`, so absent filters stay out of
  // the URL and the request is byte-identical to the pre-filter call.
  // This endpoint is deliberately long-running (the server scans balance
  // changes under its own 30s budget — the view shows a scanning banner);
  // the default 10s per-attempt timeout would abort healthy scans.
  return get<AddressTransactionPage>(
    `/api/chains/${chainId}/addresses/${address}/transactions`,
    {
      limit,
      page: Math.floor(offset / limit) + 1,
      window: searchWindow,
      ...(filters ?? {}),
    },
    withSignal(longRunningApi, signal),
  );
}

export const addressInfoCache = createQueryCache<AddressInfoResponse | undefined, [
  number,
  string,
]>('addresses-info');

// The window AND the filters ride in the cache key: a widened ?window=
// or a different active filter must resolve to a fresh entry, never a
// stale narrow/unfiltered cached result. The filters element is optional
// so existing 5-arg callers (BalanceHistory's own fetch is separate)
// keep compiling unchanged; a missing element hashes like undefined.
export const addressTransactionsCache = createQueryCache<
  AddressTransactionPage | undefined,
  [number, string, number, number, number | undefined, AddressTxFilters?]
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

// Old positional call signatures kept; the scenario hooks take args tuples.
export function useAddressTransactions(
  chainId: number,
  address: string,
  limit: number,
  offset: number,
  searchWindow?: number,
  filters?: AddressTxFilters,
) {
  return useAddressTransactionsQuery([
    chainId,
    address,
    limit,
    offset,
    searchWindow,
    filters,
  ]);
}
