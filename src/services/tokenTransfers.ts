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

// Which eth_getLogs filter shape the backend scan uses: 'participant'
// (the viewed address as Transfer from/to) or 'token' (the viewed
// contract as the log emitter — its own transfers). Mirrors the backend
// enum; the string rides the query string and the cache key unchanged.
export type TransferScanMode = 'participant' | 'token';

// One decoded Transfer/TransferSingle log, deduped server-side
// (self-transfers appear once, direction 'out'). Direction is relative
// to the viewed address; token-mode rows additionally carry 'none' (the
// viewed token emitted the log without being sender or recipient —
// mints, burns, user-to-user transfers of the token).
export type TokenTransfer = {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  token: string;
  standard: TokenTransferStandard;
  // Log-shape evidence from the backend row mapping (topic0 whitelist +
  // indexed-topic count — see utils/tokenTransferDecode
  // .transferStandardFromTopics): 'erc20'/'erc721' split the shared
  // Transfer selector by topic count, 'erc1155' covers single+batch.
  // Distinct from `standard` on purpose: the event-family enum stays
  // metadata-disambiguated for display while this field carries what the
  // log alone proves (the transfers-tab filter chips consume it).
  // Optional: pre-logStandard payloads stay renderable; under an active
  // filter, undefined rows are honestly hidden, never guessed into a
  // bucket.
  logStandard?: 'erc20' | 'erc721' | 'erc1155';
  from: string;
  to: string;
  value: string;
  tokenIds?: string[];
  amounts?: string[];
  direction: 'in' | 'out' | 'none';
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
  // Which filter shape produced these rows (token vs participant). The
  // view refuses a settle whose mode differs from the currently selected
  // one — the query layer's store keeps the previous settle across an
  // args switch, and a mode switch must not flash the other list's rows.
  // Optional: pre-mode payloads (stale caches, older backends) stay
  // renderable and are trusted as-is.
  mode?: TransferScanMode;
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
  mode: TransferScanMode = 'participant',
  signal?: AbortSignal,
): Promise<TokenTransferPage | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  // Deliberately long-running: the server scans eth_getLogs under its own
  // ~30s budget — the default 10s per-attempt timeout would abort
  // healthy scans. `window` widens the scanned block range; omitted →
  // backend default. `mode` picks the getLogs filter shape (token vs
  // participant); omitted → participant. `refresh` is the consumed
  // one-shot latch above.
  const refresh = refreshNextFetch;
  refreshNextFetch = false;
  return get<TokenTransferPage>(
    `/api/chains/${chainId}/addresses/${address}/transfers`,
    { cursor, limit, window, mode: mode === 'token' ? 'token' : undefined, refresh: refresh ? '1' : undefined },
    withSignal(longRunningApi, signal),
  );
}

// The cursor/limit/window/mode ride in the cache key: a different page, a
// widened window or the other scan mode must resolve to a fresh entry,
// never a stale one.
export const tokenTransfersCache = createQueryCache<
  TokenTransferPage | undefined,
  [number, string, string, number, number | undefined, TransferScanMode]
>('token-transfers');

const queryTokenTransfers = bindQueryFn(fetchTokenTransfers, tokenTransfersCache);

const useTokenTransfersQuery = createQueryHook({ queryFn: queryTokenTransfers });

export function useTokenTransfers(
  chainId: number,
  address: string,
  cursor: string,
  limit: number,
  window?: number,
  mode: TransferScanMode = 'participant',
) {
  return useTokenTransfersQuery([chainId, address, cursor, limit, window, mode]);
}
