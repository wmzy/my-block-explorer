// Block-level internal-transaction derivation: the pure half of the
// Block Detail page's "Internal Transactions (traced)" card — an
// on-demand callTracer sweep over a block's transactions (Blockscout
// parity at this product's honesty bar: a bounded on-demand sample, never
// indexer data). The RPC I/O lives in the view component
// (views/Blocks/InternalTxnsSection.tsx); this module mirrors the
// utils/internalTxScan split so every derivation is testable without RPC.
//
// It reuses the address tab's tracing convention instead of inventing a
// second one: the same per-tx walk bounds (utils/internalTxScan), the
// same honest-absence rules (utils/traceFormat — null stays null, never a
// fabricated 0). The block-level differences:
// - the block page has no subject address, so EVERY frame below the
//   top-level call is a row (the address tab's value/address filter is a
//   per-address noise control, not part of the data definition);
// - rows keep the frame's selector and error text (the per-tx tables
//   render them);
// - grouping is per parent transaction — the card renders one table per
//   tx, under a link to that tx.

import {
  MAX_INTERNAL_TRACE_DEPTH,
  MAX_ROWS_PER_TX,
  selectTraceScope,
  type FailedTraceTx,
} from '@/utils/internalTxScan';
import type { CallTraceNode } from '@/utils/traceFormat';

/**
 * How many of the block's transactions one sweep traces. The rest are
 * disclosed ("first N of M transactions traced"), never silently dropped.
 */
export const MAX_BLOCK_TRACED_TXS = 50;

/** Parallel debug_traceTransaction calls per sweep — the address tab's pool size. */
export const BLOCK_TRACE_CONCURRENCY = 4;

/** Row ceiling across a whole sweep (depth-capped txs x deep trees). */
export const MAX_BLOCK_TOTAL_ROWS = 1000;

/** One flattened internal call of one parent transaction. `depth` counts from the tx's top-level frame (0), so the first internal level is 1. */
export type BlockInternalTxRow = {
  /** Hash of the parent (external) transaction the frame belongs to. */
  txHash: string;
  /** Frame sender; null when the node did not report one. */
  from: string | null;
  /** Frame callee (created contract for CREATE-family frames); null when unreported. */
  to: string | null;
  /** Exact wei moved by the frame; null when unreported. */
  value: bigint | null;
  /** Nesting depth below the top-level frame (root frame = 0). */
  depth: number;
  /** Geth call type verbatim (CALL, DELEGATECALL, CREATE, ...). */
  type: string;
  /** First 4 bytes of the frame's calldata; null when it carried none. */
  selector: string | null;
  /** Geth error string for this frame; null when it did not report one. */
  error: string | null;
  /** Decoded revert reason, when the node surfaced one; null otherwise. */
  revertReason: string | null;
};

export type BlockInternalTxFlattenOptions = {
  /** Deepest nesting level still walked (frames AT the level are kept). */
  maxDepth?: number;
  /** Row ceiling for this tx. */
  maxRowsPerTx?: number;
};

export type BlockInternalTxFlattenResult = {
  rows: BlockInternalTxRow[];
  /** True when the walk stopped early (depth or row bound hit with more frames left). */
  truncated: boolean;
};

/**
 * Flatten one normalized callTracer tree into the block's internal-call
 * rows: EVERY frame at depth >= 1, in DFS pre-order = execution order.
 * The root frame (depth 0) is descended into but never emitted — it is
 * the external transaction itself, which the block's transaction list
 * already shows.
 */
export function flattenBlockInternalFrames(
  txHash: string,
  root: CallTraceNode,
  options: BlockInternalTxFlattenOptions = {},
): BlockInternalTxFlattenResult {
  const maxDepth = options.maxDepth ?? MAX_INTERNAL_TRACE_DEPTH;
  const maxRows = options.maxRowsPerTx ?? MAX_ROWS_PER_TX;
  const rows: BlockInternalTxRow[] = [];
  let truncated = false;

  // Returns true when the walk must abort entirely (row bound reached).
  const walk = (node: CallTraceNode): boolean => {
    if (rows.length >= maxRows) {
      truncated = true;
      return true;
    }
    if (node.depth > 0) {
      rows.push({
        txHash,
        from: node.from,
        to: node.to,
        value: node.value,
        depth: node.depth,
        type: node.type,
        selector: node.selector,
        error: node.error,
        revertReason: node.revertReason,
      });
    }
    if (node.depth >= maxDepth) {
      // Frames AT the bound were considered; only their subtrees are cut.
      if (node.calls.length > 0) truncated = true;
      return false;
    }
    return node.calls.some(child => walk(child));
  };

  walk(root);
  return { rows, truncated };
}

/**
 * Does the row move value? null is the node's honest "unreported"; an
 * explicit 0n is a real no-op — only a positive value renders a value
 * cell (the address tab's value filter, expressed as a display decision
 * for the block tables). A type predicate so callers narrow to bigint.
 */
export function rowCarriesValue(value: bigint | null): value is bigint {
  return value !== null && value > 0n;
}

/** Outcome of tracing one of the block's transactions. */
export type BlockTraceTxOutcome =
  | { hash: string; status: 'traced'; rows: BlockInternalTxRow[]; truncated: boolean }
  | { hash: string; status: 'failed'; message: string }
  | { hash: string; status: 'unsupported'; message: string };

