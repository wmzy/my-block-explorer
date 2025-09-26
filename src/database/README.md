# DuckDB + Drizzle ORM 集成方案

本项目使用 DuckDB 作为数据库，通过自定义适配器与 Drizzle ORM 集成，实现类型安全的数据库操作。

## 架构概览

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Drizzle ORM   │────│  Custom Adapter  │────│     DuckDB      │
│   (PostgreSQL)  │    │  (Compatibility) │    │   (Neo Client)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### 核心文件

- `drizzle.ts` - Drizzle ORM 配置
- `duckdb-postgres-adapter.ts` - DuckDB 兼容适配器
- `duckdb-types.ts` - 类型安全的 DuckDB 专用构造器
- `schema.ts` - 数据库表结构定义
- `migrate.ts` - 数据库迁移脚本

## 设计原则

### 1. Schema 层面的类型安全

**原则**：在 schema 定义时禁止使用不支持的类型和索引，而不是在运行时做不安全的替换。

```typescript
// ✅ 推荐：使用 DuckDB 专用类型构造器
import { duckdbBigint, duckdbTimestamp, duckdbTable } from './duckdb-types';

export const blocks = duckdbTable('blocks', {
  chainId: integer('chain_id').notNull(),
  number: duckdbBigint('number').notNull(),           // VARCHAR(32) - 避免精度问题
  hash: varchar('hash', { length: 66 }).notNull(),
  timestamp: duckdbTimestamp('timestamp'),            // TIMESTAMP (无时区)
}, (table) => [
  primaryKey({ columns: [table.chainId, table.number] }),
  unique().on(table.chainId, table.hash),
  // 注意：索引在迁移脚本中手动创建
]);

// ❌ 避免：直接使用可能不兼容的类型
import { bigint, timestamp } from 'drizzle-orm/pg-core';
export const blocks = pgTable('blocks', {
  number: bigint('number', { mode: 'string' }), // 可能导致运行时错误
});
```

### 2. 明确的 API 设计

所有 DuckDB 专用构造器都使用 `duckdb` 前缀，让开发者明确知道他们在使用 DuckDB 特性：

```typescript
// DuckDB 专用类型构造器
export const duckdbBigint = (name: string) => varchar(name, { length: 32 });
export const duckdbTimestamp = (name: string) => timestamp(name, { withTimezone: false });
export const duckdbTimestampWithDefault = (name: string) => 
  timestamp(name, { withTimezone: false }).defaultNow();
```

### 3. 最小化运行时转换

仅在适配器中处理 Drizzle 内部生成的不兼容 SQL：

```typescript
private adaptDrizzleInternalSql(sql: string): string {
  // 只转换 Drizzle 迁移表的 SERIAL 类型
  if (sql.includes('__drizzle_migrations') && sql.includes('SERIAL')) {
    return sql.replace(/\bSERIAL\b/gi, "INTEGER");
  }
  return sql;
}
```

**重要发现**：DuckDB 原生支持 PostgreSQL 风格的参数占位符（`$1, $2, ...`），不需要转换为 `?` 风格。

## DuckDB vs PostgreSQL 差异

### 数据类型差异

| 特性 | PostgreSQL | DuckDB | 我们的解决方案 |
|------|------------|--------|----------------|
| **大整数精度** | `BIGINT` 支持任意精度 | `BIGINT` 有精度限制 | `duckdbBigint` → `VARCHAR(32)` |
| **时间戳时区** | `TIMESTAMP WITH TIMEZONE` | 时区支持有限 | `duckdbTimestamp` → `TIMESTAMP` (无时区) |
| **序列类型** | `SERIAL`, `BIGSERIAL` | ❌ 不支持 | 适配器转换为 `INTEGER` |
| **布尔类型** | `BOOLEAN` | ✅ 支持 | 直接使用 |
| **文本类型** | `TEXT`, `VARCHAR` | ✅ 支持 | 直接使用 |

### 索引差异

| 特性 | PostgreSQL | DuckDB | 我们的解决方案 |
|------|------------|--------|----------------|
| **索引类型** | `USING btree`, `USING hash` | ❌ 不支持指定类型 | 适配器移除 `USING btree` |
| **复合索引** | ✅ 支持 | ✅ 支持 | 直接使用 |
| **唯一索引** | ✅ 支持 | ✅ 支持 | 直接使用 |
| **部分索引** | ✅ 支持 | ❌ 有限支持 | 避免使用 |

### Schema 和命名空间

| 特性 | PostgreSQL | DuckDB | 我们的解决方案 |
|------|------------|--------|----------------|
| **Schema 支持** | ✅ 完整支持 | ✅ 支持 | 直接使用 |
| **Schema 语法** | `CREATE SCHEMA name` | ✅ 支持 | 直接使用 |
| **跨 Schema 查询** | `schema.table` | ✅ 支持 | 直接使用 |

### 函数和操作符差异

| 特性 | PostgreSQL | DuckDB | 备注 |
|------|------------|--------|------|
| **参数占位符** | `$1, $2, ...` | ✅ 支持 PostgreSQL 风格 | 无需转换 |
| **now()** | ✅ 支持 | ✅ 支持 | |
| **CURRENT_TIMESTAMP** | ✅ 支持 | ✅ 支持 | |
| **字符串函数** | 丰富的函数集 | 基本函数支持 | 需要验证具体函数 |
| **JSON 操作** | 强大的 JSON 支持 | 基本 JSON 支持 | 需要谨慎使用 |

