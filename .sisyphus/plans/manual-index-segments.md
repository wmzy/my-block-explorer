# 手动区间索引 + 分段进度条

## TL;DR

> **Quick
> Summary**: 将合约事件索引从"自动全量"改为"用户手动指定区间"，并实现类似视频播放器的分段进度条 UI。后端移除自动索引逻辑、补全缺失的 Range
> API 路由；前端新建分段进度条组件。
>
> **Deliverables**:
>
> - 移除自动全量索引逻辑（`startIndexing` 函数 + 重复路由）
> - 补全缺失的 Range API 路由（`/ranges`, `/ranges/:id/start` 等）
> - 新建 `SegmentedProgressBar` 组件
> - 改造 `indexingProgress` 表为聚合视图
>
> **Estimated Effort**: Medium **Parallel Execution**: YES - 3 waves **Critical
> Path**: Range API 补全 → 前端组件 → 集成测试

---

## Context

### Original Request

用户要将合约事件索引从自动全量改成手动区间，并实现分段进度条 UI（类似视频播放器分段下载的进度）。

### Interview Summary

**Key Discussions**:

- **入口位置**: 合约详情页（每个合约独立管理）
- **分段定义**: 每个用户添加的区间为一段
- **执行模式**: 串行执行（一个区间完成后再执行下一个）
- **状态持久化**: 需要（刷新/重启后恢复进度）
- **indexingProgress 表**: 保留并转型，从 indexingRanges 聚合数据
- **进度条样式**: 极简模式（只显示进度条，hover 显示详情）

**Research Findings**:

- **区间索引基础设施已存在**: `addIndexingRange`, `startIndexingRange`,
  `pauseIndexingRange` 等函数已实现
- **后端路由缺失**: 前端 `IndexingRangeManager` 调用的 API 端点未定义
- **前端技术栈**: haze-ui + Linaria CSS，`EventStatistics.tsx`
  有进度条样式可参考

### Metis Review (Self-Performed)

**Identified Gaps** (addressed):

- **Gap 1**: 区间索引的队列管理机制未明确 → 添加队列服务任务
- **Gap 2**: 串行执行时如何处理"正在索引时添加新区间" → 使用队列 + 状态检查
- **Gap 3**: 进度条 hover 显示哪些详情 → 区间范围、状态、进度百分比

---

## Work Objectives

### Core Objective

移除自动全量索引逻辑，实现用户手动区间索引 + 分段进度条 UI。

### Concrete Deliverables

1. **后端**: 移除 `startIndexing` 函数、4 个重复路由；补全 5 个 Range API 路由
2. **前端**: `SegmentedProgressBar` 组件 + 集成到合约详情页
3. **数据**: `indexingProgress` 表转型为聚合查询

### Definition of Done

- [ ] `POST /events/index` 路由返回 404 或移除
- [ ] `GET /events/ranges` 返回区间列表
- [ ] `POST /events/ranges` 创建新区间
- [ ] `POST /events/ranges/:id/start` 启动区间索引
- [ ] 前端分段进度条正确显示各区间状态
- [ ] `npm test` 全部通过

### Must Have

- 移除自动全量索引入口（用户无法触发自动索引）
- 手动区间索引功能完整可用
- 分段进度条正确反映各区间状态

### Must NOT Have (Guardrails)

- 不要删除 `indexingRanges` 表和已有的 range 相关 service 函数
- 不要删除 `EventStatistics` 组件（改造而非重写）
- 不要引入新的 UI 组件库
- 不要改变 `contractEvents` 表结构
- 不要添加并行索引功能（串行执行）

---

## Verification Strategy (MANDATORY)

### Test Decision

- **Infrastructure exists**: YES (Vitest)
- **Automated tests**: TDD
- **Framework**: Vitest
- **TDD Flow**: RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy

