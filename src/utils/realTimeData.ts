import { createPublicClient, http, formatEther, type PublicClient } from 'viem';
import { getChainInfo } from '@/config/chains';
import { apiClient } from '@/api/client';

const clientCache = new Map<number, PublicClient>();
const customRpcUrls = new Map<number, string>();
let rpcConfigsLoaded = false;
let rpcConfigsPromise: Promise<void> | null = null;

type RpcConfigEntry = { chainId: number; url?: string | null };

const loadRpcConfigs = (): Promise<void> => {
  if (rpcConfigsLoaded) return Promise.resolve();
  if (rpcConfigsPromise) return rpcConfigsPromise;

  const baseUrl = apiClient.getBaseUrl();
  rpcConfigsPromise = fetch(`${baseUrl}/api/rpc-configs`)
    .then(res => (res.ok ? res.json() : { configs: [] }))
    .then((data: { configs?: RpcConfigEntry[] }) => {
      (data.configs ?? []).forEach(cfg => {
        if (cfg.url) customRpcUrls.set(cfg.chainId, cfg.url);
      });
      rpcConfigsLoaded = true;
    })
    .catch(() => {
      rpcConfigsLoaded = true;
    })
    .finally(() => {
      rpcConfigsPromise = null;
    });

  return rpcConfigsPromise;
};

/**
 * Notify that user RPC configs have changed so clients are recreated.
 */
export const invalidateRpcClients = (): void => {
  clientCache.clear();
  customRpcUrls.clear();
  rpcConfigsLoaded = false;
};

const buildClient = (chainId: number): PublicClient => {
  const chain = getChainInfo(chainId);
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const customUrl = customRpcUrls.get(chainId);
  const client = createPublicClient({
    chain,
    transport: http(customUrl ?? undefined),
  });
  clientCache.set(chainId, client);
  return client;
};

/**
 * Get or create a cached viem PublicClient for the given chain.
 * Awaits user RPC config loading on first call, then returns cached clients.
 */
export const createRpcClient = async (chainId: number): Promise<PublicClient> => {
  await loadRpcConfigs();

  const cached = clientCache.get(chainId);
  if (cached) return cached;

  return buildClient(chainId);
};

/**
 * 获取地址实时数据
 */
export const getRealTimeAddressData = async (chainId: number, address: string) => {
  const client = await createRpcClient(chainId);

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
  const client = await createRpcClient(chainId);
  return await client.getCode({ address: address as `0x${string}` });
};

/**
 * 批量获取多个地址的余额
 */
export const getBatchBalances = async (chainId: number, addresses: string[]) => {
  const client = await createRpcClient(chainId);

  const balances = await Promise.all(
    addresses.map(address => client.getBalance({ address: address as `0x${string}` })),
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
export const isContractAddress = async (chainId: number, address: string): Promise<boolean> => {
  const client = await createRpcClient(chainId);
  const code = await client.getCode({ address: address as `0x${string}` });
  return Boolean(code && code !== '0x' && code.length > 2);
};
