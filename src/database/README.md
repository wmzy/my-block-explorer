# DuckDB + Drizzle ORM Integration

This project uses DuckDB as its database, integrated with Drizzle ORM through a custom adapter for type-safe database operations.

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Drizzle ORM   │────│  Custom Adapter  │────│     DuckDB      │
│   (PostgreSQL)  │    │  (Compatibility) │    │   (Neo Client)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Core files

- `drizzle.ts` - Drizzle ORM configuration
- `duckdb-postgres-adapter.ts` - DuckDB-compatible adapter
- `duckdb-types.ts` - Type-safe DuckDB-specific constructors
- `schema.ts` - Database table definitions
- `migrate.ts` - Database migration script

## Design Principles

### 1. Type safety at the schema level

**Principle**: forbid unsupported types and indexes at schema definition time instead of making unsafe runtime replacements.

**Result**: custom types and redesigned table structures solved the SERIAL problem and eliminated runtime SQL conversion.

```typescript
// ✅ Recommended: use the DuckDB-specific type constructors
import { duckdbBigint, duckdbTimestamp, duckdbTable } from './duckdb-types';

export const blocks = duckdbTable('blocks', {
  chainId: integer('chain_id').notNull(),
  number: duckdbBigint('number').notNull(),           // VARCHAR(32) - avoids precision loss
  hash: varchar('hash', { length: 66 }).notNull(),
  timestamp: duckdbTimestamp('timestamp'),            // TIMESTAMP (no timezone)
}, (table) => [
  primaryKey({ columns: [table.chainId, table.number] }),
  unique().on(table.chainId, table.hash),
  // Note: indexes are created manually in the migration script
]);

// ❌ Avoid: directly using potentially incompatible types
import { bigint, timestamp } from 'drizzle-orm/pg-core';
export const blocks = pgTable('blocks', {
  number: bigint('number', { mode: 'string' }), // may cause runtime errors
});
```

### 2. Explicit API design

All DuckDB-specific constructors carry the `duckdb` prefix, making it explicit that developers are using DuckDB features:

```typescript
// DuckDB-specific type constructors
export const duckdbBigint = (name: string) => varchar(name, { length: 32 });
export const duckdbTimestamp = (name: string) => timestamp(name, { withTimezone: false });
export const duckdbTimestampWithDefault = (name: string) => 
  timestamp(name, { withTimezone: false }).defaultNow();
```

### 3. Zero runtime conversion

Using DuckDB-compatible type definitions at the schema level removes the need for runtime SQL conversion entirely.

**Breakthrough**: custom types and redesigned table structures resolved every SERIAL problem — including Drizzle's internal migration tables — achieving true zero runtime conversion.

**Key finding**: DuckDB natively supports PostgreSQL-style parameter placeholders (`$1, $2, ...`); no conversion to `?` style is needed.

### 4. Solution for the SERIAL problem

We fully solved DuckDB's lack of SERIAL support as follows:

#### 4.1 Fix at the schema design level

**Problem**: DuckDB does not support PostgreSQL's `SERIAL` and `BIGSERIAL` types.

**Solution**: use DuckDB-compatible types directly in schema definitions:

```typescript
// ❌ Avoid (forces SQL conversion)
id: serial().primaryKey()

// ✅ Option 1: use an integer primary key
id: integer().primaryKey()

// ✅ Option 2: use a composite primary key (no extra ID needed)
export const userRpcConfigs = duckdbTable("user_rpc_configs", {
  chainId: integer().primaryKey(), // business field as primary key
  name: varchar({ length: 255 }),
  url: varchar({ length: 500 }),
  // ... other fields
});

// ✅ Option 3: use a composite primary key
export const accessHistory = duckdbTable("access_history", {
  chainId: integer(),
  type: varchar({ length: 20 }),
  identifier: varchar({ length: 66 }),
  // ... other fields
}, (table) => [
  primaryKey({ columns: [table.chainId, table.type, table.identifier] })
]);
```

#### 4.2 Migration strategy

When migrating from a SERIAL-based design to a DuckDB-compatible one:

1. **Redesign the primary key strategy**:
   ```typescript
   // Old design (incompatible)
   export const oldTable = pgTable("old_table", {
     id: serial().primaryKey(),
     chainId: integer(),
     data: varchar(),
   });

   // New design (DuckDB-compatible)
   export const newTable = duckdbTable("new_table", {
     chainId: integer().primaryKey(), // business field as primary key
     data: varchar(),
   });
   ```

