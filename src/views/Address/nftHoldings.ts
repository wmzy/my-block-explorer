// NFT holdings aggregated from decoded participant-mode token-transfer
// rows: which NFT contracts the viewed address plausibly still holds,
// per the scanned window only. Honest by construction — a partial scan
// window can miss pre-window acquisitions, so every consumer renders the
// results with an incompleteness caveat.
//
// In/out is derived from the row's from/to against the viewed address
// (NOT the backend `direction` field): the pure function stays correct
// even if a caller feeds rows whose direction tag is stale or absent.
import { parseDecimalInteger, type SharedTokenClass } from '@/views/Address/holdings';
import type { TokenTransfer } from '@/services/tokenTransfers';

/** One ERC-1155 id currently held (net > 0) with its exact net amount. */
export type Nft1155Balance = { tokenId: string; amount: bigint };

export type NftContractHolding =
  | {
    standard: 'erc721';
    /** First-seen spelling of the contract address. */
    contract: string;
    /** Held token ids (net-positive count), ascending id order. */
    heldIds: string[];
    heldCount: number;
    /** First 3 of heldIds — display samples, never a claim of totality. */
    sampleIds: string[];
    lastActivityBlock: number;
  }
  | {
    standard: 'erc1155';
    contract: string;
    /** Currently-held slots (net > 0), ascending id order. */
    balances: Nft1155Balance[];
    heldCount: number;
    /** Exact sum of the held amounts (base units, BigInt — never floats). */
    totalUnits: bigint;
    sampleIds: string[];
    lastActivityBlock: number;
    /**
       * Some id netted NEGATIVE in-window (more sent than received —
       * typically a pre-window acquisition the partial scan cannot see).
       * Such ids are reported as not held rather than with a fabricated
       * negative amount; this flag makes the clamp visible.
       */
    dataInconsistent: boolean;
  };

export type NftHoldings = {
  /** One entry per (contract, standard) with at least one contributing row. */
  holdings: NftContractHolding[];
  /** Shared-signature rows whose ERC-20 vs ERC-721 standard stayed unknown. */
  unclassifiedTransfers: number;
};

// Ascending token-id order: numeric ids compare by value and sort before
// everything else; the remainder compare lexicographically. Twin of
// holdings.ts's private comparator (same semantics, kept local — the
// sibling module's export surface is owned by its own callers).
const DECIMAL_INTEGER = /^\d+$/;

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

// Per-(contract, standard) accumulation state. `contract` keeps the
// first-seen spelling for output; rows group by the lowercased address.
type Nft721Group = {
  standard: 'erc721';
  contract: string;
  /** Per-id receive(+1)/send(-1) counts; held ⇔ count > 0. */
  counts: Map<string, number>;
  lastActivityBlock: number;
};

type Nft1155Group = {
  standard: 'erc1155';
  contract: string;
  /** Per-id BigInt amount deltas (in adds, out subtracts). */
  nets: Map<string, bigint>;
  lastActivityBlock: number;
};

type NftGroup = Nft721Group | Nft1155Group;

function compareHoldings(a: NftContractHolding, b: NftContractHolding): number {
  if (a.heldCount !== b.heldCount) return b.heldCount - a.heldCount;
  const contractA = a.contract.toLowerCase();
  const contractB = b.contract.toLowerCase();
  if (contractA !== contractB) return contractA < contractB ? -1 : 1;
  // Same address under both standards (pathological data): stable order.
  return a.standard === b.standard ? 0 : a.standard < b.standard ? -1 : 1;
}

/**
 * Aggregate currently-held NFT positions per contract.
 *
 * ERC-721: set semantics per token id — an id is held when its in-window
 * receive/send count nets positive; ids that cancel out (or were only
 * sent) are not held.
 *
 * ERC-1155: BigInt-exact amount deltas per (contract, tokenId); a net of
 * zero means not held, and a negative net is clamped to "not held" with
 * the contract flagged `dataInconsistent` (a balance can never be
 * negative — the window is simply incomplete, and that stays visible
 * instead of being silently papered over).
 *
 * Shared-signature rows (ERC-20/721 share the Transfer topic0) consult
 * the injected classifier: 'erc20' rows are known non-NFTs (ignored
 * silently), 'erc721' rows feed the set math, and 'unknown' rows are
 * skipped but counted in `unclassifiedTransfers`.
 */