Every task MUST include agent-executed QA scenarios. Evidence saved to
`.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright — Navigate, interact, assert DOM, screenshot
- **API/Backend**: Use Bash (curl) — Send requests, assert status + response
  fields

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 后端 API + 数据层):
├── Task 1: 补全 Range API 路由 [quick]
├── Task 2: 移除自动索引路由 [quick]
├── Task 3: 索引队列服务（串行执行管理）[deep]
└── Task 4: indexingProgress 聚合查询改造 [quick]

Wave 2 (After Wave 1 — 前端组件):
├── Task 5: SegmentedProgressBar 组件 [visual-engineering]
├── Task 6: IndexingRangeManager 集成进度条 [visual-engineering]
└── Task 7: 移除自动索引触发 UI [quick]

Wave 3 (After Wave 2 — 集成 + 清理):
├── Task 8: 移除 startIndexing 函数 [quick]
├── Task 9: 端到端集成测试 [deep]
└── Task 10: 文档更新 [writing]

Critical Path: Task 1 → Task 5 → Task 6 → Task 9
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks |
| ---- | ---------- | ------ |
| 1    | —          | 5, 9   |
| 2    | —          | 8      |
| 3    | —          | 5, 9   |
| 4    | —          | 5      |
| 5    | 1, 3, 4    | 6, 9   |
| 6    | 5          | 9      |
| 7    | —          | 8      |
| 8    | 2, 7       | —      |
| 9    | 1, 3, 5, 6 | 10     |
| 10   | 9          | —      |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks — T1,T2,T4 → `quick`, T3 → `deep`
- **Wave 2**: 3 tasks — T5,T6 → `visual-engineering`, T7 → `quick`
- **Wave 3**: 3 tasks — T8 → `quick`, T9 → `deep`, T10 → `writing`

---

## TODOs

- [x] 1. 补全 Range API 路由

  **What to do**:
  - 在 `src/routes/events.ts` 中添加 5 个缺失的 Range API 路由
  - 路由定义：
    - `GET /chains/:chainId/contracts/:address/events/ranges` →
      `getIndexingRanges`
    - `POST /chains/:chainId/contracts/:address/events/ranges` →
      `addIndexingRange`
    - `POST /chains/:chainId/contracts/:address/events/ranges/:rangeId/start` →
      `startIndexingRange`
    - `POST /chains/:chainId/contracts/:address/events/ranges/:rangeId/pause` →
      `pauseIndexingRange`
    - `DELETE /chains/:chainId/contracts/:address/events/ranges/:rangeId` →
      `deleteIndexingRange`
  - 先写测试用例（TDD）

  **Must NOT do**:
  - 不要修改 `EventIndexingService.ts` 中的 service 函数
  - 不要改变现有的 API 响应格式

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 路由注册是标准化的重复性工作
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Task 5, Task 9
  - **Blocked By**: None

  **References**:
  - `src/routes/events.ts:88-118` - 现有路由定义模式
  - `src/services/EventIndexingService.ts:707-789` - `addIndexingRange`,
    `getIndexingRanges` 函数签名
  - `src/services/EventIndexingService.ts:907-1085` - `startIndexingRange`,
    `pauseIndexingRange` 函数签名

  **Acceptance Criteria**:
  - [ ] 测试文件创建: `src/__tests__/routes/events-ranges.test.ts`
  - [ ] `npm test src/__tests__/routes/events-ranges.test.ts` → PASS

  **QA Scenarios**:

  ```
  Scenario: GET ranges 返回区间列表
    Tool: Bash (curl)
    Steps:
      1. curl -X GET http://localhost:8201/api/chains/1/contracts/0x1234567890abcdef1234567890abcdef12345678/events/ranges
    Expected Result: 200 OK, JSON array (可能为空)
    Evidence: .sisyphus/evidence/task-01-get-ranges.json

  Scenario: POST ranges 创建新区间
    Tool: Bash (curl)
    Steps:
      1. curl -X POST http://localhost:8201/api/chains/1/contracts/0x1234567890abcdef1234567890abcdef12345678/events/ranges \
         -H "Content-Type: application/json" \
         -d '{"fromBlock": 1000000, "toBlock": 1010000}'
    Expected Result: 201 Created, JSON with rangeId, fromBlock, toBlock, status
    Evidence: .sisyphus/evidence/task-01-post-ranges.json
  ```

  **Commit**: YES
  - Message: `feat(indexing): add Range API routes for manual indexing`
  - Files: `src/routes/events.ts`, `src/__tests__/routes/events-ranges.test.ts`

- [x] 2. 移除自动索引路由

  **What to do**:
  - 移除 `src/routes/events.ts` 中 4 个重复的 `POST /events/index` 路由
  - 移除对应的 `DELETE /events/index` 路由
  - 更新相关测试

  **Must NOT do**:
  - 不要删除 `EventIndexingService.ts` 中的 `startIndexing` 函数（Task 8 处理）
  - 不要删除 `indexingProgress` 表

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 删除代码的简单任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 8
  - **Blocked By**: None

  **References**:
  - `src/routes/events.ts:121,194,267,340` - 4 个重复的 POST 路由位置
  - `src/routes/events.ts:184,257,330,403` - DELETE 路由位置

  **Acceptance Criteria**:
  - [ ] `POST /events/index` 路由不再存在
  - [ ] `npm test` → PASS

  **QA Scenarios**:

  ```
  Scenario: POST /events/index 返回 404
    Tool: Bash (curl)
    Steps:
      1. curl -X POST http://localhost:8201/api/chains/1/contracts/0x1234.../events/index
    Expected Result: 404 Not Found
    Evidence: .sisyphus/evidence/task-02-index-404.txt
  ```

  **Commit**: YES
  - Message: `refactor(indexing): remove auto full-index routes`
  - Files: `src/routes/events.ts`

- [x] 3. 索引队列服务（串行执行管理）

  **What to do**:
  - 创建 `src/services/IndexingQueueService.ts`
  - 实现串行队列：一次只执行一个区间索引
  - 支持添加新区间到队列尾部
  - 支持暂停/恢复当前索引
  - 先写测试用例（TDD）

  **Must NOT do**:
  - 不要实现并行索引
  - 不要修改现有的 `startIndexingRange` 函数

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要设计状态机和队列逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 5, Task 9
  - **Blocked By**: None

  **References**:
  - `src/services/EventIndexingService.ts:907-1048` - `startIndexingRange`
    实现参考
  - `src/database/schema.ts:263-280` - `indexingRanges` 表结构

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/__tests__/services/IndexingQueueService.test.ts`
  - [ ] `npm test src/__tests__/services/IndexingQueueService.test.ts` → PASS

  **QA Scenarios**:

  ```
  Scenario: 添加区间后自动开始索引（队列为空时）
    Tool: Bash (curl)
    Steps:
      1. POST /ranges 创建区间 A
      2. POST /ranges/:idA/start 启动索引
      3. GET /ranges 检查状态为 running
    Expected Result: 区间 A 状态变为 running
    Evidence: .sisyphus/evidence/task-03-queue-start.json

  Scenario: 索引进行中添加新区间，排队等待
    Tool: Bash (curl)
    Steps:
      1. POST /ranges 创建区间 A，启动索引
      2. POST /ranges 创建区间 B
      3. GET /ranges 检查 B 状态为 pending
    Expected Result: 区间 B 状态为 pending
    Evidence: .sisyphus/evidence/task-03-queue-pending.json
  ```

  **Commit**: YES
  - Message: `feat(indexing): add serial queue service for range indexing`
  - Files: `src/services/IndexingQueueService.ts`,
    `src/__tests__/services/IndexingQueueService.test.ts`

