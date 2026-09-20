import { createLogger } from '../server/logger';
import { blockService, type Block } from './BlockService';

const logger = createLogger('search-service');
import { transactionService, type Transaction } from './TransactionService';
import { addressService, type AddressInfo } from './AddressService';
// Single source of truth for search-input detection, shared with the frontend.
// Relative import: this module is bundled into the Hono API graph, which the
// Vite config also bundles (honoApiPlugin dynamic import); that esbuild pass
// does not resolve the '@/' alias, so runtime value imports must stay relative.
import { detectSearchType, sanitizeInput } from '../utils/validation';

/**
 * Search result type
 */
export type SearchResultType = 'block' | 'transaction' | 'address' | 'ens' | 'unknown';

export type SearchResult = {
  type: SearchResultType;
  query: string;
  chainId: number;
  found: boolean;
  data?: Block | Transaction | AddressInfo;
  suggestions?: string[];
  /**
   * Chain the actionable suggestion lines above were actually resolved on.
   * Every suggestion in one result comes from the same search call, so one
   * field names the chain for the whole list — clients link the lines to
   * this chain instead of guessing one. Absent for chain-less suggestion
   * sets (e.g. the static ENS note), which must never be linked anywhere.
   */
  suggestionsChainId?: number;
  error?: string;
  /**
   * True when the result is not-found AND at least one sub-lookup errored
   * (RPC/upstream). Clients must not present this as a definitive
   * "no results" answer.
   */
  degraded?: boolean;
  /** Machine-readable causes behind `degraded`, e.g. 'block-lookup-failed'. */
  degradedReasons?: string[];
  /** Human-readable note (e.g. ENS names resolve client-side). */
  message?: string;
};

type SearchServiceDeps = {
  blockService: typeof import('./BlockService').blockService;
  transactionService: typeof import('./TransactionService').transactionService;
  addressService: typeof import('./AddressService').addressService;
};

