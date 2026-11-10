// Shared claim-based generation guard for hand-rolled async fetches.
//
// The repo's pinned regression (tests/unit/pollGenerationGuard.test.tsx)
// came from a READ-based guard: each run captured the CURRENT id
// (`const requestId = ref.current`) instead of claiming a fresh one, so
// every overlapping run of the same component shared one id, all of them
// passed `isCurrent()`, and whichever settled LAST won — a slow stale tick
// painted old data over fresh. The fix shape is identical across
// EventStatistics, IndexingRangeManager and EventTable, so the idiom lives
// here once: every run CLAIMS a fresh monotonically increasing id, and only
// the newest claim may write. The API deliberately exposes no way to read
// the current id — claim, compare, invalidate — so the read-based variant
// that caused the regression cannot be reintroduced.
//
// Query-cache-backed fetches do NOT need this hook: react-toolroom's chain
// already claims a monotonic sequence per run and discards any settle older
// than an already-applied claim (newest-run-wins is native there — see
// services/eventsRanges.ts, which relies on it).
import { useCallback, useEffect, useMemo, useRef } from 'react';

export type GenerationGuard = {
  /**
   * Claim a NEW generation id for this run. Store it and re-check with
   * `isCurrent(id)` after every `await` before writing state; a superseded
   * run must not setState (nor clear a spinner its successor set).
   */
  claim: () => number;
  /** True while `id` is still the newest claimed generation. */
  isCurrent: (id: number) => boolean;
  /**
   * Invalidate every outstanding claim (identity change, remount): all
   * subsequent `isCurrent` checks return false.
   */
  invalidate: () => void;
};

export function useGenerationGuard(): GenerationGuard {
  const ref = useRef(0);
  const claim = useCallback(() => {
    ref.current += 1;
    return ref.current;
  }, []);
  const isCurrent = useCallback((id: number) => id === ref.current, []);
  // Unmount invalidates in-flight runs: their gated setStates turn into
  // no-ops instead of landing on a dead component.
  useEffect(
    () => () => {
      ref.current += 1;
    },
    [],
  );
  const invalidate = useCallback(() => {
    ref.current += 1;
  }, []);
  // Stable object identity: adopters can keep it in effect/useCallback
  // dependency arrays without re-running on every render.
  return useMemo(() => ({ claim, isCurrent, invalidate }), [claim, isCurrent, invalidate]);
}
