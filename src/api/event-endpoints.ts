/**
 * 事件相关API端点
 * 提供RESTful接口用于事件查询和管理
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eventIndexingService } from '../services/EventIndexingService';
import { eventQueryService } from '../services/EventQueryService';
import { dynamicTableManager } from '../services/DynamicTableManager';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import { isChainSupported, getChainName } from '../config/chains';
import { safeJsonResponse } from '../utils/serialization';

/**
 * 创建事件相关路由
 */
export function createEventRoutes(): Hono {
  const app = new Hono();

  // GET /api/chains/:chainId/contracts/:address/events/indexing-status
  // 获取事件索引状态
  app.get('/chains/:chainId/contracts/:address/events/indexing-status', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      const status = await eventIndexingService.getIndexingStatus(chainId, address);

      if (!status) {
        return c.json({
          error: 'Event indexing not found',
          message: 'This contract has not been initialized for event indexing',
        }, 404);
      }

      c.header('X-Data-Source', 'indexing-service');
      c.header('X-Chain-Name', getChainName(chainId));

      const responseData = safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        status,
        timestamp: new Date().toISOString(),
      });

      return c.json(responseData);
    }
    catch (error) {
      console.error('Event indexing status API error:', error);
      return c.json({ error: 'Failed to get indexing status' }, 500);
    }
  });

  // POST /api/chains/:chainId/contracts/:address/events/initialize
  // 初始化合约事件索引
  app.post('/chains/:chainId/contracts/:address/events/initialize', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    if (!isChainSupported(chainId)) {
      return c.json({ error: 'Unsupported chain' }, 400);
    }

    try {
      const body = await c.req.json();
      const { abi } = body;

      if (!abi || !Array.isArray(abi)) {
        return c.json({
          error: 'Invalid ABI',
          message: 'ABI must be provided as an array',
        }, 400);
      }

      await eventIndexingService.initializeContractIndexing(chainId, address, abi);

      c.header('X-Chain-Name', getChainName(chainId));

      return c.json({
        success: true,
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        eventsCount: abi.filter(item => item.type === 'event').length,
        message: 'Event indexing initialized successfully',
        timestamp: new Date().toISOString(),
      });
    }
    catch (error) {
      console.error('Event initialization API error:', error);
      return c.json({
        error: 'Failed to initialize event indexing',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // POST /api/chains/:chainId/contracts/:address/events/index-historical
  // 开始历史事件索引
  app.post('/chains/:chainId/contracts/:address/events/index-historical', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      const body = await c.req.json();
      const { fromBlock, toBlock, batchSize = 1000 } = body;

      // 验证区块范围
      const startBlock = fromBlock ? BigInt(fromBlock) : 0n;
      const endBlock = toBlock ? BigInt(toBlock) : undefined;

      // 启动异步索引（在实际生产环境中应该使用消息队列）
      eventIndexingService.indexHistoricalEvents(
        chainId,
        address,
        startBlock,
        endBlock,
        (progress) => {
          console.log(`Indexing progress: ${progress.processedEvents} events, current block: ${progress.currentBlock}`);
        },
      ).catch((error) => {
        console.error('Historical indexing failed:', error);
      });

      c.header('X-Chain-Name', getChainName(chainId));

      return c.json({
        success: true,
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        fromBlock: startBlock.toString(),
        toBlock: endBlock?.toString(),
        batchSize,
        message: 'Historical event indexing started',
        timestamp: new Date().toISOString(),
      });
    }
    catch (error) {
      console.error('Historical indexing API error:', error);
      return c.json({
        error: 'Failed to start historical indexing',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // POST /api/chains/:chainId/contracts/:address/events/start-realtime
  // 开始实时事件监听
  app.post('/chains/:chainId/contracts/:address/events/start-realtime', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      await eventIndexingService.startRealtimeIndexing(chainId, address);

      c.header('X-Chain-Name', getChainName(chainId));

      return c.json({
        success: true,
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        message: 'Realtime event indexing started',
        timestamp: new Date().toISOString(),
      });
    }
    catch (error) {
      console.error('Start realtime indexing API error:', error);
      return c.json({
        error: 'Failed to start realtime indexing',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // POST /api/chains/:chainId/contracts/:address/events/stop-realtime
  // 停止实时事件监听
  app.post('/chains/:chainId/contracts/:address/events/stop-realtime', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      await eventIndexingService.stopRealtimeIndexing(chainId, address);

      c.header('X-Chain-Name', getChainName(chainId));

      return c.json({
        success: true,
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        message: 'Realtime event indexing stopped',
        timestamp: new Date().toISOString(),
      });
    }
    catch (error) {
      console.error('Stop realtime indexing API error:', error);
      return c.json({
        error: 'Failed to stop realtime indexing',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // GET /api/chains/:chainId/contracts/:address/events
  // 查询事件
  app.get('/chains/:chainId/contracts/:address/events', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      const query = c.req.query();
      const {
        eventName,
        fromBlock,
        toBlock,
        fromTimestamp,
        toTimestamp,
        limit = '100',
        offset = '0',
        cursor,
        ...filters
      } = query;

      if (!eventName) {
        return c.json({
          error: 'Missing event name',
          message: 'eventName parameter is required',
        }, 400);
      }

      const pagination = {
        limit: parseInt(limit),
        offset: parseInt(offset),
        cursor,
      };

      const eventFilters = {
        contractAddress: address,
        fromBlock: fromBlock ? BigInt(fromBlock) : undefined,
        toBlock: toBlock ? BigInt(toBlock) : undefined,
        fromTimestamp: fromTimestamp ? parseInt(fromTimestamp) : undefined,
        toTimestamp: toTimestamp ? parseInt(toTimestamp) : undefined,
        ...filters,
      };

      const result = await eventIndexingService.queryEvents(
        chainId,
        address,
        eventName,
        eventFilters,
        pagination,
      );

      c.header('X-Data-Source', 'event-index');
      c.header('X-Chain-Name', getChainName(chainId));
      c.header('X-Total-Count', result.total.toString());

      const responseData = safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        eventName,
        events: result.data,
        pagination: {
          limit: pagination.limit,
          offset: pagination.offset,
          total: result.total,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
        filters: eventFilters,
        timestamp: new Date().toISOString(),
      });

      return c.json(responseData);
    }
    catch (error) {
      console.error('Event query API error:', error);
      return c.json({
        error: 'Failed to query events',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // GET /api/chains/:chainId/contracts/:address/events/statistics
  // 获取事件统计信息
  app.get('/chains/:chainId/contracts/:address/events/statistics', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      const { eventName, fromBlock, toBlock } = c.req.query();

      if (!eventName) {
        return c.json({
          error: 'Missing event name',
          message: 'eventName parameter is required',
        }, 400);
      }

      const filters: any = {
        contractAddress: address,
      };

      if (fromBlock) filters.fromBlock = BigInt(fromBlock);
      if (toBlock) filters.toBlock = BigInt(toBlock);

      const statistics = await eventIndexingService.getEventStatistics(
        chainId,
        address,
        eventName,
      );

      c.header('X-Data-Source', 'event-index');
      c.header('X-Chain-Name', getChainName(chainId));

      const responseData = safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        eventName,
        statistics,
        filters,
        timestamp: new Date().toISOString(),
      });

      return c.json(responseData);
    }
    catch (error) {
      console.error('Event statistics API error:', error);
      return c.json({
        error: 'Failed to get event statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // GET /api/chains/:chainId/contracts/:address/events/chart
  // 获取事件图表数据
  app.get('/chains/:chainId/contracts/:address/events/chart', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      const {
        eventName,
        interval = 'day',
        fromBlock,
        toBlock,
        fromTimestamp,
        toTimestamp,
      } = c.req.query();

      if (!eventName) {
        return c.json({
          error: 'Missing event name',
          message: 'eventName parameter is required',
        }, 400);
      }

      const filters: any = {
        contractAddress: address,
      };

      if (fromBlock) filters.fromBlock = BigInt(fromBlock);
      if (toBlock) filters.toBlock = BigInt(toBlock);
      if (fromTimestamp) filters.fromTimestamp = parseInt(fromTimestamp);
      if (toTimestamp) filters.toTimestamp = parseInt(toTimestamp);

      const tableName = `${chainId}_${address.slice(2, 10)}_${eventName}`;
      const chartData = await eventQueryService.getEventHistoryChartData(
        tableName,
        filters,
        interval as 'hour' | 'day' | 'week',
      );

      c.header('X-Data-Source', 'event-index');
      c.header('X-Chain-Name', getChainName(chainId));

      const responseData = safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        eventName,
        interval,
        chartData,
        filters,
        timestamp: new Date().toISOString(),
      });

      return c.json(responseData);
    }
    catch (error) {
      console.error('Event chart API error:', error);
      return c.json({
        error: 'Failed to get event chart data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // GET /api/chains/:chainId/contracts/:address/events/search
  // 搜索事件
  app.get('/chains/:chainId/contracts/:address/events/search', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      const query = c.req.query();
      const {
        q: searchTerm,
        fromBlock,
        toBlock,
        limit = '50',
        offset = '0',
      } = query;

      if (!searchTerm) {
        return c.json({
          error: 'Missing search term',
          message: 'q parameter is required',
        }, 400);
      }

      const filters: any = {
        contractAddress: address,
      };

      if (fromBlock) filters.fromBlock = BigInt(fromBlock);
      if (toBlock) filters.toBlock = BigInt(toBlock);

      const pagination = {
        limit: parseInt(limit),
        offset: parseInt(offset),
      };

      const result = await eventQueryService.searchEvents(
        searchTerm,
        filters,
        pagination,
      );

      c.header('X-Data-Source', 'event-search');
      c.header('X-Chain-Name', getChainName(chainId));
      c.header('X-Total-Count', result.total.toString());

      const responseData = safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        searchTerm,
        events: result.data,
        pagination: {
          limit: pagination.limit,
          offset: pagination.offset,
          total: result.total,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
        filters,
        timestamp: new Date().toISOString(),
      });

      return c.json(responseData);
    }
    catch (error) {
      console.error('Event search API error:', error);
      return c.json({
        error: 'Failed to search events',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // GET /api/chains/:chainId/events/types
  // 获取链上所有事件类型
  app.get('/chains/:chainId/events/types', async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));

    try {
      const { contractAddress } = c.req.query();

      const eventTypes = await eventQueryService.getEventTypes(
        contractAddress,
        chainId,
      );

      c.header('X-Data-Source', 'event-index');
      c.header('X-Chain-Name', getChainName(chainId));

      const responseData = safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress,
        eventTypes,
        count: eventTypes.length,
        timestamp: new Date().toISOString(),
      });

      return c.json(responseData);
    }
    catch (error) {
      console.error('Event types API error:', error);
      return c.json({
        error: 'Failed to get event types',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  // POST /api/events/batch-process
  // 批量处理事件
  app.post('/events/batch-process', async (c) => {
    try {
      const body = await c.req.json();
      const { chainId, logs, options = {} } = body;

      if (!chainId || !Array.isArray(logs)) {
        return c.json({
          error: 'Invalid request',
          message: 'chainId and logs array are required',
        }, 400);
      }

      const processedEvents = await eventIndexingService.processEventBatch(
        logs,
        chainId,
        options.processor,
      );

      c.header('X-Chain-Name', getChainName(chainId));
      c.header('X-Processed-Count', processedEvents.length.toString());

      const responseData = safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        processedCount: processedEvents.length,
        events: processedEvents,
        timestamp: new Date().toISOString(),
      });

      return c.json(responseData);
    }
    catch (error) {
      console.error('Batch process API error:', error);
      return c.json({
        error: 'Failed to process events batch',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  return app;
}
