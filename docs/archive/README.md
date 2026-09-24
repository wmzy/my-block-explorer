# Archive

Historical design records and work logs, kept for background only. **None of this
describes current behavior** — the code and the maintained docs (see
[../README.md](../README.md)) are the source of truth. API names, file paths and
performance numbers below reflect the moment they were written and were often
superseded:

- [DATA_STRATEGY.md](./DATA_STRATEGY.md) — design-time data-acquisition strategy
  (config management UIs, caching tiers, cost control). The shipped model is the
  README's "data separation": ephemeral data read live from RPC in the browser,
  persistent data cached in DuckDB behind the local API.
- [ON_DEMAND_SYNC.md](./ON_DEMAND_SYNC.md) — the "sync on user access" design
  (`OnDemandSyncService`, access-driven cleanup). Superseded by manual, range-based
  event indexing; references files that never shipped.
- [optimization/](./optimization/) — a 2024-era address-endpoint performance work
  log. Its headline numbers ("99%+ faster", "1–9 ms") were measured against an API
  surface (`/addresses/:address/persistent`, `useAddressData`) that no longer
  exists and were never re-verified; do not quote them as current behavior.
