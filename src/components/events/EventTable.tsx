/**
 * EventTable component - displays contract events with pagination, sorting, and filtering
 * Integrates with events API endpoints for real-time data display
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { css, cx } from '@linaria/core';
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

// Styles: Linaria `css` classes over haze theme tokens (dark-theme safe).
// DOM structure is unchanged from the former styled layer.
const tableContainer = css`
  background: var(--haze-color-bg);
  border-radius: var(--haze-radius-lg);
  box-shadow: var(--haze-shadow-md);
  /* In-card touch scroller (DataTable mobile pattern): below the content
     floor the table keeps its natural width and scrolls here instead of
     clipping nowrap cells at phone widths. */
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
`;

const tableStyle = css`
  width: 100%;
  /* Content defines the floor: the table never compresses its columns past
     their natural width — narrow viewports scroll the container above. */
  min-width: max-content;
  border-collapse: collapse;
  font-size: 14px;
`;

const tableHeader = css`
  background: var(--haze-color-bg-subtle);
  border-bottom: 1px solid var(--haze-color-border);
`;

const tableHeaderCell = css`
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  color: var(--haze-color-text);
  user-select: none;
  position: relative;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

// Sortable header cells add the pointer cursor; composed after tableHeaderCell.
const tableHeaderCellSortable = css`
  cursor: pointer;
`;

const sortIndicator = css`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--haze-color-text-muted);
  font-size: 12px;
`;

const tableBody = css`
  & tr {
    border-bottom: 1px solid var(--haze-color-border);

    &:hover {
      background: var(--haze-color-bg-subtle);
    }
  }
`;

const tableCell = css`
  padding: 12px 16px;
  color: var(--haze-color-text);
  vertical-align: top;
`;

const eventNameCell = css`
  font-family: var(--haze-font-mono);
  font-weight: 600;
  color: var(--haze-color-primary);
`;

// Muted marker for rows whose block is not finalized yet: the event may still
// be reorged out until then.
const unfinalizedBadge = css`
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  font-family: inherit;
  color: var(--haze-color-warning);
  background: var(--haze-color-warning-subtle);
  vertical-align: middle;
`;

const addressCell = css`
  font-family: var(--haze-font-mono);
  font-size: 12px;
`;

const transactionHashCell = css`
  font-family: var(--haze-font-mono);
  font-size: 12px;
`;

const valueCell = css`
  font-family: var(--haze-font-mono);
  font-weight: 600;
  color: var(--haze-color-success);
`;

const timestampCell = css`
  color: var(--haze-color-text-muted);
  font-size: 12px;
`;

const paginationContainer = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--haze-color-bg-subtle);
  border-top: 1px solid var(--haze-color-border);
  /* Phone widths: page info and the controls row each fill a phone line —
     wrap instead of hiding Next/Export behind the table's side pan. */
  flex-wrap: wrap;
  gap: 8px;
`;

const paginationInfo = css`
  color: var(--haze-color-text-muted);
  font-size: 14px;
`;

const paginationControls = css`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const paginationButton = css`
  padding: 8px 12px;
  border: 1px solid var(--haze-color-border);
  background: var(--haze-color-bg);
  color: var(--haze-color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  min-width: 36px;

  &:hover:not(:disabled) {
    background: var(--haze-color-bg-muted);
    border-color: var(--haze-color-border-hover);
  }

  &:disabled {
    background: var(--haze-color-bg-subtle);
    color: var(--haze-color-text-muted);
    cursor: not-allowed;
  }
`;

const paginationInput = css`
  padding: 6px 8px;
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  font-size: 14px;
  width: 60px;
  text-align: center;

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
    box-shadow: 0 0 0 2px var(--haze-color-focus-ring);
  }
`;

// Disabled styling keys off the aria-disabled attribute the component already
// renders, so the modifier never loses to the hover rule on order.
const exportCsvButton = css`
  padding: 8px 12px;
  margin-left: 8px;
  border: 1px solid var(--haze-color-primary);
  background: var(--haze-color-primary);
  color: var(--haze-color-text-inverse);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    background: var(--haze-color-primary-hover);
    border-color: var(--haze-color-primary-hover);
  }

  &[aria-disabled='true'] {
    border-color: var(--haze-color-border);
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text-muted);
    cursor: not-allowed;
  }

  &:hover[aria-disabled='true'] {
    background: var(--haze-color-bg-muted);
    border-color: var(--haze-color-border);
  }
`;

