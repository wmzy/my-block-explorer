// Mempool conflict analysis: pure aggregation over the flattened pending
// entries of a txpool snapshot (services/txpool.ts). The RPC I/O lives in
// the service — this module is the testable half (internalTxScan pattern).
//
// Honesty rules:
// - A "replacement conflict" is one (from, nonce) slot held by more than
//   one entry (addresses compare case-insensitively — EIP-55 casing is
//   presentation, not identity). Every member of such a group is
//   replaceable, INCLUDING the current likely winner: any of them can
//   still be replaced outright, and only the node decides what it mines.
// - The "likely winner" is a heuristic, never a promise: the highest
//   effective gas cap wins the label (EIP-1559 maxFeePerGas with
//   maxPriorityFeePerGas as the tie-break; legacy gasPrice; mixed groups
//   compare the applicable cap directly). Ties the fee fields cannot
//   resolve fall back to snapshot order — deterministic, not fabricated.
// - Fee statistics are BigInt-exact: percentiles are picked by index from
//   the ascending sort (floor(p * (n - 1))), never averaged through
//   Number. Legacy transactions have no separate tip — tip statistics
//   cover EIP-1559 entries only and the display must say so; cap
//   statistics cover every entry that reports a cap.
// - Entries reporting neither gasPrice nor maxFeePerGas (the service's
//   honesty rule keeps them, never fabricating a 0) still count in the
//   totals and the conflict grouping, but stay out of the fee statistics
//   and can only head a conflict group when NO member reports a cap.

import type { PoolEntry } from '@/services/txpool';

/**
 * The gas cap a miner actually compares: the EIP-1559 fee cap when the
 * entry has one, else the legacy gas price. Undefined when the entry
 * reported neither — an honest absence, never a fabricated 0.
 */
export const effectiveGasCap = (entry: PoolEntry): bigint | undefined =>
  entry.maxFeePerGas ?? entry.gasPrice;

/**
 * The tip a miner keeps above the base fee. Only EIP-1559 entries have a
 * separate one (maxPriorityFeePerGas); a legacy entry's gasPrice has no
 * tip component this snapshot can isolate, so it reads undefined.
 */
export const effectiveTip = (entry: PoolEntry): bigint | undefined =>
  entry.maxFeePerGas !== undefined ? entry.maxPriorityFeePerGas : undefined;

/** Min / p25 / median / max of the pool's effective gas caps (wei). */
export type FeeQuartiles = {
  /** How many entries contributed a cap. */
  count: number;
  min: bigint | null;
  p25: bigint | null;
  median: bigint | null;
  max: bigint | null;
};

/** p25 / median of the EIP-1559 tips (wei). Legacy entries never appear. */
export type TipPercentiles = {
  /** How many EIP-1559 entries reported a tip. */
  count: number;
  p25: bigint | null;
  median: bigint | null;
};

/** Per-entry conflict verdict attached by {@link analyzeMempool}. */
export type ConflictInfo = {
  /** Entries sharing this (from, nonce) slot. */
  size: number;
  /** Hash of the current likely winner (highest effective gas cap). */
  winnerHash: string;
  /** True on the winner itself — it is replaceable too, just currently ahead. */
  isWinner: boolean;
};

/** A pool entry with its conflict verdict (null when unopposed). */
export type AnalyzedPoolEntry = PoolEntry & { conflict: ConflictInfo | null };

/** One (from, nonce) slot held by 2+ entries. */
export type ConflictGroup = {
  /** The from address exactly as the pool reported it (first member's casing). */
  from: string;
  nonce: number;
  size: number;
  winnerHash: string;
  /** Members in likely-winner-first order (ties resolve to snapshot order). */
  members: AnalyzedPoolEntry[];
};

/** One renderable unit: an unopposed entry, or a conflict group block. */
export type MempoolRenderUnit =
  | { kind: 'solo'; entry: AnalyzedPoolEntry }
  | { kind: 'group'; group: ConflictGroup };

/** Everything the Pending view derives from one pool snapshot. */
export type MempoolAnalysis = {
  /** Entries analyzed (the snapshot's listing — capped by the service). */
  total: number;
  /** Distinct senders, case-insensitive. */
  distinctAccounts: number;
  /** (from, nonce) slots held by 2+ entries. */
  conflictGroupCount: number;
  /** Entries sitting in a conflict slot (each flagged replaceable). */
  replaceableCount: number;
  /** Entries with an EIP-1559 fee cap (maxFeePerGas). */
  eip1559Count: number;
  /** Legacy-priced entries (gasPrice, no maxFeePerGas). */
  legacyCount: number;
  /** Entries reporting neither fee field. */
  noFeeDataCount: number;
  capStats: FeeQuartiles;
  tipStats: TipPercentiles;
  /** Snapshot order with conflict verdicts attached. */
  entries: AnalyzedPoolEntry[];
  /** Conflict groups in first-appearance (snapshot) order. */
  groups: ConflictGroup[];
  /** Snapshot order with each conflict group collapsed at its first member. */
  renderPlan: MempoolRenderUnit[];
};

