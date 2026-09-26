// Ops summary service: the /ops operator dashboard feed
// (GET /api/ops/summary). Polled at 30s while the tab is visible
// (polledQuery pattern — the composition usePolling needs to reach this
// hook's stores); every non-meta section of the response may be degraded
// to {error:'unavailable'} by the backend, so the types model that union
// and the view renders per-section honest states instead of trusting
// presence.
import { get, withSignal, api } from '@/util/http';
import { bindQueryFn, createQueryCache } from '@/util/useQuery';
import { createPolledQueryHook, type PolledQueryResult } from './polledQuery';

/** The degraded shape one section takes when its collector failed. */
export type OpsDegradedSection = { error: 'unavailable' };

export type OpsMeta = {
  version: string;
  uptimeSeconds: number;
  timestamp: string;
};

export type OpsChainDbFile = {
  chainType: string;
  /** Raw stem from the file name; `chainId: null` marks an unparseable name. */
  name: string;
  chainId: number | null;
  bytes: number;
  mtime: string;
};

export type OpsStorage = {
  /** null = the file could not be stat'ed — unknown, not zero. */
  mainDbBytes: number | null;
  perChainDbFiles: OpsChainDbFile[];
  solcCache: { files: number; bytes: number };
};

export type OpsIndexingChain = {
  chainId: number;
  statuses: Record<string, number>;
  total: number;
};

export type OpsIndexing = { total: number; chains: OpsIndexingChain[] };

export type OpsWatchSubscription = {
  chainId: number;
  address: string;
  webhookConfigured: boolean;
};

export type OpsWatch = { total: number; subscriptions: OpsWatchSubscription[] };

export type OpsRateLimitBucket = {
  name: string;
  capacity: number;
  requestsPerMinute: number;
  hits: number;
  rejected: number;
};

export type OpsDeepScan = { total: number; byStatus: Record<string, number> };

export type OpsSummary = {
  meta: OpsMeta;
  storage: OpsStorage | OpsDegradedSection;
  indexing: OpsIndexing | OpsDegradedSection;
  watch: OpsWatch | OpsDegradedSection;
  rateLimit: { buckets: OpsRateLimitBucket[] } | OpsDegradedSection;
  deepScan: OpsDeepScan | OpsDegradedSection;
};

export async function fetchOpsSummary(signal?: AbortSignal): Promise<OpsSummary> {
  return get<OpsSummary>('/api/ops/summary', undefined, withSignal(api, signal));
}

// Dashboard cadence: these operator facts change slowly, and the summary's
// own rate budget is 6/min — a 30s poll consumes 2/min of it, leaving the
// burst for manual refreshes.
export const OPS_SUMMARY_POLL_INTERVAL = 30_000;

const opsSummaryCache = createQueryCache<OpsSummary, []>('ops-summary');

const queryOpsSummary = bindQueryFn(fetchOpsSummary, opsSummaryCache);

const useOpsSummaryQuery = createPolledQueryHook({
  queryFn: queryOpsSummary,
  interval: OPS_SUMMARY_POLL_INTERVAL,
});

export type OpsSummaryQuery = PolledQueryResult<OpsSummary>;

export function useOpsSummary(): OpsSummaryQuery {
  return useOpsSummaryQuery([]);
}
