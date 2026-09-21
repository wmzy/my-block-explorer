// Gas history service: the EIP-1559 fee window behind the Home gas panel.
//
// Everything here is ephemeral RPC data (base fees, priority-fee rewards),
// so the browser fetches it directly through the shared viem client — no
// backend caching, per the project's data-separation rule — polled once a
// minute while the panel is mounted.
//
// Honesty rules this module encodes:
// - eth_feeHistory's baseFeePerGas carries one EXTRA entry (the derived
//   next-block prediction). It is not a mined block's fee and is dropped
//   before anything renders, so "current base fee" is always the newest
//   real block's value.
// - The window label is derived from oldestBlock + the actual series
//   length, never from a wall-clock guess like "24h".
// - Failures never throw to the view: the fetch classifies the failure and
//   settles an explicit unavailable state with a reason (RPC dead vs.
//   method not implemented vs. pre-EIP-1559 chain). Partial data is real:
//   a node that returns base fees but no rewards keeps the sparkline and
//   shows tier rows as explicitly absent.
import { createRpcClient } from '@/utils/realTimeData';
import { formatNumber } from '@/utils/format';

import { bindQueryFn, createQueryCache } from '@/util/useQuery';

import { createPolledQueryHook, type PolledQueryResult } from './polledQuery';

// Window size the panel asks for; nodes with shallow history may return
// fewer blocks and the label follows whatever actually came back.
export const GAS_HISTORY_BLOCK_COUNT = 120;

// Base fees move slowly (12.5% max decay/growth per block); a minute-level
// cadence keeps the sparkline current without leaning on the RPC.
const GAS_HISTORY_INTERVAL = 60_000;

// Priority-fee tiers average the newest slice of the window so one empty
// block (all-zero rewards) cannot pin a tier to zero.
const TIER_SAMPLE_BLOCKS = 10;

// Slow / Standard / Fast map to the 25th / 50th / 75th reward percentiles.
const TIER_PERCENTILE_COUNT = 3;

const GWEI = 1_000_000_000;

export type GasTiers = {
  slow: number;
  standard: number;
  fast: number;
};

export type GasHistorySnapshot = {
  chainId: number;
  /** Base fees in gwei, oldest → newest, one entry per block in the window. */
  baseFeeGwei: number[];
  /** First block of the window, as reported by the node. */
  oldestBlock: number;
  /** Last block of the window (oldestBlock + series length - 1). */
  newestBlock: number;
  /** Newest block's base fee, gwei — never the predicted next-block value. */
  currentBaseFeeGwei: number;
  /** Mean base fee across the window, gwei. */
  averageBaseFeeGwei: number;
  /**
   * Priority-fee tiers in gwei (reward percentiles averaged over the newest
   * blocks), or null when the node returned no usable reward data.
   */
  tiers: GasTiers | null;
};

// Why the panel cannot render, in terms the UI can show verbatim.
export type GasUnavailableReason =
  | 'unsupported-chain'
  | 'method-not-supported'
  | 'no-base-fee-data'
  | 'fetch-failed';

// Both variants carry the chain they were fetched for: the query layer's
// result store keeps the last settle across an args switch, so the view
// needs the chainId to refuse another chain's data (no cross-chain flash).
export type GasHistoryResult =
  | { status: 'ok'; chainId: number; snapshot: GasHistorySnapshot }
  | { status: 'unavailable'; chainId: number; reason: GasUnavailableReason };

// Structural slice of viem's FeeHistory: keeps the pure helpers testable
// without importing viem, while the real return value assigns as-is.
export type FeeHistoryLike = {
  oldestBlock: bigint;
  baseFeePerGas: readonly bigint[];
  gasUsedRatio?: readonly number[];
  reward?: readonly (readonly bigint[])[];
};

// --- pure helpers ---

/**
 * wei (bigint) → gwei (number). Base fees live far below 2^53 wei, so the
 * double conversion is exact for every value a real chain reports; hex
 * inputs must go through BigInt first (never Number(hex)), which is what
 * keeps the precision test meaningful.
 */
export function weiToGwei(wei: bigint): number {
  return Number(wei) / GWEI;
}

/** hex wei quantity (e.g. a raw RPC baseFeePerGas entry) → gwei. */
export function hexWeiToGwei(hex: `0x${string}`): number {
  return weiToGwei(BigInt(hex));
}

