// Pure prev/next math for the block detail header navigation. Kept free of
// React/RPC imports so the boundary semantics are unit-testable in isolation.
//
// Honesty contract: `head` is whatever the view's EXISTING head probe last
// observed (null = the probe failed or never ran — the view only probes on
// the error path). A null head must never silently become "no next block":
// the candidate number is returned with nextUnknown so the UI can link it
// optimistically while labeling the uncertainty. Landing on a block that
// does not exist yet is itself an honest page (the "does not exist yet"
// state with re-probing), so the optimistic link never fabricates data.

export type BlockNav = {
  /** One below the viewed number; null at genesis (block 0). */
  prev: number | null;
  /**
   * Candidate next number. Null only when the head is KNOWN and the viewed
   * block is at or beyond it — never linkable past a known head.
   */
  next: number | null;
  /** True when `next` was derived without a known head; the target may not
   *  exist yet, so the UI must say so instead of implying certainty. */
  nextUnknown: boolean;
};

export function computeBlockNav(blockNumber: number, head: number | null): BlockNav {
  // Genesis has no parent by definition; a non-positive number can never
  // have one either (the route param parser clamps out negatives anyway).
  const prev = blockNumber > 0 ? blockNumber - 1 : null;

  if (head === null) {
    return { prev, next: blockNumber + 1, nextUnknown: true };
  }
  return {
    prev,
    // At or beyond a known head there is nothing newer to visit (a number
    // beyond the head cannot exist on this chain's current fork).
    next: blockNumber < head ? blockNumber + 1 : null,
    nextUnknown: false,
  };
}
