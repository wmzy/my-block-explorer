// Approximate token holdings aggregated from decoded token-transfer rows.
//
// Honest by construction: these nets only reflect the rows that were
// scanned and decoded (coverage may be partial), not an indexer-backed
// truth. Callers render the results with an incompleteness caveat.
import type { TokenTransfer } from '@/services/tokenTransfers';

export type SharedTokenClass = 'erc20' | 'erc721' | 'unknown';

export type TokenHolding =
  | { kind: 'erc20'; token: string; net: bigint; transferCount: number }
  | { kind: 'erc721'; token: string; heldIds: string[]; transferCount: number }
  | { kind: 'erc1155'; token: string; tokenId: string; net: bigint; transferCount: number }
  | { kind: 'unclassified'; token: string; net: bigint; transferCount: number };

// Strict decimal-integer parsing: rejects empty strings, signs, and 0x hex.
// Exported for the token-overview holders computation (same strictness).
const DECIMAL_INTEGER = /^\d+$/;

export function parseDecimalInteger(raw: string): bigint | null {
  return DECIMAL_INTEGER.test(raw) ? BigInt(raw) : null;
}

/**
 * Ascending token-id order: numeric ids compare by value and sort before
 * everything else; the remainder compare lexicographically.
 */
function compareTokenIds(a: string, b: string): number {
  const aNumeric = DECIMAL_INTEGER.test(a);
  const bNumeric = DECIMAL_INTEGER.test(b);
  if (aNumeric && bNumeric) {
    const aValue = BigInt(a);
    const bValue = BigInt(b);
    if (aValue !== bValue) return aValue < bValue ? -1 : 1;
    return 0;
  }
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Per-token accumulation state. Rows group by the lowercased token address;
// `token` keeps the first-seen spelling for output. Buckets are allocated
// lazily: a token's rows only ever touch the buckets its standards need.
type TokenGroup = {
  token: string;
  /** Contributing rows across every standard; shared by all entries. */
  transferCount: number;
  classification: SharedTokenClass | null;
  erc20Net: bigint;
  unclassifiedNet: bigint;
  erc721Counts: Map<string, number> | null;
  erc1155Nets: Map<string, bigint> | null;
};

function createGroup(token: string): TokenGroup {
  return {
    token,
    transferCount: 0,
    classification: null,
    erc20Net: 0n,
    unclassifiedNet: 0n,
    erc721Counts: null,
    erc1155Nets: null,
  };
}

function erc721CountsOf(group: TokenGroup): Map<string, number> {
  group.erc721Counts ??= new Map();
  return group.erc721Counts;
}

function erc1155NetsOf(group: TokenGroup): Map<string, bigint> {
  group.erc1155Nets ??= new Map();
  return group.erc1155Nets;
}

function compareHoldings(a: TokenHolding, b: TokenHolding): number {
  if (a.transferCount !== b.transferCount) return b.transferCount - a.transferCount;
  const tokenA = a.token.toLowerCase();
  const tokenB = b.token.toLowerCase();
  if (tokenA !== tokenB) return tokenA < tokenB ? -1 : 1;
  // Multiple erc1155 ids under one token: strongest absolute net first,
  // then ascending id order.
  if (a.kind === 'erc1155' && b.kind === 'erc1155') {
    const absA = a.net < 0n ? -a.net : a.net;
    const absB = b.net < 0n ? -b.net : b.net;
    if (absA !== absB) return absA > absB ? -1 : 1;
    return compareTokenIds(a.tokenId, b.tokenId);
  }
  return 0;
}

/**
 * How one transfer row moves the holder's balance: +1 received, -1 sent.
 *
 * 0 means the row moves nothing — a self-transfer (both parties are the
 * holder) or a row the holder is not party to (a token-mode mint/burn).
 * null means the row cannot be attributed at all, which happens only when
 * no holder was supplied: the fallback then reads the server's `direction`
 * tag, which is lossy for exactly the self-transfer rows (the backend
 * collapses them to one 'out' row).
 */
function nettingSign(transfer: TokenTransfer, target: string | undefined): bigint | null {
  if (target === undefined) return transfer.direction === 'in' ? 1n : -1n;
  const received = transfer.to.toLowerCase() === target;
  const sent = transfer.from.toLowerCase() === target;
  if (received && sent) return 0n;
  if (received) return 1n;
  if (sent) return -1n;
  return 0n;
}

export function aggregateTokenHoldings(
  transfers: readonly TokenTransfer[],
  classifyShared: (token: string) => SharedTokenClass,
  // The address whose holdings are being aggregated. In/out is derived from
  // the row's from/to against THIS address, never from the server's
  // `direction` field: the backend scans each event shape twice (once by
  // `from`, once by `to`) and collapses a self-transfer to a SINGLE row
  // tagged 'out' (TokenTransferService: "the outgoing query runs before the
  // incoming one"). Reading that tag as a net direction charged a
  // self-transfer as a full outflow — an ERC-20 balance went negative and
  // an ERC-721 id the address still held dropped out of the list. Both
  // sibling aggregators already net from/to for this reason
  // (nftHoldings.ts, tokenOverview.ts). Optional so a caller that only
  // wants the tag-based netting can still pass one.
  holder?: string,
): TokenHolding[] {
  const groups = new Map<string, TokenGroup>();
  const target = holder?.toLowerCase();

  for (const transfer of transfers) {
    const key = transfer.token.toLowerCase();
    let group = groups.get(key);
    if (group === undefined) {
      group = createGroup(transfer.token);
      groups.set(key, group);
    }
    // +1 received, -1 sent, 0 for a self-transfer (both parties are the
    // holder) and for a row where the holder is not a party at all (a
    // token-mode mint/burn, which says nothing about this address).
    const sign = nettingSign(transfer, target);
    if (sign === null) continue;

    switch (transfer.standard) {
      case 'erc1155-single': {
        // One TransferSingle log: a single (tokenId, amount) slot, with the
        // raw value as a fallback for a missing amount.
        const tokenId = transfer.tokenIds?.[0] ?? '?';
        const amount = parseDecimalInteger(transfer.amounts?.[0] ?? transfer.value);
        if (amount === null) break; // unparseable amount: the row contributes nothing
        const nets = erc1155NetsOf(group);
        nets.set(tokenId, (nets.get(tokenId) ?? 0n) + sign * amount);
        group.transferCount += 1;
        break;
      }
      case 'erc1155-batch': {
        // Zip ids with amounts; unparseable or missing slots are skipped and
        // mismatched array lengths take the shorter side.
        const ids = transfer.tokenIds;
        const amounts = transfer.amounts;
        if (ids === undefined || amounts === undefined) break;
        const length = Math.min(ids.length, amounts.length);
        let contributed = false;
        const nets = erc1155NetsOf(group);
        for (let i = 0; i < length; i += 1) {
          const amount = parseDecimalInteger(amounts[i]);
          if (amount === null) continue;
          nets.set(ids[i], (nets.get(ids[i]) ?? 0n) + sign * amount);
          contributed = true;
        }
        if (contributed) group.transferCount += 1;
        break;
      }
      case 'erc20-or-erc721': {
        // The Transfer signature is shared by ERC-20 and ERC-721; the
        // injected classifier decides which bucket each token lands in.
        group.classification ??= classifyShared(group.token);
        const classification = group.classification;
        if (classification === 'erc721') {
          // value is the token id; the direction adjusts a held-count
          // multiset (a self-transfer adjusts it by zero).
          const counts = erc721CountsOf(group);
          const id = transfer.value;
          counts.set(id, (counts.get(id) ?? 0) + (sign === 1n ? 1 : sign === -1n ? -1 : 0));
          group.transferCount += 1;
        } else {
          const amount = parseDecimalInteger(transfer.value);
          if (amount === null) break; // unparseable value: the row contributes nothing
          if (classification === 'erc20') {
            group.erc20Net += sign * amount;
          } else {
            group.unclassifiedNet += sign * amount;
          }
          group.transferCount += 1;
        }
        break;
      }
    }
  }

  const holdings: TokenHolding[] = [];
  for (const group of groups.values()) {
    if (group.erc20Net !== 0n) {
      holdings.push({
        kind: 'erc20',
        token: group.token,
        net: group.erc20Net,
        transferCount: group.transferCount,
      });
    }
    if (group.unclassifiedNet !== 0n) {
      holdings.push({
        kind: 'unclassified',
        token: group.token,
        net: group.unclassifiedNet,
        transferCount: group.transferCount,
      });
    }
    if (group.erc721Counts !== null) {
      const heldIds = [...group.erc721Counts]
        .filter(([, count]) => count > 0)
        .map(([id]) => id)
        .sort(compareTokenIds);
      if (heldIds.length > 0) {
        holdings.push({
          kind: 'erc721',
          token: group.token,
          heldIds,
          transferCount: group.transferCount,
        });
      }
    }
    if (group.erc1155Nets !== null) {
      for (const [tokenId, net] of group.erc1155Nets) {
        if (net !== 0n) {
          holdings.push({
            kind: 'erc1155',
            token: group.token,
            tokenId,
            net,
            transferCount: group.transferCount,
          });
        }
      }
    }
  }
  return holdings.sort(compareHoldings);
}

// ---------------------------------------------------------------------------
// USD estimate (browser-side DefiLlama price layer)
// ---------------------------------------------------------------------------

// Price-observation subset the estimate consumes (structural twin of
// services/prices' UsdPriceSnapshot — kept structural so this module
// stays dependency-free and directly testable).
export type UsdPriceLike = { usd: number; fetchedAt: number };

/** What the holdings card needs to render an estimated USD total. */
export type HoldingsUsdEstimate = {
  /** Sum over the rows that resolved a usable price. */
  totalUsd: number;
  /** ERC-20 rows included in the total. */
  pricedTokens: number;
  /** All ERC-20 rows — the estimate's eligible universe. */
  erc20Tokens: number;
  /** Newest price fetch backing the total (tooltip/staleness gate). */
  fetchedAt: number;
};

/**
 * Estimated USD total over discovered ERC-20 holdings rows. A row
 * contributes only when BOTH its decimals and a usable price are known —
 * never a guessed decimal shift, never a guessed price. Returns null
 * when no row priced (the card renders nothing, per the honesty
 * contract). Float multiply at display precision only; rounding happens
 * in the renderer.
 */
export function estimateHoldingsUsd(
  rows: ReadonlyArray<{
    amount: bigint;
    decimals: number | undefined;
    price: UsdPriceLike | null | undefined;
  }>,
): HoldingsUsdEstimate | null {
  const estimate: HoldingsUsdEstimate = {
    totalUsd: 0,
    pricedTokens: 0,
    erc20Tokens: rows.length,
    fetchedAt: 0,
  };

  for (const row of rows) {
    if (row.decimals === undefined) continue;
    if (row.price === null || row.price === undefined) continue;
    estimate.totalUsd += (Number(row.amount) / 10 ** row.decimals) * row.price.usd;
    estimate.pricedTokens += 1;
    if (row.price.fetchedAt > estimate.fetchedAt) {
      estimate.fetchedAt = row.price.fetchedAt;
    }
  }

  return estimate.pricedTokens === 0 ? null : estimate;
}
