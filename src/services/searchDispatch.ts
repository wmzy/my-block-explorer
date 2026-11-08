// The single shared search-dispatch core. The topbar's search box and the
// Search page used to drive the identical stack in parallel (classify →
// verify → ENS → navigate → history); both now route through this module,
// which owns the search-history contract — record at click time for
// queries whose landing chain is known up front (addresses, block numbers
// and hashes verified as facts of exactly one chain), at landing time for
// everything the endpoint actually ran, and only when a destination is
// opened for ENS names. This is the only module that writes search history
// and the only one that resolves ENS names for search; side-effect ports
// (navigation, notice presentation, history refresh) stay injected so the
// header can render inline notices while the page renders its own states.
import { detectSearchType, sanitizeInput } from '@/utils/validation';
import { isBackendUnreachable } from '@/util/http';
import { createRpcClient } from '@/utils/realTimeData';
import { fetchChainSearch } from '@/services/search';
import { resolveEnsAddress, ensDestinations, type EnsDestinations } from '@/services/ensForward';
import { recordSearchHistoryEntry, type SearchHistoryEntry } from '@/services/searchHistory';

// Subset of the /api/chains/:id/search response the dispatch acts on. The
// block payload's number arrives as a string (BigInt-safe serialization).
type ChainSearchResponse = {
  found?: boolean;
  type?: string;
  degraded?: boolean | null;
  data?: { number?: string | number } | null;
};

// Outcome of an inline hint the dispatch cannot resolve into a navigation:
// 'miss' = definitive no-result on the current chain, 'block-miss' = the
// same for a block number (verified against the chain before navigating —
// chains differ in height), 'failed' = a data source errored (degraded
// response, or a request that failed outright), 'unreachable' = the
// backend could not be reached at all (no HTTP response: offline / not
// connected — a different failure from a data source erroring, with a
// retry instead of a network escape; fallbackNote = the direct-RPC check
// of the selected chain ran and could not confirm the query, so the note
// says what that means: only this chain was checked, full cross-chain
// search needs the backend), 'ens-resolved' / 'ens-not-found' /
// 'ens-failed' = outcome of a client-side ENS lookup (resolved on
// Ethereum; not-found is definitive, failed means the RPC never answered
// and is retryable). ens-resolved also carries the destination choice:
// Ethereum (where the name resolved) as the primary, the chain the search
// ran on as the alternate.
export type SearchNotice =
  | { kind: 'miss'; query: string }
  | { kind: 'block-miss'; query: string }
  | { kind: 'failed'; query: string }
  | { kind: 'unreachable'; query: string; fallbackNote?: boolean }
  | { kind: 'ens-resolved'; query: string; address: string; destinations: EnsDestinations }
  | { kind: 'ens-not-found'; query: string }
  | { kind: 'ens-failed'; query: string };

// ENS lookup outcome for any search surface, with the destination choice
// attached to a resolution: the address is a fact of Ethereum (the ENS
// registry only lives there), so Ethereum is the primary destination and
// the chain the search ran on is offered as the alternate, shown only
// when it differs. 'not-found' is definitive (the name is not
// registered), 'failed' means the Ethereum RPC never answered
// (retryable), 'no-rpc' means this explorer has no usable Ethereum RPC
// endpoint (missing configuration — no retry can cure it). The consumers'
// presentation differs (the header folds no-rpc into its retryable
// failure notice; the Search page keeps all three apart); the outcome
// taxonomy itself is shared here so both stay honest.
export type EnsSearchResolution =
  | { status: 'resolved'; address: `0x${string}`; destinations: EnsDestinations }
  | { status: 'not-found' }
  | { status: 'failed' }
  | { status: 'no-rpc' };

/**
 * Resolves an ENS name in the browser against a mainnet client and
 * computes the destination choice for the chain the search ran on. This
 * is the single ENS entry point for every search surface.
 */
export async function resolveEnsForSearch(
  name: string,
  viewingChainId: number | null | undefined,
): Promise<EnsSearchResolution> {
  const outcome = await resolveEnsAddress(name);
  if (outcome.status !== 'resolved') return outcome;
  return {
    status: 'resolved',
    address: outcome.address,
    destinations: ensDestinations(viewingChainId ?? undefined),
  };
}

/**
 * Opens a resolved ENS name on the destination the user chose — the
 * moment history records the entry, with the chain actually opened (never
 * a default, never the chain the search happened to run on). Returns the
 * updated history list so callers with history UI can refresh it.
 */
export function openEnsSearchDestination(
  resolution: { name: string; address: string },
  targetChainId: number,
  navigate: (to: string) => void,
): SearchHistoryEntry[] {
  const history = recordSearchHistoryEntry(resolution.name, targetChainId);
  navigate(`/chain/${targetChainId}/address/${resolution.address}`);
  return history;
}

