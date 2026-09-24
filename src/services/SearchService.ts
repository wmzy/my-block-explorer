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
import { and, count, desc, eq, or, sql } from 'drizzle-orm';
// Same relative-import rule applies to the database module (see above).
import { db, contractSources, addressLabels } from '../database/init';
// Pure data + functions, no frontend-only imports: safe to bundle into the
// backend graph (and through the Vite config's alias-less esbuild pass,
// hence the relative path).
import { KNOWN_TOKENS, knownTokensForChain } from '../config/knownTokens';

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

// --- Local contract cache (the cached-source directory) ---
//
// The contract_sources table is this explorer's own cache, populated when
// a contract page is opened or force-refreshed. Two consumers share ONE
// matching rule through the helpers below, so the directory page and the
// global search can never disagree about what "matches":
//   - GET /api/chains/:chainId/contracts (the directory list)
//   - GET /api/search's additive localContracts field (free-text queries)
// They live in this module (not ContractSourceService) because that one is
// RPC/verification-oriented; this is a pure DuckDB read side, same family
// as the search lookups above.

// Directory page-size bounds, mirroring the transactions list conventions
// (routes/contracts.ts enforces them at the HTTP boundary).
export const CONTRACT_DIRECTORY_DEFAULT_LIMIT = 50;
export const CONTRACT_DIRECTORY_MAX_LIMIT = 100;
export const CONTRACT_DIRECTORY_MAX_OFFSET = 100_000;

// Free-text search surfaces at most this many local cache hits: the
// section is a shortcut into the directory, not the directory itself.
export const LOCAL_CONTRACT_SEARCH_LIMIT = 5;

export type CachedContractSummary = {
  chainId: number;
  address: string;
  name: string | null;
  isVerified: boolean;
  verificationSource: string | null;
  /** ISO timestamp of the last cache write; null when the row has none. */
  updatedAt: string | null;
};

export type LocalContractHit = {
  chainId: number;
  address: string;
  name: string | null;
  isVerified: boolean;
};

// Case-insensitive substring on the cached name OR a case-insensitive
// address prefix. DuckDB's contains()/starts_with() are byte-exact, so
// both sides are lowered (cached addresses are lowercase hex; the needle
// is normalized the same way). Escaping is a non-issue with these
// functions: a '%' in the needle stays a literal percent, not a wildcard.
const contractMatchFilter = (needle: string) => {
  const lowered = needle.toLowerCase();
  return or(
    sql`contains(lower(${contractSources.contractName}), ${lowered})`,
    sql`starts_with(lower(${contractSources.address}), ${lowered})`,
  );
};

