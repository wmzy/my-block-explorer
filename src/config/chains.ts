// Chain configuration definitions
import type { Chain } from 'viem';
import * as chains from 'viem/chains';
import { getCustomChain, toViemChain } from './customChains';

// All chains supported by viem
export const SUPPORTED_CHAINS: Chain[] = Object.values(chains);

// Popular chains (prioritized in the UI)
export const POPULAR_CHAINS: Chain[] = [
  chains.mainnet,
  chains.polygon,
  chains.bsc,
  chains.arbitrum,
  chains.base,
  chains.optimism,
  chains.avalanche,
  chains.fantom,
  chains.celo,
  chains.gnosis,
];

// Static viem-registry lookup with NO custom-chain fallback. Callers that
// must distinguish "shipped with viem" from "user-registered" — the custom
// -chain route's 409 conflict check is the one — need the two layers
// separated; everything else goes through getChainInfo below.
export function getBuiltInChainInfo(chainId: number): Chain | null {
  return SUPPORTED_CHAINS.find(chain => chain.id === chainId) ?? null;
}

// viem's local-dev placeholders (anvil, hardhat and foundry all share id
// 31337 with loopback default RPCs) are node templates, not networks: the
// custom-chain flow exists precisely to point the explorer at a local
// node, so registering over them is the advertised path. Every default
// RPC being loopback marks a placeholder — real chains never ship that.
function isLoopbackHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:') return false;
    return (
      parsed.hostname === '127.0.0.1'
      || parsed.hostname === 'localhost'
      || parsed.hostname === '[::1]'
      || parsed.hostname === '::1'
    );
  }
  catch {
    return false;
  }
}

function isPlaceholderChain(chain: Chain): boolean {
  const httpUrls = chain.rpcUrls.default.http;
  return httpUrls.length > 0 && httpUrls.every(isLoopbackHttpUrl);
}

// True when a custom registration for this id must conflict (409): viem
// ships the id as a REAL network whose metadata a registration would
// shadow. Placeholder dev chains stay registrable; ids viem does not
// ship at all trivially do not conflict either.
export function isBuiltInChainProtected(chainId: number): boolean {
  const candidates = chainsById.get(chainId) ?? [];
  return candidates.some(chain => !isPlaceholderChain(chain));
}

// Resolve chain info by chainId: user-registered custom chains (the runtime
// registry in config/customChains.ts) take priority, with the static viem
// registry as fallback. The registry must win: a registration may only
// override ids viem does not recognize, or viem's local dev placeholder
// chains (the 31337 family — the router 409s real chains); a placeholder's default loopback URL is rarely the user's node, so honoring registrations is what makes the registered RPC actually serve that chain.
export function getChainInfo(chainId: number): Chain | null {
  const custom = getCustomChain(chainId);
  if (custom) return toViemChain(custom);
  return getBuiltInChainInfo(chainId);
}

// Get the chain name
export function getChainName(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.name ?? `Chain ${chainId}`;
}

// Get the chain's native token symbol
export function getChainSymbol(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.nativeCurrency.symbol ?? 'ETH';
}

// Get the chain's block explorer URL
export function getChainExplorerUrl(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.blockExplorers?.default?.url ?? '';
}

// Get the default RPC URL
export function getDefaultRpcUrl(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.rpcUrls.default.http[0] ?? '';
}

// Get all supported chain IDs
export function getSupportedChainIds(): number[] {
  return SUPPORTED_CHAINS.map(chain => chain.id);
}

// Check whether a chain is supported
export function isChainSupported(chainId: number): boolean {
  // Custom registrations sit on top of the viem id list; the O(1) registry
  // check short-circuits before the linear scan.
  return getCustomChain(chainId) !== undefined || getSupportedChainIds().includes(chainId);
}

// User RPC configuration type
export type UserRpcConfig = {
  chainId: number;
  customRpcUrl?: string; // User-defined RPC
  rpcBackups?: string[]; // Backup RPC endpoints
  timeout?: number; // Timeout setting
  retryCount?: number; // Retry count
  rateLimit?: number; // Request limit
};

// Get the effective RPC URL (custom first, otherwise the viem default)
export function getEffectiveRpcUrl(chainId: number, userConfig?: UserRpcConfig): string {
  if (userConfig?.customRpcUrl) {
    return userConfig.customRpcUrl;
  }

  return getDefaultRpcUrl(chainId);
}

