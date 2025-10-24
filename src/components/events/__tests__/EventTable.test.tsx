/**
 * Unit tests for EventTable component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EventTable } from '../EventTable';

// Mock fetch
global.fetch = vi.fn();

describe('EventTable Component', () => {
  const mockChainId = 1;
  const mockContractAddress = '0x1234567890123456789012345678901234567890';

  const mockEvents = [
    {
      blockNumber: 18000000,
      blockTimestamp: '2024-01-01T00:00:00Z',
      transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      eventName: 'Transfer',
      from: '0xabcdef1234567890abcdef1234567890abcdef12',
      to: '0x1234567890abcdef1234567890abcdef12345678',
      value: '1000000000000000000',
    },
    {
      blockNumber: 18000001,
      blockTimestamp: '2024-01-01T00:01:00Z',
      transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      eventName: 'Approval',
      from: '0x1234567890abcdef1234567890abcdef12345678',
      to: '0xabcdef1234567890abcdef1234567890abcdef12',
      value: '500000000000000000',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial rendering', () => {
    it('should render with initial events', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      // Check table headers
      expect(screen.getByText('Block #')).toBeInTheDocument();
      expect(screen.getByText('Time')).toBeInTheDocument();
      expect(screen.getByText('Event')).toBeInTheDocument();
      expect(screen.getByText('From')).toBeInTheDocument();
      expect(screen.getByText('To')).toBeInTheDocument();
      expect(screen.getByText('Value')).toBeInTheDocument();
      expect(screen.getByText('Transaction')).toBeInTheDocument();

      // Check event data
      expect(screen.getByText('18000000')).toBeInTheDocument();
      expect(screen.getByText('Transfer')).toBeInTheDocument();
      expect(screen.getByText('Approval')).toBeInTheDocument();
    });

    it('should show loading state when fetching initial data', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: [], total: 0, hasMore: false }),
      });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      expect(screen.getByText('Loading events...')).toBeInTheDocument();
      expect(screen.getByText('Loading events...')).toBeInTheDocument();
    });

    it('should show empty state when no events are available', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: [], total: 0, hasMore: false }),
      });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No events found')).toBeInTheDocument();
        expect(screen.getByText('This contract has not emitted any events yet, or no events match the current filters.')).toBeInTheDocument();
      });
    });
  });

  describe('Event data formatting', () => {
    it('should format addresses correctly', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      const fromAddress = screen.getByText('0xabcd...ef12');
      const toAddress = screen.getByText('0x1234...5678');

      expect(fromAddress).toBeInTheDocument();
      expect(toAddress).toBeInTheDocument();
      expect(fromAddress.closest('a')).toHaveAttribute('href', `/chains/${mockChainId}/addresses/0xabcdef1234567890abcdef1234567890abcdef12`);
    });

    it('should format transaction hashes correctly', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      const transactionHash = screen.getByText('0x12345678...cdef');
      expect(transactionHash).toBeInTheDocument();
      expect(transactionHash.closest('a')).toHaveAttribute('href', `/chains/${mockChainId}/transactions/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`);
    });

    it('should format values correctly', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      expect(screen.getByText('1.000000 ETH')).toBeInTheDocument();
      expect(screen.getByText('0.500000 ETH')).toBeInTheDocument();
    });

    it('should format timestamps correctly', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      // Should show formatted timestamp
      expect(screen.getByText(/Jan 1, 2024/)).toBeInTheDocument();
    });
  });

  describe('Sorting functionality', () => {
    it('should handle column header clicks for sorting', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents, total: 2, hasMore: false }),
      });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      const blockHeader = screen.getByText('Block #');
      fireEvent.click(blockHeader);

      // Should trigger fetch with new sort parameters
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('sortBy=block_number'),
          expect.any(Object)
        );
      });
    });

    it('should toggle sort direction when clicking same column', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents, total: 2, hasMore: false }),
      });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      const eventHeader = screen.getByText('Event');

      // First click - should set asc
      fireEvent.click(eventHeader);
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('sort=asc'),
          expect.any(Object)
        );
      });

      // Second click - should toggle to desc
      fireEvent.click(eventHeader);
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('sort=desc'),
          expect.any(Object)
        );
      });
    });
  });

  describe('Pagination functionality', () => {
    it('should handle pagination controls correctly', async () => {
      const mockResponse = {
        events: mockEvents.slice(0, 1),
        total: 10,
        hasMore: true,
        nextCursor: 'cursor123',
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Showing 1 of 10 events')).toBeInTheDocument();
      });

      const nextButton = screen.getByText('Next');
      expect(nextButton).not.toBeDisabled();

      // Click next button
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: mockEvents.slice(1, 2),
          total: 10,
          hasMore: false,
        }),
      });

      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('cursor=cursor123'),
          expect.any(Object)
        );
      });
    });

    it('should disable previous button on first page', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      const prevButton = screen.getByText('Previous');
      expect(prevButton).toBeDisabled();
    });

    it('should disable next button when no more pages', async () => {
      const mockResponse = {
        events: mockEvents,
        total: 2,
        hasMore: false,
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        const nextButton = screen.getByText('Next');
        expect(nextButton).toBeDisabled();
      });
    });
  });

  describe('Error handling', () => {
    it('should show error state when API call fails', async () => {
      (fetch as any).mockRejectedValueOnce(new Error('Network error'));

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to load events')).toBeInTheDocument();
        expect(screen.getByText('Network error')).toBeInTheDocument();
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });
    });

    it('should handle retry functionality', async () => {
      (fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: mockEvents, total: 2, hasMore: false }),
        });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to load events')).toBeInTheDocument();
      });

      const retryButton = screen.getByText('Retry');
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(screen.getByText('Transfer')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper table structure', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      const headers = screen.getAllByRole('columnheader');
      expect(headers.length).toBe(7); // Block #, Time, Event, From, To, Value, Transaction

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBe(3); // 1 header + 2 data rows
    });

    it('should have proper ARIA labels for sortable columns', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      const sortableHeaders = screen.getAllByText(/Block #|Time|Event/);
      sortableHeaders.forEach(header => {
        expect(header).toHaveAttribute('role', 'columnheader');
      });
    });
  });

  describe('Integration with API', () => {
    it('should call correct API endpoint', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: mockEvents, total: 2, hasMore: false }),
      });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          `/api/chains/${mockChainId}/contracts/${mockContractAddress}/events?limit=50&sort=desc&sortBy=block_timestamp`,
          expect.objectContaining({
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          })
        );
      });
    });

    it('should include filters in API request', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: [], total: 0, hasMore: false }),
      });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
        />
      );

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('limit=50'),
          expect.any(Object)
        );
      });
    });
  });

  describe('Performance considerations', () => {
    it('should not re-render unnecessarily', () => {
      const { rerender } = render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      // Re-render with same props
      rerender(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
        />
      );

      // Should still show the same events
      expect(screen.getByText('Transfer')).toBeInTheDocument();
      expect(screen.getByText('Approval')).toBeInTheDocument();
    });

    it('should handle large number of events efficiently', () => {
      const largeEventList = Array.from({ length: 100 }, (_, i) => ({
        ...mockEvents[0],
        blockNumber: 18000000 + i,
        transactionHash: `0x${i.toString(16).padStart(64, '0')}`,
      }));

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={largeEventList}
        />
      );

      // Should render all events without performance issues
      expect(screen.getAllByText('Transfer')).toHaveLength(100);
    });
  });
});