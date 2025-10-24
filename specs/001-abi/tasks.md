---
description: "Task list for contract event indexing and querying feature implementation"
---

# Tasks: 合约事件索引与查询

**Input**: Design documents from `/specs/001-abi/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included based on 80% coverage requirement in FR-007 and performance testing requirements in success criteria

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions
- **Web app structure**: `src/` at repository root with separate frontend/backend organization
- **Database layer**: `src/database/`
- **Services**: `src/services/`
- **Types**: `src/types/`
- **Components**: `src/components/`
- **API**: `src/api-app.ts`
- **Tests**: `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/performance/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and multi-chain database architecture setup

- [X] T001 Create multi-chain database directory structure in `data/chains/`
- [X] T002 Initialize TypeScript project dependencies (React 19, Hono, DuckDB adapter, Viem 2.34+)
- [X] T003 [P] Configure ESLint and Prettier with strict TypeScript rules
- [X] T004 [P] Set up Vitest testing environment with jsdom and v8 coverage provider

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core multi-chain infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Implement `ChainDatabaseManager` class in `src/database/chain-database-manager.ts` for per-chain database isolation
- [ ] T006 [P] Implement `ChainSchemaManager` class in `src/database/chain-schema-manager.ts` with chain-specific table definitions (no chain_id fields)
- [ ] T007 [P] Implement `ChainEventTableManager` class in `src/database/chain-event-table-manager.ts` for dynamic event table creation
- [ ] T008 [P] Create multi-chain type definitions in `src/types/events.ts` with ABI mapping and event types
- [ ] T009 [P] Setup chain configuration in `src/config/chains.ts` for chain type detection and database path generation
- [ ] T010 Configure performance monitoring infrastructure with 1-9ms response time tracking
- [ ] T011 [P] Setup zero-configuration environment with automatic chain database discovery

**Checkpoint**: Multi-chain foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 事件发现与浏览 (Priority: P1) 🎯 MVP

**Goal**: Enable users to browse all events from verified contracts with basic event display and indexing progress indicators

**Independent Test**: Navigate to a verified contract page, view events tab, see chronological event list with event names, timestamps, transaction hashes, and parameters. Test with no events, partial indexing, and completed indexing scenarios.

### Tests for User Story 1 ⚠️

**NOTE**: Write these tests FIRST, ensure they FAIL before implementation

- [ ] T012 [P] [US1] Unit test for `ChainEventTableManager` table creation in `tests/unit/services/chain-event-table-manager.test.ts`
- [ ] T013 [P] [US1] Integration test for event indexing status endpoint in `tests/integration/events/indexing-status.test.ts`
- [ ] T014 [P] [US1] Performance test for event list query response times in `tests/performance/events/event-query.test.ts`
- [ ] T015 [P] [US1] E2E test for contract events page navigation in `tests/e2e/events/contract-events-page.test.ts`

### Implementation for User Story 1

- [ ] T016 [P] [US1] Create event table registry schema in `src/database/chain-schema-manager.ts` (extends T006)
- [ ] T017 [US1] Implement `EventIndexingService` class in `src/services/EventIndexingService.ts` for contract event indexing (depends on T005, T008)
- [ ] T018 [US1] Implement `EventQueryService` class in `src/services/EventQueryService.ts` for basic event queries (depends on T007)
- [ ] T019 [US1] Add indexing status endpoint `/api/chains/{chainId}/contracts/{contractAddress}/events/indexing-status` in `src/api-app.ts`
- [ ] T020 [US1] Add basic events query endpoint `/api/chains/{chainId}/contracts/{contractAddress}/events` in `src/api-app.ts`
- [ ] T021 [US1] Create `EventTable` component in `src/components/events/EventTable.tsx` for displaying event lists
- [ ] T022 [US1] Create `EventStatistics` component in `src/components/events/EventStatistics.tsx` for indexing progress display
- [ ] T023 [US1] Add event decoding logic using Viem in `src/services/EventDecodingService.ts` (depends on T008)
- [ ] T024 [US1] Implement ABI parsing and event signature extraction in `src/services/EventDecodingService.ts`
- [ ] T025 [US1] Add TypeScript validation and error handling with strict types for all event operations
- [ ] T026 [US1] Ensure implementation meets 1-9ms response time requirements for cached event data

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 事件过滤与搜索 (Priority: P1)

**Goal**: Enable users to filter events by type, date range, and specific parameter values with multiple filter support

