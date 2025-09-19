# 测试文档

## 概述

本项目使用 Vitest 作为测试框架，包含单元测试和集成测试。

## 测试结构

```
src/tests/
├── unit/           # 单元测试
│   ├── database.test.ts      # 内存数据库测试
│   ├── cache.test.ts         # 缓存系统测试
│   ├── errorHandler.test.ts  # 错误处理测试
│   └── chains.test.ts        # 链配置测试
├── integration/    # 集成测试
│   ├── rpc.test.ts          # RPC集成测试
│   ├── services.test.ts     # 服务层集成测试
│   └── api.test.ts          # API集成测试
└── README.md       # 本文档
```

## 测试命令

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 运行集成测试
npm run test:integration

# 监视模式运行测试
npm run test:watch

# 生成测试覆盖率报告
npm run test:coverage

# 启动测试UI界面
npm run test:ui
```

## 单元测试

### 内存数据库测试 (`database.test.ts`)

测试内存数据库的核心功能：
- ✅ 基本功能：表初始化、SELECT查询
- ✅ 数据操作：INSERT、SELECT、INSERT OR REPLACE、WHERE条件、ORDER BY排序、LIMIT分页
- ✅ 事务支持：事务操作
- ✅ 错误处理：无效SQL、不存在的表

### 缓存系统测试 (`cache.test.ts`)

测试LRU缓存的功能：
- ✅ 基本缓存操作：设置、获取、删除、清空
- ✅ TTL过期机制
- ✅ LRU淘汰机制
- ✅ getOrSet方法
- ✅ 缓存清理和统计

### 错误处理测试 (`errorHandler.test.ts`)

测试错误处理和重试机制：
- ✅ withRetry函数：成功返回、失败重试、最大重试次数、重试条件
- ✅ 错误类型：RpcError、DatabaseError、ValidationError
- ✅ 错误识别：可重试错误识别
- ✅ 错误标准化：normalizeError函数
- ✅ 重试包装器：createRetryableRpcCall、createRetryableDbCall

### 链配置测试 (`chains.test.ts`)

测试区块链配置功能：
- ✅ 基本配置：支持的链列表、热门链列表
- ✅ 链信息获取：getChainInfo、getChainName、getChainSymbol
- ✅ 链支持检查：isChainSupported、getSupportedChainIds
- ✅ 热门链识别：isPopularChain
- ✅ 链类型识别：getChainType（主网/测试网）
- ✅ 链排序和搜索：getSortedChains、searchChains

## 集成测试

### RPC集成测试 (`rpc.test.ts`)

测试与真实区块链网络的RPC交互：
- 基本RPC功能：客户端创建、区块高度获取、区块信息查询
- 地址相关查询：余额查询、交易数量查询、合约代码查询
- RPC管理器功能：链名称获取、连接测试
- 客户端缓存：客户端复用
- 错误处理：不支持的链ID、网络错误

**注意**: 这些测试需要网络连接，可能会比较慢。

### 服务层集成测试 (`services.test.ts`)

测试各个服务层的集成：
- BlockService：最新区块、区块查询、区块列表、统计
- AddressService：地址信息、余额查询、合约检查、交易历史
- TransactionService：最新交易、统计、交易查询
- SearchService：区块搜索、地址搜索、交易搜索、搜索历史
- 服务间协作：数据索引、地址索引更新
- 缓存功能：缓存命中测试

**注意**: 这些测试需要网络连接和较长的超时时间。

### API集成测试 (`api.test.ts`)

测试HTTP API端点：
- 健康检查：`GET /api/health`
- 搜索API：`GET /api/chains/:chainId/search`
- 区块API：`GET /api/chains/:chainId/blocks/*`
- 地址API：`GET /api/chains/:chainId/addresses/*`
- 统计API：`GET /api/stats/overview`
- 错误处理：404、400错误
- CORS和安全头

**注意**: 由于BigInt序列化问题，某些API测试可能会跳过。

## 测试配置

测试配置位于 `vitest.config.ts`：

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    testTimeout: 30000, // 30秒超时
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/**/*.d.ts']
    }
  }
});
```

## 测试最佳实践

1. **单元测试**：测试单个函数或类的功能，不依赖外部服务
2. **集成测试**：测试多个组件的协作，可能需要网络连接
3. **Mock使用**：在单元测试中使用mock避免外部依赖
4. **超时设置**：为需要网络请求的测试设置合适的超时时间
5. **清理工作**：在测试后清理数据库和缓存状态
6. **错误测试**：测试错误情况和边界条件

## 持续集成

测试可以在CI/CD管道中运行：

```bash
# 在CI中运行测试（跳过需要网络的集成测试）
npm run test:unit

# 在有网络的环境中运行完整测试
npm test
```

## 故障排除

### 常见问题

1. **网络超时**：集成测试可能因为网络问题失败，可以增加超时时间或跳过
2. **BigInt序列化**：API测试中的BigInt序列化问题已通过序列化工具解决
3. **数据库锁定**：并发测试可能导致数据库锁定，已通过重试机制解决

### 调试技巧

1. 使用 `npm run test:ui` 启动可视化测试界面
2. 使用 `npm run test:watch` 在开发时持续运行测试
3. 查看测试覆盖率报告了解测试覆盖情况
4. 使用 `console.log` 在测试中输出调试信息

## 测试统计

- **单元测试**: 66个测试用例，覆盖核心功能模块
- **集成测试**: 涵盖RPC、服务层、API层的集成测试
- **测试覆盖率**: 通过 `npm run test:coverage` 查看详细覆盖率报告
- **执行时间**: 单元测试 ~2秒，集成测试 ~30秒（取决于网络）