// Precomputed popular-chain id set: O(1) membership checks. isPopularChain
// used to do a linear scan per call and sits inside sort comparators.
const POPULAR_CHAIN_IDS: Set<number> = new Set(POPULAR_CHAINS.map(chain => chain.id));

// viem's barrel export contains multiple exports sharing one chain id
// (aliases and testnet twins); classification must consider every export
// with that id, so group them once at module load.
const chainsById = new Map<number, Chain[]>();
for (const chain of SUPPORTED_CHAINS) {
  const group = chainsById.get(chain.id);
  if (group) {
    group.push(chain);
  } else {
    chainsById.set(chain.id, [chain]);
  }
}

// Classify one chain id from its full candidate group. Logic extracted
// verbatim from the original per-call implementation — behavior is unchanged.
function classifyChainType(
  chainId: number,
  candidates: readonly Chain[],
): 'mainnet' | 'testnet' | 'unknown' {
  if (candidates.length === 0) return 'unknown';

  // viem marks testnets explicitly (chain.testnet === true). Trust the flag
  // before the legacy heuristics below: it already covers every current
  // testnet (Holesky 17000, Sepolia 11155111, ...) without this function's
  // ID/name lists drifting out of date.
  if (candidates.some(chain => chain.testnet === true)) {
    return 'testnet';
  }

  // Legacy heuristic fallback for chains viem does not flag. The dead
  // pre-merge Ethereum testnet ids (3/4/5/42) are deliberately NOT listed:
  // newer viem builds either removed them (3/4 → 'unknown' above) or, for
  // 42, re-assigned the id to LUKSO mainnet — the stale Kovan entry
  // misclassified a live mainnet as a testnet.
  const testnetIds = [
    80001, // Polygon Mumbai
    97, // BSC Testnet
    421611,
    421613,
    421614, // Arbitrum testnets
    84531,
    84532, // Base testnets
    420,
    69, // Optimism testnets
    43113, // Avalanche Fuji
    4002, // Fantom Testnet
    44787,
    62320, // Celo testnets
    10200, // Gnosis Chiado
  ];

  if (testnetIds.includes(chainId)) {
    return 'testnet';
  }

  // Check whether the chain name contains a testnet marker
  const name = candidates[0].name.toLowerCase();
  if (
    name.includes('test')
    || name.includes('sepolia')
    || name.includes('goerli')
    || name.includes('holesky')
    || name.includes('mumbai')
    || name.includes('fuji')
    || name.includes('chiado')
  ) {
    return 'testnet';
  }

  return 'mainnet';
}

// Precomputed chainId → type map: getChainType is O(1) instead of re-scanning
// all ~700 chains per call. It used to run inside sort comparators, making
// every search keystroke O(n² log n).
const chainIdToType = new Map<number, 'mainnet' | 'testnet' | 'unknown'>();
for (const [chainId, candidates] of chainsById) {
  chainIdToType.set(chainId, classifyChainType(chainId, candidates));
}

// Check whether a chain is popular
export function isPopularChain(chainId: number): boolean {
  return POPULAR_CHAIN_IDS.has(chainId);
}

// Get the chain type (mainnet/testnet)
export function getChainType(chainId: number): 'mainnet' | 'testnet' | 'unknown' {
  return chainIdToType.get(chainId) ?? 'unknown';
}

// Shared relevance tail of the sort order: popular chains first, then
// mainnets before testnets, then name. Lookups hit the precomputed
// set/map, so each comparison is O(1).
function compareByPopularityThenTypeThenName(a: Chain, b: Chain): number {
  const aIsPopular = POPULAR_CHAIN_IDS.has(a.id);
  const bIsPopular = POPULAR_CHAIN_IDS.has(b.id);
  if (aIsPopular && !bIsPopular) return -1;
  if (!aIsPopular && bIsPopular) return 1;

  const aType = chainIdToType.get(a.id);
  const bType = chainIdToType.get(b.id);
  if (aType === 'mainnet' && bType !== 'mainnet') return -1;
  if (aType !== 'mainnet' && bType === 'mainnet') return 1;

  return a.name.localeCompare(b.name);
}

