import { useState, useEffect, useCallback, useRef } from 'react';
import { css, cx } from '@linaria/core';
import type { Address } from 'viem';

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
  const [loading, setLoading] = useState(false);
  const prevEventsRef = useRef(0);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
      );
      if (!res.ok) return;
      const data: IndexingStatus = await res.json();
      setStats(data);

      if (data.totalEventsIndexed > prevEventsRef.current) {
        prevEventsRef.current = data.totalEventsIndexed;
        onEventsUpdated?.();
      }
    }
    catch {
      // silently fail
    }
    finally {
      setLoading(false);
    }
  }, [chainId, contractAddress, onEventsUpdated]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (stats?.status !== 'indexing') return;

    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [stats?.status, fetchStatus]);

  const handleRefresh = useCallback(() => {
    fetchStatus();
    onRefresh?.();
  }, [fetchStatus, onRefresh]);

  if (!stats) return null;

  const totalBlocks
    = stats.latestBlock && stats.creationBlock
      ? stats.latestBlock - stats.creationBlock
      : 0;
  const indexedBlocks
    = stats.lastIndexedBlock && stats.creationBlock
      ? stats.lastIndexedBlock - stats.creationBlock
      : 0;
  const progress = totalBlocks > 0 ? Math.min(100, (indexedBlocks / totalBlocks) * 100) : 0;

  const statusColor
    = stats.status === 'indexing'
      ? '#3b82f6'
      : stats.status === 'error'
        ? '#dc2626'
        : '#10b981';

  return (
    <div className={cx(barStyle, className)}>
      <div className={metricStyle}>
        <span
          className={statusDotStyle}
          style={{ background: statusColor }}
        />
        <span className={metricValueStyle}>
          {stats.status === 'indexing' ? 'Indexing' : stats.status === 'error' ? 'Error' : 'Idle'}
        </span>
      </div>

      <div className={separatorStyle} />

      <div className={metricStyle}>
        Blocks:
        <span className={metricValueStyle}>
          {indexedBlocks.toLocaleString()}
          {' '}
          /
          {totalBlocks.toLocaleString()}
        </span>
        (
        {progress.toFixed(1)}
        %)
      </div>

      <div className={progressWrapperStyle}>
        <div className={progressTrackStyle}>
          <div className={progressFillStyle} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className={separatorStyle} />

      <div className={metricStyle}>
        Events:
        <span className={metricValueStyle}>
          {(stats.totalEventsIndexed || 0).toLocaleString()}
        </span>
      </div>

      <div className={separatorStyle} />

      <div className={metricStyle}>
        Types:
        <span className={metricValueStyle}>{stats.eventTypes?.length || 0}</span>
      </div>

      {stats.errorMessage && (
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
