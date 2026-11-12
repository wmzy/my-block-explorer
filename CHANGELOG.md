# Changelog

Versions are published by
[semantic-release](https://semantic-release.gitbook.io/) from conventional
commit messages — the git tags and npm dist-tags are authoritative. This file is
maintained by hand: entries for 0.0.0–1.2.0 were reconstructed after the fact
from `git log` and the npm publish timestamps, so individual lines summarize
commit subjects rather than a curated release notes process.

## Unreleased

- **2026-11-11/12 duplication review fix wave round 6 (4 read-only scouts + 4
  concurrent fix agents + integration)** — 20 findings from the round-6 review,
  all fixed or explicitly dispositioned; net −450 lines across 78 files. All
  verified: tsc 0 errors, eslint 0 errors (112 warnings — 106 pre-existing +
  6 react-refresh from the renamed internalTxnsShared.tsx, the established
  views pattern), `vitest run --changed --maxWorkers=4` full green, `pnpm
  build` green, live curl smoke on the built server (rpc-configs redaction
  gate) + browser smoke of the switched-chain flow.
  **P0 — security-policy triplication closed**: `middleware/rpc-url-visibility.ts`
  (the round-4 canonical for RPC-URL secret redaction) had ZERO importers — both
  intended consumers still ran byte-identical local `redactUrl`/`isLoopbackRemote`
  twins with an inlined trust ternary. `routes/rpc-config.ts` +
  `routes/chains.ts` now import `redactUrl`/`requestSeesFullUrl`; the canonical
  module is live. (Round-3 lesson repeated: a canonical module without its
  callers migrated is dead weight wearing a "shared" doc-comment.)
  **errorMessage fallback overload** — `errorMessage(error, fallback?)` lands in
  utils/errorHandler (empty/whitespace message or falsy non-Error → fallback;
  truthy non-Error keeps its own string form — real info beats the fallback);
  ~45 hand-rolled `err instanceof Error ? err.message : '<fallback>'` ternaries
  across routes (events ×11, search, stats, sql, chains), services
  (CompileVerifyService main-thread ×7 — the worker-eval `reasonOf` stays, it
  cannot import; SearchService ×4, RpcManager, WatchService, webhooks, prices
  ×2, backupRestore's `messageOf` deleted), views (×13) and components/hooks
  (×5) all migrate. Two deliberately-kept sites: `normalizeError` in
  errorHandler (reads `.message` off non-Errors — different semantics) and the
  adapter's `isDuplicateClassError` (feeds a regex, not a display).
  **New canonical helpers** — `utils/chunk.ts` (chunk<T>; throws on size < 1 —
  all three call sites pass module constants; adopted by signatures/prices/
  EventIndexingService, deleting the tests-only `chunkSelectors` export);
  `sqlCountTotal` in `database/init.ts` (pins the drizzle/DuckDB count shape;
  BlockService ×2, SearchService, TransactionService); `readJsonBody(c, code?,
  message?)` in `utils/api-error.ts` (throws an HTTPException whose prebuilt
  Response replays byte-identically through app.onError — folds all 9
  invalid_json arms incl. labels/sql/ops variants); `views/chainNav.ts`
  `chainRedirect(router, chainId, path?, {replace})` — the chain-switch
  navigation 19 views hand-rolled (redirectReplace semantics preserved per
  site; Search's custom variant untouched); `FailedTracesCollapsible` in
  components/internalTxnsShared.tsx (renamed .ts→.tsx for the JSX; both
  internal-txns surfaces' byte-identical failed-traces card collapsed).
  **Dead code deleted** — `types/api.ts` whole file (8 exports, zero importers)
  + the api re-export block in types/index.ts (barrel stays alive for
  Transaction); `TokenTransfer`/`NetworkStats`/`DailyStats` from
  types/blockchain.ts (live shapes live in services/tokenTransfers +
  routes/stats); `formatEth` (format.ts; zero callers — and formatValue is NOT
  a formatNativeDisplay wrapper: negative-wei and non-integer-decimals
  divergences documented in a cross-reference comment, outputs unchanged);
  `validateTimeRange`/`validateBlockRange`/`isValidChainId` (validation.ts);
  `serializeForJson` un-exported; `chunkSelectors`; FUTURE_BLOCK_POLL_* exports
  (value-echo test deleted); the DuckDB adapter's unreachable
  constructor-name timestamp branch (verified against installed
  @duckdb/node-api: `micros` is an own field, so the `'micros' in obj` check
  consumes every instance first).
  **Local extractions** — ContractSourceService creation-tx scan: one hoisted
  getReceipt + a `found(receipt)` closure replacing twin wrappers and three
  byte-identical result literals (every logger.info preserved); EventIndexing
  `decodeLogs`: the 13-field row literal exists once (happy/throw/missing paths
  byte-identical).
  **toLocaleString → formatNumber** — the last ~28 default-locale display sites
  (components/events family, IndexingRangeManager, SegmentedProgressBar,
  ChainResetBanner, TracedProgress, StorageColumn, views/Blocks/Detail +
  Home + Address/summaryStats, routes/addresses, utils/internalTxScan,
  EventIndexingService full-history message) all route through the canonical
  en-US formatter — host-locale grouping nondeterminism eliminated repo-wide
  (format.ts's own en-US `formatDateTime` remains the pinned datetime home).
  One flagged cosmetic delta: quick-create toasts now group block numbers
  (string-wire bounds previously rendered ungrouped via
  String.prototype.toLocaleString identity).
  **cellText adoption** — Address/InternalTxns ×4 + Blocks/List formatMiner +
  EnsInline shortAddress now use `cellText` (EnsInline's blank→N/A guard
  reproduced by cellText's fallback param). Agent seams closed at integration:
  contractDirectoryRoutes' `@/database/init` mock gained `sqlCountTotal`; one
  readJsonBody type assertion dropped for eslint's unnecessary-assertion rule.
  Test-contract updates (source-owned, semantics sanctioned by the pinned
  errorMessage contract): eventsRoutesErrorBodies + verifyShared non-Error
  cases now pin truthy-non-Error-keeps-its-string; signaturesFrontend's
  implementation-only chunk describe replaced by public-path coverage +
  tests/unit/utils/chunk.test.ts.
  **Deferred (unchanged)**: in-flight-dedup Map family, the three scan
  ladders, Address-view micro-extractions.
