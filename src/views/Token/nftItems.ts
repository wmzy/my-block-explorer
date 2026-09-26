// Pure derivation of the distinct NFT items the token page's token-mode
// scan rows evidence (the same first-page rows the holders and mint/burn
// cards net — zero extra scans). The row payload itself carries the log
// evidence: a shared-signature Transfer only proves an ERC-721 item when
// its indexed-topic count says so (logStandard 'erc721' — the backend
// read the tokenId straight from topics[3] because viem's ERC-20 decode
// returns no value against a 4-topic log, so the id rides `value` as a
// decimal string), while the ERC-1155 event families carry tokenIds/
// amounts arrays. Honest by construction: only rows whose shape PROVES
// an NFT transfer yield items — an ambiguous shared-signature row
// without topic evidence yields nothing (never a guessed item) — and
// every aggregate reflects the scanned window only. BigInt-exact
// throughout; values past 2^53 stay exact.
import type { TokenTransfer } from '@/services/tokenTransfers';
import { parseDecimalInteger } from '@/views/Address/holdings';

// Mint/burn sentinel (same constant as tokenMath/tokenOverview): the
// zero address participates in supply changes but holds nothing.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Display cap of the discovered-items grid, in first-seen order. */
export const NFT_ITEMS_LIMIT = 24;

/** One distinct NFT discovered in the scanned transfer rows. */
export type NftItem = {
  /** Which Transfer event shape evidenced the item. */
  standard: 'erc721' | 'erc1155';
  /** Plain decimal token id, exactly as the row carried it. */
  tokenId: string;
  /**
   * ERC-1155: the window's net units for this id — mints (from 0x0)
   * add, burns (to 0x0) subtract, plain transfers change nothing —
   * floored at 0 when burns exceeded mints. ERC-721: always 1n (one
   * non-fungible token, never summed).
   */
  amount: bigint;
  /**
   * ERC-1155 only: this id's window net went negative (more burned
   * than minted within the scanned window — pre-window supply may or
   * may not remain). The floored 0 plus this marker is the honest
   * rendering, never a fabricated supply.
   */
  burned: boolean;
};

/**
 * Derive the distinct NFT items of ONE token from its token-mode scan
 * rows, in first-seen row order, capped at `limit`. Known-ERC-20 rows
 * (logStandard 'erc20') and topic-less shared-signature rows yield
 * nothing; the caller separately skips the whole section when the
 * contract's standard is proven ERC-20. Row amounts are parsed
 * strictly — a malformed id or amount contributes nothing, never a
 * guess.
 */
export function deriveNftItems(
  transfers: readonly TokenTransfer[],
  token: string,
  limit = NFT_ITEMS_LIMIT,
): NftItem[] {
  const tokenLower = token.toLowerCase();
  const items: NftItem[] = [];
  const indexOf = new Map<string, number>();

  // Lookup-or-create for one id. Returns null when the id is new but the
  // cap is full (new ids stop; already-discovered ids keep netting), or
  // when a row's shape disagrees with the first-seen shape recorded for
  // the id (a contract emitting both 721- and 1155-shaped logs for one
  // id is non-standard — the other shape's amounts never aggregate onto
  // it, never a hybrid).
  const itemFor = (standard: 'erc721' | 'erc1155', tokenId: string): NftItem | null => {
    const existing = indexOf.get(tokenId);
    if (existing !== undefined) {
      return items[existing].standard === standard ? items[existing] : null;
    }
    if (items.length >= limit) return null;
    const item: NftItem = {
      standard,
      tokenId,
      amount: standard === 'erc721' ? 1n : 0n,
      burned: false,
    };
    items.push(item);
    indexOf.set(tokenId, items.length - 1);
    return item;
  };

  for (const transfer of transfers) {
    if (transfer.token.toLowerCase() !== tokenLower) continue;

    if (
      transfer.standard === 'erc1155-single' ||
      transfer.standard === 'erc1155-batch'
    ) {
      const ids = transfer.tokenIds ?? [];
      const amounts = transfer.amounts ?? [];
      // Mint adds, burn subtracts; a plain transfer moves units between
      // holders and nets nothing for supply.
      const sign =
        transfer.from === ZERO_ADDRESS
          ? 1n
          : transfer.to === ZERO_ADDRESS
            ? -1n
            : 0n;
      for (let i = 0; i < ids.length; i += 1) {
        // A single row's amount also rides `value` (pre-amounts payloads
        // stay renderable); a batch's `value` is the id count, never an
        // amount, so batch amounts have no fallback.
        const raw = transfer.standard === 'erc1155-single' ? (amounts[i] ?? transfer.value) : amounts[i];
        const amount = parseDecimalInteger(raw ?? '');
        if (amount === null) continue; // malformed pair: contributes nothing
        const item = itemFor('erc1155', ids[i]);
        if (item !== null) item.amount += sign * amount;
      }
      continue;
    }

    // Shared-signature Transfer: only the 4-topic shape (logStandard
    // 'erc721') proves an NFT row. 'erc20' and topic-less legacy rows
    // yield nothing — guessing an item from an ambiguous row would
    // fabricate it.
    if (transfer.logStandard === 'erc721') {
      const tokenId = parseDecimalInteger(transfer.value);
      if (tokenId !== null) itemFor('erc721', tokenId.toString());
    }
  }

  // Floor negative window nets once, at the end — flooring per row would
  // lose later mints against earlier burns (mint 5, burn 7, mint 3 nets
  // to +1, not 0).
  for (const item of items) {
    if (item.standard === 'erc1155' && item.amount < 0n) {
      item.amount = 0n;
      item.burned = true;
    }
  }

  return items;
}
