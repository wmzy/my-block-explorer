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
├── data/                   # DuckDB files (main + per-chain), solc-cache/
├── docs/                   # README/INSTALLATION/CONFIG/API/ARCHITECTURE/DEPLOYMENT + archive/
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
- **CI/CD exists** — `.github/workflows` has `ci.yml`, `release.yml`, `deploy-pages.yml`
- **Test layout** — `tests/` (unit + integration + e2e) is the live suite;
  historical `src/tests/` / `test/` dirs no longer exist
- **Barrel complete** — `src/utils/index.ts` re-exports all util modules (8
  name collisions resolved by explicit re-exports; deep imports stay canonical
  in call sites; `serialization.ts` pulls pino through the barrel — browser
  code deep-imports it)
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
  two-tier gates. (The offline-Type residual here was RESOLVED in the
  2026-09-22 feature wave — real cause was viem folding a successful
  '0x' getCode read into undefined, not SWR semantics)
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
  (types.ts union corrected: sourcify|blockscan|manual|unknown|none
  (+ 'local-compile' since the 2026-09-23/24 wave) —
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
- **2026-09-21/22 PM-review feature wave (3 waves, 12 slices + integration)** —
  gap-closing features, all live-browser-smoked on Polygon/mainnet (129
  test files / 1651 tests green; tsc + eslint clean):
  **Token pages (lightweight)** — contract addresses get a Token Overview
  card (`useTokenOverview` in `services/tokenMetadata.ts`: one Multicall3
  name/symbol/decimals/totalSupply batch, 1h TTL, fires ONLY when
  addressType is contract; 'ERC-20' claimed only when decimals AND supply
  respond, otherwise 'standard unknown — possibly ERC-721' badge);
  token-centric transfer scan (`TokenTransferService` mode `token`:
  getLogs filtered by emitting address + Transfer topic0 whitelist, NO
  participant topics; `?mode=` rides the transfers route, cache keys
  include mode; TokenTransfers tab defaults to token mode on detected
  tokens with a 'Transfers of this token / involving this address'
  toggle; row direction gains 'none' for user-to-user); Top Holders
  (discovered) nets from/to BigInt-exactly over token-mode rows
  (`views/Address/tokenOverview.ts`, zero-address sentinel excluded,
  non-ERC-20 rows counted as excluded, mandatory "may be incomplete"
  caveat; requires a same-session scan — fresh loads show the scan CTA).
  **Signature decode** — `GET /api/signatures?function=&event=` (openchain
  lookup, batch ≤25; `signature_cache` DuckDB table, verified rows
  immutable, NOT_FOUND 24h TTL; upstream failure → `unavailable`, never
  an error); tx detail renders resolved names beside raw selectors with
  an 'openchain' chip when ABI decode fails.
  **Call trace** — tx detail Call Trace card, browser-side
  `debug_traceTransaction` callTracer (lazy on first expand;
  method-not-found → honest 'not supported by this RPC'; header 'N calls
  · depth D · M failed'); pure normalizer in `utils/traceFormat.ts`.
  **Labels + CSV** — `address_labels` table (chain_id+address PK; PUT
  upsert/DELETE admin-gated, GET open; `routes/labels.ts`); Address
  overview Label chip with inline editor (403 → admin-token hint);
  `GET .../addresses/:a/transactions/export` streams CSV (50k cap, 5/min
  rate limit; header-only file for empty windows) + tx-tab Export CSV
  button. **Contracts directory** — `/chain/:id/contracts` page
  (`routes/contracts.ts` list endpoint, ?q= name/address substring,
  ?offset pagination; view in `views/Contracts/List.tsx`, nav link
  'Contracts'); global search free-text responses gain `localContracts`
  hits (SearchService `searchLocalContractHits`, same filter as the
  directory; hash/block/ens responses byte-identical).
  **Gas tracker** — Home GasPanel (`services/gasHistory.ts`:
  getFeeHistory 120 blocks + 25/50/75 pct rewards, 60s poll, browser RPC;
  sparkline + Slow/Standard/Fast tiers + honest per-reason unavailable
  copy; window label from real block numbers, speculative next-block
  entry dropped). **Raw JSON** — `components/ui/RawJson.tsx` lazy
  collapsible card on tx (tx+receipt) and block (with/without txs)
  detail; per-section retry/abort; pending tx shows 'No receipt yet'.
  **Copy as cast** — Interact forms export `cast call|send` commands
  (`utils/castCommand.ts`: signature form, array/tuple args fall back to
  calldata form, `--private-key <ENTER_YOUR_KEY>` placeholder, default
  public RPC with caveat tooltip). **Theme + version** —
  Light/Dark/System cycle (`themePreference.ts`, `be:theme` storage,
  `data-theme` attr wins over the OS media query, applied pre-mount);
  version chip reuses discovery's health payload. **Sourcify verify** —
  in-page panel on unverified contracts (`routes/verify.ts` +
  `ContractVerifyService`: APIv2 submit→ticket→poll against
  SOURCIFY_SERVER_URL, files ≤50/≤2MB, metadata.json required, success
  clears the source cache; admin-gated, 3/min). **Docker** — multi-target
  Dockerfile (api/web) + compose.yaml (SELinux `:Z` on the data volume;
  podman-built and browser-E2E'd). **Conventions added** — DuckDB
  datetime strings are NAIVE UTC: parse as UTC (`toIsoTimestamp` in
  SearchService is the reference; plain `new Date(str)` reads local and
  shifts hours by the machine TZ); drizzle migrations that are hand-written
  MUST get a meta snapshot or the next `db:generate` re-emits their diff
  (0006 lacked one → 0007 double-added implementation_addresses; fixed in
  0007 with an explanatory comment). Known residuals: ~~mobile is still
  desktop-first outside tx/block detail pages~~ (RESOLVED in the
  2026-09-22 wave — app-wide 375px pass); Sourcify panel rendering
  verified via jsdom suite + live API probes
  (every random chain sample turned out verified)
- **2026-09-22 PM-review gap wave (3 waves, 12 agents + integration)** —
  competitor-gap features vs Etherscan/Blockscout/Otterscan, all
  live-browser-smoked on Polygon (150 test files / 1956 tests green;
  tsc clean; eslint 0 errors):
  **Mobile parity** — the whole app is now 375px-clean (address/contract/
  home/lists/header families stack at ≤768px, tables scroll in-card,
  DataTable pagination wraps; tx list drops its Method column at mobile).
  **Tx-list Method column** — batched openchain selector decode
  (`useSignaturesBatched`: 25-Selectors/request chunks, fixed 4 hook slots,
  session-level memo so paging back is free); honest display model: plain
  transfer → "—", creation → "Contract Creation", unresolved → truncated
  selector. **Token page** — `/chain/:id/token/:address` self-guarding
  lens (EOA/7702/deployed-non-token each get a dedicated card; guards
  reuse the two-tier checksum util); assembles Token Overview + real
  TokenTransfers component (token mode, zero scan fork) + top-10 holders
  bars + mint/burn aggregation (0x0 flows), all "discovered" caveats;
  Address page Token Overview card links here. **Balance history** —
  `?balanceHistory=1` additive fields on the transactions endpoint
  (byte-identical without the literal `1`): chronological BigInt-exact
  cumulative series over the cached discovered set, first point anchors
  at 0 (pre-oldest-tx absolute balance unknowable); the card anchors the
  series to the live RPC balance, rides the same ?window= cache as the
  tx list. **NFT holdings** — per-contract 721 id-set / 1155 amount-delta
  aggregation from the SAME first-page transfers scan (no refetch,
  renders nothing when no NFT rows — clean absence); reuses the
  useTokenMetas session cache. **Approvals viewer** — read-only
  `GET .../addresses/:a/approvals` (owner-filtered Approval sweep reusing
  TokenTransferService's chunk ladder/ceiling memory → distinct pairs →
  Multicall3 allowance at head, 100-pair cap + truncated flag, ~60s cache,
  10·3 rate bucket); ~~revoke is an external revoke.cash link only — no
  wallet plumbing~~ (RESOLVED in the 2026-09-23/24 wave — in-product
  Revoke now links a prefilled interact card, revoke.cash demoted to
  secondary; the sweep also grew 721/1155 kinds — see below);
  ApprovalSection renders after the Address overview.
  **Internal Txns tab** — `?tab=internal` (additive enum; existing
  deep-link inference byte-identical): browser-side callTracer over the
  FIRST 25 discovered txs of the current window (same query key — no
  refetch), 4-way concurrency, value/address-filtered flattened rows,
  per-tx failures collapsed+listed, RPC-without-debug_* renders the
  honest unsupported card. **Charts page** — `/chain/:id/charts` +
  nav entry: blocks/day (day-boundary binary search), avg block time,
  gas used, gas prices (chunked feeHistory with adaptive per-chain
  ceiling) — all client-side sampled with per-chart source labels and a
  page-level sampling disclaimer; gaps stay gaps; burnt fees honestly
  skipped ("not available without full indexing"). **Live SSE +
  watchlist** — `GET .../blocks/stream` (streamSSE, 1s head poll,
  heartbeat, catch-up cap 10, error-event-then-close, 12·6 bucket);
  Home merges live blocks with silent fallback to polling ("Live"/
  "Polling" badge); Watchlist (localStorage `be:watchlist`, max 25,
  two-tier validation) matches live blocks' tx from/to (bounded: one
  block fetch per event, 500 txs, only when non-empty) → browser
  Notification; copy states "not a background service". **OG/meta** —
  DocumentTitle now also maintains og:title/og:description/twitter:card
  via pure `deriveMetaDescription` (JS-executing clients only — no
  prerender). **Residual fixed** — offline address Type: viem folds a
  successful '0x' getCode into undefined; `fetchContractCode` now
  returns `code ?? '0x'` so RPC-derived EOA/contract/7702 verdicts
  render offline. New endpoints documented in docs/API.md. Known
  residuals: OG tags need JS (no SSG); approvals/NFT/holders are
  window-limited discoveries by design; charts are samples, not
  indexer aggregates (burnt fees omitted). Tooling note: `pnpm vitest
  run a.test.ts b.test.ts` ANDs the positional filters and silently
  matches nothing — run one file per invocation
- **2026-09-22/23 PM-review wave 3 (6 agents, 轻量本地运行定位)** — product
  line re-pinned to "lightweight LOCAL tool" (not self-hosting); six
  features landed, all browser-smoked end-to-end:
  **Custom chains (T1)** — register ANY EVM chain viem doesn't ship
  (anvil/hardhat/private/fresh L2s): `custom_chains` DuckDB table
  (migration 0009) + runtime registry layer in `config/customChains.ts`
  consumed by `getChainInfo` on BOTH sides (registry OVERRIDES viem for
  dev-chain placeholder ids; the 409 gate `isBuiltInChainProtected`
  keeps real viem networks unshadowable); `POST /api/chains/custom`
  probes eth_chainId with a raw JSON-RPC POST (5s budget, same
  rpcUrl-redaction policy as rpc-configs), DELETE 404/204; bootstrap in
  `RpcManager.loadUserConfigs` (covers standalone server AND vite
  bridge); UI: chain-selector "Add chain" + UnsupportedChainState
  dead-end recovery sharing `AddCustomChainForm`. **Browser RPC
  wiring (post-smoke fix)**: `realTimeData.absorbCustomChainRpcUrls` —
  the browser's client cache must serve the REGISTERED url, not viem's
  anvil default (8545) shadow; `createRpcClient` awaits
  `ensureCustomChainsLoaded()` via dynamic import (breaks the static
  cycle service→utils); `addCustomChain` re-seeds the url map AFTER
  `invalidateRpcClients` clears it (input url, not the possibly-redacted
  echo).
  **Fiat price layer (T2)** — browser-side DefiLlama
  (`services/prices.ts`, keyless, CORS-open): native coins via
  coingecko:{id} map for the 10 POPULAR_CHAINS (POL =
  polygon-ecosystem-token; arbitrum/base/op native = ethereum), tokens
  via {llamaSlug}:{address} (gnosis = 'xdai', NOT 'gnosis'); 60s
  session cache, in-flight dedupe, honest negative entries (one attempt
  per TTL window), ≤30-id batched GET; `UsdValue` renders nothing on
  unavailable/stale>10min (structural degrade-to-invisible, asserted on
  real views); surfaces: tx Value row, Token page Price/Market Cap
  ("via DefiLlama"), Address holdings estimate, gas tiers.
  formatUsd: sub-cent amounts widen to 4 decimals ("$0.0032") —
  "$0.00" for a cheap-chain transfer is information-free.
  **Manual verification (T3)** — the designed-but-unwired
  `verificationSource:'manual'` slot now has a full loop:
  `POST/DELETE .../verify/manual` (admin-gated, 3/min) writes/removes
  local-trust marks through the SAME saveToDatabase upsert; fresh marks
  (<1h) serve from the DB shortcut incl. ABI-only marks; stale marks
  re-probe Sourcify once — remote 'verified' supersedes manual,
  remote miss keeps the mark (refreshManualMark); DELETE only removes
  manual rows (sourcify/blockscan answer 404 untouched); UI "Manual
  (local trust)" badge + panel (collapsed behind "Verify in this page"
  alongside the Sourcify panel) with paste-≠-verification copy.
  contract_sources storage keys stay CHECKSUMMED (formatAddress) — the
  service's own convention, distinct from the events/labels lowercase
  convention.
  **Tx/day chart (T4)** — fifth Charts series "Transactions per Day
  (sampled)": 16 uniformly-sampled blocks/day (512-call whole-series
  budget, 4-worker eth_getBlockTransactionCount), extrapolated ×
  blocksInDay/samples; <K/2 resolvable samples = absent day (gaps stay
  gaps, never zeros); source label discloses "counts, not indexer
  truth".
  **Built-in label seeds (T5)** — 68 corroborated entries across 7
  chains (`config/builtinLabels.ts`, provenance in note fields; the
  data-quality bar capped L2 counts below target — never guess) seeded
  on FIRST STARTUP ONLY (empty-table gate in `seedBuiltinLabels`,
  hooked in RpcManager.loadUserConfigs; deletions stick across
  restarts; deleting EVERY row re-arms seeding — documented tradeoff);
  `address_labels.source` column ('builtin'|'user', migration 0010 —
  DuckDB rejects ADD COLUMN with NOT NULL constraint, nullable default
  matches signature_cache); PUT converts builtin→user (user intent
  wins); UI chip carries a "Bundled with the explorer" marker.
  **Wallet-connected send (T6)** — `util/wallet.ts` zero-dep EIP-1193
  facade (EIP-3326/3085 method names are wallet_switchEthereumChain /
  wallet_addEthereumChain — no eth_ prefix); Interact write functions
  gain "Send with wallet" ONLY with an injected provider (byte-identical
  DOM without — asserted); ONE buildCastCommand pass feeds
  simulate/cast/send (single calldata source); eth_sendTransaction with
  NO gas field; 4001 quiet; chain guard names switch/add/reject
  outcomes; hash links to the internal tx route.
  **Cross-cutting fixes found by integration smoke**:
  (1) **DuckDB timestamp epoch bug (pre-existing, user-visible)** —
  drizzle's datetime migrations create `TIMESTAMP_MS` columns, which
  @duckdb/node-api returns as `DuckDBTimestampMillisecondsValue{millis}`
  objects; the adapter only converted `DuckDBTimestampValue{micros}`, so
  the object leaked to drizzle and coerced via its naive string form →
  every DB-read Date shifted by the machine TZ (-8h on UTC+8;
  verifiedAt/lastChecked/labels everywhere). Fix:
  `duckdb-postgres-adapter.adaptResult` now converts micros/millis/
  seconds timestamp objects AND strict-shape datetime strings (space or
  T form, optional offset; offset-less = UTC wall) to correctly-parsed
  Dates; `openSession()` pins every connection's session TZ to UTC
  (DuckDB `now()` otherwise writes LOCAL wall time into naive columns —
  mixed write semantics no reader can disambiguate). Historical dev-DB
  rows written by the old now() may read ±TZ-shifted — fresh writes are
  exact.
  (2) **vite dev bridge strips the same-origin trust signal** —
  same-origin GET fetches omit Origin by spec; the bridge has no socket
  info → URL redaction fail-closed → the app's own frontend got
  redacted (uncallable) RPC urls in dev. Fix: honoApiPlugin synthesizes
  `Origin: http://{host}` for Origin-less requests (dev bridge only);
  frontend additionally skips `urlRedacted` entries (defense in depth).
  (3) rate-limiter discipline while smoke-testing: the verify bucket
  (3/min) and add-chain bucket (5/min) refill fast — sleep ≥65s between
  probe rounds, and jq-on-response masks error bodies (capture raw).
