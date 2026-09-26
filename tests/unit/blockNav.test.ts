// Boundary tests for the block detail header's prev/next math. The head
// argument is what the view's existing head probe last observed — the cases
// pin that a KNOWN head is never linked past, while an unknown head yields
// an honest candidate (nextUnknown) rather than a silent dead-end.
import { describe, it, expect } from 'vitest';
import { computeBlockNav } from '@/views/Blocks/nav';

describe('computeBlockNav', () => {
  it('steps to both neighbors mid-chain under a known head', () => {
    // Boundary directly above genesis.
    expect(computeBlockNav(1, 5)).toEqual({ prev: 0, next: 2, nextUnknown: false });
    // Anywhere strictly between genesis and head.
    expect(computeBlockNav(3, 5)).toEqual({ prev: 2, next: 4, nextUnknown: false });
  });

  it('disables prev at genesis (block 0)', () => {
    expect(computeBlockNav(0, 5)).toEqual({ prev: null, next: 1, nextUnknown: false });
  });

  it('links next at head-1 but never at or beyond a known head', () => {
    // head-1: the last linkable next (the head itself).
    expect(computeBlockNav(4, 5)).toEqual({ prev: 3, next: 5, nextUnknown: false });
    // at head: nothing newer exists.
    expect(computeBlockNav(5, 5)).toEqual({ prev: 4, next: null, nextUnknown: false });
    // head+1 (a future number past the head): still no linkable next.
    expect(computeBlockNav(6, 5)).toEqual({ prev: 5, next: null, nextUnknown: false });
  });

  it('disables next on a chain whose head is genesis itself', () => {
    expect(computeBlockNav(0, 0)).toEqual({ prev: null, next: null, nextUnknown: false });
  });

  it('offers a candidate next flagged unknown when the head is unknown', () => {
    // Probe never ran or failed: the candidate target is returned so the UI
    // can label the uncertainty instead of guessing "no next block".
    expect(computeBlockNav(123, null)).toEqual({
      prev: 122,
      next: 124,
      nextUnknown: true,
    });
    // Genesis under an unknown head: prev still disabled, next still only a
    // candidate.
    expect(computeBlockNav(0, null)).toEqual({ prev: null, next: 1, nextUnknown: true });
  });
});