// Precomputed search index: one entry per exported chain (id duplicates
// included — searchChains has always matched every export) with the
// lowercased name variants computed once instead of per keystroke.
type ChainIndexEntry = {
  chain: Chain;
  lowerName: string;
  compactLowerName: string;
};

const CHAIN_INDEX: ChainIndexEntry[] = SUPPORTED_CHAINS.map(chain => ({
  chain,
  lowerName: chain.name.toLowerCase(),
  compactLowerName: chain.name.toLowerCase().replace(/\s+/g, ''),
}));

// Base search order (popular → type → name), sorted once at module load.
// searchChains only filters it and re-ranks the query-dependent tiers.
const SEARCH_ORDER: ChainIndexEntry[] = CHAIN_INDEX.slice().sort((a, b) =>
  compareByPopularityThenTypeThenName(a.chain, b.chain),
);

// Precomputed sorted chain list. Object.values(chains) contains multiple
// exports sharing one chain id (aliases and testnet twins); dedupe by id
// (first export wins) or selector cards repeat.
const SORTED_CHAINS: Chain[] = (() => {
  const seen = new Set<number>();
  const unique: Chain[] = [];
  for (const { chain } of CHAIN_INDEX) {
    if (seen.has(chain.id)) continue;
    seen.add(chain.id);
    unique.push(chain);
  }
  return unique.sort(compareByPopularityThenTypeThenName);
})();

// Sort chains by type and popularity
export function getSortedChains(): Chain[] {
  // Copy per call: callers own the result and may mutate it without
  // poisoning the cached order.
  return SORTED_CHAINS.slice();
}

// Search chains (by name or chain ID)
export function searchChains(query: string): Chain[] {
  if (!query.trim()) return getSortedChains();

  const lowerQuery = query.toLowerCase();
  const compactQuery = lowerQuery.replace(/\s+/g, '');
  const numericQuery = parseInt(query);
  const hasNumericQuery = !isNaN(numericQuery);

  const matches = SEARCH_ORDER.filter((entry) => {
    const { chain, lowerName, compactLowerName } = entry;

    // Exact chain ID match
    if (hasNumericQuery && chain.id === numericQuery) return true;

    // Name match
    if (lowerName.includes(lowerQuery)) return true;

    // Partial chain ID match
    if (chain.id.toString().includes(query)) return true;

    // Token symbol match
    if (chain.nativeCurrency.symbol.toLowerCase().includes(lowerQuery)) return true;

    // Alias match (when present)
    if (compactLowerName.includes(compactQuery)) return true;

    return false;
  });

  // Only the query-dependent tiers are sorted per call (exact chain id,
  // then name prefix); the popular → type → name order is inherited from
  // SEARCH_ORDER because Array#sort is stable.
  return matches
    .sort((a, b) => {
      // 1. Exact chain ID matches rank first
      if (hasNumericQuery) {
        if (a.chain.id === numericQuery && b.chain.id !== numericQuery) return -1;
        if (a.chain.id !== numericQuery && b.chain.id === numericQuery) return 1;
      }

      // 2. Name-prefix matches come next
      const aStartsWith = a.lowerName.startsWith(lowerQuery);
      const bStartsWith = b.lowerName.startsWith(lowerQuery);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      return 0;
    })
    .map(entry => entry.chain);
}

// Multi-chain database configuration
export interface ChainDatabaseConfig {
  chainId: number;
  chainName: string;
  chainType: string;
  databasePath: string;
  indexingEnabled: boolean;
  maxHistoricalBlocks: number;
  eventBatchSize: number;
  rpcTimeout: number;
  maxRetries: number;
  rateLimitRpm: number;
}

// Default database configuration
export const DEFAULT_DATABASE_CONFIG: Partial<ChainDatabaseConfig> = {
  indexingEnabled: true,
  maxHistoricalBlocks: 10000,
  eventBatchSize: 1000,
  rpcTimeout: 30000,
  maxRetries: 3,
  rateLimitRpm: 120,
};

