# 合约事件索引功能 - 快速开始指南

**创建日期**: 2025-10-15
**版本**: 1.0

## 功能概述

合约事件索引功能为区块链浏览器提供强大的事件搜索、过滤和分析能力。该功能支持：

- 🔍 **动态事件索引**: 根据合约ABI自动创建事件表结构
- ⚡ **高性能查询**: 1-9ms响应时间的缓存机制
- 🎯 **智能过滤**: 基于事件参数的高级过滤功能
- 📊 **实时统计**: 事件趋势分析和图表展示
- 🔄 **实时更新**: 新事件的实时索引和推送

## 快速部署

### 1. 环境要求

确保您的环境满足以下要求：

```bash
# Node.js版本
node --version  # >= 22.0.0

# 检查项目依赖
npm --version   # >= 9.0.0
```

### 2. 安装依赖

```bash
# 安装项目依赖
npm install

# 如果使用pnpm
pnpm install
```

### 3. 环境配置

复制环境配置文件：

```bash
cp .env.example .env.local
```

编辑配置文件，确保以下配置正确：

```env
# 数据库配置
DATABASE_URL="duckdb:data/blockchain.db"

# RPC配置 (可选，使用默认配置)
ETHEREUM_RPC_URL="https://mainnet.infura.io/v3/YOUR_KEY"
POLYGON_RPC_URL="https://polygon-rpc.com"

# 缓存配置
REDIS_URL="redis://localhost:6379"  # 可选，用于高级缓存
```

### 4. 数据库初始化

```bash
# 运行数据库迁移
npm run db:migrate

# 生成基础表结构
npm run db:push
```

### 5. 启动服务

```bash
# 启动开发环境 (前端+后端)
npm run dev

# 或分别启动
npm run dev:server  # 后端服务 (端口 8201)
npm run dev:client  # 前端服务 (端口 3000)
```

## 验证部署

### 1. 检查服务状态

访问以下URL确认服务正常运行：

- **后端API**: http://localhost:8201
- **前端界面**: http://localhost:3000
- **API文档**: http://localhost:8201/docs

### 2. 测试基础功能

```bash
# 测试API连接
curl http://localhost:8201/api/chains/1/blocks/latest

# 检查数据库状态
npm run db:studio
```

## 使用示例

### 1. 索引已知合约

以USDT合约为例，演示如何开始索引事件：

```typescript
// 1. 获取合约ABI
const abi = await fetchContractABI(
  1, // Ethereum mainnet
  '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDT合约地址
);

// 2. 初始化事件索引
const response = await fetch('/api/chains/1/contracts/0xdAC17F958D2ee523a2206206994597C13D831ec7/events/initialize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    abi: abi,
    fromBlock: 18500000,  // 可选：指定起始区块
    batchSize: 1000       // 可选：批处理大小
  })
});

const { indexingId, supportedEvents } = await response.json();
console.log(`开始索引事件: ${supportedEvents.join(', ')}`);
```

### 2. 查询索引进度

```typescript
// 检查索引状态
const statusResponse = await fetch(
  '/api/chains/1/contracts/0xdAC17F958D2ee523a2206206994597C13D831ec7/events/indexing-status'
);

const status = await statusResponse.json();
console.log(`索引进度: ${status.indexingProgress}%`);
console.log(`已索引事件: ${status.indexedEvents}/${status.totalEvents}`);
```

### 3. 查询事件数据

```typescript
// 基础事件查询
const eventsResponse = await fetch(
  '/api/chains/1/contracts/0xdAC17F958D2ee523a2206206994597C13D831ec7/events?eventName=Transfer&limit=10'
);

const { events, pagination } = await eventsResponse.json();
console.log(`找到 ${events.length} 个Transfer事件`);

// 高级搜索
const searchResponse = await fetch(
  '/api/chains/1/contracts/0xdAC17F958D2ee523a2206206994597C13D831ec7/events/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      eventName: 'Transfer',
      fromTimestamp: '2025-10-01T00:00:00Z',
      toTimestamp: '2025-10-15T23:59:59Z',
      customFilters: {
        'from': '0x742d35cc6464c73c8e0b5a2c3a4a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a'
      }
    },
    sort: [
      { field: 'blockTimestamp', direction: 'desc' }
    ],
    limit: 50
  })
});

const searchResults = await searchResponse.json();
```

### 4. 获取统计信息