- [x] 4. indexingProgress 聚合查询改造

  **What to do**:
  - 修改 `getIndexingStatus` 函数，从 `indexingRanges` 表聚合数据
  - 返回数据包含：总区间数、完成数、进行中数、总进度百分比
  - 先写测试用例（TDD）

  **Must NOT do**:
  - 不要删除 `indexingProgress` 表（保留用于其他用途或兼容性）
  - 不要改变 API 响应结构（保持向后兼容）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 查询逻辑改造，不涉及复杂算法
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `src/services/EventIndexingService.ts:475-552` - `getIndexingStatus`
    当前实现
  - `src/database/schema.ts:263-280` - `indexingRanges` 表结构
  - `src/database/schema.ts:246-260` - `indexingProgress` 表结构

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/__tests__/services/getIndexingStatus.test.ts`
  - [ ] `npm test src/__tests__/services/getIndexingStatus.test.ts` → PASS

  **QA Scenarios**:

  ```
  Scenario: 无区间时返回零进度
    Tool: Bash (curl)
    Steps:
      1. GET /indexing-status
    Expected Result: { totalRanges: 0, completedRanges: 0, progress: 0 }
    Evidence: .sisyphus/evidence/task-04-status-empty.json

  Scenario: 有多个区间时返回聚合进度
    Tool: Bash (curl)
    Steps:
      1. POST /ranges 创建区间 A (1000000-1010000, completed)
      2. POST /ranges 创建区间 B (1010000-1020000, running, 50%)
      3. GET /indexing-status
    Expected Result: { totalRanges: 2, completedRanges: 1, progress: 75 }
    Evidence: .sisyphus/evidence/task-04-status-aggregated.json
  ```

  **Commit**: YES
  - Message: `refactor(db): transform indexingProgress to aggregated view`
  - Files: `src/services/EventIndexingService.ts`,
    `src/__tests__/services/getIndexingStatus.test.ts`

- [x] 5. SegmentedProgressBar 组件

  **What to do**:
  - 创建 `src/components/ui/SegmentedProgressBar.tsx`
  - Props: `segments` (区间数组), `totalBlocks` (总区块数)
  - 每个区间显示为进度条上的一段
  - 颜色编码：completed=绿色, running=蓝色, pending=灰色, error=红色
  - Hover 显示详情：区间范围、状态、进度百分比
  - 使用 Linaria CSS (css tag + cx)
  - 先写测试用例（TDD）

  **Must NOT do**:
  - 不要使用 haze-ui 以外的 UI 库
  - 不要添加拖拽交互功能
  - 不要使用 `console.log`

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI 组件开发，需要关注视觉效果和交互
  - **Skills**: []
    - 无特殊技能需求，Linaria 已是项目标准

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7)
  - **Blocks**: Task 6, Task 9
  - **Blocked By**: Task 1, Task 3, Task 4

  **References**:
  - `src/components/events/EventStatistics.tsx:进度条样式` - 进度条 CSS 模式参考
  - `src/styles/global.ts` - CSS 变量定义
  - `src/components/ui/Button.tsx` - 组件封装模式参考

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/__tests__/components/SegmentedProgressBar.test.tsx`
  - [ ] `npm test src/__tests__/components/SegmentedProgressBar.test.tsx` → PASS

  **QA Scenarios**:

  ```
  Scenario: 渲染多个区间段
    Tool: Playwright
    Steps:
      1. 访问合约详情页
      2. 添加区间 A (0-1000, completed)
      3. 添加区间 B (1000-2000, running)
      4. 检查进度条显示两段
    Expected Result: 进度条显示绿色段(A) + 蓝色动画段(B)
    Evidence: .sisyphus/evidence/task-05-multi-segments.png

  Scenario: Hover 显示详情
    Tool: Playwright
    Steps:
      1. 访问有区间的合约页
      2. Hover 进度条上的段
      3. 检查 tooltip 显示
    Expected Result: Tooltip 显示 "1000000 - 1010000 (完成 50%)"
    Evidence: .sisyphus/evidence/task-05-hover-tooltip.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add SegmentedProgressBar component`
  - Files: `src/components/ui/SegmentedProgressBar.tsx`,
    `src/__tests__/components/SegmentedProgressBar.test.tsx`

