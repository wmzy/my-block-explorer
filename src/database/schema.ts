import {
  integer,
  varchar,
  bigint,
  timestamp,
  pgTable,
  primaryKey,
  unique,
  decimal,
  boolean,
  text,
  index,
} from 'drizzle-orm/pg-core';

// 用户RPC配置表
export const userRpcConfigs = pgTable('user_rpc_configs', {
  chainId: integer('chain_id').primaryKey(),
  customRpcUrl: varchar('custom_rpc_url', { length: 500 }),
  rpcBackupUrls: text('rpc_backup_urls'), // JSON数组
  timeoutMs: integer('timeout_ms').default(10000),
  retryCount: integer('retry_count').default(3),
  rateLimit: integer('rate_limit').default(100),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 区块表
export const blocks = pgTable('blocks', {
  chainId: integer('chain_id').notNull(),
  number: bigint('number', { mode: 'bigint' }).notNull(),
  hash: varchar('hash', { length: 66 }).notNull(),
  parentHash: varchar('parent_hash', { length: 66 }),
  timestamp: timestamp('timestamp'),
  miner: varchar('miner', { length: 42 }),
  gasLimit: bigint('gas_limit', { mode: 'bigint' }),
  gasUsed: bigint('gas_used', { mode: 'bigint' }),
  baseFeePerGas: bigint('base_fee_per_gas', { mode: 'bigint' }),
  transactionCount: integer('transaction_count'),
  sizeBytes: integer('size_bytes'),
  difficulty: varchar('difficulty', { length: 32 }),
  totalDifficulty: varchar('total_difficulty', { length: 32 }),
  extraData: text('extra_data'),
  logsBloom: text('logs_bloom'),
  stateRoot: varchar('state_root', { length: 66 }),
  transactionsRoot: varchar('transactions_root', { length: 66 }),
  receiptsRoot: varchar('receipts_root', { length: 66 }),
  indexedAt: timestamp('indexed_at').defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.number] }),
  hashUnique: unique().on(table.chainId, table.hash),
  // 索引
  timestampIdx: index('blocks_chain_timestamp_idx').on(table.chainId, table.timestamp),
  minerIdx: index('blocks_chain_miner_idx').on(table.chainId, table.miner),
  hashIdx: index('blocks_hash_idx').on(table.hash),
}));

// 交易表
export const transactions = pgTable('transactions', {
  chainId: integer('chain_id').notNull(),
  hash: varchar('hash', { length: 66 }).notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }),
  transactionIndex: integer('transaction_index'),
  fromAddress: varchar('from_address', { length: 42 }),
  toAddress: varchar('to_address', { length: 42 }),
  value: decimal('value', { precision: 38, scale: 0 }),
  gasLimit: bigint('gas_limit', { mode: 'bigint' }),
  gasPrice: bigint('gas_price', { mode: 'bigint' }),
  maxFeePerGas: bigint('max_fee_per_gas', { mode: 'bigint' }),
  maxPriorityFeePerGas: bigint('max_priority_fee_per_gas', { mode: 'bigint' }),
  gasUsed: bigint('gas_used', { mode: 'bigint' }),
  effectiveGasPrice: bigint('effective_gas_price', { mode: 'bigint' }),
  status: integer('status'),
  type: integer('type').default(0),
  nonce: bigint('nonce', { mode: 'bigint' }),
  inputData: text('input_data'),
  logsCount: integer('logs_count').default(0),
  contractAddress: varchar('contract_address', { length: 42 }),
  cumulativeGasUsed: bigint('cumulative_gas_used', { mode: 'bigint' }),
  timestamp: timestamp('timestamp'),
  indexedAt: timestamp('indexed_at').defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.hash] }),
  blockUnique: unique().on(table.chainId, table.blockNumber, table.transactionIndex),
  // 索引
  blockIdx: index('transactions_chain_block_idx').on(table.chainId, table.blockNumber),
  fromIdx: index('transactions_chain_from_idx').on(table.chainId, table.fromAddress),
  toIdx: index('transactions_chain_to_idx').on(table.chainId, table.toAddress),
  timestampIdx: index('transactions_chain_timestamp_idx').on(table.chainId, table.timestamp),
  hashIdx: index('transactions_hash_idx').on(table.hash),
}));

// 地址索引表
export const indexedAddresses = pgTable('indexed_addresses', {
  chainId: integer('chain_id').notNull(),
  address: varchar('address', { length: 42 }).notNull(),
  label: varchar('label', { length: 100 }),
  firstSeenBlock: bigint('first_seen_block', { mode: 'bigint' }),
  lastSeenBlock: bigint('last_seen_block', { mode: 'bigint' }),
  transactionCount: integer('transaction_count').default(0),
  indexedAt: timestamp('indexed_at').defaultNow(),
  lastQueried: timestamp('last_queried').defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.address] }),
  // 索引
  queriedIdx: index('indexed_addresses_chain_queried_idx').on(table.chainId, table.lastQueried),
  globalIdx: index('indexed_addresses_global_idx').on(table.address),
}));

// 搜索历史表
export const searchHistory = pgTable('search_history', {
  id: integer('id').primaryKey(),
  chainId: integer('chain_id'), // 可选，跨链搜索时为NULL
  query: varchar('query', { length: 100 }).notNull(),
  resultType: varchar('result_type', { length: 20 }),
  resultId: varchar('result_id', { length: 66 }),
  searchedAt: timestamp('searched_at').defaultNow(),
}, (table) => ({
  chainIdx: index('search_history_chain_idx').on(table.chainId, table.searchedAt),
}));

// 用户偏好表
export const userPreferences = pgTable('user_preferences', {
  key: varchar('key', { length: 50 }).primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 访问历史表
export const accessHistory = pgTable('access_history', {
  chainId: integer('chain_id').notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  identifier: varchar('identifier', { length: 66 }).notNull(),
  firstAccessed: timestamp('first_accessed').defaultNow(),
  lastAccessed: timestamp('last_accessed').defaultNow(),
  accessCount: integer('access_count').default(1),
}, (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.type, table.identifier] }),
  typeIdx: index('access_history_chain_type_idx').on(table.chainId, table.type, table.lastAccessed),
  countIdx: index('access_history_count_idx').on(table.accessCount),
}));

// 索引状态表
export const indexStatus = pgTable('index_status', {
  chainId: integer('chain_id').notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  identifier: varchar('identifier', { length: 66 }).notNull(),
  indexedAt: timestamp('indexed_at').defaultNow(),
  lastUpdated: timestamp('last_updated').defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.type, table.identifier] }),
}));

// 类型推断
export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type IndexedAddress = typeof indexedAddresses.$inferSelect;
export type NewIndexedAddress = typeof indexedAddresses.$inferInsert;
export type UserRpcConfig = typeof userRpcConfigs.$inferSelect;
export type NewUserRpcConfig = typeof userRpcConfigs.$inferInsert;
