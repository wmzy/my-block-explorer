/**
 * EventTable component - displays contract events with pagination, sorting, and filtering
 * Integrates with events API endpoints for real-time data display
 */

import React, { useState, useEffect, useCallback } from 'react';
import { styled } from '@linaria/react';
import { Address, formatEther, formatUnits } from 'viem';
import DynamicEventFilterForm from './DynamicEventFilterForm';

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
  availableSortOptions?: SortOption[];
  defaultPageSize?: number;
  enableMultiSort?: boolean;
  enableCustomPageSize?: boolean;
  columnConfig?: ColumnConfig[];
  enableClientSideSort?: boolean;
  clientSideSortThreshold?: number;
  // Enhanced filtering props
  abiEvents?: any[];
  enableDynamicFiltering?: boolean;
  onFiltersChange?: (filters: any) => void;
}

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
  totalPages?: number;
  startIndex?: number;
  endIndex?: number;
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

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
  type?: 'numeric' | 'text' | 'address' | 'timestamp';
  priority?: number;
}

interface SortOption {
  key: string;
  label: string;
  type: 'numeric' | 'text' | 'address' | 'timestamp';
  defaultDirection?: 'asc' | 'desc';
  description?: string;
}

interface ColumnConfig {
  key: string;
  label: string;
  sortable: boolean;
  width?: string;
  visible: boolean;
  priority: number;
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
  align-items: center;
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
  border: 1px solid ${props => props.$active ? '#3b82f6' : '#d1d5db'};
  background: ${props => props.$active ? '#eff6ff' : 'white'};
  color: ${props => props.$active ? '#1d4ed8' : '#374151'};
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  margin-left: 4px;

