/**
 * ABI event-related type definitions
 * Supports dynamic table schema generation and event decoding
 */

// ============================================
// Block tag types
// ============================================

/**
 * Negative sentinel values for special block tags
 * -1 = latest (most recent block)
 * -2 = finalized (finalized block)
 * -3 = safe (safe block)
 * -4 = earliest (genesis block)
 */
export type BlockTagSentinel = -1 | -2 | -3 | -4;

/**
 * Supported block tags
 */
export type BlockTag = 'latest' | 'finalized' | 'safe' | 'earliest';

/**
 * Block tag sentinel constants
 */
export const BLOCK_TAG_SENTINELS: Record<BlockTag, BlockTagSentinel> = {
  latest: -1,
  finalized: -2,
  safe: -3,
  earliest: -4,
} as const;

/**
 * Reverse mapping from sentinels to block tags
 */
export const SENTINEL_TO_TAG: Record<BlockTagSentinel, BlockTag> = {
  [-1]: 'latest',
  [-2]: 'finalized',
  [-3]: 'safe',
  [-4]: 'earliest',
} as const;

/**
 * Block value types accepted by the API
 * Either a number (block number) or a string tag
 */
export type BlockTagInput = number | BlockTag;

// ============================================
// Event ABI shape used for table creation (per-chain table management)
// ============================================

// Event ABI shape used for table creation (per-chain table management)
export type EventAbiShape = {
  name: string;
  type: string;
  inputs: EventParameter[];
};

// Base event parameter type
export type EventParameter = {
  name: string;
  type: string;
  indexed: boolean;
  internalType?: string;
};

// Decoded event data
export type DecodedEventData = Record<string, unknown>;

// Decoded event log (viem-compatible)
export type DecodedEventLog = {
  eventName: string;
  args: Record<string, unknown>;
  eventSignature?: string;
};

// Decoded event parameter
export type DecodedEventParameter = {
  name: string;
  type: string;
  value: unknown;
  rawValue: unknown;
  indexed: boolean;
};

// Formatted event data as stored (no chainId field within a chain)
export type FormattedEventData = {
  // Common fields
  txHash: `0x${string}`;
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  contractAddress: `0x${string}`;
  eventSignature: `0x${string}`;
  blockTimestamp: number;
  indexedAt: Date;

  // Decoded argument data
  [paramName: string]: unknown;
};

// Dynamic table schema definitions
export type DynamicTableSchema = {
  tableName: string;
  columns: TableColumn[];
  indexes: TableIndex[];
};

// Table column definitions
export type TableColumn = {
  name: string;
  type: ColumnType;
  nullable: boolean;
  indexed?: boolean;
  unique?: boolean;
  defaultValue?: unknown;
};

// Column type enum
export enum ColumnType {
  INTEGER = 'integer',
  BIGNUM = 'bignum',
  BOOLEAN = 'boolean',
  ADDRESS = 'address',
  TX_HASH = 'txHash',
  BLOCK_HASH = 'blockHash',
  HASH32 = 'hash32',
  HEX_DATA = 'hexData',
  TEXT = 'text',
  TIMESTAMP = 'timestamp',
  DATETIME = 'datetime',
}

// Table index definitions
export type TableIndex = {
  name: string;
  columns: string[];
  unique?: boolean;
  type?: 'btree' | 'hash';
};

// Event query filter (per-chain query; no chainId)
export type EventFilters = {
  contractAddress?: `0x${string}`;
  fromBlock?: bigint | number;
  toBlock?: bigint | number;
  fromTimestamp?: number;
  toTimestamp?: number;
  topics?: (`0x${string}` | null)[];
  // Dynamic argument filters
  [paramName: string]: unknown;
};

// Pagination parameters
export type PaginationParams = {
  limit: number;
  offset?: number;
  cursor?: string;
  direction?: 'asc' | 'desc';
};

