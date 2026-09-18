// Blocks-view finality service: the safe/finalized head lookups behind the
// per-block labels on the Blocks list and detail views.
//
// Post-Merge Ethereum nodes expose `safe` (justified by 2/3 of the stake)
// and `finalized` heads as block tags, but many public RPC endpoints do not
// implement them. Each tag therefore fails independently and degrades to
// undefined — never an error surfaced to the view, and never a wrong label:
// a block only earns a badge when the head it compares against is actually
// known (absence of data is not "pending").
import { createRpcClient } from '@/utils/realTimeData';
import { bindQueryFn, createQueryCache } from '@/util/useQuery';

import { createPolledQueryHook } from './polledQuery';

// Finality only advances at epoch boundaries (~6.4 min), so a 30s cadence is
// finer than strictly needed; it keeps the labels current shortly after a
// remount (fresh-window refetch) without hammering the RPC.
const FINALITY_HEADS_INTERVAL = 30_000;

export type FinalityHeads = {
  safe?: number;
  finalized?: number;
};

// One-shot warn guard, module-level on purpose: a node without tag support
// fails every poll, so a per-call console.warn would spam once per interval
// per tag. The message names the tag and the chain so operators can tell
// which endpoint lacks support.
const warnedTags = new Set<string>();

const warnTagUnavailable = (chainId: number, tag: 'safe' | 'finalized', reason: unknown) => {
  const key = `${chainId}:${tag}`;
  if (warnedTags.has(key)) return;
  warnedTags.add(key);
  console.warn(
    `Finality tag "${tag}" unavailable on chain ${chainId}: ${tag} labels stay hidden for this chain.`,
    reason,
  );
};

/**
 * Look up the chain's current safe/finalized block numbers via the cached
 * RPC client. Each tag resolves independently; a failed or unsupported tag
 * yields undefined and a one-shot warning, and the call never throws.
 */
export async function getBlockTagNumbers(chainId: number): Promise<FinalityHeads> {
  // Same invalid-arg guard the other RPC services use: a non-positive chain
  // id resolves empty without touching an endpoint (covers the unsupported-
  // chain redirect window, where the views pass 0).
  if (!(chainId > 0)) return {};

  // A client-construction failure (bad RPC URL, network down) means both
  // tags are unknown — warn once per tag and degrade, never throw.
  const client = await createRpcClient(chainId).catch(reason => {
    warnTagUnavailable(chainId, 'safe', reason);
    warnTagUnavailable(chainId, 'finalized', reason);
    return undefined;
  });
  if (!client) return {};

  const head = async (tag: 'safe' | 'finalized'): Promise<number | undefined> => {
    try {
      const block = await client.getBlock({ blockTag: tag });
      return Number(block.number);
    } catch (reason) {
      warnTagUnavailable(chainId, tag, reason);
      return undefined;
    }
  };

  const [safe, finalized] = await Promise.all([head('safe'), head('finalized')]);
  return { safe, finalized };
}

export const finalityHeadsCache = createQueryCache<FinalityHeads, [number]>('finality-heads');

const queryFinalityHeads = bindQueryFn(getBlockTagNumbers, finalityHeadsCache);

const useFinalityHeadsQuery = createPolledQueryHook({
  queryFn: queryFinalityHeads,
  interval: FINALITY_HEADS_INTERVAL,
});

/**
 * Polled safe/finalized heads for a chain (30s cadence, hidden-tab ticks
 * skipped per the polledQuery factory defaults).
 */
export function useFinalityHeads(chainId: number) {
  return useFinalityHeadsQuery([chainId]);
}

export type FinalityLabel = 'finalized' | 'safe';

/**
 * Which label a block number earns under the given heads. Unknown heads
 * (fetch failed, tags unsupported, hook still loading) earn nothing — only
 * a meaningful comparison renders — and Finalized wins over Safe whenever
 * both would apply.
 */
export function finalityLabelFor(
  heads: FinalityHeads | undefined,
  blockNumber: number,
): FinalityLabel | undefined {
  if (heads?.finalized !== undefined && blockNumber <= heads.finalized) return 'finalized';
  if (heads?.safe !== undefined && blockNumber <= heads.safe) return 'safe';
  return undefined;
}
