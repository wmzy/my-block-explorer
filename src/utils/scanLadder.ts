// The adaptive eth_getLogs scan ladder, single-sourced for the two
// window-limited on-demand scans (TokenTransferService and
// ApprovalScanService): identical constants, identical behavior — any
// tuning change applies to both scans.
//
// Window: an explicit ?window= override clamps into
// [MIN_WINDOW_BLOCKS, MAX_WINDOW_BLOCKS]; undefined uses the default.
//
// Adaptive chunk sizing: start optimistic (INITIAL_CHUNK_BLOCKS), halve
// on provider range/result cap errors down to the MIN_CHUNK_BLOCKS floor
// (some free providers, e.g. blastapi, cap topic-filtered eth_getLogs
// at a 10-block range; the adaptive halving must be able to reach that
// limit), double on success under the learned provider ceiling, capped
// at MAX_CHUNK_BLOCKS.
//
// Honesty budgets: stop after DEFAULT_MAX_SCAN_CALLS ACTUAL getLogs
// calls issued or DEFAULT_SCAN_TIMEOUT_MS elapsed and report coverage
// 'partial' instead of blocking forever. The grace pads the hard race
// guard (utils/withTimeout): the cooperative elapsed check inside the
// scan loop fires first whenever time actually progresses; the race only
// catches a provider call that hangs outright.

export const DEFAULT_WINDOW_BLOCKS = 100_000;
export const MAX_WINDOW_BLOCKS = 50_000_000;
export const MIN_WINDOW_BLOCKS = 1;
export const INITIAL_CHUNK_BLOCKS = 5_000;
export const MIN_CHUNK_BLOCKS = 10;
export const MAX_CHUNK_BLOCKS = 10_000;
export const DEFAULT_MAX_SCAN_CALLS = 40;
export const DEFAULT_SCAN_TIMEOUT_MS = 25_000;
export const SCAN_TIMEOUT_GRACE_MS = 5_000;

// Ceiling memory for the ladder: the highest chunk size this provider is
// known to REJECT (range caps). Growth after a clean chunk stays below
// it, so a capped provider does not oscillate
// fail→halve→succeed→double→fail burning the call budget.
export function createProviderCeilingMemory(): {
  /** Record that `chunkSize` was rejected; the ceiling drops to just under it. */
  noteRejected: (chunkSize: number) => void;
  /** Halve toward the 10-block floor. */
  halve: (chunkSize: number) => number;
  /** Double after a clean chunk, never past the learned ceiling or the hard cap. */
  grow: (chunkSize: number) => number;
} {
  let ceiling = MAX_CHUNK_BLOCKS;
  return {
    // Rejections only ever lower the ceiling: chunks shrink after a
    // rejection and growth stays below the ceiling, so every newly
    // rejected size is smaller than the last.
    noteRejected: chunkSize => {
      ceiling = chunkSize - 1;
    },
    halve: chunkSize => Math.max(Math.floor(chunkSize / 2), MIN_CHUNK_BLOCKS),
    grow: chunkSize => Math.min(chunkSize * 2, ceiling, MAX_CHUNK_BLOCKS),
  };
}
