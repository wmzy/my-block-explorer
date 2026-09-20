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
// it as a trusted empty. `scannedAt` is the FIRST scan's time of the
// server-side ~60s cache entry (a cache hit does not reset it); optional
// because pre-scannedAt payloads stay renderable.
export type TokenTransferPage = {
  transfers: TokenTransfer[];
  nextCursor: string | null;
  coverage: 'complete' | 'partial';
  windowBlocks: number;
  scannedAt?: string;
};

// One-shot cache-bypass latch for the tab's explicit Retry/Refresh and
// "Search deeper": the NEXT fetch sends ?refresh=1 so the backend skips
// its 60s scan cache (even a not-yet-expired 'partial' entry) and
// overwrites it with the re-scan. Refresh is per-REQUEST semantics and
// deliberately NOT a hook argument: hook args are the cache identity
// below, so a refresh boolean riding them would either stick (re-scanning
// on every page turn) or reset (flashing the stale pre-refresh entry back
// in). refetch() already drops the frontend cache entry; the latch only
// needs to reach the wire.
let refreshNextFetch = false;

/** Arm ?refresh=1 for the next token-transfers fetch (consumed once). */
export function requestTokenTransfersRefresh(): void {
  refreshNextFetch = true;
}

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
  // backend default. `refresh` is the consumed one-shot latch above.
  const refresh = refreshNextFetch;
  refreshNextFetch = false;
  return get<TokenTransferPage>(
    `/api/chains/${chainId}/addresses/${address}/transfers`,
    { cursor, limit, window, refresh: refresh ? '1' : undefined },
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