- [x] 6. IndexingRangeManager 集成进度条

  **What to do**:
  - 修改 `src/components/events/IndexingRangeManager.tsx`
  - 在顶部添加 SegmentedProgressBar 组件
  - 连接 Range API 获取区间数据
  - 显示总体进度信息

  **Must NOT do**:
  - 不要删除现有的区间列表功能
  - 不要改变区间添加/删除的交互逻辑

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: 组件集成和布局调整
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7)
  - **Blocks**: Task 9
  - **Blocked By**: Task 5

  **References**:
  - `src/components/events/IndexingRangeManager.tsx` - 现有组件
  - `src/hooks/useBlockchainQueries.ts` - TanStack Query hooks 模式
  - `src/components/ui/SegmentedProgressBar.tsx` - Task 5 创建的组件

  **Acceptance Criteria**:
  - [ ] 分段进度条显示在区间管理器顶部
  - [ ] `npm test` → PASS

  **QA Scenarios**:

  ```
  Scenario: 进度条与区间列表同步
    Tool: Playwright
    Steps:
      1. 访问合约详情页 Events 标签
      2. 添加区间 A
      3. 检查进度条更新
      4. 删除区间 A
      5. 检查进度条更新
    Expected Result: 进度条实时反映区间变化
    Evidence: .sisyphus/evidence/task-06-sync.png

  Scenario: 区间状态变化时进度条更新
    Tool: Playwright
    Steps:
      1. 添加区间并启动索引
      2. 等待索引完成
      3. 检查进度条颜色变为绿色
    Expected Result: 完成后段颜色变为绿色
    Evidence: .sisyphus/evidence/task-06-complete.png
  ```

  **Commit**: YES
  - Message: `feat(ui): integrate progress bar into IndexingRangeManager`
  - Files: `src/components/events/IndexingRangeManager.tsx`

