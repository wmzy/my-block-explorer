# API reference

The backend is a Hono app (`src/api-app.ts`) that mounts the route modules in `src/routes/`. This page documents the endpoints that actually exist; the route files are the source of truth.

- **Base URL**: `http://localhost:8201/api` (standalone server, `PORT`/`--port` override). In dev, the Vite server on `:3000` bridges the same app under `/api`.
- **Format**: JSON (CSV for the event export).
- **Auth**: read endpoints are open. Writes/admin endpoints are gated in two tiers, both via the `x-admin-token` header matching the server's `ADMIN_TOKEN` env. Core-workflow writes (event-range mutations, `POST`/`DELETE /api/rpc-configs`) use `requireAdminTokenIfConfigured` — enforced only when `ADMIN_TOKEN` is set; without it they pass through (zero-config local trust model). The admin/diagnostic surface (contract `clear-cache`, storage-layout cache delete, `/api/performance/*`) is strictly fail-closed: no token configured → 403.
- **Common response headers**: `X-Data-Source` (e.g. `database`, `rpc`, method tag), `X-Chain-Name`.
- **Chain IDs**: any chain defined in `viem/chains`. Unknown IDs → `400 { "error": "Unsupported chain" }` (chain-scoped search additionally returns `supportedChains`).

## Health & meta

| Method & path | Notes |
| --- | --- |
| `GET /api` | Endpoint index |
| `GET /api/health` | `{ status: "healthy", version, timestamp }` — used by frontend discovery |

## Search

| Method & path | Notes |
| --- | --- |
| `GET /api/search?q={query}` | Detects address / tx hash / block number. Response may carry `degraded: true` + `degradedReasons: string[]` when an upstream lookup failed, and `message` (e.g. ENS names are resolved client-side, not by the server) |
| `GET /api/chains/:chainId/search?q={query}` | Chain-scoped variant |
| `GET /api/search/history?limit=&chainId=` | Recent searches, optional chain scope, limit ≤ 50 |

## Stats & blocks & transactions

| Method & path | Notes |
| --- | --- |
| `GET /api/stats/overview` | Aggregate stats across popular chains |
| `GET /api/chains/:chainId/blocks/latest` | Latest block |
| `GET /api/chains/:chainId/blocks/:blockNumber` | Block by height |
| `GET /api/chains/:chainId/blocks?limit=&offset=` | Block list |
| `GET /api/chains/:chainId/transactions/:hash` | Transaction detail |
| `GET /api/chains/:chainId/transactions?limit=&offset=` | Transaction list |

## Addresses

| Method & path | Notes |
| --- | --- |
| `GET /api/chains/:chainId/addresses/:address` | Persistent data only — **no balance, no transaction count**; the UI reads those live from RPC |
| `GET /api/chains/:chainId/addresses/:address/persistent` | Same data, explicit |
| `GET /api/chains/:chainId/addresses/:address/transactions?limit=&page=` | Heuristic history (balance-change binary search). Reports `method`, `coverage` (`complete`/`partial`/`none`), `reason`, `searchWindowBlocks`; unknown coverage renders a "source unknown" banner in the UI |

## Contracts

| Method & path | Notes |
| --- | --- |
| `GET /api/chains/:chainId/contracts/stats` | Cached-contract counts |
| `GET /api/chains/:chainId/contracts/:address/source` | Verified source & metadata (DB → Sourcify → Etherscan fallback) |
| `GET /api/chains/:chainId/contracts/:address/abi` | ABI + decoded functions/events/errors |
| `GET /api/chains/:chainId/contracts/:address/functions` | Function signatures |
| `GET /api/chains/:chainId/contracts/:address/creation` | Creation tx/block lookup |
| `GET /api/chains/:chainId/contracts/:address/ides` | Detected IDE openers |
| `POST /api/chains/:chainId/contracts/:address/read` | State-changing-free call |
| `POST /api/chains/:chainId/contracts/:address/simulate` | eth_call simulation |
| `POST /api/chains/:chainId/contracts/:address/estimate-gas` | Gas estimate |
| `POST /api/chains/:chainId/contracts/:address/open-in-ide` | Build a remote-IDE URL |
| `POST /api/chains/:chainId/contracts/:address/clear-cache` | 🔒 **admin** — drop cached contract source |

