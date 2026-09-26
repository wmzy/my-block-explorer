# ADR-0001: Data separation — ephemeral via RPC, persistent via backend + DuckDB

- Status: Accepted
- Date: 2026-09-26

## Context

Explorer data splits into two classes with opposite lifecycles. Blocks,
balances and nonces change every few seconds and are cheap to read from any
RPC endpoint. Contract source/ABI, indexed events, labels and storage layouts
are immutable or append-only and expensive to recompute. AGENTS.md →
"UNIQUE STYLES → Data Separation Architecture" is the canonical description;
service discovery "degrades, never blocks" (AGENTS.md → NOTES) means the
frontend must render with no backend at all.

## Decision

- **Ephemeral data is fetched in the browser, directly from RPC via viem**
  (`createRpcClient` in `src/utils/realTimeData.ts`): blocks, transactions,
  balances/nonces, contract read/simulate, traces, mempool, gas history,
  prices.
- **Persistent data goes through the backend API (Hono) into DuckDB**:
  contract source/ABI, indexed events, address labels/metadata, storage
  layouts, search index.
- The address API returns persistent data only — the UI reads balance/nonce
  live from RPC (`src/services/addressRealTime.ts` composed with the
  persistent channel in the view).
- Immutable artifacts (source, storage layout) are cached forever once
  fetched (AGENTS.md → "Immutable Data Caching Strategy").

## Consequences

- The frontend is fully usable in RPC-only mode (run mode 1 in
  docs/INSTALLATION.md); a backend adds indexing/labels/caching on top.
- Backend outage is an explicit degradation (BackendOfflineState, discovery
  banner), never a broken app.
- The backend stays small — no block mirroring, no chain-following indexer
  except the explicitly requested event ranges.
- RPC provider limits and failures surface in the browser and must be
  handled honestly (ADR-0002, ADR-0007).
- Two RPC client layers exist by design: browser `createRpcClient` and
  backend `RpcManager` — both cache per chainId; do not merge them.