  &:hover {
    background: ${props => props.$active ? '#dbeafe' : '#f3f4f6'};
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
  color: ${props => props.highlight ? '#059669' : '#374151'};
  font-weight: ${props => props.highlight ? '600' : 'normal'};
`;

const PerformanceToggleButton = styled.button<{ $active?: boolean }>`
  padding: 4px 8px;
  background: ${props => props.$active ? '#e0f2fe' : 'white'};
  border: 1px solid ${props => props.$active ? '#0ea5e9' : '#d1d5db'};
  border-radius: 4px;
  color: ${props => props.$active ? '#0369a1' : '#6b7280'};
  cursor: pointer;
  font-size: 11px;
  margin-left: 8px;

  &:hover {
    background: ${props => props.$active ? '#bae6fd' : '#f3f4f6'};
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

// Import optimized sorting and search utilities
import { optimizedSort, sortingPerformanceMonitor } from '../../utils/sorting-optimization';

// Legacy client-side sorting utility (kept for compatibility)
const getValueByPath = (obj: any, path: string): any => {
  return path.split('.').reduce((current, key) => current?.[key], obj);
};

const clientSideSort = (
  data: EventData[],
  sortConfigs: SortConfig[],
  primarySort: SortState
): EventData[] => {
  if (!sortConfigs.length && !primarySort.field) return data;

  // Prepare sort configurations for optimized sorter
  let finalSortConfigs: SortConfig[] = [];

  if (sortConfigs.length > 0) {
    // Use multi-sort configurations
    finalSortConfigs = sortConfigs.map(config => ({
      ...config,
      type: config.type || 'text'
    }));
  } else if (primarySort.field) {
    // Use primary sort configuration
    const sortOption = defaultSortOptions.find(opt => opt.key === primarySort.field);
    finalSortConfigs = [{
      key: primarySort.field,
      direction: primarySort.direction,
      type: sortOption?.type || 'text',
      priority: 0
    }];
  }

  // Generate cache key based on sort configurations
  const cacheKey = `sort_${JSON.stringify({
    dataSize: data.length,
    configs: finalSortConfigs.map(c => ({ k: c.key, d: c.direction, t: c.type }))
  })}`;

  // Use optimized sorting
  const result = optimizedSort(data, finalSortConfigs, {
    useCache: true,
    cacheKey,
    threshold: 1000 // Use optimized sorting for datasets over 1000 items
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

// Default sort options
const defaultSortOptions: SortOption[] = [
  { key: 'block_timestamp', label: '时间', type: 'timestamp', defaultDirection: 'desc', description: '按区块时间排序' },
  { key: 'block_number', label: '区块号', type: 'numeric', defaultDirection: 'desc', description: '按区块号排序' },
  { key: 'event_name', label: '事件名称', type: 'text', defaultDirection: 'asc', description: '按事件名称排序' },
  { key: 'from', label: '发送方', type: 'address', defaultDirection: 'asc', description: '按发送方地址排序' },
  { key: 'to', label: '接收方', type: 'address', defaultDirection: 'asc', description: '按接收方地址排序' },
  { key: 'value', label: '金额', type: 'numeric', defaultDirection: 'desc', description: '按交易金额排序' },
  { key: 'transaction_hash', label: '交易哈希', type: 'text', defaultDirection: 'asc', description: '按交易哈希排序' },
];

const pageSizeOptions = [10, 20, 50, 100, 200];

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
  columnConfig,
  enableClientSideSort = true,
  clientSideSortThreshold = 1000,
  abiEvents = [],
  enableDynamicFiltering = false,
  onFiltersChange
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
  const [filters, setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState<SortState>({
    field: 'block_timestamp',
    direction: 'desc'
  });

  // Enhanced sorting state
  const [multiSort, setMultiSort] = useState<SortConfig[]>([]);
  const [currentSortField, setCurrentSortField] = useState<string>('block_timestamp');
  const [showAdvancedSort, setShowAdvancedSort] = useState(false);

  // Enhanced pagination state
  const [pageInput, setPageInput] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(1);

  // Performance monitoring state
  const [sortingMetrics, setSortingMetrics] = useState<any>(null);
  const [showPerformanceInfo, setShowPerformanceInfo] = useState(false);

  // Enhanced filtering state
  const [dynamicFilters, setDynamicFilters] = useState<any>({});
  const [showFilterForm, setShowFilterForm] = useState(enableDynamicFiltering);

  // Determine if we should use client-side sorting
  const shouldUseClientSideSort = enableClientSideSort && allEvents.length <= clientSideSortThreshold;

  // API call function
  const fetchEvents = useCallback(async (cursor?: string) => {
    console.log('fetchEvents called', { chainId, contractAddress, cursor });
    setLoading(true);
    setError(null);

    try {
      const currentPage = Math.floor((pagination.startIndex ?? 0) / pagination.limit) + 1;
      const queryParams = new URLSearchParams({
        page: currentPage.toString(),
        pageSize: pagination.limit.toString(),
        sort: sort.direction,
        sortBy: sort.field,
      });

      console.log('Query params prepared', Object.fromEntries(queryParams));

      // Add multi-sort support
      if (enableMultiSort && multiSort.length > 0) {
        queryParams.set('multiSort', JSON.stringify(multiSort.map(s => ({
          field: s.key,
          direction: s.direction,
          type: s.type,
          priority: s.priority
        }))));
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

      // Add dynamic filters from ABI-based filtering
      Object.entries(dynamicFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (typeof value === 'object' && value !== null) {
            const obj = value as Record<string, unknown>;
            if (obj.from) queryParams.set(`${key}_from`, String(obj.from));
            if (obj.to) queryParams.set(`${key}_to`, String(obj.to));
            if (obj.like) queryParams.set(`${key}_like`, String(obj.like));
          } else {
            queryParams.set(key, String(value));
          }
        }
      });

      const url = `/api/chains/${chainId}/contracts/${contractAddress}/events?${queryParams}`;
      console.log('Making API request to:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('API response status:', response.status);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('API response data:', data);

      const normalizedEvents = (data.events ?? []).map((e: any) => {
        const args = typeof e.decodedArgs === "string"
          ? (() => { try { return JSON.parse(e.decodedArgs); } catch { return {}; } })()
          : (e.decodedArgs ?? {});
        const blockTimestamp = typeof e.blockTimestamp === "number"
          ? new Date(e.blockTimestamp * 1000).toISOString()
          : e.blockTimestamp;
        return { ...args, ...e, blockTimestamp };
      });

      if (cursor) {
        setAllEvents(prev => [...prev, ...normalizedEvents]);
      } else {
        setAllEvents(normalizedEvents);
      }

      setPagination(prev => ({
        ...prev,
        total: data.total || data.events.length,
        hasMore: data.page < (data.totalPages ?? 1),
        totalPages: data.totalPages,
      }));

      console.log('Events updated, count:', data.events.length);

    } catch (err) {
      console.error('Failed to fetch events:', err);
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [chainId, contractAddress, pagination.limit, sort, filters, enableMultiSort, multiSort, dynamicFilters]);

  // Initial load
  useEffect(() => {
    console.log('EventTable: Initial load, fetching events...', { chainId, contractAddress });
    fetchEvents();
  }, [chainId, contractAddress]); // Remove fetchEvents from deps to avoid infinite loop

  // Refetch when filters or pagination change (but not on initial load)
  useEffect(() => {
    // Skip on initial mount by checking if we already have events
    if (allEvents.length > 0) {
      console.log('EventTable: Filters or pagination changed, refetching...', { dynamicFilters, pagination });
      fetchEvents();
    }
  }, [dynamicFilters, pagination.limit, sort.field, sort.direction]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enhanced sorting handlers
  const handleSort = (field: string) => {
    const newDirection = sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc';
    setSort({ field, direction: newDirection });
    setCurrentSortField(field);

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents();
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  const handleSortFieldChange = (field: string) => {
    setCurrentSortField(field);
    const sortOption = availableSortOptions.find(option => option.key === field);
    const direction = sortOption?.defaultDirection || 'asc';
    setSort({ field, direction });

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents();
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
      fetchEvents();
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
      fetchEvents();
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
        direction: newMultiSort[existingIndex].direction === 'asc' ? 'desc' : 'asc'
      };
    } else {
      // Add new sort
      const newSortConfig: SortConfig = {
        key: currentSortField,
        direction: sortOption.defaultDirection || 'asc',
        type: sortOption.type,
        priority: multiSort.length
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
    const primarySort = multiSort.sort((a, b) => (a.priority || 0) - (b.priority || 0))[0];
    setSort({ field: primarySort.key, direction: primarySort.direction });

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents();
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
        fetchEvents();
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
      fetchEvents();
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
      fetchEvents();
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
        fetchEvents();
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
        fetchEvents();
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
      endIndex
    }));
  }, [pagination.total, pagination.limit, pagination.page]);

  useEffect(() => {
    calculatePaginationInfo();
  }, [calculatePaginationInfo]);

  // Apply client-side sorting and pagination when data changes
  useEffect(() => {
    if (shouldUseClientSideSort) {
      const startTime = performance.now();

      // Apply client-side sorting with performance monitoring
      const sortedData = clientSideSort(allEvents, multiSort, sort);

      // Apply client-side pagination
      const paginatedData = paginateData(sortedData, pagination.page, pagination.limit);

      const sortTime = performance.now() - startTime;

      // Get performance metrics from the monitor
      const avgMetrics = sortingPerformanceMonitor.getAverageMetrics();
      const recentMetrics = sortingPerformanceMonitor.getMetricsByAlgorithm();

      setEvents(paginatedData);
      setSortingMetrics({
        sortTime,
        dataSize: allEvents.length,
        algorithm: recentMetrics['optimized'] ? 'optimized' : 'standard',
        cacheHit: sortTime < 5, // Assume cache hit if very fast
        avgMetrics
      });

      // Update pagination info for client-side data
      setPagination(prev => ({
        ...prev,
        total: allEvents.length,
        hasMore: pagination.page * pagination.limit < allEvents.length,
        totalPages: Math.ceil(allEvents.length / pagination.limit)
      }));
    } else {
      // For server-side sorting, just use the events as-is
      if (pagination.page === 1) {
        setEvents(allEvents.slice(0, pagination.limit));
      }
      setSortingMetrics(null);
    }
  }, [allEvents, sort, multiSort, pagination.page, pagination.limit, shouldUseClientSideSort]);

  const handleRetry = () => {
    setError(null);
    fetchEvents();
  };

  // Enhanced filtering handlers
  const handleFilterChange = useCallback((newFilters: any) => {
    setDynamicFilters(newFilters);
    onFiltersChange?.(newFilters);

    // Reset pagination and refetch
    setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
  }, [onFiltersChange]);

  const handleFilterApply = useCallback((appliedFilters: any) => {
    setDynamicFilters(appliedFilters);
    onFiltersChange?.(appliedFilters);

    // Reset pagination and refetch
    setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
  }, [onFiltersChange]);

  const toggleFilterForm = useCallback(() => {
    setShowFilterForm(prev => !prev);
  }, []);

  const clearAllFilters = useCallback(() => {
    setDynamicFilters({});
    onFiltersChange?.({});

    // Reset pagination and refetch
    setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
    fetchEvents();
  }, [onFiltersChange, fetchEvents]);

  // Render loading state
  if (loading && events.length === 0) {
    return (
      <TableContainer className={className}>
        <LoadingContainer>
          <LoadingSpinner />
          <span style={{ marginLeft: 12 }}>正在加载事件...</span>
        </LoadingContainer>
      </TableContainer>
    );
  }

  // Render error state
  if (error && events.length === 0) {
    return (
      <TableContainer className={className}>
        <ErrorContainer>
          <ErrorMessage>加载事件失败</ErrorMessage>
          <div style={{ color: '#9ca3af', marginBottom: 16 }}>{error}</div>
          <RetryButton onClick={handleRetry}>重试</RetryButton>
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
          <EmptyStateTitle>未找到事件</EmptyStateTitle>
          <EmptyStateDescription>
            此合约尚未发出任何事件，或没有事件匹配当前的过滤器。
          </EmptyStateDescription>
        </EmptyStateContainer>
      </TableContainer>
    );
  }

  const hasActiveFilters = Object.keys(dynamicFilters).length > 0 &&
    Object.values(dynamicFilters).some(value =>
      value !== null && value !== undefined && value !== '' &&
      (typeof value !== 'object' || Object.values(value).some(v => v !== null && v !== undefined && v !== ''))
    );

  return (
    <TableContainer className={className}>
      {/* Enhanced Filtering Controls */}
      {enableDynamicFiltering && (
        <div style={{
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          padding: '16px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: showFilterForm ? '16px' : '0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Event Filters</h4>
              {hasActiveFilters && (
                <span style={{
                  background: '#007bff',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '12px'
                }}>
                  {Object.keys(dynamicFilters).length} active
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={toggleFilterForm}
                style={{
                  padding: '6px 12px',
                  background: showFilterForm ? '#e3f2fd' : '#f8f9fa',
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                {showFilterForm ? 'Hide Filters' : 'Show Filters'}
              </button>
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  style={{
                    padding: '6px 12px',
                    background: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {/* Dynamic Filter Form */}
          {showFilterForm && abiEvents.length > 0 && (
            <DynamicEventFilterForm
              contractAddress={contractAddress}
              abiEvents={abiEvents}
              onFilterChange={handleFilterChange}
              onApplyFilters={handleFilterApply}
              initialFilters={dynamicFilters}
              disabled={loading}
            />
          )}
        </div>
      )}

      {/* Enhanced Sorting Controls */}
      <SortControlsContainer>
        <SortOptionsContainer>
          <SortLabel>排序:</SortLabel>
          <SortSelect
            value={currentSortField}
            onChange={(e) => handleSortFieldChange(e.target.value)}
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
            {sort.direction === 'asc' ? '↑ 升序' : '↓ 降序'}
          </SortDirectionButton>

          {enableMultiSort && (
            <>
              <AddSortButton onClick={addToMultiSort}>
                + 添加到多列排序
              </AddSortButton>
              <AddSortButton onClick={() => setShowAdvancedSort(!showAdvancedSort)}>
                {showAdvancedSort ? '隐藏' : '显示'}高级排序
              </AddSortButton>
            </>
          )}
        </SortOptionsContainer>

        {enableCustomPageSize && (
          <PageSizeControl>
            <PageSizeLabel>每页显示:</PageSizeLabel>
            <PageSizeSelect
              value={pagination.limit}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map(size => (
                <option key={size} value={size}>
                  {size} 条
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
              性能: {sortingMetrics.sortTime.toFixed(1)}ms
            </PerformanceToggleButton>

            {showPerformanceInfo && (
              <PerformanceInfoContainer>
                <PerformanceHeader>
                  排序性能指标
                  <PerformanceCloseButton onClick={() => setShowPerformanceInfo(false)}>
                    ×
                  </PerformanceCloseButton>
                </PerformanceHeader>

                <PerformanceMetric>
                  <PerformanceMetricLabel>数据量:</PerformanceMetricLabel>
                  <PerformanceMetricValue>{Number(sortingMetrics.dataSize || 0).toLocaleString()} 条</PerformanceMetricValue>
                </PerformanceMetric>

                <PerformanceMetric>
                  <PerformanceMetricLabel>排序算法:</PerformanceMetricLabel>
                  <PerformanceMetricValue>{sortingMetrics.algorithm}</PerformanceMetricValue>
                </PerformanceMetric>

                <PerformanceMetric>
                  <PerformanceMetricLabel>排序时间:</PerformanceMetricLabel>
                  <PerformanceMetricValue highlight={sortingMetrics.sortTime < 10}>
                    {sortingMetrics.sortTime.toFixed(2)} ms
                  </PerformanceMetricValue>
                </PerformanceMetric>

                <PerformanceMetric>
                  <PerformanceMetricLabel>缓存命中:</PerformanceMetricLabel>
                  <PerformanceMetricValue highlight={sortingMetrics.cacheHit}>
                    {sortingMetrics.cacheHit ? '是' : '否'}
                  </PerformanceMetricValue>
                </PerformanceMetric>

                {sortingMetrics.avgMetrics && (
                  <>
                    <PerformanceMetric>
                      <PerformanceMetricLabel>平均时间:</PerformanceMetricLabel>
                      <PerformanceMetricValue>
                        {sortingMetrics.avgMetrics.avgExecutionTime.toFixed(2)} ms
                      </PerformanceMetricValue>
                    </PerformanceMetric>

                    <PerformanceMetric>
                      <PerformanceMetricLabel>缓存命中率:</PerformanceMetricLabel>
                      <PerformanceMetricValue>
                        {(sortingMetrics.avgMetrics.cacheHitRate * 100).toFixed(1)}%
                      </PerformanceMetricValue>
                    </PerformanceMetric>
                  </>
                )}

                <PerformanceMetric>
                  <PerformanceMetricLabel>排序模式:</PerformanceMetricLabel>
                  <PerformanceMetricValue highlight>客户端</PerformanceMetricValue>
                </PerformanceMetric>
              </PerformanceInfoContainer>
            )}
          </div>
        )}
      </SortControlsContainer>

      {/* Advanced Multi-Sort Controls */}
      {showAdvancedSort && enableMultiSort && multiSort.length > 0 && (
        <SortControlsContainer style={{ background: '#f1f5f9', paddingTop: '8px', paddingBottom: '8px' }}>
          <div>
            <SortLabel>多列排序:</SortLabel>
            <MultiSortContainer>
              {multiSort.map((sortConfig) => {
                const option = availableSortOptions.find(opt => opt.key === sortConfig.key);
                return (
                  <MultiSortTag key={sortConfig.key}>
                    {option?.label || sortConfig.key} ({sortConfig.direction === 'asc' ? '↑' : '↓'})
                    <MultiSortRemove onClick={() => removeFromMultiSort(sortConfig.key)}>
                      ×
                    </MultiSortRemove>
                  </MultiSortTag>
                );
              })}
              <AddSortButton onClick={clearMultiSort}>
                清除全部
              </AddSortButton>
              <AddSortButton onClick={applyMultiSort}>
                应用多列排序
              </AddSortButton>
            </MultiSortContainer>
          </div>
        </SortControlsContainer>
      )}

      <Table>
        <TableHeader>
          <tr>
            <TableHeaderCell sortable onClick={() => handleSort('block_number')}>
              区块号
              <SortIndicator>{sort.field === 'block_number' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</SortIndicator>
            </TableHeaderCell>
            <TableHeaderCell sortable onClick={() => handleSort('block_timestamp')}>
              时间
              <SortIndicator>{sort.field === 'block_timestamp' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</SortIndicator>
            </TableHeaderCell>
            <TableHeaderCell sortable onClick={() => handleSort('event_name')}>
              事件
              <SortIndicator>{sort.field === 'event_name' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</SortIndicator>
            </TableHeaderCell>
            <TableHeaderCell>发送方</TableHeaderCell>
            <TableHeaderCell>接收方</TableHeaderCell>
            <TableHeaderCell>金额</TableHeaderCell>
            <TableHeaderCell>交易哈希</TableHeaderCell>
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
                    href={`/chain/${chainId}/address/${event.from}`}
                    style={{ color: '#4f46e5', textDecoration: 'none' }}
                  >
                    {formatAddress(event.from)}
                  </a>
                ) : 'N/A'}
              </AddressCell>
              <AddressCell>
                {event.to ? (
                  <a
                    href={`/chain/${chainId}/address/${event.to}`}
                    style={{ color: '#4f46e5', textDecoration: 'none' }}
                  >
                    {formatAddress(event.to)}
                  </a>
                ) : 'N/A'}
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
          <RetryButton onClick={handleRetry}>重试</RetryButton>
        </ErrorContainer>
      )}

      {/* Enhanced Pagination controls */}
      <PaginationContainer>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <PaginationInfo>
            显示第 {pagination.startIndex || 1} - {pagination.endIndex || events.length} 条，
            共 {pagination.total} 条事件
          </PaginationInfo>

          {totalPages > 1 && (
            <PageInfo>
              第 {pagination.page} / {totalPages} 页
            </PageInfo>
          )}
        </div>

        <PaginationControls>
          <PaginationButton
            onClick={handleFirstPage}
            disabled={pagination.page <= 1 || loading}
            title="第一页"
          >
            ⇤
          </PaginationButton>

          <PaginationButton
            onClick={handlePrevPage}
            disabled={pagination.page <= 1 || loading}
            title="上一页"
          >
            ←
          </PaginationButton>

          {totalPages > 1 && (
            <>
              <PaginationSeparator />

              <GoToPageContainer>
                <GoToPageLabel>跳转到:</GoToPageLabel>
                <PaginationInput
                  type="number"
                  value={pageInput}
                  onChange={handlePageInputChange}
                  onKeyPress={handlePageInputKeyPress}
                  placeholder={pagination.page.toString()}
                  min={1}
                  max={totalPages}
                />
                <PaginationButton
                  onClick={handleGoToPage}
                  disabled={!pageInput || loading}
                >
                  确定
                </PaginationButton>
              </GoToPageContainer>

              <PaginationSeparator />
            </>
          )}

          <PaginationButton
            onClick={handleNextPage}
            disabled={!pagination.hasMore && pagination.page >= totalPages || loading}
            title="下一页"
          >
            →
          </PaginationButton>

          {totalPages > 1 && (
            <PaginationButton
              onClick={handleLastPage}
              disabled={pagination.page >= totalPages || loading}
              title="最后一页"
            >
              ⇥
            </PaginationButton>
          )}
        </PaginationControls>
      </PaginationContainer>
    </TableContainer>
  );
};

export default EventTable;