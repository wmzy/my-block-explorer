/**
 * Integration tests for sorting and pagination API endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '@/api-app';

// Mock the EventIndexingService to avoid database access
vi.mock('@/services/EventIndexingService', () => ({
  addIndexingRange: vi.fn(),
  getIndexingRanges: vi.fn().mockResolvedValue([]),
  updateIndexingRange: vi.fn(),
  deleteIndexingRange: vi.fn(),
  startIndexingRange: vi.fn(),
  pauseIndexingRange: vi.fn(),
  resumeIndexingRange: vi.fn(),
  getActiveRangeJob: vi.fn().mockReturnValue(false),
  getContractEvents: vi.fn().mockResolvedValue({
    events: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
  }),
  getEventStatistics: vi.fn().mockResolvedValue({ totalEvents: 0, eventTypes: [] }),
  getIndexingStatus: vi.fn().mockResolvedValue({
    chainId: 1,
    contractAddress: '0x1234567890123456789012345678901234567890',
    status: 'idle',
    creationBlock: 0,
    lastIndexedBlock: 0,
    latestBlock: 0,
    lastFinalizedBlock: 0,
    totalEventsIndexed: 0,
    eventTypes: [],
  }),
  updateRangeStatus: vi.fn(),
}));

describe('Sorting and Pagination API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/chains/:chainId/contracts/:address/events', () => {
    const chainId = 1;
    const contractAddress = '0x1234567890123456789012345678901234567890';

    it('should return paginated events with default settings', async () => {
      const res = await app.request(`/api/chains/${chainId}/contracts/${contractAddress}/events`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        chainId,
        chainName: expect.any(String),
        contractAddress: contractAddress.toLowerCase(),
        events: expect.any(Array),
        total: expect.any(Number),
        page: expect.any(Number),
        pageSize: expect.any(Number),
        totalPages: expect.any(Number),
        timestamp: expect.any(String),
      });
    });

    it('should support custom page size', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?pageSize=20`,
      );
      expect(res.status).toBe(200);
    });

    it('should support event name filtering', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?eventName=Transfer`,
      );
      expect(res.status).toBe(200);
    });

    it('should support block range filtering', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?fromBlock=18000000&toBlock=18000100`,
      );
      expect(res.status).toBe(200);
    });

    it('should handle unsupported chain IDs', async () => {
      const res = await app.request(`/api/chains/99999/contracts/${contractAddress}/events`);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Unsupported chain');
    });

    it('should handle invalid contract addresses', async () => {
      const res = await app.request(`/api/chains/${chainId}/contracts/invalid-address/events`);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Invalid');
    });

    it('should return appropriate headers', async () => {
      const res = await app.request(`/api/chains/${chainId}/contracts/${contractAddress}/events`);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Data-Source')).toBe('database');
      expect(res.headers.get('X-Chain-Name')).toBe('Ethereum');
    });

    it('should validate pagination parameters gracefully', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=invalid`,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('Error handling', () => {
    const chainId = 1;
    const contractAddress = '0x1234567890123456789012345678901234567890';

    it('should handle malformed query parameters gracefully', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=abc&sort=invalid`,
      );
      expect(res.status).toBe(200);
    });

    it('should handle invalid contract addresses gracefully', async () => {
      const res = await app.request(`/api/chains/${chainId}/contracts/invalid-address/events`);
      expect(res.status).toBe(400);
    });

    it('should handle unsupported chain IDs gracefully', async () => {
      const res = await app.request(`/api/chains/99999/contracts/${contractAddress}/events`);
      expect(res.status).toBe(400);
    });
  });
});