/**
 * Records a search at click time, for dispatch paths whose landing chain
 * is known up front (address deep-links immediately; block numbers and
 * hashes are facts of exactly one chain) — the entry carries the chain
 * the dispatch will land on. ENS names record nothing here (a destination
 * only exists after resolution) and neither does free text (its outcome
 * is unknown until the Search view has actually run it): both return null
 * so the caller leaves its history state untouched.
 */
export function recordSearchAtClick(
  rawQuery: string,
  chainId: number,
): SearchHistoryEntry[] | null {
  const query = sanitizeInput(rawQuery.trim());
  const searchType = detectSearchType(query);
  if (searchType === 'ens' || searchType === 'unknown') return null;
  return recordSearchHistoryEntry(query, chainId);
}

/**
 * Records a search at landing time: the outcome is now known and the
 * entry carries the chain the search actually landed on — the verified
 * entity's chain, the chain the global endpoint echoed as searched, or
 * the chain picked in the network picker once its search returned. Free
 * text records here only (never at click time), so queries that never
 * land cannot flood history.
 */
export function recordSearchLanding(query: string, chainId: number): SearchHistoryEntry[] {
  return recordSearchHistoryEntry(query, chainId);
}

// Runs one RPC probe and folds every failure mode (transport error, or a
// method missing on a limited client) into null, so the unreachable
// fallback below never surfaces probe noise as a user-facing error and
// simply treats an unanswerable probe as "could not confirm".
async function tryRpcProbe<T>(probe: () => Promise<T>): Promise<T | null> {
  try {
    return await probe();
  } catch {
    return null;
  }
}

// Backend-unreachable fallback for block-number and 32-byte-hash
// queries: the selected chain's own public RPC can still verify them
// without the backend. A block number is confirmed when the chain's
// head has reached it; a hash is probed as a transaction first, then
// as a block. 'skipped' = the chain has no usable RPC client (the
// plain unreachable notice stands, no note); 'missed' = the probe ran
// and could not confirm, and the notice gains an honest note that
// only this one chain was checked — full cross-chain search needs the
// backend. A confirmed hit navigates and lands in history exactly
// like the verified backend path.
async function searchViaChainRpc(
  chainId: number,
  query: string,
  searchType: 'block' | 'hash',
  ports: SearchDispatchPorts,
): Promise<'navigated' | 'missed' | 'skipped'> {
  let client: Awaited<ReturnType<typeof createRpcClient>>;
  try {
    client = await createRpcClient(chainId);
  } catch {
    return 'skipped';
  }

  if (searchType === 'block') {
    const blockNumber = BigInt(query);
    const head = await tryRpcProbe(() => client.getBlockNumber());
    if (head !== null && head >= blockNumber) {
      ports.onHistory(recordSearchLanding(query, chainId));
      ports.navigate(`/chain/${chainId}/block/${String(blockNumber)}`);
      return 'navigated';
    }
    return 'missed';
  }

  const hash = query as `0x${string}`;
  const tx = await tryRpcProbe(() => client.getTransaction({ hash }));
  if (tx !== null) {
    ports.onHistory(recordSearchLanding(query, chainId));
    ports.navigate(`/chain/${chainId}/tx/${query}`);
    return 'navigated';
  }
  const block = await tryRpcProbe(() => client.getBlock({ blockHash: hash }));
  if (block !== null) {
    ports.onHistory(recordSearchLanding(query, chainId));
    ports.navigate(`/chain/${chainId}/block/${String(block.number)}`);
    return 'navigated';
  }
  return 'missed';
}

// Side-effect ports the dispatch drives: navigation is the caller's own
// router push (fire-and-forget), notices and history refreshes are the
// caller's presentation (the header renders inline notices and a history
// dropdown, the page renders its own states and keeps no history UI).
export type SearchDispatchPorts = {
  navigate: (to: string) => void;
  onNotice: (notice: SearchNotice) => void;
  onHistory: (history: SearchHistoryEntry[]) => void;
};

