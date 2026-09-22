import { createPublicClient, http, formatUnits, type PublicClient } from 'viem';
import { getChainInfo } from '@/config/chains';
import { get } from '@/util/http';

// Native-currency display decimals of a chain. formatEther would hardcode
// 18 and silently misrender balances on chains whose native unit uses
// other decimals (e.g. Nautilus ZBC's 9).
const nativeDecimals = (chainId: number): number =>
  getChainInfo(chainId)?.nativeCurrency.decimals ?? 18;

const clientCache = new Map<number, PublicClient>();
const customRpcUrls = new Map<number, string>();
let rpcConfigsLoaded = false;
let rpcConfigsPromise: Promise<void> | null = null;

type RpcConfigEntry = { chainId: number; url?: string | null; urlRedacted?: boolean };

const loadRpcConfigs = (): Promise<void> => {
  if (rpcConfigsLoaded) return Promise.resolve();
  if (rpcConfigsPromise) return rpcConfigsPromise;

  rpcConfigsPromise = get<{ configs?: RpcConfigEntry[] }>('/api/rpc-configs')
    .then(data => {
      (data.configs ?? []).forEach(cfg => {
        // A redacted URL ('https://host/…') is uncallable — setting it
        // would poison the client. Only trust full URLs.
        if (cfg.url && cfg.urlRedacted !== true) customRpcUrls.set(cfg.chainId, cfg.url);
      });
      rpcConfigsLoaded = true;
    })
    .catch((reason: unknown) => {
      // Keep the default-RPC fallback, but surface why: otherwise a
      // server-side rejection (e.g. 403) silently forks this frontend's
      // RPC set from the server's and looks like random slowness.
      const message = reason instanceof Error ? reason.message : String(reason);
      const status = typeof (reason as { status?: unknown } | null)?.status === 'number'
        ? (reason as { status: number }).status
        : undefined;
      console.warn(
        `Custom RPC configs unavailable${status ? ` (HTTP ${status})` : ''}: ${message}. Falling back to default RPC endpoints.`,
      );
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

// Custom-chain registrations must serve THEIR rpcUrl: viem ships a
// placeholder default for dev-chain ids (anvil 31337 → 127.0.0.1:8545)
// that would silently shadow a real registration on another port.
// Redacted URLs are skipped — they are uncallable. The runtime registry
// (name/symbol) is filled by services/customChains; this wires the RPC
// layer only. Idempotent; called whenever the chain list is (re)fetched.
export const absorbCustomChainRpcUrls = (
  chains: ReadonlyArray<{
    chainId: number;
    rpcUrl?: string | null;
    urlRedacted?: boolean | null;
  }>,
): void => {
  for (const chain of chains) {
    if (chain.rpcUrl && chain.urlRedacted !== true) {
      customRpcUrls.set(chain.chainId, chain.rpcUrl);
    }
  }
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

  // Custom-chain registrations (anvil/hardhat/private chains) load once
  // per session BEFORE the first client build: a viem-shadowed id (anvil
  // 31337 has a placeholder default RPC) must serve the registered URL,
  // and no view-level gate runs for such ids. Dynamic import — the
  // service statically imports this module (invalidateRpcClients).
  await import('@/services/customChains').then(m => m.ensureCustomChainsLoaded());

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
    balance: formatUnits(balance, nativeDecimals(chainId)),
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
    balance: formatUnits(balances[index], nativeDecimals(chainId)),
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
