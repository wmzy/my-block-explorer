/**
 * DuckDB-compatible database schema
 * Built on type-safe DuckDB-specific constructors so only supported
 * features are used.
 *
 * Design principles:
 * 1. Guarantee DuckDB compatibility at the schema-definition level
 * 2. Use explicit DuckDB type constructors
 * 3. Avoid unsafe SQL conversions at runtime
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

// Common field combinations
const timestampColumns = {
  createdAt: datetime().default(sql`now()`),
  updatedAt: datetime().default(sql`now()`),
} as const;

// Chain-related base fields
const chainColumns = {
  chainId: integer().notNull(),
} as const;

// Address-related fields
const addressColumns = {
  address: address().notNull(),
} as const;

// Chain + address combination (common in contract-related tables)
const chainAddressColumns = {
  ...chainColumns,
  ...addressColumns,
} as const;

// User RPC configuration table
export const userRpcConfigs = duckdbTable('user_rpc_configs', {
  chainId: integer().primaryKey(),
  name: varchar({ length: 255 }),
  url: varchar({ length: 500 }),
  supportsHistory: boolean(),
  maxEventRange: integer(),

  ...timestampColumns,
});

// Custom chain registrations — EVM chains outside viem's static registry
// that the user pointed the explorer at (anvil 31337, hardhat forks,
// private geth, new L2s). The rpcUrl is the discovery source: everything
// the explorer serves for the chain flows through it. One row per chain
// id; re-registering replaces the row (upsert in routes/chains.ts). viem
// stays the first lookup layer — these rows only fill ids viem does not
// ship (the route 409s on ids viem already knows), so the two layers
// never overlap.
export const customChains = duckdbTable('custom_chains', {
  chainId: integer().primaryKey(),
  name: varchar({ length: 255 }).notNull(),
  symbol: varchar({ length: 64 }).notNull(),
  rpcUrl: varchar({ length: 500 }).notNull(),
  decimals: integer().default(18),

  ...timestampColumns,
});

// Blocks table
export const blocks = duckdbTable(
  'blocks',
  {
    ...chainColumns,
    number: bignum().notNull(), // block number
    hash: blockHash().notNull(),
    parentHash: blockHash(),
    timestamp: timestamp(),
    miner: address(),
    gasLimit: bignum(), // gas limit
    gasUsed: bignum(), // gas used
    baseFeePerGas: bignum(), // gas price
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
  table => [
    primaryKey({ columns: [table.chainId, table.number] }),
    unique().on(table.chainId, table.hash),
    // NOTE: indexes are created manually in migration scripts to avoid
    // Drizzle generating incompatible index syntax
  ],
);

// Transactions table
export const transactions = duckdbTable(
  'transactions',
  {
    ...chainColumns,
    hash: txHash().notNull(),
    blockNumber: bignum(), // block number
    transactionIndex: integer(),
    fromAddress: address(),
    toAddress: address(),
    value: bignum(), // value in wei
    gasLimit: bignum(), // gas limit
    gasPrice: bignum(), // gas price
    maxFeePerGas: bignum(), // max gas fee
    maxPriorityFeePerGas: bignum(), // max priority fee
    gasUsed: bignum(), // gas used
    effectiveGasPrice: bignum(), // effective gas price
    status: txStatus(),
    type: txType().default(0),
    nonce: bignum(), // nonce value
    inputData: hexData(),
    logsCount: integer().default(0),
    contractAddress: address(),
    cumulativeGasUsed: bignum(), // cumulative gas used
    timestamp: timestamp(),
    indexedAt: datetime().default(sql`now()`),
  },
  table => [
    primaryKey({ columns: [table.chainId, table.hash] }),
    unique().on(table.chainId, table.blockNumber, table.transactionIndex),
    // NOTE: indexes are created manually in migration scripts
  ],
);

// Indexed addresses table
export const indexedAddresses = duckdbTable(
  'indexed_addresses',
  {
    ...chainAddressColumns,
    type: varchar({ length: 20 }).notNull(), // 'EOA', 'contract'
    firstSeen: timestamp(),
    lastActivity: timestamp(),
    transactionCount: integer().default(0),
    indexedAt: datetime().default(sql`now()`),
  },
  table => [
    primaryKey({ columns: [table.chainId, table.address] }),
    // NOTE: indexes are created manually in migration scripts
  ],
);

// User preferences table
export const userPreferences = duckdbTable('user_preferences', {
  id: integer().primaryKey(),
  theme: varchar({ length: 20 }).default('light'),
  language: varchar({ length: 10 }).default('en'),
  updatedAt: datetime().default(sql`now()`),
});

// Index status table
export const indexStatus = duckdbTable(
  'index_status',
  {
    ...chainColumns,
    indexType: varchar({ length: 20 }).notNull(), // 'blocks', 'transactions'
    lastIndexedBlock: bignum(),
    lastIndexedAt: datetime().default(sql`now()`),
  },
  table => [primaryKey({ columns: [table.chainId, table.indexType] })],
);

// Access history table
export const accessHistory = duckdbTable(
  'access_history',
  {
    ...chainColumns,
    type: varchar({ length: 20 }).notNull(), // 'block', 'transaction', 'address'
    identifier: varchar({ length: 66 }).notNull(), // hash or address
    firstAccessed: datetime().default(sql`now()`),
    lastAccessed: datetime().default(sql`now()`),
    accessCount: integer().default(1),
  },
  table => [
    primaryKey({ columns: [table.chainId, table.type, table.identifier] }),
    // NOTE: indexes are created manually in migration scripts
  ],
);

// Contract source table
export const contractSources = duckdbTable(
  'contract_sources',
  {
    ...chainAddressColumns,
    sourceCode: text(),
    sourceFiles: text(), // JSON array of { filename, content } for multi-file contracts
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
    implementationAddresses: text(), // JSON array of facet addresses (EIP-2535 diamonds)
    swarmSource: varchar({ length: 100 }),
    isVerified: boolean().default(false),
    verificationSource: varchar({ length: 50 }),
    verificationDate: datetime().default(sql`now()`),
    lastUpdated: datetime().default(sql`now()`),
  },
  table => [
    primaryKey({ columns: [table.chainId, table.address] }),
    // NOTE: indexes are created manually in migration scripts
  ],
);

// Contract creation info table
export const contractCreationInfo = duckdbTable(
  'contract_creation_info',
  {
    ...chainAddressColumns,
    creationTxHash: txHash(),
    creationBlockNumber: bignum(),
    creationTimestamp: timestamp(),
    creatorAddress: address(),
    factoryAddress: address(),
    creationMethod: varchar({ length: 50 }),
    lastUpdated: datetime().default(sql`now()`),
  },
  table => [
    primaryKey({ columns: [table.chainId, table.address] }),
    // NOTE: indexes are created manually in migration scripts
  ],
);

// Event indexing progress — tracks per-contract indexing state
export const indexingProgress = duckdbTable(
  'indexing_progress',
  {
    ...chainColumns,
    address: address().notNull(),
    creationBlock: bignum(),
    lastIndexedBlock: bignum(),
    lastFinalizedBlock: bignum(),
    totalEventsIndexed: integer().default(0),
    status: varchar({ length: 20 }).default('idle'),
    errorMessage: text(),
    updatedAt: datetime().default(sql`now()`),
  },
  table => [primaryKey({ columns: [table.chainId, table.address] })],
);

// Indexing ranges — stores user-defined block ranges for event indexing
export const indexingRanges = duckdbTable(
  'indexing_ranges',
  {
    ...chainColumns,
    address: address().notNull(),
    rangeId: integer().notNull(),
    fromBlock: bignum().notNull(),
    toBlock: bignum().notNull(),
    direction: varchar({ length: 10 }).notNull().default('forward'), // 'forward' | 'backward'
    currentBlock: bignum(), // current position during indexing
    status: varchar({ length: 20 }).notNull().default('pending'), // 'pending' | 'indexing' | 'paused' | 'completed' | 'error'
    totalEventsIndexed: integer().default(0),
    errorMessage: text(),
    priority: integer().default(0), // higher = more urgent
    ...timestampColumns,
  },
  table => [primaryKey({ columns: [table.chainId, table.address, table.rangeId] })],
);

// Contract events — stores decoded events for all contracts
export const contractEvents = duckdbTable(
  'contract_events',
  {
    ...chainColumns,
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
  table => [
    primaryKey({
      columns: [table.chainId, table.transactionHash, table.logIndex],
    }),
  ],
);

// Event table registry
export const eventTableRegistry = duckdbTable(
  'event_table_registry',
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
  table => [primaryKey({ columns: [table.chainId, table.contractAddress, table.eventSignature] })],
);

export const storageLayouts = duckdbTable(
  'storage_layouts',
  {
    ...chainAddressColumns,
    layout: text().notNull(),
    source: varchar({ length: 20 }),
    isProxy: boolean().default(false),
    implementationAddress: address(),
    createdAt: datetime().default(sql`now()`),
    updatedAt: datetime().default(sql`now()`),
  },
  table => [primaryKey({ columns: [table.chainId, table.address] })],
);

// Inferred type exports
export type EventTableRegistry = typeof eventTableRegistry.$inferSelect;
export type NewEventTableRegistry = typeof eventTableRegistry.$inferInsert;

export type UserRpcConfig = typeof userRpcConfigs.$inferSelect;
export type NewUserRpcConfig = typeof userRpcConfigs.$inferInsert;

export type CustomChainRecord = typeof customChains.$inferSelect;
export type NewCustomChainRecord = typeof customChains.$inferInsert;

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

export type IndexingProgress = typeof indexingProgress.$inferSelect;
export type NewIndexingProgress = typeof indexingProgress.$inferInsert;

export type IndexingRange = typeof indexingRanges.$inferSelect;
export type NewIndexingRange = typeof indexingRanges.$inferInsert;

export type ContractEvent = typeof contractEvents.$inferSelect;
export type NewContractEvent = typeof contractEvents.$inferInsert;

export type StorageLayoutRecord = typeof storageLayouts.$inferSelect;
export type NewStorageLayoutRecord = typeof storageLayouts.$inferInsert;

// Signature cache — openchain-resolved function selectors (4-byte) and
// event topic0 hashes (32-byte). A selector always hashes the same
// canonical signature, so a resolved row is immutable and serves forever;
// the nullable signature column doubles as the negative-cache marker
// (null = upstream had no candidate at fetchedAt; re-checked on read with
// a bounded TTL — see SignatureService). The column stores ALL candidates
// as one JSON array string preserving openchain's popularity order, which
// keeps the (kind, selector) primary key exact.
export const signatureCache = duckdbTable(
  'signature_cache',
  {
    kind: varchar({ length: 10 }).notNull(), // 'function' | 'event'
    selector: varchar({ length: 66 }).notNull(), // 0x + 8 or 64 lowercase hex
    signature: text(),
    source: varchar({ length: 20 }),
    fetchedAt: datetime().default(sql`now()`),
  },
  table => [primaryKey({ columns: [table.kind, table.selector] })],
);

export type SignatureCacheRecord = typeof signatureCache.$inferSelect;
export type NewSignatureCacheRecord = typeof signatureCache.$inferInsert;

// Address labels — user-authored annotations pinned to one address on one
// chain (a personal notes layer, never indexer data). One label per
// (chain, address); re-saving replaces the row wholesale (PUT upsert
// semantics in routes/labels.ts). Storage keys stay lowercase per the
// project-wide convention (C-3), so checksummed lookups normalize before
// they reach the database.
export const addressLabels = duckdbTable(
  'address_labels',
  {
    ...chainAddressColumns,
    label: varchar({ length: 64 }).notNull(),
    note: text(),
    // Provenance of the row: 'builtin' = planted from the curated dataset
    // shipped in the package (config/builtinLabels.ts, seeded on first
    // startup); 'user' = authored by the operator. PUT always writes
    // 'user' — editing a bundled label converts it into the operator's
    // own (user intent wins over the seed). Nullable on purpose: DuckDB
    // cannot ADD COLUMN with constraints, so the DEFAULT backfills
    // pre-migration rows and the app layer (routes/labels.ts) pins the
    // API contract to 'builtin' | 'user' regardless of storage nulls.
    source: varchar({ length: 16 }).default('user'),
    createdAt: datetime().default(sql`now()`),
    updatedAt: datetime().default(sql`now()`),
  },
  table => [primaryKey({ columns: [table.chainId, table.address] })],
);

export type AddressLabelRecord = typeof addressLabels.$inferSelect;
export type NewAddressLabelRecord = typeof addressLabels.$inferInsert;

// Watch subscriptions — the server-side twin of the browser watchlist
// (util/watchlist.ts): addresses the LOCAL backend tails on-chain (one
// getLogs sweep per interval, services/WatchService.ts), so watching
// continues while the backend runs even when no explorer tab is open
// (browser notifications still need an open tab — see src/index.tsx).
// One row per (chain, address), PUT upsert semantics (routes/watch.ts).
// Storage keys stay lowercase per the project-wide convention (C-3);
// address is varchar(42) rather than the char(42) address() type so the
// exact casing the writer validated is what comparisons see. The
// lastProcessedBlock cursor is the inclusive head of the last completed
// sweep — null until the first tick baselines the row at the
// then-current head (watching starts at subscribe time, never history).
export const watchSubscriptions = duckdbTable(
  'watch_subscriptions',
  {
    chainId: integer().notNull(),
    address: varchar({ length: 42 }).notNull(),
    label: varchar({ length: 100 }),
    lastProcessedBlock: bignum(),
    // Optional per-event webhook delivery (services/WatchService.ts →
    // utils/webhooks.ts): each NEW log event is POSTed once to this URL.
    // Nullable-on-purpose (DuckDB cannot ADD COLUMN with constraints —
    // migration 0015): null = no webhook. When the URL is re-put or
    // cleared, the two status columns reset — they describe deliveries
    // to the CURRENT url only.
    webhookUrl: text(),
    // 'ok' | 'failed: <short reason>' | null (nothing delivered yet).
    webhookStatus: text(),
    // Server clock of the last delivery attempt (ISO-moment Date).
    webhookLastAt: datetime(),
    createdAt: datetime().default(sql`now()`),
    updatedAt: datetime().default(sql`now()`),
  },
  table => [primaryKey({ columns: [table.chainId, table.address] })],
);

export type WatchSubscriptionRecord = typeof watchSubscriptions.$inferSelect;
export type NewWatchSubscription = typeof watchSubscriptions.$inferInsert;

// Address deep-scan jobs — a persistent, resumable per-address transaction
// discovery walk (services/AddressScanService.ts). One row per
// (chain, address): a second POST with different bounds is a conflict
// unless force resets the row. Block bounds resolve ONCE at creation to
// concrete numbers — stored rows never carry tags (same rule as event
// ranges). The walk is FORWARD: cursorBlock is the highest CONTIGUOUS
// verified block starting at fromBlock (fromBlock - 1 before any
// progress), so blocksWalked = cursorBlock - fromBlock + 1 and the job
// completes when cursorBlock === toBlock. Coverage is NEVER stored — it
// is derived ('complete' only when status === 'complete' AND fromBlock
// === 0, the genesis anchor where "no activity outside the walk" is
// provable). Storage keys stay lowercase per the project-wide
// convention; address is varchar(42) like watch_subscriptions so
// comparisons see exactly the normalized writer input.
export const addressScanJobs = duckdbTable(
  'address_scan_jobs',
  {
    chainId: integer().notNull(),
    address: varchar({ length: 42 }).notNull(),
    fromBlock: bignum().notNull(),
    toBlock: bignum().notNull(),
    cursorBlock: bignum().notNull(),
    status: varchar({ length: 20 }).notNull().default('pending'),
    txsFound: integer().notNull().default(0),
    // Deep-scan trace recording: the POST /scan opt-in and the provider
    // capability verdict. Nullable-on-purpose (no .notNull()) mirrors
    // address_labels.source: DuckDB cannot ADD COLUMN with constraints,
    // so these arrive on the EXISTING table via ALTER with DEFAULTs only
    // and the DTO layer normalizes storage nulls (tracesRequested ?? false,
    // tracesSupported ?? null, tracesRecorded ?? 0).
    tracesRequested: boolean().default(false),
    // null = not yet probed (no change block traced so far); flips to
    // true on the first successful debug_traceTransaction and to false —
    // once — when the provider proves it lacks the method (the walk then
    // skips all further tracing but continues normally).
    tracesSupported: boolean(),
    tracesRecorded: integer().default(0),
    errorMessage: text(),
    updatedAt: datetime().notNull().default(sql`now()`),
  },
  table => [primaryKey({ columns: [table.chainId, table.address] })],
);

export type AddressScanJobRecord = typeof addressScanJobs.$inferSelect;
export type NewAddressScanJob = typeof addressScanJobs.$inferInsert;

// Deep-scan findings — one row per transaction hash the walk verified as
// touching the address. The pinned storage contract is deliberately
// minimal (hash + block number): full transaction envelopes are
// hydrated at read time from immutable RPC data (cached), never stored.
// Deleting the job row removes its findings (composite PK shares the
// (chain, address) key prefix).
export const addressScanFindings = duckdbTable(
  'address_scan_findings',
  {
    chainId: integer().notNull(),
    address: varchar({ length: 42 }).notNull(),
    txHash: txHash().notNull(),
    blockNumber: bignum().notNull(),
  },
  table => [primaryKey({ columns: [table.chainId, table.address, table.txHash] })],
);

export type AddressScanFindingRecord = typeof addressScanFindings.$inferSelect;
export type NewAddressScanFinding = typeof addressScanFindings.$inferInsert;

// Deep-scan internal transactions — callTracer frames the walk records
// for change blocks when the job opted into tracing (tracesRequested).
// One row per (chain, address, txHash, tracePath): tracePath is the
// depth-joined child-index path from the traced root ('0' = the root's
// first sub-call, '0.1' that child's second sub-call, ...), so sibling
// and nested frames never collide under the composite PK. Only the four
// call/callcode/delegatecall/staticcall frame types are recorded, so
// from/to always exist. transactionIndex (the tx's position in
// block.transactions) is stored alongside blockNumber — an authorized
// deviation from the findings minimalism — because the API orders
// newest-first by blockNumber desc, then tx index, and the walk is the
// only place that knows the index. Coverage honesty: these rows NEVER
// feed the coverage derivation — transaction coverage stays derived
// from the walk alone. Deleting the job row removes them (composite PK
// shares the (chain, address) key prefix, same as findings).
export const addressScanInternalTxs = duckdbTable(
  'address_scan_internal_txs',
  {
    chainId: integer().notNull(),
    address: varchar({ length: 42 }).notNull(),
    txHash: txHash().notNull(),
    tracePath: varchar().notNull(),
    blockNumber: bignum().notNull(),
    transactionIndex: integer().notNull(),
    fromAddress: address().notNull(),
    toAddress: address().notNull(),
    value: bignum().notNull(),
    callType: varchar({ length: 20 }).notNull(),
    reverted: boolean().notNull(),
    blockTimestamp: datetime().notNull(),
  },
  table => [
    primaryKey({ columns: [table.chainId, table.address, table.txHash, table.tracePath] }),
  ],
);

export type AddressScanInternalTxRecord = typeof addressScanInternalTxs.$inferSelect;
export type NewAddressScanInternalTx = typeof addressScanInternalTxs.$inferInsert;
