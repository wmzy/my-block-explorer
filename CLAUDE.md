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

This is a modern blockchain explorer with a data separation architecture: ephemeral/real-time data is fetched directly from RPC by the frontend, while persistent data (contracts, addresses, events) is cached in DuckDB via the backend.

### Data Separation Strategy

The core design principle: **ephemeral data goes direct to RPC, persistent data goes through the backend.**

**Frontend RPC Direct (via viem):**
- Block lists, block details — `src/utils/blockRpcData.ts`
- Transaction lists, transaction details — `src/utils/blockRpcData.ts`
- Address balances, nonces, latest block number — `src/utils/realTimeData.ts`
- Contract read/simulate calls — `src/utils/contractInteraction.ts`

**Backend API (Hono + DuckDB):**
- Contract source code, ABI, verification — cached in DB, fetched from Sourcify/explorers on first access
- Contract event indexing — historical logs stored in per-chain DuckDB files
- Address persistent metadata (isContract, creation info) — cached in DB
- Search — queries indexed data in DB
- Overview stats — hybrid mode: RPC for `latestBlockNumber`, DB for indexed counts

**Why this split:**
- Blocks and transactions are immutable but numerous; fetching the latest N from RPC is fast and avoids the "empty database" bootstrap problem
- Contract source/ABI rarely changes and benefits from caching
- Event logs require historical range queries that RPC rate-limits, so indexing is necessary

### Key Architecture Patterns

**Database Architecture:**
- **DuckDB-PostgreSQL Adapter**: Custom adapter in `src/database/duckdb-postgres-adapter.ts` allows Drizzle ORM to work with DuckDB using PostgreSQL syntax
- **Main DB**: `data/blockchain.db` — blocks, transactions, addresses, contracts (indexed on demand)
- **Per-Chain Event DBs**: `data/chains/{type}/{name}-{id}.db` — contract event tables

**Service Layer Architecture:**
- **Chain-Agnostic Services**: All services in `src/services/` are designed to work across multiple chains
- **RPC Manager**: Centralized RPC connection management with failover and configuration in `src/services/RpcManager.ts` (used by backend)
- **Frontend RPC Client**: `src/utils/realTimeData.ts` exports `createRpcClient()` with client caching, used by all frontend RPC utilities

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
│   ├── ui/            # Reusable UI primitives (Card, Badge, Button)
│   ├── events/        # Event-related components (EventTable, EventStatistics)
│   └── forms/         # Dynamic form components
├── pages/            # Page components for routing
├── hooks/            # Custom React hooks
├── middleware/       # Server middleware (CORS, logging)
├── tests/            # Test files organized by type
├── api/              # API client with service discovery
└── api-app.ts        # Main API application with all endpoints
```

### Key Files to Understand

**Core Architecture:**
- `src/database/duckdb-postgres-adapter.ts` - Custom DuckDB adapter for Drizzle ORM
- `src/services/RpcManager.ts` - Backend RPC connection management with failover
- `src/config/chains.ts` - Multi-chain configuration using Viem chains
- `src/api-app.ts` - Complete API endpoint definitions

**Frontend RPC Data Layer:**
- `src/utils/realTimeData.ts` - Shared `createRpcClient()` with caching + address real-time data (balance, nonce)
- `src/utils/blockRpcData.ts` - Block and transaction data fetched directly from RPC (getLatestBlocks, getBlockByNumber, getTransactionByHash, etc.)
- `src/hooks/useAddressData.ts` - Data separation hook: persistent from API, real-time from RPC

**Database Schema:**
- `src/database/schema.ts` - Drizzle schema definitions
- `drizzle.config.ts` - Drizzle Kit configuration (uses PostgreSQL dialect)

**Frontend Integration:**
- `src/api/client.ts` - API client for backend endpoints (contracts, search, stats)

**Pages (data source):**
- `src/pages/HomePage.tsx` - Chain overview (hybrid API: RPC + DB)
- `src/pages/BlocksListPage.tsx` - Block list (frontend RPC direct)
- `src/pages/TransactionsListPage.tsx` - Transaction list (frontend RPC direct)
- `src/pages/BlockPage.tsx` - Block detail (frontend RPC direct)
- `src/pages/TransactionPage.tsx` - Transaction detail (frontend RPC direct)
- `src/pages/AddressPage.tsx` - Address detail (RPC for balance + API for persistent)
- `src/pages/ContractPage.tsx` - Contract source, ABI, events (backend API)
- `src/pages/SearchPage.tsx` - Global search (backend API)
- `src/pages/NotFoundPage.tsx` - 404 error page

### Chain Support

The application supports all Viem chains out-of-the-box:
- **Popular Chains**: Ethereum, Polygon, BSC, Arbitrum, Base, Optimism
- **Chain Configuration**: Uses Viem's chain definitions for consistent RPC URLs, block explorers, and native currency
- **User RPC Configs**: Users can configure custom RPC endpoints stored in database

### Performance Optimizations

**Data Architecture:**
- Persistent contract information cached in DuckDB for 1-9ms response times
- Blocks and transactions fetched directly from RPC by the frontend — no backend indexing needed for browsing
- Address balances and nonces fetched directly from RPC by the frontend
- Backend indexing retained for search, contract events, and address metadata

**Caching Strategy:**
- DuckDB caching for contract source/ABI, address metadata, event logs
- Frontend viem client caching per chain in `createRpcClient()`
- Response headers indicate data source (`X-Data-Source`: `hybrid`, `database`, `rpc`)

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

**Backend API Endpoints (still available but no longer primary data source for blocks/transactions):**

Hybrid (RPC + DB):
- `/api/stats/overview` - Chain overview stats (RPC for latestBlockNumber, DB for indexed counts)

DB-backed (persistent data):
- `/api/chains/{chainId}/addresses/{address}/persistent` - Address persistent metadata
- `/api/chains/{chainId}/contracts/{address}/source` - Contract source code
- `/api/chains/{chainId}/contracts/{address}/abi` - Contract ABI
- `/api/chains/{chainId}/contracts/{address}/events` - Contract events
- `/api/search?q=` - Global search across indexed data

RPC-backed (via backend RpcManager):
- `/api/chains/{chainId}/contracts/{address}/read` - Read contract function
- `/api/chains/{chainId}/contracts/{address}/simulate` - Simulate transaction

On-demand indexing (DB miss → RPC fetch → write DB):
- `/api/chains/{chainId}/blocks/{blockNumber}` - Block data (retained for search/indexing)
- `/api/chains/{chainId}/transactions/{hash}` - Transaction data (retained for search/indexing)

**Frontend RPC Direct (no backend involved):**
- Block list browsing — `blockRpcData.getLatestBlocks()`
- Block detail — `blockRpcData.getBlockByNumber()`
- Transaction list — `blockRpcData.getLatestTransactions()`
- Transaction detail — `blockRpcData.getTransactionByHash()`
- Address balance/nonce — `realTimeData.getRealTimeAddressData()`

**Frontend Routes:**
- `/` - Redirects to `/chain/1`
- `/chain/:chainId` - Chain home page with overview
- `/chain/:chainId/blocks` - Block list
- `/chain/:chainId/transactions` - Transaction list
- `/chain/:chainId/block/:blockNumber` - Block detail
- `/chain/:chainId/tx/:txHash` - Transaction detail
- `/chain/:chainId/address/:address` - Address detail
- `/chain/:chainId/contract/:address` - Contract detail
- `/chain/:chainId/contract/:address/events` - Contract events
- `/search` - Search page
- `*` - 404 Not Found

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