```typescript
// 事件统计
const statsResponse = await fetch(
  '/api/chains/1/contracts/0xdAC17F958D2ee523a2206206994597C13D831ec7/events/statistics?timeRange=30d'
);

const stats = await statsResponse.json();
console.log(`30天内总计 ${stats.totalEvents} 个事件`);
console.log(`最活跃的事件类型: ${Object.entries(stats.eventCounts).sort((a, b) => b[1] - a[1])[0][0]}`);

// 图表数据
const chartResponse = await fetch(
  '/api/chains/1/contracts/0xdAC17F958D2ee523a2206206994597C13D831ec7/events/chart?interval=1d&timeRange=7d'
);

const chartData = await chartResponse.json();
console.log(`日均事件数: ${chartData.summary.averagePerInterval}`);
```

## 前端集成

### 1. React组件使用

```typescript
import { DynamicEventFilterForm, EventTable } from '@/components/events';

// 在合约页面中使用
const ContractEventsPage: React.FC = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  const contractAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
  const chainId = 1;

  const handleFilterSubmit = async (filters: EventFilters) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters })
        }
      );
      const data = await response.json();
      setEvents(data.events);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <DynamicEventFilterForm
        contractAddress={contractAddress}
        chainId={chainId}
        onSubmit={handleFilterSubmit}
        loading={loading}
      />

      <EventTable
        events={events}
        loading={loading}
      />
    </div>
  );
};
```

### 2. 自定义Hook

```typescript
// 使用事件查询Hook
import { useContractEvents } from '@/hooks/useContractEvents';

const MyComponent: React.FC = () => {
  const {
    events,
    loading,
    error,
    pagination,
    fetchNext,
    refetch
  } = useContractEvents({
    chainId: 1,
    contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    filters: { eventName: 'Transfer' },
    limit: 20
  });

  return (
    <div>
      {loading && <div>加载中...</div>}
      {error && <div>错误: {error.message}</div>}

      <EventList events={events} />

      {pagination.hasNext && (
        <button onClick={fetchNext}>
          加载更多
        </button>
      )}
    </div>
  );
};
```

## 配置选项

### 1. 索引配置

```typescript
// 在事件索引服务中配置
const indexingConfig = {
  // 批处理大小
  batchSize: 1000,

  // 并发处理数量
  concurrency: 5,

  // 重试配置
  retryAttempts: 3,
  retryDelay: 1000,

  // 缓存配置
  cacheEnabled: true,
  cacheTTL: 300000, // 5分钟

  // 数据保留策略
  retentionDays: 365,

  // 性能监控
  metricsEnabled: true
};
```

### 2. 查询配置

```typescript
// 查询服务配置
const queryConfig = {
  // 默认分页大小
  defaultLimit: 50,
  maxLimit: 1000,

  // 查询超时
  queryTimeout: 30000, // 30秒

  // 缓存配置
  resultCache: {
    enabled: true,
    ttl: 60000, // 1分钟
    maxSize: 1000
  },

  // 性能配置
  enableCompression: true,
  enableProfiling: false
};
```

## 监控和调试

### 1. 性能监控

```bash
# 查看索引状态
curl http://localhost:8201/api/events/indexing/status

# 数据库性能分析
npm run db:analyze

# 应用性能指标
curl http://localhost:8201/api/metrics
```

### 2. 日志查看

```bash
# 查看应用日志
npm run logs

# 查看索引日志
tail -f logs/indexing.log

# 查看错误日志
tail -f logs/error.log
```

### 3. 调试工具

```typescript
// 启用调试模式
process.env.DEBUG = 'blockexplorer:*';

// 使用数据库工具
npm run db:studio

// API测试
npm run test:api
```

## 常见问题

### Q: 如何处理大型合约的索引？

**A**: 对于具有大量历史事件的合约：
1. 使用较小的批处理大小 (500-1000)
2. 分阶段进行历史索引
3. 考虑使用并行处理
4. 监控系统资源使用情况

### Q: 如何优化查询性能？

**A**: 查询性能优化建议：
1. 使用时间范围限制查询范围
2. 合理使用分页，避免大结果集
3. 利用缓存机制减少重复查询
4. 为常用查询字段创建索引

### Q: 如何处理EVM重组？

**A**: 系统自动处理重组：
1. 实时监控区块重组
2. 自动修正受影响的事件数据
3. 通知用户数据变更
4. 保持数据一致性

### Q: 如何扩展到新链？

**A**: 多链支持配置：
1. 在链配置中添加新链信息
2. 配置相应的RPC端点
3. 确保链ID的唯一性
4. 测试链特定的功能

## 支持和反馈

- **文档**: 查看完整API文档和开发指南
- **问题反馈**: 在GitHub Issues中报告问题
- **功能请求**: 提交新功能建议
- **社区讨论**: 加入开发者社区交流

---

**下一步**: 查看详细的[API文档](./contracts/openapi.yaml)和[开发指南](../README.md)