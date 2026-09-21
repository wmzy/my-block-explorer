# Deployment

My Block Explorer is a **self-hosted, single-user** developer tool, not a multi-tenant web service. This document describes the deployment shapes that actually exist in the code.

## The model in one paragraph

The frontend is a static SPA (Vite build). The backend is a Hono API server backed by local DuckDB files. The frontend finds the API either implicitly (dev bridge, same origin) or via **localhost service discovery** (`src/hooks/useAutoDiscovery.ts` scans ports 8201-8205 probing `/api/health`) — and when discovery can't work (hosted frontend), the user types the backend URL into the setup screen once. Ephemeral data (balances, latest blocks) never goes through your backend at all: the browser talks to RPC providers directly.

## Deployment shapes

### 1. Local development (default)

```bash
pnpm dev            # Vite on http://localhost:3000, /api/* handled in-process by the Hono app
```

`honoApiPlugin` (`vite.config.ts`) mounts the API inside the Vite dev server. One process, one port, zero discovery.

Alternative: `pnpm dev:server` runs the API standalone on 8201 (`tsx watch src/cli.ts --port 8201 --no-open`); the frontend at `localhost:3000` will auto-discover it. Do **not** run the bridged instance and a standalone instance against the same database files at the same time — see the single-writer warning below.

### 2. Local production (recommended for real use)

```bash
pnpm build          # dist/client (static SPA) + dist/server (API)
pnpm start          # API-only server on http://localhost:8201 (PORT env / --port override)
```

`dist/server/cli.js` serves **only the API**. Deploy `dist/client` to any static host (or open it via a local static server) and point it at `http://localhost:8201`:

- If the SPA is opened from a non-localhost origin, auto-discovery cannot find the backend (it only scans `localhost`) — the user enters the backend URL manually in the setup screen; it persists in localStorage.
- The backend enables CORS so a hosted frontend can call it cross-origin.

### 3. Hosted frontend + your own backend

This is what the live demo does: `pnpm build:pages` builds the SPA with `VITE_BASE=/my-block-explorer/` for GitHub Pages. Every visitor who wants full functionality runs their own backend (shape 2) and enters its URL into the setup screen — the hosted page cannot and does not proxy API traffic, and it never learns anything about your backend beyond the requests your own browser makes to it.

A hosted frontend **cannot auto-discover a remote backend**: discovery is a localhost port scan. Manual URL entry is the supported path, by design.

### 4. Docker (two images: API + static web)

The repo ships a multi-target `Dockerfile` (plus `.dockerignore` and `compose.yaml`). The two targets map exactly onto the model above — nothing about the runtime changes inside a container:

- **`api`** — Node 22 (slim) with production dependencies and `dist/server`, listening on **8201**, DuckDB files under `/app/data` (declared as a `VOLUME`). The entrypoint is `node dist/server/cli.js` with `--no-open` (there is no browser in a container); pass extra CLI flags (e.g. `--port 8202`) as the container command. A `HEALTHCHECK` polls `GET /api/health` with a Node `fetch` one-liner (slim images ship no curl). Boot-time auto-migration runs from `/app/drizzle/*.sql` baked into the image.
- **`web`** — `nginx:alpine` serving `dist/client` with an SPA fallback (`try_files … /index.html`) on port 80. The image is **chain- and API-agnostic static hosting**: the frontend discovers the API at runtime in the browser, so the web image contains no API URL and needs no rebuild when you change chains or backends.

Build and run each target directly:

```bash
docker build --target api -t my-block-explorer-api .
docker run -d --name explorer-api -p 8201:8201 -v "$PWD/data:/app/data" my-block-explorer-api
# optional hardening: -e ADMIN_TOKEN=... -e CORS_ALLOWED_ORIGINS=http://your-host:3000

docker build --target web -t my-block-explorer-web .
docker run -d --name explorer-web -p 3000:80 my-block-explorer-web
```

Bind-mount note: on SELinux distros (Fedora/RHEL) the API cannot open its DuckDB files in a plain bind mount — the kernel denies access and every boot-time query fails — so use `-v "$PWD/data:/app/data:Z"` (the compose file already does). Without any bind mount you get an anonymous volume that works but may be pruned by Docker.

Or both at once with compose (same ports, same bind mount):

```bash
docker compose up -d --build
```

**How the two containers connect: they don't.** The SPA in the `web` container talks to the API *from your browser*, never container-to-container — that is why `compose.yaml` publishes 8201 on the host and wires no service-to-service link, and why the `web` service has no API URL to configure.

- **Same machine as compose:** the UI is `http://localhost:3000`, the API is `http://localhost:8201`. Loopback origins are always allowed by the CORS allowlist, so auto-discovery finds the API with zero configuration.
- **From another machine:** the UI is `http://<your-host>:3000` — not a loopback origin. Every visitor must type `http://<your-host>:8201` into the setup screen once, **and** the API must allow the web origin: uncomment `CORS_ALLOWED_ORIGINS` in `compose.yaml` (e.g. `http://192.168.1.10:3000`) or add it via `-e`. Without that pairing the browser blocks every API call.

