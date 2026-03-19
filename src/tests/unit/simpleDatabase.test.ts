import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { simpleTestDb } from '../testDatabase.simple';

describe('Simple DuckDB Test', () => {
  beforeAll(async () => {
    await simpleTestDb.initialize();
  });

  afterAll(async () => {
    await simpleTestDb.close();
  });

  beforeEach(async () => {
    await simpleTestDb.clearAllData();
  });

  describe('基本功能', () => {
    it('应该支持基本的SELECT查询', async () => {
      const result = await simpleTestDb.query('SELECT 1 as test');
      expect(result).toEqual([{ test: 1 }]);
    });

    it('应该支持表查询', async () => {
      const result = await simpleTestDb.query('SELECT * FROM user_rpc_configs');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('CRUD操作', () => {
    it('应该支持INSERT操作', async () => {
      // 插入数据
      await simpleTestDb.exec(`
        INSERT INTO user_rpc_configs (chain_id, name, url, max_event_range)
        VALUES (999, 'Test RPC', 'https://test.rpc', 5000)
      `);

      // 查询数据
      const result = await simpleTestDb.query(
        'SELECT * FROM user_rpc_configs WHERE chain_id = ?',
        [999],
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        chain_id: 999,
        name: 'Test RPC',
        url: 'https://test.rpc',
        max_event_range: 5000,
      });
    });

    it('应该支持UPDATE操作', async () => {
      // 插入数据
      await simpleTestDb.exec(`
        INSERT INTO user_rpc_configs (chain_id, name, url, max_event_range)
        VALUES (999, 'Test RPC', 'https://test.rpc', 5000)
      `);

      // 更新数据
      await simpleTestDb.exec(`
        UPDATE user_rpc_configs 
        SET max_event_range = 10000 
        WHERE chain_id = 999
      `);

      // 验证更新
      const result = await simpleTestDb.query(
        'SELECT * FROM user_rpc_configs WHERE chain_id = ?',
        [999],
      );

      expect(result[0].max_event_range).toBe(10000);
    });

    it('应该支持DELETE操作', async () => {
      // 插入数据
      await simpleTestDb.exec(`
        INSERT INTO user_rpc_configs (chain_id, name, url, max_event_range)
        VALUES (999, 'Test RPC', 'https://test.rpc', 5000)
      `);

      // 删除数据
      await simpleTestDb.exec('DELETE FROM user_rpc_configs WHERE chain_id = 999');

      // 验证删除
      const result = await simpleTestDb.query(
        'SELECT * FROM user_rpc_configs WHERE chain_id = ?',
        [999],
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('区块数据测试', () => {
    it('应该支持区块数据操作', async () => {
      // 插入区块数据
      await simpleTestDb.exec(`
        INSERT INTO blocks (chain_id, number, hash, timestamp, gas_used, transaction_count)
        VALUES (1, 18500000, '0x1234...', '2023-10-15 10:30:00', 15000000, 150)
      `);

      // 查询区块
      const blocks = await simpleTestDb.query(
        'SELECT * FROM blocks WHERE chain_id = ? AND number = ?',
        [1, 18500000],
      );

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        chain_id: 1,
        number: 18500000n,
        hash: '0x1234...',
        gas_used: 15000000n,
        transaction_count: 150,
      });
    });

    it('应该支持交易数据操作', async () => {
      // 插入交易数据
      await simpleTestDb.exec(`
        INSERT INTO transactions (chain_id, hash, block_number, from_address, to_address, value, status)
        VALUES (1, '0xabcd...', 18500000, '0x1234...', '0x5678...', '1000000000000000000', 1)
      `);

      // 查询交易
      const transactions = await simpleTestDb.query(
        'SELECT * FROM transactions WHERE chain_id = ? AND hash = ?',
        [1, '0xabcd...'],
      );

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        chain_id: 1,
        hash: '0xabcd...',
        block_number: 18500000n,
        from_address: '0x1234...',
        to_address: '0x5678...',
        value: '1000000000000000000',
        status: 1,
      });
    });
  });

  describe('性能测试', () => {
    it('应该能够处理批量插入', async () => {
      const start = Date.now();

      // 批量插入区块数据
      for (let i = 0; i < 100; i++) {
        await simpleTestDb.exec(`
          INSERT INTO blocks (chain_id, number, hash, timestamp, gas_used, transaction_count)
          VALUES (1, ${18500000 + i}, '0x${i.toString(16).padStart(64, '0')}', '2023-10-15 10:30:00', ${15000000 + i * 1000}, ${150 + i})
        `);
      }

      const end = Date.now();
      const duration = end - start;

      console.log(`插入100个区块耗时: ${duration}ms`);

      // 验证插入结果
      const count = await simpleTestDb.query('SELECT COUNT(*) as count FROM blocks');
      expect(Number(count[0].count)).toBe(100);

      expect(duration).toBeLessThan(5000); // 应该在5秒内完成
    });

    it('应该能够快速查询数据', async () => {
      // 先插入一些数据
      for (let i = 0; i < 50; i++) {
        await simpleTestDb.exec(`
          INSERT INTO blocks (chain_id, number, hash, timestamp, gas_used, transaction_count)
          VALUES (1, ${18500000 + i}, '0x${i.toString(16).padStart(64, '0')}', '2023-10-15 10:30:00', ${15000000 + i * 1000}, ${150 + i})
        `);
      }

      const start = Date.now();

      // 查询最新的10个区块
      const recentBlocks = await simpleTestDb.query(`
        SELECT * FROM blocks 
        WHERE chain_id = 1 
        ORDER BY number DESC 
        LIMIT 10
      `);

      const end = Date.now();
      const duration = end - start;

      console.log(`查询最新10个区块耗时: ${duration}ms`);

      expect(recentBlocks).toHaveLength(10);
      expect(recentBlocks[0].number).toBe(18500049n); // 最新的区块
      expect(duration).toBeLessThan(100); // 应该很快
    });
  });

  describe('数据完整性', () => {
    it('应该正确处理时间戳', async () => {
      const now = new Date();

      await simpleTestDb.exec(`
        INSERT INTO user_rpc_configs (chain_id, name, url, max_event_range)
        VALUES (999, 'Test RPC', 'https://test.rpc', 5000)
      `);

      const result = await simpleTestDb.query(
        'SELECT * FROM user_rpc_configs WHERE chain_id = ?',
        [999],
      );

      expect(result[0].created_at).toBeDefined();
      expect(new Date(result[0].created_at)).toBeInstanceOf(Date);
    });

    it('应该正确处理大整数', async () => {
      const largeNumber = 18500000n;

      await simpleTestDb.exec(`
        INSERT INTO blocks (chain_id, number, hash, gas_used)
        VALUES (1, ${largeNumber}, '0x1234...', 15000000)
      `);

      const result = await simpleTestDb.query(
        'SELECT * FROM blocks WHERE chain_id = 1 AND number = ?',
        [largeNumber],
      );

      expect(result[0].number).toBe(largeNumber);
      expect(typeof result[0].number).toBe('bigint');
    });
  });
});
