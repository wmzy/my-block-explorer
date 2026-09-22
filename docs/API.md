# API reference

The backend is a Hono app (`src/api-app.ts`) that mounts the route modules in `src/routes/`. This page documents the endpoints that actually exist; the route files are the source of truth.

- **Base URL**: `http://localhost:8201/api` (standalone server, `PORT`/`--port` override). In dev, the Vite server on `:3000` bridges the same app under `/api`.
- **Format**: JSON (CSV for the event export).
- **Auth**: read endpoints are open. Writes/admin endpoints are gated in two tiers, both via the `x-admin-token` header matching the server's `ADMIN_TOKEN` env. 🔐 **Opt-in tier** (`requireAdminTokenIfConfigured` — enforced only when `ADMIN_TOKEN` is set; without it requests pass through, keeping the zero-config local trust model): event-range mutations, `POST`/`DELETE /api/rpc-configs`, contract `clear-cache`, storage-layout cache delete, and `open-in-ide` — all non-destructive or regenerative operations (dropped caches re-fetch from upstream; the IDE endpoint only builds a URL), so a token-less local session stays fully functional. 🔒 **Fail-closed tier** (`requireAdminToken` — no token configured → `403`): `/api/performance/*`, the admin/diagnostic surface.
- **Common response headers**: `X-Data-Source` (e.g. `database`, `rpc`, method tag), `X-Chain-Name`.
- **Chain IDs**: any chain defined in `viem/chains`. Unknown IDs → `400 { "error": "Unsupported chain" }` (chain-scoped search additionally returns `supportedChains`).

## Health & meta

| Method & path | Notes |
| --- | --- |
| `GET /api` | Endpoint index |
| `GET /api/health` | `{ status: "ok", adminTokenConfigured, debugApiEnabled, version, timestamp }` — used by frontend discovery; the two booleans let an operator verify the deployment posture from outside (see Startup security checks below) |

## Search

| Method & path | Notes |
| --- | --- |
| `GET /api/search?q={query}&chainId={id}` | Detects address / tx hash / block number. With a valid `chainId`, hash and block-number queries resolve **on that chain** directly; without one they return `needsChain` + `scope: "popular"` + `supportedChains` (the curated popular set — each entry `{ chainId, name, symbol }` — not the full chain universe; every other chain stays reachable via its per-chain pages/search endpoint) for the client-side network picker (addresses/free text fall back to mainnet and echo `searchedChainId`). When suggestions are present the response also carries `suggestionsChainId` — the chain the suggestion data (latest block / recent txs) actually resolved on — so links never guess the chain. Response may carry `degraded: true` + `degradedReasons: string[]` when an upstream lookup failed, and `message` (e.g. ENS names are resolved client-side, not by the server) |
| `GET /api/chains/:chainId/search?q={query}` | Chain-scoped variant; also echoes `suggestionsChainId` (`number \| null`, equals the path chain when suggestion data exists) |

## Stats & blocks & transactions

| Method & path | Notes |
| --- | --- |
| `GET /api/stats/overview` | Aggregate stats across popular chains |
| `GET /api/chains/:chainId/blocks/latest` | Latest block |
| `GET /api/chains/:chainId/blocks/:blockNumber` | Block by height |
| `GET /api/chains/:chainId/blocks?limit=&offset=` | Block list |
| `GET /api/chains/:chainId/blocks/stream` | **SSE** (`hono/streaming` streamSSE): one `block` event per new block (`{number, hash, parentHash, timestamp, miner, transactionCount, gasUsed, gasLimit, baseFeePerGas?, sizeBytes?}`); the connect-time head is a baseline (no event). Heartbeat comment every 15s; catch-up capped at the 10 newest blocks after a stall; reorg head-drops resync the baseline. Unknown chain / no RPC client / 10 consecutive head-poll failures → one `error` event, then close. Clean close on client abort. Rate limit 12/min · burst 6 (a 429 lets the frontend fall back to its normal polling silently) |
| `GET /api/chains/:chainId/transactions/:hash` | Transaction detail |
| `GET /api/chains/:chainId/transactions?limit=&offset=` | Transaction list. `offset` clamped to 100,000 (beyond → `400`); `limit` must be a positive integer and is clamped to 100 — non-numeric/non-positive → `400 { "error": "invalid_limit" }` |

## Addresses