**Independent Test**: Apply various filters (event type, date range, parameter values) to contract events and verify results match all applied filter criteria simultaneously

### Tests for User Story 2 ⚠️

- [ ] T027 [P] [US2] Unit test for event filtering logic in `tests/unit/services/event-query-service.test.ts`
- [ ] T028 [P] [US2] Integration test for advanced search endpoint in `tests/integration/events/advanced-search.test.ts`
- [ ] T029 [P] [US2] Performance test for filtered query response times in `tests/performance/events/filtering.test.ts`

### Implementation for User Story 2

- [ ] T030 [P] [US2] Create dynamic form generation logic in `src/components/forms/DynamicFormGenerator.tsx` (depends on T008)
- [ ] T031 [US2] Implement `EventDecodingService` parameter type mapping in `src/services/EventDecodingService.ts` (extends T023)
- [ ] T032 [US2] Create `DynamicEventFilterForm` component in `src/components/events/DynamicEventFilterForm.tsx` for ABI-based filter forms
- [ ] T033 [US2] Add advanced search endpoint `/api/chains/{chainId}/contracts/{contractAddress}/events/search` in `src/api-app.ts`
- [ ] T034 [US2] Extend `EventQueryService` with complex filtering capabilities in `src/services/EventQueryService.ts` (extends T018)
- [ ] T035 [US2] Implement form validation and type conversion for different Solidity types in `src/utils/form-validation.ts`
- [ ] T036 [US2] Add parameter-based indexing for filtered event queries in `src/database/chain-event-table-manager.ts` (extends T007)
- [ ] T037 [US2] Integrate with User Story 1 components for seamless filtering experience

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 事件排序与分页 (Priority: P2)

**Goal**: Enable users to sort events by different criteria and navigate through large event sets with pagination controls

**Independent Test**: Apply different sort orders (timestamp, block number) and navigate through multiple pages, verifying correct subset display and maintained filter/sort state

### Tests for User Story 3 ⚠️

- [ ] T038 [P] [US3] Unit test for pagination logic in `tests/unit/services/event-query-service.test.ts`
- [ ] T039 [P] [US3] Integration test for sorting and pagination endpoints in `tests/integration/events/pagination.test.ts`
- [ ] T040 [P] [US3] Performance test for large dataset pagination in `tests/performance/events/pagination.test.ts`

### Implementation for User Story 3

- [ ] T041 [P] [US3] Extend `EventQueryService` with sorting and pagination logic in `src/services/EventQueryService.ts` (extends T018, T034)
- [ ] T042 [US3] Add cursor-based pagination support in `src/services/EventQueryService.ts`
- [ ] T043 [US3] Create pagination controls component in `src/components/ui/Pagination.tsx`
- [ ] T044 [US3] Enhance `EventTable` component with sorting controls and pagination integration in `src/components/events/EventTable.tsx` (extends T021)
- [ ] T045 [US3] Add sorting query parameters (sort, sortBy) to event endpoints in `src/api-app.ts`
- [ ] T046 [US3] Implement efficient database indexes for sorting fields in `src/database/chain-event-table-manager.ts` (extends T007)
- [ ] T047 [US3] Add query optimization for large event sets in `src/services/EventQueryService.ts`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - 实时事件更新 (Priority: P3)

**Goal**: Enable real-time event updates when new events are emitted without manual refresh, with filter and sort preservation

**Independent Test**: Monitor contract while new transactions process, verify new events appear automatically in filtered results with maintained sort order

### Tests for User Story 4 ⚠️

- [ ] T048 [P] [US4] Unit test for real-time event streaming in `tests/unit/services/realtime-events.test.ts`
- [ ] T049 [P] [US4] Integration test for WebSocket event updates in `tests/integration/events/realtime-updates.test.ts`
- [ ] T050 [P] [US4] E2E test for real-time event display in `tests/e2e/events/realtime-events.test.ts`

### Implementation for User Story 4

