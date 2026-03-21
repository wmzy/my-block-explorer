import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IndexingQueueService } from '@/services/IndexingQueueService';

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockStartIndexingRange = vi.hoisted(() => vi.fn());
const mockPauseIndexingRange = vi.hoisted(() => vi.fn());
const mockGetContractSource = vi.hoisted(() => vi.fn());

vi.mock('@/database/drizzle', () => ({
  db: {
    select: mockDbSelect,
  },
  indexingRanges: {},
}));

vi.mock('@/services/EventIndexingService', () => ({
  startIndexingRange: mockStartIndexingRange,
  pauseIndexingRange: mockPauseIndexingRange,
}));

vi.mock('@/services/ContractSourceService', () => ({
  contractSourceService: {
    getContractSource: mockGetContractSource,
  },
}));

vi.mock('@/server/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

type MockRange = {
  chainId: number;
  address: string;
  rangeId: number;
  fromBlock: bigint;
  toBlock: bigint;
  direction: string;
  currentBlock: bigint | null;
  status: string;
  totalEventsIndexed: number;
  errorMessage: string | null;
  priority: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

const createMockRange = (overrides: Partial<MockRange> = {}): MockRange => ({
  chainId: 1,
  address: '0x1234567890123456789012345678901234567890',
  rangeId: 1,
  fromBlock: 0n,
  toBlock: 1000n,
  direction: 'forward',
  currentBlock: null,
  status: 'pending',
  totalEventsIndexed: 0,
  errorMessage: null,
  priority: 0,
  createdAt: null,
  updatedAt: null,
  ...overrides,
});

describe('IndexingQueueService', () => {
  const chainId = 1;
  const address = '0x1234567890123456789012345678901234567890' as `0x${string}`;
  const sampleAbi = [
    {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ],
    },
  ] as const;

  let service: IndexingQueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IndexingQueueService();

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    mockStartIndexingRange.mockReset();
    mockPauseIndexingRange.mockReset();
    mockGetContractSource.mockReset();
  });

  describe('getQueueStatus', () => {
    it('should return empty status for new queue', () => {
      const status = service.getQueueStatus(chainId, address);

      expect(status).toEqual({
        isIndexing: false,
        currentRangeId: null,
        pendingCount: 0,
        pendingRangeIds: [],
      });
    });

    it('should return correct status when range is indexing', async () => {
      const range = createMockRange({ status: 'pending' });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([range]),
          }),
        }),
      });

      let resolveIndexing: () => void;
      mockStartIndexingRange.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            resolveIndexing = () => resolve({ success: true });
          }),
      );

      await service.enqueueRange(chainId, address, 1, sampleAbi);

      const status = service.getQueueStatus(chainId, address);
      expect(status.isIndexing).toBe(true);
      expect(status.currentRangeId).toBe(1);

      resolveIndexing!();
    });
  });

  describe('enqueueRange', () => {
    it('should fail if range not found in database', async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.enqueueRange(chainId, address, 1, sampleAbi);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Range not found');
    });

    it('should fail if range is already completed', async () => {
      const range = createMockRange({ status: 'completed' });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([range]),
          }),
        }),
      });

      const result = await service.enqueueRange(chainId, address, 1, sampleAbi);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Range is already completed');
    });

    it('should start indexing immediately when queue is idle', async () => {
      const range = createMockRange({ status: 'pending' });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([range]),
          }),
        }),
      });

      mockStartIndexingRange.mockResolvedValue({ success: true });

      const result = await service.enqueueRange(chainId, address, 1, sampleAbi);

      expect(result.success).toBe(true);
      expect(result.started).toBe(true);
      expect(mockStartIndexingRange).toHaveBeenCalledWith(chainId, address, 1, sampleAbi);
    });

    it('should add to pending queue when another range is indexing', async () => {
      const range1 = createMockRange({ rangeId: 1, status: 'pending' });
      const range2 = createMockRange({ rangeId: 2, status: 'pending' });

      let selectCallCount = 0;
      mockDbSelect.mockImplementation(() => {
        selectCallCount++;
        const ranges = [range1, range2];
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue(selectCallCount <= 2 ? [ranges[selectCallCount - 1]] : []),
            }),
          }),
        };
      });

      let resolveIndexing: () => void;
      mockStartIndexingRange.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            resolveIndexing = () => resolve({ success: true });
          }),
      );

      const result1 = await service.enqueueRange(chainId, address, 1, sampleAbi);
      expect(result1.started).toBe(true);

      const result2 = await service.enqueueRange(chainId, address, 2, sampleAbi);
      expect(result2.started).toBe(false);
      expect(result2.success).toBe(true);

      const status = service.getQueueStatus(chainId, address);
      expect(status.pendingCount).toBe(1);
      expect(status.pendingRangeIds).toContain(2);

      resolveIndexing!();
    });

    it('should fail if range is already being indexed', async () => {
      const range = createMockRange({ status: 'pending' });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([range]),
          }),
        }),
      });

      let resolveIndexing: () => void;
      mockStartIndexingRange.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            resolveIndexing = () => resolve({ success: true });
          }),
      );

      await service.enqueueRange(chainId, address, 1, sampleAbi);
      const result = await service.enqueueRange(chainId, address, 1, sampleAbi);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Range is already being indexed');

      resolveIndexing!();
    });

    it('should fail if range is already in pending queue', async () => {
      const range1 = createMockRange({ rangeId: 1, status: 'pending' });
      const range2 = createMockRange({ rangeId: 2, status: 'pending' });

      let selectCallCount = 0;
      mockDbSelect.mockImplementation(() => {
        selectCallCount++;
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(selectCallCount === 1 ? [range1] : [range2]),
            }),
          }),
        };
      });

      let resolveIndexing: () => void;
      mockStartIndexingRange.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            resolveIndexing = () => resolve({ success: true });
          }),
      );

      await service.enqueueRange(chainId, address, 1, sampleAbi);
      await service.enqueueRange(chainId, address, 2, sampleAbi);
      const result = await service.enqueueRange(chainId, address, 2, sampleAbi);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Range is already in queue');

      resolveIndexing!();
    });

    it('should fetch ABI from ContractSourceService if not provided', async () => {
      const range = createMockRange({ status: 'pending' });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([range]),
          }),
        }),
      });

      mockGetContractSource.mockResolvedValue({
        abi: JSON.stringify(sampleAbi),
      });
      mockStartIndexingRange.mockResolvedValue({ success: true });

      await service.enqueueRange(chainId, address, 1);

      expect(mockGetContractSource).toHaveBeenCalledWith(chainId, address);
      expect(mockStartIndexingRange).toHaveBeenCalledWith(chainId, address, 1, expect.any(Array));
    });
  });

  describe('auto-start next range on completion', () => {
    it('should auto-start next pending range when current completes', async () => {
      const range1 = createMockRange({ rangeId: 1, status: 'pending' });
      const range2 = createMockRange({ rangeId: 2, status: 'pending' });

      const rangeResults: MockRange[][] = [[range1], [range2], [range2]];
      let selectCallCount = 0;
      mockDbSelect.mockImplementation(() => {
        const result = rangeResults[Math.min(selectCallCount, rangeResults.length - 1)];
        selectCallCount++;
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(result),
            }),
          }),
        };
      });

      let firstResolve: (() => void) | undefined;
      let secondResolve: (() => void) | undefined;
      let callCount = 0;

      mockStartIndexingRange.mockImplementation(() => {
        callCount++;
        return new Promise<{ success: boolean }>((resolve) => {
          if (callCount === 1) {
            firstResolve = () => resolve({ success: true });
          }
          else {
            secondResolve = () => resolve({ success: true });
          }
        });
      });

      await service.enqueueRange(chainId, address, 1, sampleAbi);
      await service.enqueueRange(chainId, address, 2, sampleAbi);

      const statusBefore = service.getQueueStatus(chainId, address);
      expect(statusBefore.currentRangeId).toBe(1);
      expect(statusBefore.pendingCount).toBe(1);

      firstResolve!();

      await vi.waitFor(() => {
        const status = service.getQueueStatus(chainId, address);
        expect(status.currentRangeId).toBe(2);
      });

      const statusAfter = service.getQueueStatus(chainId, address);
      expect(statusAfter.pendingCount).toBe(0);

      secondResolve!();
    });
  });

  describe('pauseCurrent', () => {
    it('should fail if no range is currently indexing', () => {
      const result = service.pauseCurrent(chainId, address);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No range currently indexing');
    });

    it('should pause current range and move to front of pending queue', async () => {
      const range = createMockRange({ status: 'pending' });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([range]),
          }),
        }),
      });

      let resolveIndexing: () => void;
      mockStartIndexingRange.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            resolveIndexing = () => resolve({ success: true });
          }),
      );

      await service.enqueueRange(chainId, address, 1, sampleAbi);

      const result = service.pauseCurrent(chainId, address);

      expect(result.success).toBe(true);
      expect(mockPauseIndexingRange).toHaveBeenCalledWith(chainId, address, 1);

      const status = service.getQueueStatus(chainId, address);
      expect(status.isIndexing).toBe(false);
      expect(status.pendingRangeIds[0]).toBe(1);

      resolveIndexing!();
    });
  });

  describe('startNext', () => {
    it('should return false if no queue exists', async () => {
      const result = await service.startNext(chainId, address);
      expect(result).toBe(false);
    });

    it('should return false if queue is busy', async () => {
      const range = createMockRange({ status: 'pending' });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([range]),
          }),
        }),
      });

      let resolveIndexing: () => void;
      mockStartIndexingRange.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            resolveIndexing = () => resolve({ success: true });
          }),
      );

      await service.enqueueRange(chainId, address, 1, sampleAbi);

      const result = await service.startNext(chainId, address);
      expect(result).toBe(false);

      resolveIndexing!();
    });

    it('should return false if no pending ranges', async () => {
      const result = await service.startNext(chainId, address);
      expect(result).toBe(false);
    });
  });

  describe('clearQueue', () => {
    it('should clear empty queue without error', () => {
      expect(() => service.clearQueue(chainId, address)).not.toThrow();
    });

    it('should pause current range and clear queue', async () => {
      const range = createMockRange({ status: 'pending' });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([range]),
          }),
        }),
      });

      let resolveIndexing: () => void;
      mockStartIndexingRange.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            resolveIndexing = () => resolve({ success: true });
          }),
      );

      await service.enqueueRange(chainId, address, 1, sampleAbi);
      service.clearQueue(chainId, address);

      expect(mockPauseIndexingRange).toHaveBeenCalledWith(chainId, address, 1);

      const status = service.getQueueStatus(chainId, address);
      expect(status.isIndexing).toBe(false);
      expect(status.pendingCount).toBe(0);

      resolveIndexing!();
    });
  });

  describe('getAllQueues', () => {
    it('should return empty map when no queues', () => {
      const queues = service.getAllQueues();
      expect(queues.size).toBe(0);
    });

    it('should return all queue states', async () => {
      const range1 = createMockRange({
        chainId: 1,
        address: '0x1111111111111111111111111111111111111111',
        status: 'pending',
      });
      const range2 = createMockRange({
        chainId: 1,
        address: '0x2222222222222222222222222222222222222222',
        status: 'pending',
      });

      let selectCount = 0;
      mockDbSelect.mockImplementation(() => {
        selectCount++;
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(selectCount === 1 ? [range1] : [range2]),
            }),
          }),
        };
      });

      mockStartIndexingRange.mockResolvedValue({ success: true });

      await service.enqueueRange(
        1,
        '0x1111111111111111111111111111111111111111' as `0x${string}`,
        1,
        sampleAbi,
      );
      await service.enqueueRange(
        1,
        '0x2222222222222222222222222222222222222222' as `0x${string}`,
        1,
        sampleAbi,
      );

      const queues = service.getAllQueues();
      expect(queues.size).toBe(2);
    });
  });

  describe('singleton export', () => {
    it('should export singleton instance', async () => {
      const { indexingQueueService } = await import('@/services/IndexingQueueService');
      expect(indexingQueueService).toBeInstanceOf(IndexingQueueService);
    });
  });
});
