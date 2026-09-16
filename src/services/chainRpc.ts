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
import type { RpcBlock, RpcTransaction } from '@/utils/blockRpcData';
import {
  getBlockByNumber,
  getLatestBlocks,
  getLatestTransactions,
  getTransactionByHash,
} from '@/utils/blockRpcData';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

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
  const parsed = Number(blockNumberStr);
  if (!(chainId > 0) || !Number.isFinite(parsed) || parsed < 0) return undefined;
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

const latestBlocksCache = createQueryCache<LatestBlocksPage | undefined, [
  number,
  number,
  string | undefined,
]>('rpc-latest-blocks');

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

const useTransactionQuery = createQueryHook({
  queryFn: bindQueryFn(fetchTransactionByHash, transactionCache),
});

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

export function useTransactionByHash(chainId: number, txHash: string) {
  return useTransactionQuery([chainId, txHash]);
}