2. **Generate compatible migration files**:
   ```sql
   -- Generated migration SQL uses INTEGER directly; no runtime conversion
   CREATE TABLE "user_rpc_configs" (
     "chain_id" integer PRIMARY KEY NOT NULL,
     "name" varchar(255),
     "url" varchar(500)
   );
   ```

3. **Adapt the application layer**:
   ```typescript
   // The API layer uses chainId as the identifier
   app.delete("/api/rpc-configs/:chainId", async (c) => {
     const chainId = getValidatedChainId(c);
     await db.delete(userRpcConfigs)
       .where(eq(userRpcConfigs.chainId, chainId));
   });
   ```

#### 4.3 Benefits

1. **Zero runtime overhead**: no SQL string replacement or conversion at all
2. **Compile-time type safety**: incompatible type usage surfaces at compile time
3. **Best performance**: native DuckDB SQL with no intermediate conversion
4. **Minimal maintenance**: the schema is the documentation, stating intent clearly
5. **Simpler adapter**: leaner adapter code focused on core duties

This approach fully realizes the design principle of **"forbidding unsupported types at schema definition time"** and achieves a genuinely zero-conversion architecture.

## DuckDB vs PostgreSQL differences

### Data type differences

| Feature | PostgreSQL | DuckDB | Our solution |
|------|------------|--------|----------------|
| **Big integer precision** | `BIGINT` arbitrary precision | `BIGINT` limited precision | `duckdbBigint` → `VARCHAR(32)` |
| **Timestamp timezone** | `TIMESTAMP WITH TIMEZONE` | limited timezone support | `duckdbTimestamp` → `TIMESTAMP` (no timezone) |
| **Serial types** | `SERIAL`, `BIGSERIAL` | ❌ unsupported | use `integer().primaryKey()` or manage IDs manually |
| **Boolean type** | `BOOLEAN` | ✅ supported | use directly |
| **Text types** | `TEXT`, `VARCHAR` | ✅ supported | use directly |

### Index differences

| Feature | PostgreSQL | DuckDB | Our solution |
|------|------------|--------|----------------|
| **Index types** | `USING btree`, `USING hash` | ❌ specifying types unsupported | the adapter strips `USING btree` |
| **Composite indexes** | ✅ supported | ✅ supported | use directly |
| **Unique indexes** | ✅ supported | ✅ supported | use directly |
| **Partial indexes** | ✅ supported | ❌ limited support | avoid |

### Schema and namespaces

| Feature | PostgreSQL | DuckDB | Our solution |
|------|------------|--------|----------------|
| **Schema support** | ✅ full support | ✅ supported | use directly |
| **Schema syntax** | `CREATE SCHEMA name` | ✅ supported | use directly |
| **Cross-schema queries** | `schema.table` | ✅ supported | use directly |

### Function and operator differences

| Feature | PostgreSQL | DuckDB | Notes |
|------|------------|--------|------|
| **Parameter placeholders** | `$1, $2, ...` | ✅ PostgreSQL style supported | no conversion needed |
| **now()** | ✅ supported | ✅ supported | |
| **CURRENT_TIMESTAMP** | ✅ supported | ✅ supported | |
| **String functions** | rich function set | basic functions | verify specific functions |
| **JSON operations** | strong JSON support | basic JSON support | use with care |

### Transactions and concurrency

| Feature | PostgreSQL | DuckDB | Impact |
|------|------------|--------|------|
| **ACID transactions** | ✅ full support | ✅ supported | no impact |
| **Concurrent reads/writes** | high concurrency | limited concurrency | fits analytical workloads |
| **Locking** | fine-grained locks | simplified locking | fits single/few-user scenarios |

## Type mapping table

### JavaScript/TypeScript → DuckDB

```typescript
// String types
string → VARCHAR(length) | TEXT

// Numeric types
number → INTEGER | DOUBLE
bigint → VARCHAR(32)  // avoid precision loss

// Boolean types
boolean → BOOLEAN

// Date and time
Date → TIMESTAMP     // no timezone
string (ISO) → TIMESTAMP

// Large numbers (common in blockchain)
string → VARCHAR(32) // via duckdbBigint
```

### Drizzle types → DuckDB types

```typescript
// Recommended type mapping
integer(name)                    → INTEGER
varchar(name, {length})          → VARCHAR(length)
text(name)                      → TEXT
boolean(name)                   → BOOLEAN
duckdbBigint(name)              → VARCHAR(32)
duckdbTimestamp(name)           → TIMESTAMP
duckdbTimestampWithDefault(name) → TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

## Best practices

### 1. Use the type-safe constructors

```typescript
// ✅ Recommended
import { 
  duckdbBigint, 
  duckdbTimestamp, 
  duckdbTable 
} from './duckdb-types';

