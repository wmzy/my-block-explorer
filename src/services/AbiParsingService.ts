/**
 * ABI Parsing Service
 * Handles ABI parsing, event signature extraction, and metadata management
 * Supports dynamic event table generation and parameter analysis
 */

import { createLogger } from '../server/logger';
import { Abi, AbiEvent, AbiParameter, Address, parseAbi } from 'viem';

const logger = createLogger('abi-parsing-service');
import { keccak256 } from 'viem/utils';
import { ChainDatabaseManager, multiChainDb } from '../database/chain-database-manager';
import { multiChainPerformanceManager } from '../database/performance-monitor';
import {
  EventParameter,
  TableColumn,
  ColumnType,
  DynamicTableSchema,
  TableIndex,
  EventIndexingError,
  DecodedEventParameter,
} from '../types/events';

/**
 * Parsed event information
 */
export interface ParsedEvent {
  name: string;
  signature: string;
  topic: `0x${string}`;
  inputs: EventParameter[];
  anonymous: boolean;
  tableName: string;
  tableSchema: DynamicTableSchema;
  metadata: EventMetadata;
}

/**
 * Event metadata
 */
export interface EventMetadata {
  contractAddress: Address;
  abiHash: string;
  parsedAt: Date;
  parameterCount: number;
  indexedParameterCount: number;
  complexityScore: number;
  estimatedRowSize: number;
  indexingRecommendations: string[];
}

/**
 * ABI parsing options
 */
export interface AbiParsingOptions {
  chainId: number;
  contractAddress: Address;
  tableNamePrefix?: string;
  maxTableNameLength?: number;
  generateTableSchemas?: boolean;
  calculateComplexity?: boolean;
}

/**
 * Event signature information
 */
export interface EventSignature {
  name: string;
  signature: string;
  topic: `0x${string}`;
  parameterTypes: string[];
  parameterNames: string[];
  indexedParams: number[];
  anonymous: boolean;
}

/**
 * ABI analysis result
 */
export interface AbiAnalysisResult {
  contractAddress: Address;
  chainId: number;
  totalEvents: number;
  events: ParsedEvent[];
  signatures: EventSignature[];
  estimatedStorageRequirements: {
    totalEvents: number;
    totalStorage: number;
    averageRowSize: number;
    recommendedIndexes: number;
  };
  complexityMetrics: {
    averageComplexity: number;
    maxComplexity: number;
    minComplexity: number;
    complexEvents: string[];
  };
}

/**
 * ABI Parsing Service
 * Provides comprehensive ABI parsing with schema generation and analysis
 */
export class AbiParsingService {
  private chainId: number;
  private chainDb: ChainDatabaseManager;
  private abiCache: Map<string, Abi> = new Map();
  private signatureCache: Map<string, EventSignature> = new Map();

  constructor(chainId: number) {
    this.chainId = chainId;
    this.chainDb = multiChainDb.getChainDatabaseSync(chainId);
  }

  /**
   * Parse ABI and extract all event information
   */
  async parseAbi(abi: Abi | string, options: AbiParsingOptions): Promise<AbiAnalysisResult> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      // Parse ABI if it's a string
      const parsedAbi = typeof abi === 'string' ? parseAbi(abi) : abi;

      // Extract events from ABI
      const events = parsedAbi.filter((item): item is AbiEvent => item.type === 'event');

      // Parse each event
      const parsedEvents: ParsedEvent[] = [];
      const signatures: EventSignature[] = [];
      let totalEstimatedStorage = 0;
      let totalComplexity = 0;

      for (const event of events) {
        try {
          const parsedEvent = await this.parseEvent(event, options);
          parsedEvents.push(parsedEvent);
          signatures.push(this.extractEventSignature(event));

          totalEstimatedStorage += parsedEvent.metadata.estimatedRowSize;
          totalComplexity += parsedEvent.metadata.complexityScore;
        }
        catch (error) {
          logger.warn({ err: error, eventName: event.name }, 'Failed to parse event');
        }
      }

