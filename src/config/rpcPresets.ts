// 预设的RPC节点配置
export type RpcPreset = {
  name: string;
  url: string;
  description?: string;
  provider: string;
};

export const RPC_PRESETS: Record<number, RpcPreset[]> = {
  // Ethereum Mainnet
  1: [
    {
      name: "Infura",
      url: "https://mainnet.infura.io/v3/YOUR_PROJECT_ID",
      description: "需要替换YOUR_PROJECT_ID",
      provider: "Infura",
    },
    {
      name: "Alchemy",
      url: "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
      description: "需要替换YOUR_API_KEY",
      provider: "Alchemy",
    },
    {
      name: "QuickNode",
      url: "https://YOUR_ENDPOINT.quiknode.pro/YOUR_API_KEY/",
      description: "需要替换端点信息",
      provider: "QuickNode",
    },
  ],

  // Polygon
  137: [
    {
      name: "Polygon RPC",
      url: "https://polygon-rpc.com",
      description: "官方公共节点",
      provider: "Polygon",
    },
    {
      name: "Alchemy Polygon",
      url: "https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
      description: "需要替换YOUR_API_KEY",
      provider: "Alchemy",
    },
    {
      name: "Infura Polygon",
      url: "https://polygon-mainnet.infura.io/v3/YOUR_PROJECT_ID",
      description: "需要替换YOUR_PROJECT_ID",
      provider: "Infura",
    },
  ],

  // BSC
  56: [
    {
      name: "BSC RPC",
      url: "https://bsc-dataseed1.binance.org",
      description: "官方公共节点",
      provider: "Binance",
    },
    {
      name: "BSC RPC 2",
      url: "https://bsc-dataseed2.binance.org",
      description: "官方公共节点备用",
      provider: "Binance",
    },
    {
      name: "NodeReal",
      url: "https://bsc-mainnet.nodereal.io/v1/YOUR_API_KEY",
      description: "需要替换YOUR_API_KEY",
      provider: "NodeReal",
    },
  ],

  // Arbitrum One
  42161: [
    {
      name: "Arbitrum RPC",
      url: "https://arb1.arbitrum.io/rpc",
      description: "官方公共节点",
      provider: "Arbitrum",
    },
    {
      name: "Alchemy Arbitrum",
      url: "https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
      description: "需要替换YOUR_API_KEY",
      provider: "Alchemy",
    },
  ],

  // Optimism
  10: [
    {
      name: "Optimism RPC",
      url: "https://mainnet.optimism.io",
      description: "官方公共节点",
      provider: "Optimism",
    },
    {
      name: "Alchemy Optimism",
      url: "https://opt-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
      description: "需要替换YOUR_API_KEY",
      provider: "Alchemy",
    },
  ],

  // Mantle
  5000: [
    {
      name: "Mantle RPC",
      url: "https://rpc.mantle.xyz",
      description: "官方公共节点（默认）",
      provider: "Mantle",
    },
    {
      name: "Mantle RPC 备用",
      url: "https://mantle.publicnode.com",
      description: "公共节点备用",
      provider: "PublicNode",
    },
  ],
};

export function getRpcPresets(chainId: number): RpcPreset[] {
  return RPC_PRESETS[chainId] || [];
}

export function hasRpcPresets(chainId: number): boolean {
  return chainId in RPC_PRESETS && RPC_PRESETS[chainId].length > 0;
}