export const transactions = duckdbTable('transactions', {
  value: duckdbBigint('value'),           // automatically VARCHAR(32)
  timestamp: duckdbTimestamp('timestamp'), // automatically timezone-free
});
```

### 2. Avoid advanced SQL features

```typescript
// ✅ Recommended: simple, straightforward queries
const blocks = await db.select()
  .from(blocksTable)
  .where(eq(blocksTable.chainId, chainId))
  .limit(10);

// ⚠️ Careful: complex JSON operations
// DuckDB's JSON support may differ from PostgreSQL
```

### 3. Handling large numbers

```typescript
// ✅ Recommended: store and handle large numbers as strings
const blockNumber = '999999999999999999999'; // string
await db.insert(blocks).values({
  number: blockNumber,  // store the string directly
});

// Reads come back as strings too
const result = await db.select().from(blocks);
console.log(typeof result[0].number); // "string"
```

### 4. Handling timestamps

```typescript
// ✅ Recommended: use timezone-free timestamps
const createdAt = duckdbTimestampWithDefault('created_at');

// Convert timezones in the application layer
const now = new Date().toISOString(); // UTC time
```

## Performance considerations

### DuckDB strengths

- **Columnar storage**: great for analytical queries
- **Memory optimization**: efficient memory usage
- **Vectorized execution**: fast aggregations
- **Compressed storage**: saves disk space

### Use cases

- ✅ **Analytical queries**: aggregation and statistics over large datasets
- ✅ **Bulk inserts**: blockchain data syncing
- ✅ **Read-mostly**: block explorer workloads
- ⚠️ **Highly concurrent writes**: benchmark first
- ❌ **Real-time transactional systems**: not a fit

## Migration and deployment

### Development environment

```bash
# 1. Generate migration files (whenever the schema changes)
npx drizzle-kit generate

# 2. Clean up database files (if needed)
rm -f data/blockchain.db

# 3. Run migrations
npx tsx src/database/migrate.ts

# 4. Verify table structure
npx tsx -e "
import { db } from './src/database/drizzle.js';
const result = await db.execute('SHOW TABLES');
console.log('Tables:', result);
"
```

### Production considerations

1. **Backups**: back up the `.db` file regularly
2. **File permissions**: ensure the app can read and write
3. **Disk space**: monitor database file size
4. **Performance monitoring**: watch query performance

## Troubleshooting

### Common issues

1. **Type conversion errors**
   ```
   Error: Could not convert string 'xxx' to INT64
   ```
   **Fix**: use `duckdbBigint` instead of `bigint`

2. **Index type errors**
   ```
   Error: Unknown index type: BTREE
   ```
   **Fix**: the adapter strips `USING btree` automatically

3. **Schema does not exist**
   ```
   Error: Schema with name 'drizzle' does not exist
   ```
   **Fix**: DuckDB supports schemas; check the migration script

### Debugging tips

```typescript
// Enable SQL logging
const db = drizzle(adapter, { 
  schema,
  logger: true  // log generated SQL
});

// Inspect table structure
await db.execute('DESCRIBE table_name');

// List all tables
await db.execute('SHOW TABLES');
```

## Summary

With type-safe design and minimal runtime conversion, we built an efficient, reliable DuckDB + Drizzle ORM integration. It delivers:

- ✅ **Type safety**: incompatible usage caught at compile time
- ✅ **Explicitness**: API names state DuckDB specifics    
- ✅ **Maintainability**: centralized type definitions and adapter logic
- ✅ **Performance**: no runtime string manipulation
- ✅ **Reliability**: fewer implicit conversion errors
- ✅ **SERIAL solved**: table redesign removed the SERIAL compatibility problem entirely

### Key achievements

1. **SERIAL fully solved**: business-field and composite primary keys removed any dependence on SERIAL
2. **True zero runtime conversion**: all generated SQL is natively DuckDB-compatible — user tables and Drizzle's internal migration tables alike — with no string replacement
3. **Design principle realized**: the goal of forbidding unsupported types at schema definition time is met
4. **Complete type system**: a full DuckDB-compatible type system guarantees compile-time type safety
5. **Simpler adapter**: the adapter now focuses on core duties (connection management, result conversion) with no SQL compatibility work

This architecture is a strong fit for blockchain analytics and block explorer workloads, efficiently storing and querying large volumes of structured data.