/** One parent tx's internal calls (only traced txs that produced rows land here). */
export type BlockInternalTxGroup = {
  hash: string;
  rows: BlockInternalTxRow[];
  /** This tx's own walk hit a bound. */
  truncated: boolean;
};

export type BlockInternalTxnsAggregate = {
  /** Per-tx groups in block order — only txs whose traces produced rows. */
  groups: BlockInternalTxGroup[];
  /** True when any bound (per-tx depth/rows or the total row cap) was hit. */
  truncated: boolean;
  /** Transactions whose trace request failed, in block order. */
  failedTxs: FailedTraceTx[];
  /** Transactions that returned a settled trace (with or without rows). */
  tracedCount: number;
  /** True when every attempted trace came back unsupported — the RPC lacks debug_*. */
  unsupported: boolean;
  /** Total rows across groups (pre-computed for the summary line). */
  totalRows: number;
};

/**
 * Aggregate per-tx trace outcomes into the card's dataset. Deterministic:
 * groups keep the block's tx order, failures likewise. `unsupported` is
 * only true when NOTHING traced — a working trace followed by a
 * method-not-found is recorded per-tx instead of being read as an RPC
 * capability verdict (the address tab's rule). Once the total-row cap is
 * hit, later txs stop grouping (the flag discloses the cut) but failures
 * and traced counts keep accruing honestly.
 */
export function groupBlockInternalTxns(
  outcomes: readonly BlockTraceTxOutcome[],
  options: { maxTotalRows?: number } = {},
): BlockInternalTxnsAggregate {
  const maxTotalRows = options.maxTotalRows ?? MAX_BLOCK_TOTAL_ROWS;
  const groups: BlockInternalTxGroup[] = [];
  const failedTxs: FailedTraceTx[] = [];
  let tracedCount = 0;
  let unsupportedAttempts = 0;
  let truncated = false;
  let totalRows = 0;
  let capHit = false;

  for (const outcome of outcomes) {
    if (outcome.status === 'failed' || outcome.status === 'unsupported') {
      failedTxs.push({
        hash: outcome.hash,
        message: outcome.message,
        unsupported: outcome.status === 'unsupported',
      });
      if (outcome.status === 'unsupported') unsupportedAttempts += 1;
      continue;
    }
    tracedCount += 1;
    if (outcome.truncated) truncated = true;
    if (outcome.rows.length === 0) continue;
    if (capHit || totalRows + outcome.rows.length > maxTotalRows) {
      capHit = true;
      truncated = true;
      continue;
    }
    groups.push({ hash: outcome.hash, rows: outcome.rows, truncated: outcome.truncated });
    totalRows += outcome.rows.length;
  }

  return {
    groups,
    truncated,
    failedTxs,
    tracedCount,
    unsupported: unsupportedAttempts > 0 && tracedCount === 0,
    totalRows,
  };
}

const pluralize = (count: number, singular: string): string =>
  `${count.toLocaleString()} ${singular}${count === 1 ? '' : 's'}`;

/**
 * The card's summary line: "N internal calls across M traced
 * transactions". Counts come from the aggregate alone — no totals are
 * ever invented for transactions that were not traced.
 */
export function blockInternalTxnsSummary(aggregate: BlockInternalTxnsAggregate): string {
  return `${pluralize(aggregate.totalRows, 'internal call')} across ${pluralize(
    aggregate.tracedCount,
    'traced transaction',
  )}`;
}

/**
 * The sweep-bound disclosure: "first 50 of 60 transactions traced" when
 * the cap cut the block, null when every transaction was traced — the
 * card renders the line only when it is true.
 */
export function blockTraceTruncationLabel(
  tracedCount: number,
  totalCount: number,
): string | null {
  if (tracedCount >= totalCount) return null;
  return `first ${tracedCount.toLocaleString()} of ${totalCount.toLocaleString()} transactions traced`;
}

/**
 * The sweep's universe: the first MAX_BLOCK_TRACED_TXS transactions of
 * the block, in block order. Thin wrapper over the address tab's
 * selectTraceScope so the cap contract lives beside the block constants:
 * an empty tx list traces nothing and claims no truncation.
 */
export function selectBlockTraceScope<T extends { hash: string }>(
  txs: readonly T[],
): { txs: T[]; truncated: boolean } {
  return selectTraceScope(txs, MAX_BLOCK_TRACED_TXS);
}

/**
 * Tx hashes out of an eth_getBlockByHash(hash, true) payload. Nodes may
 * return full tx objects or bare hash strings; both are accepted, in
 * block order. Anything else (null block, missing/malformed transactions
 * array, an entry without a usable hash) is null — the caller shows a
 * retryable error rather than tracing a guessed list.
 */
export function extractBlockTxHashes(block: unknown): string[] | null {
  if (typeof block !== 'object' || block === null) return null;
  const txs = (block as Record<string, unknown>).transactions;
  if (!Array.isArray(txs)) return null;
  const hashes: string[] = [];
  for (const tx of txs) {
    if (typeof tx === 'string') {
      hashes.push(tx);
      continue;
    }
    if (typeof tx === 'object' && tx !== null) {
      const hash = (tx as Record<string, unknown>).hash;
      if (typeof hash === 'string' && hash !== '') {
        hashes.push(hash);
        continue;
      }
    }
    return null;
  }
  return hashes;
}