// Inline preflight notice shown when the current filtered total exceeds the
// export cap, replacing a click that would only land on the backend 400.
const exportLimitNotice = css`
  margin-left: 12px;
  font-size: 12px;
  color: var(--haze-color-warning);
  white-space: nowrap;
`;

const goToPageContainer = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
`;

const goToPageLabel = css`
  font-size: 14px;
  color: var(--haze-color-text);
`;

const pageInfo = css`
  font-size: 14px;
  color: var(--haze-color-text-muted);
  margin: 0 16px;
`;

const paginationSeparator = css`
  width: 1px;
  height: 24px;
  background: var(--haze-color-border);
  margin: 0 8px;
`;

const loadingContainer = css`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 48px;
  color: var(--haze-color-text-muted);
`;

const loadingSpinner = css`
  width: 24px;
  height: 24px;
  border: 2px solid var(--haze-color-border);
  border-top: 2px solid var(--haze-color-primary);
  border-radius: 50%;
  animation: event-table-spin 1s linear infinite;

  @keyframes event-table-spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;

const errorContainer = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  color: var(--haze-color-danger);
  text-align: center;
`;

const errorMessage = css`
  margin-bottom: 16px;
  font-weight: 500;
`;

const retryButton = css`
  padding: 8px 16px;
  background: var(--haze-color-primary);
  color: var(--haze-color-text-inverse);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;

  &:hover {
    background: var(--haze-color-primary-hover);
  }
`;

const emptyStateContainer = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  color: var(--haze-color-text-muted);
  text-align: center;
`;

const emptyStateIcon = css`
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
`;

const emptyStateTitle = css`
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
`;

const emptyStateDescription = css`
  font-size: 14px;
  color: var(--haze-color-text-muted);
`;

// Enhanced sorting controls
const sortControlsContainer = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--haze-color-bg-subtle);
  border-bottom: 1px solid var(--haze-color-border);
`;

const sortOptionsContainer = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const sortLabel = css`
  font-size: 14px;
  font-weight: 500;
  color: var(--haze-color-text);
`;

const sortSelect = css`
  padding: 6px 8px;
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  font-size: 14px;
  background: var(--haze-color-bg);
  color: var(--haze-color-text);

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
    box-shadow: 0 0 0 2px var(--haze-color-focus-ring);
  }
`;

// The active state rides aria-pressed so it wins specificity over the base
// hover rule regardless of class order.
const sortDirectionButton = css`
  padding: 6px 8px;
  border: 1px solid var(--haze-color-border);
  background: var(--haze-color-bg);
  color: var(--haze-color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  margin-left: 4px;

  &:hover {
    background: var(--haze-color-bg-muted);
  }

  &[aria-pressed='true'] {
    border-color: var(--haze-color-primary);
    background: var(--haze-color-primary-subtle);
    color: var(--haze-color-primary);
  }

  &:hover[aria-pressed='true'] {
    background: var(--haze-color-primary-subtle);
  }
`;

const pageSizeControl = css`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const pageSizeLabel = css`
  font-size: 14px;
  color: var(--haze-color-text);
`;

const pageSizeSelect = css`
  padding: 6px 8px;
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  font-size: 14px;
  background: var(--haze-color-bg);
  color: var(--haze-color-text);

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
    box-shadow: 0 0 0 2px var(--haze-color-focus-ring);
  }
`;

const multiSortContainer = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
`;

const multiSortTag = css`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--haze-color-primary-subtle);
  color: var(--haze-color-primary);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
`;

const multiSortRemove = css`
  background: none;
  border: none;
  color: var(--haze-color-primary);
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
    background: var(--haze-color-bg-muted);
  }
`;

const addSortButton = css`
  padding: 4px 8px;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  color: var(--haze-color-text);
  cursor: pointer;
  font-size: 12px;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const performanceInfoContainer = css`
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: 6px;
  padding: 12px;
  box-shadow: var(--haze-shadow-lg);
  z-index: 1000;
  min-width: 200px;
  font-size: 12px;
`;

