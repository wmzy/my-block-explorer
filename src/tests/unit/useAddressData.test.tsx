import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAddressData } from '@/hooks/useAddressData';
import { getRealTimeAddressData } from '@/utils/realTimeData';

// Mock dependencies
vi.mock('@/utils/realTimeData');

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useAddressData', () => {
  const testChainId = 1;
  const testAddress = '0x1234567890123456789012345678901234567890';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useAddressData(testChainId, testAddress));

      expect(result.current.persistent).toBeNull();
      expect(result.current.realTime).toBeNull();
      expect(result.current.loading.persistent).toBe(true);
      expect(result.current.loading.realTime).toBe(true);
      expect(result.current.error.persistent).toBeNull();
      expect(result.current.error.realTime).toBeNull();
    });
  });

  describe('successful data fetching', () => {
    beforeEach(() => {
      // Mock successful persistent data fetch
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          isContract: true,
          contractName: 'TestContract',
          verificationStatus: 'verified',
          sourceCodeAvailable: true,
        }),
      });

      // Mock successful real-time data fetch
      vi.mocked(getRealTimeAddressData).mockResolvedValue({
        balance: '1.0',
        balanceWei: '1000000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      });
    });

    it('should fetch both persistent and real-time data successfully', async () => {
      const { result } = renderHook(() => useAddressData(testChainId, testAddress));

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
        expect(result.current.loading.realTime).toBe(false);
      });

      expect(result.current.persistent).toEqual({
        isContract: true,
        contractName: 'TestContract',
        verificationStatus: 'verified',
        sourceCodeAvailable: true,
      });

      expect(result.current.realTime).toEqual({
        balance: '1.0',
        balanceWei: '1000000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      });

      expect(result.current.error.persistent).toBeNull();
      expect(result.current.error.realTime).toBeNull();
    });

    it('should call correct API endpoints', async () => {
      renderHook(() => useAddressData(testChainId, testAddress));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/chains/${testChainId}/addresses/${testAddress}/persistent`,
        );
        expect(getRealTimeAddressData).toHaveBeenCalledWith(testChainId, testAddress);
      });
    });
  });

  describe('error handling', () => {
    it('should handle persistent data fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent data fetch failed'));
      vi.mocked(getRealTimeAddressData).mockResolvedValue({
        balance: '1.0',
        balanceWei: '1000000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      });

      const { result } = renderHook(() => useAddressData(testChainId, testAddress));

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
        expect(result.current.loading.realTime).toBe(false);
      });

      expect(result.current.persistent).toBeNull();
      expect(result.current.realTime).not.toBeNull();
      expect(result.current.error.persistent).toBe('Persistent data fetch failed');
      expect(result.current.error.realTime).toBeNull();
    });

    it('should handle real-time data fetch error', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          isContract: false,
        }),
      });
      vi.mocked(getRealTimeAddressData).mockRejectedValue(new Error('Real-time data fetch failed'));

      const { result } = renderHook(() => useAddressData(testChainId, testAddress));

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
        expect(result.current.loading.realTime).toBe(false);
      });

      expect(result.current.persistent).not.toBeNull();
      expect(result.current.realTime).toBeNull();
      expect(result.current.error.persistent).toBeNull();
      expect(result.current.error.realTime).toBe('Real-time data fetch failed');
    });

    it('should handle both data fetch errors', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent error'));
      vi.mocked(getRealTimeAddressData).mockRejectedValue(new Error('Real-time error'));

      const { result } = renderHook(() => useAddressData(testChainId, testAddress));

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
        expect(result.current.loading.realTime).toBe(false);
      });

      expect(result.current.persistent).toBeNull();
      expect(result.current.realTime).toBeNull();
      expect(result.current.error.persistent).toBe('Persistent error');
      expect(result.current.error.realTime).toBe('Real-time error');
    });

    it('should handle HTTP error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { result } = renderHook(() => useAddressData(testChainId, testAddress));

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
      });

      expect(result.current.error.persistent).toContain('HTTP 404: Not Found');
    });

    it('should handle API error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          error: 'Address not found',
        }),
      });

      const { result } = renderHook(() => useAddressData(testChainId, testAddress));

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
      });

      expect(result.current.error.persistent).toBe('Address not found');
    });
  });

  describe('parameter changes', () => {
    it('should refetch data when chainId changes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isContract: false }),
      });
      vi.mocked(getRealTimeAddressData).mockResolvedValue({
        balance: '1.0',
        balanceWei: '1000000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      });

      const { result, rerender } = renderHook(
        ({ chainId, address }) => useAddressData(chainId, address),
        {
          initialProps: { chainId: 1, address: testAddress },
        },
      );

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
      });

      // Clear mock calls
      vi.clearAllMocks();

      // Change chainId
      rerender({ chainId: 137, address: testAddress });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/chains/137/addresses/${testAddress}/persistent`,
        );
        expect(getRealTimeAddressData).toHaveBeenCalledWith(137, testAddress);
      });
    });

    it('should refetch data when address changes', async () => {
      const newAddress = '0x9876543210987654321098765432109876543210';

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isContract: false }),
      });
      vi.mocked(getRealTimeAddressData).mockResolvedValue({
        balance: '1.0',
        balanceWei: '1000000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      });

      const { result, rerender } = renderHook(
        ({ chainId, address }) => useAddressData(chainId, address),
        {
          initialProps: { chainId: testChainId, address: testAddress },
        },
      );

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
      });

      // Clear mock calls
      vi.clearAllMocks();

      // Change address
      rerender({ chainId: testChainId, address: newAddress });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/chains/${testChainId}/addresses/${newAddress}/persistent`,
        );
        expect(getRealTimeAddressData).toHaveBeenCalledWith(testChainId, newAddress);
      });
    });

    it('should reset state when parameters change', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isContract: true }),
      });
      vi.mocked(getRealTimeAddressData).mockResolvedValue({
        balance: '1.0',
        balanceWei: '1000000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      });

      const { result, rerender } = renderHook(
        ({ chainId, address }) => useAddressData(chainId, address),
        {
          initialProps: { chainId: testChainId, address: testAddress },
        },
      );

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
        expect(result.current.persistent).not.toBeNull();
      });

      // Change parameters - should reset state
      rerender({ chainId: 137, address: testAddress });

      // State should be reset immediately
      expect(result.current.persistent).toBeNull();
      expect(result.current.realTime).toBeNull();
      expect(result.current.loading.persistent).toBe(true);
      expect(result.current.loading.realTime).toBe(true);
      expect(result.current.error.persistent).toBeNull();
      expect(result.current.error.realTime).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty chainId', () => {
      const { result } = renderHook(() => useAddressData(0, testAddress));

      // Should not make any API calls
      expect(mockFetch).not.toHaveBeenCalled();
      expect(getRealTimeAddressData).not.toHaveBeenCalled();
    });

    it('should handle empty address', () => {
      const { result } = renderHook(() => useAddressData(testChainId, ''));

      // Should not make any API calls
      expect(mockFetch).not.toHaveBeenCalled();
      expect(getRealTimeAddressData).not.toHaveBeenCalled();
    });

    it('should handle concurrent requests', async () => {
      let resolveCount = 0;
      mockFetch.mockImplementation(() => {
        resolveCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ isContract: false, requestId: resolveCount }),
        });
      });

      vi.mocked(getRealTimeAddressData).mockImplementation(() => {
        return Promise.resolve({
          balance: '1.0',
          balanceWei: '1000000000000000000',
          transactionCount: 42,
          latestBlock: 18000000,
        });
      });

      const { result, rerender } = renderHook(
        ({ chainId, address }) => useAddressData(chainId, address),
        {
          initialProps: { chainId: 1, address: testAddress },
        },
      );

      // Quickly change address to trigger concurrent requests
      rerender({ chainId: 1, address: '0x9876543210987654321098765432109876543210' });

      await waitFor(() => {
        expect(result.current.loading.persistent).toBe(false);
      });

      // Should only have the latest request result
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
