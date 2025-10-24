# 数据模型设计

**创建日期**: 2025-10-15
**版本**: 1.0

## 核心实体定义

### 1. 事件表元数据 (event_table_registry) - 链内特定

管理动态创建的事件表信息（**注意：不包含chain_id字段**）。

```typescript
export interface ChainEventTableRegistry {
  contractAddress: Address;           // 合约地址
  eventSignature: `0x${string}`;      // 事件签名哈希
  eventName: string;                  // 事件名称
  tableName: string;                  // 动态表名
  tableSchema: string;                // JSON格式的表结构
  isActive: boolean;                  // 表是否活跃
  createdAt: Date;                    // 创建时间
  updatedAt: Date;                    // 更新时间
}
```

### 2. 动态事件表结构 - 链内特定

每个事件的标准表结构（**注意：移除了chain_id字段**）：

```typescript
export interface ChainEventTable {
  // 主键字段
  blockHash: string;                  // 区块哈希
  logIndex: number;                   // 日志索引

  // 交易信息
  transactionHash: string;            // 交易哈希
  transactionIndex: number;           // 交易索引
  blockNumber: bigint;                // 区块号
  blockTimestamp: Date;               // 区块时间戳

  // 事件信息
  eventName: string;                  // 事件名称
  eventSignature: string;             // 事件签名
  contractAddress: string;            // 合约地址

  // 解码的事件参数 (动态字段)
  [paramName: string]: any;           // 根据ABI动态生成的字段

  // 元数据
  decodedAt: Date;                    // 解码时间
  indexedAt: Date;                    // 索引时间
}
```

**架构变更**：
- **移除chain_id字段**：每个链使用独立的数据库文件
- **简化主键**：使用 `(block_hash, log_index)` 作为联合主键
- **数据隔离**：确保链间数据完全隔离，不支持跨链查询

### 3. 事件参数类型映射

ABI类型到数据库类型的映射规则：

```typescript
export const ABI_TYPE_MAPPING = {
  // 基础类型
  'uint': 'TEXT',              // 大数字存储为字符串
  'int': 'TEXT',               // 有符号整数存储为字符串
  'address': 'VARCHAR(42)',    // 地址类型
  'bool': 'BOOLEAN',           // 布尔值
  'bytes': 'TEXT',             // 字节数组
  'string': 'TEXT',            // 字符串

  // 数组类型
  'uint[]': 'TEXT',            // JSON数组存储
  'int[]': 'TEXT',             // JSON数组存储
  'address[]': 'TEXT',         // JSON数组存储
  'bool[]': 'TEXT',            // JSON数组存储
  'bytes[]': 'TEXT',           // JSON数组存储
  'string[]': 'TEXT',          // JSON数组存储

  // 复杂类型
  'tuple': 'TEXT',             // 结构体存储为JSON
  'tuple[]': 'TEXT',           // 结构体数组存储为JSON
} as const;
```

## 动态表生成逻辑

### 表名生成规则（链内唯一）

```typescript
export function generateChainEventTableName(
  contractAddress: Address,
  eventSignature: `0x${string}`
): string {
  // 链内唯一表名，不包含chain_id
  return `events_${contractAddress.slice(2, 10)}_${eventSignature.slice(2, 10)}`;
}
```

**命名策略变更**：
- **简化命名**：移除chain_id前缀，因为每个链独立数据库
- **唯一性保证**：在单个链数据库内确保表名唯一
- **长度优化**：表名更短，提高可读性和性能

### 字段生成规则（链内特定）

```typescript
export function generateChainEventColumns(
  eventAbi: AbiEvent
): Array<{name: string, type: string, nullable: boolean}> {
  const columns = [
    // 标准字段 - 移除了chain_id
    { name: 'block_hash', type: 'VARCHAR(66)', nullable: false },
    { name: 'log_index', type: 'INTEGER', nullable: false },
    { name: 'transaction_hash', type: 'VARCHAR(66)', nullable: false },
    { name: 'transaction_index', type: 'INTEGER', nullable: false },
    { name: 'block_number', type: 'BIGINT', nullable: false },
    { name: 'block_timestamp', type: 'TIMESTAMP', nullable: false },
    { name: 'event_name', type: 'VARCHAR(255)', nullable: false },
    { name: 'event_signature', type: 'VARCHAR(66)', nullable: false },
    { name: 'contract_address', type: 'VARCHAR(42)', nullable: false },
    { name: 'decoded_at', type: 'TIMESTAMP', nullable: false },
    { name: 'indexed_at', type: 'TIMESTAMP', nullable: false },
  ];

  // 动态生成事件参数字段
  eventAbi.inputs.forEach(input => {
    const dbType = ABI_TYPE_MAPPING[input.type as keyof typeof ABI_TYPE_MAPPING] || 'TEXT';
    columns.push({
      name: input.name,
      type: dbType,
      nullable: !input.indexed, // indexed参数通常不为空
    });
  });

  return columns;
}
```

## 查询优化策略

### 主要索引设计（链内优化）