// The datetime column maps to Date through drizzle's fromDriver, but the
// DuckDB adapter also has raw-read paths that hand back strings — accept
// both, and never guess a date the row does not carry.
// String shape note: DuckDB hands back the NAIVE stored value
// ('2026-09-21 12:07:19.183', space-separated, no offset) and the stored
// convention is UTC wall time (now() default). JS would parse that as
// LOCAL time — on a UTC+8 machine every cached-at would read 8 hours old —
// so a string without an explicit offset/designator is parsed as UTC.
const toIsoTimestamp = (value: Date | string | null | undefined): string | null => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) {
    const hasOffset = value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value);
    const normalized = hasOffset ? value : `${value.replace(' ', 'T')}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

/**
 * One directory page of cached contract_sources rows: verified rows lead,
 * then most recently updated. `total` counts the whole filtered set so
 * callers can page; `q`/`offset` echo the applied filter and offset so
 * clients can refuse a settle that raced an argument switch.
 */
export async function listCachedContracts(options: {
  chainId: number;
  q?: string;
  limit: number;
  offset: number;
}): Promise<{
  contracts: CachedContractSummary[];
  total: number;
  q: string | null;
  offset: number;
}> {
  const { chainId, limit, offset } = options;
  const q = options.q?.trim() ?? '';

  const filter = q !== ''
    ? and(eq(contractSources.chainId, chainId), contractMatchFilter(q))
    : eq(contractSources.chainId, chainId);

  const rows = await db
    .select({
      address: contractSources.address,
      contractName: contractSources.contractName,
      isVerified: contractSources.isVerified,
      verificationSource: contractSources.verificationSource,
      lastUpdated: contractSources.lastUpdated,
    })
    .from(contractSources)
    .where(filter)
    .orderBy(
      desc(contractSources.isVerified),
      desc(contractSources.lastUpdated),
      contractSources.address,
    )
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ value: count() })
    .from(contractSources)
    .where(filter);

  return {
    contracts: rows.map(row => ({
      chainId,
      address: row.address,
      name: row.contractName ?? null,
      isVerified: row.isVerified ?? false,
      verificationSource: row.verificationSource ?? null,
      updatedAt: toIsoTimestamp(row.lastUpdated),
    })),
    // drizzle's count() casts DuckDB's BIGINT to a JS number (same note
    // as the transactions list).
    total: countResult[0]?.value || 0,
    q: q !== '' ? q : null,
    offset,
  };
}

/**
 * Free-text local-cache hits for the global search's additive
 * localContracts field. Unscoped by default: each hit carries its own
 * chainId so clients link to the right chain's page; pass a chainId to
 * scope the match. Returns null when the cache read itself fails — an
 * empty array must keep meaning "no matches", never "could not check" —
 * so callers drop the field instead of asserting a fact they do not know.
 */
export async function searchLocalContractHits(
  query: string,
  chainId?: number,
  limit = LOCAL_CONTRACT_SEARCH_LIMIT,
): Promise<LocalContractHit[] | null> {
  const q = query.trim();
  if (q === '') return [];

  try {
    const rows = await db
      .select({
        chainId: contractSources.chainId,
        address: contractSources.address,
        contractName: contractSources.contractName,
        isVerified: contractSources.isVerified,
      })
      .from(contractSources)
      .where(
        chainId !== undefined
          ? and(eq(contractSources.chainId, chainId), contractMatchFilter(q))
          : contractMatchFilter(q),
      )
      .orderBy(
        desc(contractSources.isVerified),
        desc(contractSources.lastUpdated),
        contractSources.address,
      )
      .limit(limit);

    return rows.map(row => ({
      chainId: row.chainId,
      address: row.address,
      name: row.contractName ?? null,
      isVerified: row.isVerified ?? false,
    }));
  }
  catch (error) {
    logger.warn({ err: error, query: q }, 'Local contract cache lookup failed');
    return null;
  }
}

// --- Token/label entity hits (curated known tokens + address labels) ---
//
// The global search's free-text branch ALSO matches two curated sources
// this explorer owns outright — no indexer claim, no token registry:
//   - config/knownTokens.ts: the corroborated per-chain curated list.
//     Its symbol is a display hint; matching it is a shortcut to the
//     token page, never a claim the list is complete.
//   - address_labels rows: the operator's own annotations plus the
//     builtin labels seeded on first startup.
// One pure matcher owns every rule below (fixture-testable with no
// database); searchTokenEntityHits only feeds it DB rows.

// Free-text search surfaces at most this many token/label hits: like the
// local-contract section, a curated shortcut — not a directory.
export const TOKEN_ENTITY_SEARCH_LIMIT = 5;

// Label rows read per query before the cap is applied: enough headroom to
// keep the address dedup honest past the visible cut, bounded because the
// table is the operator's own (small by construction).
const TOKEN_ENTITY_LABEL_READ_LIMIT = 50;

export type TokenEntityHitSource = 'known-token' | 'label';

export type TokenEntityHit = {
  chainId: number;
  address: string;
  matchText: string;
  source: TokenEntityHitSource;
};

// Matcher inputs are deliberately plain shapes so fixtures drive the
// tests without a database (and without the curated config's contents).
export type KnownTokenEntry = { chainId: number; address: string; symbol: string };
export type LabelEntry = { chainId: number; address: string; label: string };

/**
 * Pure matcher behind the global search's additive tokenHits field:
 * case-insensitive substring on the curated symbol or the label text.
 * Dedup rule: when one address hits both sources, the label wins — a
 * user/builtin label is authored intent about that address and outranks
 * the curated symbol hint (which is a display hint only). Labels merge
 * first so that precedence is also the visible order; known-token
 * entries skip any (chain, address) already claimed. Ordering within
 * each source is the caller's (labels arrive deterministically ordered
 * by chainId/address from SQL; known tokens keep curated list order).
 */
export function matchTokenEntityHits(
  query: string,
  knownTokens: readonly KnownTokenEntry[],
  labels: readonly LabelEntry[],
  limit = TOKEN_ENTITY_SEARCH_LIMIT,
): TokenEntityHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === '' || limit <= 0) return [];

  const hits: TokenEntityHit[] = [];
  const seen = new Set<string>();
  const claim = (chainId: number, address: string): boolean => {
    // Lowercase key: known-token addresses are stored EIP-55 checksummed
    // while label storage keys are lowercase — same entity either way.
    const key = `${chainId}:${address.toLowerCase()}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  };

  for (const row of labels) {
    if (!row.label.toLowerCase().includes(needle)) continue;
    if (claim(row.chainId, row.address)) continue;
    hits.push({
      chainId: row.chainId,
      address: row.address,
      matchText: row.label,
      source: 'label',
    });
    if (hits.length >= limit) return hits;
  }
  for (const token of knownTokens) {
    if (!token.symbol.toLowerCase().includes(needle)) continue;
    if (claim(token.chainId, token.address)) continue;
    hits.push({
      chainId: token.chainId,
      address: token.address,
      matchText: token.symbol,
      source: 'known-token',
    });
    if (hits.length >= limit) return hits;
  }
  return hits;
}

