/**
 * ABI事件解码和动态存储使用示例
 * 演示如何使用事件索引服务
 */

import { eventIndexingService } from '../src/services/EventIndexingService';
import { eventQueryService } from '../src/services/EventQueryService';
import { EventParameter, EventFilters } from '../src/types/events';

// 示例ERC20 ABI（简化版）
const ERC20_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, internalType: 'address', name: 'from', type: 'address' },
      { indexed: true, internalType: 'address', name: 'to', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'value', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Approval',
    inputs: [
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: true, internalType: 'address', name: 'spender', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'value', type: 'uint256' },
    ],
  },
];

// 示例USDT合约地址（以太坊主网）
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const CHAIN_ID = 1; // 以太坊主网

/**
 * 示例1：初始化合约事件索引
 */
async function example1_initializeIndexing() {
  console.log('=== 示例1：初始化合约事件索引 ===');

  try {
    await eventIndexingService.initializeContractIndexing(
      CHAIN_ID,
      USDT_CONTRACT_ADDRESS,
      ERC20_ABI as any,
    );

    console.log('✅ 事件索引初始化成功');
    console.log(`📊 已创建 ${ERC20_ABI.length} 个事件表`);
  }
  catch (error) {
    console.error('❌ 初始化失败:', error);
  }
}

/**
 * 示例2：查询索引状态
 */
async function example2_checkIndexingStatus() {
  console.log('\n=== 示例2：查询索引状态 ===');

  try {
    const status = await eventIndexingService.getIndexingStatus(
      CHAIN_ID,
      USDT_CONTRACT_ADDRESS,
    );

    if (status) {
      console.log('📈 索引状态信息:');
      console.log(`  - 合约地址: ${status.contractAddress}`);
      console.log(`  - 链ID: ${status.chainId}`);
      console.log(`  - 事件类型: ${status.eventSignatures.length}`);
      console.log(`  - 最后索引区块: ${status.lastIndexedBlock}`);
      console.log(`  - 总索引事件数: ${status.totalEventsIndexed}`);
      console.log(`  - 索引状态: ${status.indexingActive ? '进行中' : '已完成'}`);
      console.log(`  - 最后更新时间: ${status.lastIndexedAt}`);
    }
    else {
      console.log('⚠️ 未找到索引状态，请先初始化');
    }
  }
  catch (error) {
    console.error('❌ 查询失败:', error);
  }
}

/**
 * 示例3：查询Transfer事件
 */
async function example3_queryTransferEvents() {
  console.log('\n=== 示例3：查询Transfer事件 ===');

  try {
    const filters: EventFilters = {
      fromBlock: 18500000n,
      toBlock: 18500100n,
    };

    const pagination = {
      limit: 10,
      offset: 0,
    };

    const result = await eventIndexingService.queryEvents(
      CHAIN_ID,
      USDT_CONTRACT_ADDRESS,
      'Transfer',
      filters,
      pagination,
    );

    console.log(`📋 找到 ${result.data.length} 个Transfer事件 (总数: ${result.total})`);

    result.data.forEach((event, index) => {
      console.log(`  事件 ${index + 1}:`);
      console.log(`    - 交易哈希: ${event.txHash}`);
      console.log(`    - 区块号: ${event.blockNumber}`);
      console.log(`    - 发送方: ${event.args.from}`);
      console.log(`    - 接收方: ${event.args.to}`);
      console.log(`    - 金额: ${event.args.value}`);
      console.log(`    - 时间: ${new Date(event.blockTimestamp * 1000).toLocaleString()}`);
    });
  }
  catch (error) {
    console.error('❌ 查询失败:', error);
  }
}

/**
 * 示例4：获取事件统计信息
 */
async function example4_getEventStatistics() {
  console.log('\n=== 示例4：获取事件统计信息 ===');

  try {
    const statistics = await eventIndexingService.getEventStatistics(
      CHAIN_ID,
      USDT_CONTRACT_ADDRESS,
      'Transfer',
    );

    console.log('📊 Transfer事件统计:');
    console.log(`  - 总事件数: ${statistics.totalEvents}`);
    console.log(`  - 事件类型分布:`, statistics.eventsByType);
    console.log(`  - 区块范围:`, statistics.eventsByBlockRange);
    console.log(`  - 平均每区块事件数: ${statistics.averageEventsPerBlock.toFixed(2)}`);
    console.log(`  - 涉及唯一地址数: ${statistics.uniqueAddresses}`);
    console.log(`  - 存储大小: ${(statistics.storageSize / 1024).toFixed(2)} KB`);
  }
  catch (error) {
    console.error('❌ 获取统计失败:', error);
  }
}

/**
 * 示例5：查询事件历史图表数据
 */
async function example5_getEventChartData() {
  console.log('\n=== 示例5：查询事件历史图表数据 ===');

  try {
    const tableName = `events_${CHAIN_ID}_${USDT_CONTRACT_ADDRESS.slice(2, 10)}_Transfer`;
    const filters: EventFilters = {
      fromTimestamp: Math.floor(Date.now() / 1000) - 86400, // 最近24小时
      toTimestamp: Math.floor(Date.now() / 1000),
    };

    const chartData = await eventQueryService.getEventHistoryChartData(
      tableName,
      filters,
      'hour',
    );

    console.log('📈 事件历史图表数据 (按小时):');
    chartData.forEach((data, index) => {
      console.log(`  ${index + 1}. 时间: ${new Date(data.timestamp).toLocaleString()}, 事件数: ${data.count}`);
    });
  }
  catch (error) {
    console.error('❌ 获取图表数据失败:', error);
  }
}

