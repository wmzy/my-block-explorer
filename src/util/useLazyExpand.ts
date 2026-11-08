import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

// The expand/collapse machine every lazily-fetched card used to hand-roll
// (CallTraceCard, InternalTxnsSection, RawJsonCard): toggle state with a
// keyboard affordance, a fetch-ONCE-on-first-expand latch, a stale-settle
// guard for superseded requests, and the route-change reset. The tx and
// block routes reuse a mounted card when only the URL param changes
// (native-router composes matched elements without a key), so every
// card's state must belong to exactly ONE entity — a different identity
// resets the machine AND the caller's own entity state (via `onReset`),
// and drops any in-flight settle.
//
// Outward behavior is exactly the union the three cards already shared:
// - expanding never refetches after the first expansion (Retry refetches
//   explicitly);
// - a request may only apply its settle while its claim token is still
//   the latest (a later Retry or an identity change supersedes it).
export type LazyExpand = {
  /** Whether the card body is shown. */
  expanded: boolean;
  /** User-facing toggle; fires `onFirstExpand` once per identity. */
  toggle: () => void;
  /** Keyboard affordance for the toggle (Enter/Space). */
  handleKeyDown: (event: KeyboardEvent) => void;
  /** Claim the stale-guard token for a request about to start. */
  claim: () => number;
  /** Whether `token` is still the latest claim (false → drop the settle). */
  isCurrent: (token: number) => boolean;
};

/**
 * `identity` names the entity whose data the card shows (e.g.
 * `${chainId}:${txHash}`); a change resets the machine during render
 * (React's documented adjust-state-during-render pattern) and fires
 * `onReset` so the caller drops its own per-entity state.
 *
 * `onFirstExpand` fires on the first expansion of an identity — the
 * fetch-once latch. Return `false` to leave the latch armed (e.g. a card
 * that knows there is nothing to fetch YET but may have later).
 */
export function useLazyExpand(
  identity: string,
  callbacks: {
    onFirstExpand?: () => boolean | void;
    onReset?: () => void;
  } = {},
): LazyExpand {
  const [expanded, setExpanded] = useState(false);
  // Mirror of `expanded` so the toggle stays a stable, pure handler.
  const expandedRef = useRef(false);
  // Fetch-once latch: armed until the first expansion's fetch fires.
  const latchedRef = useRef(false);
  // Stale-settle guard: bumped on every claim and on identity change.
  const seqRef = useRef(0);
  const identityRef = useRef(identity);
  // Latest callbacks without retriggering anything on identity churn.
  const firstExpandRef = useRef(callbacks.onFirstExpand);
  firstExpandRef.current = callbacks.onFirstExpand;
  const resetRef = useRef(callbacks.onReset);
  resetRef.current = callbacks.onReset;

  // Route-change reset: adjusting state during render keeps the previous
  // entity's output from ever reaching the screen. A different entity
  // collapses the card, re-arms the latch, drops any in-flight settle
  // from the previous entity, and hands the caller its own reset.
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    expandedRef.current = false;
    setExpanded(false);
    latchedRef.current = false;
    seqRef.current += 1;
    resetRef.current?.();
  }

  const toggle = useCallback(() => {
    const next = !expandedRef.current;
    expandedRef.current = next;
    setExpanded(next);
    if (next && !latchedRef.current) {
      latchedRef.current = firstExpandRef.current?.() !== false;
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  const claim = useCallback(() => {
    seqRef.current += 1;
    return seqRef.current;
  }, []);

  const isCurrent = useCallback((token: number) => seqRef.current === token, []);

  return { expanded, toggle, handleKeyDown, claim, isCurrent };
}
