// In-page section-anchor derivation for the Address view (a sticky chip
// row under the page header that jumps between the page's major
// sections). Pure by design: the view supplies only what it knows — the
// active activity tab plus which optional sections currently exist in
// the DOM — so the chip order, labels, and the hide-when-useless rule
// all live here, unit-tested in tests/unit/addressSectionAnchors.test.ts.
//
// Tab discipline: the activity card renders ONE tab's content at a time,
// so exactly one of Transactions / Token Transfers / Internal Txns is
// anchorable — the ACTIVE tab's label rides the single activity anchor,
// and the tab-inaccessible contents are never linked.
//
// Presence discipline: every emitted id must resolve to a real element
// at click time, so sections the page knows are absent (NFT Holdings and
// Known Tokens render nothing on empty/unsettled scans) are excluded
// here rather than shipping dead hrefs.

export type AddressActivityTab = 'transactions' | 'transfers' | 'internal';

/** One chip target; the id must exist in the DOM whenever it is emitted. */
export type SectionAnchor = {
  readonly id: string;
  readonly label: string;
};

/** Which optional sections currently exist in the DOM (page-derived). */
export type AddressSectionPresence = {
  /** The Overview card (all of its InfoGrid rows live inside it). */
  readonly overview: boolean;
  /** Token approvals card (renders for every valid address). */
  readonly approvals: boolean;
  /** "Token Holdings (discovered)" row inside the Overview card. */
  readonly tokenHoldings: boolean;
  /** NFT holdings row — only when the scanned window holds NFT rows. */
  readonly nftHoldings: boolean;
  /** Known Tokens row — only when the curated live check settled. */
  readonly knownTokens: boolean;
};

// Anchor ids live here so the view's target wrappers and the derived
// chips can never drift apart (one source of truth for href="#…").
export const OVERVIEW_ANCHOR_ID = 'address-overview';
export const TOKEN_HOLDINGS_ANCHOR_ID = 'address-token-holdings';
export const KNOWN_TOKENS_ANCHOR_ID = 'address-known-tokens';
export const NFT_HOLDINGS_ANCHOR_ID = 'address-nft-holdings';
export const APPROVALS_ANCHOR_ID = 'address-approvals';
export const ACTIVITY_ANCHOR_ID = 'address-activity';

// One activity card, three contents: the chip carries the active tab's
// label (the other tabs' content is not in the DOM, so it is not linked).
const ACTIVITY_TAB_LABELS: Readonly<Record<AddressActivityTab, string>> = {
  transactions: 'Transactions',
  transfers: 'Token Transfers',
  internal: 'Internal Txns',
};

/**
 * Derive the in-page anchor chips, in page order, for the active tab.
 * Returns [] when at most one section would be listed — a lone chip has
 * nothing to jump between, so the whole row hides instead.
 */
export function deriveAddressSectionAnchors(
  activityTab: AddressActivityTab,
  presence: AddressSectionPresence,
): SectionAnchor[] {
  const anchors: SectionAnchor[] = [];
  if (presence.overview) {
    anchors.push({ id: OVERVIEW_ANCHOR_ID, label: 'Overview' });
  }
  if (presence.tokenHoldings) {
    anchors.push({ id: TOKEN_HOLDINGS_ANCHOR_ID, label: 'Token Holdings' });
  }
  if (presence.knownTokens) {
    anchors.push({ id: KNOWN_TOKENS_ANCHOR_ID, label: 'Known Tokens' });
  }
  if (presence.nftHoldings) {
    anchors.push({ id: NFT_HOLDINGS_ANCHOR_ID, label: 'NFT Holdings' });
  }
  if (presence.approvals) {
    anchors.push({ id: APPROVALS_ANCHOR_ID, label: 'Approvals' });
  }
  // The activity card renders on every tab — its chip is unconditional
  // and always closes the row (the activity card is the page's tail).
  anchors.push({ id: ACTIVITY_ANCHOR_ID, label: ACTIVITY_TAB_LABELS[activityTab] });
  return anchors.length <= 1 ? [] : anchors;
}