const BIGINT_ASC = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Percentile by index pick over the ascending sort — the inclusive
 * lower-index convention: the picked rank is floor(quantile * (n - 1)).
 * min (p=0) and max (p=1) degenerate to the ends; an even-count median
 * picks the lower middle. No interpolation and no Number conversion:
 * the returned bigint is always one of the inputs, exactly.
 */
const pickPercentile = (sorted: bigint[], quantile: number): bigint | null => {
  if (sorted.length === 0) return null;
  return sorted[Math.floor(quantile * (sorted.length - 1))];
};

type Indexed = { entry: PoolEntry; index: number };

/**
 * Likely-winner ordering for one conflict group (strongest first).
 * Effective cap desc (an absent cap always loses to a present one), then
 * effective tip desc among the entries that have one, then snapshot
 * order — the deterministic floor, never a coin flip.
 */
const likelyWinnerFirst = (a: Indexed, b: Indexed): number => {
  const capA = effectiveGasCap(a.entry);
  const capB = effectiveGasCap(b.entry);
  if (capA === undefined || capB === undefined) {
    if (capA !== capB) return capA === undefined ? 1 : -1;
  } else if (capA !== capB) {
    return capA > capB ? -1 : 1;
  }
  const tipA = effectiveTip(a.entry);
  const tipB = effectiveTip(b.entry);
  if (tipA === undefined || tipB === undefined) {
    if (tipA !== tipB) return tipA === undefined ? 1 : -1;
  } else if (tipA !== tipB) {
    return tipA > tipB ? -1 : 1;
  }
  return a.index - b.index;
};

/**
 * Analyze a pool snapshot's pending listing. Pure and total: an empty
 * listing yields zero counts and null statistics (never fabricated
 * zeros); input order is preserved in `entries`/`renderPlan` so the
 * deterministic service sort survives untouched.
 */
export function analyzeMempool(entries: PoolEntry[]): MempoolAnalysis {
  const analyzed: AnalyzedPoolEntry[] = entries.map(entry => ({ ...entry, conflict: null }));

  // (lowercased from, nonce) → members in snapshot order. Insertion order
  // of the map is first-appearance order, which becomes group order.
  const buckets = new Map<string, AnalyzedPoolEntry[]>();
  for (const entry of analyzed) {
    const key = `${entry.from.toLowerCase()}|${entry.nonce}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [entry]);
    else bucket.push(entry);
  }

  const groups: ConflictGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length <= 1) continue;
    const ordered = bucket
      .map((entry, index) => ({ entry, index }))
      .sort(likelyWinnerFirst)
      .map(indexed => indexed.entry);
    const winnerHash = ordered[0].hash;
    const group: ConflictGroup = {
      from: bucket[0].from,
      nonce: bucket[0].nonce,
      size: bucket.length,
      winnerHash,
      members: ordered,
    };
    groups.push(group);
    for (let memberIndex = 0; memberIndex < ordered.length; memberIndex += 1) {
      ordered[memberIndex].conflict = {
        size: bucket.length,
        winnerHash,
        isWinner: memberIndex === 0,
      };
    }
  }

  const accounts = new Set<string>();
  const caps: bigint[] = [];
  const tips: bigint[] = [];
  let eip1559Count = 0;
  let legacyCount = 0;
  let noFeeDataCount = 0;
  for (const entry of analyzed) {
    accounts.add(entry.from.toLowerCase());
    if (entry.maxFeePerGas !== undefined) eip1559Count += 1;
    else if (entry.gasPrice !== undefined) legacyCount += 1;
    else noFeeDataCount += 1;
    const cap = effectiveGasCap(entry);
    if (cap !== undefined) caps.push(cap);
    const tip = effectiveTip(entry);
    if (tip !== undefined) tips.push(tip);
  }

  caps.sort(BIGINT_ASC);
  tips.sort(BIGINT_ASC);

  // Collapse each conflict group at its first member's snapshot position;
  // the remaining members are already inside the group unit.
  const groupOf = new Map<AnalyzedPoolEntry, ConflictGroup>();
  for (const group of groups) {
    for (const member of group.members) groupOf.set(member, group);
  }
  const emitted = new Set<ConflictGroup>();
  const renderPlan: MempoolRenderUnit[] = [];
  for (const entry of analyzed) {
    const group = groupOf.get(entry);
    if (group === undefined) {
      renderPlan.push({ kind: 'solo', entry });
      continue;
    }
    if (!emitted.has(group)) {
      emitted.add(group);
      renderPlan.push({ kind: 'group', group });
    }
  }

  return {
    total: analyzed.length,
    distinctAccounts: accounts.size,
    conflictGroupCount: groups.length,
    replaceableCount: analyzed.reduce(
      (sum, entry) => (entry.conflict !== null ? sum + 1 : sum),
      0,
    ),
    eip1559Count,
    legacyCount,
    noFeeDataCount,
    capStats: {
      count: caps.length,
      min: pickPercentile(caps, 0),
      p25: pickPercentile(caps, 0.25),
      median: pickPercentile(caps, 0.5),
      max: pickPercentile(caps, 1),
    },
    tipStats: {
      count: tips.length,
      p25: pickPercentile(tips, 0.25),
      median: pickPercentile(tips, 0.5),
    },
    entries: analyzed,
    groups,
    renderPlan,
  };
}