## Storage

| Method & path | Notes |
| --- | --- |
| `GET /api/chains/:chainId/contracts/:address/storage-layout` | Fetched layout or `NOT_FOUND` cache marker |
| `GET /api/chains/:chainId/contracts/:address/storage/:slot` | Live slot read |
| `DELETE /api/chains/:chainId/contracts/:address/storage-layout/cache` | 🔒 **admin** — drop cached storage layout |

## Events (per contract)

Range-based manual indexing. `EventIndexingService` runs one serial job per range; on server start, ranges stuck in `indexing` are reconciled to `error` ("Interrupted by server restart — resume to continue"). Range bounds accept a block number or a tag (`latest`, `finalized`, `safe`, `earliest`); tags are resolved to concrete numbers once, at range creation, so stored ranges always carry concrete block numbers. The seven mutating routes below are opt-in gated — `x-admin-token` is required only when the server has `ADMIN_TOKEN` set.

| Method & path | Notes |
| --- | --- |
| `GET …/events?…` | Query indexed events; supports `argFilters`/`topicN` decoded-argument filtering pushed into DuckDB |
| `GET …/events/statistics` | Stats incl. the "Indexing coverage" metric (union of ranges, overlap-safe) |
| `GET …/events/indexing-status` | Current indexing job status |
| `GET …/events/export` | CSV stream of the filtered set; hard cap 100,000 rows → `400` (the UI disables the button above the cap preflight) |
| `GET …/events/ranges` | All ranges (UI polls every 3 s while indexing) |
| `POST …/events/ranges` | 🔐 Add a range |
| `POST …/events/ranges/quick` | 🔐 Quick-create; `mode`: `all` \| `recent` \| `first` \| `continue` \| `catchup` (`recent`/`first`/`continue` also need `blockCount`). `catchup` extends from the furthest block any existing range reached to head → `400 { "error": "No previous range found. Cannot catch up." }` with no prior ranges; `first` fails with "Contract creation block unknown — enter a start block manually" when the creation block can't be determined |
| `PATCH …/events/ranges/:rangeId` | 🔐 Update a range |
| `DELETE …/events/ranges/:rangeId` | 🔐 Delete a range |
| `POST …/events/ranges/:rangeId/start` / `pause` / `resume` | 🔐 Control indexing; `start`/`resume` return `202` immediately |

🔐 = `requireAdminTokenIfConfigured`: enforced only when `ADMIN_TOKEN` is set on the server.

## RPC configuration

`GET` is open (endpoint URLs only, no secrets — the RPC settings modal reads without a token). `POST`/`DELETE` use the opt-in gate: enforced only when `ADMIN_TOKEN` is set on the server. Managed in the ⚙️ RPC settings modal, which also holds the browser-side admin token.

| Method & path | Notes |
| --- | --- |
| `GET /api/rpc-configs` | List overrides |
| `POST /api/rpc-configs` | 🔐 Upsert `{ chainId, name, url, supportsHistory, maxEventRange }` |
| `DELETE /api/rpc-configs/:chainId` | 🔐 Remove override |

🔐 = `requireAdminTokenIfConfigured` (enforced only when `ADMIN_TOKEN` is set); 🔒 = `requireAdminToken` (fail-closed). See the Auth bullet at the top.

## Performance & debug

| Method & path | Notes |
| --- | --- |
| `GET /api/performance/events?chainId=` | 🔒 **admin** — performance metrics |
| `POST /api/performance/clear-cache` | 🔒 **admin** |
| `POST /api/performance/warmup` | 🔒 **admin** — cache warmup |
| `POST /debug/db/query` | ⚠️ **opt-in via `ENABLE_DEBUG_API=1`** — executes arbitrary SQL. Never enable on a reachable host |

## Errors

Failures return `{ "error": string }` — the human-readable reason — often alongside an optional `message` with more detail, and conventional status codes (`400` validation, `403` admin gate, `404` not found, `500` internal). The admin gate's 403 body explains how to enable admin operations. On the frontend, `toApiError` (`src/util/http.ts`) surfaces `message` when present and falls back to `error` verbatim, so the text in `error` reaches the user as-is.
