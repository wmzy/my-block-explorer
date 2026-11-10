// The canonical Multicall3 deployment + the outcome-narrowing helpers the
// token services share (one home for what tokenMetadata, tokenDirectory,
// knownTokenBalances and ApprovalScanService each re-declared — the
// 2026-11-10 dedup wave).
//
// With allowFailure, viem wraps each aggregate result as
// { status: 'success', result } or { status: 'failure', error }; test
// doubles may hand back a bare null for a reverted call. Every helper
// decodes a failed, stubbed or unrecognized outcome to null — a failed
// read is an honest absence, never a guessed value.
//
// Pure module: type imports only, no RPC/browser dependencies — so it is
// safe from any barrel or backend import graph.
import { type Address } from 'viem';

/** The canonical Multicall3 deployment (same address on every chain). */
export const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const successResult = (outcome: unknown): { ok: true; result: unknown } | { ok: false } => {
  if (!isRecord(outcome) || outcome.status !== 'success' || !('result' in outcome)) {
    return { ok: false };
  }
  return { ok: true, result: outcome.result };
};

/**
 * Narrow a multicall outcome to a string/number result — symbol()/name()/
 * decimals()-shaped reads. A success carrying any other type (bigint,
 * boolean, missing) decodes to null; those reads belong to the other
 * helpers and must not leak through as-is.
 */
export function readMulticallValue(outcome: unknown): string | number | null {
  const unwrapped = successResult(outcome);
  if (!unwrapped.ok) return null;
  const { result } = unwrapped;
  return typeof result === 'string' || typeof result === 'number' ? result : null;
}

/**
 * Narrow a multicall outcome to a bigint result — uint256 reads
 * (totalSupply/balanceOf/allowance). A genuine on-chain zero (0n) is a
 * value, distinct from a revert; a success carrying any non-bigint type
 * decodes to null (the row is skipped, never invented).
 */
export function readMulticallBigint(outcome: unknown): bigint | null {
  const unwrapped = successResult(outcome);
  if (!unwrapped.ok) return null;
  const { result } = unwrapped;
  return typeof result === 'bigint' ? result : null;
}

/**
 * Unwrap a multicall outcome's RAW result without narrowing its type —
 * mixed-kind batches (isApprovedForAll booleans, getApproved addresses)
 * where the caller applies its own per-field decoding.
 */
export function readMulticallResult(outcome: unknown): unknown {
  const unwrapped = successResult(outcome);
  return unwrapped.ok ? unwrapped.result : null;
}
