# Configuration

What is actually configurable in this repo, and where it lives. Every item below
was verified against the code — the previous version of this file described a
monorepo layout, `CHAINS_CONFIG`/`VITE_API_URL` env vars, and config files
(`vite.client.config.ts`, `tsconfig.client.json`, …) that do not exist; they
have been removed rather than paraphrased.

## Environment variables

The complete list of env vars read by the code (grep `process.env` in `src/` —
`ALLOW_INSECURE_START` arrives via the `env` argument in
`src/startupChecks.ts` — to re-verify):

| Variable                     | Read in                           | Default                       | Effect                                                                                             |
| ---------------------------- | --------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                       | `src/server.ts`, `vite.config.ts` | `8201` / `3000`               | API server port / Vite dev server port                                                             |
| `DATABASE_URL`               | `src/database/drizzle.ts`         | `duckdb://data/blockchain.db` | Main DuckDB database file                                                                          |
| `ADMIN_TOKEN`                | `src/middleware/admin-token.ts`   | unset                         | Shared secret for admin-gated endpoints (`x-admin-token` header, timing-safe compare). Two-tier: the fail-closed surface (SQL console) 403s while unset; opt-in workflow writes (event ranges, RPC configs, cache clears) pass through while unset |
| `ENABLE_DEBUG_API`           | `src/api-app.ts`                  | unset                         | `1` mounts `POST /debug/db/query` (raw SQL execution)                                              |
| `LOG_LEVEL`                  | `src/server/logger.ts`            | `info`                        | pino log level                                                                                     |
| `HTTP_PROXY` / `HTTPS_PROXY` | `src/server.ts`                   | unset                         | Outbound RPC proxy (undici `ProxyAgent`); lowercase `http_proxy`/`https_proxy` also honored          |
| `FRONTEND_URL`               | `src/cli.ts`                      | Pages demo URL                | URL opened by the CLI's `--open`                                                                   |
| `NODE_ENV`                   | server, logger, vite config       | —                             | `production` toggles pino-pretty off, etc.                                                         |
| `VITE_BASE`                  | `vite.config.ts` (build time)     | `/`                           | Base path for the GitHub Pages build (`pnpm build:pages` sets `/my-block-explorer/`)               |
| `AUTO_INIT`                  | `src/config/zero-config.ts`       | —                             | `true` auto-runs the zero-config initializer when the module is loaded directly                    |
| `HOST`                       | `src/server.ts`                   | `localhost`                   | Bind address. Unset binds loopback-only (local dev default); `HOST=0.0.0.0` binds all interfaces for shared/Docker use (the `api` Dockerfile sets it). Non-loopback binds trigger the startup posture in `src/startupChecks.ts` |
| `ALLOW_INSECURE_START`       | `src/startupChecks.ts`            | unset                         | `1` accepts the fatal startup posture (non-loopback bind + `ENABLE_DEBUG_API=1`) and starts anyway; the loud warning still fires |
| `SERVE_STATIC_DIR`           | `src/server.ts`, `src/middleware/og-meta.ts` | unset (API-only)    | Set to a built client dir (e.g. `dist/client`) to serve the frontend from the API process, with per-route og/twitter meta injected for JS-less requests (single-container deployments — [DEPLOYMENT.md](./DEPLOYMENT.md)) |
| `CORS_ALLOWED_ORIGINS`       | `src/middleware/cors-origins.ts`  | unset                         | Comma-separated extra allowed CORS origins, on top of loopback (always allowed) and `FRONTEND_URL`; re-read per request |
| `RATE_LIMIT_DISABLED`        | `src/middleware/rate-limit.ts`    | unset                         | `1` disables the token-bucket rate limiters on the recomputation-heavy endpoints (CSV export, transfer sweeps, contract interaction) |
| `EXPLORER_API_URL`           | `src/mcp/cli.ts`                  | `http://127.0.0.1:8201`       | Backend REST origin for the MCP CLI (`my-block-explorer-mcp`) — see [MCP.md](./MCP.md) |
| `SOURCIFY_SERVER_URL`        | `src/services/ContractVerifyService.ts` | `https://sourcify.dev/server` | Sourcify server base URL for contract verification (submit + poll) |

There is **no** `.env.example` and no
`CLIENT_PORT`/`SERVER_PORT`/`ETHEREUM_RPC_URL`/`VITE_API_URL` support. RPC URLs
are not configured via env — see below.

## Configuration files

| File                                        | Purpose                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                              | Single package (no monorepo). Scripts: `dev`, `dev:server`, `build`, `build:client`, `build:server`, `build:pages`, `start`, `test*`, `typecheck`, `lint`, `format`, `db:*`, `migrate` |
| `vite.config.ts`                            | React + `@wyw-in-js/vite` (Linaria) + `vite-plugin-haze-ui` + custom `honoApiPlugin` (bridges `/api` into the dev server); `@/` → `src/` alias; `dist/client` output                   |
| `tsup.config.ts`                            | Server build → `dist/server`                                                                                                                                                           |
| `vitest.config.ts`                          | Test setup (jsdom, aliases)                                                                                                                                                            |
| `tsconfig.json`                             | Strict TS, `@/*` path mapping                                                                                                                                                          |
| `drizzle.config.ts`                         | Drizzle Kit (dialect `postgresql` over the DuckDB adapter, `snake_case` casing)                                                                                                        |
| `eslint.config.mjs` / `prettier.config.mjs` | Lint/format rules                                                                                                                                                                      |

## Chain configuration — `src/config/chains.ts`

- `SUPPORTED_CHAINS = Object.values(chains)` from `viem/chains` — every viem
  chain (732 in the pinned version) is supported; nothing to configure.
- `POPULAR_CHAINS` — the 10 chains pinned at the top of the UI chain picker:
  Ethereum, Polygon, BSC, Arbitrum, Base, Optimism, Avalanche, Fantom, Celo,
  Gnosis.
- Helpers: `getChainInfo`, `getChainType` (mainnet/testnet), `getSortedChains`,
  `searchChains`, per-chain DB path derivation
  (`data/chains/{type}/{name}-{id}.db`).

## RPC endpoint configuration

Per-chain RPC overrides live in the **database** (`user_rpc_configs` table),
managed through the API (writes are admin-gated; the list read is open):

```
GET    /api/rpc-configs                 (open — URLs redacted to scheme + host for origins the CORS policy doesn't trust)
POST   /api/rpc-configs                 (admin)  { chainId, name, url, supportsHistory, maxEventRange }
DELETE /api/rpc-configs/:chainId        (admin)
```

In the UI: ⚙️ RPC settings modal — including the **"Admin token (stored in this
browser)"** field that supplies the `x-admin-token` header
(`src/util/adminAuth.ts`, persisted in localStorage). The write gate is opt-in:
with `ADMIN_TOKEN` unset the writes pass through (zero-config local session);
with it set, the header must match (timing-safe compare). Effective RPC URL =
user override if present, else the viem chain default (`getEffectiveRpcUrl`).

## Frontend backend-selection state

The API base URL is chosen at runtime, not build time:
`src/hooks/useAutoDiscovery.ts` probes `localhost:8201-8205` for `/api/health`;
a manually entered URL (setup screen) persists in localStorage under
`my-block-explorer-api-url`. The admin token persists under
`my-block-explorer-admin-token`.

## Cache behavior (code constants, not configurable)

Persistent-fetch cache TTLs: verified contract source 30 days; proxy contracts
24 h; unverified source 3 days; contract-creation lookup failure 24 h;
storage-layout `NOT_FOUND` 24 h. Event export cap: 100,000 rows. See README →
_How the backend behaves_.