// Paginated result
export type PaginatedResult<T> = {
  data: T[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
};

// Event indexing configuration
export type EventIndexingConfig = {
  // Table configuration
  tableNamePrefix: string;
  maxTableNameLength: number;

  // Performance configuration
  batchSize: number;
  maxConcurrency: number;

  // Storage configuration
  compressionEnabled: boolean;
  partitioningEnabled: boolean;
  retentionDays: number;

  // Indexing configuration
  autoCreateIndexes: boolean;
  indexThreshold: number;

  // Monitoring configuration
  metricsEnabled: boolean;
  errorTracking: boolean;
};

// ABI type to database type mapping configuration
export type TypeMappingConfig = {
  // Base type mapping
  basicTypes: Record<string, ColumnType>;

  // Array type mapping
  arrayTypes: Record<string, ColumnType>;

  // Struct type mapping
  structTypes: Record<string, ColumnType>;

  // Custom type mapping
  customTypes: Record<string, ColumnType>;
};

// Event indexing error
export class EventIndexingError extends Error {
  constructor(
    message: string,
    public readonly eventName?: string,
    public readonly contractAddress?: `0x${string}`,
    public readonly chainId?: number,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'EventIndexingError';
  }
}

// Event decoding error
export class EventDecodingError extends Error {
  constructor(
    message: string,
    public readonly blockHash?: string,
    public readonly logIndex?: number,
    public readonly chainId?: number,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'EventDecodingError';
  }
}

// Table creation error
export class TableCreationError extends Error {
  constructor(
    message: string,
    public readonly tableName: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'TableCreationError';
  }
}

// Event indexing status
export type EventIndexingStatus = {
  contractAddress: `0x${string}`;
  chainId: number;
  eventSignatures: string[];
  lastIndexedBlock: bigint;
  totalEventsIndexed: number;
  indexingActive: boolean;
  lastIndexedAt: Date;
  errors: EventIndexingError[];
};

// Multi-chain type definitions

// Chain-specific configuration
export type ChainSpecificConfig = {
  chainId: number;
  chainName: string;
  chainType: string;
  databasePath: string;
  indexingEnabled: boolean;
  maxHistoricalBlocks: number;
  eventBatchSize: number;
};

// Multi-chain event indexing status
export type MultiChainIndexingStatus = {
  chainId: number;
  chainName: string;
  isInitialized: boolean;
  isIndexing: boolean;
  lastIndexedBlock?: bigint;
  totalEventsIndexed: number;
  indexingProgress: number; // 0-100
  estimatedTimeRemaining?: number; // seconds
  errors: EventIndexingError[];
};

// Cross-chain event query (for API aggregation; direct cross-chain queries are unsupported)
export type CrossChainEventQuery = {
  chainIds: number[];
  filters: Omit<EventFilters, 'contractAddress'> & {
    contractAddresses?: Record<number, `0x${string}`[]>; // contract addresses grouped by chain
  };
  pagination: PaginationParams;
};

// Cross-chain event result
export type CrossChainEventResult = {
  chainId: number;
  chainName: string;
  events: FormattedEventData[];
  total: number;
  hasMore: boolean;
  errors?: string[];
};

// Chain database status
export type ChainDatabaseStatus = {
  chainId: number;
  chainName: string;
  chainType: string;
  databasePath: string;
  isInitialized: boolean;
  fileExists: boolean;
  fileSize: number; // bytes
  tableCount: number;
  totalEvents: number;
  lastIndexedAt?: Date;
  indexingActive: boolean;
};

// Multi-chain configuration
export type MultiChainConfig = {
  // Supported chain list
  supportedChains: number[];

  // Default configuration
  defaultConfig: Partial<ChainSpecificConfig>;

  // Performance configuration
  maxConcurrentChains: number;
  chainConnectionTimeout: number;

  // Storage configuration
  baseDataDirectory: string;
  databaseFilePattern: string; // e.g., "{chainType}/{chainName}-{chainId}.db"

  // Indexing configuration
  indexingConfig: EventIndexingConfig;
};

// Chain event table registration info
export type ChainEventTableRegistry = {
  chainId: number;
  contractAddress: `0x${string}`;
  eventSignature: string;
  eventName: string;
  tableName: string;
  tableSchema: DynamicTableSchema;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastAccessed?: Date;
  eventCount: number;
};

// Multi-chain statistics
export type MultiChainStatistics = {
  totalChains: number;
  activeChains: number;
  totalEvents: number;
  totalTables: number;
  totalDatabaseSize: number;
  chainStats: Array<{
    chainId: number;
    chainName: string;
    eventCount: number;
    tableCount: number;
    databaseSize: number;
    lastIndexedAt?: Date;
  }>;
};

// Event indexing task
export type EventIndexingTask = {
  taskId: string;
  chainId: number;
  contractAddress: `0x${string}`;
  eventSignatures: string[];
  fromBlock: bigint;
  toBlock?: bigint;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  progress: number; // 0-100
  startedAt?: Date;
  completedAt?: Date;
  errorCount: number;
  lastError?: string;
  estimatedTimeRemaining?: number;
};

// Multi-chain event stream manager
export type MultiChainEventStreamManager = {
  // Register a chain event stream
  registerChain(chainId: number, config: ChainSpecificConfig): void;

  // Start/stop a chain's event stream
  startChainStream(chainId: number): Promise<void>;
  stopChainStream(chainId: number): Promise<void>;

  // Get stream status
  getStreamStatus(chainId: number): StreamStatus;

  // Handle cross-chain events
  handleCrossChainEvents(events: CrossChainEventResult[]): Promise<void>;
};

// Stream status
export type StreamStatus = {
  chainId: number;
  isActive: boolean;
  connected: boolean;
  lastBlockNumber?: bigint;
  lastEventTime?: Date;
  eventsProcessed: number;
  errors: string[];
};

// Database migration info
export type ChainMigrationInfo = {
  chainId: number;
  version: string;
  migratedAt: Date;
  migrationType: 'schema' | 'data' | 'full';
  status: 'pending' | 'running' | 'completed' | 'failed';
  description: string;
};

// Multi-chain error types
export class MultiChainError extends Error {
  constructor(
    message: string,
    public readonly chainId?: number,
    public readonly operation?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'MultiChainError';
  }
}

// Chain configuration error
export class ChainConfigError extends MultiChainError {
  constructor(
    message: string,
    chainId: number,
    public readonly configField?: string,
    cause?: Error,
  ) {
    super(message, chainId, 'config', cause);
    this.name = 'ChainConfigError';
  }
}

// Chain database error
export class ChainDatabaseError extends MultiChainError {
  constructor(
    message: string,
    chainId: number,
    public readonly databasePath?: string,
    cause?: Error,
  ) {
    super(message, chainId, 'database', cause);
    this.name = 'ChainDatabaseError';
  }
}

// Event statistics
export type EventStatistics = {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByBlockRange: {
    from: bigint;
    to: bigint;
    count: number;
  }[];
  averageEventsPerBlock: number;
  uniqueAddresses: number;
  storageSize: number;
  lastIndexedBlock?: number;
  lastIndexedAt?: string;
};

// Event data validator
export type EventDataValidator = {
  validate(param: EventParameter, value: unknown): ValidationResult;
};

// Validation result
export type ValidationResult = {
  valid: boolean;
  error?: string;
  sanitizedValue?: unknown;
};

// Event data converter
export type EventDataTransformer = {
  transform(param: EventParameter, value: unknown): unknown;
  reverseTransform(param: EventParameter, value: unknown): unknown;
};

// Storage strategy interface
export type StorageStrategy = {
  shouldStoreAsJson(param: EventParameter): boolean;
  getColumnType(param: EventParameter): ColumnType;
  formatValue(param: EventParameter, value: unknown): unknown;
  parseValue(param: EventParameter, value: unknown): unknown;
};

// Batch operations
export type BatchOperation<T> = {
  items: T[];
  batchSize: number;
  maxRetries: number;
  timeout: number;
  onProgress?: (processed: number, total: number) => void;
  onError?: (error: Error, item: T) => void;
};

// Event stream processor
export type EventStreamProcessor = {
  process(events: DecodedEvent[]): Promise<void>;
  onEvent?: (event: DecodedEvent) => void;
  onError?: (error: Error, event: DecodedEvent) => void;
  onComplete?: (stats: EventStatistics) => void;
};

// Decoded event
export type DecodedEvent = {
  // Basic info
  chainId: number;
  contractAddress: `0x${string}`;
  eventName: string;
  eventSignature: `0x${string}`;

  // Transaction info
  txHash: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;

  // Timestamp info — null when the block timestamp could not be fetched; never a
  // fabricated placeholder.
  blockTimestamp: number | null;

  // Decoded data
  args: DecodedEventData;
  rawTopics: readonly `0x${string}`[];
  rawData: `0x${string}`;

  // Processing info
  indexedAt: Date;
  processingErrors?: string[];
};

// Default configuration
export const DEFAULT_EVENT_INDEXING_CONFIG: EventIndexingConfig = {
  tableNamePrefix: 'events',
  maxTableNameLength: 63,
  batchSize: 1000,
  maxConcurrency: 5,
  compressionEnabled: true,
  partitioningEnabled: false,
  retentionDays: 365,
  autoCreateIndexes: true,
  indexThreshold: 10000,
  metricsEnabled: true,
  errorTracking: true,
};

// Default type mapping
export const DEFAULT_TYPE_MAPPING: TypeMappingConfig = {
  basicTypes: {
    uint8: ColumnType.BIGNUM,
    uint16: ColumnType.BIGNUM,
    uint32: ColumnType.BIGNUM,
    uint64: ColumnType.BIGNUM,
    uint128: ColumnType.BIGNUM,
    uint256: ColumnType.BIGNUM,
    int8: ColumnType.BIGNUM,
    int16: ColumnType.BIGNUM,
    int32: ColumnType.BIGNUM,
    int64: ColumnType.BIGNUM,
    int128: ColumnType.BIGNUM,
    int256: ColumnType.BIGNUM,
    bool: ColumnType.BOOLEAN,
    address: ColumnType.ADDRESS,
    string: ColumnType.TEXT,
    bytes: ColumnType.HEX_DATA,
    bytes1: ColumnType.HEX_DATA,
    bytes4: ColumnType.HEX_DATA,
    bytes8: ColumnType.HEX_DATA,
    bytes16: ColumnType.HEX_DATA,
    bytes32: ColumnType.HASH32,
  },

  arrayTypes: {
    'uint8[]': ColumnType.TEXT,
    'uint256[]': ColumnType.TEXT,
    'address[]': ColumnType.TEXT,
    'bytes32[]': ColumnType.TEXT,
    'string[]': ColumnType.TEXT,
  },

  structTypes: {
    tuple: ColumnType.TEXT,
  },

  customTypes: {},
};
