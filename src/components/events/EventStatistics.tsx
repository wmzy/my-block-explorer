import { useState, useEffect, useCallback, useRef } from 'react';
import { css, cx } from '@linaria/core';
import type { Address } from 'viem';
import { get } from '@/util/http';
import { formatNumber } from '@/utils/format';
import {
  EVENT_RANGES_POLL_INTERVAL,
  useEventRanges,
} from '@/services/eventsRanges';
import { useGenerationGuard } from '@/util/useGenerationGuard';

type IndexingStatus = {
  chainId: number;
  contractAddress: Address;
  status: 'idle' | 'indexing' | 'error';
  creationBlock: number;
  lastIndexedBlock: number;
  latestBlock: number;
  totalEventsIndexed: number;
  eventTypes: string[];
  errorMessage?: string;
};

type EventStatisticsProps = {
  chainId: number;
  contractAddress: Address;
  className?: string;
  onRefresh?: () => void;
  onEventsUpdated?: () => void;
};

type RangeStatus = 'pending' | 'indexing' | 'paused' | 'completed' | 'error';
type RangeDirection = 'forward' | 'backward';

// Range row shape as serialized by the /events/ranges endpoint (the same one
// IndexingRangeManager consumes): block numbers may arrive as strings
// (bigint serialization), so both forms are accepted and coerced.
type IndexingRangeSummary = {
  fromBlock: number | string;
  toBlock: number | string;
  currentBlock: number | string | null;
  status: RangeStatus;
  direction: RangeDirection;
};

export type IndexingCoverage = {
  coveredBlocks: number;
  spanBlocks: number;
  coverage: number;
};

// Statuses that keep a walked-block checkpoint. Paused and errored ranges
// persist currentBlock (both resume from it instead of restarting), so the
// blocks they already walked are indexed and queryable — the backend's own
// range aggregation counts them the same way.
const CHECKPOINTED_STATUSES: ReadonlySet<RangeStatus> = new Set(['indexing', 'paused', 'error']);

/**
 * Union-of-ranges coverage over the span [min fromBlock, max toBlock].
 * Overlapping ranges must not double-count, so the covered intervals are
 * sweep-merged before summing. A completed range covers its full span; a
 * checkpointed range (indexing, paused, or errored) covers the blocks
 * already walked (direction-aware, clipped to the range bounds). Only
 * pending ranges contribute nothing — matching the walked-progress fill the
 * SegmentedProgressBar renders for checkpointed segments in
 * IndexingRangeManager.
 */
export const computeIndexingCoverage = (ranges: IndexingRangeSummary[]): IndexingCoverage => {
  if (ranges.length === 0) return { coveredBlocks: 0, spanBlocks: 0, coverage: 0 };

  const spanStart = Math.min(...ranges.map(r => Number(r.fromBlock)));
  const spanEnd = Math.max(...ranges.map(r => Number(r.toBlock)));
  const spanBlocks = spanEnd - spanStart + 1;
  if (spanBlocks <= 0) return { coveredBlocks: 0, spanBlocks: 0, coverage: 0 };

  const intervals: Array<[number, number]> = [];
  for (const range of ranges) {
    const from = Number(range.fromBlock);
    const to = Number(range.toBlock);
    if (range.status === 'completed') {
      intervals.push([from, to]);
    } else if (CHECKPOINTED_STATUSES.has(range.status) && range.currentBlock !== null) {
      // Walked position clipped into the range bounds; the covered side runs
      // from the boundary the direction started at down/up to it.
      const current = Math.min(Math.max(Number(range.currentBlock), from), to);
      intervals.push(range.direction === 'backward' ? [current, to] : [from, current]);
    }
  }

  // Sweep-merge by start; an interval starting at or before the running end
  // only extends coverage by whatever lies past that end.
  intervals.sort((a, b) => a[0] - b[0]);
  let coveredBlocks = 0;
  let mergedEnd: number | null = null;
  for (const [start, end] of intervals) {
    if (mergedEnd === null || start > mergedEnd) {
      coveredBlocks += end - start + 1;
      mergedEnd = end;
    } else if (end > mergedEnd) {
      coveredBlocks += end - mergedEnd;
      mergedEnd = end;
    }
  }

  return {
    coveredBlocks,
    spanBlocks,
    coverage: Math.min(100, (coveredBlocks / spanBlocks) * 100),
  };
};