- **2026-09-23 PM-review gap wave (3 waves, 10 features + integration)** —
  the PM review's P0/P1/P2 list landed via 10 concurrent-wave agents
  (2 agents self-split service/UI slices via child tasks); all verified:
  tsc 0 errors, eslint 0 errors, 966 changed-file tests green, live
  browser smoke on Polygon (drpc archive) + mainnet:
  **Mempool page (P0)** — `/chain/:id/pending` route + nav "Pending":
  browser-side `txpool_content` via the shared client
  (`services/txpool.ts`, 5s polled hook, account/nonce flattening,
  200-entry display cap, no age column — pool entries carry no
  timestamps); honest unsupported/failed states. Integration fix:
  providers that ACCEPT the POST but never answer it (publicnode) held
  the page in first-load skeleton forever → `fetchPendingTransactions`
  races an 8s request budget and settles 'failed' + Retry (regression-
  test pinned).
  **Custom-error decode (P0)** — `utils/txDecode.ts` `describeRevertData
  (data, abi?)` (Error(string)/Panic byte-identical zero-ABI, viem
  decodeErrorResult for custom errors, BigInt-safe arg formatting,
  never throws); tx Detail revert card + Interact read/simulate/send
  failures decode `ContractFunctionReverted: Name(args)` when an ABI is
  in hand; no-ABI paths byte-identical.
  **CoverageBadge + copy tiering (P0)** — `components/ui/CoverageBadge
  .tsx` (levels live|cached-immutable|discovered|sampled|partial|
  unavailable, glyph+label distinguishable without color, ⓘ detail
  disclosure) + pure derivations `views/Address/coverage.ts` /
  `views/Contract/coverage.ts`; ONE page-level badge per page, per-card
  long caveat paragraphs relocated into the badge detail (Address
  offline/tx-tab copy shortened, tests re-pinned); mandatory one-line
  chips stay inline.
  **NFT metadata (P0)** — `services/nftMetadata.ts`: tokenURI/uri({id}
  substitution) → ipfs→gateway rewrite → JSON fetch (5s budget) →
  name/image; honesty split revert→'none' cached 1h vs transport→
  'unavailable' uncached; `be:ipfsGateway` setting (default ipfs.io,
  editable in the RPC/settings modal); NftHoldings renders 44px thumbs
  for the first 24 items, shimmer/placeholder/chip states. (Live smoke
  omitted: public RPCs silently cap getLogs — unit-covered 54 tests.)
  **Address summary stats (P1)** — FIRST/LAST SEEN + TOTAL IN/OUT
  (BigInt-exact, per-chain decimals) in the Overview card. Data source
  is the **balance-history page** (same cache entry the chart consumes —
  limit 50, backend-aligned timestamps; integration rewire: first
  landing folded only the tx tab's 10-row page) via exported
  `useBalanceHistoryQuery`/`withBlockTimes`; caveat discloses "newest N
  of M discovered transactions" when the page caps the set; boundary
  timestamps lazily resolve via ≤2 cached getBlock calls, else honest
  "Block N".
  **Token price history (P1)** — `services/prices.ts` historical layer:
  DefiLlama `/chart/{coins}` (verified API shape), 30d/7d windows, 10min
  TTL + negative caching + in-flight dedupe, gaps never zero-filled;
  Token page sparkline card (Low/High/Latest/Live labels, real-timestamp
  date labels, 'via DefiLlama' chip).
  **Internal-txns depth (P1)** — `?itDepth=` rides the address search
  schema (clamp 10–200, default 25; valid-but-out-of-range narrows to
  the bound, structurally-invalid degrades to undefined); preset select
  25/50/100/200 pins tab=internal on write; always-visible standing
  scope line ("first N discovered transactions of the selected window —
  not full indexing"); live "Traced X of N" progress. Clamp lives in
  the URL layer, the scan honors the depth it is handed.
  **Three-mode onboarding (P2)** — docs/INSTALLATION.md "Three ways to
  run" (RPC-only / local full / shared deployment — every claim verified
  against middleware/startupChecks code) + README blurb; GettingStarted
  card holds the '/' Landing redirect ONLY while discovery settled
  backend-less AND `be:onboardingDismissed` unset (no flash: Landing
  otherwise redirects within one frame); Copy npx command; dismiss
  persists.
  **Cross-chain probe (P1)** — `services/crossChainProbe.ts`: balance+
  getCode (code ?? '0x', 0xef0100 designator → contract) on first-5
  POPULAR_CHAINS excluding current + registered customs, cap 6,
  concurrency 3, 4s per-call budget; CrossChainStrip under the Overview
  card: collapsed one-line summary ("probing failed on N"), chips =
  TypedLinks to the address on that chain, USD only where DefiLlama
  spot resolved (knowns sort before unknowns, never raw-unit
  comparison), ✕ unavailable chips visible with reason.
  **Integration fixes this wave**: crossChainProbe imported
  `listCustomChains` from services/ (it lives in config/customChains —
  sync registry; services/ only has the one-shot load) — fixed + test
  mock moved; nftMetadata unknown→Record via type-guard predicate;
  eslint auto-fix batch (quote-props etc.); SummaryStatsRow rewired to
  the shared balance-history cache (see above); txpool request budget
  (see above). RPC note: publicnode polygon lacks archive state
  (binary-search eth_getBalance at old blocks → "historical state …
  not available" → honest search-failed coverage); the stored polygon
  rpc-config was switched to polygon.drpc.org during smoke (archive
  capable — left in place).
  **Deferred by PM decision**: i18n; full internal-txn indexing; DEX/
  MEV surfaces; account/API-key systems (out of scope for the
  lightweight-local positioning).
- **2026-09-23/24 PM-review implementation wave (7 streams + integration)** —
  the PM review's implementation round landed (all verified: tsc clean,
  eslint 0 errors, 185 test files / 2556 tests green, live browser smoke
  on Polygon + mainnet):
  **Known token balances** — `src/config/knownTokens.ts`: 87 curated
  addresses across the 10 POPULAR_CHAINS, every entry corroborated
  against at least two of DefiLlama prices echo / on-chain symbol()·
  decimals() reads / publisher pages; chains we could not corroborate
  widely (fantom, celo) ship honest short lists — never a guess, never
  padding. Addresses ONLY: `symbol` is a display hint, decimals/symbol
  truth always resolves at runtime (stale curation can never fabricate
  amounts). `src/services/knownTokenBalances.ts` resolves the list in
  ONE Multicall3 balanceOf batch (session cache);
  `src/views/Address/KnownTokens.tsx` renders "Known Tokens · checked N
  known tokens — live balances, not a complete asset list" (USD-known-
  first sort, cap 8 + remainder link; fires for EOAs AND contracts —
  unlike discovered holdings it needs no prior scan).
  **Approvals across token standards** — `ApprovalScanService` now
  sweeps ERC-1155 ApprovalForAll (isApprovedForAll reads) alongside the
  Approval topic; the ERC-20/721 Approval topic0 collision is split by
  indexed-topic count (4 topics = erc721 → getApproved(tokenId) reads).
  Response rows carry `kind` + optional `tokenId`; for NFT kinds
  `allowance`/`isMax` are documented SCOPE sentinels, not amounts
  ('1'/false = one token id; '1'/true = all ids). Cap 100 across kinds;
  dead grants are omitted but counted.
  **In-product revoke** — approval rows link Revoke →
  `/contract/:token?tab=interact&revoke=1.<kind>.<token>.<spender>
  [.<tokenId>]` (pure codec `views/Contract/revokeIntent.ts`);
  ContractInteract renders a prefilled revoke card (erc20
  approve(spender,0) / erc721 approve(0x0,tokenId) / 1155
  setApprovalForAll(operator,false)). A verified ABI carrying the exact
  signature wins over the bundled standard fragment; the fragment path
  is honestly labeled "standard {kind} ABI — not this contract's
  verified ABI" (never silently assumed). FunctionCallForm gained
  initialArgs/defaultExpanded to drive the prefill; revoke.cash stays
  as a secondary link.
  **Server-side watch subscriptions** — `watch_subscriptions` table
  (migration 0011) + `WatchService` (4s tick, per-subscription ranged
  getLogs, 200-block gap cap with honest gap markers, ring buffer
  100/chain) + `src/routes/watch.ts` (GET/PUT/DELETE + events;
  opt-in admin + 5/min; cap 25/chain; needs RPC config) + SSE `watch`
  frames piggybacked on the existing blocks/stream + `liveChain.ts`
  subscribeWatchEvents/useWatchEvents; Watchlist panel gains a second
  section + global browser Notifications wired in src/index.tsx
  (dedupe by chain:txHash:logIndex). Honest copy pinned: watching
  starts at subscribe (never walks history) and runs only while the
  backend runs.
  **Local compile verification** — `CompileVerifyService` +
  `POST .../verify/compile` & `GET .../verify/compilers` (opt-in admin
  + shared 3/min bucket): downloads solc wasm from the official
  list.json (sha256-verified, cached `data/solc-cache/*.cjs` — .cjs
  because the package is `"type":"module"` and a .js soljson dies on
  `__dirname` in real node; tsx dev masks it), compiles standard JSON
  (Hardhat build-info unwrapped), matches runtime bytecode with
  auxdata-stripping tiers exact/matches-metadata-only/mismatch (+
  first diff offset). Any match persists verificationSource
  'local-compile' via `ContractSourceService.saveLocalCompileVerification`
  (new public path; the verificationSource union widened on both sides;
  evmVersion plumbed) and clears the source cache; CompileVerifyPanel
  sits beside the Sourcify panel on unverified contracts.
  **Docs + release discipline** — docs/ consolidated (9 files deleted/
  folded, historical → docs/archive/, entry set README/INSTALLATION/
  CONFIG/API/ARCHITECTURE/DEPLOYMENT). release.yml truth pinned:
  semantic-release from conventional commits on push to main, version
  NEVER written back to the repo (no @semantic-release/git) — a guard
  step now FAILS when package.json ≠ latest v-tag; package.json set to
  1.2.0; CHANGELOG.md created (hand-maintained; tags authoritative).
  `/api/health` + `/api` index version now read package.json via
  `src/version.ts` (was hardcoded "1.0.0"; appVersion resolves lazily,
  degrades to 'unknown' rather than a fabricated number).
  **Bug fixed en route (pre-existing)** — `views/Address/approvals.tsx`
  fetched `/chains/...` missing the `/api` prefix → always HTTP 404
  through the app (vite-bridge curl hid it). Frontend service paths
  MUST start with `/api/` (apiBase is origin-only). Diagnosis pattern:
  addInitScript-patched window.fetch survives navigation, but
  page.on('response') does NOT catch pre-listener requests.
  **Conventions worth pinning** — react-toolroom query caches hold
  ERRORS too: a transient failure sticks until remount, so surfaced
  sections should offer retry affordances (~~the approvals section currently
  lacks one~~ — RESOLVED in the 2026-09-24 wave: inline Retry wired to
  refetch).