**Data persistence:** everything durable lives in `/app/data` (main `blockchain.db` + per-chain `data/chains/...`). Mount a host directory (`-v ./data:/app/data`, or the compose volume) or you get an anonymous volume that Docker may prune. Back up that directory; it is the whole database.

**Security notes (same two-tier model as everywhere else):**

- With no env set, read endpoints are open and opt-in-gated writes pass through — fine when only your own browser can reach port 8201. The moment the API is reachable from anything else (published port on a shared host, LAN exposure), set `ADMIN_TOKEN` (gates core-workflow writes; also required for the fail-closed `/api/performance/*` surface) and restrict `CORS_ALLOWED_ORIGINS`, or keep the API unpublished and front it with the authenticated reverse proxy above.
- **Never set `ENABLE_DEBUG_API=1` in a container others can reach** — it mounts an unauthenticated arbitrary-SQL endpoint (`POST /debug/db/query`).
- Still one writer per DuckDB file: don't point two `api` containers (or a container and a host process) at the same `data/` directory.

Native-module note: `@duckdb/node-bindings-linux-x64` ships prebuilt binaries; the builder stages install `python3/make/g++` only because the dependency tree contains `better-sqlite3` (node-gyp postinstall). The runtime image is plain `node:22-slim` with the installed `node_modules` copied in — no toolchain shipped.

## Warnings you must not skip

1. **DuckDB is single-writer per file.** The main DB (`data/blockchain.db`) and every per-chain event DB (`data/chains/{type}/{name}-{id}.db`) accept exactly one writing process. Never point two server instances at the same data directory, and don't run the Vite-bridged API and a standalone server simultaneously against the same files.
2. **Write endpoints are gated in two tiers** (middleware in `src/middleware/admin-token.ts`; both check the `x-admin-token` header against `ADMIN_TOKEN` with `timingSafeEqual`):
   - **Opt-in workflow writes** (`requireAdminTokenIfConfigured`): enforced **only when `ADMIN_TOKEN` is set** — with the variable unset the request passes straight through, so a zero-config local session works out of the box. This tier covers, verbatim from `src/routes/*.ts`:
     - the seven event-range mutations: `POST /api/chains/:chainId/contracts/:address/events/ranges`, `POST …/events/ranges/quick`, `PATCH …/events/ranges/:rangeId`, `DELETE …/events/ranges/:rangeId`, and `POST …/events/ranges/:rangeId/start`, `/pause`, `/resume` (`src/routes/events.ts`)
     - `POST /api/rpc-configs` and `DELETE /api/rpc-configs/:chainId` (`src/routes/rpc-config.ts`)
     - `POST /api/chains/:chainId/contracts/:address/clear-cache` (`src/routes/contracts.ts`)
     - `DELETE /api/chains/:chainId/contracts/:address/storage-layout/cache` (`src/routes/storage.ts`)
   - **Fail-closed admin surface** (`requireAdminToken`): rejected with 403 whenever `ADMIN_TOKEN` is unset **or** the header doesn't match — there is no default token. Covers the entire `/api/performance/*` subtree (`app.use('/performance/*', …)` in `src/routes/performance.ts`).
   - **Dev-only debug surface**: `ENABLE_DEBUG_API=1` mounts `POST /debug/db/query` — arbitrary SQL against your databases (`src/routes/debug.ts`). It is not mounted at all by default and carries no token check, so the only safe setting for a reachable host is *unset*. Never enable it there.

   With `ADMIN_TOKEN` unset, the opt-in writes above are open to anyone who can reach the API. On the single-user local trust model this is fine; if anything other than your own browser can reach the API, set `ADMIN_TOKEN` (and restrict CORS origins) or **put it behind a reverse proxy with authentication** (nginx basic auth, mTLS, an OAuth proxy, …). This is the required mitigation, not an option.

### Reverse proxy sketch (only if you must expose the API)

```nginx
server {
    listen 443 ssl;
    server_name explorer-api.example.com;

    # Auth in front of EVERYTHING, including the opt-in-gated writes that
    # stay open while ADMIN_TOKEN is unset:
    auth_basic "explorer";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:8201;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then have the frontend talk to `https://explorer-api.example.com` (manual URL entry) and set `ADMIN_TOKEN` on the backend.

## What does NOT exist (removed stale guidance)

Earlier versions of this document described Cloudflare Workers proxies, `VITE_API_URL` environment wiring, a `/api` proxy through Pages Functions, and PM2 multi-instance deployments. None of that exists in the code: there is no `VITE_API_URL` mechanism, no API proxying from the static host, and no cluster story (see single-writer warning above). Don't re-add them to docs without implementing them. Docker images *do* exist now (shape 4) — as packaging for the single-instance shapes above, not as a scaling story.
