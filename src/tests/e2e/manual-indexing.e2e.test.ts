import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../api-app';

vi.mock('../../services/EventIndexingService', () => ({
  addIndexingRange: vi.fn(),
  getIndexingRanges: vi.fn(),
  updateIndexingRange: vi.fn(),
  deleteIndexingRange: vi.fn(),
  startIndexingRange: vi.fn(),
  pauseIndexingRange: vi.fn(),
  resumeIndexingRange: vi.fn(),
  getActiveRangeJob: vi.fn(),
  getContractEvents: vi
    .fn()
    .mockResolvedValue({ events: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }),
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
}));

vi.mock('../../services/ContractSourceService', () => ({
  ContractSourceService: class {
    getContractSource = vi.fn().mockResolvedValue({
      abi: JSON.stringify([
        {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { indexed: true, name: 'from', type: 'address' },
            { indexed: true, name: 'to', type: 'address' },
            { indexed: false, name: 'value', type: 'uint256' },
          ],
        },
      ]),
    });
  },
  contractSourceService: {
    getContractSource: vi.fn().mockResolvedValue({
      abi: JSON.stringify([
        {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { indexed: true, name: 'from', type: 'address' },
            { indexed: true, name: 'to', type: 'address' },
            { indexed: false, name: 'value', type: 'uint256' },
          ],
        },
      ]),
    }),
  },
}));

// Import mocked functions after vi.mock setup
import {
  addIndexingRange,
  getIndexingRanges,
  deleteIndexingRange,
  startIndexingRange,
  pauseIndexingRange,
  getActiveRangeJob,
} from '../../services/EventIndexingService';

type MockFunction = ReturnType<typeof vi.fn>;

const chainId = 1;
const contractAddress = '0x1234567890123456789012345678901234567890';
const baseUrl = `/api/chains/${chainId}/contracts/${contractAddress}/events`;

