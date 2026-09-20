# Block Explorer - Project Knowledge Base

**Generated:** 2026-09-19 (updated after the product-review fix wave) **Branch:** 001-abi

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
│   │   ├── ens.ts          # ENS reverse-resolution hook (mainnet-pinned, frontend)
│   │   └── dataloaders.ts  # createDataLoader triplets (immutable routes)
│   ├── database/           # DuckDB + custom adapter + schema
│   ├── utils/              # RPC data layer + formatting (backend+shared)
│   ├── util/               # Frontend infra: http.ts (fetch-fun), apiBase.ts,
│   │                       # useQuery.ts (query layer), loaderCache.ts, dataLoader.ts
│   ├── components/         # React components (ui/, events/, forms/)
│   ├── hooks/              # Service discovery, useStorageAt (query hooks live in services/)
│   ├── routes/             # Hono route handlers
│   ├── middleware/         # Hono middleware: admin-token.ts (requireAdminToken strict /
│   │                       # requireAdminTokenIfConfigured opt-in), cors.ts +
│   │                       # cors-origins.ts (origin allowlist shared with vite.config.ts)
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
| Admin gating / CORS  | `src/middleware/admin-token.ts`, `src/middleware/cors-origins.ts`               | Two-tier ADMIN_TOKEN gate; shared origin allowlist  |
| ENS reverse lookup   | `src/services/ens.ts`                                                           | `useEnsName()` — mainnet-pinned, browser-side, reverse+forward roundtrip verified (spoofed reverse records render as no name) |
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
- **Service discovery degrades, never blocks** — `useAutoDiscovery` probes
  8201–8205 in parallel (~1.5s budget); on total failure the app still
  renders (RPC-only data works) behind a dismissible "Backend not found"
  banner with the setup panel (npx instructions + manual URL). While no
  base is set, `util/http.ts` helpers reject fast with a clear ApiError
  instead of issuing same-origin requests (which would hit the vite dev
  bridge = a second DuckDB-writer instance)
- **No CI/CD** — `.github/workflows` missing (known gap)
- **Test layout** — `tests/` (unit + integration + e2e) is the live suite;
  historical `src/tests/` / `test/` dirs no longer exist
- **Barrel exports incomplete** — `src/utils/index.ts` only exports 2 of 19
  utils
- **Proxy port 7890** — Set `HTTP_PROXY`/`HTTPS_PROXY` if network issues
- **Admin auth is two-tier** (`src/middleware/admin-token.ts`, `x-admin-token`
  header, timing-safe compare). Strict tier (`requireAdminToken`, **fail
  closed** when `ADMIN_TOKEN` unset): all of `/api/performance/*` (and the
  debug API below carries no gate at all). Opt-in tier
  (`requireAdminTokenIfConfigured`): passes
  when `ADMIN_TOKEN` is unset (zero-config local works), enforces identically
  to the strict tier when it is set — covers the 7 mutating event-range
  routes (`POST/PATCH/DELETE .../events/ranges*`, `quick`, `start`/`pause`/
  `resume`), rpc-config writes (`POST`/`DELETE /api/rpc-configs`), and the
  two cache clears (`POST .../contracts/:address/clear-cache`,
  `DELETE .../contracts/:address/storage-layout/cache` — clearing DuckDB
  caches is non-destructive, immutable rows refetch on demand).
  `GET /api/rpc-configs` is open but redacts endpoint URLs to scheme+host
  for any origin the CORS policy doesn't trust (custom endpoints may embed
  API keys; loopback/allowlisted/no-Origin readers get full URLs). Browser side:
  token stored in localStorage by `src/util/adminAuth.ts`, injected by
  `util/http.ts`; ⚙️ RPC modal has the "Admin token (stored in this browser)"
  field. `ENABLE_DEBUG_API=1` mounts `/debug/db/query` (raw SQL; default
  off, never enable in production)
