/**
 * Unit tests for EventTable sorting and pagination functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EventTable } from '../../../components/events/EventTable';
import { Address } from 'viem';

// Mock the sorting optimization utilities
vi.mock('../../../utils/sorting-optimization', () => ({
  optimizedSort: vi.fn().mockImplementation((data, sortConfigs, options) => {
    // Simple mock sorting for testing
    const sortedData = [...data];
    if (sortConfigs.length > 0) {
      const config = sortConfigs[0];
      sortedData.sort((a, b) => {
        const aVal = a[config.key];
        const bVal = b[config.key];
        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return config.direction === 'desc' ? -comparison : comparison;
      });
    }
    return {
      sortedData,
      metrics: {
        algorithmUsed: options?.threshold && data.length > options.threshold ? 'optimized' : 'standard',
        executionTime: 5,
        dataSize: data.length,
        memoryUsage: data.length * 100,
        cacheHit: false
      }
    };
  }),
  sortingPerformanceMonitor: {
    recordMetrics: vi.fn(),
    getAverageMetrics: vi.fn().mockReturnValue({
      avgExecutionTime: 8,
      avgDataSize: 500,
      avgMemoryUsage: 50000,
      cacheHitRate: 0.3,
      totalOperations: 10
    }),
    getMetricsByAlgorithm: vi.fn().mockReturnValue({
      standard: { count: 7, avgExecutionTime: 6, avgDataSize: 300 },
      optimized: { count: 3, avgExecutionTime: 12, avgDataSize: 1000 }
    }),
    clear: vi.fn()
  }
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('EventTable Sorting', () => {
  const mockChainId = 1;
  const mockContractAddress = '0x1234567890123456789012345678901234567890' as Address;

  const mockEvents = Array.from({ length: 25 }, (_, i) => ({
    blockNumber: 18000000 + i,
    blockTimestamp: new Date(Date.now() - i * 60000).toISOString(),
    transactionHash: `0x${(1000 + i).toString(16).padStart(64, '0')}`,
    eventName: ['Transfer', 'Approval', 'Swap'][i % 3],
    from: `0x${(2000 + i).toString(16).padStart(40, '0')}`,
    to: `0x${(3000 + i).toString(16).padStart(40, '0')}`,
    value: (BigInt(i + 1) * BigInt(10 ** 18)).toString(),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        events: mockEvents.slice(0, 10),
        total: mockEvents.length,
        hasMore: true,
        nextCursor: mockEvents[9].blockTimestamp
      })
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Sorting', () => {
    it('should render sort controls', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      expect(screen.getByText('排序:')).toBeInTheDocument();
      expect(screen.getByDisplayValue('时间')).toBeInTheDocument();
      expect(screen.getByText('↑ 升序')).toBeInTheDocument();
    });

    it('should change sort field when dropdown is changed', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      const sortSelect = screen.getByDisplayValue('时间');
      fireEvent.change(sortSelect, { target: { value: 'block_number' } });

      await waitFor(() => {
        expect(sortSelect).toHaveValue('block_number');
      });
    });

    it('should toggle sort direction when direction button is clicked', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      const directionButton = screen.getByText('↑ 升序');
      fireEvent.click(directionButton);

      await waitFor(() => {
        expect(screen.getByText('↓ 降序')).toBeInTheDocument();
      });
    });

    it('should sort by block number when column header is clicked', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      const blockNumberHeader = screen.getByText('区块号');
      fireEvent.click(blockNumberHeader);

      await waitFor(() => {
        const sortSelect = screen.getByDisplayValue('区块号');
        expect(sortSelect).toBeInTheDocument();
      });
    });
  });

  describe('Multi-Sort', () => {
    it('should show multi-sort controls when enabled', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          enableMultiSort={true}
        />
      );

      expect(screen.getByText('+ 添加到多列排序')).toBeInTheDocument();
      expect(screen.getByText('显示高级排序')).toBeInTheDocument();
    });

    it('should add sort configuration to multi-sort', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          enableMultiSort={true}
        />
      );

      const addToMultiSortButton = screen.getByText('+ 添加到多列排序');
      fireEvent.click(addToMultiSortButton);

      const showAdvancedButton = screen.getByText('显示高级排序');
      fireEvent.click(showAdvancedButton);

      await waitFor(() => {
        expect(screen.getByText(/时间/)).toBeInTheDocument();
      });
    });

    it('should clear all multi-sort configurations', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          enableMultiSort={true}
        />
      );

      // Add to multi-sort first
      const addToMultiSortButton = screen.getByText('+ 添加到多列排序');
      fireEvent.click(addToMultiSortButton);

      const showAdvancedButton = screen.getByText('显示高级排序');
      fireEvent.click(showAdvancedButton);

      // Wait for multi-sort to be added
      await waitFor(() => {
        expect(screen.getByText(/时间/)).toBeInTheDocument();
      });

      // Clear all
      const clearButton = screen.getByText('清除全部');
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(screen.queryByText(/时间/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Client-Side vs Server-Side Sorting', () => {
    it('should use client-side sorting for small datasets', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents.slice(0, 10)}
          enableClientSideSort={true}
          clientSideSortThreshold={100}
        />
      );

      // Should show performance info for client-side sorting
      expect(screen.queryByText(/性能:/)).toBeInTheDocument();
    });

    it('should use server-side sorting for large datasets', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          clientSideSortThreshold={10} // Low threshold to force server-side
        />
      );

      // Should not show performance info for server-side sorting
      expect(screen.queryByText(/性能:/)).not.toBeInTheDocument();
    });

    it('should make API call for server-side sorting', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={[]} // Empty to trigger API call
          enableClientSideSort={false}
        />
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/chains/1/contracts/0x1234567890123456789012345678901234567890/events'),
          expect.any(Object)
        );
      });
    });
  });

  describe('Performance Monitoring', () => {
    it('should show performance toggle when client-side sorting is enabled', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      expect(screen.getByText(/性能:/)).toBeInTheDocument();
    });

    it('should show performance metrics when toggle is clicked', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      const performanceButton = screen.getByText(/性能:/);
      fireEvent.click(performanceButton);

      await waitFor(() => {
        expect(screen.getByText('排序性能指标')).toBeInTheDocument();
        expect(screen.getByText('数据量:')).toBeInTheDocument();
        expect(screen.getByText('排序算法:')).toBeInTheDocument();
        expect(screen.getByText('排序时间:')).toBeInTheDocument();
        expect(screen.getByText('缓存命中:')).toBeInTheDocument();
        expect(screen.getByText('排序模式:')).toBeInTheDocument();
        expect(screen.getByText('客户端')).toBeInTheDocument();
      });
    });

    it('should hide performance metrics when close button is clicked', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      // Show performance metrics
      const performanceButton = screen.getByText(/性能:/);
      fireEvent.click(performanceButton);

      await waitFor(() => {
        expect(screen.getByText('排序性能指标')).toBeInTheDocument();
      });

      // Hide performance metrics
      const closeButton = screen.getByText('×');
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('排序性能指标')).not.toBeInTheDocument();
      });
    });

    it('should display average metrics when available', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      const performanceButton = screen.getByText(/性能:/);
      fireEvent.click(performanceButton);

      await waitFor(() => {
        expect(screen.getByText('平均时间:')).toBeInTheDocument();
        expect(screen.getByText('缓存命中率:')).toBeInTheDocument();
        expect(screen.getByText('8.00 ms')).toBeInTheDocument(); // Mocked average
        expect(screen.getByText('30.0%')).toBeInTheDocument(); // Mocked cache hit rate
      });
    });
  });

  describe('Sort Configuration Types', () => {
    it('should handle different sort field types', () => {
      const customSortOptions = [
        { key: 'blockNumber', label: '区块号', type: 'numeric' as const, defaultDirection: 'desc' as const },
        { key: 'eventName', label: '事件名称', type: 'text' as const, defaultDirection: 'asc' as const },
        { key: 'from', label: '发送方', type: 'address' as const, defaultDirection: 'asc' as const },
        { key: 'blockTimestamp', label: '时间', type: 'timestamp' as const, defaultDirection: 'desc' as const },
      ];

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          availableSortOptions={customSortOptions}
          enableClientSideSort={true}
        />
      );

      // Check that all sort options are available
      customSortOptions.forEach(option => {
        expect(screen.getByText(option.label)).toBeInTheDocument();
      });
    });

    it('should use default direction when switching sort fields', async () => {
      const customSortOptions = [
        { key: 'eventName', label: '事件名称', type: 'text' as const, defaultDirection: 'asc' as const },
        { key: 'blockNumber', label: '区块号', type: 'numeric' as const, defaultDirection: 'desc' as const },
      ];

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          availableSortOptions={customSortOptions}
          enableClientSideSort={true}
        />
      );

      // Switch to event name (should default to asc)
      const sortSelect = screen.getByDisplayValue('时间');
      fireEvent.change(sortSelect, { target: { value: 'eventName' } });

      await waitFor(() => {
        expect(screen.getByText('↑ 升序')).toBeInTheDocument();
      });

      // Switch to block number (should default to desc)
      fireEvent.change(sortSelect, { target: { value: 'blockNumber' } });

      await waitFor(() => {
        expect(screen.getByText('↓ 降序')).toBeInTheDocument();
      });
    });
  });

  describe('Sort Performance with Different Data Sizes', () => {
    it('should handle small datasets efficiently', () => {
      const smallDataset = mockEvents.slice(0, 5);

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={smallDataset}
          enableClientSideSort={true}
        />
      );

      expect(screen.getByText(/性能:/)).toBeInTheDocument();
    });

    it('should handle medium datasets with optimization', () => {
      const mediumDataset = Array.from({ length: 1500 }, (_, i) => ({
        ...mockEvents[0],
        blockNumber: 18000000 + i,
        transactionHash: `0x${(1000 + i).toString(16).padStart(64, '0')}`,
      }));

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mediumDataset}
          enableClientSideSort={true}
          clientSideSortThreshold={2000}
        />
      );

      expect(screen.getByText(/性能:/)).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle sorting errors gracefully', () => {
      // Mock a sorting error
      vi.doMock('../../../utils/sorting-optimization', () => ({
        optimizedSort: vi.fn().mockImplementation(() => {
          throw new Error('Sorting failed');
        }),
        sortingPerformanceMonitor: {
          recordMetrics: vi.fn(),
          getAverageMetrics: vi.fn().mockReturnValue({}),
          getMetricsByAlgorithm: vi.fn().mockReturnValue({}),
          clear: vi.fn()
        }
      }));

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />
      );

      // Component should still render without crashing
      expect(screen.getByText('排序:')).toBeInTheDocument();
    });
  });
});