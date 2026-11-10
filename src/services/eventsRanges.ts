// Shared query service for GET /events/ranges — the ONE poll loop behind
// both EventStatistics' coverage metric and IndexingRangeManager's range
// list. Before this service each component ran its own setInterval fetch
// of the same URL (and EventStatistics re-fetched it again inside its
// status tick), so an indexing contract produced two parallel ranges
// polls. Both consumers now read a single cache entry ('event-ranges',
// keyed [chainId, contractAddress]) driven by ONE timer, and mutation
// handlers refresh that one entry via the hook's refetch.
//
// Why a module-level coordinator instead of react-toolroom's usePolling
// (the polledQuery.ts factory): the result broadcast store and keyed
// status slots live on each useInjectable INSTANCE, and both components
// mount their own hook call — their own instance — so two usePolling
// calls would be two intervals ticking the same key (this is the exact
// limitation polledQuery.ts documents). The coordinator keeps ONE
// interval per cache key while ANY mounted member wants polling; each
// tick fans out to every registered member's injectable so every
// instance's stores settle on the same tick. Single-flight comes from the
// shared cache provider itself: the first fan-out call registers its
// request as the entry's in-flight `load`, and the remaining members join
// that exact promise, so N mounted components still cost ONE ranges
// request per tick.
//
// Race safety is native to the query layer, not hand-rolled: every chain
// run claims a monotonic sequence per instance and the provider's
// in-flight slot only accepts its own request's settle, so a superseded
// run (contract switch via useRun's abort, or a mutation refetch that
// deletes the in-flight entry first) can never overwrite newer data.
import { useEffect } from 'react';
import {
  hashArgs,
  useArgsStatus,
  useCache,
  useInjectable,
  useLoading,
  useRefresh,
  useResultSelect,
  useRun,
  type CacheProvider,
} from 'react-toolroom/async';

import { get } from '@/util/http';
import { bindQueryFn, createQueryCache } from '@/util/useQuery';
import type { PolledQueryResult } from './polledQuery';

// Both panels' historical cadence (IndexingRangeManager's 3s interval).
// The coverage bar and the segmented range view read the same cache entry,
// so they advance in step by construction now.
export const EVENT_RANGES_POLL_INTERVAL = 3_000;

// staleTime 0 keeps every chain run revalidating: a poll tick must never
// be swallowed by a still-fresh entry (createPolledQueryHook documents
// the same must-stay-below-interval rule; 0 is its strongest form).
const EVENT_RANGES_STALE_TIME = 0;

export type EventRangeStatus = 'pending' | 'indexing' | 'paused' | 'completed' | 'error';
export type EventRangeDirection = 'forward' | 'backward';

