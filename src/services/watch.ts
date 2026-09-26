// Watch-subscription service (frontend): the server-side watchlist's
// API surface on the query layer (createQueryCache + bindQueryFn +
// createQueryHook, services/labels.ts pattern). Reads ride util/http
// (admin token attaches automatically, degraded mode rejects fast);
// writes reject with ApiError — status 403 means the admin token is
// missing/wrong (the view offers the settings hint), 400 carries the
// route's honest messages (no RPC config / per-chain cap / bad label).
//
// The recent-events feed is NOT a query: it is a live SSE tail
// (useWatchEvents in services/liveChain.ts) seeded by one plain fetch of
// the ring-buffer endpoint — a cached "live" list would lie about
// freshness the moment the stream degrades to polling.
import { api, get, put, del, withSignal } from '@/util/http';
import { ApiError } from '@/util/apiError';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';
import type { LiveWatchEvent } from './liveChain';

// Page size the panel asks for when seeding its feed (the backend caps
// limits at 100; the panel keeps its compact promise at 10).
export const WATCH_FEED_ITEMS = 10;

/** One saved subscription exactly as the API stores it. */
export type WatchSubscriptionView = {
  chainId: number;
  /** lowercase storage key */
  address: string;
  label: string | null;
  /** decimal string; null until the first tick baselined the row */
  lastProcessedBlock: string | null;
  /** delivery endpoint; null = no webhook configured */
  webhookUrl: string | null;
  /** 'ok' | 'failed: <reason>' | null (nothing delivered yet) */
  webhookStatus: string | null;
  /** ISO time of the last delivery attempt; null before the first */
  webhookLastAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** A feed event — the same shape the SSE `watch` frames carry. */
export type WatchEventView = LiveWatchEvent;

type SubscriptionBody = {
  chainId?: unknown;
  address?: unknown;
  label?: unknown;
  lastProcessedBlock?: unknown;
  webhookUrl?: unknown;
  webhookStatus?: unknown;
  webhookLastAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

// Shape guard for one subscription row: the fields the panel renders,
// with the wire types. Anything else is a thrown ApiError instead of
// fabricated data (labels.ts precedent). The webhook fields predate
// nothing — an older backend simply omits them and they parse as null.
const parseSubscription = (
  body: SubscriptionBody,
): WatchSubscriptionView => {
  if (
    typeof body.address !== 'string'
    || typeof body.chainId !== 'number'
  ) {
    throw new ApiError('Malformed watch subscription response', 0);
  }
  return {
    chainId: body.chainId,
    address: body.address.toLowerCase(),
    label: typeof body.label === 'string' ? body.label : null,
    lastProcessedBlock: typeof body.lastProcessedBlock === 'string' ? body.lastProcessedBlock : null,
    webhookUrl: typeof body.webhookUrl === 'string' && body.webhookUrl !== '' ? body.webhookUrl : null,
    webhookStatus: typeof body.webhookStatus === 'string' ? body.webhookStatus : null,
    webhookLastAt: typeof body.webhookLastAt === 'string' ? body.webhookLastAt : null,
    createdAt: typeof body.createdAt === 'string' ? body.createdAt : null,
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
  };
};

/** Fetch one chain's subscriptions (oldest-first, as the API orders them). */
export async function fetchWatchSubscriptions(
  chainId: number,
  signal?: AbortSignal,
): Promise<WatchSubscriptionView[]> {
  if (chainId <= 0) return [];
  const body = await get<{ subscriptions?: unknown }>(
    `/api/chains/${chainId}/watch`,
    undefined,
    withSignal(api, signal),
  );
  const rows = body?.subscriptions;
  if (!Array.isArray(rows)) {
    throw new ApiError('Malformed watch subscriptions response', 0);
  }
  return rows.map((row): WatchSubscriptionView => parseSubscription(row));
}

/**
 * Upsert one subscription (an omitted/empty label clears it; a fresh
 * row starts watching at the current head). Webhook URL semantics
 * mirror the route: undefined = leave the stored webhook unchanged (the
 * key is omitted from the body), '' or null = clear, a string = set
 * (the server validates http(s) + 512 and answers 400
 * invalid_webhook_url otherwise). Rejects with ApiError; 403 = admin
 * token missing/invalid, 400 = the route's honest refusal (no RPC
 * config for the chain / per-chain cap / invalid label / invalid
 * webhook URL).
 */
export async function saveWatchSubscription(
  chainId: number,
  address: string,
  label: string | null,
  webhookUrl?: string | null,
): Promise<WatchSubscriptionView> {
  const lower = address.toLowerCase();
  const body: Record<string, unknown> = { label };
  if (webhookUrl !== undefined) {
    body.webhookUrl = webhookUrl;
  }
  const res = await put<{ subscription?: unknown }>(
    `/api/chains/${chainId}/watch/${lower}`,
    body,
  );
  if (typeof res?.subscription !== 'object' || res.subscription === null) {
    throw new ApiError('Malformed watch subscription response', 0);
  }
  return parseSubscription(res.subscription);
}

/**
 * Remove a subscription. Rejects with ApiError on failure (404 = nothing
 * was subscribed — callers treat that as success-adjacent and refresh).
 */
export async function deleteWatchSubscription(chainId: number, address: string): Promise<void> {
  await del(`/api/chains/${chainId}/watch/${address.toLowerCase()}`);
}

/** Seed the feed with the newest ring-buffer events (newest-first). */
export async function fetchWatchEvents(
  chainId: number,
  limit: number = WATCH_FEED_ITEMS,
  signal?: AbortSignal,
): Promise<WatchEventView[]> {
  if (chainId <= 0) return [];
  const body = await get<{ events?: unknown }>(
    `/api/chains/${chainId}/watch/events`,
    { limit },
    withSignal(api, signal),
  );
  const events = body?.events;
  if (!Array.isArray(events)) {
    throw new ApiError('Malformed watch events response', 0);
  }
  // Tolerant parse: an entry of an unexpected shape is dropped, not
  // half-rendered (the feed stays honest about what it can show).
  return events.filter(
    (event): event is WatchEventView =>
      typeof event === 'object' && event !== null && typeof (event as WatchEventView).kind === 'string',
  );
}

// Stable identity for log events across SSE re-deliveries and feed
// merges; gap markers key on their (chain, address, block) instead —
// one marker per skipped range per address.
export function watchEventKey(event: LiveWatchEvent): string {
  if (event.kind === 'log') {
    return `${event.chainId}:${event.txHash ?? 'tx?'}:${event.logIndex ?? -1}`;
  }
  return `${event.chainId}:gap:${event.address}:${event.blockNumber}`;
}

export const watchSubscriptionsCache = createQueryCache<WatchSubscriptionView[] | undefined, [
  number,
]>('watch-subscriptions');

const queryWatchSubscriptions = bindQueryFn(fetchWatchSubscriptions, watchSubscriptionsCache);

const useWatchSubscriptionsQuery = createQueryHook({
  queryFn: queryWatchSubscriptions,
});

/** Read hook for the Home panel's server-side watchlist section. */
export function useWatchSubscriptions(chainId: number) {
  return useWatchSubscriptionsQuery([chainId]);
}
