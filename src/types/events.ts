/**
 * ABI事件相关类型定义
 * 支持动态表结构生成和事件解码
 */

// 用于表创建的事件 ABI 形状（链内表管理）
export type EventAbiShape = {
  name: string;
  type: string;
  inputs: EventParameter[];
};

// 事件参数基础类型
export type EventParameter = {
  name: string;
  type: string;
  indexed: boolean;
  internalType?: string;
};

// 解码后的事件数据
export type DecodedEventData = Record<string, unknown>;

// 解码后的事件日志（Viem兼容）
export type DecodedEventLog = {
  eventName: string;
  args: Record<string, unknown>;
  eventSignature?: string;
};

// 解码后的事件参数
export type DecodedEventParameter = {
  name: string;
  type: string;
  value: unknown;
  rawValue: unknown;
  indexed: boolean;
};

// 存储格式化后的事件数据（链内无chainId字段）
export type FormattedEventData = {
  // 通用字段
  txHash: `0x${string}`;
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  contractAddress: `0x${string}`;
  eventSignature: `0x${string}`;
  blockTimestamp: number;
  indexedAt: Date;

  // 解码后的参数数据
  [paramName: string]: unknown;
};

// 动态表结构定义
export type DynamicTableSchema = {
  tableName: string;
  columns: TableColumn[];
  indexes: TableIndex[];
}

// 表列定义
export type TableColumn = {
  name: string;
  type: ColumnType;
  nullable: boolean;
  indexed?: boolean;
  unique?: boolean;
  defaultValue?: unknown;
};

// 列类型枚举
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

// 表索引定义
export type TableIndex = {
  name: string;
  columns: string[];
  unique?: boolean;
  type?: 'btree' | 'hash';
};

// 事件查询过滤器（链内查询，无chainId）
export type EventFilters = {
  contractAddress?: `0x${string}`;
  fromBlock?: bigint | number;
  toBlock?: bigint | number;
  fromTimestamp?: number;
  toTimestamp?: number;
  topics?: (`0x${string}` | null)[];
  // 动态参数过滤
  [paramName: string]: unknown;
};

// 分页参数
export type PaginationParams = {
  limit: number;
  offset?: number;
  cursor?: string;
  direction?: 'asc' | 'desc';
}

// 分页结果
export type PaginatedResult<T> = {
  data: T[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
};

// 事件索引配置
export type EventIndexingConfig = {
  // 表配置
  tableNamePrefix: string;
  maxTableNameLength: number;

  // 性能配置
  batchSize: number;
  maxConcurrency: number;

  // 存储配置
  compressionEnabled: boolean;
  partitioningEnabled: boolean;
  retentionDays: number;

  // 索引配置
  autoCreateIndexes: boolean;
  indexThreshold: number;

  // 监控配置
  metricsEnabled: boolean;
  errorTracking: boolean;
}

// ABI类型到数据库类型的映射配置
export type TypeMappingConfig = {
  // 基础类型映射
  basicTypes: Record<string, ColumnType>;

  // 数组类型映射
  arrayTypes: Record<string, ColumnType>;

  // 结构体类型映射
  structTypes: Record<string, ColumnType>;

  // 自定义类型映射
  customTypes: Record<string, ColumnType>;
}

// 事件索引错误
export class EventIndexingError extends Error {
  constructor(
    message: string,
    public readonly eventName?: string,
    public readonly contractAddress?: `0x${string}`,
    public readonly chainId?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'EventIndexingError';
  }
}

// 事件解码错误
export class EventDecodingError extends Error {
  constructor(
    message: string,
    public readonly blockHash?: string,
    public readonly logIndex?: number,
    public readonly chainId?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'EventDecodingError';
  }
}

// 表创建错误
export class TableCreationError extends Error {
  constructor(
    message: string,
    public readonly tableName: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TableCreationError';
  }
}

// 事件索引状态
export type EventIndexingStatus = {
  contractAddress: `0x${string}`;
  chainId: number;
  eventSignatures: string[];
  lastIndexedBlock: bigint;
  totalEventsIndexed: number;
  indexingActive: boolean;
  lastIndexedAt: Date;
  errors: EventIndexingError[];
}

// 多链相关类型定义

// 链特定配置
export type ChainSpecificConfig = {
  chainId: number;
  chainName: string;
  chainType: string;
  databasePath: string;
  indexingEnabled: boolean;
  maxHistoricalBlocks: number;
  eventBatchSize: number;
}

// 多链事件索引状态
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
}

// 跨链事件查询（用于API聚合，不支持直接跨链查询）
export type CrossChainEventQuery = {
  chainIds: number[];
  filters: Omit<EventFilters, 'contractAddress'> & {
    contractAddresses?: Record<number, `0x${string}`[]>; // 按链分组的合约地址
  };
  pagination: PaginationParams;
}

// 跨链事件结果
export type CrossChainEventResult = {
  chainId: number;
  chainName: string;
  events: FormattedEventData[];
  total: number;
  hasMore: boolean;
  errors?: string[];
}

// 链数据库状态
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
}

// 多链配置
export type MultiChainConfig = {
  // 支持的链列表
  supportedChains: number[];

  // 默认配置
  defaultConfig: Partial<ChainSpecificConfig>;

  // 性能配置
  maxConcurrentChains: number;
  chainConnectionTimeout: number;

  // 存储配置
  baseDataDirectory: string;
  databaseFilePattern: string; // e.g., "{chainType}/{chainName}-{chainId}.db"

  // 索引配置
  indexingConfig: EventIndexingConfig;
}

