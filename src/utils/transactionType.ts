// Transaction-type normalization — the ONE mapping between viem's
// tx-type labels (and their wire spellings) and the small integers stored
// in the DB and rendered everywhere.
//
// This is an import-free leaf ON PURPOSE: TransactionService (backend,
// inside the vite.config esbuild graph, which resolves no '@/' aliases)
// and utils/blockRpcData (browser-side, imports realTimeData) BOTH
// consume it. The 2026-11-10 dedup wave originally consolidated the two
// copies by having TransactionService import blockRpcData directly — that
// dragged realTimeData → config/chains → customChains → '@/util/http'
// into the vite.config bundle and broke `vite build` (the pinned
// browser-RPC-in-backend-graph lesson re-proven).

/**
 * Normalize a viem transaction type (or legacy persisted spelling) to the
 * numeric EIP-2718 type id. Unknown labels fall back to 0 (legacy).
 */
export function normalizeTransactionType(txType: unknown): number {
  if (typeof txType === 'number') return txType;
  if (txType === 'eip2930') return 1;
  if (txType === 'eip1559') return 2;
  if (txType === 'eip4844') return 3;
  if (txType === 'eip7702') return 4;
  if (txType === 'legacy' || txType === undefined || txType === null) return 0;
  const parsed = Number(txType);
  return Number.isFinite(parsed) ? parsed : 0;
}
