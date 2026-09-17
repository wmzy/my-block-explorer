# Local backend installation

The explorer is split into a static frontend and a local API server. The frontend works without any install (RPC-only features), but search, contract caches, and event indexing need the backend. Everything installs from source — there is no published npm package, no install script, and no prebuilt binaries in this repo.

## Requirements

- Node.js **22+** (`engines` field in `package.json`)
- **pnpm** — the repo's node_modules layout breaks npm's arborist; use pnpm for every command below
- Free disk for DuckDB files if you index events

## Install and run

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
| `ADMIN_TOKEN` | unset | Enables the admin-gated endpoints (`x-admin-token` header). **Fail-closed: unset = every gated request 403s.** |
| `ENABLE_DEBUG_API` | unset | `1` mounts `POST /debug/db/query` (raw SQL) — never enable on a reachable host |
| `LOG_LEVEL` | `info` | pino log level |
| `HTTP_PROXY` / `HTTPS_PROXY` | unset | Proxy for outbound RPC calls |
| `FRONTEND_URL` | Pages demo URL | URL the CLI opens with `--open` |

Things that are **not** env-configured: RPC endpoints (viem chain defaults, plus per-chain overrides stored via the admin-gated `/api/rpc-configs`), chain list (all of `viem/chains`), and ports for discovery (fixed `localhost:8201-8205` scan).

## Verify it works

```bash
curl http://localhost:8201/api/health
# { "status": "healthy", "message": "My Block Explorer API is running", ... }
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
- **403 on RPC settings / cache clear** — `ADMIN_TOKEN` is unset or the browser token doesn't match; the ⚙️ RPC modal has the token field.
- **RPC calls fail behind a firewall** — set `HTTP_PROXY`/`HTTPS_PROXY`.
