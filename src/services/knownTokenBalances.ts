// Known-token balance service: the address page's live "Known Tokens"
// section. ONE Multicall3 batch of balanceOf reads against a small curated
// per-chain list (config/knownTokens) — cheap enough to fire for every
// address (EOA and contract alike), and independent of the transfers scan
// so an address with no discovered history still gets real balances.
//
// Honesty contract: the payload names how many tokens were checked; rows
// carry only balances the chain actually answered (reverted per-call slots
// are skipped, never guessed as zero — although a reverted balanceOf on a
// curated ERC-20 is exotic, saying "0" would fabricate a holding verdict).
// A transport-level failure REJECTS (unlike tokenMetadata's never-throw
// layer) so the query hook surfaces an error the view renders as silent
// absence — this mirrors how addressRealTime failures degrade, per the
// live-RPC surface convention. symbol/decimals truth resolves at runtime
// in the view through the transfers tab's session metadata cache; nothing
// here hardcodes metadata.
//
// The shaping logic (zero-filter, ordering, cap+remainder) lives as
// exported pure functions precisely so it is unit-testable without any
// RPC or hook harness.
import { parseAbi, type Address, type ContractFunctionParameters } from 'viem';

import { knownTokensForChain } from '@/config/knownTokens';
import { createRpcClient } from '@/utils/realTimeData';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// Canonical Multicall3 deployment (same constant as
// services/tokenMetadata.ts): the viem client built by utils/realTimeData
// is not tied to a single chain type, so viem cannot infer the multicall
// address from chain config — pass it explicitly.
const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

const balanceOfAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);

/** One held known token: the curated (checksummed) address + live balance. */
export type KnownTokenBalance = {
  address: string;
  balance: bigint;
};

/** Settled payload of one address's known-token check. */
export type KnownTokenBalancesPage = {
  chainId: number;
  /** Lowercased owner — the cache identity used for the read. */
  address: string;
  /** How many curated tokens the batch checked (the honesty numerator). */
  checked: number;
  /** Non-zero balances only, in curated-list order (shaping is the view's job). */
  balances: KnownTokenBalance[];
};

// Narrows one viem multicall outcome to its bigint value. With
// allowFailure, viem wraps each result as { status: 'success', result }
// or { status: 'failure', error }; test doubles may hand back a bare
// null for a reverted call. Anything unrecognized decodes to null — the
// row is then skipped, never invented.
const readMulticallBigint = (outcome: unknown): bigint | null => {
  if (typeof outcome !== 'object' || outcome === null || !('status' in outcome)) {
    return null;
  }
  const record: { status: unknown; result?: unknown } = outcome;
  if (record.status !== 'success') return null;
  return typeof record.result === 'bigint' ? record.result : null;
};

/**
 * Read balanceOf for every curated token of the chain in ONE Multicall3
 * batch. Resolves undefined without a request for gated keys (chainId
 * <= 0 / blank address) and for chains without a curated list. A
 * transport-level failure rejects so the hook surfaces an error state.
 */
export async function fetchKnownTokenBalances(
  chainId: number,
  address: string,
): Promise<KnownTokenBalancesPage | undefined> {
  if (!(chainId > 0) || address.trim().length === 0) return undefined;
  const tokens = knownTokensForChain(chainId);
  if (tokens.length === 0) return undefined;

  const owner = address.trim().toLowerCase();
  const contracts: ContractFunctionParameters[] = tokens.map((token) => ({
    address: token.address,
    abi: balanceOfAbi,
    functionName: 'balanceOf',
    args: [owner],
  }));

  // Throws on transport-level failure (client creation or the multicall
  // request) — deliberate: the view degrades a live-RPC error to silence
  // instead of trusting a half-answer.
  const client = await createRpcClient(chainId);
  const outcomes = await client.multicall({
    contracts,
    allowFailure: true,
    multicallAddress: MULTICALL3_ADDRESS,
  });

  const balances: KnownTokenBalance[] = [];
  tokens.forEach((token, index) => {
    const value = readMulticallBigint(outcomes[index]);
    if (value !== null) {
      balances.push({ address: token.address, balance: value });
    }
  });

  return { chainId, address: owner, checked: tokens.length, balances };
}

// Live balances change every block → default 5min cache + default 2s
// staleTime (the addressRealTime convention for live-value queries).
export const knownTokenBalancesCache = createQueryCache<
  KnownTokenBalancesPage | undefined,
  [number, string]
>('known-token-balances');

const queryKnownTokenBalances = bindQueryFn(
  fetchKnownTokenBalances,
  knownTokenBalancesCache,
);

const useKnownTokenBalancesQuery = createQueryHook({
  queryFn: queryKnownTokenBalances,
});

/** Positional hook twin kept small like addressRealTime's. */
export function useKnownTokenBalances(chainId: number, address: string) {
  return useKnownTokenBalancesQuery([chainId, address]);
}

// ---------------------------------------------------------------------------
// Pure shaping (testable without RPC or hooks)
// ---------------------------------------------------------------------------

/**
 * Drop non-positive balances: a curated slot reading 0 (or a negative,
 * which balanceOf cannot produce) is "not held", not a row. Order is
 * preserved — ordering is the next pure step's job.
 */
export function filterNonZeroKnownTokenBalances(
  rows: readonly KnownTokenBalance[],
): KnownTokenBalance[] {
  return rows.filter((row) => row.balance > 0n);
}

/**
 * Display order: rows with a known USD value first (descending value),
 * then unpriced rows by raw balance (descending). `usdOf` returns the
 * row's USD value or null when it cannot be computed (no price snapshot
 * or no decimals yet) — injected so pricing stays out of the comparator.
 * Ties keep input (curated-list) order.
 */
export function orderKnownTokenRows(
  rows: readonly KnownTokenBalance[],
  usdOf: (row: KnownTokenBalance) => number | null,
): KnownTokenBalance[] {
  const stamped = rows.map((row, index) => ({
    row,
    index,
    usd: usdOf(row),
  }));
  stamped.sort((a, b) => {
    const aPriced = a.usd !== null;
    const bPriced = b.usd !== null;
    if (aPriced && bPriced) return (b.usd as number) - (a.usd as number);
    if (aPriced !== bPriced) return aPriced ? -1 : 1;
    if (a.row.balance !== b.row.balance) {
      return a.row.balance > b.row.balance ? -1 : 1;
    }
    return a.index - b.index;
  });
  return stamped.map((entry) => entry.row);
}

/** Display cap for the Known Tokens section. */
export const KNOWN_TOKEN_ROW_CAP = 8;

/** Cap + honest remainder: `shown` is at most `cap` rows, `hidden` counts the rest. */
export function capKnownTokenRows(
  rows: readonly KnownTokenBalance[],
  cap: number = KNOWN_TOKEN_ROW_CAP,
): { shown: KnownTokenBalance[]; hidden: number } {
  const clamped = Math.max(0, Math.floor(cap));
  const shown = rows.slice(0, clamped);
  return { shown, hidden: Math.max(0, rows.length - shown.length) };
}
