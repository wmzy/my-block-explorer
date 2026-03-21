# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See
`.specify/templates/commands/plan.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from
research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9+ (Frontend), Node.js 22 (Backend) **Primary
Dependencies**: React 19, Hono framework, DuckDB via custom adapter, Drizzle
ORM, Viem 2.34+ **Storage**: DuckDB with PostgreSQL-compatible adapter through
Drizzle ORM **Testing**: Vitest with jsdom environment and v8 coverage provider
**Target Platform**: Web application (client + server) **Project Type**: Web
application with separate frontend/backend build targets **Performance Goals**:
1-9ms response times for cached data, 80%+ test coverage, sub-200ms p95
**Constraints**: TypeScript strict mode, chain-agnostic services, zero
configuration deployment **Scale/Scope**: Multi-chain blockchain explorer
supporting all Viem chains

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

[Gates determined based on constitution file]

**Performance-First Architecture**: Must demonstrate 1-9ms response times for
cached data **TypeScript Strict Mode**: Zero type errors, no implicit any types
**Chain-Agnostic Services**: Services must work across multiple chains without
code changes **Database Architecture Rules**: Must use DuckDB-PostgreSQL
adapter, single database file **Test Coverage Requirements**: Minimum 80%
coverage with unit/integration/e2e/performance tests **API Design Standards**:
RESTful with chain-specific endpoints and consistent JSON responses **Zero
Configuration Deployment**: Application must work out-of-the-box after npm
install

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
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# Option 2: Web application (Block Explorer structure)
src/
├── database/           # Database layer with custom DuckDB adapter
├── services/           # Business logic layer (chain-agnostic)
├── config/            # Chain configuration and RPC presets
├── types/             # TypeScript type definitions
├── utils/             # Utility functions and helpers
├── components/        # React components (shared UI)
├── pages/            # Page components for routing
├── hooks/            # Custom React hooks
├── middleware/       # Server middleware (CORS, logging)
├── tests/            # Test files organized by type
└── api-app.ts        # Main API application with all endpoints

tests/
├── unit/             # Unit tests for business logic
├── integration/      # Integration tests for database and API
├── e2e/             # End-to-end tests for user journeys
└── performance/     # Performance tests for response times

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |
