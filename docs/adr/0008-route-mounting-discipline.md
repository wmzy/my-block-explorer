# ADR-0008: Route-table and api-app mounting discipline

- Status: Accepted
- Date: 2026-09-26

## Context

Two shared seams are touched by every feature wave: the frontend route
table (`src/views/index.tsx`) and the backend API mounts (`src/api-app.ts`).
Parallel agents editing them collide. Separately, the 2026-09-25 wave #2
integration found that Hono **hoists a mounted sub-app's `app.use('*', gate)`
to `<base>/*` on the parent app**, silently swallowing every sibling route
mounted after it — the SQL console's strict gate had been 403'ing watch/SSE
(and unknown `/api` paths) in every zero-config session since it landed,
while per-route unit tests (mounting routes in isolation) stayed green
(AGENTS.md → 2026-09-25 wave #2, "Integration-phase finds").

## Decision

- **Cross-cutting wiring is integration-owned.** Feature work delivers
  views, route modules and services; the route table, `api-app.ts` mounts,
  the `tests/unit/app.test.tsx` route contract test, and shared barrels are
  wired by one integrator in a single change. Siblings coordinate through
  messaging, not by editing the seam.
- **Sub-app middleware MUST scope its own path prefix** —
  `app.use('/sql/*', …)`, `app.use('/ops/*', …)` — never `app.use('*', gate)`
  inside a sub-app that will be mounted.
- New sub-app mounts get a **mount-isolation regression test** composing
  the real sub-app with dummy sibling routes — the pattern pinned by
  `tests/unit/mountGateIsolation.test.ts`.

## Consequences

- Parallel waves land without merge conflicts at the seams; exactly one
  agent holds the wiring at any time.
- Gate-scope regressions are caught by composition tests, which are the
  only kind that can see hoisting — isolated per-route tests cannot.
- Adding a route means updating the route table, the API index and the
  contract test in the same change; partial wiring fails loudly at
  integration.