| Method & path | Notes |
| --- | --- |
| `GET /api/chains/:chainId/addresses/:address` | Persistent data only — **no balance, no transaction count**; the UI reads those live from RPC |
| `GET /api/chains/:chainId/addresses/:address/persistent` | Same data, explicit |
| `GET /api/chains/:chainId/addresses/:address/transactions?limit=&page=&window=` | Heuristic history (balance-change binary search). `limit` ≤ 50, `page` ≥ 1; non-numeric values → `400` (`invalid_page` / `invalid_limit`). Reports `method`, `coverage` (`complete`/`partial`/`none`), `reason`, `searchWindowBlocks`; unknown coverage renders a "source unknown" banner in the UI. `total` is the count of **discovered** transactions (never the nonce); the heuristic never reports `complete` (nonce=0 → `partial`/`no-outgoing-transactions` — incoming activity is undetectable). Optional `window` (blocks, clamped 1–50,000,000) widens the search range; results are cached per address+window (~60s) so consecutive pages agree |
| `GET /api/chains/:chainId/addresses/:address/transfers?cursor=&limit=&window=&refresh=1` | On-demand token-transfer scan (ERC-20/721/1155 via `eth_getLogs`, no DuckDB writes). Reports `coverage` (`complete`/`partial` — the scan budget or window bounded it) and `windowBlocks`. `window` widens the scanned range (the UI's "Search deeper" quadruples it); `refresh=1` (literal `1` only) skips the ~60s scan cache so the Retry button genuinely re-scans instead of re-serving a cached partial page |
| `GET /api/chains/:chainId/addresses/:address/transactions?balanceHistory=1` | Same discovery as above plus two additive fields, present **only** when the param is the literal `1` (otherwise the payload is byte-identical): `balancePoints` (chronological `{blockNumber, timestamp, cumulativeValue}` series over the full cached discovered set — the first point anchors at `0` = discovered change *before* the oldest discovered tx, absolute balance there is unknowable) and `balancePointsCount`. Native-value deltas only, BigInt-exact; the UI's chart anchors the series to the live RPC balance |
| `GET /api/chains/:chainId/addresses/:address/approvals?window=&refresh=1` | Read-only ERC-20 approvals viewer: owner-filtered `Approval` getLogs sweep (adaptive chunking, provider-ceiling memory) → distinct `(token, spender)` pairs (newest-first, `pairCount` pre-cap) → Multicall3 `allowance()` reads at head (batches of 50, capped at 100 pairs → `truncated: true`). `allowance` is a BigInt-exact decimal string, `isMax` covers ≥2¹²⁸ sentinels; zero-current grants are omitted (still counted in `pairCount`). `window` clamps 1–50,000,000 (default 100,000); `refresh=1` bypasses the ~60s cache (re-scans and overwrites `scannedAt`). `coverage` is `complete` (window fully swept — never full history) / `partial` (budget-bound) / `scan-failed` (keeps earlier finds); `reason: "allowance-read-failed"` = discovery ok but current-value reads failed (`approvals: []`). No revoke plumbing — the UI links out to revoke.cash. Rate limit 10/min · burst 3 |

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
| `POST /api/chains/:chainId/contracts/:address/open-in-ide` | 🔐 **admin (opt-in)** — build a remote-IDE URL |
| `POST /api/chains/:chainId/contracts/:address/clear-cache` | 🔐 **admin (opt-in)** — drop cached contract source (regenerates on next fetch) |

## Storage

| Method & path | Notes |
| --- | --- |
| `GET /api/chains/:chainId/contracts/:address/storage-layout` | Fetched layout or `NOT_FOUND` cache marker |
| `GET /api/chains/:chainId/contracts/:address/storage/:slot` | Live slot read |
| `DELETE /api/chains/:chainId/contracts/:address/storage-layout/cache` | 🔐 **admin (opt-in)** — drop cached storage layout (regenerates on next fetch) |

## Events (per contract)

Range-based manual indexing. `EventIndexingService` runs one serial job per range; on server start, ranges stuck in `indexing` are reconciled to `error` ("Interrupted by server restart — resume to continue"). Range bounds accept a block number or a tag (`latest`, `finalized`, `safe`, `earliest`); tags are resolved to concrete numbers once, at range creation, so stored ranges always carry concrete block numbers. The seven mutating routes below are opt-in gated — `x-admin-token` is required only when the server has `ADMIN_TOKEN` set.

**Reorg reconciliation**: rows indexed below the finalized head are kept as `isFinalized = false`. At server start and after each range job finishes, unfinalized rows at/below the current finalized head are re-verified against their transaction receipts (oldest-first, capped at 500 rows per pass): rows whose receipt vanished or no longer contains the log are deleted (reorged out), survivors are promoted to finalized. Rows above the finalized head keep the `unfinalized` badge in the UI, and the CSV export carries an `is_finalized` column.

| Method & path | Notes |
| --- | --- |
| `GET …/events?…` | Query indexed events; supports `argFilters`/`topicN` decoded-argument filtering pushed into DuckDB. `pageSize` clamped to 1,000. Failures return `500 { "error": "internal_error", "message": "Failed to query contract events" }` — never a success-shaped empty page |
| `GET …/events/statistics` | Stats incl. the "Indexing coverage" metric (union of ranges, overlap-safe) |
| `GET …/events/indexing-status` | Current indexing job status. Failures return `503 { "error": "indexing_status_unavailable", "message": <cause> }` — never a zeroed status object |
| `GET …/events/export` | CSV stream of the filtered set; hard cap 100,000 rows → `400` (the UI disables the button above the cap preflight) |
| `GET …/events/ranges` | All ranges (UI polls every 3 s while indexing) |
| `POST …/events/ranges` | 🔐 Add a range |
| `POST …/events/ranges/quick` | 🔐 Quick-create; `mode`: `all` \| `recent` \| `first` \| `continue` \| `catchup` (`recent`/`first`/`continue` also need `blockCount`). `catchup` extends from the furthest block any existing range reached to head → `400 { "error": "No previous range found. Cannot catch up." }` with no prior ranges; `first` fails with "Contract creation block unknown — enter a start block manually" when the creation block can't be determined |
| `PATCH …/events/ranges/:rangeId` | 🔐 Update a range |
| `DELETE …/events/ranges/:rangeId` | 🔐 Delete a range |
| `POST …/events/ranges/:rangeId/start` / `pause` / `resume` | 🔐 Control indexing; `start`/`resume` return `202` immediately. An unknown `rangeId` on `start`/`pause`/`resume`/`DELETE` → `404 { "error": "Range not found" }`; invalid states (already indexing/completed, resuming a non-paused range, deleting while indexing) → `400` |

🔐 = `requireAdminTokenIfConfigured`: enforced only when `ADMIN_TOKEN` is set on the server.

## RPC configuration

`GET` returns endpoint URLs **redacted to scheme + host** for anything that cannot vouch for itself: the full URL (which often embeds provider API keys in the path/query) is visible only to (a) requests whose `Origin` is allowlisted by the CORS policy, or (b) `Origin`-less requests arriving over a **loopback socket** (e.g. `curl` from the same machine — CORS cannot help non-browser clients, so a loopback source address is the trust signal). Every config entry carries `urlRedacted: boolean` so clients can tell. `POST`/`DELETE` use the opt-in gate: enforced only when `ADMIN_TOKEN` is set on the server. Managed in the ⚙️ RPC settings modal (saved configs apply to the backend for **all** users — the server-wide RPC hot-reloads), which also holds the browser-side admin token (verified against the server on save).

| Method & path | Notes |
| --- | --- |
| `GET /api/rpc-configs` | List overrides |
| `POST /api/rpc-configs` | 🔐 Upsert `{ chainId, name, url, supportsHistory, maxEventRange }`. Validation: `chainId` a positive integer naming a supported chain, `url` an absolute http(s) URL, `name` a string, `supportsHistory`/`maxEventRange` (when present) a boolean / positive integer — violations → `400` with a machine-readable `code` (`invalid_chain_id` / `invalid_url` / `invalid_name` / `invalid_fields` / `missing_fields` / `invalid_json`). Response: `{ success: true, action: "created" \| "replaced" }` |
| `DELETE /api/rpc-configs/:chainId` | 🔐 Remove override |

🔐 = `requireAdminTokenIfConfigured` (enforced only when `ADMIN_TOKEN` is set); 🔒 = `requireAdminToken` (fail-closed). See the Auth bullet at the top.

## Performance & debug

| Method & path | Notes |
| --- | --- |
| `GET /api/performance/events?chainId=` | 🔒 **admin** — performance metrics |
| `POST /api/performance/clear-cache` | 🔒 **admin** |
| `POST /api/performance/warmup` | 🔒 **admin** — cache warmup |
| `POST /debug/db/query` | ⚠️ **opt-in via `ENABLE_DEBUG_API=1`** — executes arbitrary SQL; gated by the opt-in admin tier (`x-admin-token` required when `ADMIN_TOKEN` is set). The server **refuses to start** with the debug API enabled on a non-loopback bind unless `ALLOW_INSECURE_START=1`; still, never enable it on a reachable host |

## Rate limiting & startup security checks

Compute-heavy read endpoints are throttled by an in-process token-bucket middleware (`src/middleware/rate-limit.ts`, keyed by remote IP; a shared per-endpoint bucket when the socket address is unavailable). Over-limit requests get `429 { "error": "rate_limited", "message", "retryAfterSeconds" }` plus a `Retry-After` header. Buckets (requests/minute · burst): events `export` 5·2, address `transactions` 10·3, `transfers` 10·3, address `approvals` 10·3, blocks `stream` 12·6, global `search` 30·10, contract `read`/`simulate` 60·20. Set `RATE_LIMIT_DISABLED=1` to disable (e.g. for load tests).

At startup (`src/startupChecks.ts`, before `listen`): binding a **non-loopback `HOST`** without `ADMIN_TOKEN` logs a loud multi-line security warning listing the exposed write endpoints; non-loopback + `ENABLE_DEBUG_API=1` refuses to start unless `ALLOW_INSECURE_START=1`. `HOST` now actually controls the bind address (it was previously ignored). `500` bodies are always the generic `{ "error": "internal_error", "message": "Internal Server Error" }` — internal details go to the server log only.

## Errors

Failures return `{ "error": string }` — the human-readable reason — often alongside an optional `message` with more detail, and conventional status codes (`400` validation, `403` admin gate, `404` not found, `500` internal). The admin gate's 403 body explains how to enable admin operations. On the frontend, `toApiError` (`src/util/http.ts`) surfaces `message` when present and falls back to `error` verbatim, so the text in `error` reaches the user as-is.
