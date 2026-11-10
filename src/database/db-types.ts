import { toIsoTimestamp } from '../utils/dbTime';
import { customType } from 'drizzle-orm/pg-core';

// ✅ DuckDB-compatible base types - re-exported directly for compatibility
export { integer, varchar, text, boolean } from 'drizzle-orm/pg-core';

// ✅ DuckDB-compatible bigint - stores big numbers as varchar to avoid precision loss
export const bignum = customType<{
  data: bigint;
  driverData: string;
}>({
  dataType: () => 'BIGNUM',
  toDriver: (value: bigint) => value.toString(),
  fromDriver: (value: string) => BigInt(value),
});

export const uint256 = bignum;

// unix timestamp, second precision
export const timestamp = customType<{
  data: number;
  driverData: string | Date;
}>({
  dataType: () => 'TIMESTAMP_S',
  toDriver: (value: number) => new Date(value * 1000).toISOString(),
  // The adapter (duckdb-postgres-adapter adaptResult) already normalizes
  // every DuckDB timestamp shape — TIMESTAMP_S seconds objects included —
  // to a UTC-correct Date before drizzle maps the row; assert that Date
  // directly. A string can still arrive on raw-render paths: parse it
  // offset-aware (naive = UTC), never machine-local.
  fromDriver: (value: string | Date) =>
    value instanceof Date
      ? Math.floor(value.getTime() / 1000)
      : Math.floor(Date.parse(toIsoTimestamp(value) ?? '') / 1000),
});

export const address = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => `char(42)`,
});

// EVM-specific type definitions

// Transaction hash - 32 bytes, 0x-prefixed
export const txHash = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => `char(66)`,
});

// Block hash - 32 bytes, 0x-prefixed
export const blockHash = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => `char(66)`,
});

// Generic hash - 32 bytes, 0x-prefixed (state root, receipts root, etc.)
export const hash32 = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => 'char(66)',
});

// Byte data - variable-length hex data
export const hexData = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => 'text',
});

// Transaction type (0: Legacy, 1: EIP-2930, 2: EIP-1559, etc.)
export const txType = customType<{
  data: number;
  driverData: number;
}>({
  dataType: () => 'integer',
});

// Transaction status (0: failed, 1: success)
export const txStatus = customType<{
  data: 0 | 1;
  driverData: number;
}>({
  dataType: () => 'integer',
});

// Datetime types
export const datetime = customType<{
  data: Date;
  driverData: string | Date;
}>({
  dataType: () => 'TIMESTAMP_MS',
  toDriver: (value: Date) => value.toISOString(),
  // Same defense as `timestamp` above: the adapter normally hands back a
  // UTC-correct Date; a naive string on raw-render paths parses
  // offset-aware (naive = UTC), never machine-local.
  fromDriver: (value: string | Date) =>
    value instanceof Date ? value : new Date(toIsoTimestamp(value) ?? Number.NaN),
});

// ✅ DuckDB-compatible table constructor
export { pgTable as duckdbTable } from 'drizzle-orm/pg-core';

// ✅ DuckDB-compatible constraint constructors
export { primaryKey, unique } from 'drizzle-orm/pg-core';

// ✅ DuckDB-compatible index constructor - specifying index types is unsupported
export { index as duckdbIndex } from 'drizzle-orm/pg-core';
