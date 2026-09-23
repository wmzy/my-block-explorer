// Cross-chain address presence probe (browser-side only — no backend, no
// DB). The Address page offers bridge-testers a bounded "is this address
// also alive on other networks?" check: one balance read plus one code
// read per chain, over a FIXED candidate set (the popular-chain head plus
// user-registered custom chains, capped), through the same cached viem
// clients every other RPC surface uses (utils/realTimeData).
//
// Honesty contract: this is a presence PROBE, never an aggregation
// claim. Every chain settles independently to ok or failed-with-reason —
// a failed read is an explicit "unavailable on that chain", never a zero
// balance. Balances denominated in different native units are never
// numerically compared here; ordering by USD value is the view's job
// (services/prices spot lookups) and only where a price actually
// resolved — unknowns sort after knowns, never as zero.
import { POPULAR_CHAINS } from '@/config/chains';
import { listCustomChains } from '@/config/customChains';
import type { CustomChain } from '@/config/customChains';
import { ensureCustomChainsLoaded } from '@/services/customChains';
import { createRpcClient } from '@/utils/realTimeData';

/** How many popular chains the probe targets (always excluding the viewed one). */
export const PROBE_POPULAR_CHAIN_COUNT = 5;

/** Hard ceiling on probed chains per address view (popular head + customs). */
export const PROBE_MAX_CHAINS = 6;

/** Default fan-out width of the bounded probe pool. */
export const PROBE_CONCURRENCY = 3;

/** One RPC call that cannot answer within this budget settles failed. */
export const PROBE_CALL_BUDGET_MS = 4_000;

/** One chain the probe could read: live native balance and code presence. */
export type ProbeOk = {
  status: 'ok';
  chainId: number;
  balance: bigint;
  isContract: boolean;
};

/** One chain the probe could NOT read: the reason, display-ready. */
export type ProbeFailed = {
  status: 'failed';
  chainId: number;
  reason: string;
};

export type ProbeOutcome = ProbeOk | ProbeFailed;

/**
 * Pure: the probe's candidate chain ids, in stable order — the first
 * POPULAR_CHAINS entries excluding the currently viewed chain, then the
 * user's registered custom chains (deduped against the popular picks and
 * the viewed chain, appended in chainId order) up to PROBE_MAX_CHAINS
 * total. Popular chains keep their configured priority order; custom
 * chains are re-sorted here so the result is deterministic whatever order
 * the caller's registry snapshot holds.
 */
export function selectProbeChains(
  currentChainId: number,
  customChains: readonly CustomChain[],
): number[] {
  const selected: number[] = [];
  const seen = new Set<number>([currentChainId]);
  for (const chain of POPULAR_CHAINS) {
    if (selected.length >= PROBE_POPULAR_CHAIN_COUNT) break;
    if (seen.has(chain.id)) continue;
    seen.add(chain.id);
    selected.push(chain.id);
  }
  const customsById = [...customChains].sort((a, b) => a.chainId - b.chainId);
  for (const custom of customsById) {
    if (selected.length >= PROBE_MAX_CHAINS) break;
    if (seen.has(custom.chainId)) continue;
    seen.add(custom.chainId);
    selected.push(custom.chainId);
  }
  return selected;
}

// Race one call against the probe budget. The losing side is always
// handled: Promise.race attaches handlers to both competitors, so a call
// that rejects AFTER the budget expired surfaces nowhere.
const withinBudget = async <T>(call: () => Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budgetExpired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${PROBE_CALL_BUDGET_MS / 1000}s`)),
      PROBE_CALL_BUDGET_MS,
    );
  });
  try {
    return await Promise.race([call(), budgetExpired]);
  } finally {
    clearTimeout(timer);
  }
};

const errorReason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Probe one address on one chain: `getBalance` + `getCode` in parallel,
 * each under the ~4s call budget (client creation included — the RPC
 * config load is part of the chain's cost). NEVER throws: every failure
 * mode — unsupported chain, transport error, timeout — settles as an
 * explicit `failed` outcome carrying the reason.
 */
export async function probeAddressOnChain(
  chainId: number,
  address: `0x${string}`,
): Promise<ProbeOutcome> {
  try {
    const client = await withinBudget(() => createRpcClient(chainId));
    const [balance, code] = await Promise.all([
      withinBudget(() => client.getBalance({ address })),
      withinBudget(() => client.getCode({ address })),
    ]);
    // viem folds a successful '0x' getCode (a plain EOA) into undefined —
    // restore the sentinel before classifying, or the comparison below
    // reads undefined as "not '0x'" and every EOA looks like a contract.
    // An EIP-7702 delegated EOA (0xef0100<delegate> designator) genuinely
    // HAS code, so it honestly classifies as contract here; the probed
    // chain's own page carries the delegated-EOA nuance.
    return {
      status: 'ok',
      chainId,
      balance,
      isContract: (code ?? '0x') !== '0x',
    };
  } catch (error) {
    return { status: 'failed', chainId, reason: errorReason(error) };
  }
}

export type ProbeOptions = { concurrency?: number };

/**
 * Probe the candidate set for `address` through a bounded worker pool
 * (default width 3). Resolves — never rejects — with one outcome per
 * candidate in selectProbeChains order; a chain whose client cannot even
 * be created simply settles `failed`. Custom chains join the candidate
 * set only after the shared one-shot registry load settles (a failure
 * there is silent by design: the popular head still probes).
 */
export async function probeAddressAcrossChains(
  currentChainId: number,
  address: `0x${string}`,
  options: ProbeOptions = {},
): Promise<ProbeOutcome[]> {
  try {
    await ensureCustomChainsLoaded();
    const chainIds = selectProbeChains(currentChainId, listCustomChains());
    const outcomes = new Array<ProbeOutcome>(chainIds.length);
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? PROBE_CONCURRENCY));
    let nextIndex = 0;
    const runWorker = async (): Promise<void> => {
      for (;;) {
        // Read-and-increment is synchronous, so workers never claim the
        // same slot despite sharing the cursor across awaits.
        const index = nextIndex;
        nextIndex += 1;
        if (index >= chainIds.length) return;
        outcomes[index] = await probeAddressOnChain(chainIds[index], address);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, chainIds.length) }, runWorker),
    );
    return outcomes;
  } catch {
    // Unreachable by construction — every layer settles instead of
    // throwing — kept so the never-rejects contract is structural.
    return [];
  }
}

/**
 * Pure: display order over probe outcomes. USD-known rows first,
 * descending by USD value; everything without a resolved USD value
 * (unpriced chains AND failed probes) after them; both groups tiebreak
 * by chainId so the order is fully deterministic. `usdOf` returns the
 * USD VALUE of a chain's probed balance (or null when unpriced) — raw
 * balances in different native units are never compared anywhere.
 */
export function orderProbeResults(
  outcomes: readonly ProbeOutcome[],
  usdOf: (chainId: number) => number | null,
): ProbeOutcome[] {
  const knownUsd = (outcome: ProbeOutcome): number | null => {
    if (outcome.status !== 'ok') return null;
    const usd = usdOf(outcome.chainId);
    return usd !== null && Number.isFinite(usd) ? usd : null;
  };
  return outcomes.slice().sort((a, b) => {
    const aUsd = knownUsd(a);
    const bUsd = knownUsd(b);
    if (aUsd !== null && bUsd !== null && aUsd !== bUsd) return bUsd - aUsd;
    if (aUsd !== null && bUsd === null) return -1;
    if (aUsd === null && bUsd !== null) return 1;
    return a.chainId - b.chainId;
  });
}