- [x] 7. 移除自动索引触发 UI

  **What to do**:
  - 检查 `src/components/events/` 中是否有"开始索引"按钮
  - 移除或隐藏自动索引触发的 UI 元素
  - 保留"添加区间"和"开始区间索引"的 UI

  **Must NOT do**:
  - 不要删除 `IndexingRangeManager` 组件
  - 不要删除区间管理功能

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 删除 UI 元素的简单任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: Task 8
  - **Blocked By**: None

  **References**:
  - `src/components/events/EventStatistics.tsx` - 检查是否有自动索引按钮
  - `src/components/events/IndexingRangeManager.tsx` - 检查触发逻辑
  - `src/pages/ContractPage.tsx:854-862` - EventsPanel 加载位置

  **Acceptance Criteria**:
  - [ ] 无 UI 元素可触发 `POST /events/index`
  - [ ] `npm test` → PASS

  **QA Scenarios**:

  ```
  Scenario: 无自动索引按钮
    Tool: Playwright
    Steps:
      1. 访问合约详情页 Events 标签
      2. 检查页面内容
    Expected Result: 无"开始索引"或类似按钮
    Evidence: .sisyphus/evidence/task-07-no-auto-button.png
  ```

  **Commit**: YES
  - Message: `refactor(ui): remove auto-index trigger UI`
  - Files: `src/components/events/` 相关文件

- [x] 8. 移除 startIndexing 函数

  **What to do**:
  - 确认 `startIndexing` 函数无其他调用点
  - 从 `EventIndexingService.ts` 中移除 `startIndexing` 函数
  - 移除 `getOrCreateProgress` 函数（仅 startIndexing 使用）
  - 移除 `stopIndexing` 函数（仅 startIndexing 使用）
  - 保留 `updateProgress` 函数（range 索引可能使用）

  **Must NOT do**:
  - 不要删除 `startIndexingRange` 及相关函数
  - 不要删除 `fetchLogsWithRetry`, `decodeLogs`, `insertEvents` 等通用逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 删除代码的简单任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 10)
  - **Blocks**: None
  - **Blocked By**: Task 2, Task 7

  **References**:
  - `src/services/EventIndexingService.ts:360-467` - `startIndexing` 函数
  - `src/services/EventIndexingService.ts:64-122` - `getOrCreateProgress` 函数
  - `src/services/EventIndexingService.ts:469-473` - `stopIndexing` 函数

  **Acceptance Criteria**:
  - [ ] `startIndexing` 函数已移除
  - [ ] `npm test` → PASS
  - [ ] `tsc --noEmit` → 无错误

  **QA Scenarios**:

  ```
  Scenario: 编译无错误
    Tool: Bash
    Steps:
      1. npm run build:server
    Expected Result: Build success, no TypeScript errors
    Evidence: .sisyphus/evidence/task-08-build.txt
  ```

  **Commit**: YES
  - Message: `refactor(indexing): remove startIndexing function`
  - Files: `src/services/EventIndexingService.ts`

- [x] 9. 端到端集成测试

  **What to do**:
  - 创建 `tests/e2e/manual-indexing.e2e.test.ts`
  - 测试完整流程：添加区间 → 启动索引 → 查看进度 → 完成
  - 测试串行执行：添加多个区间，验证按顺序执行
  - 测试持久化：重启服务后恢复进度

  **Must NOT do**:
  - 不要依赖外部网络（使用 mock 或本地链）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: E2E 测试需要设计完整场景
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 10)
  - **Blocks**: Task 10
  - **Blocked By**: Task 1, Task 3, Task 5, Task 6

  **References**:
  - `tests/` - 现有测试结构
  - `src/__tests__/` - 单元测试模式参考

  **Acceptance Criteria**:
  - [ ] 测试文件: `tests/e2e/manual-indexing.e2e.test.ts`
  - [ ] `npm run test:e2e` → PASS

  **QA Scenarios**:

  ```
  Scenario: 完整索引流程
    Tool: Playwright
    Steps:
      1. 访问合约详情页
      2. 添加区间 0-10000
      3. 点击"开始索引"
      4. 等待进度条更新
      5. 验证索引完成
    Expected Result: 区间状态变为 completed，进度条 100%
    Evidence: .sisyphus/evidence/task-09-full-flow.png

  Scenario: 串行执行多个区间
    Tool: Bash (curl) + Playwright
    Steps:
      1. 创建区间 A 并启动
      2. 创建区间 B
      3. 检查 B 状态为 pending
      4. 等待 A 完成
      5. 验证 B 自动开始
    Expected Result: A 完成后 B 自动开始
    Evidence: .sisyphus/evidence/task-09-serial.txt
  ```

  **Commit**: YES
  - Message: `test(indexing): add e2e tests for manual range indexing`
  - Files: `tests/e2e/manual-indexing.e2e.test.ts`

