/**
 * Unit tests for EventTable pagination functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EventTable } from '../../../components/events/EventTable';
import { Address } from 'viem';

// Mock fetch globally
global.fetch = vi.fn();

describe('EventTable Pagination', () => {
  const mockChainId = 1;
  const mockContractAddress = '0x1234567890123456789012345678901234567890' as Address;

  const mockEvents = Array.from({ length: 100 }, (_, i) => ({
    blockNumber: 18000000 + i,
    blockTimestamp: new Date(Date.now() - i * 60000).toISOString(),
    transactionHash: `0x${(1000 + i).toString(16).padStart(64, '0')}`,
    eventName: 'Transfer',
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
        nextCursor: mockEvents[9].blockTimestamp,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Pagination Controls', () => {
    it('should render pagination controls', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents.slice(0, 50)}
          enableClientSideSort={true}
        />,
      );

      expect(screen.getByText(/显示第 \d+ - \d+ 条，共 \d+ 条事件/)).toBeInTheDocument();
      expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
      expect(screen.getByText('⇤')).toBeInTheDocument(); // First page
      expect(screen.getByText('⇥')).toBeInTheDocument(); // Last page
    });

    it('should show current page information', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents.slice(0, 50)}
          enableClientSideSort={true}
        />,
      );

      expect(screen.getByText('显示第 1 - 50 条，共 100 条事件')).toBeInTheDocument();
      expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    });

    it('should navigate to next page', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const nextButton = screen.getByText('→');
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('显示第 51 - 100 条，共 100 条事件')).toBeInTheDocument();
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });
    });

    it('should navigate to previous page', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      // Go to next page first
      const nextButton = screen.getByText('→');
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });

      // Then go back
      const prevButton = screen.getByText('←');
      fireEvent.click(prevButton);

      await waitFor(() => {
        expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
      });
    });

    it('should navigate to first page', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      // Go to last page first
      const lastButton = screen.getByText('⇥');
      fireEvent.click(lastButton);

      await waitFor(() => {
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });

      // Then go to first page
      const firstButton = screen.getByText('⇤');
      fireEvent.click(firstButton);

      await waitFor(() => {
        expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
      });
    });

    it('should navigate to last page', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const lastButton = screen.getByText('⇥');
      fireEvent.click(lastButton);

      await waitFor(() => {
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });
    });
  });

  describe('Page Size Controls', () => {
    it('should show page size selector when enabled', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          enableCustomPageSize={true}
        />,
      );

      expect(screen.getByText('每页显示:')).toBeInTheDocument();
      expect(screen.getByDisplayValue('50 条')).toBeInTheDocument();
    });

    it('should change page size when selection changes', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          enableCustomPageSize={true}
        />,
      );

      const pageSizeSelect = screen.getByDisplayValue('50 条');
      fireEvent.change(pageSizeSelect, { target: { value: '20' } });

      await waitFor(() => {
        expect(screen.getByText('显示第 1 - 20 条，共 100 条事件')).toBeInTheDocument();
        expect(screen.getByText('第 1 / 5 页')).toBeInTheDocument();
      });
    });

    it('should update page count when page size changes', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          enableCustomPageSize={true}
        />,
      );

      const pageSizeSelect = screen.getByDisplayValue('50 条');
      fireEvent.change(pageSizeSelect, { target: { value: '100' } });

      await waitFor(() => {
        expect(screen.getByText('显示第 1 - 100 条，共 100 条事件')).toBeInTheDocument();
        expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();
      });
    });

    it('should reset to first page when page size changes', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          enableCustomPageSize={true}
        />,
      );

      // Navigate to second page
      const nextButton = screen.getByText('→');
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });

      // Change page size
      const pageSizeSelect = screen.getByDisplayValue('50 条');
      fireEvent.change(pageSizeSelect, { target: { value: '20' } });

      await waitFor(() => {
        expect(screen.getByText('第 1 / 5 页')).toBeInTheDocument();
      });
    });
  });

  describe('Go to Page Functionality', () => {
    it('should show go to page controls for multi-page datasets', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      expect(screen.getByText('跳转到:')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('1')).toBeInTheDocument();
      expect(screen.getByText('确定')).toBeInTheDocument();
    });

    it('should navigate to specified page when valid input is provided', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const pageInput = screen.getByPlaceholderText('1');
      const goButton = screen.getByText('确定');

      fireEvent.change(pageInput, { target: { value: '2' } });
      fireEvent.click(goButton);

      await waitFor(() => {
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });
    });

    it('should handle Enter key in page input', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const pageInput = screen.getByPlaceholderText('1');

      fireEvent.change(pageInput, { target: { value: '2' } });
      fireEvent.keyPress(pageInput, { key: 'Enter', code: 'Enter', charCode: 13 });

      await waitFor(() => {
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });
    });

    it('should ignore invalid page numbers', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const pageInput = screen.getByPlaceholderText('1');
      const goButton = screen.getByText('确定');

      fireEvent.change(pageInput, { target: { value: '5' } }); // Invalid: only 2 pages exist
      fireEvent.click(goButton);

      // Should remain on current page
      await waitFor(() => {
        expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
      });
    });

    it('should ignore non-numeric input', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const pageInput = screen.getByPlaceholderText('1');
      const goButton = screen.getByText('确定');

      fireEvent.change(pageInput, { target: { value: 'abc' } });
      fireEvent.click(goButton);

      // Should remain on current page
      await waitFor(() => {
        expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
      });
    });

    it('should clear input after successful navigation', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const pageInput = screen.getByPlaceholderText('1');
      const goButton = screen.getByText('确定');

      fireEvent.change(pageInput, { target: { value: '2' } });
      fireEvent.click(goButton);

      await waitFor(() => {
        expect(pageInput).toHaveValue('');
      });
    });
  });

  describe('Button State Management', () => {
    it('should disable navigation buttons appropriately', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents.slice(0, 50)}
          enableClientSideSort={true}
        />,
      );

      // On first page
      expect(screen.getByText('⇤')).toBeDisabled();
      expect(screen.getByText('←')).toBeDisabled();
      expect(screen.getByText('→')).not.toBeDisabled();
      expect(screen.getByText('⇥')).not.toBeDisabled();
    });

    it('should disable next/last buttons on last page', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      // Navigate to last page
      const lastButton = screen.getByText('⇥');
      fireEvent.click(lastButton);

      await waitFor(() => {
        expect(screen.getByText('⇤')).not.toBeDisabled();
        expect(screen.getByText('←')).not.toBeDisabled();
        expect(screen.getByText('→')).toBeDisabled();
        expect(screen.getByText('⇥')).toBeDisabled();
      });
    });

    it('should disable go button when page input is empty', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const goButton = screen.getByText('确定');
      expect(goButton).toBeDisabled();
    });

    it('should enable go button when valid page input is provided', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const pageInput = screen.getByPlaceholderText('1');
      const goButton = screen.getByText('确定');

      fireEvent.change(pageInput, { target: { value: '2' } });
      expect(goButton).not.toBeDisabled();
    });
  });

  describe('Server-Side vs Client-Side Pagination', () => {
    it('should use client-side pagination for small datasets', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents.slice(0, 50)}
          enableClientSideSort={true}
          clientSideSortThreshold={100}
        />,
      );

      // Should show pagination controls for client-side
      expect(screen.getByText('显示第 1 - 50 条，共 50 条事件')).toBeInTheDocument();
    });

    it('should use server-side pagination for large datasets', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={[]} // Empty to trigger API call
          enableClientSideSort={false}
        />,
      );

      // Should make API call for server-side pagination
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.any(Object),
      );
    });

    it('should make API call with pagination parameters', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={[]} // Empty to trigger API call
          enableClientSideSort={false}
        />,
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('limit=50'),
          expect.any(Object),
        );
      });
    });

    it('should make API call when navigating pages in server-side mode', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            events: mockEvents.slice(0, 50),
            total: mockEvents.length,
            hasMore: true,
            nextCursor: mockEvents[49].blockTimestamp,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            events: mockEvents.slice(50, 100),
            total: mockEvents.length,
            hasMore: false,
            nextCursor: undefined,
          }),
        });

      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={[]} // Empty to trigger API call
          enableClientSideSort={false}
        />,
      );

      // Wait for initial load
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      // Navigate to next page
      const nextButton = screen.getByText('→');
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle single page datasets', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents.slice(0, 20)}
          enableClientSideSort={true}
          defaultPageSize={50}
        />,
      );

      expect(screen.getByText('显示第 1 - 20 条，共 20 条事件')).toBeInTheDocument();
      expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();
      expect(screen.getByText('→')).toBeDisabled();
      expect(screen.getByText('⇥')).toBeDisabled();
    });

    it('should handle empty datasets', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={[]}
          enableClientSideSort={true}
        />,
      );

      expect(screen.getByText('未找到事件')).toBeInTheDocument();
    });

    it('should handle very large page sizes', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
          enableCustomPageSize={true}
        />,
      );

      const pageSizeSelect = screen.getByDisplayValue('50 条');
      fireEvent.change(pageSizeSelect, { target: { value: '200' } });

      await waitFor(() => {
        expect(screen.getByText('显示第 1 - 100 条，共 100 条事件')).toBeInTheDocument();
        expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();
      });
    });

    it('should reset pagination when sort changes', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      // Navigate to second page
      const nextButton = screen.getByText('→');
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });

      // Change sort
      const directionButton = screen.getByText('↓ 降序');
      fireEvent.click(directionButton);

      await waitFor(() => {
        expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
      });
    });
  });

  describe('Pagination Info Display', () => {
    it('should show correct pagination info for different states', () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents.slice(0, 75)}
          enableClientSideSort={true}
          defaultPageSize={50}
        />,
      );

      expect(screen.getByText('显示第 1 - 50 条，共 75 条事件')).toBeInTheDocument();
      expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    });

    it('should update pagination info when navigating pages', async () => {
      render(
        <EventTable
          chainId={mockChainId}
          contractAddress={mockContractAddress}
          initialEvents={mockEvents}
          enableClientSideSort={true}
        />,
      );

      const nextButton = screen.getByText('→');
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('显示第 51 - 100 条，共 100 条事件')).toBeInTheDocument();
        expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
      });
    });
  });
});
