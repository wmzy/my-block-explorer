// Section-anchor derivation for the Address view: the sticky chip row's
// content contract. The derivation is the single source of the href="#…"
// ids, the per-tab activity label, the page-order chip sequence, the
// exclusion of sections absent from the DOM, and the hide-when-useless
// (≤1 entry) rule — all pinned here so the view wiring can drift nowhere
// silently.
import { describe, it, expect } from 'vitest';
import {
  deriveAddressSectionAnchors,
  ACTIVITY_ANCHOR_ID,
  APPROVALS_ANCHOR_ID,
  KNOWN_TOKENS_ANCHOR_ID,
  NFT_HOLDINGS_ANCHOR_ID,
  OVERVIEW_ANCHOR_ID,
  TOKEN_HOLDINGS_ANCHOR_ID,
  type AddressActivityTab,
  type AddressSectionPresence,
} from '@/views/Address/sectionAnchors';

const ALL_PRESENT: AddressSectionPresence = {
  overview: true,
  approvals: true,
  tokenHoldings: true,
  nftHoldings: true,
  knownTokens: true,
};

const NONE_PRESENT: AddressSectionPresence = {
  overview: false,
  approvals: false,
  tokenHoldings: false,
  nftHoldings: false,
  knownTokens: false,
};

describe('deriveAddressSectionAnchors', () => {
  it('lists every section in page order with the transactions tab label last', () => {
    expect(
      deriveAddressSectionAnchors('transactions', ALL_PRESENT),
    ).toEqual([
      { id: OVERVIEW_ANCHOR_ID, label: 'Overview' },
      { id: TOKEN_HOLDINGS_ANCHOR_ID, label: 'Token Holdings' },
      { id: KNOWN_TOKENS_ANCHOR_ID, label: 'Known Tokens' },
      { id: NFT_HOLDINGS_ANCHOR_ID, label: 'NFT Holdings' },
      { id: APPROVALS_ANCHOR_ID, label: 'Approvals' },
      { id: ACTIVITY_ANCHOR_ID, label: 'Transactions' },
    ]);
  });

  it.each([
    ['transfers', 'Token Transfers'],
    ['internal', 'Internal Txns'],
  ] as const)(
    'carries the active %s tab label on the single activity anchor',
    (tab: AddressActivityTab, expectedLabel: string) => {
      const anchors = deriveAddressSectionAnchors(tab, ALL_PRESENT);
      expect(anchors).toHaveLength(6);
      // Exactly ONE activity entry — the other tabs' content is not in
      // the DOM, so they are never linked.
      const activityChips = anchors.filter(a => a.id === ACTIVITY_ANCHOR_ID);
      expect(activityChips).toEqual([{ id: ACTIVITY_ANCHOR_ID, label: expectedLabel }]);
    },
  );

  it('excludes sections the page reports absent (missing sections are not linked)', () => {
    const anchors = deriveAddressSectionAnchors('transfers', {
      ...ALL_PRESENT,
      nftHoldings: false,
      knownTokens: false,
    });
    expect(anchors.map(a => a.id)).toEqual([
      OVERVIEW_ANCHOR_ID,
      TOKEN_HOLDINGS_ANCHOR_ID,
      APPROVALS_ANCHOR_ID,
      ACTIVITY_ANCHOR_ID,
    ]);
    expect(anchors.map(a => a.label)).toEqual([
      'Overview',
      'Token Holdings',
      'Approvals',
      'Token Transfers',
    ]);
  });

  it('keeps the row for two entries (one jump exists) but hides at one', () => {
    // Boundary: exactly two chips is the smallest useful row.
    const two = deriveAddressSectionAnchors('internal', {
      ...NONE_PRESENT,
      overview: true,
    });
    expect(two.map(a => a.label)).toEqual(['Overview', 'Internal Txns']);

    // Only the (always-rendering) activity card would be listed → [].
    expect(deriveAddressSectionAnchors('transactions', NONE_PRESENT)).toEqual([]);
    expect(deriveAddressSectionAnchors('transfers', NONE_PRESENT)).toEqual([]);
    expect(deriveAddressSectionAnchors('internal', NONE_PRESENT)).toEqual([]);
  });

  it('emits unique ids only (the href contract cannot collide in the DOM)', () => {
    const anchors = deriveAddressSectionAnchors('transactions', ALL_PRESENT);
    const ids = anchors.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