- **2026-09-24 PM gap wave (3 waves, 10 tasks + integration)** — the PM
  review's P0/P1 list landed (all verified: tsc clean, eslint 0 errors,
  204 test files / 2856 tests green via `vitest --changed`):
  **Address deep scan (P0)** — `address_scan_jobs` + `address_scan_findings`
  (migration 0013) + `AddressScanService` forward-walk engine (balance
  checkpoints at adaptive 50k-block batches halving on provider range
  errors; binary-searched change blocks scanned via the shared
  scanBlockForAddressTransactions extracted from AddressService; findings
  persisted; max 2 concurrent addresses, one serial loop each; progress
  checkpointed per segment with compare-and-set so a force-replaced row
  can't be clobbered; `reconcileInterruptedAddressScans` wired in
  api-app.ts startup). Routes: POST/GET …/scan + pause/resume/DELETE
  (writes opt-in admin + 3/min·2). Transactions endpoint gains additive
  `deepScan` + findings merge (heuristic ∪ findings, dedup by hash,
  blockNumber desc) and the FIRST sanctioned `coverage:'complete'` path
  (reason `'deep-scan'`) — genesis-anchored finished walks ONLY
  (fromBlock===0; coverage derived, never stored). Frontend `DeepScan`
  panel on the tx tab (3s poll only while running, ETA from the range
  manager's sampler approach, pause/resume/delete, force-restart on
  scan_conflict); `services/addressScan.ts` exports the pure
  `parseScanJob` guard so the panel never imports services/addresses.ts.
  **Entity search (P0)** — free-text `/api/search` gains `tokenHits` (≤5):
  knownTokens symbols + address_labels text, label wins on dedup, field
  dropped (not emptied) on a failed labels read; Search page "Known
  tokens & labels (curated)" section.
  **Token standard filter** — transfers rows carry `logStandard`
  (log-shape-proven standard; separate from the metadata-disambiguated
  `standard` enum) + `?ttStandard=` chips on the transfers tab
  (optional().catch(undefined), absence = all; filter-emptied page renders
  EmptyState without touching ?ttPage). **En-route bug fix**: 4-topic
  ERC-721 Transfer rows were silently dropped by EVERY scan (viem
  decodeEventLog returns no `value` for the ERC-20 shape against 4-topic
  logs; tokenId now read from topics[3]).
  **Approval history** — additive `history`/`historyTruncated` (raw swept
  events, newest-first cap 200; ApprovalForAll(false) excluded — the wire
  shape cannot represent unapproval); collapsible timeline riding the same
  fetch; approvals section gained the inline Retry.
  **Safe decode** — `utils/safeDecode.ts` `decodeSafeExecTransaction`
  (selector 0x6a761202 + **canonical re-encode round-trip guard** — viem
  decodes TAIL-truncated dynamic `bytes` leniently, fabricating missing
  bytes instead of throwing); tx Detail "Safe-style Multisig" card (inner
  call target/value/operation badge, inner selector via the page's
  openchain batch, ≈N signatures estimate with packing caveat;
  selector-based detection, never a verified-Safe claim).
  **Protocol labels** — `config/knownRouters.ts`: 62 Uniswap-family
  addresses × 8 chains (V2 Router02, V3 SwapRouter v1 + SwapRouter02,
  Universal Router V1–V2.1.2), every entry source-cited (docs repo +
  sdk-core + UR deploy JSONs) AND on-chain getCode-verified; fantom/gnosis
  ship empty (no official deployment — never guess). `ProtocolRouterChip`
  in the tx-list Method column + Detail's Method item (orchestrator-wired
  seam); labels are display hints, uncurated ≠ not-a-router.
  **Local data portability** — `GET /api/labels` (opt-in admin, no-store,
  10/min·3) + settings-modal "Backup & restore": explorer-backup.json v1
  (labels, custom chains, watchlist/theme/ipfsGateway/custom ABIs);
  custom-abi keys PATTERN-PINNED so a hostile file cannot write arbitrary
  localStorage keys; backend-unreachable exports browser-local parts with
  an honest notes[] attribution; import runs per-item with per-section
  results (403 → one admin-token line, chain probes reported per-chain).
  **Admin SQL console** — `/sql` page (NOT chain-scoped — queries the MAIN
  DuckDB) + `POST /api/sql/query` / `GET /api/sql/tables` (STRICT
  fail-closed admin — raw SQL never open by default; pure
  `isReadOnlyQuery` guard: single statement, SELECT/WITH start, 22
  forbidden word tokens anywhere; `runAndReadUntil(501)` measured
  truncation so giant results never materialize; DuckDB-style column
  dedup; session TZ pinned UTC; 6/min·3; two distinct 403 faces — server
  token unset vs browser token wrong; be:sqlConsole history max 10).
  **Cleanup** — `search_history` dropped (migration 0012; the parallel
  definition in `src/database/chain-schema.ts` remains, unused — future
  cleanup candidate); utils barrel completed. **Conventions pinned**:
  (1) viem lenient-decodes truncated tail bytes — external-calldata
  decoders need a re-encode round-trip guard; (2) creation tx rows carry
  `toAddress: ''` (normalized in blockRpcData), never null; (3) the wave
  pattern that worked: per-wave file-ownership lists + orchestrator-only
  wiring of cross seams (ProtocolRouterChip→Detail, deepScan field→
  services/addresses.ts, reconcile call→api-app) + one pinned API
  contract doc for parallel backend/frontend slices.
