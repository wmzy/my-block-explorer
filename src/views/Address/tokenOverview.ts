// Pure computation for the address page's Token Overview card: the
// classification of one contract's name()/symbol()/decimals()/totalSupply()
// reads (fetched by services/tokenMetadata.ts through Multicall3), the
// supply formatting, and the discovered-holders aggregation from the view's
// token-transfer scan rows.
//
// Honest by construction: "ERC-20" is claimed only when decimals() AND
// totalSupply() both responded; any other responding probe reads as a token
// of unknown standard; a contract where nothing responded is not a token
// (null — the caller renders nothing). Holder nets only reflect the rows
// that were scanned (coverage may be partial) — callers must render the
// incompleteness caveat.
import { formatUnits } from 'viem';

import type { TokenTransfer } from '@/services/tokenTransfers';
import { parseDecimalInteger } from '@/views/Address/holdings';

/** Settled per-probe reads; null = that call reverted or returned nothing. */
export type TokenOverviewReadsInput = {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
} | undefined;

/** Classified token-ness of the contract; fields stay exactly as read. */
export type TokenClassification = {
  /** True only when decimals AND totalSupply both responded. */
  isErc20: boolean;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
};

/**
 * Classify one contract's token reads. Returns null when the reads are
 * unsettled (still loading or transport-level failure) or when no probe
 * responded — a plain contract, rendered as nothing, never as an error.
 */
export function classifyTokenOverview(
  reads: TokenOverviewReadsInput,
): TokenClassification | null {
  if (reads === undefined) return null;
  if (reads.decimals !== null && reads.totalSupply !== null) {
    return { isErc20: true, ...reads };
  }
  // Some probe responded but decimals+totalSupply did not BOTH respond:
  // a token whose standard is unproven (the classic shape is name/symbol
  // responding while decimals() reverts — an ERC-721). Individual lines
  // stay visible exactly when their probe responded.
  if (
    reads.name !== null ||
    reads.symbol !== null ||
    reads.decimals !== null ||
    reads.totalSupply !== null
  ) {
    return { isErc20: false, ...reads };
  }
  return null;
}

/**
 * Format a total supply BigInt-exactly with the TOKEN's own decimals —
 * never the chain's native-currency decimals. Unknown decimals keep the
 * raw base units (a guessed divisor would fabricate the amount).
 */
export function formatTokenSupply(totalSupply: bigint, decimals: number | null): string {
  return decimals !== null ? formatUnits(totalSupply, decimals) : totalSupply.toString();
}

/** One participant's discovered net balance of the viewed token. */
export type DiscoveredHolder = { address: string; net: bigint };

/** Aggregated scan result for the viewed token's participants. */
export type DiscoveredHolders = {
  /** Discovered nets, strongest first, capped at the requested limit. */
  holders: DiscoveredHolder[];
  /** Rows of this token excluded from balances: ERC-721-classified ids,
   * ERC-1155 rows and unparseable values — reported, never silently lost. */
  excludedTransfers: number;
};

// Mint/burn sentinel: the zero address participates in supply changes but
// holds nothing, so it is never a holder row.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Compute net per-participant balances of ONE token from scanned transfer
 * rows, BigInt-exactly. Only ERC-20 semantics contribute: rows of other
 * tokens are ignored entirely, and this token's non-ERC-20 rows (ERC-721
 * token ids, ERC-1155 amounts, unparseable values) are counted into
 * excludedTransfers instead of being summed into balances. Participants
 * whose nets cancel to zero drop out; ordering is net descending, then
 * address ascending for determinism.
 *
 * Rows may come from EITHER scan mode: token-mode rows (the viewed
 * contract as log emitter) already carry token === address and a
 * 'none' direction, which this netting ignores — from/to drive it
 * exclusively. Direction 'none' rows net exactly like participant rows.
 */
export function computeDiscoveredHolders(
  transfers: readonly TokenTransfer[],
  token: string,
  isErc20: boolean,
  limit = 5,
): DiscoveredHolders {
  const tokenLower = token.toLowerCase();
  const nets = new Map<string, bigint>();
  let excludedTransfers = 0;

  const apply = (participant: string, delta: bigint): void => {
    if (participant === ZERO_ADDRESS) return;
    nets.set(participant, (nets.get(participant) ?? 0n) + delta);
  };

  for (const transfer of transfers) {
    if (transfer.token.toLowerCase() !== tokenLower) continue;
    if (!isErc20 || transfer.standard !== 'erc20-or-erc721') {
      // Balances are ERC-20-only semantics: id-carrying rows never sum.
      excludedTransfers += 1;
      continue;
    }
    const amount = parseDecimalInteger(transfer.value);
    if (amount === null) {
      excludedTransfers += 1;
      continue;
    }
    apply(transfer.from, -amount);
    apply(transfer.to, amount);
  }

  const holders = [...nets.entries()]
    .filter(([, net]) => net !== 0n)
    .map(([address, net]) => ({ address, net }))
    .sort((a, b) => (b.net !== a.net ? (b.net > a.net ? 1 : -1) : a.address < b.address ? -1 : 1))
    .slice(0, limit);
  return { holders, excludedTransfers };
}
