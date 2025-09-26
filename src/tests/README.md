# 测试文档

本项目使用 Vitest 作为测试框架，DuckDB 内存模式作为测试数据库，提供完整的单元测试、集成测试和端到端测试覆盖。

## 测试架构

### 测试数据库
- 使用 DuckDB 内存模式 (`:memory:`) 进行测试
- 每个测试前自动清理数据
- 提供与生产环境相同的 SQL 兼容性
- 支持事务和并发测试

### 测试类型

#### 单元测试 (`src/tests/unit/`)
- 测试单个服务类和工具函数
- Mock 外部依赖（RPC 调用等）
- 快速执行，专注于业务逻辑

#### 集成测试 (`src/tests/integration/`)
- 测试 API 端点和服务层集成
- 使用真实的数据库连接
- 测试数据流和错误处理

#### 端到端测试 (`src/tests/e2e/`)
- 测试完整的用户工作流
- 启动真实的服务器实例
- 测试数据一致性和性能

#### 性能测试 (`src/tests/performance/`)
- 数据库操作性能测试
- 并发查询测试
- 内存使用监控

## 运行测试

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 运行集成测试
npm run test:integration

# 运行端到端测试
npm run test:e2e

# 运行性能测试
npm run test:performance

# 运行所有测试（除性能测试）
npm run test:all

# 监听模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 启动测试 UI
npm run test:ui
```

## 测试工具

### TestDatabaseManager
位于 `testDatabase.ts`，提供：
- 内存数据库实例管理
- 表结构初始化
- 数据清理功能
- 原始 SQL 查询支持

### Fixtures
位于 `fixtures.ts`，提供：
- 示例区块数据
- 示例交易数据
- 示例合约源码
- 数据生成工具函数

### 测试设置
位于 `setup.ts`，提供：
- 全局测试环境配置
- DOM API Mocks
- 数据库生命周期管理
- 控制台输出控制

## 最佳实践

### 测试数据管理
1. 使用 fixtures 中的示例数据
2. 每个测试使用独立的数据集
3. 避免测试间的数据依赖

### Mock 策略
1. Mock 外部 RPC 调用
2. Mock 网络请求
3. 保持数据库操作真实

### 性能考虑
1. 批量插入测试数据
2. 使用适当的索引
3. 监控内存使用

### 错误处理测试
1. 测试各种错误场景
2. 验证错误消息
3. 确保优雅降级

## 测试覆盖范围

### 服务层测试
- ✅ BlockService - 区块查询和缓存
- ✅ TransactionService - 交易查询和分析
- ✅ AddressService - 地址信息和活动
- ✅ SearchService - 搜索功能
- ✅ ContractService - 合约验证和交互

### API 测试
- ✅ 区块 API 端点
- ✅ 交易 API 端点
- ✅ 地址 API 端点
- ✅ 搜索 API 端点
- ✅ 统计 API 端点

### 数据库测试
- ✅ CRUD 操作
- ✅ 索引效果
- ✅ 查询性能
- ✅ 并发处理
- ✅ 事务支持

### 工作流测试
- ✅ 完整的区块索引流程
- ✅ 地址活动跟踪
- ✅ 合约交互分析
- ✅ 错误恢复机制

## 持续集成

测试配置支持 CI/CD 环境：
- 无需外部依赖
- 快速启动和清理
- 详细的错误报告
- 覆盖率统计

## 调试测试

### 使用测试 UI
```bash
npm run test:ui
```

### 查看详细输出
```bash
npm run test:unit -- --reporter=verbose
```

### 调试特定测试
```bash
npm run test:unit -- --grep "specific test name"
```

### 性能分析
```bash
npm run test:performance -- --reporter=verbose
```

## 故障排除

### 常见问题

1. **内存不足**
   - 检查测试数据大小
   - 确保正确清理数据
   - 监控内存使用

2. **测试超时**
   - 检查数据库连接
   - 优化查询性能
   - 增加超时时间

3. **Mock 失效**
   - 验证 Mock 配置
   - 检查导入路径
   - 确保 Mock 重置

4. **数据不一致**
   - 检查测试隔离
   - 验证数据清理
   - 确保事务完整性

### 性能优化

1. **批量操作**
   ```typescript
   // 好的做法
   await db.insert(table).values(batchData);
   
   // 避免
   for (const item of data) {
     await db.insert(table).values(item);
   }
   ```

2. **索引使用**
   ```typescript
   // 确保查询使用索引
   await db.select()
     .from(table)
     .where(eq(table.indexedColumn, value));
   ```

3. **内存管理**
   ```typescript
   // 限制结果集大小
   await db.select()
     .from(table)
     .limit(1000);
   ```

## 扩展测试

添加新的测试时：

1. 选择合适的测试类型
2. 使用现有的工具和 fixtures
3. 遵循命名约定
4. 添加必要的文档
5. 确保测试隔离

## 测试指标

当前测试覆盖目标：
- 代码覆盖率 > 80%
- 分支覆盖率 > 70%
- 函数覆盖率 > 90%
- 行覆盖率 > 85%