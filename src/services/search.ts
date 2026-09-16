// Search service: global and per-chain search. The Search view drives these
// imperatively (submit → await → navigate), so no scenario hooks are needed
// here; the empty-query/invalid-chain guard lives in the fetch itself.
import { api, get, withSignal } from '@/util/http';

export type SearchResponse = Record<string, unknown>;

export function fetchSearch(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResponse | undefined> {
  if (query.length === 0) return Promise.resolve(undefined);
  return get<SearchResponse>(
    '/api/search',
    { q: query },
    withSignal(api, signal),
  );
}

export function fetchChainSearch(
  chainId: number,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResponse | undefined> {
  if (!(chainId > 0) || query.length === 0) return Promise.resolve(undefined);
  return get<SearchResponse>(
    `/api/chains/${chainId}/search`,
    { q: query },
    withSignal(api, signal),
  );
}
