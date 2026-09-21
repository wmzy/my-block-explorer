// Contract directory service: the backend's cached contract_sources rows
// (populated when a contract page is opened or force-refreshed). This is
// persistent backend data, so it flows through @/util/http on the query
// layer — NOT the browser RPC path (the data-separation rule).
import { api, get, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// Page size the directory view requests; the backend caps limits at 100.
export const CONTRACT_DIRECTORY_PAGE_SIZE = 50;

export type CachedContractSummary = {
  chainId: number;
  address: string;
  name: string | null;
  isVerified: boolean;
  verificationSource: string | null;
  /** ISO timestamp of the last cache write; null when the row has none. */
  updatedAt: string | null;
};

// Hit shape carried by the global search's additive free-text
// localContracts field (same matching rule as the directory endpoint).
export type LocalContractHit = {
  chainId: number;
  address: string;
  name: string | null;
  isVerified: boolean;
};

export type ContractDirectoryPage = {
  chainId: number;
  chainName: string;
  contracts: CachedContractSummary[];
  /** Rows in the whole filtered set (page-independent). */
  total: number;
  /**
   * Echo of the applied filter / offset. The query layer's result store
   * keeps the previous args' settle across a switch, so the view refuses
   * any payload whose echo does not match the args it rendered with
   * (gasHistory chainId-guard pattern, extended to q/offset).
   */
  q: string | null;
  offset: number;
};

// Flat positional args (chainId, q, offset, signal): the query layer
// spreads the hook's args tuple onto the queryFn, so an options-object
// parameter would silently shift (offset landing in the signal slot).
export function fetchContractDirectory(
  chainId: number,
  q?: string,
  offset?: number,
  signal?: AbortSignal,
): Promise<ContractDirectoryPage | undefined> {
  // Unsupported-chain guard (same convention as fetchChainSearch): a
  // non-positive chain id resolves to undefined without a request.
  if (!(chainId > 0)) return Promise.resolve(undefined);
  // An all-whitespace query is no query at all: drop it so the request and
  // the response echo stay param-less (settle-guard parity with the view).
  const trimmed = q?.trim();
  const needle = trimmed === '' ? undefined : trimmed;
  return get<ContractDirectoryPage>(
    `/api/chains/${chainId}/contracts`,
    { q: needle, offset, limit: CONTRACT_DIRECTORY_PAGE_SIZE },
    withSignal(api, signal),
  );
}

export const contractDirectoryCache = createQueryCache<
  ContractDirectoryPage | undefined,
  [number, string, number]
>('contract-directory');

const useContractDirectoryQuery = createQueryHook({
  queryFn: bindQueryFn(fetchContractDirectory, contractDirectoryCache),
});

/**
 * One directory page for a chain: `q` is the server-side filter (name
 * substring or address prefix, trimmed; '' means unfiltered) and `offset`
 * is the page offset. Feed the values straight from the URL (?q=/?offset=)
 * so deep links and back/forward hit the cache keys the view created.
 */
export function useContractDirectory(
  chainId: number,
  q: string | undefined,
  offset: number,
) {
  return useContractDirectoryQuery([chainId, q ?? '', offset]);
}
