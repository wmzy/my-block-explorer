# Implementation Plan: 合约事件索引与查询

**Branch**: `001-abi` | **Date**: 2025-10-15 | **Spec**: [链接到规格说明](./spec.md)
**Input**: Feature specification from `/specs/001-abi/spec.md`

## Summary

基于ABI定义的合约事件动态索引和查询系统。该功能将为每个已验证合约的事件创建独立的数据库表，支持复杂查询、实时更新和高级过滤。技术方案采用动态表创建策略，使用DuckDB-PostgreSQL适配器确保高性能（1-9ms响应时间），并配备智能的前端表单生成系统。

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9+ (Frontend), Node.js 22 (Backend)
**Primary Dependencies**: React 19, Hono framework, DuckDB via custom adapter, Drizzle ORM, Viem 2.34+
**Storage**: DuckDB with PostgreSQL-compatible adapter through Drizzle ORM
**Testing**: Vitest with jsdom environment and v8 coverage provider
**Target Platform**: Web application (client + server)
**Project Type**: Web application with separate frontend/backend build targets
**Performance Goals**: 1-9ms response times for cached data, 80%+ test coverage, sub-200ms p95
**Constraints**: TypeScript strict mode, chain-agnostic services, zero configuration deployment
**Scale/Scope**: Multi-chain blockchain explorer supporting all Viem chains

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

**Performance-First Architecture**: Must demonstrate 1-9ms response times for cached data
**TypeScript Strict Mode**: Zero type errors, no implicit any types
**Chain-Agnostic Services**: Services must work across multiple chains without code changes
**Database Architecture Rules**: Must use DuckDB-PostgreSQL adapter, single database file
**Test Coverage Requirements**: Minimum 80% coverage with unit/integration/e2e/performance tests
**API Design Standards**: RESTful with chain-specific endpoints and consistent JSON responses
**Zero Configuration Deployment**: Application must work out-of-the-box after npm install

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
# Web application structure (selected for this project)
src/
├── database/           # Database layer with custom DuckDB adapter
│   ├── schema.ts       # 扩展事件表模式定义
│   ├── migrations/     # 数据库迁移脚本
│   └── duckdb-postgres-adapter.ts
├── services/           # Business logic layer (chain-agnostic)
│   ├── EventTableManager.ts     # 动态表管理服务
│   ├── EventDecodingService.ts  # 事件解码服务
│   ├── EventQueryService.ts     # 事件查询服务
│   ├── EventIndexingService.ts  # 事件索引服务
│   └── RpcManager.ts            # RPC连接管理
├── config/            # Chain configuration and RPC presets
├── types/             # TypeScript type definitions
│   ├── events.ts      # 事件相关类型定义
│   └── abi.ts         # ABI类型定义
├── utils/             # Utility functions and helpers
├── components/        # React components (shared UI)
│   ├── events/        # 事件相关组件
│   │   ├── DynamicEventFilterForm.tsx
│   │   ├── EventTable.tsx
│   │   ├── EventChart.tsx
│   │   └── EventStatistics.tsx
│   └── forms/         # 动态表单组件
├── pages/            # Page components for routing
├── hooks/            # Custom React hooks
│   ├── useContractEvents.ts
│   └── useDynamicForm.ts
├── middleware/       # Server middleware (CORS, logging)
├── tests/            # Test files organized by type
└── api-app.ts        # Main API application with all endpoints (扩展)

tests/
├── unit/             # Unit tests for business logic
│   ├── services/     # 服务层单元测试
│   └── components/   # 组件单元测试
├── integration/      # Integration tests for database and API
│   ├── events/       # 事件API集成测试
│   └── database/     # 数据库集成测试
├── e2e/             # End-to-end tests for user journeys
│   └── events/       # 事件流程E2E测试
└── performance/     # Performance tests for response times
    └── events/       # 事件查询性能测试
```

**Structure Decision**: 选择Web application结构，完全符合现有的Block Explorer项目架构。该结构支持前后端分离，具有清晰的职责划分，便于团队协作和代码维护。

## Complexity Tracking

**无宪法违规**: 所有设计决策完全符合项目宪法要求，无需额外复杂度说明。

### 技术决策合理化

| 技术选择 | 选择原因 | 替代方案被拒绝的原因 |
|-----------|----------|----------------------|
| 动态表创建策略 | 支持任意合约ABI事件，查询性能最优，符合DuckDB列式存储优势 | 通用事件表设计：查询性能差，无法利用索引优化 |
| DuckDB-PostgreSQL适配器 | 项目现有基础设施，1-9ms响应时间保障，零配置要求 | 纯DuckDB：需要重写大量现有代码，增加复杂度 |
| Viem事件解码 | 成熟可靠，类型安全，与项目RPC管理兼容 | 自定义解码：开发成本高，容易出错 |
| React动态表单 | 类型安全，用户体验优秀，易于维护 | 硬编码表单：无法支持动态ABI，扩展性差 |

### 设计原则遵循

✅ **性能优先**: 所有设计确保1-9ms响应时间目标
✅ **TypeScript严格**: 完整类型定义，编译时错误检查
✅ **链无关服务**: 支持所有Viem链，无硬编码逻辑
✅ **数据库架构**: 使用DuckDB-PostgreSQL适配器，单文件数据库
✅ **测试覆盖**: 完整的单元/集成/E2E/性能测试策略
✅ **API标准**: RESTful设计，链特定端点，一致JSON响应
✅ **零配置**: 开箱即用，最小环境配置
