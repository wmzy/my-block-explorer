// MCP tool registrations: the explorer's read surface, exposed to AI
// assistants. Every tool is READ-ONLY by design — mutating/admin routes
// (labels, watch, sql, event-range writes) stay on the browser surface.
//
// Honesty contracts carried over from the web UI (never weakened for the
// agent audience):
// - address transaction lists are heuristic discoveries — the `coverage`
//   field travels verbatim and is never presented as complete history;
// - events cover ONLY block ranges configured in the explorer — an empty
//   result says so instead of implying "no events ever happened";
// - integer quantities (wei, block numbers in raw RPC payloads) are
//   decimal STRINGS in JSON output (bigint-safe serialization).

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { Address } from 'viem';
import { getChainType, POPULAR_CHAINS, SUPPORTED_CHAINS } from '@/config/chains';
import { parseSlotNumber } from '@/utils/storageSlots';
import { coerceArgs, parseFunctionFragment } from './abi';
import type { BlockRef, BlockTag, ChainMeta, RpcReader } from './rpc';
import { McpApiError, McpBackendUnreachableError, type ExplorerApi } from './rest';

export type McpDeps = {
  api: ExplorerApi;
  rpc: RpcReader;
};

const read_only: ToolAnnotations = { readOnlyHint: true };

// -- serialization -----------------------------------------------------------

/**
 * BigInt-safe JSON: viem RPC payloads carry bigint quantities; MCP text
 * content is a string, so integers become decimal strings.
 */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner), 2) ?? 'null';
}

/** JSON-safe copy (bigints → strings) for structuredContent. */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(jsonText(value)) as unknown;
}

