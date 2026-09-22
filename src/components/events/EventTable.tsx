/**
 * EventTable component - displays contract events with pagination, sorting, and filtering
 * Integrates with events API endpoints for real-time data display
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { styled } from '@linaria/react';
import { Address, formatEther, AbiEvent } from 'viem';
import { EventFilterPanel, type EventFilterState } from './EventFilterPanel';
import { get } from '@/util/http';
import { getApiBase } from '@/util/apiBase';

// Types
type EventData = {
  blockNumber: number;
  // null when the block timestamp could not be fetched; rendered as a placeholder
  blockTimestamp: string | null;
  transactionHash: `0x${string}`;
  eventName: string;
  // false until the event's block finalizes and reorg reconciliation
  // verifies the log; undefined when the API omits the field
  isFinalized?: boolean | null;
  from?: string;
  to?: string;
  value?: string;
  [key: string]: unknown;
};

type EventTableProps = {
  chainId: number;
  contractAddress: Address;
  initialEvents?: EventData[];
  className?: string;
  availableSortOptions?: SortOption[];
  defaultPageSize?: number;
  enableMultiSort?: boolean;
  enableCustomPageSize?: boolean;
  columnConfig?: ColumnConfig[];
  enableClientSideSort?: boolean;
  clientSideSortThreshold?: number;
  // Enhanced filtering props
  abiEvents?: AbiEvent[];
  enableDynamicFiltering?: boolean;
  onFiltersChange?: (filters: EventFilterState) => void;
  refreshKey?: number;
};

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
  totalPages?: number;
  startIndex?: number;
  endIndex?: number;
};

type FilterState = {
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  fromAddress?: string;
  toAddress?: string;
};

type SortState = {
  field: string;
  direction: 'asc' | 'desc';
};

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc';
  type?: 'numeric' | 'text' | 'address' | 'timestamp';
  priority?: number;
};

type SortOption = {
  key: string;
  label: string;
  type: 'numeric' | 'text' | 'address' | 'timestamp';
  defaultDirection?: 'asc' | 'desc';
  description?: string;
};

type ColumnConfig = {
  key: string;
  label: string;
  sortable: boolean;
  width?: string;
  visible: boolean;
  priority: number;
};

// Styled components
const TableContainer = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  /* In-card touch scroller (DataTable mobile pattern): below the content
     floor the table keeps its natural width and scrolls here instead of
     clipping nowrap cells at phone widths. */
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
`;

const Table = styled.table`
  width: 100%;
  /* Content defines the floor: the table never compresses its columns past
     their natural width — narrow viewports scroll the container above. */
  min-width: max-content;
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
  cursor: ${props => (props.sortable ? 'pointer' : 'default')};
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

// Muted marker for rows whose block is not finalized yet: the event may still
// be reorged out until then.
const UnfinalizedBadge = styled.span`
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  font-family: inherit;
  color: #92400e;
  background: #fef3c7;
  vertical-align: middle;
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
  /* Phone widths: page info and the controls row each fill a phone line —
     wrap instead of hiding Next/Export behind the table's side pan. */
  flex-wrap: wrap;
  gap: 8px;
`;

const PaginationInfo = styled.div`
  color: #6b7280;
  font-size: 14px;
`;

const PaginationControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const PaginationButton = styled.button<{ disabled?: boolean }>`
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  background: ${props => (props.disabled ? '#f9fafb' : 'white')};
  color: ${props => (props.disabled ? '#9ca3af' : '#374151')};
  border-radius: 4px;
  cursor: ${props => (props.disabled ? 'not-allowed' : 'pointer')};
  font-size: 14px;
  min-width: 36px;

  &:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }
`;

const PaginationInput = styled.input`
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  width: 60px;
  text-align: center;

  &:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }
`;

const ExportCsvButton = styled.a<{ $disabled?: boolean }>`
  padding: 8px 12px;
  margin-left: 8px;
  border: 1px solid ${props => (props.$disabled ? '#d1d5db' : '#3b82f6')};
  background: ${props => (props.$disabled ? '#f3f4f6' : '#3b82f6')};
  color: ${props => (props.$disabled ? '#9ca3af' : 'white')};
  border-radius: 4px;
  cursor: ${props => (props.$disabled ? 'not-allowed' : 'pointer')};
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    background: ${props => (props.$disabled ? '#f3f4f6' : '#2563eb')};
    border-color: ${props => (props.$disabled ? '#d1d5db' : '#2563eb')};
  }
`;

// Inline preflight notice shown when the current filtered total exceeds the
// export cap, replacing a click that would only land on the backend 400.
const ExportLimitNotice = styled.span`
  margin-left: 12px;
  font-size: 12px;
  color: #b45309;
  white-space: nowrap;
`;

const GoToPageContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
`;

const GoToPageLabel = styled.span`
  font-size: 14px;
  color: #374151;
`;

const PageInfo = styled.div`
  font-size: 14px;
  color: #6b7280;
  margin: 0 16px;
`;

const PaginationSeparator = styled.div`
  width: 1px;
  height: 24px;
  background: #d1d5db;
  margin: 0 8px;
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
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
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

// Enhanced sorting controls
const SortControlsContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
`;

const SortOptionsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const SortLabel = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: #374151;
`;

const SortSelect = styled.select`
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  background: white;
  color: #374151;

  &:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }
`;

const SortDirectionButton = styled.button<{ $active?: boolean }>`
  padding: 6px 8px;
  border: 1px solid ${props => (props.$active ? '#3b82f6' : '#d1d5db')};
  background: ${props => (props.$active ? '#eff6ff' : 'white')};
  color: ${props => (props.$active ? '#1d4ed8' : '#374151')};
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  margin-left: 4px;

  &:hover {
    background: ${props => (props.$active ? '#dbeafe' : '#f3f4f6')};
  }
`;

const PageSizeControl = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const PageSizeLabel = styled.span`
  font-size: 14px;
  color: #374151;
`;

const PageSizeSelect = styled.select`
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  background: white;
  color: #374151;

  &:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }
`;

const MultiSortContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
`;

const MultiSortTag = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: #e0e7ff;
  color: #3730a3;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
`;

const MultiSortRemove = styled.button`
  background: none;
  border: none;
  color: #3730a3;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  padding: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: #c7d2fe;
  }
`;

const AddSortButton = styled.button`
  padding: 4px 8px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #374151;
  cursor: pointer;
  font-size: 12px;

  &:hover {
    background: #f3f4f6;
  }
`;

const PerformanceInfoContainer = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  min-width: 200px;
  font-size: 12px;
`;

const PerformanceHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
  color: #374151;
`;

const PerformanceCloseButton = styled.button`
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: #f3f4f6;
    color: #374151;
  }
`;

const PerformanceMetric = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  color: #6b7280;
`;

const PerformanceMetricLabel = styled.span`
  color: #374151;
`;

const PerformanceMetricValue = styled.span<{ highlight?: boolean }>`
  color: ${props => (props.highlight ? '#059669' : '#374151')};
  font-weight: ${props => (props.highlight ? '600' : 'normal')};
`;

const PerformanceToggleButton = styled.button<{ $active?: boolean }>`
  padding: 4px 8px;
  background: ${props => (props.$active ? '#e0f2fe' : 'white')};
  border: 1px solid ${props => (props.$active ? '#0ea5e9' : '#d1d5db')};
  border-radius: 4px;
  color: ${props => (props.$active ? '#0369a1' : '#6b7280')};
  cursor: pointer;
  font-size: 11px;
  margin-left: 8px;

  &:hover {
    background: ${props => (props.$active ? '#bae6fd' : '#f3f4f6')};
  }
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

