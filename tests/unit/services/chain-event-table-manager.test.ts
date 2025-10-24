/**
 * Unit tests for ChainEventTableManager
 * Tests: T012 - ChainEventTableManager table creation and management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChainEventTableManager } from '../../../src/database/chain-event-table-manager';
import { ChainDatabaseManager } from '../../../src/database/chain-database-manager';
import { EventParameter } from '../../../src/types/events';

// Mock ChainDatabaseManager
vi.mock('../../../src/database/chain-database-manager');

describe('ChainEventTableManager', () => {
  let chainDbManager: ChainDatabaseManager;
  let eventTableManager: ChainEventTableManager;
  const mockChainId = 1;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock ChainDatabaseManager instance
    chainDbManager = {
      getChainId: vi.fn().mockReturnValue(mockChainId),
      exec: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
    } as any;

    eventTableManager = new ChainEventTableManager(chainDbManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createEventTable', () => {
    it('should create an event table with correct schema', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const eventParams: EventParameter[] = [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: false },
        { name: 'value', type: 'uint256', indexed: false },
      ];
      const eventSignature = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const eventName = 'Transfer';

      const result = await eventTableManager.createEventTable(
        contractAddress,
        eventParams,
        eventSignature,
        eventName
      );

      expect(result).toContain('events_');
      expect(chainDbManager.exec).toHaveBeenCalled();
    });

    it('should generate appropriate table names', async () => {
      const contractAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
      const eventSignature = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const eventParams: EventParameter[] = [];
      const eventName = 'TestEvent';

      const result = await eventTableManager.createEventTable(
        contractAddress,
        eventParams,
        eventSignature,
        eventName
      );

      // Table name should be in format: events_{address_prefix}_{signature_prefix}
      expect(result).toMatch(/^events_[a-f0-9]{8}_[a-f0-9]{8}$/);
    });

    it('should not create duplicate tables', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const eventSignature = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const eventParams: EventParameter[] = [];
      const eventName = 'TestEvent';

      // First call
      const result1 = await eventTableManager.createEventTable(
        contractAddress,
        eventParams,
        eventSignature,
        eventName
      );

      // Second call with same parameters
      const result2 = await eventTableManager.createEventTable(
        contractAddress,
        eventParams,
        eventSignature,
        eventName
      );

      expect(result1).toBe(result2);
      expect(chainDbManager.exec).toHaveBeenCalledTimes(1); // Should only call exec once
    });

    it('should create indexes for indexed parameters', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const eventParams: EventParameter[] = [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ];
      const eventSignature = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const eventName = 'Transfer';

      await eventTableManager.createEventTable(
        contractAddress,
        eventParams,
        eventSignature,
        eventName
      );

      // Should call exec for table creation and index creation
      expect(chainDbManager.exec).toHaveBeenCalled();
    });
  });

  describe('insertEventData', () => {
    it('should insert event data correctly', async () => {
      const tableName = 'events_test_table';
      const eventData = {
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        logIndex: 0,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        transactionIndex: 1,
        blockNumber: 12345n,
        blockTimestamp: new Date(),
        contractAddress: '0x1234567890123456789012345678901234567890',
        eventName: 'Transfer',
        eventSignature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        from: '0xabcdef1234567890abcdef1234567890abcdef12',
        to: '0x1234567890abcdef1234567890abcdef12345678',
        value: '1000000000000000000',
      };

      await eventTableManager.insertEventData(tableName, eventData);

      expect(chainDbManager.exec).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(Object.values(eventData))
      );
    });
  });

  describe('queryEvents', () => {
    it('should query events with basic filters', async () => {
      const tableName = 'events_test_table';
      const mockEvents = [
        {
          blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          logIndex: 0,
          eventName: 'Transfer',
          blockTimestamp: new Date(),
        },
      ];

      (chainDbManager.query as any).mockResolvedValue(mockEvents);

      const result = await eventTableManager.queryEvents(tableName, {
        eventName: 'Transfer',
      });

      expect(result.events).toEqual(mockEvents);
      expect(result.hasMore).toBe(false);
      expect(chainDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM'),
        expect.arrayContaining(['Transfer'])
      );
    });

    it('should apply block range filters', async () => {
      const tableName = 'events_test_table';
      (chainDbManager.query as any).mockResolvedValue([]);

      await eventTableManager.queryEvents(tableName, {
        fromBlock: '1000',
        toBlock: '2000',
      });

      expect(chainDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('block_number >= ?'),
        expect.arrayContaining(['1000', '2000'])
      );
    });

    it('should support pagination', async () => {
      const tableName = 'events_test_table';
      const mockEvents = Array.from({ length: 50 }, (_, i) => ({
        blockHash: `0x${i.toString(16).padStart(64, '0')}`,
        logIndex: i,
        eventName: 'Transfer',
      }));

      (chainDbManager.query as any).mockResolvedValue(mockEvents);

      const result = await eventTableManager.queryEvents(tableName, {}, {
        limit: 20,
      });

      expect(result.events.length).toBe(20);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });
  });

  describe('tableExists', () => {
    it('should check if table exists', async () => {
      const tableName = 'events_test_table';

      (chainDbManager.query as any).mockResolvedValue([{ name: tableName }]);

      const exists = await eventTableManager.tableExists(tableName);

      expect(exists).toBe(true);
      expect(chainDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT name FROM sqlite_master'),
        [tableName]
      );
    });

    it('should return false when table does not exist', async () => {
      const tableName = 'events_nonexistent_table';

      (chainDbManager.query as any).mockResolvedValue([]);

      const exists = await eventTableManager.tableExists(tableName);

      expect(exists).toBe(false);
    });
  });

  describe('getContractEventTables', () => {
    it('should get all event tables for a contract', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const mockTables = [
        { table_name: 'events_12345678_abcd1234' },
        { table_name: 'events_12345678_efgh5678' },
      ];

      (chainDbManager.query as any).mockResolvedValue(mockTables);

      const result = await eventTableManager.getContractEventTables(contractAddress);

      expect(result).toEqual(['events_12345678_abcd1234', 'events_12345678_efgh5678']);
      expect(chainDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT table_name FROM event_table_registry'),
        [contractAddress]
      );
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const eventParams: EventParameter[] = [];
      const eventSignature = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const eventName = 'TestEvent';

      const dbError = new Error('Database connection failed');
      (chainDbManager.exec as any).mockRejectedValue(dbError);

      await expect(
        eventTableManager.createEventTable(contractAddress, eventParams, eventSignature, eventName)
      ).rejects.toThrow('Database connection failed');
    });
  });
});