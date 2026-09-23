# Local backend installation

The explorer is split into a static frontend and a local API server. The frontend works without any install (RPC-only features), but search, contract caches, and event indexing need the backend.

## Three ways to run it

The same frontend supports three run modes — pick one per visit, nothing is locked in. The first backend-less visit also shows a dismissible "Three ways to run this explorer" guide at the entry route; this section is the long form of it.

### 1. RPC-only — no backend

Open the frontend and browse. Blocks, transactions, address balances, gas and the daily charts are read straight from the chain's RPC endpoints in your browser, and call traces render wherever the node serves `debug_traceTransaction`. Nothing to install, nothing stored.

What stays gated without a backend (it lives in DuckDB behind the API): event indexing, address labels, the verified-contracts directory, the signature cache, storage layouts, and search suggestions. A backend-less session keeps a dismissible **Backend not found** banner whose *Open setup* panel carries the `npx` command, a manual backend URL field, and a retry that keeps re-probing — the RPC-backed pages keep working around it either way.

### 2. Local backend — full feature set

```bash
npx my-block-explorer --port 8201
```

The frontend auto-discovers a local backend by probing `localhost:8201-8205`, so any of those ports connects with no configuration (package details and the version-alignment warning: [below](#run-without-cloning-the-npm-package)). Data lands in DuckDB files under `data/` — `data/blockchain.db` plus per-chain event DBs under `data/chains/`. This unlocks everything mode 1 gates off: event indexing, labels, contract verification and the cached-contracts directory, the signature cache, storage layouts.

### 3. Shared deployment — one backend, many browsers

Run the API where others can reach it; the full model is in [DEPLOYMENT.md](./DEPLOYMENT.md). The knobs that matter:

- **`ADMIN_TOKEN` (two tiers)** — `/api/performance/*` always requires it and 403s even when unset (fail-closed); the core-workflow writes (event ranges, labels, RPC configs, contract/storage cache clears) enforce it only once it is set, so a zero-config local session stays frictionless. Each browser stores its token in localStorage and sends it as `x-admin-token` (fill it in the ⚙️ RPC modal).
- **`CORS_ALLOWED_ORIGINS` / `FRONTEND_URL`** — the cross-origin allowlist for hosting the frontend elsewhere; loopback origins are always allowed.
- **`HOST`** — binding a non-loopback interface without `ADMIN_TOKEN` logs a loud startup warning; `ENABLE_DEBUG_API=1` on a non-loopback host refuses to start (the debug API stays unmounted unless explicitly opted in; `ALLOW_INSECURE_START=1` accepts the risk with the warning still firing).
- **Docker** — `docker build --target api .` (Node 22 API on :8201) or `--target web` (nginx serving the SPA); `compose.yaml` wires both with the `./data` volume (`:Z` relabels it for SELinux hosts).

## Run without cloning: the npm package

The backend CLI is published on npm as [`my-block-explorer`](https://www.npmjs.com/package/my-block-explorer) (latest `1.1.0` as of 2026-09 — check the npm page for the current version), so the fastest start is:

```bash
npx my-block-explorer --port 8201     # or: pnpm dlx my-block-explorer --port 8201
```

This is also what the frontend's setup screen suggests when it can't find a backend. The package ships only the prebuilt server CLI (`dist/server/cli.js`, plus this README and the license) — everything else in this repo builds from source.

> **Version alignment warning.** The hosted demo frontend (GitHub Pages) is built from this repository's latest code, while `npx` pulls whatever version was last published to npm — the two release lines are independent (the repo's `package.json` stays at a `0.0.0` dev placeholder). The frontend↔backend API contract can therefore be out of sync: endpoints may 404 or misbehave in ways that don't reproduce locally. If a hosted frontend disagrees with your `npx`-started backend, **build both from the same source** (clone this repo, `pnpm build`, `pnpm start`) instead of debugging the mismatch.

## Requirements

- Node.js **22+** (`engines` field in `package.json`)
- **pnpm** — the repo's node_modules layout breaks npm's arborist; use pnpm for every command below
- Free disk for DuckDB files if you index events

## Install and run from source

```bash
git clone https://github.com/wmzy/my-block-explorer.git
cd my-block-explorer

pnpm install

# Development — Vite on :3000 with the Hono API bridged in-process:
pnpm dev

# Or run the API standalone (:8201):
pnpm dev:server

# Production:
pnpm build            # dist/client + dist/server
pnpm start            # node dist/server/cli.js → API on :8201
```

The build also produces a `my-block-explorer` CLI (`bin` in `package.json`) from `dist/server/cli.js`; `--help` lists options (`--port`, `--no-open`, `--version`).

## Configuration

No configuration is required to start. The environment variables actually read by the code:

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `8201` (server) / `3000` (vite dev) | Listen port |
| `DATABASE_URL` | `duckdb://data/blockchain.db` | Main DuckDB file |
| `ADMIN_TOKEN` | unset | When set, enforces the `x-admin-token` header on the core-workflow writes (event ranges, RPC configs, contract/storage-layout cache clears) and the performance endpoints. Unset: those writes pass through, while `/api/performance/*` still 403s (fail-closed). Two-tier details in [DEPLOYMENT.md](./DEPLOYMENT.md). |
| `ENABLE_DEBUG_API` | unset | `1` mounts `POST /debug/db/query` (raw SQL) — never enable on a reachable host |
| `LOG_LEVEL` | `info` | pino log level |
| `HTTP_PROXY` / `HTTPS_PROXY` | unset | Proxy for outbound RPC calls |
| `FRONTEND_URL` | Pages demo URL | URL the CLI opens with `--open` |

Things that are **not** env-configured: RPC endpoints (viem chain defaults, plus per-chain overrides stored via the admin-gated `/api/rpc-configs`), chain list (all of `viem/chains`), and ports for discovery (fixed `localhost:8201-8205` scan).

## Verify it works

```bash
curl http://localhost:8201/api/health
# { "status": "ok", "adminTokenConfigured": false, "debugApiEnabled": false, "version": "...", "timestamp": "..." }
```

Then open the frontend (`http://localhost:3000` in dev). It auto-discovers the backend by scanning `localhost:8201-8205`; a hosted frontend needs the backend URL entered manually once.

## Data management

- `data/blockchain.db` — main DB (contract sources, search history, RPC configs)
- `data/chains/{type}/{name}-{id}.db` — per-chain event DBs

Backup = stop the server and copy the files (DuckDB is single-writer; a hot copy of a database being written to is not safe). Inspect data with `pnpm db:studio` (Drizzle Studio) or the DuckDB CLI — these are DuckDB files, **not** SQLite.

## Running it as a service (optional)

```ini
# /etc/systemd/system/my-block-explorer.service
[Unit]
Description=My Block Explorer API
After=network.target

[Service]
WorkingDirectory=/opt/my-block-explorer
ExecStart=/usr/bin/node dist/server/cli.js
Environment=PORT=8201
Environment=ADMIN_TOKEN=change-me
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

PM2 works the same way (`pm2 start dist/server/cli.js --name explorer-api`). If the API is reachable from other machines, put an authenticating reverse proxy in front of it first — see [DEPLOYMENT.md](./DEPLOYMENT.md) for the security model and an nginx sketch.

## Troubleshooting

- **Port already in use** — `lsof -i :8201`; start on another port (`--port 8202` — it stays within the discovery scan range).
- **DuckDB lock / "Could not set lock on file"** — another process still holds the database: a still-running server, a leftover dev process, or Drizzle Studio. DuckDB allows a single writer per file; kill the other process.
- **Frontend shows the setup screen** — no backend answered on `localhost:8201-8205`; start one or enter its URL manually.
- **403 on RPC settings / cache clear** — the server has `ADMIN_TOKEN` set and the browser token doesn't match; fill it in the ⚙️ RPC modal. (With `ADMIN_TOKEN` unset these writes pass through — only `/api/performance/*` 403s.)
- **RPC calls fail behind a firewall** — set `HTTP_PROXY`/`HTTPS_PROXY`.
