# ADR-0005: Frontend stack — native-router, react-toolroom, fetch-fun, Linaria + haze-ui

- Status: Accepted
- Date: 2026-09-26

## Context

The frontend was migrated off React Router + TanStack Query onto the
painless-template stack (AGENTS.md → CONVENTIONS → React;
docs/ARCHITECTURE.md Part 1 documents routing, chain switching and
auto-discovery as shipped). The stack choices are load-bearing: the route
table is also the type contract for links, and the query layer's semantics
(error caching, control-value dialogs) have pinned conventions.

## Decision

- **Routing**: `@native-router/react` with ONE flat `createRoutes` table in
  `src/views/index.tsx`; `AppPaths` literal union + `TypedLink<AppPaths>`
  (path typos fail at compile time); params via `useMatched()`, query state
  via `useSearch(schema)`. No React Router, no nested routing. The chain
  lives in the URL (`/chain/:chainId`) — no global chain state.
- **Server state**: `react-toolroom/async` via `src/util/useQuery.ts`
  (`createQueryCache` + `bindQueryFn` + `createQueryHook`); hooks return
  `{data, loading, error}`; polling composes `src/services/polledQuery.ts`.
  No TanStack Query.
- **HTTP**: fetch-fun (`src/util/http.ts`) on the runtime-discovered base
  (`src/util/apiBase.ts`). Frontend service paths MUST start with `/api/` —
  the base is origin-only.
- **Styling**: Linaria `css` tag + `cx()` composition; theme through
  `--haze-*` variables; haze-ui components — **never alias named haze-ui
  imports** (`{ Button as B }` breaks `vite-plugin-haze-ui`'s scan).
- haze-ui Dialog `open` takes a `useControl` Control object — a plain
  boolean is only an INITIAL value (later flips are ignored).

## Consequences

- Query caches hold errors until remount — surfaced sections need retry
  affordances.
- React StrictMode is off (double-mount aborts route-loader signals).
- View state rides the URL (`?tab=`, `?page=`, window params) so deep links
  stay shareable; use `optional().catch(undefined)` + an effective-value
  derivation when "explicitly set to the default" must differ from "absent".
- Route-table changes are integration-owned (ADR-0008).
