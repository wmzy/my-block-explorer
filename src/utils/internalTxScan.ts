// Internal-transaction scan: pure flattening/aggregation over the
// normalized callTracer trees (see utils/traceFormat) of a bounded set of
// discovered transactions. The RPC I/O lives in the view component
// (views/Address/InternalTxns.tsx) — this module is the testable half.
//
// Honesty rules:
// - "Internal" means frames BELOW the tx's top-level call: the root frame
//   IS the external transaction the tx tab already lists, so it is never
//   emitted as a row (a value-carrying root would duplicate the tx list).
// - A frame becomes a row when it carries value (value > 0) OR involves
//   the viewed address as sender/recipient (case-insensitive). Zero-value
//   address-adjacent frames (e.g. internal code reads) are kept — they
//   are real activity; zero-value unrelated frames are noise.
// - Unreported fields stay null/absent — never a fabricated 0.
// - Both the per-tx walk and the cross-tx aggregate are bounded; hitting
//   a bound sets `truncated`, which the UI must disclose, never hide.

import type { CallTraceNode } from '@/utils/traceFormat';

/** One flattened internal call. `depth` counts from the tx's top-level frame (0), so the first internal level is 1. */
export type InternalTxRow = {
  /** Hash of the parent (external) transaction the frame belongs to. */
  txHash: string;
  /** Frame sender; null when the node did not report one. */
  from: string | null;
  /** Frame callee; null when the node did not report one. */
  to: string | null;
  /** Exact wei moved by the frame; null when unreported. */
  value: bigint | null;
  /** Nesting depth below the top-level frame (root frame = 0). */
  depth: number;
  /** Geth call type verbatim (CALL, DELEGATECALL, CREATE, ...). */
  type: string;
};

/**
 * Nesting bound for the per-tx walk. EVM allows 1024 levels; trace trees
 * that deep are pathological for a table, and frames that nested rarely
 * carry distinct information — the walk stops and says so (`truncated`).
 */
export const MAX_INTERNAL_TRACE_DEPTH = 128;

/** Row ceiling per traced transaction (runaway trees must not flood the tab). */
export const MAX_ROWS_PER_TX = 200;

/** Row ceiling across the whole aggregate (depth-capped traced txs x deep trees). */
export const MAX_TOTAL_ROWS = 1000;

/**
 * Default number of discovered transactions one scan traces — the depth
 * the tab runs at when ?itDepth= is absent, kept equal to the original
 * hardcoded bound so a plain visit scans exactly as it always did.
 */
export const DEFAULT_INTERNAL_TX_DEPTH = 25;

/** Supported range of the trace-depth setting (?itDepth= clamps into it). */
export const MIN_INTERNAL_TX_DEPTH = 10;
export const MAX_INTERNAL_TX_DEPTH = 200;

/**
 * Clamp a requested trace depth into the supported range. Silent by
 * design (the ?ttWindow= precedent): a deep link asking for 9 or 5000
 * still scans — at 10 or 200 — instead of degrading to the default.
 * Pure so the clamp contract (9 → 10, 201 → 200) is testable.
 */
export const clampInternalTxDepth = (depth: number): number =>
  Math.min(
    MAX_INTERNAL_TX_DEPTH,
    Math.max(MIN_INTERNAL_TX_DEPTH, Math.floor(depth)),
  );

export type InternalTxScope<T> = {
  /** The transactions to trace: the first `depth` of the discovered list, in discovered order. */
  txs: T[];
  /** True when the discovered list was longer than the depth — the scan covers a bounded slice, not the whole window. */
  truncated: boolean;
};

/**
 * The scan's universe under a depth setting: the first `depth` discovered
 * transactions. The depth is floored (never negative) but deliberately
 * NOT clamped — narrowing into the supported 10..200 range is the URL
 * layer's job (effectiveInternalTxDepth), so the scan honors exactly the
 * depth it is handed. Pure so the depth cap's honesty (how many are
 * traced, whether the window was cut) is testable without any RPC.
 */
export function selectTraceScope<T extends { hash: string }>(
  txs: readonly T[],
  depth: number,
): InternalTxScope<T> {
  const bounded = Math.max(0, Math.floor(depth));
  return {
    txs: txs.slice(0, bounded),
    truncated: txs.length > bounded,
  };
}

export type InternalTxFlattenOptions = {
  /** Deepest nesting level still walked (frames AT the level are kept). */
  maxDepth?: number;
  /** Row ceiling for this tx. */
  maxRowsPerTx?: number;
};

export type InternalTxFlattenResult = {
  rows: InternalTxRow[];
  /** True when the walk stopped early (depth or row bound hit with more frames left). */
  truncated: boolean;
};