// Wire row of GET /events/ranges. Block numbers serialize as decimal
// strings (bigintJsonReplacer); plain numbers are accepted too.
// createdAt/updatedAt are ISO strings on the wire while test mocks hand
// back Date objects — both tolerated; only IndexingRangeManager consumes
// the extra fields, and it coerces at its model boundary.
export type EventRangeRow = {
  chainId: number;
  address: string;
  rangeId: number;
  fromBlock: number | string;
  toBlock: number | string;
  direction: EventRangeDirection;
  currentBlock: number | string | null;
  status: EventRangeStatus;
  totalEventsIndexed: number;
  errorMessage: string | null;
  priority: number;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

export type EventRangesPayload = { ranges: EventRangeRow[] };

/**
 * Fetch the contract's indexing ranges. Never throws past `get`; an absent
 * `ranges` array normalizes to empty.
 */
export async function fetchEventRanges(
  chainId: number,
  contractAddress: string,
  signal?: AbortSignal,
): Promise<EventRangesPayload> {
  // Repo convention (services/chainRpc.ts): the query layer's per-run
  // signal is accepted for signature parity; superseded runs are stopped
  // by the store-level claim gating and the provider's in-flight slot.
  void signal;
  const data = await get<{ ranges?: EventRangeRow[] }>(
    `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges`,
  );
  return { ranges: data.ranges ?? [] };
}

export const eventRangesCache = createQueryCache<EventRangesPayload, [number, string]>(
  'event-ranges',
);

const queryEventRanges = bindQueryFn(fetchEventRanges, eventRangesCache);

// ---------------------------------------------------------------------------
// Single-interval poll coordinator (one entry per cache key)
// ---------------------------------------------------------------------------

// A member is one mounted useEventRanges call. Its runner re-runs the
// instance's full middleware chain; the shared provider's in-flight load
// dedups the fan-out to one request per tick, and the settle writes this
// member's own stores (the per-instance store limitation is why the tick
// fans out to members at all — see polledQuery.ts).
type RangePollMember = { run: () => Promise<unknown> };

type RangePollEntry = {
  members: Set<RangePollMember>;
  /** Mounted members currently requesting polling for this key. */
  pollRequests: number;
  interval: ReturnType<typeof setInterval> | undefined;
  /** Overlap guard, usePolling's semantic equivalent: a tick whose fan-out has not settled yet is never piled onto. */
  ticksInFlight: number;
};

const pollEntries = new Map<string, RangePollEntry>();

const pollEntryFor = (chainId: number, contractAddress: string): RangePollEntry => {
  // hashArgs is the provider's own key derivation (signal-trimmed), so
  // the coordinator's keys and the cache's keys can never drift apart.
  const key = hashArgs([chainId, contractAddress]);
  let entry = pollEntries.get(key);
  if (!entry) {
    entry = { members: new Set(), pollRequests: 0, interval: undefined, ticksInFlight: 0 };
    pollEntries.set(key, entry);
  }
  return entry;
};

const dropEntryIfIdle = (chainId: number, contractAddress: string) => {
  const key = hashArgs([chainId, contractAddress]);
  const entry = pollEntries.get(key);
  if (
    entry?.members.size === 0 &&
    entry?.pollRequests === 0 &&
    entry?.interval === undefined
  ) {
    pollEntries.delete(key);
  }
};

const runPollTick = (entry: RangePollEntry) => {
  // No visibility gating: the replaced hand-rolled setIntervals polled
  // regardless of tab visibility (react-toolroom's usePolling would skip
  // hidden tabs, but jsdom-based tests — and any prerendered document —
  // report document.hidden === true, which would silently kill every
  // tick; browsers throttle hidden-tab timers themselves).
  if (entry.ticksInFlight > 0) return;
  // Snapshot: an unmounting member may mutate the set mid-fan-out.
  const members = [...entry.members];
  if (members.length === 0) return;
  entry.ticksInFlight += 1;
  let settling = members.length;
  const settled = () => {
    settling -= 1;
    if (settling === 0) entry.ticksInFlight = 0;
  };
  for (const member of members) {
    try {
      // Each member's chain shares one provider entry, so the first call
      // starts the request and the rest join its in-flight promise
      // (single-flight); errors surface per-instance through the
      // useArgsStatus error channels and are swallowed here exactly like
      // usePolling swallows its tick rejections.
      Promise.resolve(member.run()).then(settled, settled);
    } catch {
      // A synchronous throw inside a middleware wrapper still settles.
      settled();
    }
  }
};

// useResultSelect always applies select when a result exists; a
// module-level identity keeps the reference stable.
const identity = <T>(r: T) => r;

/**
 * The shared indexing-ranges query. Polls every 3s while any range is
 * indexing (derived from its own data — IndexingRangeManager's gate) or
 * while `aggregateIndexing` is set (EventStatistics' extra leg: the
 * legacy aggregate status can index without range rows). With both panels
 * mounted the two gates OR together behind ONE interval and ONE ranges
 * request per tick. `refetch` deletes the shared entry and re-fetches —
 * the refresh path every range mutation awaits.
 */
export function useEventRanges(
  chainId: number,
  contractAddress: string,
  aggregateIndexing = false,
): PolledQueryResult<EventRangesPayload> {
  // Same widening createQueryHook/polledQuery perform: the runtime
  // signature is [...K, signal?] and the cache slot widens with it.
  const runArgs = [chainId, contractAddress] as unknown as [number, string, signal?: AbortSignal];
  const provider = eventRangesCache as unknown as CacheProvider<
    EventRangesPayload,
    [number, string, signal?: AbortSignal]
  >;

  const injectable = useInjectable(queryEventRanges, {
    name: queryEventRanges.name || 'query',
  });
  const stale = useCache(injectable, provider, EVENT_RANGES_STALE_TIME);
  const data = useResultSelect(injectable, identity);
  const fetching = useLoading(injectable);
  const status = useArgsStatus(injectable, runArgs);
  const loading = status.loading && status.data === undefined;

  useRun(injectable, runArgs, { signal: true, hash: hashArgs });

  const refetch = useRefresh(injectable, runArgs, provider);

  const anyRangeIndexing = (data?.ranges ?? []).some(range => range.status === 'indexing');
  const pollEnabled = anyRangeIndexing || aggregateIndexing;

  // Membership: this instance's chain runner joins the key's fan-out set.
  useEffect(() => {
    const entry = pollEntryFor(chainId, contractAddress);
    const member: RangePollMember = { run: () => injectable(chainId, contractAddress) };
    entry.members.add(member);
    return () => {
      entry.members.delete(member);
      dropEntryIfIdle(chainId, contractAddress);
    };
  }, [chainId, contractAddress, injectable]);

  // Polling: ONE interval per key, alive while any member requests it.
  useEffect(() => {
    if (!pollEnabled) return;
    const entry = pollEntryFor(chainId, contractAddress);
    entry.pollRequests += 1;
    entry.interval ??= setInterval(() => runPollTick(entry), EVENT_RANGES_POLL_INTERVAL);
    return () => {
      entry.pollRequests -= 1;
      if (entry.pollRequests <= 0 && entry.interval !== undefined) {
        clearInterval(entry.interval);
        entry.interval = undefined;
      }
      dropEntryIfIdle(chainId, contractAddress);
    };
  }, [pollEnabled, chainId, contractAddress]);

  return {
    data,
    loading,
    fetching,
    error: status.error,
    failureCount: status.failureCount,
    stale,
    dataUpdatedAt: status.dataUpdatedAt,
    refetch,
  };
}
