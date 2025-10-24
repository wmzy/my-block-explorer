/**
 * Unit tests for EventStatistics component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EventStatistics } from '../EventStatistics';

// Mock fetch
global.fetch = vi.fn();

describe('EventStatistics Component', () => {
  const mockChainId = 1;
  const mockContractAddress = '0x1234567890123456789012345678901234567890';

  const mockIndexingStats = {
    chainId: mockChainId,
    contractAddress: mockContractAddress,
    isIndexed: true,
    indexingProgress: 75,
    totalEvents: 1000,
    indexedEvents: 750,
    lastIndexedBlock: 18000000,
    lastIndexedAt: '2024-01-01T00:00:00Z',
    eventTypes: ['Transfer', 'Approval', 'TransferFrom', 'Mint', 'Burn'],
    errors: [],
  };

  const mockTableStats = {
    totalEvents: 1000,
    eventsByType: {
      Transfer: 500,
      Approval: 300,
      TransferFrom: 150,
      Mint: 30,
      Burn: 20,
    },
    uniqueAddresses: 250,
    averageEventsPerBlock: 15.5,
    storageSize: 2048576, // 2MB
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial rendering', () => {
    it('should render loading state initially', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockIndexingStats,
      });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      expect(screen.getByText('Loading statistics...')).toBeInTheDocument();
    });

    it('should render statistics cards after data loads', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Indexing Progress')).toBeInTheDocument();
        expect(screen.getByText('Total Events')).toBeInTheDocument();
        expect(screen.getByText('Event Types')).toBeInTheDocument();
        expect(screen.getByText('Storage Statistics')).toBeInTheDocument();
        expect(screen.getByText('Query Performance')).toBeInTheDocument();
      });
    });

    it('should display correct values from API responses', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('75%')).toBeInTheDocument();
        expect(screen.getByText('750 / 1,000 events indexed')).toBeInTheDocument();
        expect(screen.getByText('1,000')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument(); // 5 event types
        expect(screen.getByText('2 MB')).toBeInTheDocument();
        expect(screen.getByText('1-9ms')).toBeInTheDocument();
      });
    });
  });

  describe('Indexing progress display', () => {
    it('should show progress bar with correct percentage', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        const progressBar = document.querySelector('[style*="width: 75%"]');
        expect(progressBar).toBeInTheDocument();
      });
    });

    it('should format last indexed timestamp correctly', async () => {
      const recentStats = {
        ...mockIndexingStats,
        lastIndexedAt: new Date(Date.now() - 5 * 60000).toISOString(), // 5 minutes ago
      };

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => recentStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
      });
    });

    it('should handle indexing errors display', async () => {
      const errorStats = {
        ...mockIndexingStats,
        errors: [
          { blockNumber: 17999999, error: 'RPC timeout', timestamp: '2024-01-01T00:00:00Z' },
          { blockNumber: 17999998, error: 'Invalid ABI', timestamp: '2024-01-01T00:00:00Z' },
        ],
      };

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => errorStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Indexing Errors:')).toBeInTheDocument();
        expect(screen.getByText('Block 17999999: RPC timeout')).toBeInTheDocument();
        expect(screen.getByText('Block 17999998: Invalid ABI')).toBeInTheDocument();
      });
    });
  });

  describe('Event types display', () => {
    it('should display event type tags', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Transfer')).toBeInTheDocument();
        expect(screen.getByText('Approval')).toBeInTheDocument();
        expect(screen.getByText('TransferFrom')).toBeInTheDocument();
      });
    });

    it('should truncate long event type lists', async () => {
      const manyEventTypes = {
        ...mockIndexingStats,
        eventTypes: Array.from({ length: 15 }, (_, i) => `Event${i}`),
      };

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => manyEventTypes,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('+5 more')).toBeInTheDocument();
      });
    });
  });

  describe('Storage statistics', () => {
    it('should format file sizes correctly', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...mockTableStats, storageSize: 1073741824 }), // 1GB
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('1 GB')).toBeInTheDocument();
      });
    });

    it('should display storage statistics correctly', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Unique addresses: 250')).toBeInTheDocument();
        expect(screen.getByText('Avg events per block: 15.50')).toBeInTheDocument();
      });
    });
  });

  describe('Refresh functionality', () => {
    it('should handle refresh button click', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...mockIndexingStats, indexingProgress: 80 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      const onRefresh = vi.fn();

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          onRefresh={onRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('75%')).toBeInTheDocument();
      });

      const refreshButton = screen.getByTitle('Refresh indexing status');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(4); // Initial 2 + refresh 2
        expect(onRefresh).toHaveBeenCalled();
      });
    });

    it('should disable refresh button while loading', async () => {
      (fetch as any).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          json: async () => mockIndexingStats,
        }), 100))
      );

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      const refreshButton = screen.getByTitle('Refresh indexing status');
      expect(refreshButton).toBeDisabled();
    });
  });

  describe('Error handling', () => {
    it('should show error state when API calls fail', async () => {
      (fetch as any).mockRejectedValue(new Error('Network error'));

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to load event statistics')).toBeInTheDocument();
        expect(screen.getByText('Network error')).toBeInTheDocument();
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });
    });

    it('should handle retry functionality', async () => {
      (fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to load event statistics')).toBeInTheDocument();
      });

      const retryButton = screen.getByText('Retry');
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(screen.getByText('Indexing Progress')).toBeInTheDocument();
      });
    });

    it('should handle partial data gracefully', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockRejectedValueOnce(new Error('Table stats failed'));

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        // Should still render indexing stats even if table stats fail
        expect(screen.getByText('Indexing Progress')).toBeInTheDocument();
        expect(screen.getByText('75%')).toBeInTheDocument();
        // Should show default values for missing table stats
        expect(screen.getByText('1,000')).toBeInTheDocument(); // From indexing stats
      });
    });
  });

  describe('API integration', () => {
    it('should call correct API endpoints', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          `/api/chains/${mockChainId}/contracts/${mockContractAddress}/events/indexing-status`,
          expect.objectContaining({
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          })
        );

        expect(fetch).toHaveBeenCalledWith(
          `/api/chains/${mockChainId}/contracts/${mockContractAddress}/events/statistics`,
          expect.objectContaining({
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          })
        );
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper semantic structure', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        const headings = screen.getAllByRole('heading', { level: 3 });
        expect(headings.length).toBeGreaterThan(0);
        expect(headings[0]).toHaveTextContent('Indexing Progress');
      });
    });

    it('should have accessible refresh button', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockIndexingStats,
      });

      render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        const refreshButton = screen.getByTitle('Refresh indexing status');
        expect(refreshButton).toBeInTheDocument();
      });
    });
  });

  describe('Performance considerations', () => {
    it('should not re-render unnecessarily', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIndexingStats,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTableStats,
        });

      const { rerender } = render(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Indexing Progress')).toBeInTheDocument();
      });

      // Re-render with same props
      rerender(
        <EventStatistics
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      // Should still show the same data
      expect(screen.getByText('75%')).toBeInTheDocument();
    });
  });
});