const sameAddress = (a: string | null, b: string): boolean =>
  a !== null && a.toLowerCase() === b.toLowerCase();

/**
 * Does this frame become an internal-tx row for the viewed address?
 * Value-carrying frames count regardless of participants; any frame the
 * viewed address sends or receives counts regardless of value.
 */
export function isInternalTxRow(
  node: CallTraceNode,
  viewedAddress: string,
): boolean {
  if (node.value !== null && node.value > 0n) return true;
  return sameAddress(node.from, viewedAddress) || sameAddress(node.to, viewedAddress);
}

/**
 * Flatten one normalized callTracer tree into internal-tx rows for the
 * viewed address. DFS pre-order = execution order, which makes the
 * output deterministic. The root frame (depth 0) is descended into but
 * never emitted — it is the external transaction itself.
 */
export function flattenInternalTxTree(
  txHash: string,
  root: CallTraceNode,
  viewedAddress: string,
  options: InternalTxFlattenOptions = {},
): InternalTxFlattenResult {
  const maxDepth = options.maxDepth ?? MAX_INTERNAL_TRACE_DEPTH;
  const maxRows = options.maxRowsPerTx ?? MAX_ROWS_PER_TX;
  const rows: InternalTxRow[] = [];
  let truncated = false;

  // Returns true when the walk must abort entirely (row bound reached).
  const walk = (node: CallTraceNode): boolean => {
    if (rows.length >= maxRows) {
      truncated = true;
      return true;
    }
    if (node.depth > 0 && isInternalTxRow(node, viewedAddress)) {
      rows.push({
        txHash,
        from: node.from,
        to: node.to,
        value: node.value,
        depth: node.depth,
        type: node.type,
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

/** Outcome of tracing one transaction. */
export type TraceTxOutcome =
  | { hash: string; status: 'traced'; rows: InternalTxRow[]; truncated: boolean }
  | { hash: string; status: 'failed'; message: string }
  | { hash: string; status: 'unsupported'; message: string };

export type FailedTraceTx = {
  hash: string;
  message: string;
  /** True when the failure was "this RPC does not implement debug_*". */
  unsupported: boolean;
};

export type InternalTxAggregate = {
  /** Rows from every traced tx, in discovered-tx order, execution order within each. */
  rows: InternalTxRow[];
  /** True when any bound (per-tx depth/rows or the total row cap) was hit. */
  truncated: boolean;
  /** Transactions whose trace request failed, in tx order. */
  failedTxs: FailedTraceTx[];
  /** Transactions that returned a settled trace (with or without rows). */
  tracedCount: number;
  /** True when every attempted trace came back unsupported — the RPC lacks debug_*. */
  unsupported: boolean;
};

/**
 * Aggregate per-tx trace outcomes into the tab's dataset. Deterministic:
 * rows keep the input tx order (the discovered list's order), failures
 * likewise. `unsupported` is only true when NOTHING traced — a working
 * trace followed by a method-not-found is recorded per-tx instead of
 * being read as an RPC capability verdict.
 */
export function aggregateInternalTxns(
  outcomes: readonly TraceTxOutcome[],
  options: { maxTotalRows?: number } = {},
): InternalTxAggregate {
  const maxTotalRows = options.maxTotalRows ?? MAX_TOTAL_ROWS;
  const rows: InternalTxRow[] = [];
  const failedTxs: FailedTraceTx[] = [];
  let tracedCount = 0;
  let unsupportedAttempts = 0;
  let truncated = false;

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
    for (const row of outcome.rows) {
      if (rows.length >= maxTotalRows) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
  }

  return {
    rows,
    truncated,
    failedTxs,
    tracedCount,
    unsupported: unsupportedAttempts > 0 && tracedCount === 0,
  };
}

const pluralize = (count: number, singular: string): string =>
  `${count.toLocaleString()} ${singular}${count === 1 ? '' : 's'}`;

/**
 * The aggregate header line: "N internal transfers across M traced
 * transactions". Counts come from the aggregate alone — no totals are
 * ever invented for txs that were not traced.
 */
export function internalTxSummary(aggregate: InternalTxAggregate): string {
  return `${pluralize(aggregate.rows.length, 'internal transfer')} across ${pluralize(
    aggregate.tracedCount,
    'traced transaction',
  )}`;
}

/**
 * Scope disclosure for the bounds label. Page 1 of the discovered set can
 * honestly read "the first N"; a deeper page traces that page's slice, so
 * the label names the page instead — completeness is never implied.
 */
export function tracedScopeLabel(tracedCount: number, page: number): string {
  const count = tracedCount.toLocaleString();
  return page > 1
    ? `Traced ${count} discovered transactions (page ${page.toLocaleString()} of the discovered set)`
    : `Traced the first ${count} discovered transactions`;
}
