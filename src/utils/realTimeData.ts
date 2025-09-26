import { createPublicClient, http, formatEther } from "viem";
import { mainnet, polygon, arbitrum, optimism } from "viem/chains";

// 链配置映射
const chainMap = {
  1: mainnet,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  // 添加更多链...
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
      default: { name: "Explorer", url: "https://explorer.mantle.xyz" },
    },
  },
} as const;

/**
 * 创建RPC客户端
 */
export const createRpcClient = (chainId: number) => {
  const chain = chainMap[chainId as keyof typeof chainMap];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  return createPublicClient({
    chain,
    transport: http(),
  });
};

/**
 * 获取地址实时数据
 */
export const getRealTimeAddressData = async (
  chainId: number,
  address: string
) => {
  const client = createRpcClient(chainId);

  const [balance, txCount, latestBlock] = await Promise.all([
    client.getBalance({ address: address as `0x${string}` }),
    client.getTransactionCount({ address: address as `0x${string}` }),
    client.getBlockNumber(),
  ]);

  return {
    balance: formatEther(balance),
    balanceWei: balance.toString(),
    transactionCount: txCount,
    latestBlock: Number(latestBlock),
  };
};

/**
 * 获取合约代码（如果需要）
 */
export const getContractCode = async (chainId: number, address: string) => {
  const client = createRpcClient(chainId);
  return await client.getCode({ address: address as `0x${string}` });
};

/**
 * 批量获取多个地址的余额
 */
export const getBatchBalances = async (
  chainId: number,
  addresses: string[]
) => {
  const client = createRpcClient(chainId);

  const balances = await Promise.all(
    addresses.map((address) =>
      client.getBalance({ address: address as `0x${string}` })
    )
  );

  return addresses.map((address, index) => ({
    address,
    balance: formatEther(balances[index]),
    balanceWei: balances[index].toString(),
  }));
};

/**
 * 检查地址是否为合约
 */
export const isContractAddress = async (
  chainId: number,
  address: string
): Promise<boolean> => {
  const client = createRpcClient(chainId);
  const code = await client.getCode({ address: address as `0x${string}` });
  return Boolean(code && code !== "0x" && code.length > 2);
};