- **CORS is an origin allowlist, not `*`** — `src/middleware/cors-origins.ts`
  (dependency-free by design): loopback origins (any port) always allowed,
  extras from `CORS_ALLOWED_ORIGINS` (comma-separated) + `FRONTEND_URL`;
  no-Origin requests get no CORS headers. The Vite dev server's `server.cors`
  consumes the same module (imported RELATIVELY in vite.config.ts — keep it
  import-free or esbuild's config bundling breaks the dev server)
- **Cache TTLs (persistent fetch caches)** — verified contract source 30d;
  verified-proxy 24h; unverified/partial source 1h (incl. unverified proxies
  — unverified beats the proxy tier); creation-lookup failure 24h;
  storage-layout `NOT_FOUND` 24h (`ContractSourceService`,
  `StorageLayoutService`)
- **Event indexing start is async** — `POST .../events/ranges/:id/start|resume`
  returns `202` immediately; progress via `GET .../events/ranges` polling
  (frontend polls 3s). One serial job per range — there is no global queue
  (the former queue service was removed). On startup `reconcileInterruptedRanges()`
  flips ranges stuck in `indexing` to `error` with
  "Interrupted by server restart — resume to continue". Range bounds may be
  submitted as block tags (`latest`/`finalized`/`safe`/`earliest`) but are
  resolved to concrete numbers once, at range creation — stored rows never
  carry tag sentinels (legacy sentinel rows are resolved defensively when
  indexing starts). Creation-block lookups return unknown rather than
  fabricating a boundary: quick mode `all` starts at the creation block when
  known (genesis when unknown), `first` errors with "Contract creation block
  unknown — enter a start block manually"). Quick modes
  (`POST .../events/ranges/quick`): `all`/`recent`/`first`/`continue`/
  `catchup` — quick-created ranges **auto-start** server-side (response
  carries `started`/`startError`; no ABI resolvable → stays `pending`);
  `catchup` extends from the furthest `toBlock` of existing
  ranges to head (`400 "No previous range found. Cannot catch up."` with no
  prior ranges). The 7 mutating event routes are opt-in gated
  (`requireAdminTokenIfConfigured`). `argFilters`/`topicN`
  push decoded-arg filtering into DuckDB; `GET .../events/export` streams CSV
  (100k-row cap → 400; the UI disables the export button preflight when the
  filtered total exceeds the cap; CSV carries an `is_finalized` column).
  Event statistics render "Indexing coverage" — union of walked blocks,
  overlap-safe sweep-merge (paused/errored ranges count their checkpointed
  blocks; the scope is "your configured ranges", not contract lifetime).
  Reorg reconciliation: unfinalized rows below the finalized head are
  receipt-verified at startup + after each range job (reorged-out rows
  deleted, survivors promoted to `isFinalized = true`; oldest-first, 500
  rows/pass); `totalEventsIndexed` is recomputed as distinct `COUNT(*)`
  over the range span on job completion. The range manager derives an ETA
  from its own 3s-poll samples (`recordEtaSample`/`estimateRangeEta`, pure,
  ≥2 samples spanning ≥6s, 30-day ceiling, window voided on pause/error or
  walk regression) and renders "~Xh Ym remaining (est.)" — never a promise,
  nothing shown without an honest slope
- **Address tx history is heuristic** — balance-change binary search; the
  transactions endpoint reports `coverage`/`reason`/`searchWindowBlocks`
  and the UI renders honest partial-data banners ("source unknown" when
  coverage is unknown). Never present it as complete history. Honesty
  contract: `total` = count of **discovered** transactions (never the
  nonce — nonce counts outgoing only); the heuristic never emits
  `coverage:'complete'` (nonce=0 → `partial`/`no-outgoing-transactions`);
  partial coverage renders "At least N transactions discovered". The tx
  search window rides the URL (`?page=` and `?window=` both shareable;
  out-of-range `?page=` converges via history replace to the deepest valid
  page — no shareable empty pages).
  Token Transfers tab: separate on-demand getLogs scan — `?refresh=1`
  bypasses the ~60s scan cache (Retry genuinely re-scans; a cache hit
  reports the FIRST scan's `scannedAt`, rendered as "Scanned X ago"),
  "Search deeper" widens `?ttWindow=` (route clamps 1–50M), its page rides
  the URL as `?ttPage=` (shared schema in `views/Address/search.ts`;
  out-of-range pages replace-converge to page 1), and the active tab rides
  `?tab=` (a `?ttPage=2+` deep link without `?tab=` lands on the transfers
  tab; explicit `?tab=` always wins). An empty
  contract scan offers a CTA to the contract Events indexing flow;
  empty + unknown coverage renders the same "source unknown" banner as the
  tx tab (an empty list is never proof of absence there). Discovered tx lists
  are cached per address+window (~60s LRU in `AddressService`) so
  consecutive pages agree. The address API no longer returns
  balance/transactionCount — the UI reads those live from RPC
  (`services/addressRealTime.ts`) and
  labels the nonce "Outgoing Transactions (Nonce)" with an ⓘ hint pointing
  at the tx tab's partial-discovery semantics. Address Type uses the
  persistent channel first, RPC `eth_getCode` fallback — EIP-7702
  delegated EOAs return a `0xef0100…` designator and the UI labels them
  "Delegated EOA (EIP-7702)" (tooltip names the checksummed delegate,
  `views/Address/addressType.ts`; no contract link, no contract CTA —
  they outrank the persistent isContract record)
- **Search degradation is explicit** — responses can carry
  `degraded`/`degradedReasons`; the UI renders the reasons in plain words
  and offers retry instead of "no results". Hash-miss with a `?chain=` hint
  shows "Try another network" (clears the pin, reopens the picker) instead
  of a dead end. ENS names resolve client-side against a mainnet RPC
  (server returns suggestions only) and the choice is explicit BEFORE
  navigation: primary action opens the address on Ethereum (the resolution
  chain), a secondary "on {current chain}" action when viewing another
  chain; both entries label the result "resolved on Ethereum" and the UI
  distinguishes name-not-found from resolution-failed. The global
  `GET /api/search` resolves hash/block queries on the chain given by
  `?chainId=`; `needsChain` (network picker) only without a chain hint.
  Search history records an entry at click time with the **landing**
  chainId (legacy entries without one degrade to the current chain). Search
  history is **per-browser localStorage** (`be:searchHistory`, max 10) — the
  server-side `search_history` recording + `GET /api/search/history` were
  removed (the shared table leaked every visitor's queries to everyone);
  the table itself is vestigial and unused
- **Custom ABI** — unverified contracts accept a pasted ABI
  (localStorage `custom-abi:{chainId}:{address}`, migrated from the old
  sessionStorage) that unlocks ABI/Events/Interact tabs locally; Interact
  works from the custom ABI alone (no contract source needed). The panel
  states pasting ≠ verification and offers Copy ABI; when the contract
  later gets verified server-side, a dismissible banner announces the
  pasted ABI is no longer used (server ABI always wins)
- **Contract page journey & Interact form** — unverified contracts show a
  "Verify this contract" deep link to
  `verify.sourcify.dev/widget?chainId=&address=` (plus the Force Refresh
  hint that closes the verify→return→refresh loop). Interact parses
  composite args (arrays/tuples; JSON or bare comma lists) with field-level
  inline errors (`addrs[1]: invalid address`), lets the trailing run of
  params be left empty (omitted from the encoded call), and classifies
  failures honestly (`views/Contract/paramParsing.ts`: API vs network vs
  encoding). Backend-unreachable errors (ApiError status 0,
  `isBackendUnreachable` in `util/http.ts`) render `BackendOfflineState`:
  cause attribution + `npx my-block-explorer --port 8201` + retry via the
  discovery `reconnect` (no plain Retry that cannot succeed). Tx not-found
  pages list the three causes (pending / other network with same-hash
  quick links / reorged out) instead of one merged hint
- **2026-09-20 fix wave (P1/P2 round 2)** — cross-cutting consistency fixes:
  EOAs on the contract route are a **fact, not a failure** —
  `ContractSourceService.getContractSource` checks on-chain code before
  caching `unverified` (returns null for EOAs; lazily deletes pre-fix dirty
  rows), source/abi routes answer `404 + code:'not_a_contract'`, and
  **RouterError** (not the view — deep links reject in the loader) renders
  a dedicated "This address is not a contract" card with a View-as-address
  link. Address pages run a **page-level two-tier checksum guard**
  (`views/Address/addressValidity.ts`: shape vs EIP-55, matching
  `server/validation.ts` semantics — all-lower/all-upper skip checksum) —
  an invalid address shows one guidance card with an all-lowercase
  recovery link instead of per-tab contradictory verdicts; the tx-heuristic
  scan only runs while the transactions tab is active (transfers deep links
  no longer burn the 30s backend scan or rewrite `?page=`); balances format
  via `formatUnits` with `nativeCurrency.decimals` (was hardcoded
  `formatEther`, 10¹²× off on 6-decimal chains). `/search` re-searches
  whenever `?q=`/`?chain=` differ from the last consumed pair (the one-shot
  boolean deep-link guard dead-ended in-page re-searches); header
  hash/block searches surface request failures as an inline notice
  (`unreachable` kind for backend-down, never worded as "no results").
  Zero-address miners (Bor/PoS chains whose validator isn't in the EVM
  header) render "Validator not exposed by this chain's RPC" — never a
  clickable dead entity (`describeBlockProducer` in `utils/blockRpcData`).
  Events staleness banner counts only checkpointed/completed ranges
  (all-pending shows "Nothing indexed yet"); `continue` quick mode is
  exempt from the overlap confirmation (its 1-block overlap is the
  intentional inclusive head, same as catchup). Diamond facets survive
  cache round-trips (`implementation_addresses` JSON column, migration
  0006). Backend: transactions list implements documented `?offset=` +
  returns `total`; address validation unified on `getValidatedAddress`
  across events/interact routes (lowercase storage keys unchanged);
  range start/resume/delete answer **404** for missing ranges (400 =
  state-invalid); rpc-config POST validates chainId/URL (`invalid_*`
  codes, response carries `action: created|replaced`); open-in-ide is
  opt-in admin-gated; docs/API.md auth section now matches the actual
  two-tier gates. Known residual: with the backend offline the address
  Type row can stay "Unknown" even though the RPC `eth_getCode` read
  succeeded (SWR-layer run/abort semantics — honest, offline-only)
- **2026-09-20/21 PM-review fix wave (4 batches, 16 agents + integration)** —
  product-review findings fixed end-to-end (all verified: tsc/lint clean,
  full suite 103 files green, live browser smoke on Polygon+mainnet):
  **Honesty** — events GET failure returns `500 {error:'internal_error'}`
  (was success-shaped empty page), indexing-status failure `503
  {error:'indexing_status_unavailable'}` (was 200 + zeroed status;
  EventStatistics renders "Indexing status unavailable" instead of
  vanishing, Promise.allSettled keeps good /ranges data), revert-reason
  card carries a permanent "replayed against end-of-block state" caveat,
  global search suggestions carry `suggestionsChainId` (no more `?? 1`
  mainnet guess; no-context suggestions render as plain text), manual
  backend dying + localhost scan → dismissible SwitchedBackendBanner
  (wired in src/index.tsx), ENS client-construction failure is
  non-retryable `no-rpc`, dead leaky `handleRouteError` deleted.
  **Security** — startup checks (`src/startupChecks.ts`: non-loopback
  HOST without ADMIN_TOKEN → loud warning; +ENABLE_DEBUG_API → refuse
  unless ALLOW_INSECURE_START=1; HOST now actually binds), 500 bodies
  generic (details only in pino), debug SQL behind the opt-in admin
  tier, `/api/health` = `{status:'ok', adminTokenConfigured,
  debugApiEnabled, version, timestamp}`, rpc-configs full URL only for
  allowlisted Origin OR loopback socket (urlRedacted flag; CORS can't
  defend non-browser clients), zero-dep token-bucket rate limiting
  (`src/middleware/rate-limit.ts`: export 5/min·2, addr-tx & transfers
  10·3, search 30·10, read/simulate 60·20; 429+Retry-After;
  RATE_LIMIT_DISABLED=1), limit/page NaN→400 with caps (tx limit≤100).
  **Reading capability** — tx detail decodes token transfers ABI-free
  (`src/utils/tokenTransferDecode.ts` topic0 whitelist ERC-20/721/1155
  single+batch, `src/services/tokenMetadata.ts` multicall3 symbol/
  decimals 1h cache; note: ERC-20 and ERC-721 share the Transfer
  topic0, split by topic count) + EIP-7702 Authorizations card
  (authority ecrecovered locally via `withRecoveredAuthorities` when the
  node omits it), Confirmations row + Safe/Finalized badge on tx
  detail, block detail gains Burnt Fees / Blob Gas (exact blob count —
  the launch-era 786,432 percentage rendered >100% post-Prague) /
  Excess Blob Gas / collapsible Withdrawals (RpcBlock carries the
  fields; gwei→ETH), future-block pages poll 4s/5min + Check again.
  Address Overview gains "Token Holdings (discovered)" — aggregated
  from the transfers tab's first page (`src/views/Address/holdings.ts`,
  BigInt-exact, top-5 ERC-20 verified via multicall3 balanceOf) with a
  mandatory "may be incomplete" caveat; token rows/Implementation link
  to /contract/. Contract page: diamond Interact merges ALL facet ABIs
  (dedup by signature, facet[0] wins; failed facets named in-panel),
  history-aware Back, tab push, creation gas 0→Unknown, Value label
  uses getChainSymbol, verificationSource friendly labels
  (types.ts union corrected: sourcify|blockscan|manual|unknown|none —
  'etherscan'/'etherspan' never existed).
  **Polish** — Home dual-column progressive render + stat-card
  skeleton/value/unavailable tri-state, chain selector full keyboard
  nav (↑↓ highlight, Enter confirms highlighted only, listbox ARIA) and
  offline block/hash search falls back to direct RPC on the selected
  chain, free-text search recorded at landing only, needsChain cards
  keyboard-operable, chains.ts precomputed index (searchChains ~55×,
  getSortedChains ~38,000×; byte-identical order incl. quirks),
  UnsupportedChainState renders an in-card popular-chains grid (the
  "Open chain list"→'/' bounce lied), tx list empty-range renders
  EmptyState + `?block=` invalid/future-anchor notices, `/search`
  unreachable errors attributed with Retry. Stale pins re-pinned: ens
  no-rpc, health shape (api-routes + INSTALLATION), rpc no-Origin
  redaction (fail-closed without a socket), e2e range 404s (pre-dated
  this wave). 7702 smoke note: page verified via jsdom + a real-RPC
  script; latest-block sampling didn't surface a type-4 tx for the
  browser pass
