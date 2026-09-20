// RPC channel query hooks for the chain list/detail views (data-separation
// architecture: blocks and transactions are EPHEMERAL — they come straight
// from the RPC, not the backend cache). The backend /blocks and
// /transactions endpoints only serve indexed chains; mainnet rows are absent
// until an indexing run, so the list/detail views cannot consume them.
//
// Pagination is cursor-based, mirroring the old pages: page 1 fetches the
// head and returns latestBlockNumber; later pages resume from a cursor and
// caches are keyed by it, so the head entry stays warm while paging. Blocks
// stride by a plain block-number cursor; transactions use a composite
// (blockNumber * 1_000_000 + transactionIndex) cursor — a page collects
// strictly older positions and explicitly reports hasMore/nextCursor, so
// dense chains keep every transaction and sparse chains page past empty
// blocks (see getLatestTransactions in utils/blockRpcData).
import {
  hashArgs,
  useArgsStatus,
  useCache,
  useInjectable,
  useLoading,
  usePolling,
  useRefresh,
  useResultSelect,
  useRun,
  type CacheProvider,
} from 'react-toolroom/async';

import type { RpcBlock, RpcTransaction } from '@/utils/blockRpcData';
import {
  getBlockByNumber,
  getLatestBlocks,
  getLatestTransactions,
  getTransactionByHash,
} from '@/utils/blockRpcData';
import { DEFAULT_STALE_TIME } from '@/util/loaderCache';
import { parseBlockNumberParam } from '@/utils/chainParam';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';
import type { PolledQueryResult } from './polledQuery';

export type LatestBlocksPage = {
  blocks: RpcBlock[];
  latestBlockNumber: bigint;
};

export type LatestTransactionsPage = {
  transactions: RpcTransaction[];
  latestBlockNumber: bigint;
  /** false only when the walk consumed every block down to genesis. */
  hasMore: boolean;
  /** Continuation cursor for the next page; undefined when hasMore is false. */
  nextCursor: bigint | undefined;
};

// bigint is not a stable hash-args key across serializations; the cursor
// travels as a string and is coerced back at the RPC boundary.
async function fetchLatestBlocks(
  chainId: number,
  limit: number,
  beforeBlockStr?: string,
  signal?: AbortSignal,
): Promise<LatestBlocksPage | undefined> {
  if (!(chainId > 0) || limit <= 0) return undefined;
  const beforeBlock = beforeBlockStr !== undefined ? BigInt(beforeBlockStr) : undefined;
  void signal;
  return getLatestBlocks(chainId, limit, beforeBlock);
}

async function fetchLatestTransactions(
  chainId: number,
  limit: number,
  cursorStr?: string,
  signal?: AbortSignal,
): Promise<LatestTransactionsPage | undefined> {
  if (!(chainId > 0) || limit <= 0) return undefined;
  const cursor = cursorStr !== undefined ? BigInt(cursorStr) : undefined;
  void signal;
  return getLatestTransactions(chainId, limit, cursor);
}

async function fetchBlockByNumber(
  chainId: number,
  blockNumberStr: string,
  signal?: AbortSignal,
): Promise<RpcBlock | undefined> {
  void signal;
  // Decimal-only guard: Number() would accept "0x1a" (hex!) and silently
  // load block 26 — an invalid param resolves undefined without an RPC call.
  const parsed = parseBlockNumberParam(blockNumberStr);
  if (!(chainId > 0) || parsed === null) return undefined;
  return getBlockByNumber(chainId, BigInt(blockNumberStr));
}

async function fetchTransactionByHash(
  chainId: number,
  txHash: string,
  signal?: AbortSignal,
): Promise<RpcTransaction | undefined> {
  void signal;
  if (!(chainId > 0) || txHash.length === 0) return undefined;
  return getTransactionByHash(chainId, txHash);
}

const latestBlocksCache = createQueryCache<
  LatestBlocksPage | undefined,
  [number, number, string | undefined]
>('rpc-latest-blocks');

const latestTransactionsCache = createQueryCache<
  LatestTransactionsPage | undefined,
  [number, number, string | undefined]
>('rpc-latest-transactions');

const blockCache = createQueryCache<RpcBlock | undefined, [number, string]>('rpc-block');

