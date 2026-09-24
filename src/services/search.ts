// Search service: global and per-chain search. The Search view drives these
// imperatively (submit → await → navigate), so no scenario hooks are needed
// here; the empty-query/invalid-chain guard lives in the fetch itself.
import { api, get, withSignal } from '@/util/http';

// Chain entry returned by the global endpoint when a query is ambiguous
// (transaction/block hash or block number) and a specific chain must be
// chosen before it can be resolved. The list is scoped (see `scope` on
// SearchResult); symbol is the chain's native currency for filtering.
export type SupportedChainRef = { chainId: number; name: string; symbol: string };

// Shape shared by both endpoints (/api/search and /api/chains/:id/search).
// `data` stays loose here: the concrete payload (Block/Transaction/
// AddressInfo) is discriminated by `type` and narrowed by consumers.
export type SearchResult = {
  found: boolean;
  type: string;
  query?: string;
  chainId?: number;
  /** Chain the global endpoint actually searched (echoed for clients). */
  searchedChainId?: number;
  needsChain?: boolean;
  /**
   * Curation scope of the needsChain chain list ('popular' = the curated
   * popular set; anything else is the full supported universe).
   */
  scope?: string;
  supportedChains?: SupportedChainRef[];
  suggestions?: string[];
  /**
   * Chain the backend actually resolved the actionable suggestion lines
   * on (echoed by both search endpoints). Preferred over any client-side
   * chain context when linking suggestion lines; null/absent means the
   * suggestions carry no chain data to link anywhere.
   */
  suggestionsChainId?: number | null;
  error?: string | null;
  /**
   * True when not-found AND a data source errored — not a definitive
   * "no results" answer; offer retry instead.
   */
  degraded?: boolean | null;
  degradedReasons?: string[] | null;
  /**
   * Local cached-contract name hits (free-text queries only): contracts
   * whose cached source name matches, from this explorer's DuckDB cache.
   * Absent when the cache read failed or the query wasn't free text;
   * empty array = successful read with zero matches.
   */
  localContracts?: Array<{
    chainId: number;
    address: string;
    name: string | null;
    isVerified: boolean;
  }>;
  /**
   * Curated token/label hits (free-text queries only): known-token symbol
   * matches from the curated per-chain list plus this explorer's address
   * labels (user + builtin), deduped by address (the label wins). NOT a
   * token index — curated sources only, and the section copy says so.
   * Absent when the label read failed or the query wasn't free text;
   * empty array = successful read with zero matches.
   */
  tokenHits?: Array<{
    chainId: number;
    address: string;
    matchText: string;
    source: 'known-token' | 'label';
  }>;
  /** Human-readable note (e.g. ENS names resolve client-side). */
  message?: string | null;
  data?: unknown;
};

export function fetchSearch(
  query: string,
  chainId?: number,
  signal?: AbortSignal,
): Promise<SearchResult | undefined> {
  if (query.length === 0) return Promise.resolve(undefined);
  return get<SearchResult>(
    '/api/search',
    { q: query, chainId },
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
