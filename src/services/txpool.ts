// Transaction-pool service: the pending/queued mempool feed behind the
// Mempool view.
//
// Everything here is ephemeral node data (the node's own tx pool), so the
// browser fetches it directly through the shared viem client — no backend
// caching, per the project's data-separation rule — polled every 5 seconds
// while the view is mounted.
//
// Honesty rules this module encodes:
// - txpool_content is a Geth-family extension most remote providers refuse
//   to expose; that refusal settles as an explicit "unsupported" state with
//   a UI-ready message, never as a thrown error or a fabricated empty pool.
// - Geth omits the pending/queued maps entirely when a side is empty;
//   absent maps read as zero, not as a failure. A payload that is not an
//   object at all is a failure (a 200-with-garbage), not an empty pool.
// - Every quantity is bigint-exact from the node's hex strings; a missing
//   or unparseable optional field (gasPrice, maxFeePerGas) stays undefined
//   — never a fabricated 0. An entry whose identity (hash, from) or a
//   required display quantity (value, nonce) is unusable is skipped, with
//   its siblings kept.
// - The listing is sorted deterministically (account asc case-insensitively,
//   then account nonce asc) and capped for display; pendingCount keeps the
//   true size and `truncated` says whether the cap bit. queuedCount is
//   never capped — it is a count, not a listing.
// - txpool payloads carry no timestamps; nothing here invents one.
import { createRpcClient } from '@/utils/realTimeData';
import { bindQueryFn, createQueryCache } from '@/util/useQuery';
import { createPolledQueryHook, type PolledQueryResult } from './polledQuery';

// Display cap for the pending listing. A busy node's pool holds thousands
// of txs; the view renders the head of the deterministic order and says so
// via `truncated`, while pendingCount keeps the honest total.
export const TXPOOL_DISPLAY_CAP = 200;

// The mempool turns over continuously; a 5s cadence keeps the feed current
// without hammering the node. (The factory's staleTime default — 2s —
// stays below this, so ticks are never swallowed by a fresh cache entry.)
const TXPOOL_INTERVAL = 5_000;

/** One pending transaction, flattened out of the account→nonce maps. */
export type PoolEntry = {
  hash: string;
  from: string;
  /** null = contract creation (Geth sends to: null verbatim). */
  to: string | null;
  value: bigint;
  /** Legacy gas price; undefined when the tx did not report one. */
  gasPrice?: bigint;
  /** EIP-1559 fee cap; undefined for legacy txs. */
  maxFeePerGas?: bigint;
  nonce: number;
  /** Outer map key the tx sits under (the pending account). */
  account: string;
  /** Inner map key parsed as decimal (the account's next nonce). */
  accountNonce: number;
};

// Every variant carries the chain it was fetched for: the query layer's
// result store keeps the last settle across an args switch, so the view
// needs the chainId to refuse another chain's data (no cross-chain flash).
// Non-ok messages are static — raw provider text never reaches the UI.
export type TxPoolResult =
  | {
    status: 'ok';
    chainId: number;
    pending: PoolEntry[];
    pendingCount: number;
    queuedCount: number;
    truncated: boolean;
  }
  | { status: 'unsupported'; chainId: number; message: string }
  | { status: 'failed'; chainId: number; message: string };

/** The ok-state pieces a raw payload boils down to. */
export type PoolSnapshot = {
  pending: PoolEntry[];
  pendingCount: number;
  queuedCount: number;
  truncated: boolean;
};

// --- pure helpers ---

/** Record<string, unknown> or null — arrays are not tx maps. */
const asRecord = (raw: unknown): Record<string, unknown> | null =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;

/** Non-empty string → itself, anything else → null (honest absence). */
const nonEmptyString = (raw: unknown): string | null =>
  typeof raw === 'string' && raw !== '' ? raw : null;

/**
 * Hex quantity ("0x…"), decimal string, or JSON number → exact bigint.
 * Unparseable or negative values are nonsense here and read as null
 * (absent), never 0. Same contract as parseQuantity in utils/traceFormat.
 */
const parseQuantity = (raw: unknown): bigint | null => {
  if (typeof raw === 'bigint') return raw >= 0n ? raw : null;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 ? BigInt(raw) : null;
  }
  if (typeof raw === 'string' && raw !== '') {
    try {
      const value = BigInt(raw);
      return value >= 0n ? value : null;
    } catch {
      return null;
    }
  }
  return null;
};