/**
 * 示例6：搜索事件
 */
async function example6_searchEvents() {
  console.log('\n=== 示例6：搜索事件 ===');

  try {
    const searchTerm = USDT_CONTRACT_ADDRESS.toLowerCase();
    const filters: EventFilters = {
      fromBlock: 18500000n,
      toBlock: 18500050n,
    };

    const pagination = {
      limit: 5,
      offset: 0,
    };

    const result = await eventQueryService.searchEvents(
      searchTerm,
      filters,
      pagination,
    );

    console.log(`🔍 搜索 "${searchTerm}" 找到 ${result.data.length} 个事件 (总数: ${result.total})`);

    result.data.forEach((event, index) => {
      console.log(`  搜索结果 ${index + 1}:`);
      console.log(`    - 事件名: ${event.eventName}`);
      console.log(`    - 交易哈希: ${event.txHash}`);
      console.log(`    - 合约地址: ${event.contractAddress}`);
      console.log(`    - 区块号: ${event.blockNumber}`);
    });
  }
  catch (error) {
    console.error('❌ 搜索失败:', error);
  }
}

/**
 * 示例7：批处理事件日志
 */
async function example7_batchProcessLogs() {
  console.log('\n=== 示例7：批处理事件日志 ===');

  try {
    // 模拟一些日志数据（实际使用中从区块链获取）
    const mockLogs = [
      {
        address: USDT_CONTRACT_ADDRESS as `0x${string}`,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer事件签名
          '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045', // from
          '0x00000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640', // to
        ],
        data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000', // 1000000000000000000 (1e18)
        blockNumber: 18500001n,
        blockHash: '0x...',
        transactionHash: '0x...',
        transactionIndex: 5,
        logIndex: 0,
      },
      // 可以添加更多模拟日志...
    ];

    const processedEvents = await eventIndexingService.processEventBatch(
      mockLogs,
      CHAIN_ID,
    );

    console.log(`📦 批处理完成，处理了 ${processedEvents.length} 个事件`);

    processedEvents.forEach((event, index) => {
      console.log(`  处理的事件 ${index + 1}:`);
      console.log(`    - 事件名: ${event.eventName}`);
      console.log(`    - 交易哈希: ${event.txHash}`);
      console.log(`    - 解码参数:`, event.args);
    });
  }
  catch (error) {
    console.error('❌ 批处理失败:', error);
  }
}

/**
 * 示例8：自定义事件解码器
 */
async function example8_customDecoder() {
  console.log('\n=== 示例8：自定义事件解码器 ===');

  try {
    // 这个示例展示了如何扩展事件解码服务
    const { EventDecodingService } = await import('../src/services/EventDecodingService');

    const customDecoder = new EventDecodingService();

    // 注册自定义转换器
    customDecoder.registerTransformer('uint256', {
      transform: (param, value) => {
        // 自定义大数字转换逻辑
        const num = BigInt(value);
        return {
          raw: num.toString(),
          formatted: (Number(num) / 1e18).toFixed(6), // 假设是18位小数的代币
          decimals: 18,
        };
      },
      reverseTransform: (param, value) => {
        // 反向转换逻辑
        if (typeof value === 'string') {
          return BigInt(value);
        }
        return BigInt(Math.floor(value * 1e18));
      },
    });

    // 注册自定义验证器
    customDecoder.registerValidator('address', {
      validate: (param, value) => {
        if (typeof value !== 'string') {
          return { valid: false, error: 'Address must be a string' };
        }

        if (!value.startsWith('0x') || value.length !== 42) {
          return { valid: false, error: 'Invalid address format' };
        }

        // 检查是否为合约地址（可以添加更多逻辑）
        const isContract = value !== '0x0000000000000000000000000000000000000000';

        return {
          valid: true,
          sanitizedValue: value.toLowerCase(),
          metadata: { isContract },
        };
      },
    });

    console.log('✅ 自定义解码器配置完成');
    console.log('📝 已注册自定义转换器和验证器');
  }
  catch (error) {
    console.error('❌ 自定义解码器配置失败:', error);
  }
}

/**
 * 主函数：运行所有示例
 */
async function runAllExamples() {
  console.log('🚀 开始运行ABI事件解码和动态存储示例\n');

  // 按顺序运行示例
  await example1_initializeIndexing();
  await example2_checkIndexingStatus();
  await example3_queryTransferEvents();
  await example4_getEventStatistics();
  await example5_getEventChartData();
  await example6_searchEvents();
  await example7_batchProcessLogs();
  await example8_customDecoder();

  console.log('\n✨ 所有示例运行完成！');
}

// 如果直接运行此文件，执行所有示例
if (require.main === module) {
  runAllExamples().catch((error) => {
    console.error('💥 运行示例时出错:', error);
    process.exit(1);
  });
}

/**
 * 导出示例函数供外部使用
 */
export {
  example1_initializeIndexing,
  example2_checkIndexingStatus,
  example3_queryTransferEvents,
  example4_getEventStatistics,
  example5_getEventChartData,
  example6_searchEvents,
  example7_batchProcessLogs,
  example8_customDecoder,
  runAllExamples,
};
