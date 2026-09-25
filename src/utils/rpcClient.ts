import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet, polygon, arbitrum, optimism, base } from 'viem/chains';
import type { Chain } from 'viem';

// Supported chain configurations
const SUPPORTED_CHAINS: Record<number, Chain> = {
  1: mainnet,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  8453: base,
  // Mantle chain configuration
  5000: {
    id: 5000,
    name: 'Mantle',
    nativeCurrency: {
      decimals: 18,
      name: 'Mantle',
      symbol: 'MNT',
    },
    rpcUrls: {
      default: {
        http: ['https://rpc.mantle.xyz'],
      },
      public: {
        http: ['https://rpc.mantle.xyz'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Mantle Explorer',
        url: 'https://explorer.mantle.xyz',
      },
    },
  },
};

// RPC client cache
const clientCache = new Map<number, PublicClient>();

/**
 * Get the RPC client for a chain
 */
export function getRpcClient(chainId: number): PublicClient {
  // Check the cache
  if (clientCache.has(chainId)) {
    return clientCache.get(chainId)!;
  }

  // Get the chain configuration
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // Create the client
  const client = createPublicClient({
    chain,
    transport: http(),
  });

  // Cache the client
  clientCache.set(chainId, client);

  return client;
}

/**
 * Check whether a chain is supported
 */
export function isSupportedChain(chainId: number): boolean {
  return chainId in SUPPORTED_CHAINS;
}

/**
 * Get the list of supported chains
 */
export function getSupportedChains(): Chain[] {
  return Object.values(SUPPORTED_CHAINS);
}

/**
 * RPC call with retries
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await operation();
    }
    catch (error) {
      lastError = error as Error;

      if (i === maxRetries) {
        break;
      }

      // Wait, then retry
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }

  throw lastError!;
}
