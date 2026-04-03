/**
 * Per-chain database schema (Drizzle ORM).
 *
 * Mirrors the main schema but omits chain_id columns — each chain database
 * file is inherently scoped to a single chain.
 *
 * Primary keys are simplified from composite (chainId + X) to single-field
 * where applicable.
 */

import { sql } from 'drizzle-orm';
import {
  integer,
  varchar,
  text,
  boolean,
  // EVM-specific types
  address,
  txHash,
  blockHash,
  hash32,
  hexData,
  txType,
  txStatus,
  // Time types
  timestamp,
  datetime,
  // Generic big-number types
  bignum,
  uint256,
  // Table and constraint builders
  duckdbTable,
  primaryKey,
  unique,
} from './db-types';

// Shared timestamp mixin
const timestampColumns = {
  createdAt: datetime().default(sql`now()`),
  updatedAt: datetime().default(sql`now()`),
} as const;

// ─── 1. Blocks ───────────────────────────────────────────────────────────────

export const blocks = duckdbTable('blocks', {
  number: bignum().primaryKey(),
  hash: blockHash().notNull().unique(),
  parentHash: blockHash(),
  timestamp: timestamp(),
  miner: address(),
  gasLimit: bignum(),
  gasUsed: bignum(),
  baseFeePerGas: bignum(),
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
});

// ─── 2. Transactions ─────────────────────────────────────────────────────────

export const transactions = duckdbTable(
  'transactions',
  {
    hash: txHash().primaryKey(),
    blockNumber: bignum(),
    transactionIndex: integer(),
    fromAddress: address(),
    toAddress: address(),
    value: bignum(),
    gasLimit: bignum(),
    gasPrice: bignum(),
    maxFeePerGas: bignum(),
    maxPriorityFeePerGas: bignum(),
    gasUsed: bignum(),
    effectiveGasPrice: bignum(),
    status: txStatus(),
    type: txType().default(0),
    nonce: bignum(),
    inputData: hexData(),
    logsCount: integer().default(0),
    contractAddress: address(),
    cumulativeGasUsed: bignum(),
    timestamp: timestamp(),
    indexedAt: datetime().default(sql`now()`),
  },
  table => [unique().on(table.blockNumber, table.transactionIndex)],
);

// ─── 3. Contract Sources ─────────────────────────────────────────────────────

export const contractSources = duckdbTable('contract_sources', {
  address: address().primaryKey(),
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
  verificationSource: varchar({ length: 50 }),
  verificationDate: datetime().default(sql`now()`),
  lastUpdated: datetime().default(sql`now()`),
});

// ─── 4. Contract Creation Info ───────────────────────────────────────────────

export const contractCreationInfo = duckdbTable('contract_creation_info', {
  address: address().primaryKey(),
  creationTxHash: txHash(),
  creationBlockNumber: bignum(),
  creationTimestamp: timestamp(),
  creatorAddress: address(),
  factoryAddress: address(),
  creationMethod: varchar({ length: 50 }),
  lastUpdated: datetime().default(sql`now()`),
});

// ─── 5. Indexed Addresses ────────────────────────────────────────────────────

export const indexedAddresses = duckdbTable('indexed_addresses', {
  address: address().primaryKey(),
  type: varchar({ length: 20 }).notNull(),
  firstSeen: timestamp(),
  lastActivity: timestamp(),
  transactionCount: integer().default(0),
  indexedAt: datetime().default(sql`now()`),
});

// ─── 6. Search History ───────────────────────────────────────────────────────

export const searchHistory = duckdbTable('search_history', {
  id: integer().primaryKey(),
  query: varchar({ length: 255 }),
  searchType: varchar({ length: 20 }),
  resultCount: integer().default(0),
  searchedAt: datetime().default(sql`now()`),
});

// ─── 7. User Preferences ─────────────────────────────────────────────────────

export const userPreferences = duckdbTable('user_preferences', {
  key: varchar({ length: 255 }).primaryKey(),
  value: text(),
  updatedAt: datetime().default(sql`now()`),
});

// ─── 8. Access History ───────────────────────────────────────────────────────

export const accessHistory = duckdbTable(
  'access_history',
  {
    type: varchar({ length: 20 }).notNull(),
    identifier: varchar({ length: 66 }).notNull(),
    firstAccessed: datetime().default(sql`now()`),
    lastAccessed: datetime().default(sql`now()`),
    accessCount: integer().default(1),
  },
  table => [primaryKey({ columns: [table.type, table.identifier] })],
);

// ─── 9. Indexing Progress ────────────────────────────────────────────────────

export const indexingProgress = duckdbTable('indexing_progress', {
  address: address().primaryKey(),
  creationBlock: bignum(),
  lastIndexedBlock: bignum(),
  lastFinalizedBlock: bignum(),
  totalEventsIndexed: integer().default(0),
  status: varchar({ length: 20 }).default('idle'),
  errorMessage: text(),
  updatedAt: datetime().default(sql`now()`),
});

