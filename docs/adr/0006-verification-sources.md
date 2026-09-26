# ADR-0006: Contract verification sources and immutable caching

- Status: Accepted
- Date: 2026-09-26

## Context

Contract verification must work across hundreds of chains with **no API
keys** (ADR-0003). Compiled artifacts are immutable — a verified source or a
storage layout never changes after deployment, so cached rows are valid
forever, while failures and misses need bounded retry TTLs. AGENTS.md →
"Immutable Data Caching Strategy" and the "Cache TTLs (persistent fetch
caches)" note pin the shipped numbers; the 2026-09-23/24 waves added manual
and local-compile verification (`verificationSource` union:
`sourcify | blockscan | manual | local-compile | unknown | none`).

## Decision

- Resolution order: **DB cache → Sourcify → blockscan**. On a miss, the
  user can (a) file a **manual local-trust mark** (`POST …/verify/manual`)
  or (b) **compile-verify locally** (`POST …/verify/compile`: solc wasm
  from the official list.json, sha256-verified, bytecode match with
  auxdata-stripping tiers). Any match persists through
  `ContractSourceService` and clears the source cache.
- Manual marks: fresh marks (<1h) serve from the DB shortcut; stale marks
  re-probe Sourcify once — a remote `verified` supersedes the mark, a remote
  miss keeps it. EOAs never cache `unverified` (on-chain code is checked
  first).
- TTLs for persisted fetches: verified source 30d; verified-proxy 24h;
  unverified/partial 1h; creation-lookup failure 24h; storage-layout
  `NOT_FOUND` 24h. Verified source and storage layout are immutable — no
  refresh once verified.

## Consequences

- No Etherscan/blockscan API keys anywhere; verification quality varies by
  chain and is always labeled (the `verificationSource` chip).
- Pasting an ABI ≠ verification: custom ABIs are browser-local only and the
  server-verified ABI always wins once present.
- New external verification sources must extend the union on both sides and
  declare where they sit in the supersession order.
