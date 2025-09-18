// 链配置定义
import type { Chain } from "viem";
import * as chains from "viem/chains";

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
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId) || null;
}

// 获取链名称
export function getChainName(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.name || `Chain ${chainId}`;
}

// 获取链的原生代币符号
export function getChainSymbol(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.nativeCurrency.symbol || "ETH";
}

// 获取链的区块浏览器URL
export function getChainExplorerUrl(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.blockExplorers?.default?.url || "";
}

// 获取默认RPC URL
export function getDefaultRpcUrl(chainId: number): string {
  const chain = getChainInfo(chainId);
  return chain?.rpcUrls.default.http[0] || "";
}

// 获取所有支持的链ID
export function getSupportedChainIds(): number[] {
  return SUPPORTED_CHAINS.map((chain) => chain.id);
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
  userConfig?: UserRpcConfig
): string {
  if (userConfig?.customRpcUrl) {
    return userConfig.customRpcUrl;
  }

  return getDefaultRpcUrl(chainId);
}

// 检查链是否为常用链
export function isPopularChain(chainId: number): boolean {
  return POPULAR_CHAINS.some((chain) => chain.id === chainId);
}

// 获取链的类型（主网/测试网）
export function getChainType(
  chainId: number
): "mainnet" | "testnet" | "unknown" {
  const chain = getChainInfo(chainId);
  if (!chain) return "unknown";

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
    return "testnet";
  }

  // 检查链名称中是否包含测试网标识
  const name = chain.name.toLowerCase();
  if (
    name.includes("test") ||
    name.includes("sepolia") ||
    name.includes("goerli") ||
    name.includes("mumbai") ||
    name.includes("fuji") ||
    name.includes("chiado")
  ) {
    return "testnet";
  }

  return "mainnet";
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

    if (aType === "mainnet" && bType !== "mainnet") return -1;
    if (aType !== "mainnet" && bType === "mainnet") return 1;

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
        .replace(/\s+/g, "")
        .includes(lowerQuery.replace(/\s+/g, ""))
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
    if (aType === "mainnet" && bType !== "mainnet") return -1;
    if (aType !== "mainnet" && bType === "mainnet") return 1;

    // 5. 按名称排序
    return a.name.localeCompare(b.name);
  });

  return results;
}