const createSearchService = (deps: SearchServiceDeps) => {
  const { blockService, transactionService, addressService } = deps;

  const getBlockSuggestions = async (chainId: number): Promise<string[]> => {
    try {
      const latestBlock = await blockService.getLatestBlock(chainId);
      const suggestions = ['Enter a valid block number or block hash'];

      if (latestBlock) {
        suggestions.push(`Latest block number: ${latestBlock.number.toString()}`);
        suggestions.push(`Latest block hash: ${latestBlock.hash}`);
      }

      return suggestions;
    }
    catch {
      return ['Enter a valid block number or block hash'];
    }
  };

  const getTransactionSuggestions = async (chainId: number): Promise<string[]> => {
    try {
      const { transactions: recentTxs } = await transactionService.getLatestTransactions(chainId, 3);
      const suggestions = ['Enter a valid transaction hash (0x-prefixed, 64 hex chars)'];

      if (recentTxs.length > 0) {
        suggestions.push('Recent transactions:');
        recentTxs.forEach((tx) => {
          suggestions.push(`${tx.hash}`);
        });
      }

      return suggestions;
    }
    catch {
      return ['Enter a valid transaction hash (0x-prefixed, 64 hex chars)'];
    }
  };

  const searchBlock = async (chainId: number, query: string): Promise<SearchResult> => {
    try {
      let block: Block | null = null;

      if (/^\d+$/.test(query)) {
        const blockNumber = BigInt(query);
        block = await blockService.getBlockByNumber(chainId, blockNumber);
      }
      else if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
        block = await blockService.getBlockByHash(chainId, query);
      }

      if (block) {
        return {
          type: 'block',
          query,
          chainId,
          found: true,
          data: block,
        };
      }

      return {
        type: 'block',
        query,
        chainId,
        found: false,
        suggestions: await getBlockSuggestions(chainId),
        suggestionsChainId: chainId,
      };
    }
    catch (error) {
      return {
        type: 'block',
        query,
        chainId,
        found: false,
        error: error instanceof Error ? error.message : 'Block search failed',
        degraded: true,
        degradedReasons: ['block-lookup-failed'],
      };
    }
  };

  const searchTransaction = async (chainId: number, query: string): Promise<SearchResult> => {
    try {
      const transaction = await transactionService.getTransactionByHash(chainId, query);

      if (transaction) {
        return {
          type: 'transaction',
          query,
          chainId,
          found: true,
          data: transaction,
        };
      }

      if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
        const block = await blockService.getBlockByHash(chainId, query);
        if (block) {
          return {
            type: 'block',
            query,
            chainId,
            found: true,
            data: block,
          };
        }
      }

      return {
        type: 'transaction',
        query,
        chainId,
        found: false,
        suggestions: await getTransactionSuggestions(chainId),
        suggestionsChainId: chainId,
      };
    }
    catch (error) {
      return {
        type: 'transaction',
        query,
        chainId,
        found: false,
        error: error instanceof Error ? error.message : 'Transaction search failed',
        degraded: true,
        degradedReasons: ['transaction-lookup-failed'],
      };
    }
  };

  const searchAddress = async (chainId: number, query: string): Promise<SearchResult> => {
    try {
      const address = query;

      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return {
          type: 'address',
          query,
          chainId,
          found: false,
          error: 'Invalid address format',
        };
      }

      const addressInfo = await addressService.getAddressInfo(chainId, address as `0x${string}`);

      return {
        type: 'address',
        query,
        chainId,
        found: true,
        data: addressInfo,
      };
    }
    catch (error) {
      return {
        type: 'address',
        query,
        chainId,
        found: false,
        error: error instanceof Error ? error.message : 'Address search failed',
        degraded: true,
        degradedReasons: ['address-lookup-failed'],
      };
    }
  };

  const searchAll = async (chainId: number, query: string): Promise<SearchResult> => {
    const searches = [
      searchBlock(chainId, query),
      searchTransaction(chainId, query),
      searchAddress(chainId, query),
    ];

    const results = await Promise.allSettled(searches);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.found) {
        return result.value;
      }
    }

    // A not-found aggregate is only definitive when every sub-lookup
    // actually answered. Sub-searches never reject (they catch internally
    // and flag `degraded`), but a defensive reason is kept for unexpected
    // rejections so an upstream outage never renders as "no results".
    const degradedReasons = new Set<string>();
    const SUB_SEARCH_REASONS = [
      'block-lookup-failed',
      'transaction-lookup-failed',
      'address-lookup-failed',
    ] as const;
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        degradedReasons.add(SUB_SEARCH_REASONS[index] ?? 'search-failed');
        return;
      }
      for (const reason of result.value.degradedReasons ?? []) {
        degradedReasons.add(reason);
      }
    });

    // Free-text queries land here. Collect the actionable suggestions the
    // sub-searches already produced (latest block number/hash, recent tx
    // hashes) ahead of the generic format help, so clients can link them
    // to the searched chain's pages. Per-type 'Enter a valid ...' hints are
    // skipped: the summary below covers them.
    const suggestions: string[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      if (result.status !== 'fulfilled' || result.value.found) continue;
      for (const suggestion of result.value.suggestions ?? []) {
        if (suggestion.startsWith('Enter a valid') || seen.has(suggestion)) continue;
        seen.add(suggestion);
        suggestions.push(suggestion);
      }
    }
    suggestions.push(
      'Enter a valid block number, transaction hash, or address',
      'Block number: plain digits (e.g. 18000000)',
      'Transaction hash: 0x-prefixed 64-character hex string',
      'Address: 0x-prefixed 40-character hex string',
      'Block hash: 0x-prefixed 64-character hex string',
    );

    return {
      type: 'unknown',
      query,
      chainId,
      found: false,
      suggestions,
      suggestionsChainId: chainId,
      ...(degradedReasons.size > 0
        ? { degraded: true, degradedReasons: [...degradedReasons] }
        : {}),
    };
  };

  return {
    search: async (chainId: number, query: string): Promise<SearchResult> => {
      const trimmedQuery = query.trim();

      if (!trimmedQuery) {
        return {
          type: 'unknown',
          query,
          chainId,
          found: false,
          error: 'Empty search query',
        };
      }

      try {
        // Same normalization + detection as the frontend: the shared helpers
        // in utils/validation are the single source of truth.
        const sanitizedQuery = sanitizeInput(trimmedQuery);
        const searchType = detectSearchType(sanitizedQuery);

        switch (searchType) {
          case 'block':
            return await searchBlock(chainId, sanitizedQuery);
          case 'hash':
            return await searchTransaction(chainId, sanitizedQuery);
          case 'address':
            return await searchAddress(chainId, sanitizedQuery);
          case 'ens':
            // ENS names resolve against a mainnet RPC in the browser; the
            // server has no chain-specific knowledge to add and must not
            // burn upstream calls (or 400) on them.
            return {
              type: 'ens',
              query: sanitizedQuery,
              chainId,
              found: false,
              suggestions: [
                'ENS names are resolved in the browser',
                'Try searching an address, transaction hash, or block number',
              ],
              message: 'ENS names are resolved in the browser',
            };
          default:
            return await searchAll(chainId, sanitizedQuery);
        }
      }
      catch (error) {
        logger.error({ err: error, query: trimmedQuery }, 'Search failed');
        return {
          type: 'unknown',
          query: trimmedQuery,
          chainId,
          found: false,
          error: error instanceof Error ? error.message : 'Search failed',
          degraded: true,
          degradedReasons: ['search-failed'],
        };
      }
    },
  };
};

export type SearchService = ReturnType<typeof createSearchService>;
export { createSearchService };

export const searchService = createSearchService({
  blockService,
  transactionService,
  addressService,
});