      const averageComplexity = events.length > 0 ? totalComplexity / events.length : 0;
      const maxComplexity = Math.max(...parsedEvents.map(e => e.metadata.complexityScore), 0);
      const minComplexity = Math.min(...parsedEvents.map(e => e.metadata.complexityScore), 0);
      const complexEvents = parsedEvents
        .filter(e => e.metadata.complexityScore > averageComplexity * 1.5)
        .map(e => e.name);

      const result: AbiAnalysisResult = {
        contractAddress: options.contractAddress,
        chainId: options.chainId,
        totalEvents: events.length,
        events: parsedEvents,
        signatures,
        estimatedStorageRequirements: {
          totalEvents: 0, // Will be updated based on actual data
          totalStorage: totalEstimatedStorage,
          averageRowSize: events.length > 0 ? totalEstimatedStorage / events.length : 0,
          recommendedIndexes: this.calculateRecommendedIndexes(parsedEvents),
        },
        complexityMetrics: {
          averageComplexity,
          maxComplexity,
          minComplexity,
          complexEvents,
        },
      };

      const parseTime = performance.now() - startTime;
      performanceMonitor.recordQuery('abi_parse', parseTime, true);

      // Cache ABI and signatures
      this.cacheAbi(options.contractAddress, parsedAbi);
      this.cacheSignatures(signatures);