const performanceHeader = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--haze-color-text);
`;

const performanceCloseButton = css`
  background: none;
  border: none;
  color: var(--haze-color-text-muted);
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
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text);
  }
`;

const performanceMetric = css`
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  color: var(--haze-color-text-muted);
`;

const performanceMetricLabel = css`
  color: var(--haze-color-text);
`;

// data-highlight marks the "good" metric values (fast sort, cache hit).
const performanceMetricValue = css`
  color: var(--haze-color-text);
  font-weight: normal;

  &[data-highlight] {
    color: var(--haze-color-success);
    font-weight: 600;
  }
`;

// Like sortDirectionButton, the active state rides aria-pressed.
const performanceToggleButton = css`
  padding: 4px 8px;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  color: var(--haze-color-text-muted);
  cursor: pointer;
  font-size: 11px;
  margin-left: 8px;

  &:hover {
    background: var(--haze-color-bg-muted);
  }

  &[aria-pressed='true'] {
    background: var(--haze-color-info-subtle);
    border-color: var(--haze-color-info);
    color: var(--haze-color-info);
  }

  &:hover[aria-pressed='true'] {
    background: var(--haze-color-info-subtle);
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
      <div className={cx(tableContainer, className)}>
        <div className={loadingContainer}>
          <div className={loadingSpinner} />
          <span style={{ marginLeft: 12 }}>Loading events...</span>
        </div>
      </div>
    );
  }

  // Render error state
  if (error && events.length === 0) {
    return (
      <div className={cx(tableContainer, className)}>
        <div className={errorContainer}>
          <div className={errorMessage}>Failed to load events</div>
          <div style={{ color: 'var(--haze-color-text-muted)', marginBottom: 16 }}>{error}</div>
          <button className={retryButton} onClick={handleRetry}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx(tableContainer, className)}>
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
        <div className={emptyStateContainer}>
          <div className={emptyStateIcon}>📋</div>
          <div className={emptyStateTitle}>No events found</div>
          <div className={emptyStateDescription}>
            {hasActiveFilters
              ? 'No events match the current filters.'
              : 'No events indexed in this range yet.'}
          </div>
        </div>
      ) : (
        <>
          {/* Enhanced Sorting Controls */}
          <div className={sortControlsContainer}>
            <div className={sortOptionsContainer}>
              <span className={sortLabel}>Sort:</span>
              <select
                className={sortSelect}
                value={currentSortField}
                onChange={e => handleSortFieldChange(e.target.value)}
              >
                {availableSortOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className={sortDirectionButton}
                aria-pressed={sort.direction === 'desc'}
                onClick={() => handleSortDirectionChange(sort.direction === 'asc' ? 'desc' : 'asc')}
              >
                {sort.direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
              </button>

              {enableMultiSort && (
                <>
                  <button className={addSortButton} onClick={addToMultiSort}>+ Add to multi-sort</button>
                  <button className={addSortButton} onClick={() => setShowAdvancedSort(!showAdvancedSort)}>
                    {showAdvancedSort ? 'Hide' : 'Show'} advanced sort
                  </button>
                </>
              )}
            </div>

            {enableCustomPageSize && (
              <div className={pageSizeControl}>
                <span className={pageSizeLabel}>Rows per page:</span>
                <select
                  className={pageSizeSelect}
                  value={pagination.limit}
                  onChange={e => handlePageSizeChange(Number(e.target.value))}
                >
                  {pageSizeOptions.map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Performance Info Toggle and Display */}
            {shouldUseClientSideSort && sortingMetrics && (
              <div style={{ position: 'relative' }}>
                <button
                  className={performanceToggleButton}
                  aria-pressed={showPerformanceInfo}
                  onClick={() => setShowPerformanceInfo(!showPerformanceInfo)}
                >
                  Perf: {sortingMetrics.sortTime.toFixed(1)}
                  ms
                </button>

                {showPerformanceInfo && (
                  <div className={performanceInfoContainer}>
                    <div className={performanceHeader}>
                      Sorting performance
                      <button className={performanceCloseButton} onClick={() => setShowPerformanceInfo(false)}>
                        ×
                      </button>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Rows:</span>
                      <span className={performanceMetricValue}>
                        {Number(sortingMetrics.dataSize ?? 0).toLocaleString()}
                      </span>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Algorithm:</span>
                      <span className={performanceMetricValue}>{sortingMetrics.algorithm}</span>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Sort time:</span>
                      <span className={performanceMetricValue} data-highlight={sortingMetrics.sortTime < 10 || undefined}>
                        {sortingMetrics.sortTime.toFixed(2)} ms
                      </span>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Cache hit:</span>
                      <span className={performanceMetricValue} data-highlight={sortingMetrics.cacheHit || undefined}>
                        {sortingMetrics.cacheHit ? 'Yes' : 'No'}
                      </span>
                    </div>

                    {sortingMetrics.avgMetrics && (
                      <>
                        <div className={performanceMetric}>
                          <span className={performanceMetricLabel}>Avg time:</span>
                          <span className={performanceMetricValue}>
                            {sortingMetrics.avgMetrics.avgExecutionTime.toFixed(2)} ms
                          </span>
                        </div>

                        <div className={performanceMetric}>
                          <span className={performanceMetricLabel}>Cache hit rate:</span>
                          <span className={performanceMetricValue}>
                            {(sortingMetrics.avgMetrics.cacheHitRate * 100).toFixed(1)}%
                          </span>
                        </div>
                      </>
                    )}

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Sort mode:</span>
                      <span className={performanceMetricValue} data-highlight>Client-side</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Advanced Multi-Sort Controls */}
          {showAdvancedSort && enableMultiSort && multiSort.length > 0 && (
            <div
              className={sortControlsContainer}
              style={{ background: 'var(--haze-color-bg-muted)', paddingTop: '8px', paddingBottom: '8px' }}
            >
              <div>
                <span className={sortLabel}>Multi-sort:</span>
                <div className={multiSortContainer}>
                  {multiSort.map(sortConfig => {
                    const option = availableSortOptions.find(opt => opt.key === sortConfig.key);
                    return (
                      <div className={multiSortTag} key={sortConfig.key}>
                        {option?.label ?? sortConfig.key} (
                        {sortConfig.direction === 'asc' ? '↑' : '↓'})
                        <button className={multiSortRemove} onClick={() => removeFromMultiSort(sortConfig.key)}>
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button className={addSortButton} onClick={clearMultiSort}>Clear all</button>
                  <button className={addSortButton} onClick={applyMultiSort}>Apply multi-sort</button>
                </div>
              </div>
            </div>
          )}

          <table className={tableStyle}>
            <thead className={tableHeader}>
              <tr>
                <th className={cx(tableHeaderCell, tableHeaderCellSortable)} onClick={() => handleSort('block_number')}>
                  Block
                  <span className={sortIndicator}>
                    {sort.field === 'block_number' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
                <th className={cx(tableHeaderCell, tableHeaderCellSortable)} onClick={() => handleSort('block_timestamp')}>
                  Time
                  <span className={sortIndicator}>
                    {sort.field === 'block_timestamp'
                      ? sort.direction === 'asc'
                        ? '↑'
                        : '↓'
                      : '↕'}
                  </span>
                </th>
                <th className={cx(tableHeaderCell, tableHeaderCellSortable)} onClick={() => handleSort('event_name')}>
                  Event
                  <span className={sortIndicator}>
                    {sort.field === 'event_name' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
                <th className={tableHeaderCell}>From</th>
                <th className={tableHeaderCell}>To</th>
                <th className={tableHeaderCell}>Value</th>
                <th className={tableHeaderCell}>Tx Hash</th>
              </tr>
            </thead>
            <tbody className={tableBody}>
              {events.map((event, index) => (
                <tr key={`${event.transactionHash}-${index}`}>
                  <td className={tableCell}>{event.blockNumber}</td>
                  <td className={cx(tableCell, timestampCell)}>{formatTimestamp(event.blockTimestamp)}</td>
                  <td className={cx(tableCell, eventNameCell)}>
                    {event.eventName}
                    {event.isFinalized === false && (
                      <span className={unfinalizedBadge}>unfinalized</span>
                    )}
                  </td>
                  <td className={cx(tableCell, addressCell)}>
                    {event.from ? (
                      <a
                        href={`/chain/${chainId}/address/${event.from}`}
                        style={{ color: 'var(--haze-color-primary)', textDecoration: 'none' }}
                      >
                        {formatAddress(event.from)}
                      </a>
                    ) : (
                      'N/A'
                    )}
                  </td>
                  <td className={cx(tableCell, addressCell)}>
                    {event.to ? (
                      <a
                        href={`/chain/${chainId}/address/${event.to}`}
                        style={{ color: 'var(--haze-color-primary)', textDecoration: 'none' }}
                      >
                        {formatAddress(event.to)}
                      </a>
                    ) : (
                      'N/A'
                    )}
                  </td>
                  <td className={cx(tableCell, valueCell)}>{formatValue(event.value)}</td>
                  <td className={cx(tableCell, transactionHashCell)}>
                    <a
                      href={`/chain/${chainId}/tx/${event.transactionHash}`}
                      style={{ color: 'var(--haze-color-primary)', textDecoration: 'none' }}
                    >
                      {formatTransactionHash(event.transactionHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Loading indicator for pagination */}
          {loading && events.length > 0 && (
            <div className={loadingContainer}>
              <div className={loadingSpinner} />
              <span style={{ marginLeft: 12 }}>Loading more events...</span>
            </div>
          )}

          {/* Error overlay for pagination errors */}
          {error && events.length > 0 && (
            <div className={errorContainer}>
              <div className={errorMessage}>Error loading more events</div>
              <button className={retryButton} onClick={handleRetry}>Retry</button>
            </div>
          )}

          {/* Enhanced Pagination controls */}
          <div className={paginationContainer}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div className={paginationInfo}>
                Showing {pagination.startIndex ?? 1}-{pagination.endIndex ?? events.length} of{' '}
                {pagination.total} events
              </div>

              {totalPages > 1 && (
                <div className={pageInfo}>
                  Page {pagination.page} / {totalPages}
                </div>
              )}
            </div>

            <div className={paginationControls}>
              <button
                className={paginationButton}
                onClick={handleFirstPage}
                disabled={pagination.page <= 1 || loading}
                title="First page"
              >
                ⇤
              </button>

              <button
                className={paginationButton}
                onClick={handlePrevPage}
                disabled={pagination.page <= 1 || loading}
                title="Previous page"
              >
                ←
              </button>

              {totalPages > 1 && (
                <>
                  <div className={paginationSeparator} />

                  <div className={goToPageContainer}>
                    <span className={goToPageLabel}>Go to:</span>
                    <input
                      className={paginationInput}
                      type="number"
                      value={pageInput}
                      onChange={handlePageInputChange}
                      onKeyPress={handlePageInputKeyPress}
                      placeholder={pagination.page.toString()}
                      min={1}
                      max={totalPages}
                    />
                    <button className={paginationButton} onClick={handleGoToPage} disabled={!pageInput || loading}>
                      Go
                    </button>
                  </div>

                  <div className={paginationSeparator} />
                </>
              )}

              <button
                className={paginationButton}
                onClick={handleNextPage}
                disabled={(!pagination.hasMore && pagination.page >= totalPages) || loading}
                title="Next page"
              >
                →
              </button>

              {totalPages > 1 && (
                <button
                  className={paginationButton}
                  onClick={handleLastPage}
                  disabled={pagination.page >= totalPages || loading}
                  title="Last page"
                >
                  ⇥
                </button>
              )}

              {pagination.total > 0 && (
                <>
                  {/* Export preflight: the query total is known here, so
                      refuse above the cap up front instead of letting the
                      click hit the backend 400. */}
                  {exportExceedsLimit && (
                    <span className={exportLimitNotice}>
                      Too many rows ({pagination.total.toLocaleString()}) — narrow the block
                      range or filters and export in chunks (limit 100,000 rows).
                    </span>
                  )}
                  {!backendConnected && (
                    <span className={exportLimitNotice}>
                      Backend not connected — export unavailable.
                    </span>
                  )}
                  <a
                    className={exportCsvButton}
                    {...(exportExceedsLimit || !backendConnected
                      ? {}
                      : { href: exportHref, download: true })}
                    aria-disabled={exportExceedsLimit || !backendConnected ? true : undefined}
                  >
                    Export CSV
                  </a>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EventTable;