const transactionCache = createQueryCache<RpcTransaction | undefined, [number, string]>(
  'rpc-transaction',
);

const useLatestBlocksQuery = createQueryHook({
  queryFn: bindQueryFn(fetchLatestBlocks, latestBlocksCache),
});

const useLatestTransactionsQuery = createQueryHook({
  queryFn: bindQueryFn(fetchLatestTransactions, latestTransactionsCache),
});

const useBlockQuery = createQueryHook({
  queryFn: bindQueryFn(fetchBlockByNumber, blockCache),
});

const queryTransactionByHash = bindQueryFn(fetchTransactionByHash, transactionCache);

// useResultSelect always applies select when a result exists; a module-level
// identity keeps the reference stable (same rationale as polledQuery).
const identity = <T>(r: T) => r;

// Poll cadence for a pending transaction (no receipt yet): catches a
// confirmation within ~one block of 12s chains.
const PENDING_TX_POLL_INTERVAL = 6_000;

// usePolling has no disabled state; the stopped cadence is expressed as the
// largest setInterval delay environments accept without clamping the timer
// down to 1 ms (~24.8 days). The timer exists but its tick effectively never
// fires, and swapping the interval re-arms it the moment status flips.
const POLL_DISABLED_INTERVAL = 2_147_483_000;

/** Latest blocks page; omit the cursor for the head page. */
export function useLatestBlocks(chainId: number, limit: number, beforeBlock?: bigint) {
  return useLatestBlocksQuery([
    chainId,
    limit,
    beforeBlock !== undefined ? beforeBlock.toString() : undefined,
  ]);
}

/** Latest transactions page; omit the cursor for the head page. */
export function useLatestTransactions(chainId: number, limit: number, cursor?: bigint) {
  return useLatestTransactionsQuery([
    chainId,
    limit,
    cursor !== undefined ? cursor.toString() : undefined,
  ]);
}

export function useBlockByNumber(chainId: number, blockNumberStr: string) {
  return useBlockQuery([chainId, blockNumberStr]);
}

// Transaction detail query with pending-only polling. One
// getTransactionByHash call already fetches the transaction AND its receipt
// (see utils/blockRpcData), so every tick re-checks both. The composition
// mirrors createPolledQueryHook rather than createQueryHook because a
// usePolling tick only reaches the stores this hook reads when the poller
// shares the same useInjectable instance as the useRun below (see the
// polledQuery.ts header). usePolling's react-toolroom default additionally
// skips ticks while the document is hidden, so a background tab stops
// hitting the RPC.
export function useTransactionByHash(
  chainId: number,
  txHash: string,
): PolledQueryResult<RpcTransaction | undefined> {
  // Same widening createQueryHook/polledQuery perform: the runtime call
  // signature is [...K, signal?] and the cache slot widens with it.
  const runArgs = [chainId, txHash] as unknown as [number, string, signal?: AbortSignal];
  const provider = transactionCache as unknown as CacheProvider<
    RpcTransaction | undefined,
    [number, string, signal?: AbortSignal]
  >;

  const injectable = useInjectable(queryTransactionByHash, {
    name: queryTransactionByHash.name || 'query',
  });
  const stale = useCache(injectable, provider, DEFAULT_STALE_TIME);
  const data = useResultSelect(injectable, identity);
  const fetching = useLoading(injectable);
  const status = useArgsStatus(injectable, runArgs);
  const loading = status.loading && status.data === undefined;

  useRun(injectable, runArgs, { signal: true, hash: hashArgs });

  // Poll ONLY while the transaction is pending (status -1 — no receipt
  // yet). A settled receipt (success or failed) swaps to the disabled
  // interval, which re-arms the timer to a never-firing tick.
  const pending = data?.status === -1;
  usePolling(injectable, pending ? PENDING_TX_POLL_INTERVAL : POLL_DISABLED_INTERVAL, {
    args: [chainId, txHash] as unknown as [number, string, signal?: AbortSignal],
  });

  const refetch = useRefresh(injectable, runArgs, provider);

  return {
    data,
    loading,
    fetching,
    error: status.error,
    failureCount: status.failureCount,
    stale,
    dataUpdatedAt: status.dataUpdatedAt,
    refetch,
  };
}
