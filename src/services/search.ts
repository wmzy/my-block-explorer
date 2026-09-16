// Search service: global and per-chain search. The Search view drives these
// imperatively (submit → await → navigate), so no scenario hooks are needed
// here; the empty-query/invalid-chain guard lives in the fetch itself.
import { api, get, withSignal } from '@/util/http';

// Chain entry returned by the global endpoint when a query is ambiguous
// (transaction/block hash or block number) and a specific chain must be
// chosen before it can be resolved.
export type SupportedChainRef = { chainId: number; name: string };

// Shape shared by both endpoints (/api/search and /api/chains/:id/search).
// `data` stays loose here: the concrete payload (Block/Transaction/
// AddressInfo) is discriminated by `type` and narrowed by consumers.
export type SearchResult = {
  found: boolean;
  type: string;
  query?: string;
  chainId?: number;
  needsChain?: boolean;
  supportedChains?: SupportedChainRef[];
  suggestions?: string[];
  error?: string | null;
  data?: unknown;
};

export function fetchSearch(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult | undefined> {
  if (query.length === 0) return Promise.resolve(undefined);
  return get<SearchResult>(
    '/api/search',
    { q: query },
    withSignal(api, signal),
  );
}

export function fetchChainSearch(
  chainId: number,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult | undefined> {
  if (!(chainId > 0) || query.length === 0) return Promise.resolve(undefined);
  return get<SearchResult>(
    `/api/chains/${chainId}/search`,
    { q: query },
    withSignal(api, signal),
  );
}
