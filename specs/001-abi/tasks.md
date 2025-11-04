---
description: "合约事件索引与查询功能的任务列表"
---

# Tasks: 合约事件索引与查询

**输入**: 来自 `/specs/001-abi/` 的设计文档
**前置条件**: plan.md (必需), spec.md (用户故事必需), research.md, data-model.md, contracts/

**测试**: 测试基于 FR-007 中 80% 覆盖率要求以及成功标准中的性能测试要求

**组织结构**: 按用户故事分组任务，支持每个故事的独立实现和测试

## 格式: `[ID] [P?] [Story] 描述`
- **[P]**: 可以并行执行（不同文件，无依赖关系）
- **[Story]**: 该任务所属的用户故事（例如，US1, US2, US3, US4）
- 在描述中包含确切的文件路径

## 路径约定
- **Web 应用结构**: 仓库根目录下的 `src/`，前后端分离的组织方式
- **数据库层**: `src/database/`
- **服务层**: `src/services/`
- **类型定义**: `src/types/`
- **组件**: `src/components/`
- **API**: `src/api-app.ts`
- **测试**: `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/performance/`

## 阶段 1: 设置（共享基础设施）

**目的**: 项目初始化和多链数据库架构设置

- [X] T001 在 `data/chains/` 中创建多链数据库目录结构
- [X] T002 初始化 TypeScript 项目依赖（React 19, Hono, DuckDB 适配器, Viem 2.34+）
- [X] T003 [P] 使用严格 TypeScript 规则配置 ESLint 和 Prettier
- [X] T004 [P] 设置 Vitest 测试环境，使用 jsdom 和 v8 coverage 提供商

---

## 阶段 2: 基础（阻塞性先决条件）

**目的**: 核心多链基础设施，必须在任何用户故事实现之前完成

**⚠️ 关键**: 在此阶段完成之前，不能开始任何用户故事工作

- [X] T005 在 `src/database/chain-database-manager.ts` 中实现 `ChainDatabaseManager` 类，用于每链数据库隔离
- [X] T006 [P] 在 `src/database/chain-schema-manager.ts` 中实现 `ChainSchemaManager` 类，定义特定链的表结构（无 chain_id 字段）
- [X] T007 [P] 在 `src/database/chain-event-table-manager.ts` 中实现 `ChainEventTableManager` 类，用于动态事件表创建
- [X] T008 [P] 在 `src/types/events.ts` 中创建多链类型定义，包含 ABI 映射和事件类型
- [X] T009 [P] 在 `src/config/chains.ts` 中设置链配置，用于链类型检测和数据库路径生成
- [X] T010 配置性能监控基础设施，跟踪 1-9ms 响应时间
- [X] T011 [P] 设置零配置环境，自动发现链数据库

**检查点**: ✅ 多链基础设施已完成 - 现在可以开始用户故事实现

---

## 阶段 3: 用户故事 1 - 事件发现与浏览 (优先级: P1) 🎯 MVP

**目标**: 允许用户浏览已验证合约的所有事件，包含基本的事件显示和索引进度指示器

**独立测试**: 导航到已验证合约页面，查看事件标签页，按时间顺序查看事件列表，包含事件名称、时间戳、交易哈希和参数。测试无事件、部分索引和完成索引的场景。

### 用户故事 1 的测试 ⚠️

**注意**: 先编写这些测试，确保在实现之前测试会失败

- [X] T012 [P] [US1] 在 `tests/unit/services/chain-event-table-manager.test.ts` 中为 `ChainEventTableManager` 表创建编写单元测试
- [X] T013 [P] [US1] 在 `tests/integration/events/indexing-status.test.ts` 中为事件索引状态端点编写集成测试
- [X] T014 [P] [US1] 在 `tests/performance/events/event-query.test.ts` 中为事件列表查询响应时间编写性能测试
- [X] T015 [P] [US1] 在 `tests/e2e/events/contract-events-page.test.ts` 中为合约事件页面导航编写 E2E 测试

### 用户故事 1 的实现

