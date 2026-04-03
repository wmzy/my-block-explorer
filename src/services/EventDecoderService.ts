/**
 * Event Decoder Service
 * Handles event log decoding using Viem's decodeEventLog functionality
 * Supports multiple chains and event parameter formatting
 */

import { decodeEventLog, formatUnits, Abi, AbiEvent, Address, Log } from 'viem';
import { eq } from 'drizzle-orm';
import { multiChainDb, ChainDatabaseManager } from '../database/chain-database-manager';
import { blocks } from '../database/chain-schema';
import { ChainEventTableManager } from '../database/chain-event-table-manager';
import { multiChainPerformanceManager } from '../database/performance-monitor';
import { EventDecodingError, DecodedEventLog, DecodedEventParameter } from '../types/events';

/**
 * Event decoding options
 */
export interface EventDecodingOptions {
  chainId: number;
  contractAddress: Address;
  abi: Abi;
  strict?: boolean; // Whether to throw on unknown events
}

/**
 * Decoded event with formatted parameters
 */
export interface FormattedDecodedEvent {
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: string;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  contractAddress: Address;
  eventName: string;
  eventSignature: string;
  parameters: Record<string, unknown>;
  rawParameters: Record<string, unknown>;
  decodedData: DecodedEventLog;
}

/**
 * Parameter formatting options
 */
export interface ParameterFormattingOptions {
  formatAddresses?: boolean; // Shorten addresses
  formatUnits?: boolean; // Format numeric values with units
  dateFormat?: 'iso' | 'relative' | 'both'; // Date formatting
  precision?: number; // Decimal precision for formatted values
}

/**
 * Event Decoder Service
 * Provides high-performance event log decoding with parameter formatting
 */
export class EventDecoderService {
  private chainId: number;
  private chainDb: ChainDatabaseManager;
  private eventTableManager: ChainEventTableManager;
  private abiCache: Map<string, AbiEvent[]> = new Map();

  constructor(chainId: number) {
    this.chainId = chainId;
    this.chainDb = multiChainDb.getChainDatabaseSync(chainId);
    this.eventTableManager = new ChainEventTableManager(this.chainDb);
  }

  /**
   * Decode a single event log
   */
  async decodeEventLog(
    log: Log,
    options: EventDecodingOptions,
  ): Promise<FormattedDecodedEvent | null> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      const { abi, strict = false } = options;

