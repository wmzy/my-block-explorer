# My Block Explorer

A self-hosted, **single-user** block explorer for EVM developers. Browse any viem-supported chain, index contract events into local DuckDB files, inspect verified sources, storage layouts, and read/simulate contracts — all on your own machine.

> **This is not a multi-tenant service.** DuckDB allows a single writer per database file, and the event-indexing API is unauthenticated by design (see [Security](#security--admin)). Run it for yourself locally; if you ever expose the API on a shared network, put it behind a reverse proxy with authentication first.

Live frontend-only demo (no local backend — the API-dependent features need your own server): https://wmzy.github.io/my-block-explorer/

## Features

- **700+ chains, zero config** — every chain defined in `viem/chains` (732 in the pinned viem version) works out of the box; 10 popular chains are pinned at the top of the chain picker (`POPULAR_CHAINS` in `src/config/chains.ts`)
- **On-demand event indexing** — index specific block ranges for a contract, query decoded events with argument filters, export CSV
- **Contract tools** — verified source & ABI (Sourcify → Etherscan fallback), storage layout + slot reads, `read`/`simulate`/`estimate-gas`
- **Data separation** — ephemeral data (balances, latest blocks) is fetched in the browser directly from RPC; persistent data (sources, events, search history) is cached in DuckDB behind the local API
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
- **Discovery:** on load the frontend scans `localhost:8201-8205`, probing `GET /api/health` on each (`src/hooks/useAutoDiscovery.ts`). If none respond it shows a setup screen where you can enter a backend URL manually; the choice persists in localStorage.
- **A hosted frontend cannot auto-discover a remote backend.** The scan is localhost-only. When using the GitHub Pages build (or any static hosting) you must type your backend URL into the setup screen, and the backend must allow the frontend's origin (the standalone server enables CORS for that reason).

## Data layout

- Shared/main database: `data/blockchain.db` (`DATABASE_URL`, default `duckdb://data/blockchain.db`) — contract sources, search history, user RPC configs.
- Per-chain event databases: `data/chains/{type}/{name}-{id}.db` (e.g. `data/chains/mainnet/Ethereum-1.db`) — indexed event ranges and decoded logs, isolated per chain. The legacy single-file layout and the per-chain layout coexist.

## Configuration

Environment variables actually read by the code (no example env file ships with the repo; RPC URLs come from viem chain defaults plus admin-gated overrides in the DB — not from env):

| Variable | Where | Effect |
| --- | --- | --- |
| `PORT` | server / vite | Standalone API port (default 8201); Vite dev server port (default 3000) |
| `DATABASE_URL` | `src/database/drizzle.ts` | Main DuckDB file (default `duckdb://data/blockchain.db`) |
| `ADMIN_TOKEN` | `src/middleware/admin-token.ts` | Enables admin-gated endpoints (see below) |
| `ENABLE_DEBUG_API` | `src/api-app.ts` | `1` mounts `/debug/db/query` (raw SQL) — dev only |
| `LOG_LEVEL` | logger | pino level (default `info`) |
| `HTTP_PROXY` / `HTTPS_PROXY` | server | Proxy for outbound RPC calls |
| `FRONTEND_URL` | CLI | URL opened by the CLI's `--open` flag |
| `VITE_BASE` | build time | Base path for the Pages build (`pnpm build:pages` sets it) |

## Security & admin

The trust model is **one local user**. Read endpoints are open; a small set of mutating/admin endpoints is gated by a shared secret, and everything else that writes (event-indexing ranges) is intentionally unauthenticated.

- **`ADMIN_TOKEN`** (server env) gates admin endpoints via the `x-admin-token` header, compared with `timingSafeEqual`. **Fail-closed:** if `ADMIN_TOKEN` is unset, every gated request is rejected with 403 — there is no default token.
- Gated endpoints:
  - `GET` / `POST` / `DELETE /api/rpc-configs` (custom RPC endpoint management — reads included)
  - `POST /api/chains/:chainId/contracts/:address/clear-cache` (drop cached contract source)
  - `DELETE /api/chains/:chainId/contracts/:address/storage-layout/cache` (drop cached storage layout)
  - everything under `/api/performance/*`
- In the UI, open the ⚙️ RPC settings modal and fill the **"Admin token (stored in this browser)"** field; it is kept in localStorage and attached to requests automatically (`src/util/adminAuth.ts`).
- **`ENABLE_DEBUG_API=1`** mounts `POST /debug/db/query`, which executes arbitrary SQL against your databases. Never enable it on anything reachable by others.
- **Event-indexing range writes are unauthenticated by design** (`POST/PATCH/DELETE …/events/ranges*`, `start`/`pause`/`resume`). Combined with DuckDB's single-writer model, this is fine for a local single-user deployment but **must not** be exposed on a shared or public network — put the API behind an authenticated reverse proxy (e.g. nginx with basic auth / mTLS) if more than your own browser can reach it.

## How the backend behaves

Details a developer will run into:

- **Event indexing is manual and range-based.** You add a block range for a contract; `EventIndexingService` walks it in batches (one serial job per range — no global queue). `start`/`resume` return `202` immediately; the UI polls range status. On server start, ranges left in `indexing` by a previous process are reconciled to `error` with *"Interrupted by server restart — resume to continue"*.
- **Cache TTLs** for persisted fetches: verified contract source 30 days; proxy contracts 24 h; unverified source 3 days; contract-creation lookup failure 24 h; storage-layout `NOT_FOUND` 24 h.
- **Address API returns persistent data only** — no balance or transaction count (the UI reads those live from RPC). Transaction history is heuristic (balance-change binary search) and the response reports `coverage` (`complete`/`partial`/`none`); unknown coverage renders a "source unknown" banner instead of pretending the history is complete.
- **Search** responses may carry `degraded: true` + `degradedReasons` when an upstream lookup failed — the UI offers a retry rather than "no results". ENS names are **not** resolved server-side; the browser resolves them against a mainnet RPC. `search_history` ids are int32-safe (epoch-seconds based).
- **Event statistics** show an "Indexing coverage" metric: the union of all ranges (overlaps merge, in-flight ranges count walked blocks). CSV export has a hard 100,000-row cap (`400` above it) and the UI disables the export button preflight when the filtered total exceeds it.

## Docs

- [Deployment](docs/DEPLOYMENT.md)
- [Installation](docs/INSTALLATION.md)
- [Configuration](docs/CONFIG.md)
- [API reference](docs/API.md)
- [All-chains support](docs/ALL_CHAINS_SUPPORT.md)
- [Architecture](docs/ARCHITECTURE.md) (historical design notes)

## License

MIT