// Same byte-exact contains() note as contractMatchFilter above: DuckDB's
// contains() is byte-exact, so both sides are lowered and a '%' in the
// needle stays a literal percent, not a wildcard.
const labelMatchFilter = (needle: string) => {
  const lowered = needle.toLowerCase();
  return sql`contains(lower(${addressLabels.label}), ${lowered})`;
};

/**
 * Token/label hits for the global search's additive tokenHits field:
 * curated known-token symbol matches plus this explorer's address_labels
 * rows (user + builtin), scoped to `chainId` when given — unscoped hits
 * each carry their own chainId so clients link to the right chain (same
 * semantics as localContracts). Returns null when the label read itself
 * fails: an absent field never claims "no matches" was checked.
 */
export async function searchTokenEntityHits(
  query: string,
  chainId?: number,
  limit = TOKEN_ENTITY_SEARCH_LIMIT,
): Promise<TokenEntityHit[] | null> {
  const q = query.trim();
  if (q === '') return [];

  // Curated known tokens for the scope: one chain's list when scoped,
  // every curated chain otherwise (integer keys iterate ascending, so
  // unscoped order is deterministic).
  const knownEntries: KnownTokenEntry[] = chainId !== undefined
    ? knownTokensForChain(chainId).map(token => ({ chainId, ...token }))
    : Object.entries(KNOWN_TOKENS).flatMap(
        ([id, list]) => list.map(token => ({ chainId: Number(id), ...token })),
      );

  try {
    const labelRows = await db
      .select({
        chainId: addressLabels.chainId,
        address: addressLabels.address,
        label: addressLabels.label,
      })
      .from(addressLabels)
      .where(
        chainId !== undefined
          ? and(eq(addressLabels.chainId, chainId), labelMatchFilter(q))
          : labelMatchFilter(q),
      )
      // Deterministic merge order for the matcher (chainId, address).
      .orderBy(addressLabels.chainId, addressLabels.address)
      .limit(TOKEN_ENTITY_LABEL_READ_LIMIT);

    return matchTokenEntityHits(q, knownEntries, labelRows, limit);
  }
  catch (error) {
    logger.warn({ err: error, query: q }, 'Address label lookup failed');
    return null;
  }
}