// ─── 10. Contract Events ─────────────────────────────────────────────────────

export const contractEvents = duckdbTable(
  'contract_events',
  {
    contractAddress: address().notNull(),
    blockNumber: bignum().notNull(),
    blockTimestamp: timestamp(),
    transactionHash: txHash().notNull(),
    transactionIndex: integer(),
    logIndex: integer().notNull(),
    eventName: varchar({ length: 100 }),
    eventSignature: varchar({ length: 66 }),
    decodedArgs: text(),
    topic0: varchar({ length: 66 }),
    topic1: varchar({ length: 66 }),
    topic2: varchar({ length: 66 }),
    topic3: varchar({ length: 66 }),
    data: text(),
    isFinalized: boolean().default(false),
    indexedAt: datetime().default(sql`now()`),
  },
  table => [primaryKey({ columns: [table.transactionHash, table.logIndex] })],
);

// ─── 11. Event Table Registry ────────────────────────────────────────────────

export const eventTableRegistry = duckdbTable(
  'event_table_registry',
  {
    contractAddress: address().notNull(),
    eventSignature: varchar({ length: 66 }).notNull(),
    eventName: varchar({ length: 255 }),
    tableName: varchar({ length: 255 }).notNull(),
    tableSchema: text(),
    isActive: boolean().default(true),
    lastAccessed: datetime(),
    ...timestampColumns,
  },
  table => [primaryKey({ columns: [table.contractAddress, table.eventSignature] })],
);

// ─── 12. Storage Layouts ─────────────────────────────────────────────────────

export const storageLayouts = duckdbTable('storage_layouts', {
  address: address().primaryKey(),
  layout: text().notNull(),
  source: varchar({ length: 20 }),
  isProxy: boolean().default(false),
  implementationAddress: address(),
  createdAt: datetime().default(sql`now()`),
  updatedAt: datetime().default(sql`now()`),
});

// ─── 13. Indexing Ranges ─────────────────────────────────────────────────────

export const indexingRanges = duckdbTable(
  'indexing_ranges',
  {
    address: address().notNull(),
    rangeId: integer().notNull(),
    fromBlock: bignum().notNull(),
    toBlock: bignum().notNull(),
    direction: varchar({ length: 10 }).notNull().default('forward'),
    currentBlock: bignum(),
    status: varchar({ length: 20 }).notNull().default('pending'),
    totalEventsIndexed: integer().default(0),
    errorMessage: text(),
    priority: integer().default(0),
    ...timestampColumns,
  },
  table => [primaryKey({ columns: [table.address, table.rangeId] })],
);

// ─── Type Inferences ─────────────────────────────────────────────────────────

export type ChainBlock = typeof blocks.$inferSelect;
export type NewChainBlock = typeof blocks.$inferInsert;

export type ChainTransaction = typeof transactions.$inferSelect;
export type NewChainTransaction = typeof transactions.$inferInsert;

export type ChainContractSource = typeof contractSources.$inferSelect;
export type NewChainContractSource = typeof contractSources.$inferInsert;

export type ChainContractCreationInfo = typeof contractCreationInfo.$inferSelect;
export type NewChainContractCreationInfo = typeof contractCreationInfo.$inferInsert;

export type ChainIndexedAddress = typeof indexedAddresses.$inferSelect;
export type NewChainIndexedAddress = typeof indexedAddresses.$inferInsert;

export type ChainSearchHistory = typeof searchHistory.$inferSelect;
export type NewChainSearchHistory = typeof searchHistory.$inferInsert;

export type ChainUserPreference = typeof userPreferences.$inferSelect;
export type NewChainUserPreference = typeof userPreferences.$inferInsert;

export type ChainAccessHistory = typeof accessHistory.$inferSelect;
export type NewChainAccessHistory = typeof accessHistory.$inferInsert;

export type ChainIndexingProgress = typeof indexingProgress.$inferSelect;
export type NewChainIndexingProgress = typeof indexingProgress.$inferInsert;

export type ChainContractEvent = typeof contractEvents.$inferSelect;
export type NewChainContractEvent = typeof contractEvents.$inferInsert;

export type ChainEventTableRegistry = typeof eventTableRegistry.$inferSelect;
export type NewChainEventTableRegistry = typeof eventTableRegistry.$inferInsert;

export type ChainStorageLayout = typeof storageLayouts.$inferSelect;
export type NewChainStorageLayout = typeof storageLayouts.$inferInsert;

export type ChainIndexingRange = typeof indexingRanges.$inferSelect;
export type NewChainIndexingRange = typeof indexingRanges.$inferInsert;
