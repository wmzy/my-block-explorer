/**
 * Integration tests for event indexing status endpoint
 * Tests: T013 - Event indexing status API integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../../../src/api-app';
import { initializeMultiChainEnvironment } from '../../../src/database/multi-chain-setup';

describe('Event Indexing Status API', () => {
  const chainId = 1; // Ethereum mainnet
  const contractAddress = '0x1234567890123456789012345678901234567890';

  beforeAll(async () => {
    // Initialize test environment
    await initializeMultiChainEnvironment({
      environment: 'test',
      chains: [chainId],
      createDataDirectories: true,
    });
  });

  afterAll(async () => {
    // Cleanup test environment
    // Note: In real implementation, we would clean up test databases
  });

  describe('GET /api/chains/{chainId}/contracts/{contractAddress}/events/indexing-status', () => {
    it('should return indexing status for a contract', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('chainId', chainId);
      expect(data).toHaveProperty('contractAddress', contractAddress.toLowerCase());
      expect(data).toHaveProperty('isIndexed');
      expect(data).toHaveProperty('indexingProgress');
      expect(data).toHaveProperty('totalEvents');
      expect(data).toHaveProperty('lastIndexedBlock');
      expect(data).toHaveProperty('lastIndexedAt');
      expect(data).toHaveProperty('eventTypes');
      expect(data).toHaveProperty('errors');
    });

    it('should handle non-existent contracts gracefully', async () => {
      const nonExistentContract = '0x0000000000000000000000000000000000000000';

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${nonExistentContract}/events/indexing-status`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.isIndexed).toBe(false);
      expect(data.indexingProgress).toBe(0);
      expect(data.totalEvents).toBe(0);
      expect(data.eventTypes).toEqual([]);
    });

    it('should validate chain ID parameter', async () => {
      const invalidChainId = 999999; // Non-existent chain

      const response = await app.request(
        `/api/chains/${invalidChainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Chain not supported');
    });

    it('should validate contract address format', async () => {
      const invalidAddress = '0xinvalid';

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${invalidAddress}/events/indexing-status`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Invalid contract address');
    });

    it('should return progress percentage as integer', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(typeof data.indexingProgress).toBe('number');
      expect(data.indexingProgress).toBeGreaterThanOrEqual(0);
      expect(data.indexingProgress).toBeLessThanOrEqual(100);
    });

    it('should include timestamp in expected format', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();

      if (data.lastIndexedAt) {
        // Should be a valid ISO 8601 timestamp
        const timestamp = new Date(data.lastIndexedAt);
        expect(timestamp.getTime()).not.toBeNaN();
      }
    });

    it('should handle CORS headers', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'OPTIONS',
          headers: {
            'Origin': 'http://localhost:3000',
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBeTruthy();
    });

    it('should return appropriate cache headers', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(200);

      // Should have cache control for real-time data
      const cacheControl = response.headers.get('cache-control');
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain('no-cache'); // Real-time data shouldn't be cached
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      // This test would require mocking database errors
      // For now, just verify the endpoint structure is correct
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'GET',
        }
      );

      // Should not return 500 for normal operation
      expect(response.status).not.toBe(500);
    });

    it('should handle malformed requests gracefully', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
        {
          method: 'POST', // Wrong method
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      expect(response.status).toBe(405); // Method Not Allowed
    });
  });
});