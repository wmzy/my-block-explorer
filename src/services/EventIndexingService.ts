/**
 * 事件索引服务
 * 负责合约事件的发现、解析和索引处理，使用多链数据库隔离架构
 */

import { ChainDatabaseManager, multiChainDb } from '../database/chain-database-manager';
import { ChainEventTableManager } from '../database/chain-event-table-manager';
import { ChainSchemaManager } from '../database/chain-schema-manager';
import { rpcManager } from './RpcManager';
import { getChainName, getChainType } from '../config/chains';
import { multiChainPerformanceManager } from '../database/performance-monitor';
import {
  EventIndexingStatus,
  EventIndexingTask,
  EventParameter,
  ChainDatabaseError,
  EventIndexingError,
  DecodedEvent,
  AbiEvent,
  DEFAULT_EVENT_INDEXING_CONFIG
} from '../types/events';
import { Log, decodeEventLog, getEventSelector, hexToNumber, numberToHex, keccak256 } from 'viem';

/**
 * 事件索引服务配置
 */
export interface EventIndexingConfig {
  batchSize: number;
  maxConcurrency: number;
  retryAttempts: number;
  retryDelay: number;
  enableReorgDetection: boolean;
  indexingTimeout: number;
  tableNamePrefix: string;
  maxTableNameLength: number;
}

/**
 * 事件索引服务
 * 负责管理合约事件的索引生命周期
 */
export class EventIndexingService {
  private chainId: number;
  private chainDb: ChainDatabaseManager;
  private eventTableManager: ChainEventTableManager;
  private schemaManager: ChainSchemaManager;
  private rpcManager: RpcManager;
  private config: EventIndexingConfig;
  private indexingTasks: Map<string, EventIndexingTask>;

  constructor(
    chainId: number,
    config: Partial<EventIndexingConfig> = {}
  ) {
    this.chainId = chainId;
    this.config = {
      batchSize: DEFAULT_EVENT_INDEXING_CONFIG.batchSize,
      maxConcurrency: DEFAULT_EVENT_INDEXING_CONFIG.maxConcurrency,
      retryAttempts: 3,
      retryDelay: 1000,
      enableReorgDetection: true,
      indexingTimeout: 300000, // 5 minutes
      tableNamePrefix: DEFAULT_EVENT_INDEXING_CONFIG.tableNamePrefix,
      maxTableNameLength: DEFAULT_EVENT_INDEXING_CONFIG.maxTableNameLength,
      ...config,
    };

    // 获取现有的多链数据库管理器实例
    this.chainDb = multiChainDb.getChainDatabaseSync(chainId);
    this.eventTableManager = new ChainEventTableManager(this.chainDb, this.config);
    this.schemaManager = new ChainSchemaManager(chainId);
    this.rpcManager = rpcManager;
    this.indexingTasks = new Map();
  }

  /**
   * 开始为合约建立事件索引
   */
  async startIndexing(
    contractAddress: `0x${string}`,
    abi: AbiEvent[],
    fromBlock?: bigint,
    toBlock?: bigint
  ): Promise<string> {
    const taskId = this.generateTaskId(contractAddress);

    // 检查是否已有运行中的任务
    if (this.indexingTasks.has(taskId)) {
      const existingTask = this.indexingTasks.get(taskId)!;
      if (existingTask.status === 'running') {
        throw new EventIndexingError(
          `Indexing already in progress for contract ${contractAddress}`,
          undefined,
          contractAddress,
          this.chainId
        );
      }
    }

    // 创建索引任务
    const task: EventIndexingTask = {
      taskId,
      chainId: this.chainId,
      contractAddress,
      eventSignatures: abi.map(event => getEventSelector(event)),
      fromBlock: fromBlock || 0n,
      toBlock,
      status: 'pending',
      progress: 0,
      errorCount: 0,
    };

    this.indexingTasks.set(taskId, task);

    try {
      // 异步执行索引任务
      this.executeIndexingTask(task, abi).catch(error => {
        console.error(`Indexing task ${taskId} failed:`, error);
        task.status = 'failed';
        task.lastError = error instanceof Error ? error.message : String(error);
      });

      return taskId;
    } catch (error) {
      this.indexingTasks.delete(taskId);
      throw error;
    }
  }

  /**
   * 获取索引状态
   */
  async getIndexingStatus(contractAddress: `0x${string}`): Promise<EventIndexingStatus> {
    const taskId = this.generateTaskId(contractAddress);
    const task = this.indexingTasks.get(taskId);

    // 获取合约事件表统计
    const eventTables = await this.eventTableManager.getContractEventTables(contractAddress);
    let totalEvents = 0;
    let lastIndexedBlock: bigint | undefined;

    for (const tableName of eventTables) {
      const stats = await this.eventTableManager.getEventStatistics(tableName);
      totalEvents += stats.totalEvents;
    }

    // 获取最新区块号
    try {
      const client = await this.rpcManager.getClient(this.chainId);
      const latestBlock = await client.getBlockNumber();
      lastIndexedBlock = latestBlock;
    } catch (error) {
      console.warn(`Failed to get latest block for chain ${this.chainId}:`, error);
    }

    return {
      contractAddress,
      chainId: this.chainId,
      eventSignatures: task?.eventSignatures || [],
      lastIndexedBlock: lastIndexedBlock || 0n,
      totalEventsIndexed: totalEvents,
      indexingActive: task?.status === 'running' || false,
      lastIndexedAt: task?.startedAt,
      errors: task?.errors || [],
    };
  }