/** gwei for display: 2 decimals above 1 gwei, 4 below, trailing zeros cut. */
export function formatGwei(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/**
 * Window label from what the node actually returned: block-count and block
 * numbers, never a wall-clock span ("24h") the data cannot support.
 */
export function gasWindowLabel(oldestBlock: number, newestBlock: number): string {
  const count = newestBlock - oldestBlock + 1;
  if (count <= 0) return 'no blocks';
  const noun = count === 1 ? 'block' : 'blocks';
  return `last ${formatNumber(count)} ${noun} · #${formatNumber(oldestBlock)}–#${formatNumber(newestBlock)}`;
}

/**
 * Slow/Standard/Fast tiers from eth_feeHistory rewards: the 25/50/75th
 * percentile values averaged over the newest `sampleBlocks` blocks. Entries
 * without a full percentile triple (empty rewards arrays, shorter than
 * requested) are skipped; if none remain the tiers are honestly null.
 */
export function extractTiers(
  rewards: readonly (readonly bigint[])[] | undefined,
  sampleBlocks = TIER_SAMPLE_BLOCKS,
): GasTiers | null {
  if (!rewards || rewards.length === 0) return null;
  const start = Math.max(0, rewards.length - sampleBlocks);
  const sums = [0n, 0n, 0n];
  let blocks = 0;
  for (const entry of rewards.slice(start)) {
    if (!entry || entry.length < TIER_PERCENTILE_COUNT) continue;
    blocks += 1;
    for (let i = 0; i < TIER_PERCENTILE_COUNT; i += 1) {
      sums[i] += entry[i];
    }
  }
  if (blocks === 0) return null;
  const average = (total: bigint) => weiToGwei(total) / blocks;
  return { slow: average(sums[0]), standard: average(sums[1]), fast: average(sums[2]) };
}

/**
 * Sparkline path for a value series inside a fixed viewBox. x spans the full
 * width (strictly increasing for series longer than one point), y is the
 * value min-max normalized into [pad, height - pad] and inverted (higher
 * fee → higher on screen), clamped to the box. A flat series draws the
 * mid-line; a single point draws a constant line rather than nothing.
 */
export function buildSparklinePath(
  series: readonly number[],
  width = 240,
  height = 48,
  pad = 4,
): string {
  if (series.length === 0) return '';
  let min = series[0];
  let max = series[0];
  for (const value of series) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  const usable = height - 2 * pad;
  const yFor = (value: number): number => {
    const normalized = span > 0 ? (value - min) / span : 0.5;
    const y = pad + (1 - normalized) * usable;
    return Math.min(height, Math.max(0, y));
  };
  // A one-value series is duplicated so the flat line stays visible across
  // the full width instead of collapsing to a dot.
  const points = series.length === 1 ? [series[0], series[0]] : [...series];
  const xDenominator = Math.max(1, points.length - 1);
  return points
    .map((value, index) => {
      const x = ((index / xDenominator) * width).toFixed(2);
      const y = yFor(value).toFixed(2);
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

/**
 * Assemble the panel's data model from a raw fee-history response. Pure so
 * every degradation (empty series, all-zero pre-1559 fees, missing rewards)
 * is unit-testable without a network.
 */
export function buildGasHistory(
  chainId: number,
  feeHistory: FeeHistoryLike,
  requestedBlockCount = GAS_HISTORY_BLOCK_COUNT,
): GasHistoryResult {
  const raw = feeHistory.baseFeePerGas;
  // eth_feeHistory appends the derived next-block base fee; drop exactly
  // that one speculative entry when the node followed the spec.
  const windowed =
    raw.length === requestedBlockCount + 1 ? raw.slice(0, -1) : raw;
  const series = windowed.map(weiToGwei);
  // An all-zero window is the pre-EIP-1559 response shape, not a real
  // 0-gwei market — refuse to fabricate a flat "free gas" panel.
  if (series.length === 0 || series.every(value => value <= 0)) {
    return { status: 'unavailable', chainId, reason: 'no-base-fee-data' };
  }
  const oldestBlock = Number(feeHistory.oldestBlock);
  const newestBlock = oldestBlock + series.length - 1;
  const sum = series.reduce((total, value) => total + value, 0);
  return {
    status: 'ok',
    chainId,
    snapshot: {
      chainId,
      baseFeeGwei: series,
      oldestBlock,
      newestBlock,
      currentBaseFeeGwei: series[series.length - 1] ?? 0,
      averageBaseFeeGwei: sum / series.length,
      tiers: extractTiers(feeHistory.reward),
    },
  };
}

// --- failure classification ---

// Collects the error's whole cause chain: viem wraps JSON-RPC errors
// (where "method not found" lives) several layers deep.
const errorChainText = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.length > 0 ? parts.join(' ') : String(error);
};

const METHOD_UNSUPPORTED_PATTERN =
  /(method[^\n]*not[^\n]*(found|exist|available|support))|not[^\n]*supported|does not exist|unimplemented/i;

/**
 * Classify a failed fee-history fetch for the honest unavailable state.
 * Only the reason travels; raw provider text never reaches the UI.
 */
export function classifyGasFailure(error: unknown): GasUnavailableReason {
  const text = errorChainText(error);
  return METHOD_UNSUPPORTED_PATTERN.test(text) ? 'method-not-supported' : 'fetch-failed';
}

// --- fetch + hook ---

/**
 * Fetch the gas window over the shared browser RPC client. Never throws:
 * failures (including createRpcClient itself rejecting for unknown chains)
 * settle as an explicit unavailable state with a classified reason.
 */
export async function fetchGasHistory(chainId: number): Promise<GasHistoryResult> {
  // Same invalid-arg guard the other RPC services use: a non-positive id
  // resolves without touching an endpoint.
  if (!(chainId > 0)) {
    return { status: 'unavailable', chainId, reason: 'unsupported-chain' };
  }
  try {
    const client = await createRpcClient(chainId);
    const feeHistory = await client.getFeeHistory({
      blockCount: GAS_HISTORY_BLOCK_COUNT,
      rewardPercentiles: [25, 50, 75],
    });
    return buildGasHistory(chainId, feeHistory);
  } catch (error) {
    return { status: 'unavailable', chainId, reason: classifyGasFailure(error) };
  }
}

export const gasHistoryCache = createQueryCache<GasHistoryResult, [number]>('gas-history');

const queryGasHistory = bindQueryFn(fetchGasHistory, gasHistoryCache);

const useGasHistoryQuery = createPolledQueryHook({
  queryFn: queryGasHistory,
  interval: GAS_HISTORY_INTERVAL,
});

/**
 * Polled gas window for a chain (60s cadence, hidden-tab ticks skipped per
 * the polledQuery factory defaults). Chain switches land on a fresh cache
 * key, so the panel resets to its first-load state instead of showing the
 * previous chain's fees.
 */
export function useGasHistory(chainId: number): PolledQueryResult<GasHistoryResult> {
  return useGasHistoryQuery([chainId]);
}