- [X] T016 [P] [US1] 在 `src/database/chain-schema-manager.ts` 中创建事件表注册表模式（扩展 T006）
- [X] T017 [US1] 在 `src/services/EventIndexingService.ts` 中实现 `EventIndexingService` 类，用于合约事件索引（依赖于 T005, T008）
- [X] T018 [US1] 在 `src/services/EventQueryService.ts` 中实现 `EventQueryService` 类，用于基本事件查询（依赖于 T007）
- [X] T019 [US1] 在 `src/api-app.ts` 中添加索引状态端点 `/api/chains/{chainId}/contracts/{contractAddress}/events/indexing-status`
- [X] T020 [US1] 在 `src/api-app.ts` 中添加基本事件查询端点 `/api/chains/{chainId}/contracts/{contractAddress}/events`
- [X] T021 [US1] 在 `src/components/events/EventTable.tsx` 中创建 `EventTable` 组件，用于显示事件列表
- [X] T022 [US1] 在 `src/components/events/EventStatistics.tsx` 中创建 `EventStatistics` 组件，用于索引进度显示
- [X] T023 [US1] 在 `src/services/EventDecodingService.ts` 中使用 Viem 添加事件解码逻辑（依赖于 T008）
- [X] T024 [US1] 在 `src/services/EventDecodingService.ts` 中实现 ABI 解析和事件签名提取
- [X] T025 [US1] 为所有事件操作添加 TypeScript 验证和严格类型的错误处理
- [X] T026 [US1] 确保实现满足缓存事件数据 1-9ms 响应时间要求

**检查点**: ✅ 用户故事 1 MVP 已完成 - 核心事件发现与浏览功能可用并可独立测试

---

## 阶段 4: 用户故事 2 - 事件过滤与搜索 (优先级: P1)

**目标**: 允许用户按类型、日期范围和特定参数值过滤事件，支持多种过滤器

**独立测试**: 对合约事件应用各种过滤器（事件类型、日期范围、参数值），并验证结果同时匹配所有应用的过滤条件

### 用户故事 2 的测试 ⚠️

- [ ] T027 [P] [US2] 在 `tests/unit/services/event-query-service.test.ts` 中为事件过滤逻辑编写单元测试
- [ ] T028 [P] [US2] 在 `tests/integration/events/advanced-search.test.ts` 中为高级搜索端点编写集成测试
- [ ] T029 [P] [US2] 在 `tests/performance/events/filtering.test.ts` 中为过滤查询响应时间编写性能测试

### 用户故事 2 的实现

- [ ] T030 [P] [US2] 在 `src/components/forms/DynamicFormGenerator.tsx` 中创建动态表单生成逻辑（依赖于 T008）
- [ ] T031 [US2] 在 `src/services/EventDecodingService.ts` 中实现 `EventDecodingService` 参数类型映射（扩展 T023）
- [ ] T032 [US2] 在 `src/components/events/DynamicEventFilterForm.tsx` 中创建 `DynamicEventFilterForm` 组件，用于基于 ABI 的过滤表单
- [ ] T033 [US2] 在 `src/api-app.ts` 中添加高级搜索端点 `/api/chains/{chainId}/contracts/{contractAddress}/events/search`
- [ ] T034 [US2] 在 `src/services/EventQueryService.ts` 中使用复杂过滤功能扩展 `EventQueryService`（扩展 T018）
- [ ] T035 [US2] 在 `src/utils/form-validation.ts` 中为不同的 Solidity 类型实现表单验证和类型转换
- [ ] T036 [US2] 在 `src/database/chain-event-table-manager.ts` 中为过滤事件查询添加基于参数的索引（扩展 T007）
- [ ] T037 [US2] 与用户故事 1 的组件集成，提供无缝过滤体验

**检查点**: 此时，用户故事 1 和 2 都应该可以独立工作

---

## 阶段 5: 用户故事 3 - 事件排序与分页 (优先级: P2)

**目标**: 允许用户按不同标准排序事件，并通过分页控件浏览大型事件集合

**独立测试**: 应用不同的排序顺序（时间戳、区块号），并浏览多个页面，验证正确的子集显示和保持的过滤/排序状态

### 用户故事 3 的测试 ⚠️

- [x] T038 [P] [US3] 在 `tests/unit/services/event-query-service.test.ts` 中为分页逻辑编写单元测试
- [x] T039 [P] [US3] 在 `tests/integration/events/pagination.test.ts` 中为排序和分页端点编写集成测试
- [x] T040 [P] [US3] 在 `tests/performance/events/pagination.test.ts` 中为大型数据集分页编写性能测试

### 用户故事 3 的实现

