<!--
Sync Impact Report:
- Version change: 1.0.0
- List of modified principles: None (initial constitution)
- Added sections: Core Principles (7 principles), Architecture Requirements, Development Standards, Governance
- Removed sections: None
- Templates requiring updates: plan.md (✅ updated), spec-template.md (✅ updated), tasks-template.md (✅ updated), checklist-template.md (✅ updated)
- Follow-up TODOs: None
-->

# Block Explorer Constitution

## Core Principles

### I. Performance-First Architecture

Every design decision MUST prioritize response times under 10ms for cached data;
Smart caching with DuckDB-PostgreSQL adapter is mandatory; Data separation
strategy: persistent data cached, real-time data fetched directly; On-demand
indexing to minimize storage costs; All performance optimizations must be
measurable.

### II. Chain-Agnostic Services

All services MUST work across multiple blockchain networks without code changes;
Use chainId parameter for chain-specific operations; No hardcoded chain logic in
service layer; RPC configuration managed centrally through RpcManager; Services
must be independently testable across different chains.

### III. TypeScript Strict Mode

All code MUST use TypeScript with strict mode enabled; No implicit any types
allowed; Type safety extends to database schema with Drizzle ORM; All API
responses must be typed; Type definitions must be shared between frontend and
backend; Build process must fail on type errors.

### IV. Test Coverage Requirements

Unit tests mandatory for all business logic; Integration tests required for
database operations and API endpoints; E2E tests for critical user journeys;
Performance tests to verify response time requirements; Minimum coverage
threshold of 80%; Tests must be written before implementation when possible.

### V. API Design Standards

RESTful APIs with consistent chain-specific endpoints; Standardized JSON
responses with chain metadata; Proper HTTP status codes and error handling;
Response headers indicate data source and chain information; API versioning must
be maintained; All endpoints must be documented with examples.

### VI. Database Architecture Rules

DuckDB-PostgreSQL adapter is the ONLY database abstraction layer; Single
database file with chain_id as partition dimension; Snake_case naming convention
enforced; Schema migrations must be backward compatible; Database operations
must be transactional; All queries must be optimized for DuckDB performance
characteristics.

### VII. Zero Configuration Deployment

Frontend MUST auto-discover local server without manual configuration;
Environment variables kept to minimum with sensible defaults; Application must
work out-of-the-box after npm install; Development and production environments
must be identical except for configuration; No external dependencies required
for basic functionality.

## Architecture Requirements

### Technology Stack

- **Frontend**: React 19 + Vite 7 + Linaria CSS-in-JS + TypeScript 5.9+
- **Backend**: Hono framework + Node.js 22 + DuckDB via custom adapter
- **Database**: DuckDB with PostgreSQL-compatible adapter through Drizzle ORM
- **Blockchain**: Viem 2.34+ for multi-chain support
- **Testing**: Vitest with jsdom environment and v8 coverage provider

### Performance Standards

- Cached data response times: 1-9ms maximum
- Database queries: Must use indexed columns
- Frontend bundle size: Optimized with code splitting
- Memory usage: Efficient DuckDB operations with proper connection management
- Caching strategy: Multi-layer with appropriate TTL values

### Multi-Chain Support

Support all Viem chains out-of-the-box; Chain configuration centralized; User
RPC endpoints stored in database; Chain-agnostic service design; Consistent API
patterns across all chains; Proper error handling for chain-specific failures.

## Development Standards

### Code Organization

Services in `src/services/` must be chain-agnostic; Database layer isolated with
custom adapter; Shared types in `src/types/`; Utility functions in `src/utils/`;
React components in `src/components/`; API endpoints consolidated in
`src/api-app.ts`; Tests organized by type (unit, integration, e2e, performance).

### Development Workflow

Use `npm run dev` for full-stack development; Separate build targets for client
and server; Database migrations through custom Drizzle adapter; Linting and
formatting enforced via pre-commit hooks; All PRs must pass test coverage
requirements; Performance benchmarks required for API changes.

### Quality Gates

TypeScript compilation must pass with zero errors; All tests must pass before
merge; Code coverage minimum 80%; Performance benchmarks must meet 1-9ms
targets; Security review for database operations; Documentation updates required
for API changes.

## Governance

This constitution supersedes all other project practices and guidelines. All
code reviews must verify compliance with these principles. Amendments require
unanimous team approval and migration plan for existing code. Complex
architectural decisions must be justified against these principles. Use
CLAUDE.md for runtime development guidance that aligns with this constitution.

**Version**: 1.0.0 | **Ratified**: 2025-01-14 | **Last Amended**: 2025-01-14
