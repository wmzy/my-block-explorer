import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";
import type { Chain } from "viem";

// 支持的链配置
const SUPPORTED_CHAINS: Record<number, Chain> = {
  1: mainnet,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  8453: base,
  // Mantle 链配置
  5000: {
    id: 5000,
    name: "Mantle",
    network: "mantle",
    nativeCurrency: {
      decimals: 18,
      name: "Mantle",
      symbol: "MNT",
    },
    rpcUrls: {
      default: {
        http: ["https://rpc.mantle.xyz"],
      },
      public: {
        http: ["https://rpc.mantle.xyz"],
      },
    },
    blockExplorers: {
      default: {
        name: "Mantle Explorer",
        url: "https://explorer.mantle.xyz",
      },
    },
  },
};

// RPC 客户端缓存
const clientCache = new Map<number, PublicClient>();

/**
 * 获取指定链的 RPC 客户端
 */
export function getRpcClient(chainId: number): PublicClient {
  // 检查缓存
  if (clientCache.has(chainId)) {
    return clientCache.get(chainId)!;
  }

  // 获取链配置
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // 创建客户端
  const client = createPublicClient({
    chain,
    transport: http(),
  });

  // 缓存客户端
  clientCache.set(chainId, client);

  return client;
}

/**
 * 检查链是否支持
 */
export function isSupportedChain(chainId: number): boolean {
  return chainId in SUPPORTED_CHAINS;
}

/**
 * 获取支持的链列表
 */
export function getSupportedChains(): Chain[] {
  return Object.values(SUPPORTED_CHAINS);
}

/**
 * 重试机制的 RPC 调用
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (i === maxRetries) {
        break;
      }

      // 等待后重试
      await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
    }
  }

  throw lastError!;
}