describe('Manual Range Indexing E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /ranges - Add new indexing range', () => {
    it('should add a new indexing range successfully', async () => {
      (addIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
        rangeId: 1,
        overlaps: [],
      });

      const response = await app.request(`${baseUrl}/ranges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromBlock: 18000000,
          toBlock: 18001000,
          direction: 'forward',
          priority: 1,
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.rangeId).toBe(1);
      expect(data.chainId).toBe(chainId);
      expect(data.contractAddress).toBe(contractAddress);
      expect(addIndexingRange).toHaveBeenCalledWith(chainId, contractAddress.toLowerCase(), {
        fromBlock: 18000000,
        toBlock: 18001000,
        direction: 'forward',
        priority: 1,
      });
    });

    it('should reject invalid block range (fromBlock >= toBlock)', async () => {
      (addIndexingRange as MockFunction).mockResolvedValueOnce({
        success: false,
        error: 'fromBlock must be less than toBlock',
      });

      const response = await app.request(`${baseUrl}/ranges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromBlock: 18001000,
          toBlock: 18000000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Failed to add indexing range');
      expect(data.message).toBe('fromBlock must be less than toBlock');
    });

    it('should reject missing required fields', async () => {
      const response = await app.request(`${baseUrl}/ranges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromBlock: 18000000,
          // missing toBlock
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request body');
    });

    it('should reject invalid chain ID', async () => {
      const invalidChainId = 999999;
      const response = await app.request(
        `/api/chains/${invalidChainId}/contracts/${contractAddress}/events/ranges`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromBlock: 18000000,
            toBlock: 18001000,
          }),
        },
      );

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('Unsupported chain');
    });

    it('should reject invalid contract address format', async () => {
      const invalidAddress = '0xinvalid';
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${invalidAddress}/events/ranges`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromBlock: 18000000,
            toBlock: 18001000,
          }),
        },
      );

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('Invalid address');
    });

    it('should report overlapping ranges', async () => {
      (addIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
        rangeId: 2,
        overlaps: [
          {
            rangeId: 1,
            fromBlock: 18000000,
            toBlock: 18000500,
            overlapStart: 18000000,
            overlapEnd: 18000500,
          },
        ],
      });

      const response = await app.request(`${baseUrl}/ranges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromBlock: 18000000,
          toBlock: 18001000,
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.overlaps).toHaveLength(1);
      expect(data.overlaps[0].rangeId).toBe(1);
    });
  });

  describe('POST /ranges/:rangeId/start - Start indexing', () => {
    it('should start indexing a range successfully', async () => {
      (startIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
      });

      const response = await app.request(`${baseUrl}/ranges/1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abi: [
            {
              type: 'event',
              name: 'Transfer',
              inputs: [
                { indexed: true, name: 'from', type: 'address' },
                { indexed: true, name: 'to', type: 'address' },
                { indexed: false, name: 'value', type: 'uint256' },
              ],
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('indexing');
      expect(data.rangeId).toBe(1);
    });

    it('should fetch ABI from ContractSourceService if not provided', async () => {
      (startIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
      });

      const response = await app.request(`${baseUrl}/ranges/1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('indexing');
    });

    it('should reject start when startIndexingRange fails with no ABI', async () => {
      (startIndexingRange as MockFunction).mockResolvedValueOnce({
        success: false,
        error: 'No ABI available',
      });

      const response = await app.request(`${baseUrl}/ranges/1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Failed to start indexing range');
      expect(data.message).toBe('No ABI available');
    });

    it('should reject start for already indexing range', async () => {
      (startIndexingRange as MockFunction).mockResolvedValueOnce({
        success: false,
        error: 'Range is already being indexed',
      });

      const response = await app.request(`${baseUrl}/ranges/1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abi: [{ type: 'event', name: 'Transfer', inputs: [] }],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Failed to start indexing range');
      expect(data.message).toBe('Range is already being indexed');
    });

    it('should reject start for completed range', async () => {
      (startIndexingRange as MockFunction).mockResolvedValueOnce({
        success: false,
        error: 'Range is already completed',
      });

      const response = await app.request(`${baseUrl}/ranges/1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abi: [{ type: 'event', name: 'Transfer', inputs: [] }],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toBe('Range is already completed');
    });

    it('should reject invalid rangeId format', async () => {
      const response = await app.request(`${baseUrl}/ranges/invalid/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abi: [] }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid rangeId');
    });
  });

  describe('GET /ranges - Get all ranges', () => {
    it('should return all indexing ranges for a contract', async () => {
      const mockRanges = [
        {
          chainId: 1,
          address: contractAddress,
          rangeId: 1,
          fromBlock: '18000000',
          toBlock: '18001000',
          direction: 'forward',
          currentBlock: '18000500',
          status: 'indexing',
          totalEventsIndexed: 100,
          priority: 1,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          chainId: 1,
          address: contractAddress,
          rangeId: 2,
          fromBlock: '18001000',
          toBlock: '18002000',
          direction: 'forward',
          currentBlock: null,
          status: 'pending',
          totalEventsIndexed: 0,
          priority: 0,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
      ];

      (getIndexingRanges as MockFunction).mockResolvedValueOnce(mockRanges);

      const response = await app.request(`${baseUrl}/ranges`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ranges).toHaveLength(2);
      expect(data.ranges[0].rangeId).toBe(1);
      expect(data.ranges[0].status).toBe('indexing');
      expect(data.ranges[1].status).toBe('pending');
    });

    it('should return empty array when no ranges exist', async () => {
      (getIndexingRanges as MockFunction).mockResolvedValueOnce([]);

      const response = await app.request(`${baseUrl}/ranges`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ranges).toEqual([]);
    });

    it('should include chain name in response headers', async () => {
      (getIndexingRanges as MockFunction).mockResolvedValueOnce([]);

      const response = await app.request(`${baseUrl}/ranges`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('X-Chain-Name')).toBe('Ethereum');
    });
  });

  describe('POST /ranges/:rangeId/pause - Pause indexing', () => {
    it('should pause an active indexing job', async () => {
      (getActiveRangeJob as MockFunction).mockReturnValueOnce(true);

      const response = await app.request(`${baseUrl}/ranges/1/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('paused');
      expect(data.rangeId).toBe(1);
      expect(pauseIndexingRange).toHaveBeenCalledWith(chainId, contractAddress.toLowerCase(), 1);
    });

    it('should reject pause when no active job exists', async () => {
      (getActiveRangeJob as MockFunction).mockReturnValueOnce(false);

      const response = await app.request(`${baseUrl}/ranges/1/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('No active indexing job');
      expect(data.message).toBe('Range is not currently being indexed');
    });

    it('should reject invalid rangeId format', async () => {
      const response = await app.request(`${baseUrl}/ranges/invalid/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid rangeId');
    });
  });

  describe('DELETE /ranges/:rangeId - Delete range', () => {
    it('should delete a pending range successfully', async () => {
      (deleteIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
      });

      const response = await app.request(`${baseUrl}/ranges/1`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.deleted).toBe(true);
      expect(data.rangeId).toBe(1);
      expect(deleteIndexingRange).toHaveBeenCalledWith(chainId, contractAddress.toLowerCase(), 1);
    });

    it('should reject delete when range is actively indexing', async () => {
      (deleteIndexingRange as MockFunction).mockResolvedValueOnce({
        success: false,
        error: 'Cannot delete range while indexing',
      });

      const response = await app.request(`${baseUrl}/ranges/1`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Failed to delete indexing range');
      expect(data.message).toBe('Cannot delete range while indexing');
    });

    it('should reject delete for non-existent range', async () => {
      (deleteIndexingRange as MockFunction).mockResolvedValueOnce({
        success: false,
        error: 'Range not found',
      });

      const response = await app.request(`${baseUrl}/ranges/999`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toBe('Range not found');
    });

    it('should reject invalid rangeId format', async () => {
      const response = await app.request(`${baseUrl}/ranges/invalid`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid rangeId');
    });
  });

  describe('Full indexing flow', () => {
    it('should complete full flow: add → start → pause → check status', async () => {
      (addIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
        rangeId: 1,
        overlaps: [],
      });

      const addResponse = await app.request(`${baseUrl}/ranges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromBlock: 18000000,
          toBlock: 18001000,
          direction: 'forward',
        }),
      });

      expect(addResponse.status).toBe(201);
      const addData = await addResponse.json();
      expect(addData.rangeId).toBe(1);

      (getIndexingRanges as MockFunction).mockResolvedValueOnce([
        {
          chainId: 1,
          address: contractAddress,
          rangeId: 1,
          fromBlock: '18000000',
          toBlock: '18001000',
          direction: 'forward',
          currentBlock: null,
          status: 'pending',
          totalEventsIndexed: 0,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const getResponse = await app.request(`${baseUrl}/ranges`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(getResponse.status).toBe(200);
      const getData = await getResponse.json();
      expect(getData.ranges).toHaveLength(1);
      expect(getData.ranges[0].status).toBe('pending');

      (startIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
      });

      const startResponse = await app.request(`${baseUrl}/ranges/1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abi: [{ type: 'event', name: 'Transfer', inputs: [] }],
        }),
      });

      expect(startResponse.status).toBe(200);
      const startData = await startResponse.json();
      expect(startData.status).toBe('indexing');

      (getActiveRangeJob as MockFunction).mockReturnValueOnce(true);

      const pauseResponse = await app.request(`${baseUrl}/ranges/1/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(pauseResponse.status).toBe(200);
      const pauseData = await pauseResponse.json();
      expect(pauseData.status).toBe('paused');
    });

    it('should complete full flow: add → start → complete → delete', async () => {
      (addIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
        rangeId: 1,
        overlaps: [],
      });

      const addResponse = await app.request(`${baseUrl}/ranges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromBlock: 18000000,
          toBlock: 18000100,
          direction: 'forward',
        }),
      });

      expect(addResponse.status).toBe(201);

      (startIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
      });

      const startResponse = await app.request(`${baseUrl}/ranges/1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abi: [{ type: 'event', name: 'Transfer', inputs: [] }],
        }),
      });

      expect(startResponse.status).toBe(200);

      (deleteIndexingRange as MockFunction).mockResolvedValueOnce({
        success: true,
      });

      const deleteResponse = await app.request(`${baseUrl}/ranges/1`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(deleteResponse.status).toBe(200);
      const deleteData = await deleteResponse.json();
      expect(deleteData.deleted).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle service errors gracefully', async () => {
      (addIndexingRange as MockFunction).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const response = await app.request(`${baseUrl}/ranges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromBlock: 18000000,
          toBlock: 18001000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Failed to add indexing range');
      expect(data.message).toBe('Database connection failed');
    });

    it('should handle concurrent range operations', async () => {
      (addIndexingRange as MockFunction)
        .mockResolvedValueOnce({ success: true, rangeId: 1 })
        .mockResolvedValueOnce({ success: true, rangeId: 2 });

      const [response1, response2] = await Promise.all([
        app.request(`${baseUrl}/ranges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromBlock: 18000000, toBlock: 18001000 }),
        }),
        app.request(`${baseUrl}/ranges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromBlock: 18001000, toBlock: 18002000 }),
        }),
      ]);

      expect(response1.status).toBe(201);
      expect(response2.status).toBe(201);
    });
  });
});
