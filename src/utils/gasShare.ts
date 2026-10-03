// Gas share of a block: gasUsed against gasLimit.
//
// The raw arithmetic `(used / limit) * 100` printed "NaN%" for a
// zero-over-zero block and "Infinity%" when a quirky RPC reported a gas
// limit of 0 against real usage — arithmetic noise rendered as a
// measured figure, on the block list and the Home stats bar. The repo
// already ships formatPercentage, which degrades any non-finite ratio to
// the shared placeholder; these helpers route the on-chain quantities
// through it while keeping the measured number itself visible.
//
// Inputs are the decimal-string gas quantities the RpcBlock shape
// carries. A figure that will not parse (an absent or malformed value)
// is treated as "no ratio to report", never as 0.

import { formatNumber } from './format';

/** Parse a decimal-string gas quantity; null when absent or unparseable. */
const parseGas = (value: string | undefined | null): bigint | null => {
  if (value === undefined || value === null) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

/**
 * Percentage of the block's gas limit that was used, or null when the
 * ratio cannot be computed (missing figure, or a zero limit).
 */
export function blockGasSharePercent(
  gasUsed: string | undefined | null,
  gasLimit: string | undefined | null,
): number | null {
  const used = parseGas(gasUsed);
  const limit = parseGas(gasLimit);
  if (used === null || limit === null || limit === 0n) return null;
  return Number((used * 10000n) / limit) / 100;
}

/**
 * The block list's gas cell: the measured figure plus its share of the
 * limit, e.g. "15,000,000 (50.0%)". The share is omitted entirely when
 * it cannot be computed — the figure is the fact, the ratio is derived.
 */
export function gasUsageShare(
  gasUsed: string | undefined | null,
  gasLimit: string | undefined | null,
): string {
  const used = parseGas(gasUsed);
  const figure = used === null ? (gasUsed ?? '') : formatNumber(used);
  const percent = blockGasSharePercent(gasUsed, gasLimit);
  return percent === null ? figure : `${figure} (${percent.toFixed(1)}%)`;
}

/**
 * The Home stats bar's "Gas Used" card value: a percentage, or the
 * shared placeholder when the ratio cannot be computed.
 */
export function gasUsedPercentLabel(
  gasUsed: string | undefined | null,
  gasLimit: string | undefined | null,
): string {
  const percent = blockGasSharePercent(gasUsed, gasLimit);
  return percent === null ? '—' : `${percent.toFixed(1)}%`;
}
