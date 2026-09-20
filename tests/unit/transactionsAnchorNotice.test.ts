// Pure-logic tests for the transactions list's anchor notices: the
// malformed-?block= detection (raw param present + schema-dropped parse),
// and the notice resolver's priority contract — invalid-block outranks
// future-anchor outranks none, with a future anchor verdict only when the
// live head is known and strictly below the anchor.
import { describe, it, expect } from 'vitest';

import {
  isDroppedBlockParam,
  resolveAnchorNotice,
  searchSchema,
} from '@/views/Transactions/List';

const HEAD = 18_000_000n;

describe('searchSchema block param', () => {
  it('drops a non-numeric ?block= to undefined (the .catch contract)', () => {
    expect(searchSchema.parse({ block: 'abc' }).block).toBeUndefined();
  });

  it('drops a negative ?block= (min(0) rejection caught)', () => {
    expect(searchSchema.parse({ block: '-5' }).block).toBeUndefined();
  });

  it('keeps a valid anchor and coerces it to a number', () => {
    expect(searchSchema.parse({ block: '18000000' }).block).toBe(18000000);
  });

  it('coerces an empty ?block= to 0 — a genesis anchor, not malformed', () => {
    expect(searchSchema.parse({ block: '' }).block).toBe(0);
  });
});

describe('isDroppedBlockParam', () => {
  it('flags a raw param whose parse was dropped', () => {
    expect(isDroppedBlockParam('abc', undefined)).toBe(true);
    expect(isDroppedBlockParam('-5', undefined)).toBe(true);
  });

  it('does not flag a param that parsed', () => {
    expect(isDroppedBlockParam('18000000', 18000000)).toBe(false);
    // Empty string coerces to a valid genesis anchor (see schema tests).
    expect(isDroppedBlockParam('', 0)).toBe(false);
  });

  it('does not flag an absent param (the default latest view)', () => {
    expect(isDroppedBlockParam(null, undefined)).toBe(false);
  });
});

describe('resolveAnchorNotice', () => {
  it('returns no notice for an unanchored view', () => {
    expect(resolveAnchorNotice({ invalidBlockDropped: false, blockParam: undefined, liveHead: HEAD })).toBeNull();
  });

  it('returns no notice while the live head is unknown, whatever the anchor', () => {
    // No verdict without a head to compare against — never a guess.
    expect(
      resolveAnchorNotice({ invalidBlockDropped: false, blockParam: 99_999_999, liveHead: null }),
    ).toBeNull();
  });

  it('returns no notice for an anchor at or below the live head', () => {
    expect(resolveAnchorNotice({ invalidBlockDropped: false, blockParam: 18_000_000, liveHead: HEAD })).toBeNull();
    expect(resolveAnchorNotice({ invalidBlockDropped: false, blockParam: 17_999_999, liveHead: HEAD })).toBeNull();
  });

  it('flags an anchor strictly beyond the live head with its number', () => {
    expect(
      resolveAnchorNotice({ invalidBlockDropped: false, blockParam: 18_000_001, liveHead: HEAD }),
    ).toEqual({ kind: 'future-anchor', block: 18_000_001 });
  });

  it('flags a genesis chain head correctly (block 0 at head 0 is produced)', () => {
    expect(resolveAnchorNotice({ invalidBlockDropped: false, blockParam: 0, liveHead: 0n })).toBeNull();
    expect(resolveAnchorNotice({ invalidBlockDropped: false, blockParam: 1, liveHead: 0n })).toEqual({
      kind: 'future-anchor',
      block: 1,
    });
  });

  it('prioritizes the dropped-malformed verdict over everything else', () => {
    // The conditions are exclusive by construction (a dropped param never
    // reaches the future-anchor branch), but the ordering is the
    // resolver's contract: invalid wins whenever it is latched.
    expect(
      resolveAnchorNotice({ invalidBlockDropped: true, blockParam: undefined, liveHead: HEAD }),
    ).toEqual({ kind: 'invalid-block' });
    expect(
      resolveAnchorNotice({ invalidBlockDropped: true, blockParam: undefined, liveHead: null }),
    ).toEqual({ kind: 'invalid-block' });
  });
});
