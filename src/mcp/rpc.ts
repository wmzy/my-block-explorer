// RPC gateway for the MCP server: resolves a chainId to a viem public
// client, mirroring the browser's URL precedence (backend-stored user
// rpc-config first, then a user-registered custom chain's url, then the
// viem default) WITHOUT ever touching DuckDB — configs and custom chains
// are fetched from the open REST endpoints and cached briefly. When the
// backend is down, built-in chains still work over viem defaults (RPC
// reads need no backend); chain ids viem does not ship do not.
//
// All viem generic-heavy calls live behind this facade so the tool layer
// depends on a small structural interface (RpcReader) that tests can stub
// without a network.

import { createPublicClient, http, toHex, type Abi, type AbiFunction, type Address, type Chain, type PublicClient } from 'viem';
import { getBuiltInChainInfo } from '@/config/chains';
import { toViemChain, type CustomChain } from '@/config/customChains';
import type { ExplorerApi } from './rest';

export type BlockTag = 'latest' | 'earliest' | 'pending' | 'safe' | 'finalized';

export type BlockRef =
  | { blockNumber: number }
  | { blockTag: 'latest' | 'earliest' | 'pending' | 'safe' | 'finalized' };

/** Where the URL we are dialing came from — surfaced to tool callers. */
export type RpcSource = 'user-config' | 'custom-chain' | 'viem-default';

export type ChainMeta = {
  chainId: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  rpcSource: RpcSource;
};

/**
 * The structural seam the MCP tools consume. RpcGateway below is the real
 * implementation; unit tests provide plain-object stubs.
 */
export type RpcReader = {
  chainMeta(chainId: number): Promise<ChainMeta>;
  getBlock(
    chainId: number,
    ref: BlockRef | { blockHash: `0x${string}` },
    includeTransactions: boolean,
  ): Promise<unknown>;
  getTransactionWithReceipt(
    chainId: number,
    hash: `0x${string}`,
  ): Promise<{ transaction: unknown; receipt: unknown | null }>;
  getAddressState(
    chainId: number,
    address: Address,
  ): Promise<{ chain: ChainMeta; balance: bigint; nonce: number; code: `0x${string}` }>;
  getStorageAt(chainId: number, address: Address, slot: bigint, ref?: BlockRef): Promise<`0x${string}`>;
  callReadonly(
    chainId: number,
    params: { to: Address; fragment: AbiFunction; args: readonly unknown[]; ref?: BlockRef },
  ): Promise<unknown>;
};

type RemoteState = {
  at: number;
  /** chainId → user-configured RPC url (backend rpc_configs), unredacted. */
  configs: Map<number, string>;
  /** chainId → user-registered custom chain row. */
  customs: Map<number, CustomChain>;
};

/** Configs/custom chains change rarely; a short cache keeps tool calls off the REST hot path. */
const REMOTE_TTL_MS = 60_000;

type RpcConfigsResponse = {
  configs: Array<{ chainId: number; url: string | null; urlRedacted?: boolean }>;
};
type CustomChainsResponse = {
  chains: Array<{
    chainId: number;
    name: string;
    symbol: string;
    decimals?: number;
    rpcUrl: string;
    urlRedacted?: boolean;
  }>;
};

export class RpcGateway implements RpcReader {
  private remote: RemoteState | null = null;
  private loading: Promise<void> | null = null;
  private readonly clients = new Map<string, PublicClient>();

