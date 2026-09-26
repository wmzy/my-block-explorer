# API reference

The backend is a Hono app (`src/api-app.ts`) that mounts the route modules in `src/routes/`. This page documents the endpoints that actually exist; the route files are the source of truth.

- **Base URL**: `http://localhost:8201/api` (standalone server, `PORT`/`--port` override). In dev, the Vite server on `:3000` bridges the same app under `/api`.
- **Format**: JSON (CSV for the event export).
- **Auth**: read endpoints are open. Writes/admin endpoints are gated in two tiers, both via the `x-admin-token` header matching the server's `ADMIN_TOKEN` env. 🔐 **Opt-in tier** (`requireAdminTokenIfConfigured` — enforced only when `ADMIN_TOKEN` is set; without it requests pass through, keeping the zero-config local trust model): event-range mutations, `POST`/`DELETE /api/rpc-configs`, contract `clear-cache`, storage-layout cache delete, and `open-in-ide` — all non-destructive or regenerative operations (dropped caches re-fetch from upstream; the IDE endpoint only builds a URL), so a token-less local session stays fully functional. 🔒 **Fail-closed tier** (`requireAdminToken` — no token configured → `403`): `/api/performance/*`, the SQL console (`POST /api/sql/query`, `GET /api/sql/tables`), the admin/diagnostic surface.
- **Common response headers**: `X-Data-Source` (e.g. `database`, `rpc`, method tag), `X-Chain-Name`.
- **Chain IDs**: any chain defined in `viem/chains` (plus user-registered custom chains — see [Custom chains](#custom-chains)). Unknown IDs → `400 { "error": "Unsupported chain" }` (chain-scoped search additionally returns `supportedChains`).

## Health & meta

| Method & path | Notes |
| --- | --- |
| `GET /api` | Endpoint index |
| `GET /api/health` | `{ status: "ok", adminTokenConfigured, debugApiEnabled, version, timestamp }` — used by frontend discovery; the two booleans let an operator verify the deployment posture from outside (see Startup security checks below) |
| `GET /api/openapi.json` | OpenAPI 3.1 description of the API surface (hand-maintained spec; this page + the route files remain the source of truth — the spec's own `info.description` says so). Open, `Cache-Control: public, max-age=3600`, relative `servers: [{url: '/api'}]` so it works on any host/port; `info.version` reads the app version |

## Search

| Method & path | Notes |
| --- | --- |
| `GET /api/search?q={query}&chainId={id}` | Detects address / tx hash / block number. With a valid `chainId`, hash and block-number queries resolve **on that chain** directly; without one they return `needsChain` + `scope: "popular"` + `supportedChains` (the curated popular set — each entry `{ chainId, name, symbol }` — not the full chain universe; every other chain stays reachable via its per-chain pages/search endpoint) for the client-side network picker (addresses/free text fall back to mainnet and echo `searchedChainId`). When suggestions are present the response also carries `suggestionsChainId` — the chain the suggestion data (latest block / recent txs) actually resolved on — so links never guess the chain. Response may carry `degraded: true` + `degradedReasons: string[]` when an upstream lookup failed, and `message` (e.g. ENS names are resolved client-side, not by the server). Free-text responses additionally carry `tokenHits` (≤5, `{chainId, address, matchText, source: 'known-token' \| 'label'}`): curated known-token **symbol** matches (the `POPULAR_CHAINS` curation in `src/config/knownTokens.ts` — a display hint, not a token index) merged with this chain's `address_labels` rows matching on label text; when one address hits both sources the label wins. The field is dropped entirely on a failed labels read (absent ≠ empty); hash/block/address/ENS responses never carry it |
| `GET /api/chains/:chainId/search?q={query}` | Chain-scoped variant; also echoes `suggestionsChainId` (`number \| null`, equals the path chain when suggestion data exists) |

## Signatures

Function-selector / event-topic0 lookup against [openchain.xyz](https://openchain.xyz)'s signature database, cached in the `signature_cache` DuckDB table (verified rows immutable; `NOT_FOUND` 24h TTL). Feeds the tx-list Method column, raw-log topic0 chips, the Interact form and the `/signatures` page.

| Method & path | Notes |
| --- | --- |
| `GET /api/signatures?function=&event=` | Repeatable params per kind, batch ≤ 25 unique selectors. Malformed selectors → `400 invalid_selector`; over the batch cap → `400 too_many_selectors`. `200 { results: { [selector]: outcome } }` where an outcome is a hit (`{ kind, signatures: string[], source: 'openchain' }` — names like `transfer(address,uint256)`), a miss (`{ kind, signatures: [], notFound: true }`), or — when upstream is down — `{ unavailable: true }` for that selector: an upstream failure degrades per-selector, never a 500 |

## Stats & blocks & transactions

| Method & path | Notes |
| --- | --- |
| `GET /api/stats/overview` | Aggregate stats across popular chains |
| `GET /api/chains/:chainId/blocks/latest` | Latest block |
| `GET /api/chains/:chainId/blocks/:blockNumber` | Block by height |
| `GET /api/chains/:chainId/blocks?limit=&offset=` | Block list |
| `GET /api/chains/:chainId/blocks/stream` | **SSE** (`hono/streaming` streamSSE): one `block` event per new block (`{number, hash, parentHash, timestamp, miner, transactionCount, gasUsed, gasLimit, baseFeePerGas?, sizeBytes?}`); the connect-time head is a baseline (no event). Heartbeat comment every 15s; catch-up capped at the 10 newest blocks after a stall; reorg head-drops resync the baseline. Unknown chain / no RPC client / 10 consecutive head-poll failures → one `error` event, then close. Clean close on client abort. Rate limit 12/min · burst 6 (a 429 lets the frontend fall back to its normal polling silently). When watch subscriptions exist for the chain, the same stream also emits named `watch` events (`{kind:'log'\|'gap', chainId, address, blockNumber, txHash, logIndex, topic0, emitter}` / `{kind:'gap', fromBlock, toBlock}` — decimal strings for bigints) as the backend's WatchService discovers logs for subscribed addresses |
| `GET /api/chains/:chainId/watch` | Server-side watch subscriptions (open read, `no-store`): `{ subscriptions: [{ chainId, address, label, webhookUrl, webhookStatus ('ok' \| 'failed: …' \| null), webhookLastAt, lastProcessedBlock (decimal string \| null until the first tick baselines the row), createdAt, updatedAt }] }`, oldest-first. Webhook fields are `null` when no webhook is configured (and absent-compatible on pre-0015 backends) |
| `PUT /api/chains/:chainId/watch/:address` | 🔐 **admin (opt-in)** + 5/min·burst 2 — upsert a subscription. Body `{ label?: string \| null, webhookUrl?: string \| null }` (label ≤100 chars; webhook must be http(s) ≤512 chars else `400 invalid_webhook_url`; null/empty string clears; absent = unchanged). Cap 25 per chain (`400 watch_full`). Requires a configured RPC for the chain (`400 no_rpc_config` naming it). Watching starts at the subscription moment — it never walks history; gaps wider than 200 blocks are skipped and reported as `gap` events. Runs while the local backend runs |
| `DELETE /api/chains/:chainId/watch/:address` | 🔐 **admin (opt-in)** — remove a subscription (`204`; unknown address → `404`) |
| `GET /api/chains/:chainId/watch/events?limit=` | Recent watch events from the per-chain ring buffer (last 100 kept), newest-first; `limit` default 25, cap 100 |
| `GET /api/chains/:chainId/transactions/:hash` | Transaction detail |
| `GET /api/chains/:chainId/transactions?limit=&offset=` | Transaction list. `offset` clamped to 100,000 (beyond → `400`); `limit` must be a positive integer and is clamped to 100 — non-numeric/non-positive → `400 { "error": "invalid_limit" }` |

Watch **webhook delivery** (`src/utils/webhooks.ts`): a subscription with a `webhookUrl` receives one `POST` per new event (same `chain:txHash:logIndex` dedupe basis as the SSE frames; at-least-once within the cursor window, replays deduped) with `{id, chainId, address, eventName, args (BigInt→decimal string), blockNumber, transactionHash, logIndex, detectedAt}`. `discord.com/api/webhooks` URLs get a Discord embed (with the chain explorer's tx link) instead of raw JSON. 5s timeout, exactly one retry, then the failure is recorded on the row (`webhookStatus`/`webhookLastAt`) and logged via pino — never fatal to the tick. No SSRF filtering by design: single-user local tool, admin-gated write — only point it at endpoints you trust

## Addresses

| Method & path | Notes |
| --- | --- |
| `GET /api/chains/:chainId/addresses/:address` | Persistent data only — **no balance, no transaction count**; the UI reads those live from RPC |
| `GET /api/chains/:chainId/addresses/:address/persistent` | Same data, explicit |
| `GET /api/chains/:chainId/addresses/:address/transactions?limit=&page=&window=` | Heuristic history (balance-change binary search). `limit` ≤ 50, `page` ≥ 1; non-numeric values → `400` (`invalid_page` / `invalid_limit`). Reports `method`, `coverage` (`complete`/`partial`/`none`), `reason`, `searchWindowBlocks`; unknown coverage renders a "source unknown" banner in the UI. `total` is the count of **discovered** transactions (never the nonce); the heuristic never reports `complete` (nonce=0 → `partial`/`no-outgoing-transactions` — incoming activity is undetectable). Optional `window` (blocks, clamped 1–50,000,000) widens the search range; results are cached per address+window (~60s) so consecutive pages agree. **Deep scan integration**: when a scan job row exists the response carries `deepScan` (the job DTO — see the scan endpoints below; key absent otherwise, legacy responses byte-identical), persisted scan findings merge into the list (heuristic ∪ findings, dedup by hash, blockNumber desc, `total` = merged count), and a genesis-anchored completed job is the **only** sanctioned `coverage: 'complete'` path (`reason: 'deep-scan'`) |
| `GET /api/chains/:chainId/addresses/:address/transfers?cursor=&limit=&window=&refresh=1&mode=` | On-demand token-transfer scan (ERC-20/721/1155 via `eth_getLogs`, no DuckDB writes). `mode`: `participant` (default — logs touching the address) \| `token` (logs **emitted by** the address as a token contract, Transfer topic0 whitelist, no participant topics; the token-page lens). Invalid → `400 invalid_mode`; cache keys include the mode. Reports `coverage` (`complete`/`partial` — the scan budget or window bounded it) and `windowBlocks`. `window` widens the scanned range (the UI's "Search deeper" quadruples it); `refresh=1` (literal `1` only) skips the ~60s scan cache so the Retry button genuinely re-scans instead of re-serving a cached partial page. Rows carry `logStandard: 'erc20' \| 'erc721' \| 'erc1155'` — the standard the log shape alone proves (shared Transfer topic0 by indexed-topic count; 1155 by its own topic0s); absent on legacy cached payloads. The UI's standard filter chips read it |
| `GET /api/chains/:chainId/addresses/:address/transactions?balanceHistory=1` | Same discovery as above plus two additive fields, present **only** when the param is the literal `1` (otherwise the payload is byte-identical): `balancePoints` (chronological `{blockNumber, timestamp, cumulativeValue}` series over the full cached discovered set — the first point anchors at `0` = discovered change *before* the oldest discovered tx, absolute balance there is unknowable) and `balancePointsCount`. Native-value deltas only, BigInt-exact; the UI's chart anchors the series to the live RPC balance |
| `GET /api/chains/:chainId/addresses/:address/transactions?fromAddress=&toAddress=&minValue=&maxValue=` | **Additive filters** applied server-side over the SAME cached discovered set for the current window — no new scan, cache key unchanged. `fromAddress`/`toAddress` validated two-tier (`400 invalid_address`); `minValue`/`maxValue` are non-negative integer **wei** strings compared BigInt-exactly and inclusively (`400 invalid_value` on negative/fraction/NaN). With any filter present the response carries `filtersApplied` (echoed as received) and `total`/pagination describe the filtered view; coverage semantics unchanged — a filter never claims completeness. Absent params → payload byte-identical to the unfiltered endpoint (pinned by test). Contract-creation rows (empty `toAddress`) never match a `toAddress` filter. The UI rides the filters on the URL (`?tfFrom=` etc., and `?tfMethod=` for the selector filter) so filtered views are shareable. **Method filter** (`method=`): a 4-byte function selector `0x[0-9a-fA-F]{8}` (`400 invalid_method` otherwise), matched lowercase-exact against an additive `selector` field the rows now carry (`0x`+8 lowercase hex; `null` for plain transfers and contract creations; absent on legacy cached payloads — those rows are honestly excluded from a method match, never guessed in) |
| `GET /api/chains/:chainId/addresses/:address/approvals?window=&refresh=1` | Read-only approvals viewer across token standards: owner-filtered `Approval` **and** `ApprovalForAll` getLogs sweeps (adaptive chunking, provider-ceiling memory) → distinct pairs/triples (newest-first, `pairCount` pre-cap) → Multicall3 current-state reads at head (batches of 50, capped at 100 across all kinds → `truncated: true`). Every row carries `kind`: `erc20` (`(token, spender)` pair, `allowance(owner, spender)`; `allowance` is a BigInt-exact decimal string, `isMax` covers ≥2¹²⁸ sentinels), `erc721` (shares the ERC-20 `Approval` topic0 — split by indexed-topic count; `(token, spender, tokenId)` triple, `getApproved(tokenId)`; live only while it still names the spender), `erc1155` (`(token, operator)` pair, `isApprovedForAll`; live only on `true`). For the NFT kinds `allowance`/`isMax` are **scope sentinels, not chain-read amounts** (`erc721`: `'1'`/`false` = exactly one token id; `erc1155`: `'1'`/`true` = every token id) — views render per kind. Zero-current/dead grants are omitted (still counted in `pairCount`). `window` clamps 1–50,000,000 (default 100,000); `refresh=1` bypasses the ~60s cache (re-scans and overwrites `scannedAt`). `coverage` is `complete` (window fully swept — never full history) / `partial` (budget-bound) / `scan-failed` (keeps earlier finds); `reason: "allowance-read-failed"` = discovery ok but current-value reads failed (`approvals: []`). Revocations go through the Interact tab: the UI deep-links each row to `/contract/:token?tab=interact&revoke=…` (prefilled `approve(spender, 0)` / `approve(0x0, tokenId)` / `setApprovalForAll(operator, false)` on the existing wallet-send form); revoke.cash stays as the external escape hatch. Rate limit 10/min · burst 3. Additive `history` + `historyTruncated`: the raw swept approval events (newest-first, cap 200) as `{kind, approvalEvent: 'Approval' \| 'ApprovalForAll', token, owner, spender, blockNumber, txHash, value: decimal string \| null}` — values as granted at the time, not current allowances; both keys omitted when empty |
| `POST …/addresses/:address/scan` | 🔐 **admin (opt-in)** + 3/min·burst 2 — start a **deep scan** job (persistent, resumable address tx discovery). Body `{fromBlock?: number \| 'earliest' (default earliest), toBlock?: number \| 'latest' (default latest), force?: boolean}`; tag bounds resolve once at creation. `202 {job}` created · `200 {job}` idempotent (equal bounds; also restarts an errored/paused job from its checkpoint) · `400 invalid_bounds` · `400 scan_conflict` (different bounds without `force` — force replaces bounds, wipes findings, resets the cursor). `job = {status: pending\|running\|paused\|error\|complete, fromBlock, toBlock, cursorBlock, blocksWalked, blocksTotal, txsFound, errorMessage, coverage, updatedAt}`; forward walk (balance checkpoints at adaptive 50k-block batches, halving on provider range errors; binary-searched change blocks scanned for the address; findings persisted in DuckDB). Archive-class provider errors → `error` with the verbatim message — never a silent `complete`. `coverage: 'complete'` **only** when finished AND `fromBlock === 0` (the only provable bound). One serial loop per address (max 2 concurrent), progress checkpointed every segment; restart reconciliation mirrors event ranges. Needs an archive-capable RPC; runs only while the backend runs |
| `GET …/addresses/:address/scan` | Open read — `200 {job}` \| `404 {error: 'no_scan_job'}` |
| `POST …/scan/pause` / `…/scan/resume` | 🔐 Control (`202 {job}`); `400 invalid_state` when not running / not paused (errored jobs recover via same-bounds `POST …/scan`) |
| `POST …/scan/catchup` | 🔐 Same admin gate + shared 3/min·burst 2 write bucket — extend a settled walk's `toBlock` to the **current chain head**, preserving cursor + findings (no re-walk; `blocksTotal` recomputed so progress dips honestly). `202 {job}` (a completed walk requeues as `pending` and resumes from `cursor + 1`; paused/errored rows keep their status) · `404 {error: 'no_scan_job'}` · `400 invalid_state` when running ("Scan is running — wait for it to finish or pause it first") · `400 already_caught_up` ("Scan is already at the chain head") |
| `DELETE …/addresses/:address/scan` | 🔐 Remove the job row **and** its findings (`204`, idempotent) |
| `GET …/addresses/:address/scan/internal-transactions` | Deep-scan recorded internal transactions (`address_scan_internal_txs`, traced at scan time over each **change block** — not every block). `limit` default 50, cap 100 (`limit=abc` → `400`); unknown address / no scan → `200 { transactions: [] }` (an explicit empty answer). Rows carry the tx hash, trace path, from/to, value |
| `GET …/addresses/:address/transactions/export` | CSV stream of the current discovered window (same discovery + window semantics as the JSON endpoint). Hard cap 50,000 rows → `400` above it; an empty window streams a header-only file. Rate limit 5/min · burst 2 |

## Labels (address annotations)

Per-address notes pinned to one chain, plus the cross-chain list used by the backup/restore feature. Storage keys are lowercase; `source: 'builtin' \| 'user'` (builtin seeds ship in `src/config/builtinLabels.ts`; PUT converts a builtin row to user — user intent wins).

| Method & path | Notes |
| --- | --- |
| `GET /api/chains/:chainId/labels/:address` | Open read; a missing label is `404 {error: 'label_not_found'}` (an explicit absent answer, never 200-with-nulls) |
| `PUT /api/chains/:chainId/labels/:address` | 🔐 **admin (opt-in)** — upsert, full-replace semantics. Body `{label: 1–64 chars, note?: ≤500 chars}`; violations → `400 invalid_label` |
| `DELETE /api/chains/:chainId/labels/:address` | 🔐 **admin (opt-in)** — `204`; absent label → `404` (idempotence would hide typos) |
| `GET /api/labels` | 🔐 **admin (opt-in)** + 10/min·burst 3, `no-store` — list **all** rows across chains: `{labels: [{chainId, address, label, note, source, updatedAt}]}` ordered by (chainId, address). Backs the settings modal's Backup & restore export |

## SQL console (local DuckDB)

Read-only query surface over the explorer's own main DuckDB (not the per-chain event files) — the `/sql` page's backend. 🔒 **Fail-closed admin tier**: `ADMIN_TOKEN` must be set on the server (local power users configure one; the UI renders setup guidance otherwise).

| Method & path | Notes |
| --- | --- |
| `POST /api/sql/query` | 🔒 **admin** + 6/min·burst 3 — body `{sql}`; single statement only, must start with `SELECT`/`WITH`, 22 DML/DDL/attach keywords rejected anywhere (conservative word-token match). `200 {columns (deduped DuckDB-style a, a:1), rows, rowCount, truncated}` — capped at 500 rows (`truncated: true` beyond; the read stops at the covering chunk, giant results never materialize); cells normalized for JSON (bigint→string, Date→ISO UTC, binary→0x-hex). Bad SQL / rejected shape → `400 {error: 'invalid_query', message: <real DuckDB error>}` |
| `GET /api/sql/tables` | 🔒 **admin** — `{tables: [{table, columns}]}` from `information_schema` (schema `main`) |

## Ops overview (local operator dashboard)

The `/ops` page's backend (`src/routes/ops.ts`, `src/services/OpsService.ts`) — a one-glance dashboard for whoever runs this explorer (storage sizes, indexing/watch/rate-limit/deep-scan status, backup guidance). 🔐 **Opt-in admin tier** — unlike the SQL console this is read-only stats, so zero-config local sessions can use it; it enforces identically once `ADMIN_TOKEN` is set. Rate limit 6/min·burst 3.

| Method & path | Notes |
| --- | --- |
| `GET /api/ops/summary` | Sections assembled with `Promise.allSettled` — a failing section degrades to `{error: 'unavailable'}` for that key only, never a 500: `meta` (version, uptimeSeconds, timestamp), `storage` (mainDbBytes, per-chain `{chainType, name, chainId, bytes, mtime}` derived from the `data/chains/{type}/{name}-{id}.db` filenames, solcCache `{files, bytes}`), `indexing` (per-chain range counts by status), `watch` (`{chainId, address, webhookConfigured}` per subscription — reads the table directly; degrades to unavailable on a pre-0015 DB), `rateLimit` (per-bucket totals via `getRateLimitStats()` — hits/rejected counts only, no per-client data), `deepScan` (address-scan-job counts by status) |

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
| `POST /api/chains/:chainId/contracts/:address/simulate` | eth_call simulation. Body `{ functionName, args?, value?, from?, stateOverride? }` — `stateOverride` is an optional foundry-style map `{ "0xAddress": { balance?/nonce?: hex quantity, code?: hex bytes, state?/stateDiff?: { "0x32-byte-slot-hex": "0x32-byte-value-hex" } } }`. It is applied by the node **for this call only** — a simulation aid, never persisted on-chain. Caps: ≤ 10 addresses per request, ≤ 32 slots per `state`/`stateDiff` map. Absent or `{}` behaves exactly like before; anything invalid (wrong types, leading-zero quantities, odd-length bytecode, wrong-size slots, unknown fields, empty entries, over-cap) → `400 { "error": "invalid_state_override", "details": ["0xAddr.field: sentence", …] }`. Support depends on the upstream RPC |
| `POST /api/chains/:chainId/contracts/:address/estimate-gas` | Gas estimate. Same body as `simulate`, including the optional `stateOverride` map (same validation rules, caps, and `400 invalid_state_override` details) — the override scopes the estimate to this call only and is never persisted; support depends on the upstream RPC |
| `POST /api/chains/:chainId/contracts/:address/open-in-ide` | 🔐 **admin (opt-in)** — build a remote-IDE URL |
| `POST /api/chains/:chainId/contracts/:address/clear-cache` | 🔐 **admin (opt-in)** — drop cached contract source (regenerates on next fetch) |
| `POST /api/chains/:chainId/contracts/:address/verify` | 🔐 **admin (opt-in)**, rate-limited (3/min·1) — submit a Sourcify verification bundle `{ files: { 'metadata.json': string, … } }` through the backend. `200 { verified: true, status: 'perfect' \| 'partial', verificationStatus? }`, `200 { verified: false, kind: 'unsupported_chain' \| 'rejected', message }` (Sourcify's words), `400 invalid_files`, `502 sourcify_unreachable` |
| `POST /api/chains/:chainId/contracts/:address/verify/manual` | 🔐 **admin (opt-in)**, same rate limiter — save a **local-trust mark** for contracts the remote verifiers cannot cover (anvil/hardhat/private deployments). Body `{ abi: string, sourceCode?: string, name?: string }`; `abi` must parse to a non-empty array (`400 missing_fields` / `400 invalid_abi` otherwise). The mark stores `verificationStatus: 'verified'` + `verificationSource: 'manual'` — an annotation by the local operator, **not cryptographic verification**. Response carries the freshly re-read `contractSource`. GET re-probes Sourcify once per unverified TTL (1h); a remote match supersedes the mark |
| `DELETE /api/chains/:chainId/contracts/:address/verify/manual` | 🔐 **admin (opt-in)** — remove the local-trust mark; the next GET re-probes remote verifiers. Deletes only rows with `verificationSource: 'manual'` — a sourcify/blockscan row answers `404 { error: 'not_found' }` and stays intact |
| `GET /api/chains/:chainId/contracts/:address/verify/compilers` | Open read, 24h server cache — solc build list from `binaries.soliditylang.org/wasm/list.json` → `200 { versions: [{ version, longVersion, prerelease }], degraded? }`; offline → `502 compilers_unavailable` (degraded answers re-probe after 5min) |
| `POST /api/chains/:chainId/contracts/:address/verify/compile` | 🔐 **admin (opt-in)** + the shared 3/min verify limiter — **local compile verification** (works on chains Sourcify does not cover). Body `{ compilerVersion, standardJsonInput, contractName? }`; `standardJsonInput` accepts a Hardhat build-info file verbatim (its `input` member is unwrapped). The backend downloads the exact solc wasm build from the official list (sha256-verified, cached under `data/solc-cache` — internet needed once per version), compiles, and matches the runtime bytecode against this chain's RPC. `200 { verified: true, tier: 'exact' \| 'matches-metadata-only', contractName, compilerVersion, comparison{...}, warnings, verificationStatus?, contractSource? }` — any match tier persists `verificationSource: 'local-compile'` and clears the source cache exactly like the Sourcify flow; `200 { verified: false, kind: 'mismatch'\|'compile_error'\|'no_contracts'\|'no_runtime_bytecode', ... }`; `400 invalid_input`/`contract_name_required`/`unknown_contract`/`not_a_contract`; `502 compilers_unavailable`/`compiler_unavailable`/`rpc_unavailable` |

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

Compute-heavy read endpoints are throttled by an in-process token-bucket middleware (`src/middleware/rate-limit.ts`, keyed by remote IP; a shared per-endpoint bucket when the socket address is unavailable). Over-limit requests get `429 { "error": "rate_limited", "message", "retryAfterSeconds" }` plus a `Retry-After` header. Buckets (requests/minute · burst): events `export` 5·2, address `transactions` 10·3, `transfers` 10·3, address `approvals` 10·3, blocks `stream` 12·6, watch writes 5·2, ops `summary` 6·3, global `search` 30·10, contract `read`/`simulate` 60·20, labels list 10·3, `sql/query` 6·3, address `scan` writes 3·2. Set `RATE_LIMIT_DISABLED=1` to disable (e.g. for load tests).

At startup (`src/startupChecks.ts`, before `listen`): binding a **non-loopback `HOST`** without `ADMIN_TOKEN` logs a loud multi-line security warning listing the exposed write endpoints; non-loopback + `ENABLE_DEBUG_API=1` refuses to start unless `ALLOW_INSECURE_START=1`. `HOST` now actually controls the bind address (it was previously ignored). `500` bodies are always the generic `{ "error": "internal_error", "message": "Internal Server Error" }` — internal details go to the server log only.

## Errors

Failures return `{ "error": string }` — the human-readable reason — often alongside an optional `message` with more detail, and conventional status codes (`400` validation, `403` admin gate, `404` not found, `500` internal). The admin gate's 403 body explains how to enable admin operations. On the frontend, `toApiError` (`src/util/http.ts`) surfaces `message` when present and falls back to `error` verbatim, so the text in `error` reaches the user as-is.

## Custom chains

User-registered EVM chains outside `viem/chains` (anvil 31337, hardhat forks, private geth, new L2s) — the whole explorer follows one RPC endpoint into the chain. `POST` probes the endpoint's `eth_chainId` with a raw JSON-RPC request (5s budget, no shared client) before anything is stored; the reported id **is** the registration's chain id, never a client-supplied one. Once registered, the chain resolves everywhere a viem chain does — chain-scoped routes (`/api/chains/:id/…`), the search layer, name/symbol/decimals lookups — and is served through the registered RPC (a per-chain `rpc-configs` override still wins when one exists). Registrations persist in the `custom_chains` table and re-register at server startup. `GET` applies the same URL-redaction policy as `GET /api/rpc-configs`.

| Method & path | Notes |
| --- | --- |
| `GET /api/chains/custom` | List registrations (`{ chains: [{ chainId, name, symbol, decimals, rpcUrl, urlRedacted }] }`, newest-stable order by id). Open read; `rpcUrl` is the full URL only for CORS-allowlisted Origins / Origin-less loopback sockets — everyone else gets scheme + host and `urlRedacted: true` |
| `POST /api/chains/custom` | 🔐 **admin (opt-in)** + rate limit 5/min · burst 2. Body `{ rpcUrl, name?, symbol?, decimals? }`: `rpcUrl` an absolute http(s) URL, `name`/`symbol` non-empty strings, `decimals` an integer 0–256 — violations → `400` with `code` (`invalid_url` / `invalid_fields` / `invalid_json`). The probe failing honestly → `502 { "error": "rpc_unreachable" \| "rpc_invalid_response", "message" }`. An id viem already ships → `409 { "error": "chain_already_known", "message", "existingName", "hint": "Use the RPC override (⚙ RPC panel) for a known chain" }`. Success → `201` echoing `{ chainId, name, symbol, decimals, rpcUrl }` (defaults `Chain ${id}` / `ETH` / `18`); same id re-registered → upsert (replace) |
| `DELETE /api/chains/custom/:chainId` | 🔐 Remove a registration. Non-positive-integer id → `400 invalid_chain_id`; nothing registered under the id → `404`; success → `204` (the RPC manager hot-reloads and the chain stops resolving) |
| `DELETE /api/chains/:chainId/cached-data` | 🔐 **admin (opt-in)** + 5/min · burst 2 — **dev-chain reset recovery**: delete this chain's rows from the immutable fetch caches (`contract_sources`, storage layouts) so a reset anvil/hardhat chain (same chain id, wiped history) cannot serve stale verified-contract data. `200 { cleared: { contractSources: n, storageLayouts: n }, scope: { cleared: [...], untouched: "per-chain event index database files (open DuckDB handles)" } }` — honest counted numbers; invalid/unsupported id → `400`. The frontend shows a dismissible reset banner (head went ≥5 blocks backwards) with a one-click clear wired here |

🔐 = `requireAdminTokenIfConfigured` (enforced only when `ADMIN_TOKEN` is set); see the Auth bullet at the top.