const barStyle = css`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--haze-color-text-secondary);
  flex-wrap: wrap;
`;

const metricStyle = css`
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
`;

const metricValueStyle = css`
  font-weight: 600;
  color: var(--haze-color-text);
`;

// Denominator hint for the coverage metric: 100% means "all of the
// configured ranges", never "complete contract history".
const coverageScopeStyle = css`
  font-size: 11px;
  color: var(--haze-color-text-secondary);
`;

const separatorStyle = css`
  width: 1px;
  height: 16px;
  background: var(--haze-color-border);
`;

const progressWrapperStyle = css`
  flex: 1;
  min-width: 120px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const progressTrackStyle = css`
  flex: 1;
  height: 4px;
  background: var(--haze-color-bg-muted);
  border-radius: 2px;
  overflow: hidden;
`;

const progressFillStyle = css`
  height: 100%;
  background: linear-gradient(90deg, var(--haze-color-primary), var(--haze-color-primary-active));
  border-radius: 2px;
  transition: width 0.3s ease;
`;

const statusDotStyle = css`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
`;

const refreshBtnStyle = css`
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 14px;
  color: var(--haze-color-text-secondary);
  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const errorTextStyle = css`
  color: var(--haze-color-danger);
  font-size: 12px;
`;

export const EventStatistics = ({
  chainId,
  contractAddress,
  className,
  onRefresh,
  onEventsUpdated,
}: EventStatisticsProps) => {
  const [stats, setStats] = useState<IndexingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  // True when the status endpoint itself failed (503 from the honest
  // error envelope) — the bar then says "Status unavailable" instead of
  // silently disappearing, and good /ranges data still renders coverage.
  const [statusFailed, setStatusFailed] = useState(false);
  const prevEventsRef = useRef(0);
  // Generation guard (shared claim-based hook, util/useGenerationGuard):
  // the Contract route reuses this component across a contract switch, so
  // a status fetch started for the previous contract can settle after the
  // new one answered and would paint the old contract's status and outage
  // state over the new contract's. Every run claims the current identity;
  // only the newest run may write, and a contract change restarts the
  // "events grew" counter so the new contract's total is compared against
  // its own baseline (its count can legitimately be lower than the
  // previous contract's).
  const statusGuard = useGenerationGuard();
  const identityRef = useRef(`${chainId}:${contractAddress}`);

  if (identityRef.current !== `${chainId}:${contractAddress}`) {
    identityRef.current = `${chainId}:${contractAddress}`;
    statusGuard.invalidate();
    prevEventsRef.current = 0;
  }

  // Ranges half: the shared query-cache service (services/eventsRanges.ts)
  // — ONE cache entry and ONE 3s poll loop shared with
  // IndexingRangeManager. EventStatistics passes the aggregate-status leg
  // of its poll gate here (the legacy status can index without range
  // rows); the any-range-indexing leg the hook derives from its own data.
  const rangesQuery = useEventRanges(chainId, contractAddress, stats?.status === 'indexing');
  const { refetch: refetchRanges, fetching: rangesFetching } = rangesQuery;
  const ranges = rangesQuery.data?.ranges ?? [];

  // Indexing status drives the status/event metrics; the ranges feed the
  // coverage metric through the shared service above. The old
  // Promise.allSettled pair's independence guarantee survives the split:
  // a status outage keeps the last good stats and the coverage metric
  // keeps rendering from the shared ranges cache — one endpoint failing
  // still cannot drag the other's good data down with it.
  const fetchStatus = useCallback(async () => {
    // Claim a NEW generation for this run: an id merely READ from the ref
    // is shared by every overlapping tick, so isCurrent() could not tell
    // a superseded run from the newest one and a stale 3s tick was able
    // to paint over fresher status (and clear the spinner).
    const requestId = statusGuard.claim();
    const isCurrent = () => statusGuard.isCurrent(requestId);
    try {
      setLoading(true);
      const status = await get<IndexingStatus>(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
      );
      if (!isCurrent()) return;
      setStats(status);
      setStatusFailed(false);
      if (status.totalEventsIndexed > prevEventsRef.current) {
        prevEventsRef.current = status.totalEventsIndexed;
        onEventsUpdated?.();
      }
    } catch {
      // Keep the last good stats (if any); mark the outage honestly.
      if (isCurrent()) setStatusFailed(true);
    } finally {
      // Only the newest run owns the spinner: a superseded run must not
      // clear the flag its successor set.
      if (isCurrent()) setLoading(false);
    }
  }, [chainId, contractAddress, onEventsUpdated, statusGuard]);

  useEffect(() => {
    fetchStatus();
    return () => {
      // Unmount / identity change invalidates in-flight runs.
      statusGuard.invalidate();
    };
  }, [fetchStatus, statusGuard]);

  // Poll the status endpoint at the shared 3s cadence while anything is
  // indexing (the aggregate status OR any individual range — the legacy
  // status row can lag a freshly started range job); the ranges half
  // polls on the same cadence inside the shared service, so the coverage
  // bar advances in step with the segmented range view. Idle stays
  // unpolled as before.
  const anyRangeIndexing = ranges.some(r => r.status === 'indexing');

  useEffect(() => {
    if (stats?.status !== 'indexing' && !anyRangeIndexing) return;

    const id = setInterval(fetchStatus, EVENT_RANGES_POLL_INTERVAL);
    return () => clearInterval(id);
  }, [stats?.status, anyRangeIndexing, fetchStatus]);

  const handleRefresh = useCallback(() => {
    fetchStatus();
    // The old single refresh re-fetched BOTH halves of the allSettled
    // pair; the split keeps that — the shared ranges entry refreshes too.
    void refetchRanges();
    onRefresh?.();
  }, [fetchStatus, refetchRanges, onRefresh]);

  // Spinner/disabled state covers both halves of the old allSettled pair:
  // the local status flag and the shared ranges fetch (fetching is true
  // during every shared tick — exactly when the old combined fetch showed
  // its spinner).
  const busy = loading || rangesFetching;

  if (!stats && !statusFailed) return null;

  // Honest progress metric: how much of the span between the lowest range
  // start and the highest range end is covered by the union of covered
  // range intervals. The old creation→latest linear percentage overstated
  // progress whenever ranges did not span the full distance.
  const coverage = computeIndexingCoverage(ranges);

  const statusColor =
    stats?.status === 'indexing'
      ? 'var(--haze-color-info)'
      : stats?.status === 'error'
        ? 'var(--haze-color-danger)'
        : 'var(--haze-color-success)';

  return (
    <div className={cx(barStyle, className)}>
      <div className={metricStyle}>
        {stats ? (
          <>
            <span className={statusDotStyle} style={{ background: statusColor }} />
            <span className={metricValueStyle}>
              {stats.status === 'indexing'
                ? 'Indexing'
                : stats.status === 'error'
                  ? 'Error'
                  : 'Idle'}
            </span>
          </>
        ) : (
          <span className={errorTextStyle}>Indexing status unavailable</span>
        )}
      </div>

      <div className={separatorStyle} />

      <div className={metricStyle}>
        Indexing coverage:
        <span className={metricValueStyle}>
          {formatNumber(coverage.coveredBlocks)} /{formatNumber(coverage.spanBlocks)}
        </span>
        ({coverage.coverage.toFixed(1)}
        %)
        <span className={coverageScopeStyle}>of your configured block ranges</span>
      </div>

      <div className={progressWrapperStyle}>
        <div className={progressTrackStyle}>
          <div className={progressFillStyle} style={{ width: `${coverage.coverage}%` }} />
        </div>
      </div>

      <div className={separatorStyle} />

      <div className={metricStyle}>
        Events:
        <span className={metricValueStyle}>
          {stats ? formatNumber(stats.totalEventsIndexed || 0) : '—'}
        </span>
      </div>

      <div className={separatorStyle} />

      <div className={metricStyle}>
        Types:
        <span className={metricValueStyle}>{stats ? stats.eventTypes?.length || 0 : '—'}</span>
      </div>

      {stats?.errorMessage && (
        <>
          <div className={separatorStyle} />
          <span className={errorTextStyle}>{stats.errorMessage}</span>
        </>
      )}

      <button
        className={refreshBtnStyle}
        onClick={handleRefresh}
        disabled={busy}
        title="Refresh"
      >
        {busy ? '...' : '↻'}
      </button>
    </div>
  );
};

export default EventStatistics;
