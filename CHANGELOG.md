# Changelog

Versions are published by [semantic-release](https://semantic-release.gitbook.io/)
from conventional commit messages — the git tags and npm dist-tags are
authoritative. This file is maintained by hand: entries for 0.0.0–1.2.0 were
reconstructed after the fact from `git log` and the npm publish timestamps, so
individual lines summarize commit subjects rather than a curated release notes
process.

## Unreleased

- **Address deep scan** — persistent, resumable per-address transaction-discovery jobs (`POST/GET …/addresses/:a/scan` + pause/resume/delete): a forward balance-checkpoint walk (adaptive 50k batches halving on provider range errors, binary-searched change blocks) that persists findings in DuckDB, checkpoints progress every segment, reconciles interrupted jobs at startup, and upgrades address coverage to `complete` **only** for genesis-anchored finished walks — the first sanctioned complete path. The address page's transactions tab gains the Deep Scan panel (live progress, honest ETA, pause/resume).
- **Entity search** — free-text `/api/search` matches curated known-token symbols and your address labels (`tokenHits`, ≤5, label-wins dedup; the field is dropped, not emptied, on a failed labels read).
- **Approval history** — the approvals response carries the swept raw approval events (`history`, newest-first cap 200 + `historyTruncated`), rendered as a collapsible timeline; the approvals section also gains the missing inline Retry.
- **Token standard filter** — transfer rows carry `logStandard` (the standard the log shape alone proves) and the Token Transfers tab gains All/ERC-20/721/1155 chips riding `?ttStandard=`. En-route bug fix: 4-topic ERC-721 Transfer rows were silently dropped by every scan (missing `value`); the token id is now read from the indexed topic.
- **Safe multisig decode** — `execTransaction` calls render a structured card (inner call target/value/operation, inner selector resolved, ≈N-signature estimate) with selector-based-detection honesty copy; the decoder re-encodes round-trip as a guard against viem's lenient tail-truncated bytes decoding.
- **Protocol method labels** — curated Uniswap router family (62 corroborated addresses across 8 chains, per-entry source citations + on-chain liveness checks; chains without official deployments ship empty) chip the tx-list Method column and tx detail.
- **Local data portability** — `GET /api/labels` (opt-in admin) + a settings-modal Backup & restore section exporting/importing `explorer-backup.json` (labels, custom chains, watchlist/theme/IPFS gateway/custom ABIs; localStorage keys pattern-pinned so a hostile file cannot write arbitrary keys).
- **Admin SQL console** — `/sql` page + `POST /api/sql/query` / `GET /api/sql/tables` over the explorer's own DuckDB: strict fail-closed admin tier, single SELECT/WITH statement guard, 22 forbidden word tokens, 500-row measured cap, JSON-normalized cells.
- **Cleanup** — vestigial `search_history` table dropped (migration 0012; the parallel per-chain `chain-schema.ts` definition removed too); deep-scan tables are migration 0013; the `@/utils` barrel now re-exports all util modules (8 name collisions resolved explicitly).
- **Deep scan catch-up** — `POST …/scan/catchup` extends a settled walk's `toBlock` to the current chain head (cursor + findings preserved, no re-walk); the Deep Scan panel offers "Catch up to latest" and scopes the complete claim to "… up to block N". En-route fix: the panel's job parser only accepted `{job}`-wrapped envelopes while every scan route returns the flat DTO — the panel was broken against the real backend behind mocked tests.


## 1.2.0 — 2026-09-19

- Honest degradation across offline state, search, ENS, the contract form and cache tiers; ENS reverse names roundtrip-verified (spoofed reverse records render as no name).
- Reorg reconciliation (unfinalized rows receipt-verified, reorged-out rows deleted), chain-scoped search (`?chainId=`), RPC endpoint redaction for untrusted origins.
- Token transfers tab on the address page, block finality badges, URL-driven pagination for lists and search windows.
- Degraded-mode explorer: parallel localhost port scan, per-browser search history, address search window.
- Two-tier admin gate (`requireAdminToken` fail-closed vs. `requireAdminTokenIfConfigured`), shared CORS allowlist consumed by both the API and the Vite dev server, async range indexing and pending-tx polling.
- Indexing queue removed (one serial job per range); admin auth util; search-degradation and cache-invalidation tests.

## 1.1.0 — 2026-09-17

- Admin-token gating for core-workflow writes; async event indexing with decoded-argument filters; custom ABI upload and transaction decode.
- Frontend migrated to the painless-template architecture: `@native-router/react` (flat typed route table), react-toolroom query layer, fetch-fun HTTP chain, Linaria + haze-ui styling.
- Dynamic chain landing, transaction pagination and search fixes; external links; event-filter fixes; database schema refactor.

## 1.0.0 — 2026-04-07

- First semantic-release tag. Contract storage-layout viewer, contract-source and verify-refresh fixes, `verification_source` tracking, DuckDB WAL recovery and graceful shutdown.
- Block-number search; GitHub Pages SPA deploy (base URL, home page, CORS, service status); "open in IDE"; CI release pipeline.

## 0.0.0 — 2026-03-22

- Initial npm publish (pre-semantic-release). Multi-chain explorer core: all viem chains supported with popular-chain pinning, top navigation with global search and chain switching, complete backend service suite with tests, DuckDB + Drizzle ORM storage with type-safe schema, contract event indexing with ABI-based filtering/sorting/pagination, multi-chain contract verification, proxy contract detection and switching UI, client-side contract interaction, contract data caching, address data separation (persistent DB cache + live RPC reads).