/** Inner map key ("42") → decimal number; non-decimal keys are not nonces. */
const parseNonceKey = (key: string): number | null => {
  if (!/^\d+$/.test(key)) return null;
  const value = Number(key);
  return Number.isSafeInteger(value) ? value : null;
};

/**
 * Flatten one raw tx into a PoolEntry. Null when the entry is unusable:
 * identity (hash, from) or a required display quantity (value, nonce) is
 * missing/unparseable, or the inner map key was not a decimal nonce — a
 * fabricated 0 or an invented nonce would lie.
 */
const normalizeEntry = (
  raw: unknown,
  account: string,
  accountNonce: number | null,
): PoolEntry | null => {
  const tx = asRecord(raw);
  if (!tx || accountNonce === null) return null;
  const hash = nonEmptyString(tx.hash);
  const from = nonEmptyString(tx.from);
  if (!hash || !from) return null;
  const value = parseQuantity(tx.value);
  const nonce = parseQuantity(tx.nonce);
  if (value === null || nonce === null) return null;
  const nonceNumber = Number(nonce);
  if (!Number.isSafeInteger(nonceNumber)) return null;
  const entry: PoolEntry = {
    hash,
    from,
    // null = contract creation; an unreported/empty to reads the same.
    to: nonEmptyString(tx.to),
    value,
    nonce: nonceNumber,
    account,
    accountNonce,
  };
  const gasPrice = parseQuantity(tx.gasPrice);
  if (gasPrice !== null) entry.gasPrice = gasPrice;
  const maxFeePerGas = parseQuantity(tx.maxFeePerGas);
  if (maxFeePerGas !== null) entry.maxFeePerGas = maxFeePerGas;
  return entry;
};

/**
 * Assemble the view's data model from a raw txpool_content payload. Pure
 * and total: absent maps (Geth omits them on empty pools) and non-map
 * shapes degrade to zero counts, individual malformed entries are skipped,
 * and the order is fully determined — account asc case-insensitively (raw
 * string as the case tiebreak), then account nonce asc — so a re-fetch of
 * an unchanged pool cannot reshuffle the listing.
 */
export function buildPoolSnapshot(raw: unknown): PoolSnapshot {
  const root = asRecord(raw);
  const pendingEntries: PoolEntry[] = [];
  let queuedCount = 0;

  const pendingMap = asRecord(root?.pending);
  if (pendingMap) {
    for (const [account, byNonce] of Object.entries(pendingMap)) {
      const inner = asRecord(byNonce);
      if (!inner) continue;
      for (const [nonceKey, txRaw] of Object.entries(inner)) {
        const entry = normalizeEntry(txRaw, account, parseNonceKey(nonceKey));
        if (entry) pendingEntries.push(entry);
      }
    }
  }

  // The queued side is only counted (the view lists pending); entries pass
  // the same identity rule so garbage cannot inflate the count.
  const queuedMap = asRecord(root?.queued);
  if (queuedMap) {
    for (const byNonce of Object.values(queuedMap)) {
      const inner = asRecord(byNonce);
      if (!inner) continue;
      for (const txRaw of Object.values(inner)) {
        const tx = asRecord(txRaw);
        if (tx && nonEmptyString(tx.hash) && nonEmptyString(tx.from)) {
          queuedCount += 1;
        }
      }
    }
  }

  pendingEntries.sort((a, b) => {
    const lowerA = a.account.toLowerCase();
    const lowerB = b.account.toLowerCase();
    if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
    if (a.account !== b.account) return a.account < b.account ? -1 : 1;
    return a.accountNonce - b.accountNonce;
  });

  const pendingCount = pendingEntries.length;
  return {
    pending: pendingEntries.slice(0, TXPOOL_DISPLAY_CAP),
    pendingCount,
    queuedCount,
    truncated: pendingCount > TXPOOL_DISPLAY_CAP,
  };
}

// --- failure classification ---

// The info-state message the view shows verbatim for unsupported nodes.
const TXPOOL_UNSUPPORTED_MESSAGE =
  'This RPC does not expose the transaction pool (txpool_* is not supported)';