  /**
   * 停止索引任务
   */
  async stopIndexing(contractAddress: `0x${string}`): Promise<void> {
    const taskId = this.generateTaskId(contractAddress);
    const task = this.indexingTasks.get(taskId);

    if (!task) {
      throw new EventIndexingError(
        `No indexing task found for contract ${contractAddress}`,
        undefined,
        contractAddress,
        this.chainId
      );
    }

    if (task.status === 'running') {
      task.status = 'paused';
    }
  }

  /**
   * 恢复索引任务
   */
  async resumeIndexing(contractAddress: `0x${string}`): Promise<void> {
    const taskId = this.generateTaskId(contractAddress);
    const task = this.indexingTasks.get(taskId);

    if (!task) {
      throw new EventIndexingError(
        `No indexing task found for contract ${contractAddress}`,
        undefined,
        contractAddress,
        this.chainId
      );
    }

    if (task.status === 'paused') {
      task.status = 'pending';
      // 重新启动任务逻辑
    }
  }

  /**
   * 获取所有索引任务
   */
  getActiveIndexingTasks(): EventIndexingTask[] {
    return Array.from(this.indexingTasks.values())
      .filter(task => task.status === 'running' || task.status === 'pending');
  }

  /**
   * 清理完成的任务
   */
  cleanupCompletedTasks(): void {
    for (const [taskId, task] of this.indexingTasks) {
      if (task.status === 'completed' || task.status === 'failed') {
        // 保留24小时后再清理
        const completedAt = task.completedAt;
        if (completedAt && Date.now() - completedAt.getTime() > 24 * 60 * 60 * 1000) {
          this.indexingTasks.delete(taskId);
        }
      }
    }
  }

