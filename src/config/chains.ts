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
  return SUPPORTED_CHAINS.find(chain => chain.id === chainId) || null;
}

// 获取链名称
export function getChainName(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.name || `Chain ${chainId}`;
}

// 获取链的原生代币符号
export function getChainSymbol(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.nativeCurrency.symbol || 'ETH';
}

// 获取链的区块浏览器URL
export function getChainExplorerUrl(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.blockExplorers?.default?.url || '';
}

// 获取默认RPC URL
export function getDefaultRpcUrl(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.rpcUrls.default.http[0] || '';
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
export function getEffectiveRpcUrl(
  chainId: number,
  userConfig?: UserRpcConfig,
): string {
  if (userConfig?.customRpcUrl) {
    return userConfig.customRpcUrl;
  }

  return getDefaultRpcUrl(chainId);
}

// 检查链是否为常用链
export function isPopularChain(chainId: number): boolean {
  return POPULAR_CHAINS.some(chain => chain.id === chainId);
}

// 获取链的类型（主网/测试网）
export function getChainType(
  chainId: number,
): 'mainnet' | 'testnet' | 'unknown' {
  const chain = getChainInfo(chainId);
  if (!chain) return 'unknown';

  // 常见的测试网链ID
  const testnetIds = [
    3,
    4,
    5,
    42, // Ethereum testnets
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
  const name = chain.name.toLowerCase();
  if (
    name.includes('test')
    || name.includes('sepolia')
    || name.includes('goerli')
    || name.includes('mumbai')
    || name.includes('fuji')
    || name.includes('chiado')
  ) {
    return 'testnet';
  }

  return 'mainnet';
}

// 按类型和受欢迎程度排序链
export function getSortedChains(): Chain[] {
  return SUPPORTED_CHAINS.sort((a, b) => {
    // 首先按是否为常用链排序
    const aIsPopular = isPopularChain(a.id);
    const bIsPopular = isPopularChain(b.id);

    if (aIsPopular && !bIsPopular) return -1;
    if (!aIsPopular && bIsPopular) return 1;

    // 然后按类型排序（主网优先）
    const aType = getChainType(a.id);
    const bType = getChainType(b.id);

    if (aType === 'mainnet' && bType !== 'mainnet') return -1;
    if (aType !== 'mainnet' && bType === 'mainnet') return 1;

    // 最后按名称排序
    return a.name.localeCompare(b.name);
  });
}

// 搜索链（按名称或Chain ID）
export function searchChains(query: string): Chain[] {
  if (!query.trim()) return getSortedChains();

  const lowerQuery = query.toLowerCase();
  const numericQuery = parseInt(query);

  const results = SUPPORTED_CHAINS.filter((chain) => {
    // 精确匹配Chain ID
    if (!isNaN(numericQuery) && chain.id === numericQuery) return true;

    // 名称匹配
    if (chain.name.toLowerCase().includes(lowerQuery)) return true;

    // Chain ID部分匹配
    if (chain.id.toString().includes(query)) return true;

    // 代币符号匹配
    if (chain.nativeCurrency.symbol.toLowerCase().includes(lowerQuery))
      return true;

    // 别名匹配（如果有的话）
    if (
      chain.name
        .toLowerCase()
        .replace(/\s+/g, '')
        .includes(lowerQuery.replace(/\s+/g, ''))
    )
      return true;

    return false;
  });

  return results.sort((a, b) => {
    // 1. 精确Chain ID匹配优先
    if (!isNaN(numericQuery)) {
      if (a.id === numericQuery && b.id !== numericQuery) return -1;
      if (a.id !== numericQuery && b.id === numericQuery) return 1;
    }

    // 2. 名称开头匹配优先
    const aStartsWith = a.name.toLowerCase().startsWith(lowerQuery);
    const bStartsWith = b.name.toLowerCase().startsWith(lowerQuery);
    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;

    // 3. 常用链优先
    const aIsPopular = isPopularChain(a.id);
    const bIsPopular = isPopularChain(b.id);
    if (aIsPopular && !bIsPopular) return -1;
    if (!aIsPopular && bIsPopular) return 1;

    // 4. 主网优先于测试网
    const aType = getChainType(a.id);
    const bType = getChainType(b.id);
    if (aType === 'mainnet' && bType !== 'mainnet') return -1;
    if (aType !== 'mainnet' && bType === 'mainnet') return 1;

    // 5. 按名称排序
    return a.name.localeCompare(b.name);
  });

  return results;
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
  } as ChainDatabaseConfig;
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
  mainnet: SUPPORTED_CHAINS.filter(chain => getChainType(chain.id) === 'mainnet').map(chain => chain.id),
  testnet: SUPPORTED_CHAINS.filter(chain => getChainType(chain.id) === 'testnet').map(chain => chain.id),
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
  const chainName = getChainName(chainId);
  const safeChainName = chainName.toLowerCase().replace(/\s+/g, '-');
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
