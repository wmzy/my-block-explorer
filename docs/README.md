# Project docs

Living documents (kept in sync with the code):

- [DEPLOYMENT.md](./DEPLOYMENT.md) — real deployment shapes + security warnings
- [INSTALLATION.md](./INSTALLATION.md) — install from source, env vars, troubleshooting
- [CONFIG.md](./CONFIG.md) — everything actually configurable (env vars, config files, RPC overrides)
- [API.md](./API.md) — API reference (route files are the source of truth)
- [AUTO_DISCOVERY.md](./AUTO_DISCOVERY.md) — how the frontend finds the backend
- [ALL_CHAINS_SUPPORT.md](./ALL_CHAINS_SUPPORT.md) — all viem chains, popular-chain pinning

Historical / design records (not maintained against the code; read as background):

- [ARCHITECTURE.md](./ARCHITECTURE.md) — original architecture design doc; the deployment section reflects reality, the rest is design-time notes
- [DATA_STRATEGY.md](./DATA_STRATEGY.md), [ON_DEMAND_SYNC.md](./ON_DEMAND_SYNC.md), [DEVELOPMENT_SUMMARY.md](./DEVELOPMENT_SUMMARY.md), [SRC_MIGRATION_STATUS.md](./SRC_MIGRATION_STATUS.md), [SEARCH_FIX.md](./SEARCH_FIX.md), [NAVIGATION.md](./NAVIGATION.md), [CHAIN_SWITCHING.md](./CHAIN_SWITCHING.md), [COMPONENTS.md](./COMPONENTS.md)
- [optimization/](./optimization/) — a 2024-era performance work log; its headline numbers ("99%+ faster", "1-9 ms") were never re-verified and should not be quoted as current behavior

Start with the top-level [README](../README.md) for positioning, security model, and verified behavior notes.
