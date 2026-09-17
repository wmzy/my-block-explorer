# Block Explorer - Project Knowledge Base

**Generated:** 2026-09-17 **Commit:** bd8270f **Branch:** 001-abi

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
│   ├── index.tsx           # React entry (tokens.css + theme.css, service-discovery gate)
│   ├── views/              # Route-table + views (native-router, flat routing)
│   │   └── index.tsx       # createRoutes table, AppPaths, HistoryRouter App
│   ├── services/           # Backend services (*Service.ts) + FRONTEND data services
│   │   ├── blocks.ts etc.  # fetch fns + createQueryCache hooks (frontend)
│   │   └── dataloaders.ts  # createDataLoader triplets (immutable routes)
│   ├── database/           # DuckDB + custom adapter + schema
│   ├── utils/              # RPC data layer + formatting (backend+shared)
│   ├── util/               # Frontend infra: http.ts (fetch-fun), apiBase.ts,
│   │                       # useQuery.ts (query layer), loaderCache.ts, dataLoader.ts
│   ├── components/         # React components (ui/, events/, forms/)
│   ├── hooks/              # Service discovery, useStorageAt (query hooks live in services/)
│   ├── routes/             # Hono route handlers
│   ├── config/             # Multi-chain configuration (viem chains)
│   └── types/              # TypeScript definitions
├── data/                   # DuckDB files (main + per-chain)
├── docs/                   # Architecture documentation
└── drizzle/                # Migration files
```

## WHERE TO LOOK

| Task                 | Location                                                                        | Notes                                               |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| Add new API endpoint | `src/routes/*.ts` → `src/api-app.ts`                                            | Register in api-app.ts                              |
| Modify DB schema     | `src/database/schema.ts`                                                        | Run `npm run db:generate`                           |
| Add new chain        | `src/config/chains.ts`                                                          | Viem chains auto-supported                          |
| RPC client creation  | `src/utils/realTimeData.ts` (frontend), `src/services/RpcManager.ts` (backend)  | Both cache per chainId                              |
| Event indexing       | `src/services/EventIndexingService.ts`                                           | Manual range-based; one serial job per range (no global queue); `reconcileInterruptedRanges()` runs at startup |
| Contract source/ABI  | `src/services/ContractSourceService.ts`                                         | DB → Sourcify/Etherspan fallback, immutable         |
| Storage layout       | `src/services/StorageLayoutService.ts`                                          | DB → storage-layout-fetcher, immutable              |
| UI components        | `src/components/ui/`                                                            | Haze UI wrappers + Linaria                          |
| Frontend data hooks  | `src/services/{blocks,transactions,addresses,contracts,search,stats}.ts`         | react-toolroom query layer (`src/util/useQuery.ts`) |
| Address realtime     | `src/services/addressRealTime.ts` + `services/addresses.ts`                     | RPC channel + persistent channel composed in view   |
| HTTP layer           | `src/util/http.ts` (fetch-fun) + `src/util/apiBase.ts`                          | Runtime-discovered API base URL                     |

## CODE MAP

| Symbol                 | Type      | Location                                      | Role                                        |
| ---------------------- | --------- | --------------------------------------------- | ------------------------------------------- |
| `rpcManager`           | Singleton | `src/services/RpcManager.ts:218`              | Central RPC client manager                  |
| `createDuckDBAdapter`  | Function  | `src/database/duckdb-postgres-adapter.ts:430` | PostgreSQL→DuckDB bridge for Drizzle        |
| `createRpcClient`      | Function  | `src/utils/realTimeData.ts:61`                | Frontend viem client factory                |
| `startIndexingRange`   | Function  | `src/services/EventIndexingService.ts`        | Range-based batch indexing entry; serial per-range job |
| `SegmentedProgressBar` | Component | `src/components/ui/SegmentedProgressBar.tsx`  | Segmented progress bar UI                   |
| `useAddressData`→split | Hook | `src/services/{addresses,addressRealTime}.ts` | Replaced by two query hooks composed in `views/Address` |
| `http` get/post/put/del | Module | `src/util/http.ts` | fetch-fun chain; base from `util/apiBase.ts` |
| `routes`/`AppPaths` | Table | `src/views/index.tsx` | native-router flat route table + typed links |
| `getChainInfo`         | Function  | `src/config/chains.ts:23`                     | Viem chain lookup                           |
| `honoApiPlugin`        | Plugin    | `vite.config.ts:8-66`                         | Vite→Hono bridge (dev only)                 |
| `ChainSchemaManager`   | Class     | `src/database/chain-schema-manager.ts`        | Dynamic event table SQL via drizzle-kit/api |

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
- CSS variables from haze-ui theme (`--haze-*`); tokens via `haze-ui/css/tokens.css`
  + `src/theme.css` at entry; component CSS auto-injected by `vite-plugin-haze-ui`
  (**never alias named haze-ui imports** — `{ Button as B }` breaks the plugin's scan)
- Routing: `@native-router/react` — flat `createRoutes` table in `src/views/index.tsx`,
  `TypedLink<AppPaths>` for links, `useMatched()` for params, `useSearch(schema)` for query
- Server state: `react-toolroom/async` via `src/util/useQuery.ts` (`createQueryCache` +
  `bindQueryFn` + `createQueryHook`); hooks return `{data, loading, error}`; polling via
  `src/services/polledQuery.ts`; **no TanStack Query, no React Router**
- HTTP: `src/util/http.ts` (fetch-fun) — API base resolved at runtime from
  `src/util/apiBase.ts` (service-discovery gate at entry)

## ANTI-PATTERNS (THIS PROJECT)

- **No `as any` / `@ts-ignore`** — Strict typing enforced
- **No `console.log`** — Use `console.warn`/`console.error` or pino logger
- **No SERIAL type** — DuckDB incompatible; use composite primary keys
- **No Chinese comments** — English only (project standard)

## UNIQUE STYLES

### Data Separation Architecture

```
Ephemeral (RPC direct):
├── Blocks, transactions
├── Address balance/nonce
└── Contract read/simulate

Persistent (Backend API → DuckDB):
├── Contract source/ABI (immutable)
├── Contract events (indexed)
├── Address metadata
├── Storage layout (immutable)
└── Search index
```

### Immutable Data Caching Strategy

Contract source/ABI and storage layout are **immutable** — they never change
after compilation. Cached data is valid forever; no refresh needed.

```
Request → DB lookup → Found: return immediately
                      Not found: fetch from external API → save to DB → return
```

- Contract source: `ContractSourceService.getContractSource()` — DB → Sourcify →
  Etherscan
- Storage layout: `StorageLayoutService.getStorageLayout()` — DB →
  storage-layout-fetcher

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
# This repo uses pnpm (npm breaks on the pnpm node_modules layout)

# Development
pnpm dev                 # Vite dev server on 3000 (Hono API bridged in-process)
pnpm dev:server          # Server only on 8201

# Build
pnpm build               # Build client + server
pnpm build:client        # Vite build + SPA _redirects
pnpm build:server        # tsup compilation

# Database
pnpm db:generate         # Generate migrations
pnpm db:migrate          # Apply migrations
pnpm db:studio           # Drizzle Studio

# Testing
pnpm test                # Vitest all
pnpm test:unit           # Unit tests
pnpm test:integration    # Integration tests

# Quality
pnpm lint                # ESLint
pnpm format              # Prettier
pnpm typecheck           # tsc --noEmit
```

## NOTES

- **Node.js 22+ required** — Uses latest features
- **No CI/CD** — `.github/workflows` missing (known gap)
- **Test layout** — `tests/` (unit + integration + e2e) is the live suite;
  historical `src/tests/` / `test/` dirs no longer exist
- **Barrel exports incomplete** — `src/utils/index.ts` only exports 2 of 19
  utils
- **Proxy port 7890** — Set `HTTP_PROXY`/`HTTPS_PROXY` if network issues
- **Admin auth** — `ADMIN_TOKEN` (env) gates admin endpoints via
  `src/middleware/admin-token.ts` + `x-admin-token` header (timing-safe
  compare, **fail closed** when unset). Gated surface: rpc-config
  GET/POST/DELETE (`/api/rpc-configs`), contract source cache clear
  (`POST .../contracts/:address/clear-cache`), storage-layout cache clear
  (`DELETE .../contracts/:address/storage-layout/cache`), and all
  `/api/performance/*`. Browser side: token stored in localStorage by
  `src/util/adminAuth.ts`, injected by `util/http.ts`; ⚙️ RPC modal has the
  "Admin token (stored in this browser)" field. `ENABLE_DEBUG_API=1` mounts
  `/debug/db/query` (raw SQL; default off, never enable in production)
- **Cache TTLs (persistent fetch caches)** — verified contract source 30d;
  proxy 24h; unverified source 3d; creation-lookup failure 24h;
  storage-layout `NOT_FOUND` 24h (`ContractSourceService`,
  `StorageLayoutService`)
- **Event indexing start is async** — `POST .../events/ranges/:id/start|resume`
  returns `202` immediately; progress via `GET .../events/ranges` polling
  (frontend polls 3s). One serial job per range — there is no global queue
  (the former queue service was removed). On startup `reconcileInterruptedRanges()`
  flips ranges stuck in `indexing` to `error` with
  "Interrupted by server restart — resume to continue". `argFilters`/`topicN`
  push decoded-arg filtering into DuckDB; `GET .../events/export` streams CSV
  (100k-row cap → 400; the UI disables the export button preflight when the
  filtered total exceeds the cap). Event statistics render "Indexing
  coverage" — union of ranges, overlap-safe sweep-merge
- **Address tx history is heuristic** — balance-change binary search; the
  transactions endpoint reports `coverage`/`reason`/`searchWindowBlocks`
  and the UI renders honest partial-data banners ("source unknown" when
  coverage is unknown). Never present it as complete history. The address
  API no longer returns balance/transactionCount — the UI reads those live
  from RPC (`services/addressRealTime.ts`)
- **Search degradation is explicit** — responses can carry
  `degraded`/`degradedReasons`; the UI offers retry instead of "no results".
  ENS names resolve client-side against a mainnet RPC (server returns
  suggestions only). `search_history` ids are int32-safe (epoch-seconds
  scheme, `SearchService`)
- **Custom ABI** — unverified contracts accept a pasted ABI
  (sessionStorage `custom-abi:{chainId}:{address}`) that unlocks
  Events/Interact tabs locally
