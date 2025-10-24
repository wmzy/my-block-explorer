/**
 * EventTable component - displays contract events with pagination, sorting, and filtering
 * Integrates with events API endpoints for real-time data display
 */

import React, { useState, useEffect, useCallback } from 'react';
import { styled } from '@linaria/react';
import { Address, formatEther, formatUnits } from 'viem';

// Types
interface EventData {
  blockNumber: number;
  blockTimestamp: string;
  transactionHash: `0x${string}`;
  eventName: string;
  from?: string;
  to?: string;
  value?: string;
  [key: string]: any;
}

interface EventTableProps {
  chainId: number;
  contractAddress: Address;
  initialEvents?: EventData[];
  className?: string;
}

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
}

interface FilterState {
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  fromAddress?: string;
  toAddress?: string;
}

interface SortState {
  field: string;
  direction: 'asc' | 'desc';
}

// Styled components
const TableContainer = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
`;

const TableHeader = styled.thead`
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
`;

const TableHeaderCell = styled.th<{ sortable?: boolean }>`
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  color: #374151;
  cursor: ${props => props.sortable ? 'pointer' : 'default'};
  user-select: none;
  position: relative;

  &:hover {
    background: #f1f5f9;
  }
`;

const SortIndicator = styled.span`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: #6b7280;
  font-size: 12px;
`;

const TableBody = styled.tbody`
  & tr {
    border-bottom: 1px solid #e2e8f0;

    &:hover {
      background: #f9fafb;
    }
  }
`;

const TableCell = styled.td`
  padding: 12px 16px;
  color: #374151;
  vertical-align: top;
`;

const EventNameCell = styled(TableCell)`
  font-family: 'Monaco', 'Menlo', monospace;
  font-weight: 600;
  color: #4f46e5;
`;

const AddressCell = styled(TableCell)`
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
`;

const TransactionHashCell = styled(TableCell)`
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
`;

const ValueCell = styled(TableCell)`
  font-family: 'Monaco', 'Menlo', monospace;
  font-weight: 600;
  color: #059669;
`;

const TimestampCell = styled(TableCell)`
  color: #6b7280;
  font-size: 12px;
`;

const PaginationContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
`;

const PaginationInfo = styled.div`
  color: #6b7280;
  font-size: 14px;
`;

const PaginationControls = styled.div`
  display: flex;
  gap: 8px;
`;

const PaginationButton = styled.button<{ disabled?: boolean }>`
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  background: ${props => props.disabled ? '#f9fafb' : 'white'};
  color: ${props => props.disabled ? '#9ca3af' : '#374151'};
  border-radius: 4px;
  cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
  font-size: 14px;

  &:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }
`;

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 48px;
  color: #6b7280;
`;

const LoadingSpinner = styled.div`
  width: 24px;
  height: 24px;
  border: 2px solid #e5e7eb;
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const ErrorContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  color: #dc2626;
  text-align: center;
`;

const ErrorMessage = styled.div`
  margin-bottom: 16px;
  font-weight: 500;
`;

const RetryButton = styled.button`
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;

  &:hover {
    background: #2563eb;
  }
`;

const EmptyStateContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  color: #6b7280;
  text-align: center;
`;

const EmptyStateIcon = styled.div`
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
`;

const EmptyStateTitle = styled.div`
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
`;

const EmptyStateDescription = styled.div`
  font-size: 14px;
  color: #9ca3af;
`;

// Helper functions
const formatAddress = (address: string): string => {
  if (!address) return 'N/A';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const formatTransactionHash = (hash: string): string => {
  if (!hash) return 'N/A';
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
};

const formatTimestamp = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch {
    return 'Invalid timestamp';
  }
};

const formatValue = (value?: string): string => {
  if (!value) return 'N/A';
  try {
    const etherValue = formatEther(BigInt(value));
    return `${parseFloat(etherValue).toFixed(6)} ETH`;
  } catch {
    return `${value} wei`;
  }
};

// Main component
export const EventTable: React.FC<EventTableProps> = ({
  chainId,
  contractAddress,
  initialEvents = [],
  className
}) => {
  const [events, setEvents] = useState<EventData[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: 50,
    total: initialEvents.length,
    hasMore: false,
  });
  const [filters, setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState<SortState>({
    field: 'block_timestamp',
    direction: 'desc'
  });

  // API call function
  const fetchEvents = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams({
        limit: pagination.limit.toString(),
        sort: sort.direction,
        sortBy: sort.field,
      });

      if (cursor) {
        queryParams.set('cursor', cursor);
      }

      // Add filters
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          queryParams.set(key, value.toString());
        }
      });

      const response = await fetch(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?${queryParams}`,
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

      setEvents(prev => cursor ? [...prev, ...data.events] : data.events);
      setPagination(prev => ({
        ...prev,
        total: data.total || data.events.length,
        hasMore: data.hasMore,
        nextCursor: data.nextCursor,
      }));

    } catch (err) {
      console.error('Failed to fetch events:', err);
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [chainId, contractAddress, pagination.limit, sort, filters]);

  // Initial load
  useEffect(() => {
    if (initialEvents.length === 0) {
      fetchEvents();
    }
  }, [fetchEvents, initialEvents.length]);

  // Handle sorting
  const handleSort = (field: string) => {
    const newDirection = sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc';
    setSort({ field, direction: newDirection });
    setEvents([]);
    setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
  };

  // Handle pagination
  const handleNextPage = () => {
    if (pagination.nextCursor) {
      fetchEvents(pagination.nextCursor);
    }
  };

  const handlePrevPage = () => {
    // For cursor-based pagination, we'd need to track previous cursors
    // For now, implement simple page-based navigation
    const prevPage = Math.max(1, pagination.page - 1);
    setPagination(prev => ({ ...prev, page: prevPage }));
    setEvents([]);
    fetchEvents();
  };

  const handleRetry = () => {
    setError(null);
    fetchEvents();
  };

  // Render loading state
  if (loading && events.length === 0) {
    return (
      <TableContainer className={className}>
        <LoadingContainer>
          <LoadingSpinner />
          <span style={{ marginLeft: 12 }}>Loading events...</span>
        </LoadingContainer>
      </TableContainer>
    );
  }

  // Render error state
  if (error && events.length === 0) {
    return (
      <TableContainer className={className}>
        <ErrorContainer>
          <ErrorMessage>Failed to load events</ErrorMessage>
          <div style={{ color: '#9ca3af', marginBottom: 16 }}>{error}</div>
          <RetryButton onClick={handleRetry}>Retry</RetryButton>
        </ErrorContainer>
      </TableContainer>
    );
  }

  // Render empty state
  if (events.length === 0 && !loading) {
    return (
      <TableContainer className={className}>
        <EmptyStateContainer>
          <EmptyStateIcon>📋</EmptyStateIcon>
          <EmptyStateTitle>No events found</EmptyStateTitle>
          <EmptyStateDescription>
            This contract has not emitted any events yet, or no events match the current filters.
          </EmptyStateDescription>
        </EmptyStateContainer>
      </TableContainer>
    );
  }

  return (
    <TableContainer className={className}>
      <Table>
        <TableHeader>
          <tr>
            <TableHeaderCell sortable onClick={() => handleSort('block_number')}>
              Block #
              <SortIndicator>{sort.field === 'block_number' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</SortIndicator>
            </TableHeaderCell>
            <TableHeaderCell sortable onClick={() => handleSort('block_timestamp')}>
              Time
              <SortIndicator>{sort.field === 'block_timestamp' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</SortIndicator>
            </TableHeaderCell>
            <TableHeaderCell sortable onClick={() => handleSort('event_name')}>
              Event
              <SortIndicator>{sort.field === 'event_name' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</SortIndicator>
            </TableHeaderCell>
            <TableHeaderCell>From</TableHeaderCell>
            <TableHeaderCell>To</TableHeaderCell>
            <TableHeaderCell>Value</TableHeaderCell>
            <TableHeaderCell>Transaction</TableHeaderCell>
          </tr>
        </TableHeader>
        <TableBody>
          {events.map((event, index) => (
            <tr key={`${event.transactionHash}-${index}`}>
              <TableCell>{event.blockNumber}</TableCell>
              <TimestampCell>{formatTimestamp(event.blockTimestamp)}</TimestampCell>
              <EventNameCell>{event.eventName}</EventNameCell>
              <AddressCell>
                {event.from ? (
                  <a
                    href={`/chains/${chainId}/addresses/${event.from}`}
                    style={{ color: '#4f46e5', textDecoration: 'none' }}
                  >
                    {formatAddress(event.from)}
                  </a>
                ) : 'N/A'}
              </AddressCell>
              <AddressCell>
                {event.to ? (
                  <a
                    href={`/chains/${chainId}/addresses/${event.to}`}
                    style={{ color: '#4f46e5', textDecoration: 'none' }}
                  >
                    {formatAddress(event.to)}
                  </a>
                ) : 'N/A'}
              </AddressCell>
              <ValueCell>{formatValue(event.value)}</ValueCell>
              <TransactionHashCell>
                <a
                  href={`/chains/${chainId}/transactions/${event.transactionHash}`}
                  style={{ color: '#4f46e5', textDecoration: 'none' }}
                >
                  {formatTransactionHash(event.transactionHash)}
                </a>
              </TransactionHashCell>
            </tr>
          ))}
        </TableBody>
      </Table>

      {/* Loading indicator for pagination */}
      {loading && events.length > 0 && (
        <LoadingContainer>
          <LoadingSpinner />
          <span style={{ marginLeft: 12 }}>Loading more events...</span>
        </LoadingContainer>
      )}

      {/* Error overlay for pagination errors */}
      {error && events.length > 0 && (
        <ErrorContainer>
          <ErrorMessage>Error loading more events</ErrorMessage>
          <RetryButton onClick={handleRetry}>Retry</RetryButton>
        </ErrorContainer>
      )}

      {/* Pagination controls */}
      <PaginationContainer>
        <PaginationInfo>
          Showing {events.length} of {pagination.total} events
        </PaginationInfo>
        <PaginationControls>
          <PaginationButton
            onClick={handlePrevPage}
            disabled={pagination.page <= 1 || loading}
          >
            Previous
          </PaginationButton>
          <PaginationButton
            onClick={handleNextPage}
            disabled={!pagination.hasMore || loading}
          >
            Next
          </PaginationButton>
        </PaginationControls>
      </PaginationContainer>
    </TableContainer>
  );
};

export default EventTable;