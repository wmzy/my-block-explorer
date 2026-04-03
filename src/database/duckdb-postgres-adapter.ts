import { DuckDBInstance } from '@duckdb/node-api';
import { join } from 'path';
import { mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { type Sql } from 'postgres';
import { createLogger } from '../server/logger';

const logger = createLogger('duckdb-postgres-adapter');

/**
 * DuckDB 到 postgres 的适配器
 * 使用最新的 @duckdb/node-api (Neo) 实现 postgres 的核心接口，让 Drizzle ORM 可以直接使用
 */
export class DuckDBPostgresAdapter {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private isFullInitializing = false;
  private isMigrating = false;
  private dbPath: string;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly CHECKPOINT_INTERVAL_MS = 60_000;

  constructor(connectionString: string) {
    // 解析连接字符串，提取数据库路径
    this.dbPath = this.parseConnectionString(connectionString);

    // 确保数据目录存在
    const dataDir = join(process.cwd(), 'data');
    mkdir(dataDir, { recursive: true }).catch(err =>
      logger.warn({ err }, 'Failed to create data directory'),
    );
  }

  private parseConnectionString(connectionString: string): string {
    // 支持格式：duckdb://path/to/database.db
    if (connectionString.startsWith('duckdb://')) {
      return connectionString.replace('duckdb://', '');
    }
    // 默认路径
    return join(process.cwd(), 'data', 'blockchain.db');
  }

  private async connect(): Promise<void> {
    if (this.instance) return;

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return;
    }

    this.isInitializing = true;
    try {
      await this.recoverWal();
      this.instance = await this.createInstance();
      await this.checkpointWal();
      await this.ensureTables();
    } catch (error) {
      this.instance = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  private async createInstance(): Promise<DuckDBInstance> {
    try {
      return await DuckDBInstance.create(this.dbPath);
    } catch (error) {
      const msg = (error as Error).message ?? '';
      if (msg.includes('replaying WAL') || msg.includes('WAL file')) {
        const walPath = this.dbPath + '.wal';
        logger.warn(
          { err: error, walPath },
          'WAL replay failed on instance creation, deleting WAL and retrying',
        );
        try {
          await unlink(walPath);
        } catch (unlinkError) {
          logger.warn({ err: unlinkError, walPath }, 'Failed to delete WAL during fallback');
        }
        return await DuckDBInstance.create(this.dbPath);
      }
      throw error;
    }
  }

  private async recoverWal(): Promise<void> {
    const walPath = this.dbPath + '.wal';
    if (existsSync(walPath)) {
      try {
        const testInstance = await DuckDBInstance.create(this.dbPath);
        const conn = await testInstance.connect();
        await conn.run('CHECKPOINT');
        conn.disconnectSync();
        testInstance.closeSync();
      } catch (error) {
        logger.warn({ err: error, walPath }, 'WAL recovery failed, deleting corrupted WAL');
        try {
          await unlink(walPath);
        } catch (unlinkError) {
          logger.warn({ err: unlinkError, walPath }, 'Failed to delete corrupted WAL');
        }
      }
    }
  }

  private async checkpointWal(): Promise<void> {
    if (!this.instance) return;
    const conn = await this.instance.connect();
    try {
      await conn.run('CHECKPOINT');
    } catch (error) {
      logger.warn({ err: error }, 'Checkpoint failed');
    } finally {
      conn.disconnectSync();
    }
  }

  private async ensureTables(): Promise<void> {
    if (!this.instance) return;
    const conn = await this.instance.connect();
    try {
      await conn.run('CREATE SCHEMA IF NOT EXISTS "drizzle"');
      await conn.run(
        `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
          id INTEGER PRIMARY KEY,
          name text,
          hash text NOT NULL,
          created_at bigint
        )`,
      );
      await conn.run(
        `ALTER TABLE "drizzle"."__drizzle_migrations" ADD COLUMN IF NOT EXISTS name text`,
      );
    } finally {
      conn.disconnectSync();
    }

    await this.migrate();
  }

  public async migrate(options: { migrationsFolder?: string } = {}): Promise<void> {
    if (this.isMigrating) {
      logger.info('Migration already in progress, skipping');
      return;
    }

    if (!this.instance) {
      await this.connect();
    }

    this.isMigrating = true;

    try {
      const migrationsDir = options.migrationsFolder ?? './drizzle';
      const fs = await import('fs');
      const path = await import('path');

      const files = fs
        .readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');
        const hash = await this.hashString(sql);
        const migrationName = file.replace('.sql', '');

        const existingRecord = await this.getMigrationRecord(migrationName);

        if (existingRecord) {
          if (existingRecord.hash !== hash) {
            throw new Error(
              `Migration ${migrationName} has dirty data: recorded hash ${existingRecord.hash} does not match current ${hash}. ` +
                `Migration file was modified after execution. Clean up __drizzle_migrations table and re-run.`,
            );
          }

          if (await this.verifyMigrationTables(sql)) {
            logger.info({ file, hash }, 'Migration already applied, skipping');
            continue;
          }

          logger.info({ file }, 'Migration recorded but tables missing, re-applying');
          await this.deleteMigrationRecord(migrationName);
        }

        const statements = this.parseMigration(sql);
        logger.info({ file, statements: statements.length }, 'Running migration');

        const isReapply = !!existingRecord;
        for (const statement of statements) {
          if (statement.trim()) {
            const isCreateTable = /^\s*CREATE\s+TABLE/i.test(statement);
            await this.executeStatement(statement, isReapply && isCreateTable);
          }
        }

        await this.recordMigration(migrationName, hash);
        logger.info({ file }, 'Migration completed');
      }

      logger.info('Database migrations applied');
    } finally {
      this.isMigrating = false;
    }
  }

  private parseMigration(sql: string): string[] {
    return sql
      .split(/-->\s*statement-breakpoint/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  private async hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async getMigrationRecord(
    migrationName: string,
  ): Promise<{ name: string; hash: string } | null> {
    if (!this.instance) return null;
    const conn = await this.instance.connect();
    try {
      const result = await conn.runAndReadAll(
        'SELECT name, hash FROM "drizzle"."__drizzle_migrations" WHERE name = $1',
        [migrationName],
      );
      const rows = result.getRowObjects();
      return rows.length > 0
        ? { name: rows[0].name as string, hash: rows[0].hash as string }
        : null;
    } finally {
      conn.disconnectSync();
    }
  }

  private async deleteMigrationRecord(migrationName: string): Promise<void> {
    if (!this.instance) return;
    const conn = await this.instance.connect();
    try {
      await conn.run('DELETE FROM "drizzle"."__drizzle_migrations" WHERE name = $1', [
        migrationName,
      ]);
    } finally {
      conn.disconnectSync();
    }
  }

  private async recordMigration(migrationName: string, hash: string): Promise<void> {
    if (!this.instance) return;
    const conn = await this.instance.connect();
    try {
      const result = await conn.runAndReadAll(
        'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM "drizzle"."__drizzle_migrations"',
      );
      const nextId = result.getRowObjects()[0]?.next_id ?? 1;

      await conn.run(
        'INSERT INTO "drizzle"."__drizzle_migrations" (id, name, hash, created_at) VALUES ($1, $2, $3, $4)',
        [nextId, migrationName, hash, Date.now()],
      );
    } finally {
      conn.disconnectSync();
    }
  }

  private async verifyMigrationTables(sql: string): Promise<boolean> {
    if (!this.instance) return false;

    const tableNames = this.extractTableNames(sql);
    if (tableNames.length === 0) return true;

    const conn = await this.instance.connect();
    try {
      const result = await conn.runAndReadAll(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()',
      );
      const existingTables = new Set(
        result.getRowObjects().map((r: Record<string, unknown>) => r.table_name as string),
      );

      return tableNames.every(name => existingTables.has(name));
    } finally {
      conn.disconnectSync();
    }
  }

  private extractTableNames(sql: string): string[] {
    const names = new Set<string>();

    const createMatches = sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi,
    );
    for (const match of createMatches) {
      names.add(match[1].toLowerCase());
    }

    return Array.from(names);
  }

  private async executeStatement(statement: string, ignoreIfExists = false): Promise<void> {
    if (!this.instance) return;
    const conn = await this.instance.connect();
    try {
      await conn.run(statement);
    } catch (error) {
      const message = (error as Error).message;
      if (ignoreIfExists && /already exists|already have/i.test(message)) {
        return;
      }
      logger.error({ err: error, statement }, 'Migration statement failed');
      throw error;
    } finally {
      conn.disconnectSync();
    }
  }

  public async getDuckDB(): Promise<DuckDBInstance> {
    if (!this.instance) {
      await this.connect();
    }
    return this.instance!;
  }

  // 内部查询执行方法 - 提取公共逻辑
  private async executeQuery(
    queryText: string,
    queryParams: unknown[],
    connection?: Awaited<ReturnType<DuckDBInstance['connect']>>,
  ): Promise<Record<string, unknown>[]> {
    const conn = connection ?? (await this.instance!.connect());
    const shouldDisconnect = !connection;

    try {
      const result =
        queryParams.length > 0
          ? await conn.runAndReadAll(
              queryText,
              queryParams as Parameters<typeof conn.runAndReadAll>[1],
            )
          : await conn.runAndReadAll(queryText);

      return this.adaptResult(result.getRowObjects() as Record<string, unknown>[]);
    } finally {
      if (shouldDisconnect) {
        conn.disconnectSync();
      }
    }
  }

  // 实现 postgres 的核心查询接口
  async query(
    sql: string | TemplateStringsArray,
    ...params: unknown[]
  ): Promise<Record<string, unknown>[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    let queryText: string;
    let queryParams: unknown[];

    if (typeof sql === 'string') {
      queryText = sql;
      queryParams = params;
    } else {
      queryText = sql.join('?');
      queryParams = params;
    }

    // DuckDB's prepared statement API (runAndReadAll with params) does not support
    // the DEFAULT keyword mixed with parameterized values ($1, $2...) in INSERT.
    // Drizzle's PostgreSQL dialect always generates `default` for unprovided columns
    // that have .default() in the schema. Replace with NULL since all default columns
    // are nullable in our schema.
    if (queryText.toUpperCase().includes('DEFAULT')) {
      queryText = queryText.replace(/\bdefault\b/gi, 'NULL');
    }

    try {
      return await this.executeQuery(queryText, queryParams);
    } catch (error) {
      throw this.adaptError(error as Error);
    }
  }

  // 实现 postgres 的事务接口
  async begin<T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> {
    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    logger.info('DuckDB Transaction: BEGIN TRANSACTION');
    const connection = await this.instance.connect();
    let transactionActive = false;

    try {
      await connection.run('BEGIN TRANSACTION');
      transactionActive = true;
      logger.info('DuckDB Transaction: Transaction started');

      // 创建事务 SQL 对象，使用同一个连接
      const transactionSql: TransactionSql = {
        query: async (sql: string, ...params: unknown[]) => {
          const queryText = sql.toUpperCase().includes('DEFAULT')
            ? sql.replace(/\bdefault\b/gi, 'NULL')
            : sql;
          return await this.executeQuery(queryText, params, connection);
        },
        unsafe: (query: string, params?: unknown[]) => {
          const queryText = query.toUpperCase().includes('DEFAULT')
            ? query.replace(/\bdefault\b/gi, 'NULL')
            : query;
          const queryPromise = (async () => {
            return await this.executeQuery(queryText, params ?? [], connection);
          })();
          return this.extendQueryPromise(queryPromise, query, params ?? []);
        },
      };

      const result = await callback(transactionSql);
      await connection.run('COMMIT');
      logger.info('DuckDB Transaction: COMMIT');
      transactionActive = false;
      return result;
    } catch (error) {
      logger.error({ err: error }, 'Transaction error');
      if (transactionActive) {
        try {
          await connection.run('ROLLBACK');
          logger.info('DuckDB Transaction: ROLLBACK');
        } catch (rollbackError) {
          logger.warn({ err: rollbackError }, 'Failed to rollback transaction');
        }
      }
      throw this.adaptError(error as Error);
    } finally {
      connection.disconnectSync();
    }
  }

  // 执行 SQL 语句
  private async exec(sql: string): Promise<void> {
    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    try {
      const connection = await this.instance.connect();
      await connection.run(sql);
      connection.disconnectSync();
    } catch (error) {
      throw this.adaptError(error as Error);
    }
  }

  // 错误适配 - 将 DuckDB 错误转换为 PostgreSQL 兼容格式
  private adaptError(error: Error): Error & { code?: string } {
    const code = this.mapErrorCode(error.message);
    const adaptedError = new Error(`[${code}] ${error.message}`) as Error & {
      code?: string;
      cause?: unknown;
    };
    adaptedError.cause = error;
    adaptedError.code = code;
    return adaptedError;
  }

  private mapErrorCode(message: string): string {
    // 将 DuckDB 错误映射到 PostgreSQL 错误代码
    if (message.includes('unique constraint')) return '23505';
    if (message.includes('not null constraint')) return '23502';
    if (message.includes('foreign key constraint')) return '23503';
    return '42000'; // 默认语法错误
  }

  // 结果适配 - 将 DuckDB 结果转换为 PostgreSQL 兼容格式
  private adaptResult(result: Record<string, unknown>[]): Record<string, unknown>[] {
    return result.map((row: Record<string, unknown>) => {
      const adaptedRow: Record<string, unknown> = { ...row };
      for (const [key, value] of Object.entries(adaptedRow)) {
        if (typeof value === 'bigint') {
          adaptedRow[key] = value.toString();
        } else if (value && typeof value === 'object') {
          // Handle DuckDB HUGEINT (128-bit integer) returned by count(*)
          // HUGEINT is represented as { high: number, low: bigint } or similar
          const obj = value as Record<string, unknown>;
          if ('high' in obj && 'low' in obj) {
            // Convert HUGEINT to number (safe for counts up to 2^53 - 1)
            const low = typeof obj.low === 'bigint' ? obj.low : BigInt(obj.low as number);
            const high = typeof obj.high === 'number' ? BigInt(obj.high) : (obj.high as bigint);
            adaptedRow[key] = Number((high << 64n) + low);
          } else if (value.constructor.name === 'DuckDBTimestampValue') {
            const tsValue = value as { micros?: number };
            adaptedRow[key] = new Date(Number(tsValue.micros) / 1000);
          }
        }
      }
      return adaptedRow;
    });
  }

  // 初始化数据库
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.isFullInitializing) {
      while (this.isFullInitializing) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return;
    }

    this.isFullInitializing = true;
    try {
      await this.connect();
      this.isInitialized = true;
      this.startPeriodicCheckpoint();
    } catch (error) {
      this.isInitialized = false;
      throw error;
    } finally {
      this.isFullInitializing = false;
    }
  }

  // 实现 postgres 的连接管理
  async end(): Promise<void> {
    this.stopPeriodicCheckpoint();
    if (this.instance) {
      try {
        const conn = await this.instance.connect();
        await conn.run('CHECKPOINT');
        conn.disconnectSync();
      } catch (error) {
        logger.warn({ err: error }, 'Final checkpoint failed');
      }
      this.instance.closeSync();
      this.instance = null;
    }
  }

  private startPeriodicCheckpoint(): void {
    if (this.checkpointTimer) return;
    this.checkpointTimer = setInterval(() => {
      this.checkpointWal().catch(err => logger.warn({ err }, 'Periodic checkpoint failed'));
    }, DuckDBPostgresAdapter.CHECKPOINT_INTERVAL_MS);
    // Allow the process to exit even if this timer is still running
    if (this.checkpointTimer.unref) {
      this.checkpointTimer.unref();
    }
  }

  private stopPeriodicCheckpoint(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
  }

  // 实现 postgres 的监听器接口（可选）
  on(_event: string, _callback: (...args: unknown[]) => void): void {
    // DuckDB 不支持 LISTEN/NOTIFY，这里可以是空实现
  }

  off(_event: string, _callback?: (...args: unknown[]) => void): void {
    // 空实现
  }

  // 扩展查询 Promise 以兼容 postgres-js 接口
  extendQueryPromise(
    queryPromise: Promise<Record<string, unknown>[]>,
    query: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> & PostgresQueryExtensions {
    const extended = queryPromise as Promise<Record<string, unknown>[]> & PostgresQueryExtensions;
    extended.values = async () => (await queryPromise).map(row => Object.values(row));
    extended.raw = () => queryPromise;
    extended.execute = () => queryPromise;
    extended.cursor = () => ({ next: () => Promise.resolve({ done: true }) });
    extended.stream = () => queryPromise;
    extended.forEach = (callback: (row: Record<string, unknown>) => void) =>
      queryPromise.then(rows => rows.forEach(callback));
    extended.state = { status: 'ready' };
    extended.statement = { query, params };
    extended.signature = query;
    extended.cancel = () => {};
    extended.cancelled = false;
    extended.executed = false;
    extended.active = true;
    return extended;
  }
}

type TransactionSql = {
  query: (sql: string, ...params: unknown[]) => Promise<Record<string, unknown>[]>;
  unsafe: (
    query: string,
    params?: unknown[],
  ) => Promise<Record<string, unknown>[]> & PostgresQueryExtensions;
};

type PostgresQueryExtensions = {
  values: () => Promise<unknown[][]>;
  raw: () => Promise<Record<string, unknown>[]>;
  execute: () => Promise<Record<string, unknown>[]>;
  cursor: () => { next: () => Promise<{ done: boolean }> };
  stream: () => Promise<Record<string, unknown>[]>;
  forEach: (callback: (row: Record<string, unknown>) => void) => Promise<void>;
  state: { status: string };
  statement: { query: string; params: unknown[] };
  signature: string;
  cancel: () => void;
  cancelled: boolean;
  executed: boolean;
  active: boolean;
};

// 创建适配器工厂函数，模拟 postgres 的使用方式
export function createDuckDBAdapter(connectionString: string) {
  const adapter = new DuckDBPostgresAdapter(connectionString);

  type SqlFunction = (
    query: string | TemplateStringsArray,
    ...params: unknown[]
  ) => Promise<Record<string, unknown>[]>;

  const sql = (async (query: string | TemplateStringsArray, ...params: unknown[]) =>
    adapter.query(query, ...params)) as SqlFunction & {
    begin: typeof adapter.begin;
    transaction: typeof adapter.begin;
    end: typeof adapter.end;
    on: typeof adapter.on;
    off: typeof adapter.off;
    migrate: typeof adapter.migrate;
    unsafe: (
      query: string,
      params?: unknown[],
    ) => Promise<Record<string, unknown>[]> & PostgresQueryExtensions;
    options: {
      parsers: Record<string, unknown>;
      serializers: Record<string, unknown>;
      transform: Record<string, unknown>;
    };
    parameters: Record<string, unknown>;
    types: Record<string, unknown>;
    getDuckDB: typeof adapter.getDuckDB;
  };

  sql.begin = adapter.begin.bind(adapter);
  sql.transaction = adapter.begin.bind(adapter);
  sql.end = adapter.end.bind(adapter);
  sql.on = adapter.on.bind(adapter);
  sql.off = adapter.off.bind(adapter);
  sql.migrate = adapter.migrate.bind(adapter);

  sql.unsafe = (query: string, params?: unknown[]) => {
    const queryPromise = adapter.query(query, ...(params ?? []));
    return adapter.extendQueryPromise(queryPromise, query, params ?? []);
  };

  sql.options = {
    parsers: {},
    serializers: {},
    transform: {
      undefined: null,
    },
  };

  sql.parameters = {};
  sql.types = {};

  sql.getDuckDB = adapter.getDuckDB.bind(adapter);

  return sql as unknown as Sql & Pick<DuckDBPostgresAdapter, 'getDuckDB' | 'migrate'>;
}
