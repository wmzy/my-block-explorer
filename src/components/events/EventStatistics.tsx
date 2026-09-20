import { useState, useEffect, useCallback, useRef } from 'react';
import { css, cx } from '@linaria/core';
import type { Address } from 'viem';
import { get } from '@/util/http';

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
const CHECKPOINTED_STATUSES: ReadonlySet<RangeStatus> = new Set([
  'indexing',
  'paused',
  'error',
]);

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
export const computeIndexingCoverage = (
  ranges: IndexingRangeSummary[],
): IndexingCoverage => {
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
  background: var(--haze-surface, #f9fafb);
  border: 1px solid var(--haze-border, #e5e7eb);
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--haze-text-secondary, #6b7280);
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
  color: var(--haze-text, #111827);
`;

// Denominator hint for the coverage metric: 100% means "all of the
// configured ranges", never "complete contract history".
const coverageScopeStyle = css`
  font-size: 11px;
  color: var(--haze-text-secondary, #6b7280);
`;

const separatorStyle = css`
  width: 1px;
  height: 16px;
  background: var(--haze-border, #d1d5db);
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
  background: var(--haze-border, #e5e7eb);
  border-radius: 2px;
  overflow: hidden;
`;

const progressFillStyle = css`
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #1d4ed8);
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
  color: var(--haze-text-secondary, #6b7280);
  &:hover {
    background: var(--haze-border, #e5e7eb);
  }
`;

const errorTextStyle = css`
  color: #dc2626;
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
  const [ranges, setRanges] = useState<IndexingRangeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // True when the status endpoint itself failed (503 from the honest
  // error envelope) — the bar then says "Status unavailable" instead of
  // silently disappearing, and good /ranges data still renders coverage.
  const [statusFailed, setStatusFailed] = useState(false);
  const prevEventsRef = useRef(0);

  // Indexing status drives the status/event metrics; the ranges feed the
  // coverage metric (same endpoint IndexingRangeManager polls). Both ride
  // one refresh and one 3s poll so the bar never disagrees with the
  // segmented range view. allSettled: one endpoint failing must not drag
  // the other's good data down with it.
  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const [statusRes, rangesRes] = await Promise.allSettled([
        get<IndexingStatus>(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        ),
        get<{ ranges?: IndexingRangeSummary[] }>(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges`,
        ),
      ]);
      if (statusRes.status === 'fulfilled') {
        setStats(statusRes.value);
        setStatusFailed(false);

        if (statusRes.value.totalEventsIndexed > prevEventsRef.current) {
          prevEventsRef.current = statusRes.value.totalEventsIndexed;
          onEventsUpdated?.();
        }
      }
      else {
        // Keep the last good stats (if any); mark the outage honestly.
        setStatusFailed(true);
      }
      if (rangesRes.status === 'fulfilled') {
        setRanges(rangesRes.value.ranges ?? []);
      }
    }
    finally {
      setLoading(false);
    }
  }, [chainId, contractAddress, onEventsUpdated]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll at IndexingRangeManager's 3s cadence while anything is indexing
  // (the aggregate status OR any individual range — the legacy status row
  // can lag a freshly started range job), so the coverage bar advances in
  // step with the segmented range view. Idle stays unpolled as before.
  const anyRangeIndexing = ranges.some(r => r.status === 'indexing');

  useEffect(() => {
    if (stats?.status !== 'indexing' && !anyRangeIndexing) return;

    const id = setInterval(fetchStatus, 3000);
    return () => clearInterval(id);
  }, [stats?.status, anyRangeIndexing, fetchStatus]);

  const handleRefresh = useCallback(() => {
    fetchStatus();
    onRefresh?.();
  }, [fetchStatus, onRefresh]);

  if (!stats && !statusFailed) return null;

  // Honest progress metric: how much of the span between the lowest range
  // start and the highest range end is covered by the union of covered
  // range intervals. The old creation→latest linear percentage overstated
  // progress whenever ranges did not span the full distance.
  const coverage = computeIndexingCoverage(ranges);

  const statusColor
    = stats?.status === 'indexing'
      ? '#3b82f6'
      : stats?.status === 'error'
        ? '#dc2626'
        : '#10b981';

  return (
    <div className={cx(barStyle, className)}>
      <div className={metricStyle}>
        {stats ? (
          <>
            <span
              className={statusDotStyle}
              style={{ background: statusColor }}
            />
            <span className={metricValueStyle}>
              {stats.status === 'indexing' ? 'Indexing' : stats.status === 'error' ? 'Error' : 'Idle'}
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
          {coverage.coveredBlocks.toLocaleString()}
          {' '}
          /
          {coverage.spanBlocks.toLocaleString()}
        </span>
        (
        {coverage.coverage.toFixed(1)}
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
          {stats ? (stats.totalEventsIndexed || 0).toLocaleString() : '—'}
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
        disabled={loading}
        title="Refresh"
      >
        {loading ? '...' : '↻'}
      </button>
    </div>
  );
};

export default EventStatistics;
