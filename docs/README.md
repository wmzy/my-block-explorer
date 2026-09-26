# Project docs

Lean, maintained set — the code stays the source of truth; these files explain it:

- [README](../README.md) — top-level: positioning, features, security model, verified behavior notes. Start here.
- [INSTALLATION.md](./INSTALLATION.md) — install from source, the three run modes, troubleshooting
- [CONFIG.md](./CONFIG.md) — everything actually configurable (env vars, config files, RPC overrides)
- [API.md](./API.md) — API reference (route files are the source of truth)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — the system as shipped (routing, chain switching, search dispatch, auto-discovery) followed by the original design-time document
- [DEPLOYMENT.md](./DEPLOYMENT.md) — real deployment shapes + security warnings
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, commands, testing discipline, conventions for contributors

[adr/](./adr/) — architecture decision records (the durable *why* behind the
conventions CONTRIBUTING states as rules); [adr/README.md](./adr/README.md) is the index.

[archive/](./archive/) — historical design records and work logs, kept for
background only; they do not describe current behavior.