- [ ] T051 [P] [US4] Create real-time event monitoring service in `src/services/RealtimeEventService.ts`
- [ ] T052 [US4] Implement WebSocket connection management for event updates in `src/services/RealtimeEventService.ts`
- [ ] T053 [US4] Add block reorganization detection and handling in `src/services/ReorgDetectionService.ts`
- [ ] T054 [US4] Create real-time event hooks in `src/hooks/useRealtimeEvents.ts`
- [ ] T055 [US4] Enhance `EventTable` component with real-time updates in `src/components/events/EventTable.tsx` (extends T021, T044)
- [ ] T056 [US4] Add event subscription endpoints in `src/api-app.ts` for WebSocket connections
- [ ] T057 [US4] Implement client-side state management for real-time updates in `src/components/events/EventTable.tsx`
- [ ] T058 [US4] Add user notification system for reorg-related data changes in `src/components/ui/Notifications.tsx`

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T059 [P] Update documentation in `docs/api/events.md` with complete API reference
- [ ] T060 [P] Code cleanup and refactoring across all event services
- [ ] T061 Performance optimization across all event queries with caching strategies
- [ ] T062 [P] Additional unit tests for edge cases in `tests/unit/services/`
- [ ] T063 [P] Security hardening for event data access and validation
- [ ] T064 [P] Run quickstart.md validation for complete feature functionality
- [ ] T065 [P] Add comprehensive error handling and user-friendly error messages
- [ ] T066 [P] Implement data retention policies and cleanup routines in `src/services/DataRetentionService.ts`
- [ ] T067 [P] Add monitoring and alerting for indexing performance and errors
- [ ] T068 [P] Create developer documentation for extending event indexing to new contract types

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phases 3-6)**: All depend on Foundational phase completion
  - User stories can proceed in priority order (P1 → P2 → P3 → P4)
  - P1 and P2 can be worked on in parallel by different team members
  - P3 and P4 can follow once P1/P2 foundations are stable
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Integrates with US1 components but independently testable
- **User Story 3 (P2)**: Can start after User Story 1 basic functionality is stable - Builds on US1/US2 components
- **User Story 4 (P3)**: Can start after User Story 1 query functionality is stable - Extends all previous stories

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Core services before UI components
- Database layer before business logic
- Basic functionality before advanced features
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Phase 2 completes, User Stories 1 and 2 can start in parallel
- All tests for a user story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members
- Polish tasks can run in parallel once user stories are complete

---

## Parallel Example: User Story 1 & 2

```bash
# Launch User Story 1 tests together:
Task: "Unit test for ChainEventTableManager table creation in tests/unit/services/chain-event-table-manager.test.ts"
Task: "Integration test for event indexing status endpoint in tests/integration/events/indexing-status.test.ts"
Task: "Performance test for event list query response times in tests/performance/events/event-query.test.ts"

# Launch User Story 2 tests together:
Task: "Unit test for event filtering logic in tests/unit/services/event-query-service.test.ts"
Task: "Integration test for advanced search endpoint in tests/integration/events/advanced-search.test.ts"

# Parallel development by different team members:
# Developer A: User Story 1 (T016-T026)
# Developer B: User Story 2 (T030-T037)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo basic event browsing functionality

### Incremental Delivery

1. Complete Setup + Foundational → Multi-chain database architecture ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (filtering)
4. Add User Story 3 → Test independently → Deploy/Demo (pagination)
5. Add User Story 4 → Test independently → Deploy/Demo (real-time)
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (core browsing)
   - Developer B: User Story 2 (filtering)
   - Developer C: User Story 3 (pagination/sorting)
3. Stories complete and integrate independently
4. Developer A/B/C collaborate on User Story 4 (real-time)

---

## Success Criteria Validation

Each user story must meet these measurable outcomes before completion:

**User Story 1**:
- Users can view contract events within 1-9ms for cached data (SC-001)
- Frontend provides intuitive browsing interface within 3 clicks (SC-008)
- Event data is accurately parsed and displayed for 99.9% of standard ABI event types (SC-004)

**User Story 2**:
- Event filtering operations complete within 500ms (SC-002)
- Users can successfully filter events using multiple criteria simultaneously (SC-005)
- Partial data is available for viewing within 5 seconds of indexing start (SC-014)

**User Story 3**:
- Pagination allows users to navigate through 1M+ events efficiently (SC-006)
- Sorting operations maintain sub-200ms p95 response times
- Users can distinguish between complete and incomplete data at a glance (SC-015)

**User Story 4**:
- Users are notified of reorg-related data changes within 60 seconds (SC-011)
- Indexing progress indicators update in real-time with <1 second latency (SC-012)
- Real-time updates maintain current sort order (per acceptance scenario)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Multi-chain architecture ensures data isolation and performance optimization
- TypeScript strict mode enforced throughout implementation
- Performance monitoring integrated for all operations
- Zero-configuration deployment maintained across all features