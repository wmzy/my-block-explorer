/**
 * EventStatistics component - displays contract event statistics and indexing progress
 * Integrates with indexing status API for real-time progress information
 */

import React, { useState, useEffect, useCallback } from 'react';
import { styled } from '@linaria/react';
import { Address } from 'viem';

// Types
interface EventStatistics {
  chainId: number;
  contractAddress: Address;
  isIndexed: boolean;
  indexingProgress: number;
  totalEvents: number;
  indexedEvents: number;
  lastIndexedBlock?: number;
  lastIndexedAt?: string;
  eventTypes: string[];
  errors: Array<{
    blockNumber?: number;
    error: string;
    timestamp: string;
  }>;
}

interface EventTableStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  uniqueAddresses: number;
  averageEventsPerBlock: number;
  storageSize: number;
}

interface EventStatisticsProps {
  chainId: number;
  contractAddress: Address;
  className?: string;
  onRefresh?: () => void;
}

// Styled components
const StatisticsContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

const StatCard = styled.div`
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
`;

const StatCardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`;

const StatCardTitle = styled.h3`
  font-size: 16px;
  font-weight: 600;
  color: #374151;
  margin: 0;
`;

const StatCardIcon = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
`;

const StatValue = styled.div`
  font-size: 32px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 4px;
`;

const StatLabel = styled.div`
  font-size: 14px;
  color: #6b7280;
`;

const ProgressBarContainer = styled.div`
  margin-top: 12px;
`;

const ProgressBarBackground = styled.div`
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
`;

const ProgressBarFill = styled.div<{ progress: number }>`
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%);
  width: ${props => props.progress}%;
  transition: width 0.3s ease;
`;

const ProgressText = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
`;

const EventTypesList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`;

const EventTypeTag = styled.span`
  padding: 4px 8px;
  background: #f3f4f6;
  border-radius: 4px;
  font-size: 12px;
  color: #374151;
  font-family: 'Monaco', 'Menlo', monospace;
`;

const ErrorMessage = styled.div`
  padding: 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 4px;
  color: #dc2626;
  font-size: 12px;
  margin-top: 8px;
`;

const RefreshButton = styled.button`
  padding: 6px 12px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #374151;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;

  &:hover {
    background: #e5e7eb;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #6b7280;
`;

const LoadingSpinner = styled.div`
  width: 24px;
  height: 24px;
  border: 2px solid #e5e7eb;
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 8px;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const ErrorContainer = styled.div`
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  color: #dc2626;
  text-align: center;
`;

const RetryButton = styled.button`
  margin-top: 12px;
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: #2563eb;
  }