// Collects the error's whole cause chain plus JSON-RPC codes: viem wraps
// provider errors several layers deep, and proxies re-encode them, so
// "method not found" can live in any hop (or only as code -32601). Same
// walk as utils/traceFormat.
const errorChainText = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let hop = 0; hop < 8 && typeof current === 'object' && current !== null; hop += 1) {
    const record = current as Record<string, unknown>;
    if (typeof record.message === 'string') parts.push(record.message);
    if (record.code !== undefined) parts.push(String(record.code));
    current = record.cause;
  }
  return parts.join('\n');
};

// "Method not found" and its provider phrasings. Bare "not found" is
// deliberately excluded — a missing something-else is a different
// (retryable) failure, not evidence the pool is unsupported.
const TXPOOL_UNSUPPORTED_PATTERN =
  /(method[^\n]*not[^\n]*(found|exist|available|support))|not[^\n]*supported|does not exist|unimplemented/i;

/**
 * Did the txpool_content request fail because the endpoint does not
 * implement the txpool_* namespace? Drives the honest "not supported by
 * this RPC" info state instead of a fetch-error card.
 */
export function isTxPoolUnsupportedError(error: unknown): boolean {
  // Bare string rejections (no Error wrapper) still classify by text.
  const text = typeof error === 'string' ? error : errorChainText(error);
  return TXPOOL_UNSUPPORTED_PATTERN.test(text) || text.includes('-32601');
}

// --- fetch + hook ---

// A node that never answers txpool_content (some providers black-hole the
// namespace instead of rejecting it) must not hold the page in a
// first-load skeleton forever: race the request against a fixed budget
// and settle the honest failed state with Retry.
const TXPOOL_REQUEST_BUDGET_MS = 8_000;

function withRequestBudget<T>(request: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('txpool_content did not answer within the request budget')),
      TXPOOL_REQUEST_BUDGET_MS,
    );
    request.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Fetch the node's transaction pool over the shared browser RPC client.
 * Never throws: failures (including createRpcClient itself rejecting for
 * unknown chains) settle as an explicit state — unsupported when the node
 * refuses the txpool_* namespace, failed otherwise, with a static message.
 */
export async function fetchPendingTransactions(chainId: number): Promise<TxPoolResult> {
  // Same invalid-arg guard the other RPC services use: a non-positive or
  // non-finite id resolves without touching an endpoint.
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return { status: 'failed', chainId, message: 'Unknown chain' };
  }
  try {
    const client = await createRpcClient(chainId);
    // txpool_content is outside viem's typed RPC schema; the structural
    // request cast is the repo's established route around it (same as
    // CallTrace's debug_traceTransaction call). The budget race covers
    // providers that accept the POST but never answer it.
    const raw = await withRequestBudget(
      (
        client as unknown as {
          request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
        }
      ).request({ method: 'txpool_content', params: [] }),
    );
    // A 200 whose body is not a txpool object is a failure, not an empty
    // pool: Geth omits maps when a side is empty but always answers with
    // an object.
    if (!asRecord(raw)) {
      return {
        status: 'failed',
        chainId,
        message: 'txpool_content returned an unexpected shape',
      };
    }
    return { status: 'ok', chainId, ...buildPoolSnapshot(raw) };
  } catch (error) {
    if (isTxPoolUnsupportedError(error)) {
      return { status: 'unsupported', chainId, message: TXPOOL_UNSUPPORTED_MESSAGE };
    }
    return { status: 'failed', chainId, message: 'Failed to fetch the transaction pool' };
  }
}

export const txpoolCache = createQueryCache<TxPoolResult, [number]>('txpool');

const queryTxPool = bindQueryFn(fetchPendingTransactions, txpoolCache);

const useTxPoolQuery = createPolledQueryHook({
  queryFn: queryTxPool,
  interval: TXPOOL_INTERVAL,
});

/**
 * Polled mempool snapshot for a chain (5s cadence, hidden-tab ticks skipped
 * per the polledQuery factory defaults). Chain switches land on a fresh
 * cache key, so the view resets to its first-load state instead of showing
 * the previous chain's pool.
 */
export function usePendingTransactions(chainId: number): PolledQueryResult<TxPoolResult> {
  return useTxPoolQuery([chainId]);
}
