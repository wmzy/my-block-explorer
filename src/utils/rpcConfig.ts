import type { RpcConfig, RpcStatus } from '../types/rpc';

const RPC_CONFIG_KEY = 'block-explorer-rpc-configs';

// 默认RPC配置
const DEFAULT_RPC_CONFIGS: RpcConfig[] = [
  // Ethereum
  {
    chainId: 1,
    name: 'Ethereum Mainnet (Public)',
    url: 'https://eth.llamarpc.com',
    isDefault: true,
    isCustom: false,
  },
  {
    chainId: 1,
    name: 'Ethereum Mainnet (Cloudflare)',
    url: 'https://cloudflare-eth.com',
    isDefault: false,
    isCustom: false,
  },

  // Polygon
  {
    chainId: 137,
    name: 'Polygon Mainnet (Public)',
    url: 'https://polygon.llamarpc.com',
    isDefault: true,
    isCustom: false,
  },
  {
    chainId: 137,
    name: 'Polygon Mainnet (Matic Network)',
    url: 'https://polygon-rpc.com',
    isDefault: false,
    isCustom: false,
  },

  // Arbitrum One
  {
    chainId: 42161,
    name: 'Arbitrum One (Public)',
    url: 'https://arbitrum.llamarpc.com',
    isDefault: true,
    isCustom: false,
  },
  {
    chainId: 42161,
    name: 'Arbitrum One (Official)',
    url: 'https://arb1.arbitrum.io/rpc',
    isDefault: false,
    isCustom: false,
  },

  // Optimism
  {
    chainId: 10,
    name: 'Optimism Mainnet (Public)',
    url: 'https://optimism.llamarpc.com',
    isDefault: true,
    isCustom: false,
  },
  {
    chainId: 10,
    name: 'Optimism Mainnet (Official)',
    url: 'https://mainnet.optimism.io',
    isDefault: false,
    isCustom: false,
  },

  // Base
  {
    chainId: 8453,
    name: 'Base Mainnet (Public)',
    url: 'https://base.llamarpc.com',
    isDefault: true,
    isCustom: false,
  },
  {
    chainId: 8453,
    name: 'Base Mainnet (Official)',
    url: 'https://mainnet.base.org',
    isDefault: false,
    isCustom: false,
  },

  // Mantle
  {
    chainId: 5000,
    name: 'Mantle Mainnet (Official)',
    url: 'https://rpc.mantle.xyz',
    isDefault: true,
    isCustom: false,
  },
  {
    chainId: 5000,
    name: 'Mantle Mainnet (Public)',
    url: 'https://mantle.publicnode.com',
    isDefault: false,
    isCustom: false,
  },

  // Sepolia Testnet
  {
    chainId: 11155111,
    name: 'Sepolia Testnet (Public)',
    url: 'https://ethereum-sepolia.publicnode.com',
    isDefault: true,
    isCustom: false,
  },
];

/**
 * 获取所有RPC配置
 */
export function getRpcConfigs(): RpcConfig[] {
  try {
    const stored = localStorage.getItem(RPC_CONFIG_KEY);
    if (stored) {
      const configs = JSON.parse(stored) as RpcConfig[];
      // 合并默认配置和用户配置
      const defaultConfigs = DEFAULT_RPC_CONFIGS.filter(
        defaultConfig =>
          !configs.some(
            config => config.chainId === defaultConfig.chainId && config.url === defaultConfig.url,
          ),
      );
      return [...defaultConfigs, ...configs];
    }
  } catch (error) {
    console.error('Failed to load RPC configs:', error);
  }

  return DEFAULT_RPC_CONFIGS;
}

/**
 * 保存RPC配置
 */
export function saveRpcConfig(config: RpcConfig): void {
  try {
    const configs = getRpcConfigs();
    const existingIndex = configs.findIndex(
      c => c.chainId === config.chainId && c.url === config.url,
    );

    if (existingIndex >= 0) {
      configs[existingIndex] = config;
    } else {
      configs.push(config);
    }

    // 只保存用户自定义的配置
    const customConfigs = configs.filter(c => c.isCustom);
    localStorage.setItem(RPC_CONFIG_KEY, JSON.stringify(customConfigs));
  } catch (error) {
    console.error('Failed to save RPC config:', error);
  }
}

/**
 * 删除RPC配置
 */
export function deleteRpcConfig(chainId: number, url: string): void {
  try {
    const configs = getRpcConfigs();
    const filteredConfigs = configs.filter(
      c => !(c.chainId === chainId && c.url === url && c.isCustom),
    );

    const customConfigs = filteredConfigs.filter(c => c.isCustom);
    localStorage.setItem(RPC_CONFIG_KEY, JSON.stringify(customConfigs));
  } catch (error) {
    console.error('Failed to delete RPC config:', error);
  }
}

/**
 * 获取指定链的RPC配置
 */
export function getRpcConfigsForChain(chainId: number): RpcConfig[] {
  return getRpcConfigs().filter(config => config.chainId === chainId);
}

/**
 * 获取指定链的默认RPC配置
 */
export function getDefaultRpcConfig(chainId: number): RpcConfig | null {
  const configs = getRpcConfigsForChain(chainId);
  return configs.find(config => config.isDefault) ?? configs[0] ?? null;
}

/**
 * 测试RPC连接
 */
export async function testRpcConnection(config: RpcConfig): Promise<RpcStatus> {
  const startTime = Date.now();

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(10000), // 10秒超时
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      return {
        chainId: config.chainId,
        url: config.url,
        status: 'error',
        error: `HTTP ${response.status}: ${response.statusText}`,
        lastChecked: new Date(),
      };
    }

    const data = await response.json();

    if (data.error) {
      return {
        chainId: config.chainId,
        url: config.url,
        status: 'error',
        error: data.error.message ?? 'RPC Error',
        lastChecked: new Date(),
      };
    }

    if (!data.result) {
      return {
        chainId: config.chainId,
        url: config.url,
        status: 'error',
        error: 'Invalid response format',
        lastChecked: new Date(),
      };
    }

    return {
      chainId: config.chainId,
      url: config.url,
      status: 'connected',
      latency,
      lastChecked: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      chainId: config.chainId,
      url: config.url,
      status: 'error',
      error: errorMessage,
      lastChecked: new Date(),
    };
  }
}

/**
 * 批量测试RPC连接
 */
export async function testMultipleRpcConnections(
  configs: RpcConfig[],
): Promise<Map<string, RpcStatus>> {
  const results = new Map<string, RpcStatus>();

  const promises = configs.map(async config => {
    const status = await testRpcConnection(config);
    const key = `${config.chainId}-${config.url}`;
    results.set(key, status);
  });

  await Promise.allSettled(promises);
  return results;
}
