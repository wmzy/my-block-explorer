# Architecture Decision Records

Short records of the decisions that keep coming up in review — the "why"
behind the conventions summarized in
[CONTRIBUTING.md](../CONTRIBUTING.md) and AGENTS.md. Each ADR is ≤60 lines:
Status, Context (citing AGENTS.md sections / source files), Decision,
Consequences.

| Number | Title | One-liner |
| --- | --- | --- |
| [0001](./0001-data-separation.md) | Data separation | Ephemeral data from RPC in the browser; persistent data via the backend into DuckDB |
| [0002](./0002-honesty-coverage-model.md) | Honesty/coverage model | Every surface declares a coverage level; partial is never presented as complete; `complete` only via genesis-anchored deep scan |
| [0003](./0003-lightweight-local-positioning.md) | Lightweight-local positioning | Single-user local tool; no accounts/API keys/multi-tenant; two-tier admin gate (strict vs opt-in) |
| [0004](./0004-duckdb-drizzle-adapter.md) | DuckDB via custom Drizzle adapter | `postgres`-interface adapter over DuckDB; no SERIAL, composite PKs, per-chain event DBs, naive-UTC timestamps, single writer |
| [0005](./0005-frontend-stack.md) | Frontend stack | native-router flat typed routes, react-toolroom query layer, fetch-fun HTTP, Linaria + haze-ui — no React Router/TanStack |
| [0006](./0006-verification-sources.md) | Verification sources | DB → Sourcify → blockscan, then manual/local-compile; immutable caching with bounded failure TTLs; no API keys |
| [0007](./0007-browser-capability-surface.md) | Browser capability surface | Traces/mempool/gas/prices run on the user's RPC in the browser with honest unsupported states — never backend-indexed |
| [0008](./0008-route-mounting-discipline.md) | Route mounting discipline | Integration-owned route table/api-app wiring; sub-app gates scoped to their own prefix (Hono `*` hoisting hazard) |

## Adding a new ADR

1. Take the next free number; file name `NNNN-kebab-title.md`.
2. Copy the closest existing ADR as a template; keep it ≤60 lines.
3. Sections: `Status: Accepted` (or `Superseded by ADR-NNNN`), `Date`,
   `Context` (cite the AGENTS.md sections and source files that ground it),
   `Decision`, `Consequences`.
4. Add a row to the table above.
5. Never delete or rewrite an accepted ADR — supersede it with a new one
   and flip its Status line.
