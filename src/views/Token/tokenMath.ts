// Pure computation for the token lens page: ranked discovered holders with
// share-of-discovered-supply percentages, and the mint/burn aggregation —
// both over the SAME token-mode scan rows the address page's holders math
// nets. The netting itself is reused, not forked (computeDiscoveredHolders
// from views/Address/tokenOverview); this module only ranks, shares and
// aggregates on top of it. BigInt-exact throughout: shares are computed
// with BigInt-scaled integer math (basis points), never through Number
// floats, so values past 2^53 stay exact.
//
// Honest by construction: every aggregate reflects only the scanned rows
// (coverage may be partial) — callers must render the discovered caveat.
import type { TokenTransfer } from '@/services/tokenTransfers';
import { parseDecimalInteger } from '@/views/Address/holdings';
import { computeDiscoveredHolders } from '@/views/Address/tokenOverview';

// Mint/burn sentinel (same constant as views/Address/tokenOverview.ts):
// the zero address participates in supply changes but holds nothing.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** One ranked holder: discovered net plus its share of the discovered supply. */
export type HolderShare = {
  address: string;
  net: bigint;
  /**
   * Share of the discovered supply in basis points, truncated (never
   * rounded up), or null when no share is meaningful — a negative net
   * (distributed more than received within the window) or an empty
   * discovered supply.
   */
  shareBps: number | null;
};

/** Ranked holders plus the aggregates the shares were computed against. */
export type RankedHolders = {
  /** Strongest nets first, capped at the requested count. */
  shares: HolderShare[];
  /** Sum of all POSITIVE discovered nets — the "discovered supply". */
  discoveredSupply: bigint;
  /** This token's rows excluded from balances (ids/amounts/unparseable). */
  excludedTransfers: number;
};

// computeDiscoveredHolders caps its output at `limit` AFTER netting; the
// shares below must divide by the FULL discovered supply (a top-N-only
// denominator would inflate every share). Participants are bounded by two
// per row (from + to), so twice the row count can never truncate the set.
const allParticipants = (transfers: readonly TokenTransfer[]): number =>
  Math.max(1, transfers.length * 2);

/**
 * Rank the discovered holders of ONE token from its token-mode scan rows
 * and compute each holder's share of the DISCOVERED supply — the sum of
 * all positive nets, never the on-chain totalSupply (the scan may cover
 * only part of the history, so totalSupply would fabricate precision).
 * The zero-address sentinel never ranks (existing convention: it holds
 * nothing). Reuses computeDiscoveredHolders for the netting itself.
 */
export function rankHolderShares(
  transfers: readonly TokenTransfer[],
  token: string,
  isErc20: boolean,
  topN = 10,
): RankedHolders {
  const full = computeDiscoveredHolders(
    transfers,
    token,
    isErc20,
    allParticipants(transfers),
  );
  let discoveredSupply = 0n;
  for (const holder of full.holders) {
    if (holder.net > 0n) discoveredSupply += holder.net;
  }
  const shares = full.holders.slice(0, topN).map((holder) => ({
    address: holder.address,
    net: holder.net,
    shareBps:
      holder.net > 0n && discoveredSupply > 0n
        ? Number((holder.net * 10_000n) / discoveredSupply)
        : null,
  }));
  return {
    shares,
    discoveredSupply,
    excludedTransfers: full.excludedTransfers,
  };
}

/** Mint/burn aggregates over one token's scanned Transfer rows. */
export type MintBurnTotals = {
  /** Transfer events emitted FROM the zero address (mints), any standard. */
  mintCount: number;
  /** Transfer events sent TO the zero address (burns), any standard. */
  burnCount: number;
  /**
   * ERC-20-semantics sum of minted base units, BigInt-exact — or null when
   * the token's standard is not ERC-20-proven (id-carrying rows would
   * fabricate an amount; the counts above stay honest without a sum).
   */
  minted: bigint | null;
  /** ERC-20-semantics sum of burned base units, or null (see `minted`). */
  burned: bigint | null;
  /**
   * Mint/burn rows whose values could not sum (this token's id-carrying
   * or unparseable rows) — reported, never silently lost.
   */
  excludedTransfers: number;
};

/**
 * Aggregate mint/burn activity of ONE token from its scan rows: a mint is
 * a Transfer FROM the zero address, a burn a Transfer TO it (the same
 * sentinel the holder netting excludes from balances). Counts cover every
 * row of the token — an event is a mint regardless of standard; amount
 * sums follow the holder math's ERC-20-only strictness: other tokens'
 * rows are ignored entirely, and this token's id-carrying or unparseable
 * rows count as events but never sum.
 */
export function aggregateMintBurn(
  transfers: readonly TokenTransfer[],
  token: string,
  isErc20: boolean,
): MintBurnTotals {
  const tokenLower = token.toLowerCase();
  let mintCount = 0;
  let burnCount = 0;
  let minted = 0n;
  let burned = 0n;
  let excludedTransfers = 0;

  for (const transfer of transfers) {
    if (transfer.token.toLowerCase() !== tokenLower) continue;
    const isMint = transfer.from === ZERO_ADDRESS;
    const isBurn = transfer.to === ZERO_ADDRESS;
    if (!isMint && !isBurn) continue;
    if (isMint) mintCount += 1;
    if (isBurn) burnCount += 1;
    if (!isErc20 || transfer.standard !== 'erc20-or-erc721') {
      // The event still counts; its value cannot sum (ids/amounts).
      excludedTransfers += 1;
      continue;
    }
    const amount = parseDecimalInteger(transfer.value);
    if (amount === null) {
      excludedTransfers += 1;
      continue;
    }
    if (isMint) minted += amount;
    if (isBurn) burned += amount;
  }

  return {
    mintCount,
    burnCount,
    minted: isErc20 ? minted : null,
    burned: isErc20 ? burned : null,
    excludedTransfers,
  };
}

/**
 * Render basis points as a percentage string ("61.11%"). Two decimals
 * always, so the BigInt division's truncation direction stays visible.
 */
export function formatSharePct(shareBps: number): string {
  const whole = Math.floor(shareBps / 100);
  const frac = shareBps % 100;
  return `${whole}.${String(frac).padStart(2, '0')}%`;
}
