# API reference

The backend is a Hono app (`src/api-app.ts`) that mounts the route modules in `src/routes/`. This page documents the endpoints that actually exist; the route files are the source of truth.

- **Base URL**: `http://localhost:8201/api` (standalone server, `PORT`/`--port` override). In dev, the Vite server on `:3000` bridges the same app under `/api`.
- **Format**: JSON (CSV for the event export).
- **Auth**: read endpoints are open. Admin-gated endpoints require the `x-admin-token` header matching the server's `ADMIN_TOKEN` env (fail-closed: no token configured → 403). Event-indexing range writes are unauthenticated by design — single-user local trust model.
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

Range-based manual indexing. `EventIndexingService` runs one serial job per range; on server start, ranges stuck in `indexing` are reconciled to `error` ("Interrupted by server restart — resume to continue"). Range writes are **unauthenticated by design**.

| Method & path | Notes |
| --- | --- |
| `GET …/events?…` | Query indexed events; supports `argFilters`/`topicN` decoded-argument filtering pushed into DuckDB |
| `GET …/events/statistics` | Stats incl. the "Indexing coverage" metric (union of ranges, overlap-safe) |
| `GET …/events/indexing-status` | Current indexing job status |
| `GET …/events/export` | CSV stream of the filtered set; hard cap 100,000 rows → `400` (the UI disables the button above the cap preflight) |
| `GET …/events/ranges` | All ranges (UI polls every 3 s while indexing) |
| `POST …/events/ranges` | Add a range |
| `POST …/events/ranges/quick` | Quick-create modes |
| `PATCH …/events/ranges/:rangeId` | Update a range |
| `DELETE …/events/ranges/:rangeId` | Delete a range |
| `POST …/events/ranges/:rangeId/start` / `pause` / `resume` | Control indexing; `start`/`resume` return `202` immediately |

## RPC configuration 🔒

All three verbs are admin-gated (reads included). Managed in the ⚙️ RPC settings modal, which also holds the browser-side admin token.

| Method & path | Notes |
| --- | --- |
| `GET /api/rpc-configs` | List overrides |
| `POST /api/rpc-configs` | Upsert `{ chainId, name, url, supportsHistory, maxEventRange }` |
| `DELETE /api/rpc-configs/:chainId` | Remove override |

## Performance & debug

| Method & path | Notes |
| --- | --- |
| `GET /api/performance/events?chainId=` | 🔒 **admin** — performance metrics |
| `POST /api/performance/clear-cache` | 🔒 **admin** |
| `POST /api/performance/warmup` | 🔒 **admin** — cache warmup |
| `POST /debug/db/query` | ⚠️ **opt-in via `ENABLE_DEBUG_API=1`** — executes arbitrary SQL. Never enable on a reachable host |

## Errors

Failures return `{ "error": string }` (often with `message`) and conventional status codes (`400` validation, `403` admin gate, `404` not found, `500` internal). The admin gate's 403 body explains how to enable admin operations and is surfaced verbatim by the UI.
