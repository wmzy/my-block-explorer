// 链配置定义
import type { Chain } from 'viem';
import * as chains from 'viem/chains';

// 支持viem的所有链
export const SUPPORTED_CHAINS: Chain[] = Object.values(chains);

// 常用链列表（用于UI优先显示）
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

// 根据chainId获取链信息
export function getChainInfo(chainId: number): Chain | null {
  return SUPPORTED_CHAINS.find(chain => chain.id === chainId) ?? null;
}

// 获取链名称
export function getChainName(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.name ?? `Chain ${chainId}`;
}

// 获取链的原生代币符号
export function getChainSymbol(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.nativeCurrency.symbol ?? 'ETH';
}

// 获取链的区块浏览器URL
export function getChainExplorerUrl(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.blockExplorers?.default?.url ?? '';
}

// 获取默认RPC URL
export function getDefaultRpcUrl(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.rpcUrls.default.http[0] ?? '';
}

// 获取所有支持的链ID
export function getSupportedChainIds(): number[] {
  return SUPPORTED_CHAINS.map(chain => chain.id);
}

// 检查链是否支持
export function isChainSupported(chainId: number): boolean {
  return getSupportedChainIds().includes(chainId);
}

// 用户RPC配置类型
export type UserRpcConfig = {
  chainId: number;
  customRpcUrl?: string; // 用户自定义RPC
  rpcBackups?: string[]; // 备用RPC端点
  timeout?: number; // 超时设置
  retryCount?: number; // 重试次数
  rateLimit?: number; // 请求限制
};

// 获取有效的RPC URL（自定义优先，否则viem默认）
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

  // 检查链名称中是否包含测试网标识
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

// 检查链是否为常用链
export function isPopularChain(chainId: number): boolean {
  return POPULAR_CHAIN_IDS.has(chainId);
}

// 获取链的类型（主网/测试网）
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

// 按类型和受欢迎程度排序链
export function getSortedChains(): Chain[] {
  // Copy per call: callers own the result and may mutate it without
  // poisoning the cached order.
  return SORTED_CHAINS.slice();
}

// 搜索链（按名称或Chain ID）
export function searchChains(query: string): Chain[] {
  if (!query.trim()) return getSortedChains();

  const lowerQuery = query.toLowerCase();
  const compactQuery = lowerQuery.replace(/\s+/g, '');
  const numericQuery = parseInt(query);
  const hasNumericQuery = !isNaN(numericQuery);

  const matches = SEARCH_ORDER.filter((entry) => {
    const { chain, lowerName, compactLowerName } = entry;

    // 精确匹配Chain ID
    if (hasNumericQuery && chain.id === numericQuery) return true;

    // 名称匹配
    if (lowerName.includes(lowerQuery)) return true;

    // Chain ID部分匹配
    if (chain.id.toString().includes(query)) return true;

    // 代币符号匹配
    if (chain.nativeCurrency.symbol.toLowerCase().includes(lowerQuery)) return true;

    // 别名匹配（如果有的话）
    if (compactLowerName.includes(compactQuery)) return true;

    return false;
  });

  // Only the query-dependent tiers are sorted per call (exact chain id,
  // then name prefix); the popular → type → name order is inherited from
  // SEARCH_ORDER because Array#sort is stable.
  return matches
    .sort((a, b) => {
      // 1. 精确Chain ID匹配优先
      if (hasNumericQuery) {
        if (a.chain.id === numericQuery && b.chain.id !== numericQuery) return -1;
        if (a.chain.id !== numericQuery && b.chain.id === numericQuery) return 1;
      }

      // 2. 名称开头匹配优先
      const aStartsWith = a.lowerName.startsWith(lowerQuery);
      const bStartsWith = b.lowerName.startsWith(lowerQuery);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      return 0;
    })
    .map(entry => entry.chain);
}

// 多链数据库配置
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

// 默认数据库配置
export const DEFAULT_DATABASE_CONFIG: Partial<ChainDatabaseConfig> = {
  indexingEnabled: true,
  maxHistoricalBlocks: 10000,
  eventBatchSize: 1000,
  rpcTimeout: 30000,
  maxRetries: 3,
  rateLimitRpm: 120,
};

// 生成链特定的数据库配置
export function getChainDatabaseConfig(
  chainId: number,
  overrides?: Partial<ChainDatabaseConfig>,
): ChainDatabaseConfig {
  const chainName = getChainName(chainId);
  const chainType = getChainType(chainId);

  // 生成数据库文件路径
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

// 获取多个链的数据库配置
export function getMultiChainDatabaseConfig(
  chainIds: number[],
  overrides?: Partial<ChainDatabaseConfig>,
): ChainDatabaseConfig[] {
  return chainIds.map(chainId => getChainDatabaseConfig(chainId, overrides));
}

// 多链支持的链配置（默认支持所有viem链）
export const MULTI_CHAIN_SUPPORTED_CHAINS = getSupportedChainIds();

// 常用多链配置（用于快速启动）
export const POPULAR_MULTI_CHAINS = POPULAR_CHAINS.map(chain => chain.id);

// 按类型分组的链
export const CHAINS_BY_TYPE = {
  mainnet: SUPPORTED_CHAINS.filter(chain => getChainType(chain.id) === 'mainnet').map(
    chain => chain.id,
  ),
  testnet: SUPPORTED_CHAINS.filter(chain => getChainType(chain.id) === 'testnet').map(
    chain => chain.id,
  ),
};

// 获取特定类型的链
export function getChainsByType(type: 'mainnet' | 'testnet'): number[] {
  return CHAINS_BY_TYPE[type] || [];
}

// 检查链是否启用了数据库隔离
export function isChainDatabaseIsolationEnabled(chainId: number): boolean {
  // �情况下所有支持的链都启用数据库隔离
  return isChainSupported(chainId);
}

// 获取链的数据目录
export function getChainDataDirectory(chainId: number): string {
  const chainType = getChainType(chainId);
  return `data/chains/${chainType}`;
}

// 获取链的数据库文件名
export function getChainDatabaseFileName(chainId: number): string {
  const chainName = getChainName(chainId);
  const safeChainName = chainName.toLowerCase().replace(/\s+/g, '-');
  return `${safeChainName}-${chainId}.db`;
}

// 获取链的完整数据库路径
export function getChainDatabasePath(chainId: number): string {
  const dataDirectory = getChainDataDirectory(chainId);
  const fileName = getChainDatabaseFileName(chainId);
  return `${dataDirectory}/${fileName}`;
}

// 多链配置验证
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

// 推荐的多链配置（基于流行度和性能）
export const RECOMMENDED_MULTI_CHAINS = [
  // Layer 1 主网
  1, // Ethereum
  56, // BSC
  137, // Polygon

  // Layer 2
  42161, // Arbitrum One
  8453, // Base
  10, // Optimism

  // 其他主流链
  43114, // Avalanche
  250, // Fantom
  42220, // Celo
  100, // Gnosis
];

// 获取推荐的多链配置
export function getRecommendedMultiChainConfig(): ChainDatabaseConfig[] {
  return getMultiChainDatabaseConfig(RECOMMENDED_MULTI_CHAINS);
}

// 开发环境多链配置
export const DEVELOPMENT_CHAINS = [
  1, // Ethereum Mainnet
  11155111, // Sepolia Testnet
  137, // Polygon
  80001, // Polygon Mumbai
];

// 获取开发环境配置
export function getDevelopmentMultiChainConfig(): ChainDatabaseConfig[] {
  return getMultiChainDatabaseConfig(DEVELOPMENT_CHAINS);
}