  /**
   * 执行索引任务
   */
  private async executeIndexingTask(task: EventIndexingTask, abi: AbiEvent[]): Promise<void> {
    task.status = 'running';
    task.startedAt = new Date();

    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      // 创建事件表
      await this.setupEventTables(task.contractAddress, abi);

      // 确定索引范围
      const toBlock = task.toBlock || await this.getLatestBlockNumber();
      let currentBlock = task.fromBlock;

      // 分批处理区块
      while (currentBlock <= toBlock && task.status === 'running') {
        const batchStart = performance.now();

        const batchEndBlock = currentBlock + BigInt(this.config.batchSize);
        const targetBlock = batchEndBlock > toBlock ? toBlock : batchEndBlock;

        // 获取区块日志
        const logs = await this.getContractLogs(
          task.contractAddress,
          currentBlock,
          targetBlock
        );

        // 解码和处理事件
        if (logs.length > 0) {
          await this.processLogs(task.contractAddress, logs, abi);
        }

        // 更新进度
        const totalBlocks = Number(toBlock - task.fromBlock);
        const processedBlocks = Number(targetBlock - task.fromBlock);
        task.progress = Math.round((processedBlocks / totalBlocks) * 100);
        task.lastIndexedBlock = targetBlock;

        // 记录性能指标
        const batchTime = performance.now() - batchStart;
        performanceMonitor.recordEventIndexing(logs.length, batchTime, Number(targetBlock - currentBlock + 1n));

        // 移动到下一批
        currentBlock = targetBlock + 1n;

        // 更新任务时间戳
        task.lastIndexedAt = new Date();
      }

      // 任务完成
      if (task.status === 'running') {
        task.status = 'completed';
        task.completedAt = new Date();
      }

    } catch (error) {
      task.status = 'failed';
      task.errorCount++;
      task.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 设置事件表
   */
  private async setupEventTables(contractAddress: `0x${string}`, abi: AbiEvent[]): Promise<void> {
    for (const eventAbi of abi) {
      const eventSignature = getEventSelector(eventAbi);

      try {
        await this.eventTableManager.createEventTable(
          contractAddress,
          eventAbi.inputs || [],
          eventSignature,
          eventAbi.name
        );
      } catch (error) {
        // 表可能已存在，忽略错误
        if (!(error instanceof Error && error.message.includes('already exists'))) {
          console.warn(`Failed to create event table for ${eventAbi.name}:`, error);
        }
      }
    }
  }

  /**
   * 获取合约日志
   */
  private async getContractLogs(
    contractAddress: `0x${string}`,
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<Log[]> {
    const startTime = performance.now();
    let success = true;

    try {
      const client = await this.rpcManager.getClient(this.chainId);
      const logs = await client.getLogs({
        address: contractAddress,
        fromBlock,
        toBlock,
      });

      const endTime = performance.now();
      multiChainPerformanceManager.getChainMonitor(this.chainId).recordRpcCall(endTime - startTime, true);

      return logs;
    } catch (error) {
      success = false;
      const endTime = performance.now();
      multiChainPerformanceManager.getChainMonitor(this.chainId).recordRpcCall(endTime - startTime, false);

      throw new EventIndexingError(
        `Failed to get logs for contract ${contractAddress}: ${error}`,
        undefined,
        contractAddress,
        this.chainId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 处理日志
   */
  private async processLogs(
    contractAddress: `0x${string}`,
    logs: Log[],
    abi: AbiEvent[]
  ): Promise<void> {
    const eventsBySignature = new Map<string, AbiEvent>();

    // 建立事件签名到ABI的映射
    for (const eventAbi of abi) {
      const signature = getEventSelector(eventAbi);
      eventsBySignature.set(signature, eventAbi);
    }

    // 按签名分组处理日志
    const logsBySignature = new Map<string, Log[]>();

    for (const log of logs) {
      const signature = log.topics[0];
      if (signature && eventsBySignature.has(signature)) {
        if (!logsBySignature.has(signature)) {
          logsBySignature.set(signature, []);
        }
        logsBySignature.get(signature)!.push(log);
      }
    }

    // 处理每个签名的事件
    for (const [signature, logsGroup] of logsBySignature) {
      const eventAbi = eventsBySignature.get(signature)!;
      await this.processEventLogs(contractAddress, logsGroup, eventAbi);
    }
  }

  /**
   * 处理特定事件的日志
   */
  private async processEventLogs(
    contractAddress: `0x${string}`,
    logs: Log[],
    eventAbi: AbiEvent
  ): Promise<void> {
    const tableName = await this.eventTableManager.createEventTable(
      contractAddress,
      eventAbi.inputs || [],
      getEventSelector(eventAbi),
      eventAbi.name
    );

    // Fetch block timestamps for all unique blocks
    const uniqueBlockNumbers = [...new Set(
      logs.map((l) => l.blockNumber).filter((n): n is bigint => n != null)
    )];
    const blockTimestampMap = new Map<bigint, Date>();
    try {
      const client = await rpcManager.getClient(this.chainId);
      const batchResults = await Promise.allSettled(
        uniqueBlockNumbers.map(async (bn) => {
          const block = await client.getBlock({ blockNumber: bn });
          return { blockNumber: bn, timestamp: new Date(Number(block.timestamp) * 1000) };
        })
      );
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          blockTimestampMap.set(result.value.blockNumber, result.value.timestamp);
        }
      }
    } catch {
      // If batch fetch fails, timestamps will fall back to current time
    }

    const decodedEvents: any[] = [];

    for (const log of logs) {
      try {
        const decodedLog = decodeEventLog({
          abi: [eventAbi],
          data: log.data,
          topics: log.topics,
        });

        if (decodedLog) {
          const blockTimestamp =
            (log.blockNumber != null && blockTimestampMap.get(log.blockNumber)) ||
            new Date();

          const decodedEvent = {
            blockHash: log.blockHash,
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
            transactionIndex: log.transactionIndex,
            blockNumber: log.blockNumber,
            blockTimestamp,
            contractAddress,
            eventName: eventAbi.name,
            eventSignature: getEventSelector(eventAbi),
            ...decodedLog.args,
            decodedAt: new Date(),
            indexedAt: new Date(),
          };

          decodedEvents.push(decodedEvent);
        }
      } catch (error) {
        console.warn(`Failed to decode event log:`, error);
      }
    }

    // 批量插入事件
    if (decodedEvents.length > 0) {
      await this.eventTableManager.insertEventDataBatch(tableName, decodedEvents);
    }
  }

  /**
   * 获取最新区块号
   */
  private async getLatestBlockNumber(): Promise<bigint> {
    try {
      const client = await this.rpcManager.getClient(this.chainId);
      return await client.getBlockNumber();
    } catch (error) {
      throw new EventIndexingError(
        `Failed to get latest block number: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 生成任务ID
   */
  private generateTaskId(contractAddress: `0x${string}`): string {
    return `${this.chainId}-${contractAddress}`;
  }

  /**
   * 获取链ID
   */
  getChainId(): number {
    return this.chainId;
  }

  /**
   * 获取性能监控器
   */
  getPerformanceMonitor() {
    return multiChainPerformanceManager.getChainMonitor(this.chainId);
  }
}

// 导出单例管理器
class EventIndexingServiceManager {
  private services: Map<number, EventIndexingService> = new Map();

  getService(chainId: number, config?: Partial<EventIndexingConfig>): EventIndexingService {
    if (!this.services.has(chainId)) {
      this.services.set(chainId, new EventIndexingService(chainId, config));
    }
    return this.services.get(chainId)!;
  }

  removeService(chainId: number): void {
    this.services.delete(chainId);
  }

  getAllServices(): EventIndexingService[] {
    return Array.from(this.services.values());
  }
}

export const eventIndexingServiceManager = new EventIndexingServiceManager();