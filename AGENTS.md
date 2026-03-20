# Block Explorer - Project Knowledge Base

**Generated:** 2026-03-20 **Commit:** bd8270f **Branch:** 001-abi

## OVERVIEW

Multi-chain blockchain explorer with data separation architecture. Frontend
(React 19 + Vite 8 + Linaria) fetches ephemeral data directly from RPC via viem;
backend (Hono + Node 22) caches persistent data (contracts, events) in DuckDB
via custom PostgreSQL adapter for Drizzle ORM.

## STRUCTURE

```
block-explorer/
├── src/
│   ├── api-app.ts          # Hono API entry (all routes)
│   ├── server.ts           # Node server entry
│   ├── main.tsx            # React entry
│   ├── App.tsx             # React Router setup
│   ├── services/           # Business logic (chain-agnostic)
│   ├── database/           # DuckDB + custom adapter + schema
│   ├── utils/              # RPC data layer + formatting
│   ├── components/         # React components (ui/, events/, forms/)
│   ├── pages/              # Page components
│   ├── hooks/              # Custom hooks (data separation)
│   ├── routes/             # Hono route handlers
│   ├── config/             # Multi-chain configuration (viem chains)
│   └── types/              # TypeScript definitions
├── data/                   # DuckDB files (main + per-chain)
├── docs/                   # Architecture documentation
└── drizzle/                # Migration files
```

## WHERE TO LOOK

| Task                 | Location                                                                       | Notes                                     |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| Add new API endpoint | `src/routes/*.ts` → `src/api-app.ts`                                           | Register in api-app.ts                    |
| Modify DB schema     | `src/database/schema.ts`                                                       | Run `npm run db:generate`                 |
| Add new chain        | `src/config/chains.ts`                                                         | Viem chains auto-supported                |
| RPC client creation  | `src/utils/realTimeData.ts` (frontend), `src/services/RpcManager.ts` (backend) | Both cache per chainId                    |
| Event indexing       | `src/services/EventIndexingService.ts`                                         | Batch 2000 blocks, reorg handling         |
| Contract source/ABI  | `src/services/ContractSourceService.ts`                                        | Sourcify → Etherscan fallback             |
| UI components        | `src/components/ui/`                                                           | Haze UI wrappers + Linaria                |
| Address data hook    | `src/hooks/useAddressData.ts`                                                  | Hybrid: API (persistent) + RPC (realtime) |

## CODE MAP

| Symbol                | Type      | Location                                      | Role                                 |
| --------------------- | --------- | --------------------------------------------- | ------------------------------------ |
| `rpcManager`          | Singleton | `src/services/RpcManager.ts:218`              | Central RPC client manager           |
| `createDuckDBAdapter` | Function  | `src/database/duckdb-postgres-adapter.ts:430` | PostgreSQL→DuckDB bridge for Drizzle |
| `createRpcClient`     | Function  | `src/utils/realTimeData.ts:61`                | Frontend viem client factory         |
| `startIndexing`       | Function  | `src/services/EventIndexingService.ts:360`    | Event batch indexing entry           |
| `useAddressData`      | Hook      | `src/hooks/useAddressData.ts:44`              | Data separation hook                 |
| `apiClient`           | Class     | `src/api/client.ts:278`                       | Backend API client                   |
| `getChainInfo`        | Function  | `src/config/chains.ts:23`                     | Viem chain lookup                    |
| `honoApiPlugin`       | Plugin    | `vite.config.ts:8-66`                         | Vite→Hono bridge (dev only)          |

## CONVENTIONS

### TypeScript

- `type` over `interface` (per `.cursor/rules/code-standards.mdc`)
- Function components only (no class components)
- Path alias: `@/` → `src/`
- Strict mode enabled

### Naming

- Database: `snake_case` (Drizzle config)
- Components: PascalCase files, `export function Name()`
- Services: `*Service.ts` pattern

### ESLint Rules

- `no-explicit-any: 'error'` — No `any` type
- `prefer-nullish-coalescing: 'error'` — Use `??` not `||`
- `prefer-optional-chain: 'error'` — Use `?.`
- `no-console: ['warn', { allow: ['warn', 'error'] }]` — No `console.log`

### React

- Linaria `css` tag for styles, `cx()` for composition
- CSS variables from haze-ui theme (`--haze-*`)
- TanStack Query for server state

## ANTI-PATTERNS (THIS PROJECT)

- **No `as any` / `@ts-ignore`** — Strict typing enforced
- **No `console.log`** — Use `console.warn`/`console.error` or pino logger
- **No SERIAL type** — DuckDB incompatible; use composite primary keys
- **No Chinese comments** — English only (project standard)
- **Don't duplicate routes** — `src/api/event-endpoints.ts` and
  `src/routes/events.ts` overlap (known issue)

## UNIQUE STYLES

### Data Separation Architecture

```
Ephemeral (RPC direct):
├── Blocks, transactions
├── Address balance/nonce
└── Contract read/simulate

Persistent (Backend API → DuckDB):
├── Contract source/ABI
├── Contract events (indexed)
├── Address metadata
└── Search index
```

### Custom DuckDB-PostgreSQL Adapter

484-line adapter in `src/database/duckdb-postgres-adapter.ts` implements
`postgres` package interface so Drizzle ORM can use DuckDB. Handles type mapping
(BIGINT→string), error translation, transaction semantics.

### Per-Chain Event Databases

Events stored in separate DuckDB files: `data/chains/{type}/{name}-{id}.db`

### Vite-Hono Dev Bridge

Custom `honoApiPlugin()` in vite.config.ts runs Hono API inside Vite dev server
for unified dev experience.

## COMMANDS

```bash
# Development
npm run dev              # Start both (Vite on 3000, Hono in-process)
npm run dev:server       # Server only on 8201

# Build
npm run build            # Build client + server
npm run build:client     # Vite build + SPA _redirects
npm run build:server     # tsc compilation

# Database
npm run db:generate      # Generate migrations
npm run db:migrate       # Apply migrations
npm run db:studio        # Drizzle Studio

# Testing
npm test                 # Vitest all
npm run test:unit        # Unit tests
npm run test:integration # Integration tests

# Quality
npm run lint             # ESLint
npm run format           # Prettier
```

## NOTES

- **Node.js 22+ required** — Uses latest features
- **No CI/CD** — `.github/workflows` missing (known gap)
- **Test dirs duplicated** — `src/tests/`, `tests/`, `test/` all exist
  (consolidation needed)
- **Barrel exports incomplete** — `src/utils/index.ts` only exports 2 of 19
  utils
- **Proxy port 7890** — Set `HTTP_PROXY`/`HTTPS_PROXY` if network issues