### 事务和并发

| 特性 | PostgreSQL | DuckDB | 影响 |
|------|------------|--------|------|
| **ACID 事务** | ✅ 完整支持 | ✅ 支持 | 无影响 |
| **并发读写** | 高并发支持 | 有限并发支持 | 适合分析工作负载 |
| **锁机制** | 细粒度锁 | 简化锁机制 | 适合单用户/少用户场景 |

## 类型映射表

### JavaScript/TypeScript → DuckDB

```typescript
// 字符串类型
string → VARCHAR(length) | TEXT

// 数字类型
number → INTEGER | DOUBLE
bigint → VARCHAR(32)  // 避免精度问题

// 布尔类型
boolean → BOOLEAN

// 日期时间
Date → TIMESTAMP     // 无时区
string (ISO) → TIMESTAMP

// 大数字（区块链常用）
string → VARCHAR(32) // 使用 duckdbBigint
```

### Drizzle 类型 → DuckDB 类型

```typescript
// 推荐的类型映射
integer(name)                    → INTEGER
varchar(name, {length})          → VARCHAR(length)
text(name)                      → TEXT
boolean(name)                   → BOOLEAN
duckdbBigint(name)              → VARCHAR(32)
duckdbTimestamp(name)           → TIMESTAMP
duckdbTimestampWithDefault(name) → TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

## 最佳实践

### 1. 使用类型安全的构造器

```typescript
// ✅ 推荐
import { 
  duckdbBigint, 
  duckdbTimestamp, 
  duckdbTable 
} from './duckdb-types';

export const transactions = duckdbTable('transactions', {
  value: duckdbBigint('value'),           // 自动使用 VARCHAR(32)
  timestamp: duckdbTimestamp('timestamp'), // 自动无时区
});
```

### 2. 避免复杂的 SQL 特性

```typescript
// ✅ 推荐：简单直接的查询
const blocks = await db.select()
  .from(blocksTable)
  .where(eq(blocksTable.chainId, chainId))
  .limit(10);

// ⚠️ 谨慎：复杂的 JSON 操作
// DuckDB 的 JSON 支持可能与 PostgreSQL 不同
```

### 3. 大数字处理

```typescript
// ✅ 推荐：使用字符串存储和处理大数字
const blockNumber = '999999999999999999999'; // 字符串
await db.insert(blocks).values({
  number: blockNumber,  // 直接存储字符串
});

// 读取时也是字符串
const result = await db.select().from(blocks);
console.log(typeof result[0].number); // "string"
```

### 4. 时间戳处理

```typescript
// ✅ 推荐：使用无时区时间戳
const createdAt = duckdbTimestampWithDefault('created_at');

// 应用层处理时区转换
const now = new Date().toISOString(); // UTC 时间
```

## 性能考虑

### DuckDB 的优势

- **列式存储**：适合分析查询
- **内存优化**：高效的内存使用
- **向量化执行**：快速聚合操作
- **压缩存储**：节省存储空间

### 使用场景

- ✅ **分析查询**：大量数据的聚合、统计
- ✅ **批量插入**：区块链数据同步
- ✅ **只读/少写**：区块浏览器场景
- ⚠️ **高并发写入**：需要评估性能
- ❌ **实时事务系统**：不适合

## 迁移和部署

### 开发环境

```bash
# 1. 生成迁移文件（当 schema 有变更时）
npx drizzle-kit generate

# 2. 清理数据库文件（如需要）
rm -f data/blockchain.db

# 3. 运行迁移
npx tsx src/database/migrate.ts

# 4. 验证表结构
npx tsx -e "
import { db } from './src/database/drizzle.js';
const result = await db.execute('SHOW TABLES');
console.log('Tables:', result);
"
```

### 生产环境考虑

1. **数据备份**：定期备份 `.db` 文件
2. **文件权限**：确保应用有读写权限
3. **磁盘空间**：监控数据库文件大小
4. **性能监控**：监控查询性能

## 故障排除

### 常见问题

1. **类型转换错误**
   ```
   Error: Could not convert string 'xxx' to INT64
   ```
   **解决**：使用 `duckdbBigint` 而非 `bigint`

2. **索引类型错误**
   ```
   Error: Unknown index type: BTREE
   ```
   **解决**：适配器会自动移除 `USING btree`

3. **Schema 不存在**
   ```
   Error: Schema with name 'drizzle' does not exist
   ```
   **解决**：DuckDB 支持 schema，检查迁移脚本

### 调试技巧

```typescript
// 启用 SQL 日志
const db = drizzle(adapter, { 
  schema,
  logger: true  // 显示生成的 SQL
});

// 检查表结构
await db.execute('DESCRIBE table_name');

// 查看所有表
await db.execute('SHOW TABLES');
```

## 总结

通过类型安全的设计和最小化的运行时转换，我们实现了一个高效、可靠的 DuckDB + Drizzle ORM 集成方案。这个方案：

- ✅ **类型安全**：编译时捕获不兼容使用
- ✅ **明确性**：API 名称明确表明 DuckDB 特性  
- ✅ **可维护**：集中的类型定义和适配逻辑
- ✅ **高性能**：避免运行时字符串操作
- ✅ **可靠性**：减少隐式转换错误

这个架构特别适合区块链数据分析和区块浏览器等场景，能够高效处理大量结构化数据的存储和查询需求。
