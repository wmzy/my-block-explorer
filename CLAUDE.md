# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `npm run dev` - Start both client and server in development mode
- `npm run dev:server` - Start server only on port 8201
- `npm run build` - Build both client and server for production
- `npm run build:client` - Build client only (includes SPA setup)
- `npm run build:server` - Build server only (TypeScript compilation)
- `npm start` - Start production server

### Testing
- `npm test` - Run all tests using Vitest
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- `npm run test:e2e` - Run end-to-end tests only
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

### Database Operations
- `npm run db:generate` - Generate database migrations (uses Drizzle Kit)
- `npm run db:migrate` - Apply database migrations
- `npm run db:push` - Push schema changes directly to database
- `npm run db:studio` - Open Drizzle Studio for database management
- `npm run migrate` - Run custom migration script

### Code Quality
- `npm run lint` - Run ESLint on TypeScript files
- `npm run format` - Format code with Prettier

## Architecture Overview

This is a modern blockchain explorer built with a unique DuckDB-PostgreSQL adapter architecture for extreme performance (1-9ms response times).

### Key Architecture Patterns

**Database Architecture:**
- **DuckDB-PostgreSQL Adapter**: Custom adapter in `src/database/duckdb-postgres-adapter.ts` allows Drizzle ORM to work with DuckDB using PostgreSQL syntax
- **Data Separation Strategy**: Persistent data (contracts, addresses) cached in database, real-time data (balances) fetched directly by frontend
- **Single Database File**: All chains stored in one DuckDB file at `data/blockchain.db` with chain_id as partition dimension

**Service Layer Architecture:**
- **Chain-Agnostic Services**: All services in `src/services/` are designed to work across multiple chains
- **RPC Manager**: Centralized RPC connection management with failover and configuration in `src/services/RpcManager.ts`
- **Performance-First Design**: 99%+ performance improvement through smart caching and on-demand indexing

**Frontend-Backend Split:**
- **Client**: React 19 + Vite 7 + Linaria CSS-in-JS, runs on port 3000
- **Server**: Hono framework + Node.js 22, runs on port 8201
- **API Design**: RESTful APIs with chain-specific endpoints `/api/chains/{chainId}/...`

### Directory Structure

```
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
```

### Key Files to Understand

**Core Architecture:**
- `src/database/duckdb-postgres-adapter.ts` - Custom DuckDB adapter for Drizzle ORM
- `src/services/RpcManager.ts` - RPC connection management with failover
- `src/config/chains.ts` - Multi-chain configuration using Viem chains
- `src/api-app.ts` - Complete API endpoint definitions

**Database Schema:**
- `src/database/schema.ts` - Drizzle schema definitions
- `drizzle.config.ts` - Drizzle Kit configuration (uses PostgreSQL dialect)

**Frontend Integration:**
- `src/hooks/useAutoDiscovery.ts` - Automatic server discovery
- `src/api/client.ts` - API client with service discovery

### Chain Support

The application supports all Viem chains out-of-the-box:
- **Popular Chains**: Ethereum, Polygon, BSC, Arbitrum, Base, Optimism
- **Chain Configuration**: Uses Viem's chain definitions for consistent RPC URLs, block explorers, and native currency
- **User RPC Configs**: Users can configure custom RPC endpoints stored in database

### Performance Optimizations

**Data Architecture:**
- Persistent contract information cached in DuckDB for 1-9ms response times
- Real-time data (balances, prices) fetched directly by frontend
- On-demand indexing - only indexes data users actually access

**Caching Strategy:**
- Database caching for static data (contract info, addresses)
- Frontend caching for real-time data
- Response headers indicate data source (`X-Data-Source`)

### Testing Strategy

**Test Organization:**
- Unit tests: `src/tests/unit/`
- Integration tests: `src/tests/integration/`
- E2E tests: `src/tests/e2e/`
- Performance tests: `src/tests/performance/`

**Test Configuration:**
- Uses Vitest with jsdom environment
- 30-second timeout for network requests
- Coverage reporting with v8 provider
- Path aliases configured (`@/` maps to `src/`)

### Database Migration Strategy

**Custom Migration Flow:**
1. Use Drizzle Kit for schema generation (`npm run db:generate`)
2. Apply migrations with custom adapter (`npm run db:migrate`)
3. Database studio available via Drizzle Studio (`npm run db:studio`)

**Schema Management:**
- PostgreSQL dialect used in Drizzle config for compatibility
- Custom adapter handles DuckDB translation
- Snake_case naming convention enforced

### API Design Patterns

**Chain-Specific Endpoints:**
- `/api/chains/{chainId}/blocks/{blockNumber}` - Block data
- `/api/chains/{chainId}/transactions/{hash}` - Transaction data
- `/api/chains/{chainId}/addresses/{address}` - Address data
- `/api/chains/{chainId}/contracts/{address}/...` - Contract interactions

**Response Format:**
- Consistent JSON responses with chain metadata
- Error handling with appropriate HTTP status codes
- Response headers indicate data source and chain name

### Development Notes

**Environment Setup:**
- Node.js 22+ required
- Uses pnpm as package manager (but npm works)
- TypeScript with strict mode enabled
- Path aliases configured (`@/` -> `src/`)

**Build Process:**
- Client: Vite build with SPA redirect setup
- Server: TypeScript compilation to `dist/server.js`
- Separate build targets allow independent deployment

**Multi-Chain Considerations:**
- All services must be chain-agnostic
- Use chainId parameter for chain-specific operations
- RPC configuration managed centrally
- User can configure custom RPC endpoints per chain