const formatTimestamp = (timestamp: string | null | undefined): string => {
  // Missing (never-fetched) or unparseable timestamps render as an explicit
  // placeholder instead of a fabricated or Invalid Date.
  if (!timestamp) return '—';
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
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

// Import optimized sorting and search utilities
import { optimizedSort, sortingPerformanceMonitor } from '../../utils/sorting-optimization';

const clientSideSort = (
  data: EventData[],
  sortConfigs: SortConfig[],
  primarySort: SortState,
): EventData[] => {
  if (!sortConfigs.length && !primarySort.field) return data;

  // Prepare sort configurations for optimized sorter
  let finalSortConfigs: SortConfig[] = [];

  if (sortConfigs.length > 0) {
    // Use multi-sort configurations
    finalSortConfigs = sortConfigs.map(config => ({
      ...config,
      type: config.type ?? 'text',
    }));
  } else if (primarySort.field) {
    // Use primary sort configuration
    const sortOption = defaultSortOptions.find(opt => opt.key === primarySort.field);
    finalSortConfigs = [
      {
        key: primarySort.field,
        direction: primarySort.direction,
        type: sortOption?.type ?? 'text',
        priority: 0,
      },
    ];
  }

  // Generate cache key based on sort configurations
  const cacheKey = `sort_${JSON.stringify({
    dataSize: data.length,
    configs: finalSortConfigs.map(c => ({ k: c.key, d: c.direction, t: c.type })),
  })}`;

  // Use optimized sorting
  const result = optimizedSort(data, finalSortConfigs, {
    useCache: true,
    cacheKey,
    threshold: 1000, // Use optimized sorting for datasets over 1000 items
  });

  // Record performance metrics
  sortingPerformanceMonitor.recordMetrics(result.metrics);

  return result.sortedData;
};

const paginateData = (data: EventData[], page: number, limit: number): EventData[] => {
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  return data.slice(startIndex, endIndex);
};

// Serialize the active (non-empty) ABI arg filters as the `argFilters` query
// param consumed by the events API; undefined when nothing is set.
const argFiltersQueryParam = (abiFilters?: Record<string, string>): string | undefined => {
  if (!abiFilters) return undefined;
  const active = Object.fromEntries(
    Object.entries(abiFilters).filter(([, value]) => value !== ''),
  );
  return Object.keys(active).length > 0 ? JSON.stringify(active) : undefined;
};

// Default sort options
const defaultSortOptions: SortOption[] = [
  {
    key: 'block_timestamp',
    label: 'Time',
    type: 'timestamp',
    defaultDirection: 'desc',
    description: 'Sort by block time',
  },
  {
    key: 'block_number',
    label: 'Block',
    type: 'numeric',
    defaultDirection: 'desc',
    description: 'Sort by block number',
  },
  {
    key: 'event_name',
    label: 'Event Name',
    type: 'text',
    defaultDirection: 'asc',
    description: 'Sort by event name',
  },
  {
    key: 'from',
    label: 'From',
    type: 'address',
    defaultDirection: 'asc',
    description: 'Sort by sender address',
  },
  {
    key: 'to',
    label: 'To',
    type: 'address',
    defaultDirection: 'asc',
    description: 'Sort by recipient address',
  },
  {
    key: 'value',
    label: 'Value',
    type: 'numeric',
    defaultDirection: 'desc',
    description: 'Sort by transaction value',
  },
  {
    key: 'transaction_hash',
    label: 'Tx Hash',
    type: 'text',
    defaultDirection: 'asc',
    description: 'Sort by transaction hash',
  },
];

const pageSizeOptions = [10, 20, 50, 100, 200];

// Mirrors EXPORT_MAX_ROWS in src/services/EventExportService.ts, enforced by
// the /events/export route in src/routes/events.ts (which 400s above it).
// Keep both values in sync. The backend 400 remains the backstop for cases
// where the client-side total is unknown.
const EXPORT_MAX_ROWS = 100_000;

// Main component
export const EventTable: React.FC<EventTableProps> = ({
  chainId,
  contractAddress,
  initialEvents = [],
  className,
  availableSortOptions = defaultSortOptions,
  defaultPageSize = 50,
  enableMultiSort = true,
  enableCustomPageSize = true,
  enableClientSideSort = true,
  clientSideSortThreshold = 1000,
  abiEvents = [],
  enableDynamicFiltering = false,
  onFiltersChange,
  refreshKey = 0,
}) => {
  const [allEvents, setAllEvents] = useState<EventData[]>(initialEvents);
  const [events, setEvents] = useState<EventData[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: defaultPageSize,
    total: initialEvents.length,
    hasMore: false,
  });
  const [filters, _setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState<SortState>({
    field: 'block_timestamp',
    direction: 'desc',
  });

  // Enhanced sorting state
  const [multiSort, setMultiSort] = useState<SortConfig[]>([]);
  const [currentSortField, setCurrentSortField] = useState<string>('block_timestamp');
  const [showAdvancedSort, setShowAdvancedSort] = useState(false);

  // Enhanced pagination state
  const [pageInput, setPageInput] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(1);

  // Performance monitoring state
  const [sortingMetrics, setSortingMetrics] = useState<{
    sortTime: number;
    dataSize: number;
    algorithm: string;
    cacheHit: boolean;
    avgMetrics?: {
      avgExecutionTime: number;
      avgDataSize: number;
      avgMemoryUsage: number;
      cacheHitRate: number;
      totalOperations: number;
    };
  } | null>(null);
  const [showPerformanceInfo, setShowPerformanceInfo] = useState(false);

  // Enhanced filtering state
  const [dynamicFilters, setDynamicFilters] = useState<EventFilterState>({});

  // Determine if we should use client-side sorting
  // Use pagination.total (server-reported count) instead of allEvents.length (loaded data)
  // This prevents incorrect total count when only a page of data is loaded
  const shouldUseClientSideSort =
    enableClientSideSort && pagination.total > 0 && pagination.total <= clientSideSortThreshold;

  // API call function
  const fetchEvents = useCallback(
    async (cursor?: string, targetPage?: number) => {
      setLoading(true);
      setError(null);

      try {
        const currentPage = targetPage ?? pagination.page;
        const queryParams = new URLSearchParams({
          page: currentPage.toString(),
          pageSize: pagination.limit.toString(),
          sort: sort.direction,
          sortBy: sort.field,
        });

        // Add multi-sort support
        if (enableMultiSort && multiSort.length > 0) {
          queryParams.set(
            'multiSort',
            JSON.stringify(
              multiSort.map(s => ({
                field: s.key,
                direction: s.direction,
                type: s.type,
                priority: s.priority,
              })),
            ),
          );
        }

        if (cursor) {
          queryParams.set('cursor', cursor);
        }

        // Add basic filters
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== '') {
            queryParams.set(key, value.toString());
          }
        });

        // Dynamic filters: eventName + block range ride along as dedicated
        // params, and ABI arg filters are serialized as `argFilters` JSON so
        // matching runs server-side over the full indexed set instead of only
        // the loaded page.
        if (dynamicFilters.eventName) {
          queryParams.set('eventName', dynamicFilters.eventName);
        }
        if (dynamicFilters.fromBlock !== undefined) {
          queryParams.set('fromBlock', dynamicFilters.fromBlock.toString());
        }
        if (dynamicFilters.toBlock !== undefined) {
          queryParams.set('toBlock', dynamicFilters.toBlock.toString());
        }
        const argFilters = argFiltersQueryParam(dynamicFilters.abiFilters);
        if (argFilters) {
          queryParams.set('argFilters', argFilters);
        }

        const url = `/api/chains/${chainId}/contracts/${contractAddress}/events?${queryParams}`;

        const data = await get<{
          events: Array<{
            decodedArgs?: string | Record<string, unknown>;
            blockTimestamp?: number | string | null;
            isFinalized?: boolean | null;
            [key: string]: unknown;
          }>;
          total?: number;
          page?: number;
          totalPages?: number;
        }>(url);

        const normalizedEvents = (data.events ?? []).map(e => {
          const args =
            typeof e.decodedArgs === 'string'
              ? (() => {
                  try {
                    return JSON.parse(e.decodedArgs) as Record<string, unknown>;
                  } catch {
                    return {};
                  }
                })()
              : (e.decodedArgs ?? {});
          // null (timestamp never fetched) stays null and renders as a placeholder
          const blockTimestamp =
            typeof e.blockTimestamp === 'number'
              ? new Date(e.blockTimestamp * 1000).toISOString()
              : (e.blockTimestamp ?? null);
          return { ...args, ...e, blockTimestamp } as EventData;
        });

        if (cursor) {
          setAllEvents(prev => [...prev, ...normalizedEvents]);
        } else {
          setAllEvents(normalizedEvents);
        }

        setPagination(prev => ({
          ...prev,
          total: data.total ?? data.events.length,
          hasMore: (data.page ?? 1) < (data.totalPages ?? 1),
          totalPages: data.totalPages,
        }));
      } catch (err) {
        console.error('Failed to fetch events:', err);
        setError(err instanceof Error ? err.message : 'Failed to load events');
      } finally {
        setLoading(false);
      }
    },
    [
      chainId,
      contractAddress,
      pagination.page,
      pagination.limit,
      sort,
      filters,
      enableMultiSort,
      multiSort,
      dynamicFilters,
    ],
  );

  // Initial load + refresh when refreshKey changes
  useEffect(() => {
    fetchEvents();
  }, [chainId, contractAddress, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (allEvents.length > 0) {
      fetchEvents();
    }
  }, [pagination.limit, sort.field, sort.direction]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enhanced sorting handlers
  const handleSort = (field: string) => {
    const newDirection = sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc';
    setSort({ field, direction: newDirection });
    setCurrentSortField(field);

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  const handleSortFieldChange = (field: string) => {
    setCurrentSortField(field);
    const sortOption = availableSortOptions.find(option => option.key === field);
    const direction = sortOption?.defaultDirection ?? 'asc';
    setSort({ field, direction });

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  const handleSortDirectionChange = (direction: 'asc' | 'desc') => {
    setSort(prev => ({ ...prev, direction }));

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  const handlePageSizeChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));

    if (!shouldUseClientSideSort) {
      // For server-side pagination, fetch new data
      setEvents([]);
      fetchEvents(undefined, 1);
    }
    // For client-side pagination, the useEffect will handle the update
  };

  const addToMultiSort = () => {
    if (!enableMultiSort) return;

    const sortOption = availableSortOptions.find(option => option.key === currentSortField);
    if (!sortOption) return;

    const existingIndex = multiSort.findIndex(s => s.key === currentSortField);
    let newMultiSort: SortConfig[];

    if (existingIndex >= 0) {
      // Toggle direction if already exists
      newMultiSort = [...multiSort];
      newMultiSort[existingIndex] = {
        ...newMultiSort[existingIndex],
        direction: newMultiSort[existingIndex].direction === 'asc' ? 'desc' : 'asc',
      };
    } else {
      // Add new sort
      const newSortConfig: SortConfig = {
        key: currentSortField,
        direction: sortOption.defaultDirection ?? 'asc',
        type: sortOption.type,
        priority: multiSort.length,
      };
      newMultiSort = [...multiSort, newSortConfig];
    }

    setMultiSort(newMultiSort);
  };

  const removeFromMultiSort = (key: string) => {
    setMultiSort(prev => prev.filter(s => s.key !== key));
  };

  const clearMultiSort = () => {
    setMultiSort([]);
  };

  const applyMultiSort = () => {
    if (multiSort.length === 0) return;

    // Use the highest priority sort as the primary sort
    const primarySort = multiSort.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
    setSort({ field: primarySort.key, direction: primarySort.direction });

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  // Enhanced pagination handlers
  const handleNextPage = () => {
    if (shouldUseClientSideSort) {
      // Client-side pagination - just update page state
      const nextPage = pagination.page + 1;
      setPagination(prev => ({ ...prev, page: nextPage }));
    } else {
      // Server-side pagination
      if (pagination.nextCursor) {
        fetchEvents(pagination.nextCursor);
      } else {
        const nextPage = pagination.page + 1;
        setPagination(prev => ({ ...prev, page: nextPage }));
        setEvents([]);
        fetchEvents(undefined, nextPage);
      }
    }
  };

  const handlePrevPage = () => {
    if (shouldUseClientSideSort) {
      // Client-side pagination - just update page state
      const prevPage = Math.max(1, pagination.page - 1);
      setPagination(prev => ({ ...prev, page: prevPage }));
    } else {
      // Server-side pagination
      const prevPage = Math.max(1, pagination.page - 1);
      setPagination(prev => ({ ...prev, page: prevPage }));
      setEvents([]);
      fetchEvents(undefined, prevPage);
    }
  };

  const handleFirstPage = () => {
    if (shouldUseClientSideSort) {
      // Client-side pagination - just update page state
      setPagination(prev => ({ ...prev, page: 1 }));
    } else {
      // Server-side pagination
      setPagination(prev => ({ ...prev, page: 1 }));
      setEvents([]);
      fetchEvents(undefined, 1);
    }
  };

  const handleLastPage = () => {
    if (shouldUseClientSideSort) {
      // Client-side pagination - just update page state
      if (totalPages > 0) {
        setPagination(prev => ({ ...prev, page: totalPages }));
      }
    } else {
      // Server-side pagination
      if (totalPages > 0) {
        setPagination(prev => ({ ...prev, page: totalPages }));
        setEvents([]);
        fetchEvents(undefined, totalPages);
      }
    }
  };

  const handleGoToPage = () => {
    const pageNumber = parseInt(pageInput);
    if (!isNaN(pageNumber) && pageNumber >= 1 && pageNumber <= totalPages) {
      setPagination(prev => ({ ...prev, page: pageNumber }));

      if (!shouldUseClientSideSort) {
        // For server-side pagination, fetch new data
        setEvents([]);
        fetchEvents(undefined, pageNumber);
      }
      setPageInput('');
    }
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleGoToPage();
    }
  };

  // Calculate pagination info - FIXED to avoid infinite loop
  const calculatePaginationInfo = useCallback(() => {
    const totalPagesCount = Math.ceil(pagination.total / pagination.limit);
    const startIndex = (pagination.page - 1) * pagination.limit + 1;
    const endIndex = Math.min(pagination.page * pagination.limit, pagination.total);

    setTotalPages(totalPagesCount);
    // Update pagination info in state
    setPagination(prev => ({
      ...prev,
      startIndex,
      endIndex,
    }));
  }, [pagination.total, pagination.limit, pagination.page]);

  useEffect(() => {
    calculatePaginationInfo();
  }, [calculatePaginationInfo]);

  useEffect(() => {
    if (shouldUseClientSideSort) {
      const startTime = performance.now();

      // Arg filtering runs server-side (argFilters query param); this block
      // only sorts/paginates the loaded rows for display. The server-reported
      // pagination total stays authoritative.
      const sortedData = clientSideSort(allEvents, multiSort, sort);
      const paginatedData = paginateData(sortedData, pagination.page, pagination.limit);

      const sortTime = performance.now() - startTime;

      const avgMetrics = sortingPerformanceMonitor.getAverageMetrics();
      const recentMetrics = sortingPerformanceMonitor.getMetricsByAlgorithm();

      setEvents(paginatedData);
      setSortingMetrics({
        sortTime,
        dataSize: sortedData.length,
        algorithm: recentMetrics['optimized'] ? 'optimized' : 'standard',
        cacheHit: sortTime < 5,
        avgMetrics,
      });
    } else {
      setEvents(allEvents);
      setSortingMetrics(null);
    }
  }, [
    allEvents,
    sort,
    multiSort,
    pagination.page,
    pagination.limit,
    shouldUseClientSideSort,
  ]);

  const handleRetry = () => {
    setError(null);
    fetchEvents();
  };

  // Enhanced filtering handlers
  const handleFilterChange = useCallback(
    (newFilters: EventFilterState) => {
      setDynamicFilters(newFilters);
      onFiltersChange?.(newFilters);
    },
    [onFiltersChange],
  );

  const handleFilterApply = useCallback(
    (appliedFilters: EventFilterState) => {
      setDynamicFilters(appliedFilters);
      onFiltersChange?.(appliedFilters);

      // Reset pagination and refetch
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    },
    [onFiltersChange, fetchEvents],
  );

  // CSV export link carrying the same filters as the table query. The backend
  // replies with Content-Disposition, so the browser saves it as
  // events-{chainId}-{address}-{timestamp}.csv.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (dynamicFilters.eventName) {
      params.set('eventName', dynamicFilters.eventName);
    }
    if (dynamicFilters.fromBlock !== undefined) {
      params.set('fromBlock', dynamicFilters.fromBlock.toString());
    }
    if (dynamicFilters.toBlock !== undefined) {
      params.set('toBlock', dynamicFilters.toBlock.toString());
    }
    const argFilters = argFiltersQueryParam(dynamicFilters.abiFilters);
    if (argFilters) {
      params.set('argFilters', argFilters);
    }
    const query = params.toString();
    return `${getApiBase()}/api/chains/${chainId}/contracts/${contractAddress}/events/export${query ? `?${query}` : ''}`;
  }, [chainId, contractAddress, dynamicFilters]);

  // The server-reported total of the current filtered query (set by every
  // fetchEvents response) drives the export preflight. When the response
  // carried no total, pagination.total falls back to the loaded page size —
  // far below the cap — so the button stays enabled and the backend 400
  // remains the backstop, per design.
  const exportExceedsLimit = pagination.total > EXPORT_MAX_ROWS;

  // Degraded mode: with no discovered backend the export href would be a
  // broken same-origin relative link — disable the button instead.
  const backendConnected = getApiBase() !== '';

  // Empty-state honesty: with filters applied, an empty page means nothing
  // matched them; without any, it means nothing is indexed (yet). Different
  // problems, different guidance.
  const hasActiveFilters =
    dynamicFilters.eventName !== undefined ||
    dynamicFilters.fromBlock !== undefined ||
    dynamicFilters.toBlock !== undefined ||
    argFiltersQueryParam(dynamicFilters.abiFilters) !== undefined;

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

  return (
    <TableContainer className={className}>
      {enableDynamicFiltering && abiEvents.length > 0 && (
        <EventFilterPanel
          abiEvents={abiEvents}
          initialFilters={dynamicFilters}
          onApply={handleFilterApply}
          onFiltersChange={handleFilterChange}
          disabled={loading}
        />
      )}

      {events.length === 0 && !loading ? (
        <EmptyStateContainer>
          <EmptyStateIcon>📋</EmptyStateIcon>
          <EmptyStateTitle>No events found</EmptyStateTitle>
          <EmptyStateDescription>
            {hasActiveFilters
              ? 'No events match the current filters.'
              : 'No events indexed in this range yet.'}
          </EmptyStateDescription>
        </EmptyStateContainer>
      ) : (
        <>
          {/* Enhanced Sorting Controls */}
          <SortControlsContainer>
            <SortOptionsContainer>
              <SortLabel>Sort:</SortLabel>
              <SortSelect
                value={currentSortField}
                onChange={e => handleSortFieldChange(e.target.value)}
              >
                {availableSortOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </SortSelect>
              <SortDirectionButton
                $active={sort.direction === 'desc'}
                onClick={() => handleSortDirectionChange(sort.direction === 'asc' ? 'desc' : 'asc')}
              >
                {sort.direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
              </SortDirectionButton>

              {enableMultiSort && (
                <>
                  <AddSortButton onClick={addToMultiSort}>+ Add to multi-sort</AddSortButton>
                  <AddSortButton onClick={() => setShowAdvancedSort(!showAdvancedSort)}>
                    {showAdvancedSort ? 'Hide' : 'Show'} advanced sort
                  </AddSortButton>
                </>
              )}
            </SortOptionsContainer>

            {enableCustomPageSize && (
              <PageSizeControl>
                <PageSizeLabel>Rows per page:</PageSizeLabel>
                <PageSizeSelect
                  value={pagination.limit}
                  onChange={e => handlePageSizeChange(Number(e.target.value))}
                >
                  {pageSizeOptions.map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </PageSizeSelect>
              </PageSizeControl>
            )}

            {/* Performance Info Toggle and Display */}
            {shouldUseClientSideSort && sortingMetrics && (
              <div style={{ position: 'relative' }}>
                <PerformanceToggleButton
                  $active={showPerformanceInfo}
                  onClick={() => setShowPerformanceInfo(!showPerformanceInfo)}
                >
                  Perf: {sortingMetrics.sortTime.toFixed(1)}
                  ms
                </PerformanceToggleButton>

                {showPerformanceInfo && (
                  <PerformanceInfoContainer>
                    <PerformanceHeader>
                      Sorting performance
                      <PerformanceCloseButton onClick={() => setShowPerformanceInfo(false)}>
                        ×
                      </PerformanceCloseButton>
                    </PerformanceHeader>

                    <PerformanceMetric>
                      <PerformanceMetricLabel>Rows:</PerformanceMetricLabel>
                      <PerformanceMetricValue>
                        {Number(sortingMetrics.dataSize ?? 0).toLocaleString()}
                      </PerformanceMetricValue>
                    </PerformanceMetric>

                    <PerformanceMetric>
                      <PerformanceMetricLabel>Algorithm:</PerformanceMetricLabel>
                      <PerformanceMetricValue>{sortingMetrics.algorithm}</PerformanceMetricValue>
                    </PerformanceMetric>

                    <PerformanceMetric>
                      <PerformanceMetricLabel>Sort time:</PerformanceMetricLabel>
                      <PerformanceMetricValue highlight={sortingMetrics.sortTime < 10}>
                        {sortingMetrics.sortTime.toFixed(2)} ms
                      </PerformanceMetricValue>
                    </PerformanceMetric>

                    <PerformanceMetric>
                      <PerformanceMetricLabel>Cache hit:</PerformanceMetricLabel>
                      <PerformanceMetricValue highlight={sortingMetrics.cacheHit}>
                        {sortingMetrics.cacheHit ? 'Yes' : 'No'}
                      </PerformanceMetricValue>
                    </PerformanceMetric>

                    {sortingMetrics.avgMetrics && (
                      <>
                        <PerformanceMetric>
                          <PerformanceMetricLabel>Avg time:</PerformanceMetricLabel>
                          <PerformanceMetricValue>
                            {sortingMetrics.avgMetrics.avgExecutionTime.toFixed(2)} ms
                          </PerformanceMetricValue>
                        </PerformanceMetric>

                        <PerformanceMetric>
                          <PerformanceMetricLabel>Cache hit rate:</PerformanceMetricLabel>
                          <PerformanceMetricValue>
                            {(sortingMetrics.avgMetrics.cacheHitRate * 100).toFixed(1)}%
                          </PerformanceMetricValue>
                        </PerformanceMetric>
                      </>
                    )}

                    <PerformanceMetric>
                      <PerformanceMetricLabel>Sort mode:</PerformanceMetricLabel>
                      <PerformanceMetricValue highlight>Client-side</PerformanceMetricValue>
                    </PerformanceMetric>
                  </PerformanceInfoContainer>
                )}
              </div>
            )}
          </SortControlsContainer>

          {/* Advanced Multi-Sort Controls */}
          {showAdvancedSort && enableMultiSort && multiSort.length > 0 && (
            <SortControlsContainer
              style={{ background: '#f1f5f9', paddingTop: '8px', paddingBottom: '8px' }}
            >
              <div>
                <SortLabel>Multi-sort:</SortLabel>
                <MultiSortContainer>
                  {multiSort.map(sortConfig => {
                    const option = availableSortOptions.find(opt => opt.key === sortConfig.key);
                    return (
                      <MultiSortTag key={sortConfig.key}>
                        {option?.label ?? sortConfig.key} (
                        {sortConfig.direction === 'asc' ? '↑' : '↓'})
                        <MultiSortRemove onClick={() => removeFromMultiSort(sortConfig.key)}>
                          ×
                        </MultiSortRemove>
                      </MultiSortTag>
                    );
                  })}
                  <AddSortButton onClick={clearMultiSort}>Clear all</AddSortButton>
                  <AddSortButton onClick={applyMultiSort}>Apply multi-sort</AddSortButton>
                </MultiSortContainer>
              </div>
            </SortControlsContainer>
          )}

          <Table>
            <TableHeader>
              <tr>
                <TableHeaderCell sortable onClick={() => handleSort('block_number')}>
                  Block
                  <SortIndicator>
                    {sort.field === 'block_number' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </SortIndicator>
                </TableHeaderCell>
                <TableHeaderCell sortable onClick={() => handleSort('block_timestamp')}>
                  Time
                  <SortIndicator>
                    {sort.field === 'block_timestamp'
                      ? sort.direction === 'asc'
                        ? '↑'
                        : '↓'
                      : '↕'}
                  </SortIndicator>
                </TableHeaderCell>
                <TableHeaderCell sortable onClick={() => handleSort('event_name')}>
                  Event
                  <SortIndicator>
                    {sort.field === 'event_name' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </SortIndicator>
                </TableHeaderCell>
                <TableHeaderCell>From</TableHeaderCell>
                <TableHeaderCell>To</TableHeaderCell>
                <TableHeaderCell>Value</TableHeaderCell>
                <TableHeaderCell>Tx Hash</TableHeaderCell>
              </tr>
            </TableHeader>
            <TableBody>
              {events.map((event, index) => (
                <tr key={`${event.transactionHash}-${index}`}>
                  <TableCell>{event.blockNumber}</TableCell>
                  <TimestampCell>{formatTimestamp(event.blockTimestamp)}</TimestampCell>
                  <EventNameCell>
                    {event.eventName}
                    {event.isFinalized === false && (
                      <UnfinalizedBadge>unfinalized</UnfinalizedBadge>
                    )}
                  </EventNameCell>
                  <AddressCell>
                    {event.from ? (
                      <a
                        href={`/chain/${chainId}/address/${event.from}`}
                        style={{ color: '#4f46e5', textDecoration: 'none' }}
                      >
                        {formatAddress(event.from)}
                      </a>
                    ) : (
                      'N/A'
                    )}
                  </AddressCell>
                  <AddressCell>
                    {event.to ? (
                      <a
                        href={`/chain/${chainId}/address/${event.to}`}
                        style={{ color: '#4f46e5', textDecoration: 'none' }}
                      >
                        {formatAddress(event.to)}
                      </a>
                    ) : (
                      'N/A'
                    )}
                  </AddressCell>
                  <ValueCell>{formatValue(event.value)}</ValueCell>
                  <TransactionHashCell>
                    <a
                      href={`/chain/${chainId}/tx/${event.transactionHash}`}
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

          {/* Enhanced Pagination controls */}
          <PaginationContainer>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <PaginationInfo>
                Showing {pagination.startIndex ?? 1}-{pagination.endIndex ?? events.length} of{' '}
                {pagination.total} events
              </PaginationInfo>

              {totalPages > 1 && (
                <PageInfo>
                  Page {pagination.page} / {totalPages}
                </PageInfo>
              )}
            </div>

            <PaginationControls>
              <PaginationButton
                onClick={handleFirstPage}
                disabled={pagination.page <= 1 || loading}
                title="First page"
              >
                ⇤
              </PaginationButton>

              <PaginationButton
                onClick={handlePrevPage}
                disabled={pagination.page <= 1 || loading}
                title="Previous page"
              >
                ←
              </PaginationButton>

              {totalPages > 1 && (
                <>
                  <PaginationSeparator />

                  <GoToPageContainer>
                    <GoToPageLabel>Go to:</GoToPageLabel>
                    <PaginationInput
                      type="number"
                      value={pageInput}
                      onChange={handlePageInputChange}
                      onKeyPress={handlePageInputKeyPress}
                      placeholder={pagination.page.toString()}
                      min={1}
                      max={totalPages}
                    />
                    <PaginationButton onClick={handleGoToPage} disabled={!pageInput || loading}>
                      Go
                    </PaginationButton>
                  </GoToPageContainer>

                  <PaginationSeparator />
                </>
              )}

              <PaginationButton
                onClick={handleNextPage}
                disabled={(!pagination.hasMore && pagination.page >= totalPages) || loading}
                title="Next page"
              >
                →
              </PaginationButton>

              {totalPages > 1 && (
                <PaginationButton
                  onClick={handleLastPage}
                  disabled={pagination.page >= totalPages || loading}
                  title="Last page"
                >
                  ⇥
                </PaginationButton>
              )}

              {pagination.total > 0 && (
                <>
                  {/* Export preflight: the query total is known here, so
                      refuse above the cap up front instead of letting the
                      click hit the backend 400. */}
                  {exportExceedsLimit && (
                    <ExportLimitNotice>
                      Too many rows ({pagination.total.toLocaleString()}) — narrow the block
                      range or filters and export in chunks (limit 100,000 rows).
                    </ExportLimitNotice>
                  )}
                  {!backendConnected && (
                    <ExportLimitNotice>
                      Backend not connected — export unavailable.
                    </ExportLimitNotice>
                  )}
                  <ExportCsvButton
                    {...(exportExceedsLimit || !backendConnected
                      ? {}
                      : { href: exportHref, download: true })}
                    $disabled={exportExceedsLimit || !backendConnected}
                    aria-disabled={exportExceedsLimit || !backendConnected ? true : undefined}
                  >
                    Export CSV
                  </ExportCsvButton>
                </>
              )}
            </PaginationControls>
          </PaginationContainer>
        </>
      )}
    </TableContainer>
  );
};

export default EventTable;