- [x] T041 [P] [US3] 在 `src/services/EventQueryService.ts` 中使用排序和分页逻辑扩展 `EventQueryService`（扩展 T018, T034）
- [x] T042 [US3] 在 `src/services/EventQueryService.ts` 中添加基于游标的分页支持
- [x] T043 [P] [US3] 在 `src/components/ui/Pagination.tsx` 中创建分页控件组件
- [x] T044 [US3] 在 `src/components/events/EventTable.tsx` 中使用排序控件和分页集成增强 `EventTable` 组件（扩展 T021）
- [x] T045 [US3] 在 `src/api-app.ts` 中为事件端点添加排序查询参数（sort, sortBy）
- [x] T046 [US3] 在 `src/database/chain-event-table-manager.ts` 中为排序字段实现高效的数据库索引（扩展 T007）
- [x] T047 [US3] 在 `src/services/EventQueryService.ts` 中添加大型事件集合的查询优化

**检查点**: 所有用户故事现在都应该可以独立使用

---

## 阶段 6: 用户故事 4 - 实时事件更新 (优先级: P3)

**目标**: 在发出新事件时启用实时事件更新，无需手动刷新，同时保留过滤和排序

**独立测试**: 在新交易处理时监控合约，验证新事件在保持排序顺序的过滤结果中自动出现

### 用户故事 4 的测试 ⚠️

- [ ] T048 [P] [US4] 在 `tests/unit/services/realtime-events.test.ts` 中为实时事件流编写单元测试
- [ ] T049 [P] [US4] 在 `tests/integration/events/realtime-updates.test.ts` 中为 WebSocket 事件更新编写集成测试
- [ ] T050 [P] [US4] 在 `tests/e2e/events/realtime-events.test.ts` 中为实时事件显示编写 E2E 测试

### 用户故事 4 的实现

- [ ] T051 [P] [US4] 在 `src/services/RealtimeEventService.ts` 中创建实时事件监控服务
- [ ] T052 [US4] 在 `src/services/RealtimeEventService.ts` 中实现事件更新的 WebSocket 连接管理
- [ ] T053 [US4] 在 `src/services/ReorgDetectionService.ts` 中添加区块重组检测和处理
- [ ] T054 [US4] 在 `src/hooks/useRealtimeEvents.ts` 中创建实时事件钩子
- [ ] T055 [US4] 在 `src/components/events/EventTable.tsx` 中使用实时更新增强 `EventTable` 组件（扩展 T021, T044）
- [ ] T056 [US4] 在 `src/api-app.ts` 中为 WebSocket 连接添加事件订阅端点
- [ ] T057 [US4] 在 `src/components/events/EventTable.tsx` 中实现实时更新的客户端状态管理
- [ ] T058 [US4] 在 `src/components/ui/Notifications.tsx` 中添加重组相关数据变更的用户通知系统

---

## 阶段 7: 完善和跨领域关注点

**目的**: 影响多个用户故事的改进

- [ ] T059 [P] 在 `docs/api/events.md` 中更新完整 API 参考的文档
- [ ] T060 [P] 对所有事件服务进行代码清理和重构
- [ ] T061 使用缓存策略对所有事件查询进行性能优化
- [ ] T062 [P] 在 `tests/unit/services/` 中为边缘情况编写额外的单元测试
- [ ] T063 [P] 为事件数据访问和验证进行安全加固
- [ ] T064 [P] 运行 quickstart.md 验证完整功能
- [ ] T065 [P] 添加全面的错误处理和用户友好的错误消息
- [ ] T066 [P] 在 `src/services/DataRetentionService.ts` 中实现数据保留策略和清理例程
- [ ] T067 [P] 为索引性能和错误添加监控和告警
- [ ] T068 [P] 创建开发者文档，用于将事件索引扩展到新的合约类型

---

## 依赖关系和执行顺序

### 阶段依赖

- **设置（阶段 1）**: 无依赖 - 可以立即开始
- **基础（阶段 2）**: 依赖于设置完成 - 阻塞所有用户故事
- **用户故事（阶段 3-6）**: 都依赖于基础阶段完成
  - 用户故事可以按优先级顺序进行（P1 → P2 → P3 → P4）
  - P1 和 P2 可以由不同的团队成员并行工作
  - P3 和 P4 可以在 P1/P2 基础稳定后跟进
- **完善（阶段 7）**: 依赖于所有期望的用户故事完成

### 用户故事依赖

- **用户故事 1 (P1)**: 可以在基础（阶段 2）完成后开始 - 不依赖其他故事
- **用户故事 2 (P1)**: 可以在基础（阶段 2）完成后开始 - 与 US1 组件集成但可独立测试
- **用户故事 3 (P2)**: 可以在用户故事 1 基本功能稳定后开始 - 构建在 US1/US2 组件之上
- **用户故事 4 (P3)**: 可以在用户故事 1 查询功能稳定后开始 - 扩展所有以前的故事