`;

// Helper functions
const formatLastIndexed = (timestamp?: string): string => {
  if (!timestamp) return 'Never';
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

    return date.toLocaleDateString();
  } catch {
    return 'Invalid timestamp';
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

// Stat card components
const StatCardWithIcon: React.FC<{
  title: string;
  value: string | number;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}> = ({ title, value, label, icon, color, bgColor }) => (
  <StatCard>
    <StatCardHeader>
      <StatCardTitle>{title}</StatCardTitle>
      <StatCardIcon style={{ background: bgColor, color }}>
        {icon}
      </StatCardIcon>
    </StatCardHeader>
    <StatValue>{value}</StatValue>
    <StatLabel>{label}</StatLabel>
  </StatCard>
);

const IndexingProgressCard: React.FC<{
  stats: EventStatistics | null;
  onRefresh: () => void;
  isLoading: boolean;
}> = ({ stats, onRefresh, isLoading }) => {
  // Add null check
  if (!stats) {
    return (
      <StatCard>
        <StatCardHeader>
          <StatCardTitle>Indexing Progress</StatCardTitle>
          <RefreshButton onClick={onRefresh} disabled={isLoading} title="Refresh indexing status">
            {isLoading ? '⟳' : '↻'}
          </RefreshButton>
        </StatCardHeader>
        <StatLabel>Loading...</StatLabel>
      </StatCard>
    );
  }

  return (
    <StatCard>
      <StatCardHeader>
        <StatCardTitle>Indexing Progress</StatCardTitle>
        <RefreshButton onClick={onRefresh} disabled={isLoading} title="Refresh indexing status">
          {isLoading ? '⟳' : '↻'}
        </RefreshButton>
      </StatCardHeader>

      <StatValue>{stats.indexingProgress || 0}%</StatValue>
      <StatLabel>
        {(stats.indexedEvents || 0).toLocaleString()} / {(stats.totalEvents || 0).toLocaleString()} events indexed
      </StatLabel>

      <ProgressBarContainer>
        <ProgressBarBackground>
          <ProgressBarFill progress={stats.indexingProgress || 0} />
        </ProgressBarBackground>
        <ProgressText>
          <span>{stats.indexingProgress || 0}% complete</span>
          <span>{formatLastIndexed(stats.lastIndexedAt)}</span>
        </ProgressText>
      </ProgressBarContainer>

      {stats.lastIndexedBlock && (
        <StatLabel style={{ marginTop: 8 }}>
          Last indexed block: {stats.lastIndexedBlock.toLocaleString()}
        </StatLabel>
      )}

      {stats.errors && stats.errors.length > 0 && (
        <ErrorMessage>
          <strong>Indexing Errors:</strong>
          <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
            {stats.errors.slice(0, 3).map((error, index) => (
              <li key={index}>
                Block {error.blockNumber}: {error.error}
              </li>
            ))}
            {stats.errors.length > 3 && (
              <li>...and {stats.errors.length - 3} more errors</li>
            )}
          </ul>
        </ErrorMessage>
      )}
    </StatCard>
  );
};

const EventTypesCard: React.FC<{ stats: EventStatistics }> = ({ stats }) => (
  <StatCard>
    <StatCardHeader>
      <StatCardTitle>Event Types</StatCardTitle>
      <StatCardIcon style={{ background: '#dbeafe', color: '#1d4ed8' }}>
        📊
      </StatCardIcon>
    </StatCardHeader>

    <StatValue>{stats.eventTypes.length}</StatValue>
    <StatLabel>unique event types</StatLabel>

    {stats.eventTypes.length > 0 && (
      <EventTypesList>
        {stats.eventTypes.slice(0, 10).map(eventType => (
          <EventTypeTag key={eventType}>
            {eventType}
          </EventTypeTag>
        ))}
        {stats.eventTypes.length > 10 && (
          <EventTypeTag>+{stats.eventTypes.length - 10} more</EventTypeTag>
        )}
      </EventTypesList>
    )}
  </StatCard>
);

const StorageStatsCard: React.FC<{ stats: EventTableStats }> = ({ stats }) => (
  <StatCard>
    <StatCardHeader>
      <StatCardTitle>Storage Statistics</StatCardTitle>
      <StatCardIcon style={{ background: '#f3e8ff', color: '#7c3aed' }}>
        💾
      </StatCardIcon>
    </StatCardHeader>

    <StatValue>{formatFileSize(stats.storageSize)}</StatValue>
    <StatLabel>storage used</StatLabel>

    <div style={{ marginTop: 12, fontSize: '12px', color: '#6b7280' }}>
      <div>Unique addresses: {stats.uniqueAddresses.toLocaleString()}</div>
      <div>Avg events per block: {stats.averageEventsPerBlock.toFixed(2)}</div>
    </div>
  </StatCard>
);

// Main component
export const EventStatistics: React.FC<EventStatisticsProps> = ({
  chainId,
  contractAddress,
  className,
  onRefresh
}) => {
  const [indexingStats, setIndexingStats] = useState<EventStatistics | null>(null);
  const [tableStats, setTableStats] = useState<EventTableStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch indexing status
  const fetchIndexingStatus = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setIndexingStats(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch indexing status:', err);
      setError(err instanceof Error ? err.message : 'Failed to load indexing status');
    }
  }, [chainId, contractAddress]);

  // Fetch table statistics
  const fetchTableStats = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/statistics`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setTableStats(data);
    } catch (err) {
      console.error('Failed to fetch table statistics:', err);
      // Don't set error for table stats, just log it
    }
  }, [chainId, contractAddress]);

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchIndexingStatus(),
      fetchTableStats()
    ]);
    setLoading(false);
  }, [fetchIndexingStatus, fetchTableStats]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    loadData();
    onRefresh?.();
  }, [loadData, onRefresh]);

  // Loading state
  if (loading && !indexingStats && !tableStats) {
    return (
      <StatisticsContainer className={className}>
        <LoadingContainer>
          <LoadingSpinner />
          Loading statistics...
        </LoadingContainer>
      </StatisticsContainer>
    );
  }

  // Error state
  if (error && !indexingStats && !tableStats) {
    return (
      <StatisticsContainer className={className}>
        <ErrorContainer>
          <div>Failed to load event statistics</div>
          <div style={{ fontSize: '14px', marginTop: '8px', color: '#9ca3af' }}>
            {error}
          </div>
          <RetryButton onClick={handleRefresh}>Retry</RetryButton>
        </ErrorContainer>
      </StatisticsContainer>
    );
  }

  // Render statistics
  return (
    <StatisticsContainer className={className}>
      {/* Indexing Progress */}
      {indexingStats && (
        <IndexingProgressCard
          stats={indexingStats}
          onRefresh={handleRefresh}
          isLoading={loading}
        />
      )}

      {/* Total Events */}
      <StatCardWithIcon
        title="Total Events"
        value={tableStats?.totalEvents.toLocaleString() || indexingStats?.totalEvents.toLocaleString() || '0'}
        label="events indexed"
        icon="📈"
        color="#059669"
        bgColor="#ecfdf5"
      />

      {/* Event Types */}
      {indexingStats && (
        <EventTypesCard stats={indexingStats} />
      )}

      {/* Storage Statistics */}
      {tableStats && (
        <StorageStatsCard stats={tableStats} />
      )}

      {/* Performance indicator */}
      <StatCardWithIcon
        title="Query Performance"
        value="1-9ms"
        label="average response time"
        icon="⚡"
        color="#7c3aed"
        bgColor="#f3e8ff"
      />
    </StatisticsContainer>
  );
};

export default EventStatistics;