// Generate a chain-specific database configuration
export function getChainDatabaseConfig(
  chainId: number,
  overrides?: Partial<ChainDatabaseConfig>,
): ChainDatabaseConfig {
  const chainName = getChainName(chainId);
  const chainType = getChainType(chainId);

  // Generate the database file path
  const safeChainName = chainName.toLowerCase().replace(/\s+/g, '-');
  const databasePath = `data/chains/${chainType}/${safeChainName}-${chainId}.db`;

  return {
    chainId,
    chainName,
    chainType,
    databasePath,
    indexingEnabled: true,
    maxHistoricalBlocks: 10000,
    eventBatchSize: 1000,
    rpcTimeout: 30000,
    maxRetries: 3,
    rateLimitRpm: 120,
    ...DEFAULT_DATABASE_CONFIG,
    ...overrides,
  };
}

// Get database configurations for multiple chains
export function getMultiChainDatabaseConfig(
  chainIds: number[],
  overrides?: Partial<ChainDatabaseConfig>,
): ChainDatabaseConfig[] {
  return chainIds.map(chainId => getChainDatabaseConfig(chainId, overrides));
}

// Chain configuration for multi-chain support (all viem chains by default)
export const MULTI_CHAIN_SUPPORTED_CHAINS = getSupportedChainIds();

// Popular multi-chain configurations (for quick starts)
export const POPULAR_MULTI_CHAINS = POPULAR_CHAINS.map(chain => chain.id);

// Chains grouped by type
export const CHAINS_BY_TYPE = {
  mainnet: SUPPORTED_CHAINS.filter(chain => getChainType(chain.id) === 'mainnet').map(
    chain => chain.id,
  ),
  testnet: SUPPORTED_CHAINS.filter(chain => getChainType(chain.id) === 'testnet').map(
    chain => chain.id,
  ),
};

// Get chains of a specific type
export function getChainsByType(type: 'mainnet' | 'testnet'): number[] {
  return CHAINS_BY_TYPE[type] || [];
}

// Check whether a chain has database isolation enabled
export function isChainDatabaseIsolationEnabled(chainId: number): boolean {
  // By default, all supported chains have database isolation enabled
  return isChainSupported(chainId);
}

// Get a chain's data directory
export function getChainDataDirectory(chainId: number): string {
  const chainType = getChainType(chainId);
  return `data/chains/${chainType}`;
}

// Get a chain's database file name
export function getChainDatabaseFileName(chainId: number): string {
  const chainName = getChainName(chainId);
  const safeChainName = chainName.toLowerCase().replace(/\s+/g, '-');
  return `${safeChainName}-${chainId}.db`;
}

// Get a chain's full database path
export function getChainDatabasePath(chainId: number): string {
  const dataDirectory = getChainDataDirectory(chainId);
  const fileName = getChainDatabaseFileName(chainId);
  return `${dataDirectory}/${fileName}`;
}

// Multi-chain configuration validation
export function validateMultiChainConfig(chainIds: number[]): {
  valid: boolean;
  errors: string[];
  supportedChains: number[];
  unsupportedChains: number[];
} {
  const supportedChains: number[] = [];
  const unsupportedChains: number[] = [];
  const errors: string[] = [];

  chainIds.forEach((chainId) => {
    if (isChainSupported(chainId)) {
      supportedChains.push(chainId);
    }
    else {
      unsupportedChains.push(chainId);
      errors.push(`Chain ${chainId} is not supported`);
    }
  });

  return {
    valid: unsupportedChains.length === 0,
    errors,
    supportedChains,
    unsupportedChains,
  };
}

// Recommended multi-chain configurations (based on popularity and performance)
export const RECOMMENDED_MULTI_CHAINS = [
  // Layer 1 mainnets
  1, // Ethereum
  56, // BSC
  137, // Polygon

  // Layer 2
  42161, // Arbitrum One
  8453, // Base
  10, // Optimism

  // Other major chains
  43114, // Avalanche
  250, // Fantom
  42220, // Celo
  100, // Gnosis
];

// Get the recommended multi-chain configuration
export function getRecommendedMultiChainConfig(): ChainDatabaseConfig[] {
  return getMultiChainDatabaseConfig(RECOMMENDED_MULTI_CHAINS);
}

// Development multi-chain configuration
export const DEVELOPMENT_CHAINS = [
  1, // Ethereum Mainnet
  11155111, // Sepolia Testnet
  137, // Polygon
  80001, // Polygon Mumbai
];

// Get the development configuration
export function getDevelopmentMultiChainConfig(): ChainDatabaseConfig[] {
  return getMultiChainDatabaseConfig(DEVELOPMENT_CHAINS);
}
