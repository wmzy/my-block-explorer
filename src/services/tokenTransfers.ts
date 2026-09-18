// Token-transfers service: the address-level eth_getLogs scan surface.
// Stateless on-demand aggregation (no indexer behind it) — the honesty
// fields below are the contract the view renders.
import { get, longRunningApi, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// Ambiguity is honest here: the Transfer log signature is shared by
// ERC-20 and ERC-721; decimals() disambiguates on the frontend (metadata
// reads are RPC territory, never the backend's).
export type TokenTransferStandard =
  | 'erc20-or-erc721'
  | 'erc1155-single'
  | 'erc1155-batch';

// One decoded Transfer/TransferSingle log, deduped server-side
// (self-transfers appear once, direction 'out').
export type TokenTransfer = {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  token: string;
  standard: TokenTransferStandard;
  from: string;
  to: string;
  value: string;
  tokenIds?: string[];
  amounts?: string[];
  direction: 'in' | 'out';
};

// Response envelope of GET /api/chains/:chainId/addresses/:address/transfers.
// Contract: rows sorted desc by (blockNumber, logIndex); `cursor` and
// `nextCursor` are base-10 decimal offsets into the server-cached full
// list ('0' = first page; nextCursor null at the end); coverage 'partial'
// means the scan budget ran out before covering windowBlocks — never read
// it as a trusted empty.
export type TokenTransferPage = {
  transfers: TokenTransfer[];
  nextCursor: string | null;
  coverage: 'complete' | 'partial';
  windowBlocks: number;
};

export function fetchTokenTransfers(
  chainId: number,
  address: string,
  cursor: string,
  limit: number,
  window?: number,
  signal?: AbortSignal,
): Promise<TokenTransferPage | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  // Deliberately long-running: the server scans eth_getLogs under its own
  // ~30s budget — the default 10s per-attempt timeout would abort
  // healthy scans. `window` widens the scanned block range; omitted →
  // backend default.
  return get<TokenTransferPage>(
    `/api/chains/${chainId}/addresses/${address}/transfers`,
    { cursor, limit, window },
    withSignal(longRunningApi, signal),
  );
}

// The cursor/limit/window ride in the cache key: a different page or a
// widened window must resolve to a fresh entry, never a stale one.
export const tokenTransfersCache = createQueryCache<
  TokenTransferPage | undefined,
  [number, string, string, number, number | undefined]
>('token-transfers');

const queryTokenTransfers = bindQueryFn(fetchTokenTransfers, tokenTransfersCache);

const useTokenTransfersQuery = createQueryHook({ queryFn: queryTokenTransfers });

export function useTokenTransfers(
  chainId: number,
  address: string,
  cursor: string,
  limit: number,
  window?: number,
) {
  return useTokenTransfersQuery([chainId, address, cursor, limit, window]);
}
