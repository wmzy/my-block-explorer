/**
 * Integration tests for advanced search endpoint
 * Tests: T028 - Advanced search API integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../../../src/api-app';
import { initializeMultiChainEnvironment } from '../../../src/database/multi-chain-setup';
import { EventIndexingService } from '../../../src/services/EventIndexingService';
import { EventQueryService } from '../../../src/services/EventQueryService';

describe('Advanced Search API Integration', () => {
  const chainId = 1; // Ethereum mainnet
  const contractAddress = '0x1234567890123456789012345678901234567890';
  let eventIndexingService: EventIndexingService;
  let eventQueryService: EventQueryService;

  beforeAll(async () => {
    // Initialize test environment
    await initializeMultiChainEnvironment({
      environment: 'test',
      chains: [chainId],
      createDataDirectories: true,
    });

    // Initialize services
    eventIndexingService = new EventIndexingService(chainId);
    eventQueryService = new EventQueryService(chainId);

    // Setup test data
    await setupTestData();
  });

  afterAll(async () => {
    // Cleanup test environment
    await eventIndexingService.cleanupTestData(contractAddress);
  });

  const setupTestData = async () => {
    // Create test events with various parameters
    const testAbi = [
      {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { name: 'from', type: 'address', indexed: true },
          { name: 'to', type: 'address', indexed: false },
          { name: 'value', type: 'uint256', indexed: false },
        ],
      },
      {
        type: 'event',
        name: 'Approval',
        inputs: [
          { name: 'owner', type: 'address', indexed: true },
          { name: 'spender', type: 'address', indexed: true },
          { name: 'value', type: 'uint256', indexed: false },
        ],
      },
      {
        type: 'event',
        name: 'TransferFrom',
        inputs: [
          { name: 'sender', type: 'address', indexed: true },
          { name: 'from', type: 'address', indexed: false },
          { name: 'to', type: 'address', indexed: false },
          { name: 'value', type: 'uint256', indexed: false },
        ],
      },
    ];

    // Initialize event indexing
    await eventIndexingService.initializeContractEvents(contractAddress, testAbi);

    // Insert test event data
    const testEvents = [
      {
        blockNumber: 18000000,
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        transactionIndex: 0,
        logIndex: 0,
        blockTimestamp: new Date('2024-01-01T00:00:00Z'),
        contractAddress,
        eventName: 'Transfer',
        eventSignature: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: '0xabcdef1234567890abcdef1234567890abcdef12',
        value: '1000000000000000000',
      },
      {
        blockNumber: 18000001,
        blockHash: '0x2345678901bcdef1234567890abcdef1234567890bcdef1234567890abcdef1234',
        transactionHash: '0xbcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
        transactionIndex: 1,
        logIndex: 0,
        blockTimestamp: new Date('2024-01-01T00:01:00Z'),
        contractAddress,
        eventName: 'Approval',
        eventSignature: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
        owner: '0x1234567890abcdef1234567890abcdef12345678',
        spender: '0xabcdef1234567890abcdef1234567890abcdef12',
        value: '500000000000000000',
      },
      {
        blockNumber: 18000002,
        blockHash: '0x3456789012cdef1234567890bcdef1234567890cdef1234567890bcdef12345678',
        transactionHash: '0xcdef1234567890bcdef1234567890cdef1234567890bcdef1234567890abcdef1234',
        transactionIndex: 0,
        logIndex: 0,
        blockTimestamp: new Date('2024-01-01T00:02:00Z'),
        contractAddress,
        eventName: 'TransferFrom',
        eventSignature: '0x15d40e3c8b0a4f7c6b7e8a9d0c1b2a3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
        sender: '0x1234567890abcdef1234567890abcdef12345678',
        from: '0xabcdef1234567890abcdef1234567890abcdef12',
        to: '0x5678901234567890abcdef1234567890abcdef12',
        value: '2000000000000000000',
      },
    ];

    // Insert test events using the event indexing service
    for (const event of testEvents) {
      await eventIndexingService.indexSingleEvent(event);
    }
  };

  describe('POST /api/chains/{chainId}/contracts/{contractAddress}/events/search', () => {
    it('should handle complex filtering with multiple parameters', async () => {
      const searchRequest = {
        filters: {
          eventName: ['Transfer', 'TransferFrom'],
          fromBlock: '18000000',
          toBlock: '18000002',
        },
        pagination: {
          limit: 10,
          offset: 0,
        },
        sort: {
          field: 'blockNumber',
          direction: 'desc',
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('events');
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('hasMore');
      expect(data).toHaveProperty('pagination');
      expect(data).toHaveProperty('executionTime');

      expect(data.events).toBeInstanceOf(Array);
      expect(data.events.length).toBeGreaterThan(0);
      expect(data.total).toBeGreaterThan(0);

      // Verify sorting
      if (data.events.length > 1) {
        expect(data.events[0].blockNumber).toBeGreaterThanOrEqual(data.events[1].blockNumber);
      }
    });

    it('should handle value range filtering', async () => {
      const searchRequest = {
        filters: {
          eventName: 'Transfer',
          value: {
            gte: '500000000000000000', // 0.5 ETH
            lte: '2000000000000000000', // 2 ETH
          },
        },
        pagination: {
          limit: 10,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.length).toBeGreaterThan(0);

      // Verify value filtering
      data.events.forEach((event: any) => {
        expect(event.eventName).toBe('Transfer');
        const value = BigInt(event.value);
        expect(value).toBeGreaterThanOrEqual(BigInt('500000000000000000'));
        expect(value).toBeLessThanOrEqual(BigInt('2000000000000000000'));
      });
    });

    it('should handle address filtering with multiple addresses', async () => {
      const searchRequest = {
        filters: {
          eventName: ['Transfer', 'Approval', 'TransferFrom'],
          addresses: {
            from: ['0x1234567890abcdef1234567890abcdef12345678'],
            to: ['0xabcdef1234567890abcdef1234567890abcdef12'],
          },
        },
        pagination: {
          limit: 50,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.length).toBeGreaterThan(0);

      // Verify address filtering
      data.events.forEach((event: any) => {
        const validFrom = event.from === '0x1234567890abcdef1234567890abcdef12345678';
        const validTo = event.to === '0xabcdef1234567890abcdef1234567890abcdef12';
        expect(validFrom || validTo).toBe(true);
      });
    });

    it('should handle timestamp range filtering', async () => {
      const searchRequest = {
        filters: {
          fromTimestamp: '2024-01-01T00:00:00Z',
          toTimestamp: '2024-01-01T00:02:00Z',
        },
        pagination: {
          limit: 10,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.length).toBeGreaterThan(0);

      // Verify timestamp filtering
      data.events.forEach((event: any) => {
        const eventTime = new Date(event.blockTimestamp);
        expect(eventTime.getTime()).toBeGreaterThanOrEqual(new Date('2024-01-01T00:00:00Z').getTime());
        expect(eventTime.getTime()).toBeLessThanOrEqual(new Date('2024-01-01T00:02:00Z').getTime());
      });
    });

    it('should handle transaction hash filtering', async () => {
      const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

      const searchRequest = {
        filters: {
          transactionHash: txHash,
        },
        pagination: {
          limit: 10,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.length).toBe(1);
      expect(data.events[0].transactionHash).toBe(txHash);
    });

    it('should handle text search with case-insensitive matching', async () => {
      const searchRequest = {
        filters: {
          eventName: {
            like: 'transfer',
            caseInsensitive: true,
          },
        },
        pagination: {
          limit: 10,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.length).toBeGreaterThan(0);

      // Should match both 'Transfer' and 'TransferFrom'
      const eventNames = data.events.map((event: any) => event.eventName);
      expect(eventNames.some((name: string) => name.toLowerCase().includes('transfer'))).toBe(true);
    });

    it('should handle complex sorting with multiple fields', async () => {
      const searchRequest = {
        filters: {},
        pagination: {
          limit: 10,
        },
        sort: [
          { field: 'eventName', direction: 'asc' },
          { field: 'blockNumber', direction: 'desc' },
        ],
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.length).toBeGreaterThan(0);

      // Verify complex sorting
      for (let i = 1; i < data.events.length; i++) {
        const prev = data.events[i - 1];
        const curr = data.events[i];

        if (prev.eventName !== curr.eventName) {
          expect(prev.eventName <= curr.eventName).toBe(true);
        } else {
          expect(prev.blockNumber >= curr.blockNumber).toBe(true);
        }
      }
    });

    it('should handle cursor-based pagination', async () => {
      // First request to get cursor
      const firstRequest = {
        filters: {},
        pagination: {
          limit: 1,
        },
      };

      const firstResponse = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(firstRequest),
        }
      );

      expect(firstResponse.status).toBe(200);
      const firstData = await firstResponse.json();

      if (firstData.events.length > 0 && firstData.nextCursor) {
        // Second request using cursor
        const secondRequest = {
          filters: {},
          pagination: {
            limit: 1,
            cursor: firstData.nextCursor,
          },
        };

        const secondResponse = await app.request(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(secondRequest),
          }
        );

        expect(secondResponse.status).toBe(200);
        const secondData = await secondResponse.json();

        // Should get different results
        expect(secondData.events.length).toBeGreaterThan(0);
        expect(secondData.events[0]).not.toEqual(firstData.events[0]);
      }
    });

    it('should return search suggestions for empty results', async () => {
      const searchRequest = {
        filters: {
          eventName: 'NonExistentEvent',
        },
        pagination: {
          limit: 10,
        },
        includeSuggestions: true,
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.suggestions).toBeDefined();
      expect(data.suggestions.length).toBeGreaterThan(0);
      expect(data.suggestions).toContain('Try removing some filters');
      expect(data.suggestions).toContain('Check if the contract has emitted events');
    });

    it('should validate search request parameters', async () => {
      const invalidRequest = {
        filters: {
          fromBlock: 'invalid',
          toBlock: 'also_invalid',
        },
        pagination: {
          limit: -1,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(invalidRequest),
        }
      );

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Invalid parameters');
      expect(data.errors).toBeDefined();
      expect(data.errors.length).toBeGreaterThan(0);
    });

    it('should include performance metrics in response', async () => {
      const searchRequest = {
        filters: {},
        pagination: {
          limit: 10,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('executionTime');
      expect(data).toHaveProperty('cacheHit');
      expect(data).toHaveProperty('indexesUsed');
      expect(typeof data.executionTime).toBe('number');
      expect(data.executionTime).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON requests', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: 'invalid json',
        }
      );

      expect(response.status).toBe(400);
    });

    it('should handle missing request body', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(response.status).toBe(400);
    });

    it('should handle database connection errors gracefully', async () => {
      // This test would require mocking database errors
      // For now, verify the endpoint structure is correct
      const searchRequest = {
        filters: {},
        pagination: { limit: 1 },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        }
      );

      // Should not return 500 for normal operation
      expect(response.status).not.toBe(500);
    });
  });
});