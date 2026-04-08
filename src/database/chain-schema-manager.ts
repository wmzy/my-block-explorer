import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  integer,
  text,
  boolean,
  customType,
  primaryKey,
} from 'drizzle-orm/pg-core';
import type { AbiEvent, AbiParameter } from 'viem';

const timestampS = customType<{ data: number; driverData: string }>({
  dataType: () => 'TIMESTAMP_S',
  toDriver: (value: number) => {
    if (typeof value === 'number') {
      return new Date(value * 1000).toISOString();
    }
    return String(value);
  },
  fromDriver: (value: string) => Math.floor(new Date(value).getTime() / 1000),
});

const timestampMs = customType<{ data: Date; driverData: string }>({
  dataType: () => 'TIMESTAMP_MS',
  toDriver: (value: Date) => value.toISOString(),
  fromDriver: (value: string) => new Date(value),
});

function abiTypeToColumn(abiType: string, nullable: boolean) {
  let col;

  if (abiType === 'bool') {
    col = boolean();
  } else if (abiType === 'address') {
    col = varchar({ length: 42 });
  } else if (/^bytes(\d+)$/.test(abiType)) {
    const byteLen = parseInt(abiType.match(/^bytes(\d+)$/)![1]);
    col = varchar({ length: 2 + byteLen * 2 });
  } else {
    // uint*, int*, string, bytes, tuple, arrays → TEXT
    col = text();
  }

  return nullable ? col : col.notNull();
}

function buildEventTableSchema(tableName: string, eventAbi: AbiEvent) {
  const baseColumns = {
    blockHash: varchar().notNull(),
    logIndex: integer().notNull(),
    transactionHash: varchar().notNull(),
    transactionIndex: integer(),
    blockNumber: varchar({ length: 32 }).notNull(), // bignum → VARCHAR(32)
    contractAddress: varchar().notNull(),
    eventName: varchar().notNull(),
    eventSignature: varchar().notNull(),
  };

  const dynamicColumns: Record<
    string,
    ReturnType<typeof text | typeof varchar | typeof boolean>
  > = {};
  if (eventAbi.inputs) {
    for (const input of eventAbi.inputs as (AbiParameter & { indexed?: boolean })[]) {
      if (!input.name) continue;
      dynamicColumns[input.name] = abiTypeToColumn(input.type, !input.indexed);
    }
  }

  const allColumns = {
    ...baseColumns,
    ...dynamicColumns,
    blockTimestamp: timestampS().notNull(),
    decodedAt: timestampS().default(sql`CURRENT_TIMESTAMP`),
    indexedAt: timestampMs().default(sql`CURRENT_TIMESTAMP`),
  };

  return pgTable(tableName, allColumns, t => [primaryKey({ columns: [t.blockHash, t.logIndex] })]);
}

export class ChainSchemaManager {
  constructor(_chainId?: number) {}

  async getCreateEventTableSQL(tableName: string, eventAbi: AbiEvent): Promise<string> {
    const eventTable = buildEventTableSchema(tableName, eventAbi);

    const emptySnapshot = generateDrizzleJson({});
    const fullSnapshot = generateDrizzleJson(
      { [tableName]: eventTable },
      undefined,
      undefined,
      'snake_case',
    );

    const sqlStatements = await generateMigration(emptySnapshot, fullSnapshot);

    // drizzle-kit omits IF NOT EXISTS; inject it for idempotent table creation
    return sqlStatements
      .map(stmt => stmt.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'))
      .join(';\n');
  }

  getEventTableIndexesSQL(tableName: string, eventAbi: AbiEvent): string[] {
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_block_timestamp ON ${tableName} (block_timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_contract_address ON ${tableName} (contract_address)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_transaction_hash ON ${tableName} (transaction_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_block_number ON ${tableName} (block_number)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_event_name ON ${tableName} (event_name)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_event_signature ON ${tableName} (event_signature)`,
    ];

    if (eventAbi.inputs) {
      for (const input of eventAbi.inputs as (AbiParameter & { indexed?: boolean })[]) {
        if (input.indexed && input.name) {
          indexes.push(
            `CREATE INDEX IF NOT EXISTS idx_${tableName}_${input.name} ON ${tableName} (${input.name})`,
          );
        }
      }
    }

    return indexes;
  }
}