### 每个用户故事内部

- 必须在实现之前编写测试并确保失败
- 核心服务先于 UI 组件
- 数据库层先于业务逻辑
- 基本功能先于高级功能
- 故事完成后再继续下一个优先级

### 并行机会

- 所有标记为 [P] 的设置任务可以并行运行
- 所有标记为 [P] 的基础任务可以并行运行（在阶段 2 内）
- 阶段 2 完成后，用户故事 1 和 2 可以并行开始
- 用户故事的所有标记为 [P] 的测试可以并行运行
- 不同的用户故事可以由不同的团队成员并行工作
- 用户故事完成后，完善任务可以并行运行

---

## 并行示例：用户故事 1 和 2

```bash
# 一起启动用户故事 1 的测试：
任务: "在 tests/unit/services/chain-event-table-manager.test.ts 中为 ChainEventTableManager 表创建编写单元测试"
任务: "在 tests/integration/events/indexing-status.test.ts 中为事件索引状态端点编写集成测试"
任务: "在 tests/performance/events/event-query.test.ts 中为事件列表查询响应时间编写性能测试"

# 一起启动用户故事 2 的测试：
任务: "在 tests/unit/services/event-query-service.test.ts 中为事件过滤逻辑编写单元测试"
任务: "在 tests/integration/events/advanced-search.test.ts 中为高级搜索端点编写集成测试"

# 不同团队成员并行开发：
# 开发者 A: 用户故事 1 (T016-T026)
# 开发者 B: 用户故事 2 (T030-T037)
```

---

## 实施策略

### 首先实现 MVP（仅用户故事 1）

1. 完成阶段 1: 设置
2. 完成阶段 2: 基础（关键 - 阻塞所有故事）
3. 完成阶段 3: 用户故事 1
4. **停止并验证**: 独立测试用户故事 1
5. 部署/演示基本事件浏览功能

### 增量交付

1. 完成设置 + 基础 → 多链数据库架构就绪
2. 添加用户故事 1 → 独立测试 → 部署/演示（MVP！）
3. 添加用户故事 2 → 独立测试 → 部署/演示（过滤）
4. 添加用户故事 3 → 独立测试 → 部署/演示（分页）
5. 添加用户故事 4 → 独立测试 → 部署/演示（实时）
6. 每个故事在不破坏先前故事的情况下增加价值

### 并行团队策略

多个开发者协作：

1. 团队一起完成设置 + 基础
2. 基础完成后：
   - 开发者 A: 用户故事 1（核心浏览）
   - 开发者 B: 用户故事 2（过滤）
   - 开发者 C: 用户故事 3（分页/排序）
3. 故事独立完成和集成
4. 开发者 A/B/C 协作完成用户故事 4（实时）

---

## 成功标准验证

每个用户故事在完成前必须满足这些可衡量的结果：

**用户故事 1**:
- 用户可以在 1-9ms 内查看缓存数据的合约事件（SC-001）
- 前端在 3 次点击内提供直观的浏览界面（SC-008）
- 对于 99.9% 的标准 ABI 事件类型，事件数据被准确解析和显示（SC-004）

**用户故事 2**:
- 事件过滤操作在 500ms 内完成（SC-002）
- 用户可以成功使用多个标准同时过滤事件（SC-005）
- 索引开始后 5 秒内可以查看部分数据（SC-014）

**用户故事 3**:
- 分页允许用户高效浏览 100 万+ 事件（SC-006）
- 排序操作保持低于 200ms 的 p95 响应时间
- 用户可以一目了然地区分完整和不完整的数据（SC-015）

**用户故事 4**:
- 用户在 60 秒内收到重组相关数据变更的通知（SC-011）
- 索引进度指示器实时更新，延迟小于 1 秒（SC-012）
- 实时更新保持当前的排序顺序（根据验收场景）

---

## 注意事项

- [P] 任务 = 不同文件，无依赖关系
- [Story] 标签将任务映射到特定用户故事以进行可追溯性
- 每个用户故事应该可以独立完成和测试
- 在实现之前验证测试失败
- 在每个任务或逻辑组之后提交
- 在任何检查点停止以独立验证故事
- 多链架构确保数据隔离和性能优化
- 整个实施过程中强制执行 TypeScript 严格模式
- 为所有操作集成性能监控
- 在所有功能中维护零配置部署