      return result;
    }
    catch (error) {
      const parseTime = performance.now() - startTime;
      performanceMonitor.recordQuery('abi_parse', parseTime, false);

      throw new EventIndexingError(
        `Failed to parse ABI: ${error}`,
        undefined,
        options.contractAddress,
        options.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Parse individual event
   */
  private async parseEvent(event: AbiEvent, options: AbiParsingOptions): Promise<ParsedEvent> {
    const tableName = this.generateTableName(event.name, options);
    const signature = this.generateEventSignature(event);
    const topic = this.generateEventTopic(signature);
    const parameters = this.parseEventParameters(event.inputs);
    const tableSchema = this.generateTableSchema(tableName, parameters, event);
    const metadata = await this.generateEventMetadata(event, options, tableSchema);

    return {
      name: event.name,
      signature,
      topic,
      inputs: parameters,
      anonymous: event.anonymous || false,
      tableName,
      tableSchema,
      metadata,
    };
  }

  /**
   * Parse event parameters from ABI
   */
  private parseEventParameters(inputs: AbiParameter[]): EventParameter[] {
    return inputs.map((input, index) => ({
      name: input.name || `param${index}`,
      type: input.type,
      indexed: input.indexed || false,
      internalType: input.internalType,
    }));
  }

  /**
   * Generate table name for event
   */
  private generateTableName(eventName: string, options: AbiParsingOptions): string {
    const prefix = options.tableNamePrefix || 'events';
    const maxLength = options.maxTableNameLength || 63;

    // Clean event name and create table name
    const cleanName = eventName
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^[0-9_]/, 'e_'); // Ensure it starts with letter
    const tableName = `${prefix}_${cleanName}`.toLowerCase();

    // Truncate if too long
    if (tableName.length > maxLength) {
      const hash = keccak256(tableName).slice(2, 10);
      return `${tableName.slice(0, maxLength - 9)}_${hash}`;
    }

    return tableName;
  }

  /**
   * Generate event signature
   */
  private generateEventSignature(event: AbiEvent): string {
    const types = event.inputs.map(input => input.type);
    return `${event.name}(${types.join(',')})`;
  }

  /**
   * Generate event topic (signature hash)
   */
  private generateEventTopic(signature: string): `0x${string}` {
    return keccak256(signature);
  }

  /**
   * Extract event signature information
   */
  private extractEventSignature(event: AbiEvent): EventSignature {
    const signature = this.generateEventSignature(event);
    const topic = this.generateEventTopic(signature);
    const parameterTypes = event.inputs.map(input => input.type);
    const parameterNames = event.inputs.map(input => input.name || `param${event.inputs.indexOf(input)}`);
    const indexedParams = event.inputs
      .map((input, index) => input.indexed ? index : -1)
      .filter(index => index !== -1);

    return {
      name: event.name,
      signature,
      topic,
      parameterTypes,
      parameterNames,
      indexedParams,
      anonymous: event.anonymous || false,
    };
  }

  /**
   * Generate table schema for event
   */
  private generateTableSchema(tableName: string, parameters: EventParameter[], event: AbiEvent): DynamicTableSchema {
    // Standard columns
    const standardColumns: TableColumn[] = [
      {
        name: 'block_hash',
        type: ColumnType.BLOCK_HASH,
        nullable: false,
        indexed: true,
      },
      {
        name: 'log_index',
        type: ColumnType.INTEGER,
        nullable: false,
        indexed: true,
      },
      {
        name: 'transaction_hash',
        type: ColumnType.TX_HASH,
        nullable: false,
        indexed: true,
      },
      {
        name: 'transaction_index',
        type: ColumnType.INTEGER,
        nullable: false,
      },
      {
        name: 'block_number',
        type: ColumnType.BIGNUM,
        nullable: false,
        indexed: true,
      },
      {
        name: 'block_timestamp',
        type: ColumnType.DATETIME,
        nullable: false,
        indexed: true,
      },
      {
        name: 'contract_address',
        type: ColumnType.ADDRESS,
        nullable: false,
        indexed: true,
      },
      {
        name: 'event_name',
        type: ColumnType.TEXT,
        nullable: false,
        indexed: true,
      },
      {
        name: 'event_signature',
        type: ColumnType.HASH32,
        nullable: false,
      },
      {
        name: 'indexed_at',
        type: ColumnType.DATETIME,
        nullable: false,
        indexed: true,
      },
    ];

    // Parameter columns
    const parameterColumns: TableColumn[] = parameters.map(param => ({
      name: param.name,
      type: this.mapAbiTypeToColumnType(param.type),
      nullable: true, // Event parameters can be null in some cases
      indexed: param.indexed,
    }));

    // Standard indexes
    const standardIndexes: TableIndex[] = [
      {
        name: `${tableName}_block_hash_idx`,
        columns: ['block_hash', 'log_index'],
        unique: true,
      },
      {
        name: `${tableName}_tx_hash_idx`,
        columns: ['transaction_hash'],
      },
      {
        name: `${tableName}_block_number_idx`,
        columns: ['block_number'],
      },
      {
        name: `${tableName}_timestamp_idx`,
        columns: ['block_timestamp'],
      },
      {
        name: `${tableName}_contract_address_idx`,
        columns: ['contract_address'],
      },
      {
        name: `${tableName}_event_name_idx`,
        columns: ['event_name'],
      },
    ];

    // Parameter indexes for indexed parameters
    const parameterIndexes: TableIndex[] = parameters
      .filter(param => param.indexed)
      .map(param => ({
        name: `${tableName}_${param.name}_idx`,
        columns: [param.name],
      }));

    return {
      tableName,
      columns: [...standardColumns, ...parameterColumns],
      indexes: [...standardIndexes, ...parameterIndexes],
    };
  }

  /**
   * Map ABI type to database column type
   */
  private mapAbiTypeToColumnType(abiType: string): ColumnType {
    // Handle arrays
    if (abiType.endsWith('[]')) {
      return ColumnType.TEXT; // Store arrays as JSON
    }

    // Handle fixed-size arrays
    if (abiType.match(/^\w+\[\d+\]$/)) {
      return ColumnType.TEXT; // Store fixed arrays as JSON
    }

    // Handle basic types
    switch (abiType) {
      case 'uint8':
      case 'uint16':
      case 'uint32':
      case 'uint64':
      case 'uint128':
      case 'uint256':
      case 'int8':
      case 'int16':
      case 'int32':
      case 'int64':
      case 'int128':
      case 'int256':
        return ColumnType.BIGNUM;

      case 'bool':
        return ColumnType.BOOLEAN;

      case 'address':
        return ColumnType.ADDRESS;

      case 'string':
        return ColumnType.TEXT;

      case 'bytes':
      case 'bytes1':
      case 'bytes2':
      case 'bytes3':
      case 'bytes4':
      case 'bytes8':
      case 'bytes16':
      case 'bytes32':
        return abiType === 'bytes32' ? ColumnType.HASH32 : ColumnType.HEX_DATA;

      default:
        // Handle tuples and custom types
        if (abiType.startsWith('tuple') || abiType.includes('(')) {
          return ColumnType.TEXT; // Store complex types as JSON
        }
        // Default to text for unknown types
        return ColumnType.TEXT;
    }
  }

  /**
   * Generate event metadata
   */
  private async generateEventMetadata(
    event: AbiEvent,
    options: AbiParsingOptions,
    tableSchema: DynamicTableSchema,
  ): Promise<EventMetadata> {
    const abiHash = keccak256(JSON.stringify(event));
    const parameterCount = event.inputs.length;
    const indexedParameterCount = event.inputs.filter(input => input.indexed).length;
    const complexityScore = this.calculateEventComplexity(event);
    const estimatedRowSize = this.estimateRowSize(tableSchema);
    const indexingRecommendations = this.generateIndexingRecommendations(event, tableSchema);

    return {
      contractAddress: options.contractAddress,
      abiHash,
      parsedAt: new Date(),
      parameterCount,
      indexedParameterCount,
      complexityScore,
      estimatedRowSize,
      indexingRecommendations,
    };
  }

  /**
   * Calculate event complexity score
   */
  private calculateEventComplexity(event: AbiEvent): number {
    let score = 0;

    // Base score for parameter count
    score += event.inputs.length * 10;

    // Additional score for complex types
    for (const input of event.inputs) {
      // Arrays increase complexity
      if (input.type.endsWith('[]') || input.type.match(/^\w+\[\d+\]$/)) {
        score += 20;
      }

      // Large types increase complexity
      if (input.type.includes('256')) {
        score += 5;
      }

      // Tuples/structs increase complexity
      if (input.type.startsWith('tuple') || input.type.includes('(')) {
        score += 30;
      }

      // String types increase complexity
      if (input.type === 'string') {
        score += 15;
      }

      // Bytes types increase complexity
      if (input.type.startsWith('bytes')) {
        score += 10;
      }
    }

    // Indexed parameters affect complexity
    const indexedCount = event.inputs.filter(input => input.indexed).length;
    score += indexedCount * 5;

    // Anonymous events are slightly more complex
    if (event.anonymous) {
      score += 5;
    }

    return score;
  }

  /**
   * Estimate row size for table
   */
  private estimateRowSize(schema: DynamicTableSchema): number {
    let totalSize = 0;

    for (const column of schema.columns) {
      switch (column.type) {
        case ColumnType.INTEGER:
          totalSize += 8; // 8 bytes for integer
          break;
        case ColumnType.BIGNUM:
          totalSize += 32; // 32 bytes for big numbers
          break;
        case ColumnType.BOOLEAN:
          totalSize += 1; // 1 byte for boolean
          break;
        case ColumnType.ADDRESS:
          totalSize += 20; // 20 bytes for address
          break;
        case ColumnType.TX_HASH:
        case ColumnType.BLOCK_HASH:
        case ColumnType.HASH32:
          totalSize += 32; // 32 bytes for hashes
          break;
        case ColumnType.HEX_DATA:
          totalSize += 64; // Estimated average size
          break;
        case ColumnType.TEXT:
          totalSize += 256; // Estimated average text size
          break;
        case ColumnType.TIMESTAMP:
        case ColumnType.DATETIME:
          totalSize += 8; // 8 bytes for timestamps
          break;
      }
    }

    // Add overhead for indexes and metadata
    totalSize += 50;

    return totalSize;
  }

  /**
   * Generate indexing recommendations
   */
  private generateIndexingRecommendations(event: AbiEvent, schema: DynamicTableSchema): string[] {
    const recommendations: string[] = [];

    // Check for high-cardinality parameters
    for (const input of event.inputs) {
      if (input.indexed && (input.type === 'address' || input.type.includes('256'))) {
        recommendations.push(`Consider creating composite index with ${input.name} and block_number`);
      }
    }

    // Check for time-based queries
    recommendations.push('Create time-based index on block_timestamp for range queries');

    // Check for filtering patterns
    if (event.inputs.length > 5) {
      recommendations.push('Consider partial indexing for frequently filtered parameters');
    }

    // Storage recommendations
    if (schema.columns.length > 20) {
      recommendations.push('Consider table partitioning for large schemas');
    }

    return recommendations;
  }

  /**
   * Calculate recommended indexes
   */
  private calculateRecommendedIndexes(events: ParsedEvent[]): number {
    const indexTypes = new Set<string>();

    for (const event of events) {
      for (const index of event.tableSchema.indexes) {
        indexTypes.add(index.name);
      }
    }

    return indexTypes.size;
  }

  /**
   * Extract all event signatures from ABI
   */
  extractEventSignatures(abi: Abi | string): EventSignature[] {
    const parsedAbi = typeof abi === 'string' ? parseAbi(abi) : abi;
    const events = parsedAbi.filter((item): item is AbiEvent => item.type === 'event');

    return events.map(event => this.extractEventSignature(event));
  }

  /**
   * Find event by signature or topic
   */
  findEventBySignature(signatureOrTopic: string): EventSignature | null {
    // Check cache first
    const cached = this.signatureCache.get(signatureOrTopic);
    if (cached) return cached;

    // Search through all cached signatures
    for (const signature of this.signatureCache.values()) {
      if (signature.signature === signatureOrTopic || signature.topic === signatureOrTopic) {
        return signature;
      }
    }

    return null;
  }

  /**
   * Validate ABI format
   */
  validateAbi(abi: Abi | string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      const parsedAbi = typeof abi === 'string' ? parseAbi(abi) : abi;

      if (!Array.isArray(parsedAbi)) {
        errors.push('ABI must be an array');
        return { valid: false, errors };
      }

      // Validate each item
      for (const [index, item] of parsedAbi.entries()) {
        if (!item.type) {
          errors.push(`Item ${index}: Missing type field`);
        }

        if (item.type === 'event') {
          const event = item as AbiEvent;
          if (!event.name) {
            errors.push(`Item ${index}: Event missing name field`);
          }

          if (!Array.isArray(event.inputs)) {
            errors.push(`Item ${index}: Event inputs must be an array`);
          }

          // Validate inputs
          for (const [inputIndex, input] of (event.inputs || []).entries()) {
            if (!input.type) {
              errors.push(`Item ${index}, Input ${inputIndex}: Missing type field`);
            }
          }
        }
      }
    }
    catch (error) {
      errors.push(`Failed to parse ABI: ${error}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get ABI hash for comparison
   */
  getAbiHash(abi: Abi | string): string {
    const parsedAbi = typeof abi === 'string' ? parseAbi(abi) : abi;
    return keccak256(JSON.stringify(parsedAbi));
  }

  /**
   * Check if ABI has changed
   */
  async hasAbiChanged(contractAddress: Address, abi: Abi | string): Promise<boolean> {
    const currentHash = this.getAbiHash(abi);

    try {
      const result = await this.chainDb.query(
        'SELECT abi_hash FROM contract_abi_cache WHERE contract_address = ?',
        [contractAddress.toLowerCase()],
      );

      if (result.length === 0) {
        return true; // New contract
      }

      return result[0].abi_hash !== currentHash;
    }
    catch {
      return true; // Assume changed on error
    }
  }

  /**
   * Cache ABI in memory
   */
  private cacheAbi(contractAddress: Address, abi: Abi): void {
    this.abiCache.set(contractAddress.toLowerCase(), abi);
  }

  /**
   * Cache event signatures
   */
  private cacheSignatures(signatures: EventSignature[]): void {
    for (const signature of signatures) {
      this.signatureCache.set(signature.signature, signature);
      this.signatureCache.set(signature.topic, signature);
      this.signatureCache.set(signature.name, signature);
    }
  }

  /**
   * Clear cache for contract
   */
  clearCache(contractAddress: Address): void {
    this.abiCache.delete(contractAddress.toLowerCase());
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.abiCache.clear();
    this.signatureCache.clear();
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
}

// Export singleton manager
class AbiParsingServiceManager {
  private services: Map<number, AbiParsingService> = new Map();

  getService(chainId: number): AbiParsingService {
    if (!this.services.has(chainId)) {
      this.services.set(chainId, new AbiParsingService(chainId));
    }
    return this.services.get(chainId)!;
  }

  removeService(chainId: number): void {
    this.services.delete(chainId);
  }

  getAllServices(): AbiParsingService[] {
    return Array.from(this.services.values());
  }

  clearAllCaches(): void {
    this.services.forEach(service => service.clearAllCaches());
  }
}

export const abiParsingServiceManager = new AbiParsingServiceManager();
