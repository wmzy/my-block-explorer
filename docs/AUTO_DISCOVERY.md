# Auto-discovery & backend selection

How the frontend finds the API server. The implementation is `src/hooks/useAutoDiscovery.ts` (hook) + `src/util/apiBase.ts` (base URL consumed by the HTTP layer) + the service-discovery gate in `src/index.tsx` (renders the `ServiceSetup` screen until a backend is found).

## Mechanism

1. On mount, `useAutoDiscovery().autoDiscover()` scans **`localhost` ports 8201–8205**, probing `GET /api/health` on each with an `AbortController` timeout (`probeHealth`).
2. The first healthy backend wins; its URL is persisted to localStorage (`my-block-explorer-api-url`) and pushed into `setApiBase()` so every request from `src/util/http.ts` (fetch-fun chain) is prefixed with it.
3. If no port answers, the app shows the setup screen with a **manual URL fallback**: the user types a backend URL, it is validated by probing `/api/health`, then persisted like an auto-discovered one.
4. `reconnect()` prefers the saved URL and falls back to a fresh port scan; `disconnect()` clears runtime state but keeps the saved URL.

Status machine: `idle → discovering → found | not-found | error`.

## What this means in practice

- **Dev (`pnpm dev`)**: the Hono app is bridged into the Vite server on `:3000`, but the frontend still prefers a discovered standalone backend on 8201–8205 when one is running. Note the single-writer rule: don't run the bridged API and a standalone server against the same DuckDB files at once.
- **`pnpm dev:server` / `pnpm start`**: standalone API on 8201 — discovered automatically by any frontend opened from localhost.
- **Hosted frontend (GitHub Pages etc.)**: discovery **cannot** find a remote backend — the scan is localhost-only. Every user enters their own backend URL manually once; it persists in localStorage per browser. The backend enables CORS so the cross-origin calls work.

## Real state & storage

| Item | Value |
| --- | --- |
| Scanned host | `localhost` |
| Scanned ports | `8201, 8202, 8203, 8204, 8205` |
| Health probe | `GET /api/health` |
| Saved URL key | `my-block-explorer-api-url` (localStorage) |
| Admin token key | `my-block-explorer-admin-token` (localStorage, separate concern — see README → Security) |
| ServiceInfo | `{ host, port, url, version?, latency? }` |

Earlier versions of this document carried full pseudo-listings of a `ServiceDiscovery` class and a `ConfigManager` under `src/client/lib/` with an install flow (`npm install -g @block-explorer/server` on the old 300x port) and a `BrowserRouter` entry example. None of that exists; the hook in `src/hooks/` is the real implementation.
