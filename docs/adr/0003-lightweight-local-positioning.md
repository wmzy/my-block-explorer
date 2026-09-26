# ADR-0003: Lightweight-local positioning and the two-tier admin gate

- Status: Accepted
- Date: 2026-09-26

## Context

DuckDB allows a single writer per database file — there is no plausible
multi-writer hosted deployment of this backend. The trust model is "one
local user" (README → Security & admin). `src/startupChecks.ts` warns loudly
on a non-loopback HOST without `ADMIN_TOKEN`. PM explicitly deferred
accounts, API keys and hosted multi-tenant features as out of scope
(AGENTS.md → 2026-09-23 wave, "Deferred by PM decision"; re-pinned in the
2026-09-22/23 "轻量本地运行定位" wave).

## Decision

- The product line is a **lightweight LOCAL tool** (single user, own
  machine, own DuckDB files). No accounts, no API keys, no hosted
  multi-tenant features; proposals needing that infrastructure are rejected
  at review.
- Admin auth is **two-tier**, both keyed on the `x-admin-token` header with
  a timing-safe compare (`src/middleware/admin-token.ts`):
  - **Strict / fail-closed** (`requireAdminToken`): 403 whenever the token
    is unset or wrong. Covers raw-power surfaces — `/api/performance/*`,
    the SQL console, the debug API.
  - **Opt-in** (`requireAdminTokenIfConfigured`): passes when `ADMIN_TOKEN`
    is unset (zero-config local sessions work out of the box), enforces
    identically to strict when it is set. Covers core-workflow writes
    (event ranges, rpc-config writes, cache clears, labels, verify, …).
- CORS is an origin allowlist (`src/middleware/cors-origins.ts`), never `*`.

## Consequences

- Zero-config local use is a hard requirement — any new write endpoint must
  pick a tier and justify it (non-destructive → opt-in; raw power → strict).
- Exposing the API on a shared network requires `ADMIN_TOKEN` + CORS
  allowlist or an authenticated reverse proxy (docs/DEPLOYMENT.md).
- Webhook targets ship without SSRF filtering — a documented consequence of
  the single-user model, not an oversight.