      // Decode the event log using Viem
      const decodedLog = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
        strict,
      });

      if (!decodedLog) {
        if (strict) {
          throw new EventDecodingError(
            'Unknown event signature',
            log.blockHash ?? undefined,
            log.logIndex ?? undefined,
            this.chainId,
            new Error('Event signature not found in ABI'),
          );
        }
        return null;
      }

      // Format the decoded event
      const formattedEvent = await this.formatDecodedEvent(log, decodedLog, options);

      const decodeTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_decode', decodeTime, true);

      return formattedEvent;
    } catch (error) {
      const decodeTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_decode', decodeTime, false);

      throw new EventDecodingError(
        `Failed to decode event log: ${error}`,
        log.blockHash ?? undefined,
        log.logIndex ?? undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Decode multiple event logs in batch
   */
  async decodeEventLogsBatch(
    logs: Log[],
    options: EventDecodingOptions,
  ): Promise<FormattedDecodedEvent[]> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      const results: FormattedDecodedEvent[] = [];
      const errors: Array<{ log: Log; error: Error }> = [];

      // Process logs in parallel batches for better performance
      const batchSize = 50;
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);

        const batchPromises = batch.map(async log => {
          try {
            const decoded = await this.decodeEventLog(log, options);
            return decoded;
          } catch (error) {
            errors.push({ log, error: error instanceof Error ? error : new Error(String(error)) });
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(
          ...batchResults.filter((event): event is FormattedDecodedEvent => event !== null),
        );
      }

      const decodeTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_decode_batch', decodeTime, true);

      // Log errors for debugging
      if (errors.length > 0) {
        console.warn(`Failed to decode ${errors.length} events out of ${logs.length}:`, errors);
      }

      return results;
    } catch (error) {
      const decodeTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_decode_batch', decodeTime, false);

      throw new EventDecodingError(
        `Failed to decode event logs batch: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Format decoded event for display
   */
  private async formatDecodedEvent(
    log: Log,
    decodedLog: unknown,
    options: EventDecodingOptions,
  ): Promise<FormattedDecodedEvent> {
    // Validate required log properties
    if (
      log.blockNumber === null ||
      log.logIndex === null ||
      log.transactionHash === null ||
      log.transactionIndex === null
    ) {
      throw new EventDecodingError(
        'Missing required log properties',
        log.blockHash ?? undefined,
        log.logIndex ?? undefined,
        this.chainId,
        new Error('Log is missing blockNumber, logIndex, transactionHash, or transactionIndex'),
      );
    }

    // Get block timestamp
    const blockTimestamp = await this.getBlockTimestamp(log.blockNumber);

    // Format parameters
    const decoded = decodedLog as DecodedEventLog;
    const formattedParameters = this.formatEventParameters(
      decoded.args ?? {},
      decoded.eventName,
      options,
    );

    return {
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      blockTimestamp,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      contractAddress: log.address,
      eventName: decoded.eventName,
      eventSignature: this.getEventSignature(decoded.eventName, decoded.args ?? {}),
      parameters: formattedParameters,
      rawParameters: decoded.args ?? {},
      decodedData: decoded,
    };
  }

  /**
   * Format event parameters based on their types
   */
  private formatEventParameters(
    args: Record<string, unknown>,
    eventName: string,
    options: EventDecodingOptions,
    formattingOptions: ParameterFormattingOptions = {
      formatAddresses: true,
      formatUnits: true,
      dateFormat: 'iso',
      precision: 6,
    },
  ): Record<string, unknown> {
    const formatted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      try {
        formatted[key] = this.formatParameterValue(value, formattingOptions);
      } catch (error) {
        console.warn(`Failed to format parameter ${key} for event ${eventName}:`, error);
        formatted[key] = value; // Fallback to raw value
      }
    }

    return formatted;
  }

  /**
   * Format individual parameter value based on its type
   */
  private formatParameterValue(value: unknown, options: ParameterFormattingOptions): unknown {
    // Handle null/undefined values
    if (value === null || value === undefined) {
      return value;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map(item => this.formatParameterValue(item, options));
    }

    // Handle different value types
    if (typeof value === 'bigint') {
      return options.formatUnits
        ? Number(formatUnits(value, 18)).toFixed(options.precision)
        : value.toString();
    }

    if (typeof value === 'string') {
      // Handle addresses
      if (value.startsWith('0x') && value.length === 42) {
        return options.formatAddresses ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
      }

      // Handle transaction hashes
      if (value.startsWith('0x') && value.length === 66) {
        return `${value.slice(0, 10)}...${value.slice(-8)}`;
      }

      return value;
    }

    if (typeof value === 'object') {
      // Handle nested objects
      const formatted: Record<string, unknown> = {};
      for (const [objKey, objValue] of Object.entries(value)) {
        formatted[objKey] = this.formatParameterValue(objValue, options);
      }
      return formatted;
    }

    return value;
  }

  /**
   * Get event signature string
   */
  private getEventSignature(eventName: string, args: Record<string, unknown>): string {
    const paramTypes = Object.values(args).map(value => {
      if (typeof value === 'bigint') return 'uint256';
      if (typeof value === 'string' && value.startsWith('0x')) {
        return value.length === 42 ? 'address' : 'bytes';
      }
      if (Array.isArray(value)) return 'array';
      return typeof value;
    });

    return `${eventName}(${paramTypes.join(',')})`;
  }

  /**
   * Get block timestamp from database or blockchain
   */
  private async getBlockTimestamp(blockNumber: bigint): Promise<string> {
    try {
      const db = this.chainDb.getDrizzle();
      const result = await db
        .select({ timestamp: blocks.timestamp })
        .from(blocks)
        .where(eq(blocks.number, blockNumber))
        .limit(1);
      if (result.length > 0 && result[0].timestamp) {
        return new Date(result[0].timestamp).toISOString();
      }
      return new Date().toISOString();
    } catch (error) {
      console.warn('Failed to get block timestamp:', error);
      return new Date().toISOString();
    }
  }

  /**
   * Cache ABI events for faster lookups
   */
  private cacheAbiEvents(contractAddress: Address, abi: Abi): void {
    const events = abi.filter((item): item is AbiEvent => item.type === 'event');
    this.abiCache.set(contractAddress.toLowerCase(), events);
  }

  /**
   * Get cached ABI events for a contract
   */
  private getCachedAbiEvents(contractAddress: Address): AbiEvent[] {
    return this.abiCache.get(contractAddress.toLowerCase()) ?? [];
  }

  /**
   * Decode event parameters from raw log data
   */
  async decodeEventParameters(
    log: Log,
    eventAbi: AbiEvent,
    formattingOptions?: ParameterFormattingOptions,
  ): Promise<DecodedEventParameter[]> {
    try {
      const decodedLog = decodeEventLog({
        abi: [eventAbi],
        data: log.data,
        topics: log.topics,
      });

      if (!decodedLog?.args) {
        throw new Error('Failed to decode event parameters');
      }

      const parameters: DecodedEventParameter[] = [];

      for (const [name, value] of Object.entries(decodedLog.args)) {
        if (name === '__length__') continue; // Skip internal length property

        const input = eventAbi.inputs.find(input => input.name === name);
        if (!input) continue;

        const formattedValue = this.formatParameterValue(
          value,
          formattingOptions ?? {
            formatAddresses: true,
            formatUnits: true,
            dateFormat: 'iso',
            precision: 6,
          },
        );

        parameters.push({
          name,
          type: input.type,
          value: formattedValue,
          rawValue: value,
          indexed: input.indexed ?? false,
        });
      }

      return parameters;
    } catch (error) {
      throw new EventDecodingError(
        `Failed to decode event parameters: ${error}`,
        log.blockHash ?? undefined,
        log.logIndex ?? undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Get event ABI by signature
   */
  getEventAbiBySignature(contractAddress: Address, eventSignature: string): AbiEvent | null {
    const events = this.getCachedAbiEvents(contractAddress);

    for (const event of events) {
      const signature = this.getEventSignature(event.name, {});
      if (signature === eventSignature) {
        return event;
      }
    }

    return null;
  }

  /**
   * Validate event log against ABI
   */
  validateEventLog(log: Log, abi: Abi): boolean {
    try {
      const decodedLog = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });

      return decodedLog !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get chain ID
   */
  getChainId(): number {
    return this.chainId;
  }

  /**
   * Get performance monitor
   */
  getPerformanceMonitor() {
    return multiChainPerformanceManager.getChainMonitor(this.chainId);
  }

  /**
   * Clear ABI cache for a contract
   */
  clearAbiCache(contractAddress: Address): void {
    this.abiCache.delete(contractAddress.toLowerCase());
  }

  /**
   * Clear all ABI caches
   */
  clearAllAbiCaches(): void {
    this.abiCache.clear();
  }
}

// Export singleton manager
class EventDecoderServiceManager {
  private services: Map<number, EventDecoderService> = new Map();

  getService(chainId: number): EventDecoderService {
    if (!this.services.has(chainId)) {
      this.services.set(chainId, new EventDecoderService(chainId));
    }
    return this.services.get(chainId)!;
  }

  removeService(chainId: number): void {
    this.services.delete(chainId);
  }

  getAllServices(): EventDecoderService[] {
    return Array.from(this.services.values());
  }

  clearAllCaches(): void {
    this.services.forEach(service => service.clearAllAbiCaches());
  }
}

export const eventDecoderServiceManager = new EventDecoderServiceManager();
