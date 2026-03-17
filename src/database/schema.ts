/**
 * DuckDB 兼容的数据库 Schema
 * 使用类型安全的 DuckDB 专用构造器，确保只使用支持的特性
 *
 * 设计原则：
 * 1. 在 schema 定义层面确保 DuckDB 兼容性
 * 2. 使用明确的 DuckDB 类型构造器
 * 3. 避免在运行时做不安全的 SQL 转换
 */
import { sql } from "drizzle-orm";
import {
  integer,
  varchar,
  text,
  boolean,
  // EVM 特定类型
  address,
  txHash,
  blockHash,
  hash32,
  hexData,
  txType,
  txStatus,
  // 时间类型
  timestamp,
  datetime,
  // 通用大数类型
  bignum,
  uint256,
  // 表和约束构造器
  duckdbTable,
  primaryKey,
  unique,
} from "./db-types";

// 通用字段组合
const timestampColumns = {
  createdAt: datetime().default(sql`now()`),
  updatedAt: datetime().default(sql`now()`),
} as const;

// 链相关的基础字段
const chainColumns = {
  chainId: integer().notNull(),
} as const;

// 地址相关字段
const addressColumns = {
  address: address().notNull(),
} as const;

// 链+地址组合（常用于合约相关表）
const chainAddressColumns = {
  ...chainColumns,
  ...addressColumns,
} as const;

// 用户RPC配置表
export const userRpcConfigs = duckdbTable("user_rpc_configs", {
  chainId: integer().primaryKey(),
  name: varchar({ length: 255 }),
  url: varchar({ length: 500 }),
  supportsHistory: boolean(),
  maxEventRange: integer(),

  ...timestampColumns,
});

// 区块表
export const blocks = duckdbTable(
  "blocks",
  {
    ...chainColumns,
    number: bignum().notNull(), // 区块号
    hash: blockHash().notNull(),
    parentHash: blockHash(),
    timestamp: timestamp(),
    miner: address(),
    gasLimit: bignum(), // Gas 限制
    gasUsed: bignum(), // Gas 使用量
    baseFeePerGas: bignum(), // Gas 价格
    transactionCount: integer(),
    sizeBytes: integer(),
    difficulty: uint256(),
    totalDifficulty: uint256(),
    extraData: hexData(),
    logsBloom: hexData(),
    stateRoot: hash32(),
    transactionsRoot: hash32(),
    receiptsRoot: hash32(),
    indexedAt: datetime().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.number] }),
    unique().on(table.chainId, table.hash),
    // 注意：索引在迁移脚本中手动创建，避免 Drizzle 生成不兼容的索引语法
  ]
);

// 交易表
export const transactions = duckdbTable(
  "transactions",
  {
    ...chainColumns,
    hash: txHash().notNull(),
    blockNumber: bignum(), // 区块号
    transactionIndex: integer(),
    fromAddress: address(),
    toAddress: address(),
    value: bignum(), // Wei 金额
    gasLimit: bignum(), // Gas 限制
    gasPrice: bignum(), // Gas 价格
    maxFeePerGas: bignum(), // 最大 Gas 费用
    maxPriorityFeePerGas: bignum(), // 最大优先费用
    gasUsed: bignum(), // Gas 使用量
    effectiveGasPrice: bignum(), // 有效 Gas 价格
    status: txStatus(),
    type: txType().default(0),
    nonce: bignum(), // Nonce 值
    inputData: hexData(),
    logsCount: integer().default(0),
    contractAddress: address(),
    cumulativeGasUsed: bignum(), // 累计 Gas 使用量
    timestamp: timestamp(),
    indexedAt: datetime().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.hash] }),
    unique().on(table.chainId, table.blockNumber, table.transactionIndex),
    // 注意：索引在迁移脚本中手动创建
  ]
);

// 已索引地址表
export const indexedAddresses = duckdbTable(
  "indexed_addresses",
  {
    ...chainAddressColumns,
    type: varchar({ length: 20 }).notNull(), // 'EOA', 'contract'
    firstSeen: timestamp(),
    lastActivity: timestamp(),
    transactionCount: integer().default(0),
    indexedAt: datetime().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.address] }),
    // 注意：索引在迁移脚本中手动创建
  ]
);