```sql
-- 主键索引 (自动创建) - 简化为两个字段
PRIMARY KEY (block_hash, log_index)

-- 查询优化索引
CREATE INDEX idx_event_timestamp ON {table_name} (block_timestamp);
CREATE INDEX idx_contract_address ON {table_name} (contract_address);
CREATE INDEX idx_transaction_hash ON {table_name} (transaction_hash);
CREATE INDEX idx_event_name ON {table_name} (event_name);
CREATE INDEX idx_block_number ON {table_name} (block_number);

-- 复合索引
CREATE INDEX idx_contract_time ON {table_name} (contract_address, block_timestamp);
CREATE INDEX idx_tx_log ON {table_name} (transaction_hash, log_index);
CREATE INDEX idx_contract_block ON {table_name} (contract_address, block_number);

-- 动态字段索引 (根据indexed参数)
-- 为每个indexed参数创建索引
```

**索引优化**：
- **主键简化**：移除chain_id字段，提升索引性能
- **查询优化**：专注于链内查询模式
- **存储效率**：减少索引存储空间

### 分区策略

```typescript
// 可选的时间分区策略 (用于大数据量场景)
export function generatePartitionedTable(tableName: string): string {
  return `
    CREATE TABLE ${tableName}_partitioned (
      LIKE ${tableName} INCLUDING ALL
    ) PARTITION BY RANGE (block_timestamp);

    -- 创建月度分区
    CREATE TABLE ${tableName}_2024_01 PARTITION OF ${tableName}_partitioned
      FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
  `;
}
```

## 数据验证规则

### 输入验证

```typescript
export const EVENT_VALIDATION_RULES = {
  chainId: {
    type: 'number',
    min: 1,
    max: 999999,
    required: true,
  },
  contractAddress: {
    type: 'address',
    pattern: /^0x[a-fA-F0-9]{40}$/,
    required: true,
  },
  blockHash: {
    type: 'string',
    pattern: /^0x[a-fA-F0-9]{64}$/,
    required: true,
  },
  logIndex: {
    type: 'number',
    min: 0,
    max: 1000, // 单个交易的最大日志数量
    required: true,
  },
  transactionHash: {
    type: 'string',
    pattern: /^0x[a-fA-F0-9]{64}$/,
    required: true,
  },
} as const;
```

### 数据完整性约束

```sql
-- 外键约束 (引用主表)
ALTER TABLE {event_table_name}
ADD CONSTRAINT fk_chain_id
FOREIGN KEY (chain_id) REFERENCES chains(id);

-- 唯一性约束
ALTER TABLE {event_table_name}
ADD CONSTRAINT uk_unique_event
UNIQUE (chain_id, block_hash, log_index);

-- 检查约束
ALTER TABLE {event_table_name}
ADD CONSTRAINT chk_block_number_positive
CHECK (block_number >= 0);

ALTER TABLE {event_table_name}
ADD CONSTRAINT chk_log_index_valid
CHECK (log_index >= 0 AND log_index < 1000);
```

## 数据迁移策略

### 版本控制

```typescript
export interface EventTableVersion {
  tableName: string;
  version: number;
  schema: string;
  migration: string;
  rollback: string;
  appliedAt: Date;
}
```

### 迁移脚本模板

```sql
-- 添加新字段
ALTER TABLE {table_name}
ADD COLUMN new_field VARCHAR(255);

-- 创建新索引
CREATE INDEX idx_new_field ON {table_name} (new_field);

-- 数据迁移
UPDATE {table_name}
SET new_field = extract_from_json(event_params, 'old_field')
WHERE new_field IS NULL;
```

## 性能监控指标

### 关键指标

```typescript
export interface EventTableMetrics {
  tableName: string;
  totalRows: number;
  tableSize: number;        // MB
  indexSize: number;        // MB
  avgQueryTime: number;     // ms
  lastIndexed: Date;
  indexingRate: number;     // events/minute
  errorRate: number;        // percentage
}
```

### 监控查询

```sql
-- 表大小统计
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats
WHERE tablename LIKE 'contract_events_%';

-- 查询性能分析
EXPLAIN ANALYZE
SELECT * FROM {table_name}
WHERE contract_address = $1
  AND block_timestamp BETWEEN $2 AND $3
ORDER BY block_timestamp DESC
LIMIT 100;
```

## 数据保留策略

### 自动清理规则

```typescript
export const DATA_RETENTION_POLICY = {
  // 事件数据保留期 (可配置)
  eventRetentionDays: 365,

  // 压缩策略
  compressOldDataAfterDays: 90,

  // 归档策略
  archiveDataAfterDays: 730,

  // 清理策略
  deleteDataAfterDays: 1825, // 5年
} as const;
```

### 清理脚本

```sql
-- 压缩旧数据
CREATE TABLE {table_name}_compressed AS
SELECT * FROM {table_name}
WHERE block_timestamp < NOW() - INTERVAL '90 days';

-- 删除过期数据
DELETE FROM {table_name}
WHERE block_timestamp < NOW() - INTERVAL '5 years';

-- 更新表统计信息
ANALYZE {table_name};
```

---

**设计原则**:
- 类型安全：使用TypeScript确保编译时类型检查
- 性能优先：优化查询索引和存储结构
- 可扩展性：支持动态添加新的事件类型
- 数据完整性：严格的验证和约束规则
- 运维友好：完整的监控和维护工具