export function aggregateNftHoldings(
  transfers: readonly TokenTransfer[],
  address: string,
  classifyShared: (token: string) => SharedTokenClass,
): NftHoldings {
  const target = address.toLowerCase();
  const groups = new Map<string, NftGroup>();
  let unclassifiedTransfers = 0;

  for (const transfer of transfers) {
    // Party check first: a row where the address is neither sender nor
    // recipient (e.g. a token-mode row) says nothing about its holdings.
    const isRecipient = transfer.to.toLowerCase() === target;
    const isSender = transfer.from.toLowerCase() === target;
    if (!isRecipient && !isSender) continue;

    if (transfer.standard === 'erc1155-single' || transfer.standard === 'erc1155-batch') {
      // One single log = one (id, amount) slot (raw value as the fallback
      // for a missing amount); one batch log = a zipped id/amount list.
      // Slots parse FIRST: a row whose amounts never parse carries no
      // holding signal and must not even create the group.
      const slots: readonly { tokenId: string; amount: string }[] =
        transfer.standard === 'erc1155-single'
          ? [{ tokenId: transfer.tokenIds?.[0] ?? '?', amount: transfer.amounts?.[0] ?? transfer.value }]
          : (transfer.tokenIds ?? []).map((tokenId, i) => ({
              tokenId,
              amount: transfer.amounts?.[i] ?? '',
            }));
      const contributions: { tokenId: string; delta: bigint }[] = [];
      for (const { tokenId, amount } of slots) {
        const parsed = parseDecimalInteger(amount);
        if (parsed === null) continue;
        // Each party branch contributes its own sign (a self-transfer
        // nets to zero naturally).
        contributions.push({
          tokenId,
          delta: (isRecipient ? parsed : 0n) - (isSender ? parsed : 0n),
        });
      }
      if (contributions.length === 0) continue;
      const group = groupOf(groups, transfer, 'erc1155') as Nft1155Group;
      for (const { tokenId, delta } of contributions) {
        group.nets.set(tokenId, (group.nets.get(tokenId) ?? 0n) + delta);
      }
      continue;
    }

    // Shared ERC-20/721 signature: only classified-721 rows are NFT rows.
    const classification = classifyShared(transfer.token);
    if (classification === 'erc20') continue;
    if (classification === 'unknown') {
      unclassifiedTransfers += 1;
      continue;
    }
    const group = groupOf(groups, transfer, 'erc721') as Nft721Group;
    // Self-transfers hit both party branches and net to zero naturally —
    // each branch contributes its own sign, no special-casing.
    const id = transfer.value; // the token id for ERC-721 Transfer logs
    group.counts.set(
      id,
      (group.counts.get(id) ?? 0) + (isRecipient ? 1 : 0) - (isSender ? 1 : 0),
    );
  }

  const holdings: NftContractHolding[] = [];
  for (const group of groups.values()) {
    if (group.standard === 'erc721') {
      const heldIds = [...group.counts]
        .filter(([, count]) => count > 0)
        .map(([id]) => id)
        .sort(compareTokenIds);
      holdings.push({
        standard: 'erc721',
        contract: group.contract,
        heldIds,
        heldCount: heldIds.length,
        sampleIds: heldIds.slice(0, 3),
        lastActivityBlock: group.lastActivityBlock,
      });
      continue;
    }
    const balances: Nft1155Balance[] = [];
    let dataInconsistent = false;
    for (const [tokenId, net] of group.nets) {
      if (net > 0n) balances.push({ tokenId, amount: net });
      else if (net < 0n) dataInconsistent = true;
    }
    balances.sort((a, b) => compareTokenIds(a.tokenId, b.tokenId));
    let totalUnits = 0n;
    for (const { amount } of balances) totalUnits += amount;
    holdings.push({
      standard: 'erc1155',
      contract: group.contract,
      balances,
      heldCount: balances.length,
      totalUnits,
      sampleIds: balances.map(balance => balance.tokenId).slice(0, 3),
      lastActivityBlock: group.lastActivityBlock,
      dataInconsistent,
    });
  }
  return { holdings: holdings.sort(compareHoldings), unclassifiedTransfers };
}

/** Lazily create/lookup the accumulation group for (bucket, contract). */
function groupOf(
  groups: Map<string, NftGroup>,
  transfer: TokenTransfer,
  bucket: 'erc721' | 'erc1155',
): NftGroup {
  const key = `${bucket}:${transfer.token.toLowerCase()}`;
  let group = groups.get(key);
  if (group === undefined) {
    group =
      bucket === 'erc721'
        ? { standard: 'erc721', contract: transfer.token, counts: new Map(), lastActivityBlock: transfer.blockNumber }
        : { standard: 'erc1155', contract: transfer.token, nets: new Map(), lastActivityBlock: transfer.blockNumber };
    groups.set(key, group);
  } else {
    group.lastActivityBlock = Math.max(group.lastActivityBlock, transfer.blockNumber);
  }
  return group;
}