// 搜索历史表
export const searchHistory = duckdbTable("search_history", {
  id: integer().primaryKey(),
  query: varchar({ length: 255 }),
  searchType: varchar({ length: 20 }),
  resultCount: integer().default(0),
  searchedAt: datetime().default(sql`now()`),
});

// 用户偏好表
export const userPreferences = duckdbTable("user_preferences", {
  id: integer().primaryKey(),
  theme: varchar({ length: 20 }).default("light"),
  language: varchar({ length: 10 }).default("en"),
  updatedAt: datetime().default(sql`now()`),
});

// 索引状态表
export const indexStatus = duckdbTable(
  "index_status",
  {
    ...chainColumns,
    indexType: varchar({ length: 20 }).notNull(), // 'blocks', 'transactions'
    lastIndexedBlock: bignum(),
    lastIndexedAt: datetime().default(sql`now()`),
  },
  (table) => [primaryKey({ columns: [table.chainId, table.indexType] })]
);

// 访问历史表
export const accessHistory = duckdbTable(
  "access_history",
  {
    ...chainColumns,
    type: varchar({ length: 20 }).notNull(), // 'block', 'transaction', 'address'
    identifier: varchar({ length: 66 }).notNull(), // hash or address
    firstAccessed: datetime().default(sql`now()`),
    lastAccessed: datetime().default(sql`now()`),
    accessCount: integer().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.type, table.identifier] }),
    // 注意：索引在迁移脚本中手动创建
  ]
);

// 合约源码表
export const contractSources = duckdbTable(
  "contract_sources",
  {
    ...chainAddressColumns,
    sourceCode: text(),
    abi: text(),
    contractName: varchar({ length: 255 }),
    compilerVersion: varchar({ length: 50 }),
    optimizationUsed: boolean(),
    runs: integer(),
    constructorArguments: hexData(),
    evmVersion: varchar({ length: 50 }),
    library: text(),
    licenseType: varchar({ length: 50 }),
    proxy: varchar({ length: 50 }),
    implementation: address(),
    swarmSource: varchar({ length: 100 }),
    isVerified: boolean().default(false),
    verificationDate: datetime().default(sql`now()`),
    lastUpdated: datetime().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.address] }),
    // 注意：索引在迁移脚本中手动创建
  ]
);

// 合约创建信息表
export const contractCreationInfo = duckdbTable(
  "contract_creation_info",
  {
    ...chainAddressColumns,
    creationTxHash: txHash(),
    creationBlockNumber: bignum(), // 创建区块号
    creatorAddress: address(),
    factoryAddress: address(), // 允许 NULL，因为不是所有合约都通过工厂创建
    creationMethod: varchar({ length: 50 }),
    lastUpdated: datetime().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.address] }),
    // 注意：索引在迁移脚本中手动创建
  ]
);

// 事件表注册表
export const eventTableRegistry = duckdbTable(
  "event_table_registry",
  {
    ...chainAddressColumns,
    contractAddress: address().notNull(),
    eventSignature: varchar({ length: 66 }).notNull(),
    eventName: varchar({ length: 255 }),
    tableName: varchar({ length: 255 }).notNull(),
    tableSchema: text(),
    isActive: boolean().default(true),
    lastAccessed: datetime(),
    ...timestampColumns,
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.contractAddress, table.eventSignature] }),
  ]
);

// 导出类型推断
export type EventTableRegistry = typeof eventTableRegistry.$inferSelect;
export type NewEventTableRegistry = typeof eventTableRegistry.$inferInsert;

export type UserRpcConfig = typeof userRpcConfigs.$inferSelect;
export type NewUserRpcConfig = typeof userRpcConfigs.$inferInsert;

export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type IndexedAddress = typeof indexedAddresses.$inferSelect;
export type NewIndexedAddress = typeof indexedAddresses.$inferInsert;

export type ContractSource = typeof contractSources.$inferSelect;
export type NewContractSource = typeof contractSources.$inferInsert;

export type ContractCreationInfo = typeof contractCreationInfo.$inferSelect;
export type NewContractCreationInfo = typeof contractCreationInfo.$inferInsert;