function ok(payload: unknown): CallToolResult {
  const safe = jsonSafe(payload);
  return {
    content: [{ type: 'text', text: jsonText(payload) }],
    // structuredContent must be a JSON object (no arrays/scalars).
    ...(safe !== null && typeof safe === 'object' && !Array.isArray(safe)
      ? { structuredContent: safe as Record<string, unknown> }
      : {}),
  };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// Thrown Errors are surfaced by the SDK as isError tool results with the
// error's message verbatim — McpBackendUnreachableError and McpApiError
// carry caller-ready wording (backend-down advice, HTTP status context),
// so no wrapper is needed here.

// -- schemas -----------------------------------------------------------------

const chainIdParam = z
  .number()
  .int()
  .describe('EVM chain id (e.g. 1 Ethereum, 137 Polygon) — call list_chains for known ids');
const addressParam = z.string().describe('Contract or account address (0x-hex)');

function refFrom(params: { blockNumber?: number; blockTag?: BlockTag }): BlockRef {
  if (params.blockNumber !== undefined) return { blockNumber: params.blockNumber };
  if (params.blockTag !== undefined) return { blockTag: params.blockTag };
  return { blockTag: 'latest' };
}

// -- registration ------------------------------------------------------------

export function registerExplorerTools(server: McpServer, deps: McpDeps): void {
  const { api, rpc } = deps;

  server.registerTool(
    'health',
    {
      description: 'Check the local explorer backend (version, admin-token/debug flags). RPC-only tools work without it; contract/event/search tools do not.',
      inputSchema: {},
      annotations: read_only,
    },
    async () => {
      const health = await api.get<Record<string, unknown>>('/api/health');
      return ok({ backend: health });
    },
  );

  server.registerTool(
    'list_chains',
    {
      description:
        'List chains this explorer can serve: the popular built-ins plus user-registered custom chains (from the backend). Any other built-in viem chain id also works.',
      inputSchema: {},
      annotations: read_only,
    },
    async () => {
      const customs = await api.tryGet<{ chains: Array<{ chainId: number; name: string; symbol: string }> }>(
        '/api/chains/custom',
      );
      return ok({
        popularChains: POPULAR_CHAINS.map(chain => ({
          chainId: chain.id,
          name: chain.name,
          symbol: chain.nativeCurrency.symbol,
          type: getChainType(chain.id),
        })),
        customChains: customs?.chains.map(({ chainId, name, symbol }) => ({ chainId, name, symbol })) ?? null,
        customChainsNote:
          customs === null ? 'backend unreachable — custom chains not loaded' : 'registered in this explorer only',
        builtInChainCount: SUPPORTED_CHAINS.length,
      });
    },
  );

  server.registerTool(
    'search',
    {
      description:
        'Search the explorer: address / tx hash / block number / ENS name (chainId recommended), or free text for locally known contracts, tokens and labels.',
      inputSchema: { q: z.string().min(1).describe('Search query'), chainId: chainIdParam.optional() },
      annotations: read_only,
    },
    async ({ q, chainId }) => {
      const result = await api.get<Record<string, unknown>>('/api/search', { q, chainId });
      return ok(result);
    },
  );

  server.registerTool(
    'get_block',
    {
      description:
        'Fetch a block by number, hash or tag from RPC. Integer quantities in the payload are decimal strings.',
      inputSchema: {
        chainId: chainIdParam,
        blockNumber: z.number().int().nonnegative().optional(),
        blockHash: z.string().startsWith('0x').optional(),
        blockTag: z.enum(['latest', 'earliest', 'pending', 'safe', 'finalized']).optional(),
        includeTransactions: z
          .boolean()
          .describe('Include full transaction objects instead of hashes (heavier)')
          .optional(),
      },
      annotations: read_only,
    },
    async ({ chainId, blockNumber, blockHash, blockTag, includeTransactions }) => {
      const meta = await rpc.chainMeta(chainId);
      const block = await rpc.getBlock(
        chainId,
        blockHash !== undefined
          ? { blockHash: blockHash as `0x${string}` }
          : blockNumber !== undefined
            ? { blockNumber }
            : { blockTag: blockTag ?? 'latest' },
        includeTransactions ?? false,
      );
      return ok({ chain: chainBrief(meta), block });
    },
  );

  server.registerTool(
    'get_transaction',
    {
      description:
        'Fetch a transaction and (when mined) its receipt by hash from RPC. Pending transactions return receipt: null.',
      inputSchema: { chainId: chainIdParam, hash: z.string().startsWith('0x').describe('Transaction hash') },
      annotations: read_only,
    },
    async ({ chainId, hash }) => {
      const meta = await rpc.chainMeta(chainId);
      const { transaction, receipt } = await rpc.getTransactionWithReceipt(chainId, hash as `0x${string}`);
      if (transaction === null) {
        return fail(
          `Transaction ${hash} not found on ${meta.name} (${chainId}). It may be pending, on another chain, or reorged out.`,
        );
      }
      return ok({ chain: chainBrief(meta), transaction, receipt });
    },
  );

  server.registerTool(
    'get_address_overview',
    {
      description:
        'Live account state from RPC: native balance (wei, decimal string), outgoing-tx nonce, and code classification (eoa / contract / eip-7702-delegated with its delegate).',
      inputSchema: { chainId: chainIdParam, address: addressParam },
      annotations: read_only,
    },
    async ({ chainId, address }) => {
      const { chain, balance, nonce, code } = await rpc.getAddressState(chainId, address as Address);
      const classification =
        code === '0x' ? 'eoa' : code.startsWith('0xef0100') ? 'eip-7702-delegated' : 'contract';
      return ok({
        chain: chainBrief(chain),
        address,
        balanceWei: balance,
        nonce,
        classification,
        ...(classification === 'eip-7702-delegated' ? { delegate: `0x${code.slice(8)}` as const } : {}),
        ...(classification === 'contract' ? { codeSizeBytes: (code.length - 2) / 2 } : {}),
      });
    },
  );

  server.registerTool(
    'get_contract',
    {
      description:
        'Verified contract metadata from the explorer cache: name, compiler, verification status/source, full ABI (parsed array), optional source code, proxy info, creation info.',
      inputSchema: {
        chainId: chainIdParam,
        address: addressParam,
        includeSource: z.boolean().describe('Include full Solidity source (default true)').optional(),
      },
      annotations: read_only,
    },
    async ({ chainId, address, includeSource }) => {
      type SourceRow = {
        chainId: number;
        chainName: string;
        address: string;
        contractSource: {
          name?: string;
          compilerVersion?: string;
          verificationStatus?: string;
          verificationSource?: string;
          sourceCode?: string;
          sourceFiles?: Array<{ name?: string; path?: string; content?: string }>;
          abi?: string;
          isProxy?: boolean;
          proxyType?: string;
          implementationAddress?: string;
          implementationAddresses?: string[];
          implementationContract?: { address?: string; name?: string; verificationStatus?: string; verificationSource?: string };
          creationTxHash?: string;
          creationBlockNumber?: number;
          creator?: string;
        } | null;
        code?: string;
        message?: string;
      };
      let row: SourceRow;
      try {
        row = await api.get<SourceRow>(`/api/chains/${chainId}/contracts/${address}/source`);
      } catch (error) {
        if (error instanceof McpApiError && error.code === 'not_a_contract') {
          return fail(
            `${address} has no deployed code on chain ${chainId} — an EOA (or a non-existent address), not a contract.`,
          );
        }
        throw error;
      }
      const source = row.contractSource;
      if (source === null) {
        return fail(`Backend returned no contract source for ${address} on chain ${chainId}.`);
      }
      let abi: unknown = source.abi;
      if (typeof source.abi === 'string' && source.abi !== '') {
        try {
          abi = JSON.parse(source.abi) as unknown;
        } catch {
          abi = source.abi;
        }
      }
      const wantSource = includeSource ?? true;
      return ok({
        chainId: row.chainId,
        chainName: row.chainName,
        address: row.address,
        name: source.name,
        compilerVersion: source.compilerVersion,
        verificationStatus: source.verificationStatus,
        verificationSource: source.verificationSource,
        abi,
        ...(wantSource
          ? {
              sourceCode: source.sourceCode,
              sourceFiles: source.sourceFiles?.map(file => ({
                name: file.name ?? file.path,
                content: file.content,
              })),
            }
          : { sourceOmitted: true }),
        isProxy: source.isProxy,
        proxyType: source.proxyType,
        implementationAddress: source.implementationAddress,
        implementationAddresses: source.implementationAddresses,
        implementation:
          source.implementationContract === undefined
            ? undefined
            : {
                address: source.implementationContract.address,
                name: source.implementationContract.name,
                verificationStatus: source.implementationContract.verificationStatus,
                verificationSource: source.implementationContract.verificationSource,
              },
        creationTxHash: source.creationTxHash,
        creationBlockNumber: source.creationBlockNumber,
        creator: source.creator,
      });
    },
  );

  server.registerTool(
    'read_contract',
    {
      description:
        'Call a view/pure contract function over RPC. Provide the human-readable signature (outputs needed for decoded results) and JSON args; integers may be numbers or decimal strings. For verified contracts, get_contract returns the full ABI to lift signatures from.',
      inputSchema: {
        chainId: chainIdParam,
        address: addressParam,
        signature: z
          .string()
          .describe('Solidity function signature, e.g. "function balanceOf(address account) view returns (uint256)"'),
        args: z.array(z.unknown()).describe('Positional arguments as JSON values').optional(),
        blockNumber: z.number().int().nonnegative().optional(),
        blockTag: z.enum(['latest', 'earliest', 'pending', 'safe', 'finalized']).optional(),
      },
      annotations: read_only,
    },
    async ({ chainId, address, signature, args, blockNumber, blockTag }) => {
      const meta = await rpc.chainMeta(chainId);
      const fragment = parseFunctionFragment(signature);
      if (fragment.stateMutability !== 'view' && fragment.stateMutability !== 'pure') {
        return fail(
          `${signature} is ${fragment.stateMutability} — only view/pure functions can be read. This tool is read-only by design.`,
        );
      }
      const coerced = coerceArgs(args ?? [], fragment);
      const result = await rpc.callReadonly(chainId, {
        to: address as Address,
        fragment,
        args: coerced,
        ref: refFrom({ blockNumber, blockTag }),
      });
      return ok({ chain: chainBrief(meta), address, function: fragment.name, result });
    },
  );

  server.registerTool(
    'get_events',
    {
      description:
        'Decoded contract events from the explorer\'s INDEXED ranges only (configure ranges in the web UI to grow coverage). Supports event name and block-range filters plus pagination.',
      inputSchema: {
        chainId: chainIdParam,
        address: addressParam,
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(1000).optional(),
        eventName: z.string().optional(),
        fromBlock: z.number().int().nonnegative().optional(),
        toBlock: z.number().int().nonnegative().optional(),
      },
      annotations: read_only,
    },
    async ({ chainId, address, page, pageSize, eventName, fromBlock, toBlock }) => {
      type EventsRow = {
        chainId: number;
        chainName: string;
        events: unknown[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
      const result = await api.get<EventsRow>(`/api/chains/${chainId}/contracts/${address}/events`, {
        page,
        pageSize,
        eventName,
        fromBlock,
        toBlock,
      });
      return ok({
        ...result,
        ...(result.total === 0
          ? {
              emptyNote:
                'Nothing indexed for these filters. Events cover ONLY block ranges configured in the explorer (web UI → contract Events tab); absence here is not proof the contract never emitted events.',
            }
          : {}),
      });
    },
  );

  server.registerTool(
    'get_indexing_status',
    {
      description:
        'Which block ranges are configured/indexed for a contract (statuses pending/indexing/paused/completed/error) plus event statistics — the coverage behind get_events.',
      inputSchema: { chainId: chainIdParam, address: addressParam },
      annotations: read_only,
    },
    async ({ chainId, address }) => {
      type RangesRow = { ranges: unknown[] };
      type StatsRow = { totalEvents?: number; uniqueEventTypes?: number };
      // Both open reads; each degrades independently (unreachable AND API
      // errors — e.g. statistics' 503 indexing_status_unavailable — carry an
      // honest per-section reason instead of failing the whole tool).
      const softGet = async <T>(path: string): Promise<{ data: T | null; error: string | null }> => {
        try {
          return { data: await api.get<T>(path), error: null };
        } catch (error) {
          return { data: null, error: error instanceof Error ? error.message : String(error) };
        }
      };
      const ranges = await softGet<RangesRow>(`/api/chains/${chainId}/contracts/${address}/events/ranges`);
      const stats = await softGet<StatsRow>(`/api/chains/${chainId}/contracts/${address}/events/statistics`);
      if (ranges.data === null && stats.data === null) {
        // Nothing served at all — surface the (unreachable-flavored) error.
        throw new McpBackendUnreachableError(api.base, new Error(ranges.error ?? stats.error ?? 'unreachable'));
      }
      return ok({
        chainId,
        address,
        ranges: ranges.data?.ranges ?? null,
        rangesError: ranges.error,
        statistics: stats.data ?? null,
        statisticsError: stats.error,
      });
    },
  );

  server.registerTool(
    'get_address_transactions',
    {
      description:
        'Discovered transactions for an address from the explorer\'s heuristic scan — NOT guaranteed complete history (check `coverage`; only a finished genesis-anchored deep scan reports "complete"). Supports from/to/min/max-value(wei)/method filters and pagination.',
      inputSchema: {
        chainId: chainIdParam,
        address: addressParam,
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(50).optional(),
        fromAddress: addressParam.optional(),
        toAddress: addressParam.optional(),
        minValue: z.string().regex(/^\d+$/).describe('Minimum value in wei (decimal string)').optional(),
        maxValue: z.string().regex(/^\d+$/).describe('Maximum value in wei (decimal string)').optional(),
        method: z.string().regex(/^0x[0-9a-fA-F]{8}$/).describe('4-byte function selector').optional(),
      },
      annotations: read_only,
    },
    async ({ chainId, address, ...filters }) => {
      type TxRow = Record<string, unknown>;
      const result = await api.get<TxRow>(`/api/chains/${chainId}/addresses/${address}/transactions`, filters);
      return ok(result);
    },
  );

  server.registerTool(
    'get_storage_at',
    {
      description: 'Read one raw storage slot of an account over RPC (latest state unless a block is given).',
      inputSchema: {
        chainId: chainIdParam,
        address: addressParam,
        slot: z.string().describe('Slot as decimal or 0x-hex (64-nibble zero-padded forms accepted)'),
        blockNumber: z.number().int().nonnegative().optional(),
        blockTag: z.enum(['latest', 'earliest', 'pending', 'safe', 'finalized']).optional(),
      },
      annotations: read_only,
    },
    async ({ chainId, address, slot, blockNumber, blockTag }) => {
      const meta = await rpc.chainMeta(chainId);
      let slotBigint: bigint;
      try {
        slotBigint = parseSlotNumber(slot);
      } catch (error) {
        return fail(`Invalid slot "${slot}": ${error instanceof Error ? error.message : String(error)}`);
      }
      const value = await rpc.getStorageAt(chainId, address as Address, slotBigint, refFrom({ blockNumber, blockTag }));
      return ok({ chain: chainBrief(meta), address, slot: slotBigint.toString(), value });
    },
  );
}

function chainBrief(meta: ChainMeta): { chainId: number; name: string; symbol: string; rpcSource: ChainMeta['rpcSource'] } {
  return { chainId: meta.chainId, name: meta.name, symbol: meta.symbol, rpcSource: meta.rpcSource };
}
