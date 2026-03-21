/**
 * 链特定表结构管理器
 * 移除chain_id字段，每个链独立管理自己的表结构
 */

import { getChainName, getChainType } from '../config/chains';
import { AbiEvent, AbiParameter } from 'viem';

/**
 * 链特定表结构定义
 * 注意：所有表都不再包含 chain_id 字段
 */
export class ChainSchemaManager {
  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  /**
   * 创建合约源码表
   */
  getCreateContractSourcesSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS contract_sources (
        address VARCHAR PRIMARY KEY,
        name VARCHAR,
        compiler_version VARCHAR,
        optimization_enabled BOOLEAN,
        optimization_runs INTEGER,
        source_code TEXT,
        abi TEXT,
        constructor_arguments TEXT,
        verification_status VARCHAR,
        verification_source VARCHAR,
        verified_at TIMESTAMP,
        last_checked TIMESTAMP,
        is_proxy BOOLEAN,
        proxy_type VARCHAR,
        implementation_address VARCHAR
      )
    `;
  }

  /**
   * 创建合约创建信息表
   */
  getCreateContractCreationInfoSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS contract_creation_info (
        contract_address VARCHAR PRIMARY KEY,
        creator_address VARCHAR,
        creation_tx_hash VARCHAR,
        creation_block_number BIGINT,
        creation_timestamp TIMESTAMP,
        gas_used BIGINT,
        gas_price BIGINT,
        search_status VARCHAR DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  /**
   * 创建区块表
   */
  getCreateBlocksSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS blocks (
        number BIGINT PRIMARY KEY,
        hash VARCHAR UNIQUE NOT NULL,
        parent_hash VARCHAR,
        timestamp TIMESTAMP,
        miner VARCHAR,
        gas_limit BIGINT,
        gas_used BIGINT,
        base_fee_per_gas BIGINT,
        transaction_count INTEGER,
        size_bytes BIGINT,
        difficulty VARCHAR,
        total_difficulty VARCHAR,
        extra_data TEXT,
        logs_bloom TEXT,
        state_root VARCHAR,
        transactions_root VARCHAR,
        receipts_root VARCHAR,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  /**
   * 创建交易表
   */
  getCreateTransactionsSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS transactions (
        hash VARCHAR PRIMARY KEY,
        block_number BIGINT,
        transaction_index INTEGER,
        from_address VARCHAR,
        to_address VARCHAR,
        value VARCHAR,
        gas_limit BIGINT,
        gas_price BIGINT,
        max_fee_per_gas BIGINT,
        max_priority_fee_per_gas BIGINT,
        gas_used BIGINT,
        effective_gas_price BIGINT,
        status INTEGER,
        type INTEGER DEFAULT 0,
        nonce BIGINT,
        input_data TEXT,
        logs_count INTEGER DEFAULT 0,
        contract_address VARCHAR,
        cumulative_gas_used BIGINT,
        timestamp TIMESTAMP,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (block_number) REFERENCES blocks(number)
      )
    `;
  }

  /**
   * 创建地址索引表
   */
  getCreateIndexedAddressesSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS indexed_addresses (
        address VARCHAR PRIMARY KEY,
        label VARCHAR,
        first_seen_block BIGINT,
        last_seen_block BIGINT,
        transaction_count INTEGER DEFAULT 0,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_queried TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  /**
   * 创建搜索历史表
   */
  getCreateSearchHistorySQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS search_history (
        id INTEGER PRIMARY KEY,
        chain_id INTEGER,
        query VARCHAR NOT NULL,
        search_type VARCHAR,
        result_count INTEGER DEFAULT 0,
        searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  /**
   * 创建用户偏好表
   */
  getCreateUserPreferencesSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS user_preferences (
        key VARCHAR PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  /**
   * 创建访问历史表
   */
  getCreateAccessHistorySQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS access_history (
        type VARCHAR NOT NULL,
        identifier VARCHAR NOT NULL,
        first_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 1,
        PRIMARY KEY (type, identifier)
      )
    `;
  }

  /**
   * 创建事件表注册表
   */
  getCreateEventTableRegistrySQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS event_table_registry (
        contract_address VARCHAR NOT NULL,
        event_signature VARCHAR NOT NULL,
        event_name VARCHAR NOT NULL,
        table_name VARCHAR NOT NULL,
        table_schema TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (contract_address, event_signature)
      )
    `;
  }

  /**
   * 获取所有表创建SQL
   */
  getAllTableCreationSQL(): string[] {
    return [
      this.getCreateContractSourcesSQL(),
      this.getCreateContractCreationInfoSQL(),
      this.getCreateBlocksSQL(),
      this.getCreateTransactionsSQL(),
      this.getCreateIndexedAddressesSQL(),
      this.getCreateSearchHistorySQL(),
      this.getCreateUserPreferencesSQL(),
      this.getCreateAccessHistorySQL(),
      this.getCreateEventTableRegistrySQL(),
    ];
  }

  /**
   * 获取索引创建SQL
   */
  getIndexCreationSQL(): string[] {
    return [
      // 合约源码索引
      'CREATE INDEX IF NOT EXISTS contract_sources_verification_idx ON contract_sources (verification_status)',
      'CREATE INDEX IF NOT EXISTS contract_sources_proxy_idx ON contract_sources (is_proxy)',
      'CREATE INDEX IF NOT EXISTS contract_sources_verified_at_idx ON contract_sources (verified_at)',

      // 合约创建信息索引
      'CREATE INDEX IF NOT EXISTS contract_creation_info_status_idx ON contract_creation_info (search_status)',
      'CREATE INDEX IF NOT EXISTS contract_creation_info_tx_idx ON contract_creation_info (creation_tx_hash)',
      'CREATE INDEX IF NOT EXISTS contract_creation_info_block_idx ON contract_creation_info (creation_block_number)',

      // 区块索引
      'CREATE INDEX IF NOT EXISTS blocks_timestamp_idx ON blocks (timestamp)',
      'CREATE INDEX IF NOT EXISTS blocks_miner_idx ON blocks (miner)',
      'CREATE INDEX IF NOT EXISTS blocks_parent_hash_idx ON blocks (parent_hash)',
      'CREATE INDEX IF NOT EXISTS blocks_indexed_at_idx ON blocks (indexed_at)',

      // 交易索引
      'CREATE INDEX IF NOT EXISTS transactions_block_idx ON transactions (block_number)',
      'CREATE INDEX IF NOT EXISTS transactions_from_idx ON transactions (from_address)',
      'CREATE INDEX IF NOT EXISTS transactions_to_idx ON transactions (to_address)',
      'CREATE INDEX IF NOT EXISTS transactions_timestamp_idx ON transactions (timestamp)',
      'CREATE INDEX IF NOT EXISTS transactions_contract_idx ON transactions (contract_address)',
      'CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status)',
      'CREATE INDEX IF NOT EXISTS transactions_nonce_idx ON transactions (nonce)',

      // 地址索引
      'CREATE INDEX IF NOT EXISTS indexed_addresses_queried_idx ON indexed_addresses (last_queried)',
      'CREATE INDEX IF NOT EXISTS indexed_addresses_tx_count_idx ON indexed_addresses (transaction_count)',
      'CREATE INDEX IF NOT EXISTS indexed_addresses_first_seen_idx ON indexed_addresses (first_seen_block)',
      'CREATE INDEX IF NOT EXISTS indexed_addresses_last_seen_idx ON indexed_addresses (last_seen_block)',

      // 搜索历史索引
      'CREATE INDEX IF NOT EXISTS search_history_searched_at_idx ON search_history (searched_at)',
      'CREATE INDEX IF NOT EXISTS search_history_search_type_idx ON search_history (search_type)',

      // 访问历史索引
      'CREATE INDEX IF NOT EXISTS access_history_type_idx ON access_history (type, last_accessed)',
      'CREATE INDEX IF NOT EXISTS access_history_identifier_idx ON access_history (identifier)',
      'CREATE INDEX IF NOT EXISTS access_history_access_count_idx ON access_history (access_count)',

      // 事件表注册索引
      'CREATE INDEX IF NOT EXISTS event_table_registry_event_name_idx ON event_table_registry (event_name)',
      'CREATE INDEX IF NOT EXISTS event_table_registry_table_name_idx ON event_table_registry (table_name)',
      'CREATE INDEX IF NOT EXISTS event_table_registry_active_idx ON event_table_registry (is_active)',
      'CREATE INDEX IF NOT EXISTS event_table_registry_updated_at_idx ON event_table_registry (updated_at)',
    ];
  }

  /**
   * 创建动态事件表的SQL
   */
  getCreateEventTableSQL(tableName: string, eventAbi: AbiEvent): string {
    // 从ABI生成列定义
    const columns = this.generateEventColumns(eventAbi);

    return `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        block_hash VARCHAR NOT NULL,
        log_index INTEGER NOT NULL,
        transaction_hash VARCHAR NOT NULL,
        transaction_index INTEGER,
        block_number BIGINT NOT NULL,
        block_timestamp TIMESTAMP NOT NULL,
        contract_address VARCHAR NOT NULL,
        event_name VARCHAR NOT NULL,
        event_signature VARCHAR NOT NULL,
        ${columns.join(',\n        ')}
        decoded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (block_hash, log_index),
        FOREIGN KEY (block_number) REFERENCES blocks(number),
        FOREIGN KEY (transaction_hash) REFERENCES transactions(hash)
      )
    `;
  }

  /**
   * 从ABI生成事件列定义
   */
  private generateEventColumns(eventAbi: AbiEvent): string[] {
    if (!eventAbi.inputs) {
      return [];
    }

    return eventAbi.inputs.map((input: AbiParameter & { indexed?: boolean }) => {
      const dbType = this.mapAbiTypeToDb(input.type);
      const nullable = !input.indexed;
      return `${input.name} ${dbType}${nullable ? '' : ' NOT NULL'}`;
    });
  }

  /**
   * ABI类型到数据库类型的映射
   */
  private mapAbiTypeToDb(abiType: string): string {
    const typeMapping: Record<string, string> = {
      'uint': 'TEXT',
      'int': 'TEXT',
      'address': 'VARCHAR(42)',
      'bool': 'BOOLEAN',
      'bytes': 'TEXT',
      'string': 'TEXT',
      'uint256': 'TEXT',
      'int256': 'TEXT',
      'address[]': 'TEXT',
      'uint256[]': 'TEXT',
      'int256[]': 'TEXT',
      'bool[]': 'TEXT',
      'bytes32': 'VARCHAR(66)',
      'tuple': 'TEXT',
      'tuple[]': 'TEXT',
    };

    // 处理数组类型
    if (abiType.endsWith('[]')) {
      return 'TEXT';
    }

    // 处理uint和int的位数
    const uintMatch = abiType.match(/^uint(\d+)$/);
    if (uintMatch) {
      return 'TEXT';
    }

    const intMatch = abiType.match(/^int(\d+)$/);
    if (intMatch) {
      return 'TEXT';
    }

    // 处理bytes
    const bytesMatch = abiType.match(/^bytes(\d+)$/);
    if (bytesMatch) {
      return `VARCHAR(${2 + parseInt(bytesMatch[1]) * 2})`;
    }

    // 返回匹配的类型或默认值
    return typeMapping[abiType] || 'TEXT';
  }

  /**
   * 生成事件表索引SQL
   */
  getEventTableIndexesSQL(tableName: string, eventAbi: AbiEvent): string[] {
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_block_timestamp ON ${tableName} (block_timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_contract_address ON ${tableName} (contract_address)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_transaction_hash ON ${tableName} (transaction_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_block_number ON ${tableName} (block_number)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_event_name ON ${tableName} (event_name)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_event_signature ON ${tableName} (event_signature)`,
    ];

    // 为indexed参数创建索引
    if (eventAbi.inputs) {
      eventAbi.inputs.forEach((input: AbiParameter & { indexed?: boolean }) => {
        if (input.indexed && input.name) {
          indexes.push(
            `CREATE INDEX IF NOT EXISTS idx_${tableName}_${input.name} ON ${tableName} (${input.name})`,
          );
        }
      });
    }

    return indexes;
  }

  /**
   * 获取链信息
   */
  getChainInfo(): { chainId: number; chainName: string; chainType: string } {
    return {
      chainId: this.chainId,
      chainName: getChainName(this.chainId),
      chainType: getChainType(this.chainId),
    };
  }
}