// 链事件表注册信息
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
}

// 多链统计信息
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
}

// 事件索引任务
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
}

// 多链事件流管理器
export type MultiChainEventStreamManager = {
  // 注册链事件流
  registerChain(chainId: number, config: ChainSpecificConfig): void;

  // 启动/停止链的事件流
  startChainStream(chainId: number): Promise<void>;
  stopChainStream(chainId: number): Promise<void>;

  // 获取流状态
  getStreamStatus(chainId: number): StreamStatus;

  // 处理跨链事件
  handleCrossChainEvents(events: CrossChainEventResult[]): Promise<void>;
}

// 流状态
export type StreamStatus = {
  chainId: number;
  isActive: boolean;
  connected: boolean;
  lastBlockNumber?: bigint;
  lastEventTime?: Date;
  eventsProcessed: number;
  errors: string[];
}

// 数据库迁移信息
export type ChainMigrationInfo = {
  chainId: number;
  version: string;
  migratedAt: Date;
  migrationType: 'schema' | 'data' | 'full';
  status: 'pending' | 'running' | 'completed' | 'failed';
  description: string;
}

// 多链错误类型
export class MultiChainError extends Error {
  constructor(
    message: string,
    public readonly chainId?: number,
    public readonly operation?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'MultiChainError';
  }
}

// 链配置错误
export class ChainConfigError extends MultiChainError {
  constructor(
    message: string,
    chainId: number,
    public readonly configField?: string,
    cause?: Error
  ) {
    super(message, chainId, 'config', cause);
    this.name = 'ChainConfigError';
  }
}

// 链数据库错误
export class ChainDatabaseError extends MultiChainError {
  constructor(
    message: string,
    chainId: number,
    public readonly databasePath?: string,
    cause?: Error
  ) {
    super(message, chainId, 'database', cause);
    this.name = 'ChainDatabaseError';
  }
}

// 事件统计信息
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
}

// 事件数据验证器
export type EventDataValidator = {
  validate(param: EventParameter, value: unknown): ValidationResult;
};

// 验证结果
export type ValidationResult = {
  valid: boolean;
  error?: string;
  sanitizedValue?: unknown;
};

// 事件数据转换器
export type EventDataTransformer = {
  transform(param: EventParameter, value: unknown): unknown;
  reverseTransform(param: EventParameter, value: unknown): unknown;
};

// 存储策略接口
export type StorageStrategy = {
  shouldStoreAsJson(param: EventParameter): boolean;
  getColumnType(param: EventParameter): ColumnType;
  formatValue(param: EventParameter, value: unknown): unknown;
  parseValue(param: EventParameter, value: unknown): unknown;
};

// 批处理操作
export type BatchOperation<T> = {
  items: T[];
  batchSize: number;
  maxRetries: number;
  timeout: number;
  onProgress?: (processed: number, total: number) => void;
  onError?: (error: Error, item: T) => void;
}

// 事件流处理器
export type EventStreamProcessor = {
  process(events: DecodedEvent[]): Promise<void>;
  onEvent?: (event: DecodedEvent) => void;
  onError?: (error: Error, event: DecodedEvent) => void;
  onComplete?: (stats: EventStatistics) => void;
}

// 解码后的事件
export type DecodedEvent = {
  // 基础信息
  chainId: number;
  contractAddress: `0x${string}`;
  eventName: string;
  eventSignature: `0x${string}`;

  // 交易信息
  txHash: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;

  // 时间信息
  blockTimestamp: number;

  // 解码数据
  args: DecodedEventData;
  rawTopics: readonly `0x${string}`[];
  rawData: `0x${string}`;

  // 处理信息
  indexedAt: Date;
  processingErrors?: string[];
}

// 默认配置
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

// 默认类型映射
export const DEFAULT_TYPE_MAPPING: TypeMappingConfig = {
  basicTypes: {
    'uint8': ColumnType.BIGNUM,
    'uint16': ColumnType.BIGNUM,
    'uint32': ColumnType.BIGNUM,
    'uint64': ColumnType.BIGNUM,
    'uint128': ColumnType.BIGNUM,
    'uint256': ColumnType.BIGNUM,
    'int8': ColumnType.BIGNUM,
    'int16': ColumnType.BIGNUM,
    'int32': ColumnType.BIGNUM,
    'int64': ColumnType.BIGNUM,
    'int128': ColumnType.BIGNUM,
    'int256': ColumnType.BIGNUM,
    'bool': ColumnType.BOOLEAN,
    'address': ColumnType.ADDRESS,
    'string': ColumnType.TEXT,
    'bytes': ColumnType.HEX_DATA,
    'bytes1': ColumnType.HEX_DATA,
    'bytes4': ColumnType.HEX_DATA,
    'bytes8': ColumnType.HEX_DATA,
    'bytes16': ColumnType.HEX_DATA,
    'bytes32': ColumnType.HASH32,
  },

  arrayTypes: {
    'uint8[]': ColumnType.TEXT,
    'uint256[]': ColumnType.TEXT,
    'address[]': ColumnType.TEXT,
    'bytes32[]': ColumnType.TEXT,
    'string[]': ColumnType.TEXT,
  },

  structTypes: {
    'tuple': ColumnType.TEXT,
  },

  customTypes: {},
};