// Shared query dispatcher for the topbar's search box and its history
// items. It uses the same sanitize/detect pair as every other surface
// (utils/validation is the single source of truth): addresses deep-link
// straight to the target chain's page; block numbers and hashes are facts
// of exactly one chain (and chains differ in height / tx sets), so they
// are verified through the per-chain search API before anything navigates
// — a number or hash that is not on this chain surfaces as an inline miss
// with a network-picker escape hatch, never as a blind jump onto an error
// page; anything else goes to the full Search view. History records at
// landing time — the entry carries the chain the search actually reached
// (or, for a verified block/hash, the chain it was found on) — so
// re-running one from the dropdown searches that chain again, not
// whichever chain is currently selected.
export async function runSearchDispatch(
  rawQuery: string,
  chainId: number,
  ports: SearchDispatchPorts,
): Promise<void> {
  const query = sanitizeInput(rawQuery.trim());
  const searchType = detectSearchType(query);

  if (searchType === 'address') {
    ports.onHistory(recordSearchLanding(query, chainId));
    ports.navigate(`/chain/${chainId}/address/${query}`);
    return;
  }

  if (searchType === 'block') {
    // A block number only exists below a chain's head, and heads differ
    // wildly between chains: verify before navigating (same shape as
    // the hash branch below).
    // Through the shared http layer (runtime-discovered api base), NOT a
    // raw same-origin fetch: in dev the same-origin /api is the Vite
    // bridge's own backend instance, which competes with the discovered
    // service for the single-writer DuckDB and serves different data.
    let payload: ChainSearchResponse | undefined;
    try {
      payload = (await fetchChainSearch(chainId, query)) as ChainSearchResponse | undefined;
    } catch (error) {
      // Offline: the selected chain's own RPC can still confirm the
      // number before the search gives up (see searchViaChainRpc).
      if (isBackendUnreachable(error)) {
        const outcome = await searchViaChainRpc(chainId, query, 'block', ports);
        if (outcome === 'navigated') return;
        ports.onNotice({ kind: 'unreachable', query, fallbackNote: outcome === 'missed' });
      } else {
        ports.onNotice({ kind: 'failed', query });
      }
      return;
    }

    if (payload?.found && payload.type === 'block' && payload.data?.number !== undefined) {
      ports.onHistory(recordSearchLanding(query, chainId));
      // The block detail route only accepts numbers, and the verified
      // payload carries the canonical one.
      ports.navigate(`/chain/${chainId}/block/${String(payload.data.number)}`);
      return;
    }

    // A degraded response means a data source errored — never worded as
    // a definitive "no results".
    ports.onNotice(payload?.degraded ? { kind: 'failed', query } : { kind: 'block-miss', query });
    return;
  }

  if (searchType === 'hash') {
    // Through the shared http layer (runtime-discovered api base), NOT a
    // raw same-origin fetch: in dev the same-origin /api is the Vite
    // bridge's own backend instance, which competes with the discovered
    // service for the single-writer DuckDB and serves different data.
    let data: unknown;
    try {
      data = await fetchChainSearch(chainId, query);
    } catch (error) {
      // Offline: the selected chain's own RPC can still resolve the
      // hash (tx first, then block) before the search gives up.
      if (isBackendUnreachable(error)) {
        const outcome = await searchViaChainRpc(chainId, query, 'hash', ports);
        if (outcome === 'navigated') return;
        ports.onNotice({ kind: 'unreachable', query, fallbackNote: outcome === 'missed' });
      } else {
        ports.onNotice({ kind: 'failed', query });
      }
      return;
    }
    const payload = data as ChainSearchResponse | undefined;

    if (payload?.found) {
      if (payload.type === 'transaction') {
        ports.onHistory(recordSearchLanding(query, chainId));
        ports.navigate(`/chain/${chainId}/tx/${query}`);
        return;
      }
      if (payload.type === 'block' && payload.data?.number !== undefined) {
        // The block detail route only accepts numbers, not hashes.
        ports.onHistory(recordSearchLanding(query, chainId));
        ports.navigate(`/chain/${chainId}/block/${String(payload.data.number)}`);
        return;
      }
    }

    // A degraded response means a data source errored — never worded as
    // a definitive "no results".
    ports.onNotice(payload?.degraded ? { kind: 'failed', query } : { kind: 'miss', query });
    return;
  }

  if (searchType === 'ens') {
    // ENS names resolve in the browser against a mainnet client (where
    // the ENS registry lives). A resolved address is a fact of
    // Ethereum, so nothing navigates and no history is recorded yet:
    // the notice offers Ethereum (primary) and the chain the search
    // ran on (alternate), and history records whichever destination is
    // actually opened (openEnsSearchDestination). A definitive
    // not-found is reported as such, an RPC failure as a retryable
    // failure — never one blurred copy for both. A missing Ethereum
    // RPC endpoint (no-rpc) also surfaces through the retryable
    // failure notice here: the topbar has no room for a distinct
    // configuration dead-end, and the Search page — which does —
    // presents the outcome itself via resolveEnsForSearch.
    const outcome = await resolveEnsForSearch(query, chainId);
    if (outcome.status === 'resolved') {
      ports.onNotice({
        kind: 'ens-resolved',
        query,
        address: outcome.address,
        destinations: outcome.destinations,
      });
      return;
    }
    ports.onNotice(
      outcome.status === 'not-found' ? { kind: 'ens-not-found', query } : { kind: 'ens-failed', query },
    );
    return;
  }

  // Free text goes to the full Search view, carrying the target chain
  // as context (?chain=) so the global endpoint searches it and its
  // suggestions link back to that chain's pages. History is NOT
  // recorded here: the query's outcome is unknown until the view has
  // actually run it, so the Search view records the entry when it
  // navigates to a result (or the search lands on a chain).
  ports.navigate(`/search?q=${encodeURIComponent(query)}&chain=${chainId}`);
}
