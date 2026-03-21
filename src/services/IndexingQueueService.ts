import { eq, and } from 'drizzle-orm';
import { db, indexingRanges } from '../database/drizzle';
import { startIndexingRange, pauseIndexingRange } from './EventIndexingService';
import { contractSourceService } from './ContractSourceService';
import { createLogger } from '../server/logger';
import type { Abi } from 'viem';

const logger = createLogger('indexing-queue-service');

type QueueState = {
  currentRangeId: number | null;
  pendingRangeIds: number[];
};

type QueueStatus = {
  isIndexing: boolean;
  currentRangeId: number | null;
  pendingCount: number;
  pendingRangeIds: number[];
};

type EnqueueResult = {
  success: boolean;
  started: boolean;
  error?: string;
};

const queueKey = (chainId: number, address: string): string =>
  `${chainId}:${address.toLowerCase()}`;

export class IndexingQueueService {
  private queues = new Map<string, QueueState>();

  async enqueueRange(
    chainId: number,
    address: `0x${string}`,
    rangeId: number,
    abi?: Abi,
  ): Promise<EnqueueResult> {
    const key = queueKey(chainId, address);
    logger.info({ chainId, address, rangeId, key }, 'Enqueueing range');

    const existing = await db
      .select()
      .from(indexingRanges)
      .where(
        and(
          eq(indexingRanges.chainId, chainId),
          eq(indexingRanges.address, address),
          eq(indexingRanges.rangeId, rangeId),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      logger.warn({ chainId, address, rangeId }, 'Range not found');
      return { success: false, started: false, error: 'Range not found' };
    }

    const range = existing[0];

    if (range.status === 'completed') {
      logger.info({ chainId, address, rangeId }, 'Range already completed');
      return { success: false, started: false, error: 'Range is already completed' };
    }

    let queue = this.queues.get(key);
    if (!queue) {
      queue = { currentRangeId: null, pendingRangeIds: [] };
      this.queues.set(key, queue);
    }

    if (queue.currentRangeId === rangeId) {
      logger.info({ chainId, address, rangeId }, 'Range is already being indexed');
      return { success: false, started: false, error: 'Range is already being indexed' };
    }

    if (queue.pendingRangeIds.includes(rangeId)) {
      logger.info({ chainId, address, rangeId }, 'Range is already in pending queue');
      return { success: false, started: false, error: 'Range is already in queue' };
    }

    if (queue.currentRangeId === null) {
      logger.info({ chainId, address, rangeId }, 'Starting range immediately (queue idle)');
      queue.currentRangeId = rangeId;

      this.executeIndexing(chainId, address, rangeId, abi).catch((err: unknown) => {
        logger.error({ chainId, address, rangeId, err }, 'Indexing failed');
      });

      return { success: true, started: true };
    }

    logger.info(
      { chainId, address, rangeId, currentRangeId: queue.currentRangeId },
      'Adding range to pending queue',
    );
    queue.pendingRangeIds.push(rangeId);
    return { success: true, started: false };
  }

  private async executeIndexing(
    chainId: number,
    address: `0x${string}`,
    rangeId: number,
    abi?: Abi,
  ): Promise<void> {
    logger.info({ chainId, address, rangeId }, 'Starting indexing');

    try {
      let resolvedAbi = abi;
      if (!resolvedAbi) {
        logger.info({ chainId, address }, 'Fetching ABI from ContractSourceService');
        const contractSource = await contractSourceService.getContractSource(chainId, address);
        if (contractSource?.abi) {
          try {
            resolvedAbi = JSON.parse(contractSource.abi) as Abi;
          }
          catch {
            logger.error({ chainId, address }, 'Failed to parse ABI from contract source');
            throw new Error('Failed to parse ABI from contract source');
          }
        }
        else {
          logger.error({ chainId, address }, 'No ABI available for contract');
          throw new Error('No ABI available for contract');
        }
      }

      const result = await startIndexingRange(chainId, address, rangeId, resolvedAbi);

      if (result.success) {
        logger.info({ chainId, address, rangeId }, 'Indexing completed successfully');
      }
      else {
        logger.warn(
          { chainId, address, rangeId, error: result.error },
          'Indexing completed with error',
        );
      }
    }
    catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ chainId, address, rangeId, error: errorMsg }, 'Indexing threw error');
    }
    finally {
      await this.handleRangeCompletion(chainId, address, rangeId);
    }
  }

  private async handleRangeCompletion(
    chainId: number,
    address: `0x${string}`,
    completedRangeId: number,
  ): Promise<void> {
    const key = queueKey(chainId, address);
    const queue = this.queues.get(key);

    if (!queue) {
      logger.warn({ chainId, address, completedRangeId }, 'Queue not found on completion');
      return;
    }

    if (queue.currentRangeId === completedRangeId) {
      queue.currentRangeId = null;
    }

    logger.info(
      { chainId, address, completedRangeId, pendingCount: queue.pendingRangeIds.length },
      'Range completed, checking for pending ranges',
    );

    await this.startNext(chainId, address);
  }

  async startNext(chainId: number, address: `0x${string}`): Promise<boolean> {
    const key = queueKey(chainId, address);
    const queue = this.queues.get(key);

    if (!queue) {
      logger.debug({ chainId, address }, 'No queue found for startNext');
      return false;
    }

    if (queue.currentRangeId !== null) {
      logger.debug(
        { chainId, address, currentRangeId: queue.currentRangeId },
        'Queue busy, cannot start next',
      );
      return false;
    }

    if (queue.pendingRangeIds.length === 0) {
      logger.debug({ chainId, address }, 'No pending ranges to start');
      return false;
    }

    const nextRangeId = queue.pendingRangeIds.shift()!;

    const existing = await db
      .select()
      .from(indexingRanges)
      .where(
        and(
          eq(indexingRanges.chainId, chainId),
          eq(indexingRanges.address, address),
          eq(indexingRanges.rangeId, nextRangeId),
        ),
      )
      .limit(1);

    if (existing.length === 0 || existing[0].status === 'completed') {
      logger.info(
        { chainId, address, nextRangeId },
        'Skipping range (not found or already completed)',
      );
      return this.startNext(chainId, address);
    }

    logger.info({ chainId, address, nextRangeId }, 'Auto-starting next pending range');
    queue.currentRangeId = nextRangeId;

    this.executeIndexing(chainId, address, nextRangeId).catch((err: unknown) => {
      logger.error({ chainId, address, nextRangeId, err }, 'Auto-started indexing failed');
    });

    return true;
  }

  pauseCurrent(chainId: number, address: `0x${string}`): { success: boolean; error?: string } {
    const key = queueKey(chainId, address);
    const queue = this.queues.get(key);

    if (!queue || queue.currentRangeId === null) {
      logger.debug({ chainId, address }, 'No current range to pause');
      return { success: false, error: 'No range currently indexing' };
    }

    logger.info(
      { chainId, address, currentRangeId: queue.currentRangeId },
      'Pausing current range',
    );
    pauseIndexingRange(chainId, address, queue.currentRangeId);

    const pausedRangeId = queue.currentRangeId;
    queue.currentRangeId = null;
    queue.pendingRangeIds.unshift(pausedRangeId);

    return { success: true };
  }

  getQueueStatus(chainId: number, address: `0x${string}`): QueueStatus {
    const key = queueKey(chainId, address);
    const queue = this.queues.get(key);

    if (!queue) {
      return {
        isIndexing: false,
        currentRangeId: null,
        pendingCount: 0,
        pendingRangeIds: [],
      };
    }

    return {
      isIndexing: queue.currentRangeId !== null,
      currentRangeId: queue.currentRangeId,
      pendingCount: queue.pendingRangeIds.length,
      pendingRangeIds: [...queue.pendingRangeIds],
    };
  }

  clearQueue(chainId: number, address: `0x${string}`): void {
    const key = queueKey(chainId, address);
    const queue = this.queues.get(key);

    if (queue) {
      if (queue.currentRangeId !== null) {
        pauseIndexingRange(chainId, address, queue.currentRangeId);
      }
      this.queues.delete(key);
      logger.info({ chainId, address }, 'Queue cleared');
    }
  }

  getAllQueues(): Map<string, QueueState> {
    return new Map(this.queues);
  }
}

export const indexingQueueService = new IndexingQueueService();