- [x] 10. 文档更新

  **What to do**:
  - 更新 `docs/` 中关于索引的文档（如有）
  - 更新 `AGENTS.md` 中的相关描述
  - 记录手动区间索引的使用方法

  **Must NOT do**:
  - 不要创建新文档（仅更新现有）
  - 不要使用中文注释/文档

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 文档撰写任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9)
  - **Blocks**: None
  - **Blocked By**: Task 9

  **References**:
  - `AGENTS.md` - 项目知识库
  - `docs/` - 架构文档目录

  **Acceptance Criteria**:
  - [ ] 文档更新完成
  - [ ] 无中文内容

  **QA Scenarios**:

  ```
  Scenario: 文档描述手动索引流程
    Tool: Read
    Steps:
      1. 读取更新后的文档
      2. 检查包含手动区间索引说明
    Expected Result: 文档清晰描述使用方法
    Evidence: .sisyphus/evidence/task-10-doc.md
  ```

  **Commit**: YES
  - Message: `docs: update indexing documentation`
  - Files: `AGENTS.md`, `docs/` 相关文件

---

## Final Verification Wave (MANDATORY)

- [x] F1. **Plan Compliance Audit** — `oracle` Verify all "Must Have"
      implemented, all "Must NOT Have" absent.

- [x] F2. **Code Quality Review** — `unspecified-high` Run `tsc --noEmit` +
      `npm run lint` + `npm test`.

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill) Execute
      all QA scenarios, capture evidence.

- [x] F4. **Scope Fidelity Check** — `deep` Verify no scope creep, all tasks
      implemented as specified.

---

## Commit Strategy

- **1**: `feat(indexing): add Range API routes for manual indexing` —
  routes/events.ts
- **2**: `refactor(indexing): remove auto full-index routes` — routes/events.ts
- **3**: `feat(indexing): add serial queue service for range indexing` —
  services/IndexingQueueService.ts
- **4**: `refactor(db): transform indexingProgress to aggregated view` —
  services/EventIndexingService.ts
- **5**: `feat(ui): add SegmentedProgressBar component` —
  components/ui/SegmentedProgressBar.tsx
- **6**: `feat(ui): integrate progress bar into IndexingRangeManager` —
  components/events/IndexingRangeManager.tsx
- **7**: `refactor(ui): remove auto-index trigger UI` — components/events/
- **8**: `refactor(indexing): remove startIndexing function` —
  services/EventIndexingService.ts
- **9**: `test(indexing): add e2e tests for manual range indexing` — tests/e2e/
- **10**: `docs: update indexing documentation` — docs/

---

## Success Criteria

### Verification Commands

```bash
# 后端 API 测试
curl -X GET http://localhost:8201/api/chains/1/contracts/0x.../events/ranges
# Expected: 200 OK with ranges array

curl -X POST http://localhost:8201/api/chains/1/contracts/0x.../events/ranges \
  -H "Content-Type: application/json" \
  -d '{"fromBlock": 1000000, "toBlock": 1010000}'
# Expected: 201 Created with range object

# 前端构建
npm run build
# Expected: Build success, no errors

# 测试
npm test
# Expected: All tests pass
```

### Final Checklist

- [ ] 自动全量索引入口已移除
- [ ] Range API 路由完整可用
- [ ] 分段进度条正确显示
- [ ] 所有测试通过
- [ ] 无 TypeScript 错误
- [ ] 无 ESLint 错误
