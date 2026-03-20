import { describe, it, expect, beforeEach, vi } from 'vitest';
import { indexingProgress, indexingRanges, contractEvents } from '../../../../src/database/schema';

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockRpcManagerGetClient = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/database/drizzle', () => ({
  db: {
    select: mockDbSelect,
  },
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: {
    getClient: mockRpcManagerGetClient,
  },
}));

describe('getIndexingStatus', () => {
  const chainId = 1;
  const address = '0x1234567890123456789012345678901234567890';

  const createMock = (ranges: any[], progress: any[] = []) => {
    mockDbSelect.mockImplementation((table: any) => {
      if (table === indexingProgress) {
        return {
          from: () => ({
            where: () => ({
              limit: () => progress,
            }),
          }),
        };
      }
      if (table === indexingRanges) {
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ranges,
            }),
          }),
        };
      }
      if (table === contractEvents) {
        return {
          from: () => ({
            where: () => ({
              groupBy: () => [],
            }),
          }),
        };
      }
      return {
        from: () => ({
          where: () => ({
            limit: () => [],
          }),
        }),
      };
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcManagerGetClient.mockResolvedValue({
      getBlockNumber: vi.fn().mockResolvedValue(18500000n),
    });
  });

  describe('range aggregation', () => {
    it('should return zeros when no ranges exist', async () => {
      createMock([]);

      const { getIndexingStatus } = await import('../../../../src/services/EventIndexingService');
      const result = await getIndexingStatus(chainId, address as `0x${string}`);

      expect(result.totalRanges).toBe(0);
      expect(result.completedRanges).toBe(0);
      expect(result.pendingRanges).toBe(0);
      expect(result.indexingRanges).toBe(0);
      expect(result.pausedRanges).toBe(0);
      expect(result.errorRanges).toBe(0);
      expect(result.totalProgress).toBe(0);
      expect(result.ranges).toEqual([]);
    });

    it('should count completed ranges correctly', async () => {
      const completedRanges = [
        {
          chainId,
          address,
          rangeId: 1,
          fromBlock: 18000000n,
          toBlock: 18001000n,
          direction: 'forward',
          currentBlock: 18001000n,
          status: 'completed',
          totalEventsIndexed: 100,
          errorMessage: null,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          chainId,
          address,
          rangeId: 2,
          fromBlock: 18001000n,
          toBlock: 18002000n,
          direction: 'forward',
          currentBlock: 18002000n,
          status: 'completed',
          totalEventsIndexed: 200,
          errorMessage: null,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      createMock(completedRanges);

      const { getIndexingStatus } = await import('../../../../src/services/EventIndexingService');
      const result = await getIndexingStatus(chainId, address as `0x${string}`);

      expect(result.totalRanges).toBe(2);
      expect(result.completedRanges).toBe(2);
      expect(result.pendingRanges).toBe(0);
      expect(result.indexingRanges).toBe(0);
      expect(result.pausedRanges).toBe(0);
      expect(result.errorRanges).toBe(0);
    });

    it('should aggregate mixed status ranges correctly', async () => {
      const mixedRanges = [
        {
          chainId,
          address,
          rangeId: 1,
          fromBlock: 18000000n,
          toBlock: 18001000n,
          direction: 'forward',
          currentBlock: null,
          status: 'pending',
          totalEventsIndexed: 0,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
        {
          chainId,
          address,
          rangeId: 2,
          fromBlock: 18001000n,
          toBlock: 18002000n,
          direction: 'forward',
          currentBlock: 18001500n,
          status: 'indexing',
          totalEventsIndexed: 50,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
        {
          chainId,
          address,
          rangeId: 3,
          fromBlock: 18002000n,
          toBlock: 18003000n,
          direction: 'forward',
          currentBlock: 18002000n,
          status: 'completed',
          totalEventsIndexed: 100,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
        {
          chainId,
          address,
          rangeId: 4,
          fromBlock: 18003000n,
          toBlock: 18004000n,
          direction: 'forward',
          currentBlock: 18003500n,
          status: 'paused',
          totalEventsIndexed: 25,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
        {
          chainId,
          address,
          rangeId: 5,
          fromBlock: 18004000n,
          toBlock: 18005000n,
          direction: 'forward',
          currentBlock: 18004500n,
          status: 'error',
          totalEventsIndexed: 10,
          errorMessage: 'RPC error',
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
      ];
      createMock(mixedRanges);

      const { getIndexingStatus } = await import('../../../../src/services/EventIndexingService');
      const result = await getIndexingStatus(chainId, address as `0x${string}`);

      expect(result.totalRanges).toBe(5);
      expect(result.pendingRanges).toBe(1);
      expect(result.indexingRanges).toBe(1);
      expect(result.completedRanges).toBe(1);
      expect(result.pausedRanges).toBe(1);
      expect(result.errorRanges).toBe(1);
    });

    it('should calculate weighted progress correctly', async () => {
      const rangesWithProgress = [
        {
          chainId,
          address,
          rangeId: 1,
          fromBlock: 18000000n,
          toBlock: 18001000n,
          direction: 'forward',
          currentBlock: 18000500n,
          status: 'indexing',
          totalEventsIndexed: 50,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
        {
          chainId,
          address,
          rangeId: 2,
          fromBlock: 18001000n,
          toBlock: 18002000n,
          direction: 'forward',
          currentBlock: 18002000n,
          status: 'completed',
          totalEventsIndexed: 100,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
      ];
      createMock(rangesWithProgress);

      const { getIndexingStatus } = await import('../../../../src/services/EventIndexingService');
      const result = await getIndexingStatus(chainId, address as `0x${string}`);

      expect(result.totalRanges).toBe(2);
      expect(result.indexingRanges).toBe(1);
      expect(result.completedRanges).toBe(1);
      const expectedProgress = Math.round(((500 + 1000) / 2000) * 100);
      expect(result.totalProgress).toBe(expectedProgress);
    });

    it('should handle backward direction ranges', async () => {
      const backwardRanges = [
        {
          chainId,
          address,
          rangeId: 1,
          fromBlock: 18000000n,
          toBlock: 18001000n,
          direction: 'backward',
          currentBlock: 18000500n,
          status: 'indexing',
          totalEventsIndexed: 50,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
      ];
      createMock(backwardRanges);

      const { getIndexingStatus } = await import('../../../../src/services/EventIndexingService');
      const result = await getIndexingStatus(chainId, address as `0x${string}`);

      expect(result.ranges[0].progress).toBe(50);
      expect(result.totalProgress).toBe(50);
    });

    it('should preserve legacy indexingProgress fields', async () => {
      const legacyProgress = [
        {
          chainId,
          address,
          creationBlock: 17900000n,
          lastIndexedBlock: 18000000n,
          lastFinalizedBlock: 17990000n,
          totalEventsIndexed: 500,
          status: 'indexing',
          errorMessage: null,
          updatedAt: new Date(),
        },
      ];
      createMock([], legacyProgress);

      const { getIndexingStatus } = await import('../../../../src/services/EventIndexingService');
      const result = await getIndexingStatus(chainId, address as `0x${string}`);

      expect(result.creationBlock).toBe(17900000);
      expect(result.lastIndexedBlock).toBe(18000000);
      expect(result.lastFinalizedBlock).toBe(17990000);
      expect(result.status).toBe('indexing');
    });

    it('should derive status from ranges when no legacy progress exists', async () => {
      const rangesWithError = [
        {
          chainId,
          address,
          rangeId: 1,
          fromBlock: 18000000n,
          toBlock: 18001000n,
          direction: 'forward',
          currentBlock: null,
          status: 'pending',
          totalEventsIndexed: 0,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
        {
          chainId,
          address,
          rangeId: 2,
          fromBlock: 18001000n,
          toBlock: 18002000n,
          direction: 'forward',
          currentBlock: 18001500n,
          status: 'error',
          totalEventsIndexed: 50,
          errorMessage: 'RPC timeout',
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
      ];
      createMock(rangesWithError);

      const { getIndexingStatus } = await import('../../../../src/services/EventIndexingService');
      const result = await getIndexingStatus(chainId, address as `0x${string}`);

      expect(result.status).toBe('error');
    });

    it('should return range summaries with correct structure', async () => {
      const sampleRanges = [
        {
          chainId,
          address,
          rangeId: 1,
          fromBlock: 18000000n,
          toBlock: 18001000n,
          direction: 'forward',
          currentBlock: 18000500n,
          status: 'indexing',
          totalEventsIndexed: 50,
          errorMessage: null,
          priority: 0,
          createdAt: null,
          updatedAt: null,
        },
      ];
      createMock(sampleRanges);

      const { getIndexingStatus } = await import('../../../../src/services/EventIndexingService');
      const result = await getIndexingStatus(chainId, address as `0x${string}`);

      expect(result.ranges).toHaveLength(1);
      expect(result.ranges[0]).toEqual({
        rangeId: 1,
        fromBlock: 18000000,
        toBlock: 18001000,
        currentBlock: 18000500,
        status: 'indexing',
        progress: 50,
      });
    });
  });
});
