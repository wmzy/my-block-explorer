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

## Warnings you must not skip

1. **DuckDB is single-writer per file.** The main DB (`data/blockchain.db`) and every per-chain event DB (`data/chains/{type}/{name}-{id}.db`) accept exactly one writing process. Never point two server instances at the same data directory, and don't run the Vite-bridged API and a standalone server simultaneously against the same files.
2. **Event-indexing range writes are unauthenticated by design** (`POST/PATCH/DELETE …/events/ranges*`, `start`/`pause`/`resume`). On the single-user local trust model this is fine. If your API is reachable by anything other than your own browser, **put it behind a reverse proxy with authentication** (nginx basic auth, mTLS, an OAuth proxy, …). This is the required mitigation, not an option.
3. **Admin-gated ≠ public.** Read endpoints are open; `rpc-configs`, cache-clear, and `/api/performance/*` require `x-admin-token` matching `ADMIN_TOKEN` (fail-closed — unset means all gated requests get 403). See README → *Security & admin*.
4. **`ENABLE_DEBUG_API=1` mounts raw SQL execution** (`POST /debug/db/query`). Development aid only — never set it on a reachable deployment.

### Reverse proxy sketch (only if you must expose the API)

```nginx
server {
    listen 443 ssl;
    server_name explorer-api.example.com;

    # Auth in front of EVERYTHING, including the unauthenticated-by-design
    # event-range writes:
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

Earlier versions of this document described Cloudflare Workers proxies, `VITE_API_URL` environment wiring, a `/api` proxy through Pages Functions, Docker compose clusters, and PM2 multi-instance deployments. None of that exists in the code: there is no `VITE_API_URL` mechanism, no API proxying from the static host, and no cluster story (see single-writer warning above). Don't re-add them to docs without implementing them.