  constructor(
    private readonly api: ExplorerApi,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async refreshRemote(): Promise<void> {
    if (this.remote !== null && this.now() - this.remote.at < REMOTE_TTL_MS) return;
    // Single-flight: concurrent tool calls share one load.
    this.loading ??= (async () => {
      const [configs, customs] = await Promise.all([
        this.api.tryGet<RpcConfigsResponse>('/api/rpc-configs'),
        this.api.tryGet<CustomChainsResponse>('/api/chains/custom'),
      ]);
      const configMap = new Map<number, string>();
      for (const row of configs?.configs ?? []) {
        // Redacted entries are unusable (scheme+host only); skip rather
        // than dial a broken URL — same defense the frontend applies.
        if (row.url && row.urlRedacted !== true) configMap.set(row.chainId, row.url);
      }
      const customMap = new Map<number, CustomChain>();
      for (const row of customs?.chains ?? []) {
        if (row.urlRedacted !== true) {
          customMap.set(row.chainId, {
            chainId: row.chainId,
            name: row.name,
            symbol: row.symbol,
            decimals: row.decimals ?? 18,
            rpcUrl: row.rpcUrl,
          });
        }
      }
      this.remote = { at: this.now(), configs: configMap, customs: customMap };
      this.loading = null;
    })();
    await this.loading;
  }

  async chainMeta(chainId: number): Promise<ChainMeta> {
    await this.refreshRemote();
    const configured = this.remote?.configs.get(chainId);
    if (configured) {
      const builtin = getBuiltInChainInfo(chainId);
      return {
        chainId,
        name: builtin?.name ?? this.remote?.customs.get(chainId)?.name ?? `chain ${chainId}`,
        symbol: builtin?.nativeCurrency.symbol ?? this.remote?.customs.get(chainId)?.symbol ?? 'ETH',
        rpcUrl: configured,
        rpcSource: 'user-config',
      };
    }
    const custom = this.remote?.customs.get(chainId);
    if (custom) {
      return { chainId, name: custom.name, symbol: custom.symbol, rpcUrl: custom.rpcUrl, rpcSource: 'custom-chain' };
    }
    const builtin = getBuiltInChainInfo(chainId);
    if (builtin) {
      return {
        chainId,
        name: builtin.name,
        symbol: builtin.nativeCurrency.symbol,
        rpcUrl: builtin.rpcUrls.default.http[0],
        rpcSource: 'viem-default',
      };
    }
    throw new Error(
      `Unsupported chain id ${chainId} — viem does not ship it and no custom chain is registered${
        this.remote === null ? ' (backend unreachable; start it to load registered custom chains)' : ''
      }. Call list_chains for known ids.`,
    );
  }

  private async clientFor(chainId: number): Promise<{ client: PublicClient; chain?: Chain }> {
    const meta = await this.chainMeta(chainId);
    const cacheKey = `${chainId}:${meta.rpcUrl}`;
    const cached = this.clients.get(cacheKey);
    const chain = getBuiltInChainInfo(chainId) ?? chainFromCustom(this.remote?.customs.get(chainId));
    if (cached) return { client: cached, chain };
    const client = createPublicClient({
      // A Chain is optional for the actions used here; unknown ids with
      // only a user-config url still get a working transport.
      ...(chain ? { chain } : {}),
      transport: http(meta.rpcUrl),
    });
    this.clients.set(cacheKey, client);
    return { client, chain };
  }

  async getBlock(
    chainId: number,
    ref: BlockRef & { blockHash?: `0x${string}` },
    includeTransactions: boolean,
  ): Promise<unknown> {
    const { client } = await this.clientFor(chainId);
    const args =
      ref.blockHash !== undefined
        ? { blockHash: ref.blockHash, includeTransactions }
        : 'blockNumber' in ref
          ? { blockNumber: BigInt(ref.blockNumber), includeTransactions }
          : { tag: ref.blockTag, includeTransactions };
    return client.getBlock(args);
  }

  async getTransactionWithReceipt(
    chainId: number,
    hash: `0x${string}`,
  ): Promise<{ transaction: unknown; receipt: unknown | null }> {
    const { client } = await this.clientFor(chainId);
    const transaction = (await client.getTransaction({ hash })) as { blockNumber: bigint | null } | null;
    // Pending transactions have no receipt yet; that is a state, not an error.
    let receipt: unknown = null;
    if (transaction !== null && transaction.blockNumber !== null) {
      receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    }
    return { transaction, receipt };
  }

  async getAddressState(
    chainId: number,
    address: Address,
  ): Promise<{ chain: ChainMeta; balance: bigint; nonce: number; code: `0x${string}` }> {
    const { client } = await this.clientFor(chainId);
    const [chain, balance, nonce, code] = await Promise.all([
      this.chainMeta(chainId),
      client.getBalance({ address }),
      client.getTransactionCount({ address }),
      client.getCode({ address }),
    ]);
    // viem folds a successful '0x' getCode read into undefined on some
    // transports; '0x' is the EOA answer either way.
    return { chain, balance, nonce, code: code ?? '0x' };
  }

  async getStorageAt(chainId: number, address: Address, slot: bigint, ref?: BlockRef): Promise<`0x${string}`> {
    const { client } = await this.clientFor(chainId);
    const slotHex = toHex(slot);
    // GetStorageAtParameters is a discriminated union — each branch builds
    // one exact variant instead of spreading a loosely-typed block object.
    const value =
      ref === undefined
        ? await client.getStorageAt({ address, slot: slotHex })
        : 'blockNumber' in ref
          ? await client.getStorageAt({ address, slot: slotHex, blockNumber: BigInt(ref.blockNumber) })
          : await client.getStorageAt({ address, slot: slotHex, blockTag: ref.blockTag });
    if (value === undefined) {
      throw new Error(`RPC returned no storage value for slot ${slot} at ${address}`);
    }
    return value;
  }

  async callReadonly(
    chainId: number,
    params: { to: Address; fragment: AbiFunction; args: readonly unknown[]; ref?: BlockRef },
  ): Promise<unknown> {
    const { client } = await this.clientFor(chainId);
    const block: { blockNumber?: bigint; blockTag?: BlockTag } =
      params.ref === undefined
        ? {}
        : 'blockNumber' in params.ref
          ? { blockNumber: BigInt(params.ref.blockNumber) }
          : { blockTag: params.ref.blockTag };
    // Broad `Abi` (not the literal-inferred kind) is the repo's established
    // pattern for runtime-parsed fragments — see utils/contractInteraction.readContract.
    const abi = [params.fragment] as Abi;
    return client.readContract({
      address: params.to,
      abi,
      functionName: params.fragment.name,
      args: params.args,
      ...block,
    });
  }
}

function chainFromCustom(custom: CustomChain | undefined): Chain | undefined {
  return custom === undefined ? undefined : toViemChain(custom);
}
