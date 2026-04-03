/**
 * 链特定表结构管理器
 * 仅保留动态事件表相关的 schema 生成方法
 */

import { AbiEvent, AbiParameter } from 'viem';

/**
 * 动态事件表 schema 管理器
 */
export class ChainSchemaManager {
  constructor(_chainId?: number) {
    // Kept for backward compatibility but no longer used internally
  }

  /**
   * 创建动态事件表的SQL
   */
  getCreateEventTableSQL(tableName: string, eventAbi: AbiEvent): string {
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

  private mapAbiTypeToDb(abiType: string): string {
    const typeMapping: Record<string, string> = {
      uint: 'TEXT',
      int: 'TEXT',
      address: 'VARCHAR(42)',
      bool: 'BOOLEAN',
      bytes: 'TEXT',
      string: 'TEXT',
      uint256: 'TEXT',
      int256: 'TEXT',
      'address[]': 'TEXT',
      'uint256[]': 'TEXT',
      'int256[]': 'TEXT',
      'bool[]': 'TEXT',
      bytes32: 'VARCHAR(66)',
      tuple: 'TEXT',
      'tuple[]': 'TEXT',
    };

    if (abiType.endsWith('[]')) {
      return 'TEXT';
    }

    const uintMatch = abiType.match(/^uint(\d+)$/);
    if (uintMatch) {
      return 'TEXT';
    }

    const intMatch = abiType.match(/^int(\d+)$/);
    if (intMatch) {
      return 'TEXT';
    }

    const bytesMatch = abiType.match(/^bytes(\d+)$/);
    if (bytesMatch) {
      return `VARCHAR(${2 + parseInt(bytesMatch[1]) * 2})`;
    }

    return typeMapping[abiType] || 'TEXT';
  }
}
