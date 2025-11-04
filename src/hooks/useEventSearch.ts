/**
 * High-performance event search hook
 * Provides optimized filtering, caching, and real-time search capabilities
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { FormattedEventData, EventFilters, PaginationParams } from '../types/events';
import { eventSearchOptimizer, SearchOptimizationOptions } from '../utils/event-search-optimization';

export interface UseEventSearchOptions extends SearchOptimizationOptions {
  enableDebounce?: boolean;
  debounceMs?: number;
  enableRealTimeSearch?: boolean;
  autoSearch?: boolean;
}

export interface SearchState {
  events: FormattedEventData[];
  filteredEvents: FormattedEventData[];
  loading: boolean;
  error: string | null;
  total: number;
  hasMore: boolean;
  searchMetrics: any[];
}

export interface SearchActions {
  search: (filters?: EventFilters, pagination?: PaginationParams) => Promise<void>;
  clearFilters: () => void;
  updateFilters: (filters: Partial<EventFilters>) => void;
  updatePagination: (pagination: Partial<PaginationParams>) => void;
  resetSearch: () => void;
  getPerformanceStats: () => any;
}

/**
 * High-performance event search hook
 */
export function useEventSearch(
  initialEvents: FormattedEventData[] = [],
  options: UseEventSearchOptions = {}
): [SearchState, SearchActions] {
  const {
    enableCache = true,
    cacheTTL = 300000, // 5 minutes
    maxCacheSize = 100,
    enableClientSideFiltering = true,
    clientSideThreshold = 10000,
    enablePerformanceMonitoring = true,
    enableDebounce = true,
    debounceMs = 300,
    enableRealTimeSearch = false,
    autoSearch = true
  } = options;

  // State management
  const [events, setEvents] = useState<FormattedEventData[]>(initialEvents);
  const [filters, setFilters] = useState<EventFilters>({});
  const [pagination, setPagination] = useState<PaginationParams>({
    limit: 50,
    offset: 0
  });
  const [searchState, setSearchState] = useState<SearchState>({
    events: initialEvents,
    filteredEvents: initialEvents,
    loading: false,
    error: null,
    total: initialEvents.length,
    hasMore: false,
    searchMetrics: []
  });

  // Refs for optimization
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const optimizerRef = useRef(eventSearchOptimizer);
  const lastSearchRef = useRef<string>('');

  // Memoized optimizer with current options
  const optimizer = useMemo(() => {
    return new eventSearchOptimizer.constructor({
      enableCache,
      cacheTTL,
      maxCacheSize,
      enableClientSideFiltering,
      clientSideThreshold,
      enablePerformanceMonitoring
    });
  }, [enableCache, cacheTTL, maxCacheSize, enableClientSideFiltering, clientSideThreshold, enablePerformanceMonitoring]);

  /**
   * Perform search with optimizations
   */
  const performSearch = useCallback(async (
    searchFilters: EventFilters = filters,
    searchPagination: PaginationParams = pagination
  ) => {
    // Cancel previous search if still running
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }

    // Create new abort controller
    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;

    // Generate search key for comparison
    const searchKey = JSON.stringify({ filters: searchFilters, pagination: searchPagination });

    // Skip if this is the same search as the last one
    if (searchKey === lastSearchRef.current && !searchState.loading) {
      return;
    }
    lastSearchRef.current = searchKey;

    setSearchState(prev => ({ ...prev, loading: true, error: null }));

    try {
      if (abortController.signal.aborted) return;

      // Use optimized search
      const result = await optimizer.searchEvents(events, searchFilters, searchPagination);

      if (abortController.signal.aborted) return;

      setSearchState(prev => ({
        ...prev,
        filteredEvents: result.events,
        total: result.total,
        hasMore: searchPagination.offset! + result.events.length < result.total,
        loading: false,
        searchMetrics: result.metrics
      }));

    } catch (error) {
      if (abortController.signal.aborted) return;

      setSearchState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Search failed'
      }));
    }
  }, [events, filters, pagination, optimizer, searchState.loading]);

  /**
   * Debounced search function
   */
  const debouncedSearch = useCallback((
    searchFilters: EventFilters = filters,
    searchPagination: PaginationParams = pagination
  ) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(searchFilters, searchPagination);
    }, debounceMs);
  }, [performSearch, debounceMs]);

  /**
   * Public search function
   */
  const search = useCallback(async (
    newFilters?: EventFilters,
    newPagination?: PaginationParams
  ) => {
    const searchFilters = newFilters || filters;
    const searchPagination = newPagination || pagination;

    if (enableDebounce && enableRealTimeSearch) {
      debouncedSearch(searchFilters, searchPagination);
    } else {
      await performSearch(searchFilters, searchPagination);
    }
  }, [filters, pagination, enableDebounce, enableRealTimeSearch, debouncedSearch, performSearch]);

  /**
   * Clear all filters
   */
  const clearFilters = useCallback(() => {
    const newFilters = {};
    setFilters(newFilters);
    setPagination({ limit: 50, offset: 0 });

    if (autoSearch) {
      search(newFilters, { limit: 50, offset: 0 });
    }
  }, [search, autoSearch]);

  /**
   * Update filters
   */
  const updateFilters = useCallback((newFilters: Partial<EventFilters>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    setPagination(prev => ({ ...prev, offset: 0 })); // Reset to first page

    if (autoSearch) {
      if (enableDebounce && enableRealTimeSearch) {
        debouncedSearch(updatedFilters, { ...pagination, offset: 0 });
      } else {
        search(updatedFilters, { ...pagination, offset: 0 });
      }
    }
  }, [filters, pagination, autoSearch, enableDebounce, enableRealTimeSearch, debouncedSearch, search]);

  /**
   * Update pagination
   */
  const updatePagination = useCallback((newPagination: Partial<PaginationParams>) => {
    const updatedPagination = { ...pagination, ...newPagination };
    setPagination(updatedPagination);

    if (autoSearch) {
      if (enableDebounce && enableRealTimeSearch) {
        debouncedSearch(filters, updatedPagination);
      } else {
        search(filters, updatedPagination);
      }
    }
  }, [filters, pagination, autoSearch, enableDebounce, enableRealTimeSearch, debouncedSearch, search]);

  /**
   * Reset search to initial state
   */
  const resetSearch = useCallback(() => {
    setFilters({});
    setPagination({ limit: 50, offset: 0 });
    setSearchState(prev => ({
      ...prev,
      filteredEvents: events,
      total: events.length,
      hasMore: false,
      loading: false,
      error: null
    }));

    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Cancel any ongoing search
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
  }, [events]);

  /**
   * Get performance statistics
   */
  const getPerformanceStats = useCallback(() => {
    return optimizer.getPerformanceStats();
  }, [optimizer]);

  // Update events when initial events change
  useEffect(() => {
    setEvents(initialEvents);
    setSearchState(prev => ({
      ...prev,
      events: initialEvents,
      filteredEvents: prev.filters && Object.keys(prev.filters).length > 0 ? prev.filteredEvents : initialEvents,
      total: prev.filters && Object.keys(prev.filters).length > 0 ? prev.total : initialEvents.length
    }));

    // Re-run search if we have active filters
    if (Object.keys(filters).length > 0 && autoSearch) {
      search();
    }
  }, [initialEvents, filters, autoSearch, search]);

  // Initial search if auto-search is enabled
  useEffect(() => {
    if (autoSearch && initialEvents.length > 0 && (Object.keys(filters).length > 0 || pagination.offset! > 0)) {
      search();
    }
  }, []); // Only run once on mount

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
    };
  }, []);

  const searchActions: SearchActions = {
    search,
    clearFilters,
    updateFilters,
    updatePagination,
    resetSearch,
    getPerformanceStats
  };

  return [searchState, searchActions];
}

/**
 * Hook for real-time event search with debounced input
 */
export function useRealTimeEventSearch(
  events: FormattedEventData[],
  options: UseEventSearchOptions = {}
) {
  return useEventSearch(events, {
    ...options,
    enableDebounce: true,
    enableRealTimeSearch: true,
    debounceMs: options.debounceMs || 200
  });
}

/**
 * Hook for batch event search (large datasets)
 */
export function useBatchEventSearch(
  events: FormattedEventData[],
  options: UseEventSearchOptions = {}
) {
  return useEventSearch(events, {
    ...options,
    enableClientSideFiltering: true,
    clientSideThreshold: 50000, // Higher threshold for batch processing
    enableCache: true,
    cacheTTL: 600000, // 10 minutes cache for batch operations
    enableDebounce: false,
    enableRealTimeSearch: false
  });
}