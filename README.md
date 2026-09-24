# My Block Explorer

A self-hosted, **single-user** block explorer for EVM developers. Browse any viem-supported chain, index contract events into local DuckDB files, inspect verified sources, storage layouts, and read/simulate contracts — all on your own machine.

> **This is not a multi-tenant service.** DuckDB allows a single writer per database file, and by default (no `ADMIN_TOKEN` set) the core-workflow write endpoints are open (see [Security](#security--admin)). Run it for yourself locally; if you ever expose the API on a shared network, set `ADMIN_TOKEN` and the CORS allowlist, or put it behind a reverse proxy with authentication.

Live frontend-only demo (no local backend — the API-dependent features need your own server): https://wmzy.github.io/my-block-explorer/

> **Mobile-adapted.** All pages stack responsively at ≤768px (tables scroll in-card, wide columns like the tx-list Method column collapse); deep views were browser-verified at 375px. Density is still tuned for desktop — report anything cramped.

## Features

- **700+ chains, zero config** — every chain defined in `viem/chains` (732 in the pinned viem version) works out of the box; 10 popular chains are pinned at the top of the chain picker (`POPULAR_CHAINS` in `src/config/chains.ts`)
- **On-demand event indexing** — index specific block ranges for a contract, query decoded events with argument filters, export CSV
- **Contract tools** — verified source & ABI (Sourcify → Etherscan fallback), storage layout + slot reads, `read`/`simulate`/`estimate-gas`, in-page Sourcify verification, `cast` command export from the Interact form
- **Token pages (lightweight)** — ERC-20 detection on contract addresses (name/symbol/decimals/totalSupply via Multicall3), token-centric transfer scan (filter by emitting contract), and discovered top holders with explicit "may be incomplete" caveats
- **Dedicated token view** — `/chain/:id/token/:address` assembles overview, transfers, top-10 holders distribution and mint/burn totals (all discovery-based, honestly caveated); self-guards EOAs and non-token contracts
- **Address depth** — balance-over-time chart (anchored to the live RPC balance), NFT holdings aggregation (ERC-721 id sets / ERC-1155 deltas from the transfers scan), read-only approvals viewer (discovered spenders + live allowance reads; revoke via revoke.cash), and an Internal Txns tab (browser-side callTracer over the discovered window, bounded to the first 25 txs)
- **Decoded method names in tx lists** — batched openchain selector resolution (one request per 25 rows); plain transfers stay honest "—"
- **Charts** — `/chain/:id/charts`: blocks/day, block time, gas usage and gas prices over ~30 days, sampled client-side from RPC with per-chart source labels (never presented as full-chain indexer truth)
- **Live blocks + watchlist** — SSE push of new blocks with silent fallback to polling; watch addresses (browser-local) get in-page + browser-notification matches against live blocks while the page is open
- **Signature decoding** — unknown function selectors and event topic0s resolve through the openchain signature database (DuckDB-cached, 24h negative TTL) on transaction details
- **Call traces** — `debug_traceTransaction` (callTracer) renders as an indented call tree on tx details when the RPC supports it, with honest "not supported by this RPC" degradation
- **Address annotations** — private per-chain labels (backend-persisted, admin-gated writes) and CSV export of the discovered transaction list
- **Cached-contract directory** — `/chain/:id/contracts` lists every locally cached contract source; the global search surfaces local contract-name matches
- **Gas tracker** — base-fee sparkline + priority-fee tiers from `eth_feeHistory` (browser RPC, 60s polling)
- **Raw RPC JSON** — lazy collapsible raw transaction/receipt/block payloads on detail pages
- **Light/dark/system theme** with persistence, backend version chip in the topbar
- **Docker packaging** — multi-target `Dockerfile` (API + static web) and `compose.yaml` (see [Deployment](docs/DEPLOYMENT.md))
- **Data separation** — ephemeral data (balances, latest blocks) is fetched in the browser directly from RPC; persistent data (sources, events, labels) is cached in DuckDB behind the local API
- **Auto-discovery** — the frontend finds a local backend by scanning `localhost:8201-8205`, with a manual URL fallback

## Tech stack

Exact versions in `package.json`.

| Area | Choice |
| --- | --- |
| UI | React 19, `@native-router/react` (flat typed route table — not React Router), haze-ui component library + Linaria (`@wyw-in-js/vite`) styling, ECharts |
| Build | Vite 8 (`@vitejs/plugin-react`, `vite-plugin-haze-ui` for on-demand CSS) |
| Server state | `react-toolroom` query layer (`src/util/useQuery.ts`) |
| HTTP | `fetch-fun` (`src/util/http.ts`), API base resolved at runtime by service discovery |
| API | Hono 4 on Node.js 22 (embedded in the Vite dev server, or standalone) |
| Storage | DuckDB (`@duckdb/node-api`) via a custom PostgreSQL-compatible adapter for Drizzle ORM |
| Chain access | viem 2 (both frontend and backend create per-chain clients) |

## Getting started

Three run modes, one frontend: (1) **RPC-only** — open the frontend, no backend, everything read live from public RPCs; (2) **local backend** — `npx my-block-explorer --port 8201` adds event indexing, labels and contract caching in local DuckDB files; (3) **shared deployment** — the same API on a reachable host with `ADMIN_TOKEN` and a CORS allowlist. Details: [docs/INSTALLATION.md](docs/INSTALLATION.md#three-ways-to-run-it).

Requires Node.js 22+ and [pnpm](https://pnpm.io/) (the repo's node_modules layout breaks npm).

```bash
pnpm install
pnpm dev          # Vite dev server on http://localhost:3000, Hono API bridged in-process at /api
```

No environment setup is required to start — see [Configuration](#configuration) for the optional variables that actually exist in code.

Standalone backend instead of the bridged one (useful when the Vite bridge instance and a `tsx` watch instance would fight over the same DuckDB file):

```bash
pnpm dev:server   # tsx watch src/cli.ts --port 8201 --no-open → http://localhost:8201
```

### Production build

```bash
pnpm build        # client (dist/client) + server (dist/server)
pnpm start        # node dist/server/cli.js — API-only server on 8201 (opens the hosted frontend in your browser)
pnpm build:pages  # frontend-only build with VITE_BASE=/my-block-explorer/ for the GitHub Pages demo
```

The standalone server does **not** serve the built frontend — the frontend is static hosting (Pages/CDN or the Vite dev server) and connects to the API by URL; see [Ports and service discovery](#ports-and-service-discovery).

### Docker

Prefer containers? The repo ships a multi-target `Dockerfile` plus `compose.yaml`:

```bash
docker compose up -d --build   # API on :8201 (data bind-mounted to ./data), web on :3000
```

The `api` target packages the Node 22 server (DuckDB files under `/app/data`, healthchecked); the `web` target is nginx serving the SPA — it embeds no API URL, so the browser still discovers or is told the API at runtime. Visiting from another machine? The API needs `CORS_ALLOWED_ORIGINS` set to the web origin, and each visitor types the API URL into the setup screen once. Details, security notes (`ADMIN_TOKEN`, never `ENABLE_DEBUG_API` on shared hosts): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#4-docker-two-images-api--static-web).

### Database migrations

```bash
pnpm db:generate   # generate Drizzle migrations
pnpm db:migrate    # apply them
pnpm db:studio     # Drizzle Studio
```

### Tests / quality

```bash
pnpm test            # Vitest (all)
pnpm test:unit       # tests/unit only
pnpm test:integration# tests/integration only
pnpm typecheck       # tsc --noEmit
pnpm lint            # ESLint
```

## Ports and service discovery

- **Dev (default):** `pnpm dev` runs everything on port **3000**; requests to `/api/*` are handled by the Hono app inside the Vite dev process (`honoApiPlugin` in `vite.config.ts`).
- **Standalone:** `pnpm dev:server` / `pnpm start` listen on **8201** (`PORT` env override; the CLI also accepts `--port`).
- **Discovery:** on load the frontend scans `localhost:8201-8205`, probing `GET /api/health` on each (`src/hooks/useAutoDiscovery.ts`). If none respond it shows a setup screen (which keeps re-probing automatically every ~4 s) where you can enter a backend URL manually; the choice persists in localStorage and is **never auto-cleared** — a temporarily unreachable saved URL only degrades to the localhost scan for that session.
- **A hosted frontend cannot auto-discover a remote backend.** The scan is localhost-only. When using the GitHub Pages build (or any static hosting) you must type your backend URL into the setup screen, and the backend must allow the frontend's origin — add it to `CORS_ALLOWED_ORIGINS` (or point `FRONTEND_URL` at it); see [CORS](#cors).

## Data layout

- Shared/main database: `data/blockchain.db` (`DATABASE_URL`, default `duckdb://data/blockchain.db`) — contract sources, search history, user RPC configs.
- Per-chain event databases: `data/chains/{type}/{name}-{id}.db` (e.g. `data/chains/mainnet/Ethereum-1.db`) — indexed event ranges and decoded logs, isolated per chain. The legacy single-file layout and the per-chain layout coexist.

## Configuration

Environment variables actually read by the code (no example env file ships with the repo; RPC URLs come from viem chain defaults plus admin-gated overrides in the DB — not from env):

| Variable | Where | Effect |
| --- | --- | --- |
| `PORT` | server / vite | Standalone API port (default 8201); Vite dev server port (default 3000) |
| `DATABASE_URL` | `src/database/drizzle.ts` | Main DuckDB file (default `duckdb://data/blockchain.db`) |
| `ADMIN_TOKEN` | `src/middleware/admin-token.ts` | When set, gates core-workflow writes (event ranges, rpc-config writes, contract/storage-layout cache clears) and the fail-closed performance/diagnostic surface (see above) |
| `CORS_ALLOWED_ORIGINS` | `src/middleware/cors-origins.ts` | Extra allowed CORS origins (comma-separated), in addition to loopback and `FRONTEND_URL` |
| `ENABLE_DEBUG_API` | `src/api-app.ts` | `1` mounts `/debug/db/query` (raw SQL) — dev only |
| `LOG_LEVEL` | logger | pino level (default `info`) |
| `HTTP_PROXY` / `HTTPS_PROXY` | server | Proxy for outbound RPC calls |
| `FRONTEND_URL` | CLI + CORS | URL opened by the CLI's `--open` flag; also added to the CORS origin allowlist |
| `VITE_BASE` | build time | Base path for the Pages build (`pnpm build:pages` sets it) |

## Security & admin

The trust model is **one local user**. Read endpoints are open; writes and admin endpoints are gated in two tiers, both keyed on the `x-admin-token` header (compared with `timingSafeEqual` in `src/middleware/admin-token.ts`):

- **Opt-in gated writes** (`requireAdminTokenIfConfigured`): enforced **only when `ADMIN_TOKEN` is set** on the server — with the variable unset the request passes straight through, so a zero-config local session works out of the box. This tier covers the core-workflow writes:
  - event-range mutations: `POST/PATCH/DELETE …/events/ranges*`, `POST …/events/ranges/quick`, and `start`/`pause`/`resume`
  - RPC-config writes: `POST` / `DELETE /api/rpc-configs` (`GET /api/rpc-configs` is open but returns endpoint URLs **redacted to scheme + host** for any origin the CORS policy doesn't already trust — custom endpoints often embed API keys; loopback/allowlisted origins get full URLs)
  - cache clears: `POST /api/chains/:chainId/contracts/:address/clear-cache` (drop cached contract source) and `DELETE /api/chains/:chainId/contracts/:address/storage-layout/cache` (drop cached storage layout)
- **Fail-closed admin/diagnostic surface** (`requireAdminToken`): rejected with 403 whenever `ADMIN_TOKEN` is unset or the header doesn't match — there is no default token. This tier covers:
  - everything under `/api/performance/*`
- In the UI, open the ⚙️ RPC settings modal and fill the **"Admin token (stored in this browser)"** field; it is kept in localStorage and attached to requests automatically (`src/util/adminAuth.ts`).
- **`ENABLE_DEBUG_API=1`** mounts `POST /debug/db/query`, which executes arbitrary SQL against your databases. Never enable it on anything reachable by others.
- With `ADMIN_TOKEN` unset, the opt-in-gated writes above are open to anyone who can reach the API. Combined with DuckDB's single-writer model, this is fine for a local single-user deployment but **must not** be exposed on a shared or public network — set `ADMIN_TOKEN` (and restrict CORS origins) or put the API behind an authenticated reverse proxy (e.g. nginx with basic auth / mTLS) if more than your own browser can reach it.

### CORS

Cross-origin access uses an allowlist (`src/middleware/cors-origins.ts`), not `*`:

- Requests without an `Origin` header (same-origin fetches, curl) get no CORS headers at all.
- Loopback origins — `localhost`, `127.0.0.1`, `[::1]`, any port — are always allowed (the Vite dev server on `localhost:3000` reaching the API on `localhost:8201`).
- Additional origins come from `CORS_ALLOWED_ORIGINS` (comma-separated) and `FRONTEND_URL`.
- The Vite dev server applies the same shared allowlist to its own CORS config (imported relatively into `vite.config.ts`), so dev-server responses and the bridged `/api` agree with the API's policy.

## How the backend behaves

Details a developer will run into:

- **Event indexing is manual and range-based.** You add a block range for a contract; `EventIndexingService` walks it in batches (one serial job per range — no global queue). `start`/`resume` return `202` immediately; the UI polls range status. On server start, ranges left in `indexing` by a previous process are reconciled to `error` with *"Interrupted by server restart — resume to continue"*. Range mutations are opt-in gated (see [Security](#security--admin)).
- **Reorg reconciliation.** Rows indexed below the finalized head stay `isFinalized = false`; at server start and after each range job, they are re-verified against their receipts — reorged-out rows are deleted, survivors promoted. The events table badges unfinalized rows and the CSV export carries an `is_finalized` column. A range's `totalEventsIndexed` is recomputed as a distinct `COUNT(*)` over its block span on completion, so overlap/catchup re-walks can't inflate it.
- **Range bounds are concrete numbers.** A bound may be submitted as a number or a block tag (`latest`, `finalized`, `safe`, `earliest`), but tags are resolved to concrete block numbers once, at range creation — stored rows never carry tag sentinels, and legacy rows that still do are resolved defensively when indexing starts.
- **Creation-block honesty.** Contract-creation lookups return "unknown" rather than fabricating a boundary. Quick mode `all` starts at the creation block when known, from genesis when unknown; quick mode `first` fails with *"Contract creation block unknown — enter a start block manually"* instead of guessing.
- **Quick-create modes** (`POST …/events/ranges/quick`): `all`, `recent`, `first`, `continue`, and `catchup` — the last creates a range from the furthest block any existing range reached up to the current head (`400 "No previous range found. Cannot catch up."` when no ranges exist).
- **Cache TTLs** for persisted fetches: verified contract source 30 days; proxy contracts 24 h; unverified source 3 days; contract-creation lookup failure 24 h; storage-layout `NOT_FOUND` 24 h.
- **Address API returns persistent data only** — no balance or transaction count (the UI reads those live from RPC). Transaction history is heuristic (balance-change binary search) and the response reports `coverage` (`complete`/`partial`/`none`); unknown coverage renders a "source unknown" banner instead of pretending the history is complete.
- **Search** responses may carry `degraded: true` + `degradedReasons` when an upstream lookup failed — the UI offers a retry rather than "no results". The global `GET /api/search` resolves tx-hash/block-number queries **on the chain given by `?chainId=`**; only a search without any chain hint returns `needsChain` + the network picker. ENS names are **not** resolved server-side; the browser resolves them against a mainnet RPC (history entries are recorded only after a successful resolution). `search_history` ids are int32-safe (epoch-seconds based).
- **Event statistics** show an "Indexing coverage" metric — the union of walked blocks across ranges (overlaps merge; paused/errored ranges count the blocks their checkpoint reached, since those events stay queryable), explicitly scoped to "your configured block ranges", not the contract's lifetime. CSV export has a hard 100,000-row cap (`400` above it), the UI disables the export button preflight when the filtered total exceeds it, and the CSV carries an `is_finalized` column.

## Docs

- [Installation](docs/INSTALLATION.md)
- [Configuration](docs/CONFIG.md)
- [Deployment](docs/DEPLOYMENT.md)
- [API reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md) — the system as shipped (routing, chain switching, search dispatch, auto-discovery), followed by the original design-time document
- [Docs index](docs/README.md) · [historical archive](docs/archive/)

## License

MIT
