# Changelog

Versions are published by
[semantic-release](https://semantic-release.gitbook.io/) from conventional
commit messages — the git tags and npm dist-tags are authoritative. This file is
maintained by hand: entries for 0.0.0–1.2.0 were reconstructed after the fact
from `git log` and the npm publish timestamps, so individual lines summarize
commit subjects rather than a curated release notes process.

## Unreleased

- **2026-11-13 duplication review fix wave round 7 (4 read-only scouts +
  5 concurrent fix agents + integration)** — the round-7 review's findings
  all fixed; net +~600 lines across ~70 files (the hex-island restyle adds
  shared css families while deleting per-panel twins). All verified: tsc 0
  errors, eslint 0 errors (112 warnings = the round-6 baseline),
  `vitest run --changed --maxWorkers=4` 246 files green after 2 integration
  fixes, `pnpm build` green, full browser smoke on the built bundle served
  by the standalone server (dark theme, USDC contract verified +
  decimals() → `Result: 6` through the restyled Interact form, Storage/ABI
  tabs, RPC modal, topnav search dispatch to a block page, zero console
  errors).
  **New canonical leaves (Main-authored before the wave so agents had zero
  cross-dependencies)** — `utils/isRecord.ts` (arrays-rejected record
  guard; NINE hand-rolled locals deleted across services/routes/views,
  two of which rejected arrays and seven didn't — per-site equivalence
  audited), `utils/boundedPool.ts` (`runBoundedPool` shared-cursor pool
  with `shouldStop`; the four backend scheduling loops migrated:
  crossChainProbe, EventIndexingService timestamps, WatchService tick,
  AddressScanService trace fan-out — error policy/checkpoint/CAS lines
  byte-identical; `runTracePool` stays as the browser specialization),
  `utils/viemChainExports.ts` (the ONE chain-id→viem-export table —
  viemScript and storageSlotCode carried DIVERGENT private copies
  (fantom vs zksync); parity pinned against POPULAR_CHAINS + real
  viem/chains exports; zksync 324 snippets now take the defineChain
  fallback, pinned), `utils/time.ts` (`MS_PER_DAY` — was three spellings).
  **Contract hex island dissolved** — the bootstrap-era hardcoded palette
  (#007bff/#f8d7da/#d4edda/#fff8e6/#f0a500 families, ~60 literals across
  17 files) migrated to `--haze-color-*` tokens via 13 shared css families
  in `views/Contract/styles.ts`; all inline `style={{…}}` objects converted
  (RpcConfig's hidden file input now uses the native `hidden` attribute —
  jsdom-visible, browser-identical); OpenInIdeButton's JS hover hacks →
  CSS `:hover`; three pre-existing silently-broken token names
  (`--haze-info*`, `--haze-primary`, `--haze-text-muted` in
  Contract/index) + EventsPanel's `--haze-text-secondary` fixed. Dark
  mode no longer breaks on these surfaces.
  **UI motion/skeleton consolidation** — the five re-declared pulse
  keyframes (Charts, Token, CrossChainStrip, BalanceHistory, approvals)
  compose `skeleton.ts`'s canonical bases (gaining the
  prefers-reduced-motion opt-out they all lacked; new `shimmerSweep`
  export for the gradient variant); `components/ui/motion.ts` (exported
  base-CLASS twin of skeleton.ts, CSS-var-pinned site deltas) shared by
  the three ServiceSetup enter-rises + the scanning progress sweep;
  `useCopyLabel` exported from useCopyFeedback (GettingStarted, NftGrid).
  **Dead schema dropped (migration 0017)** — `user_preferences`,
  `index_status`, `access_history`, `event_table_registry`: zero
  references anywhere; four DROP TABLE statements with meta snapshot,
  drizzle-kit check green, applied live.
  **Dead exports deleted** — `WATCH_ROUTE_LIMITS` (routes/watch),
  `types/index.ts` whole barrel (zero importers; the one type-only
  `@/types/index` import retargeted to `@/types/blockchain`),
  `EIP1967_ADMIN_SLOT` (proxyDetection), un-exported internal-only:
  blockTagUtils' four sentinel helpers (barrel surface shrank, barrel.test
  re-pinned), beacon prefix pair, `paramLabel`, `buildFunctionSignature`,
  `effectiveGasCap`/`effectiveTip`, `blockGasSharePercent`, `TX_CURSOR_SCALE`
  — every removal grepped for importers first; affected tests migrated
  through public surfaces. sorting-optimization's three `export interface`
  → `type` (convention); its class/cache stay (test-pinned, NOT dead —
  the review's dead-code claim was wrong).
  **Real comment-lie fixed** — gasShare's header claimed it routed through
  `formatPercentage` while hand-rolling `toFixed(1)` + its own '—' guard;
  now actually routes through it (output byte-identical) and
  formatPercentage is live in src for the first time.
  **fetchWithTimeout adoption** — 7 of 9 inline `AbortSignal.timeout`
  sites migrated (ContractSource ×2, CompileVerify ×2 + the injectable
  fetchJson dep retype signal→budget, SignatureService, webhooks); the
  two exemptions documented in place (nftMetadata's jsdom feature-detect,
  ContractVerifyService's single shared 30s deadline threaded through
  submit+polls — a genuine semantic, not drift).
  **Seam fixes** — mcp get_address_overview classifies via `codeVerdict`
  (no more inline 7702 ternary); og-meta's two middlewares share one
  `serveIndexHtml` tail; routes/search drops the NaN sentinel dance and
  the unreachable `!chainIdParam` branch; respondError's status cast
  widened (409/502) and chains.ts's hand-rolled envelopes migrated;
  addresses.ts's window-parse twin unified; chainParam's parsers delegate
  to parseStrictInteger; Search view's two dispatch chains share one
  helper; TopNavigation's `goTo` twins hoisted; MS_PER_DAY adopted by
  chartStats/contracts/CompileVerify.
  **Environment incidents (disclosed)** — (1) the dev DuckDB was found in
  the journal-mismatch dirty state AGAIN (ids 1-2 missing, replay loop
  with cause-less "Failed query"); rebuilt fresh twice — the SECOND
  trashing was self-inflicted: killing the server and starting the next
  writer inside the 5s graceful-shutdown window creates a dual-writer
  that corrupts the journal. Rule pinned: poll the pid for actual exit
  before starting the next DB opener. (2) The **vite dev bridge broke
  against DuckDB** on this tree: every query through the bridge fails
  (cause:{} + 0001 replay every 4s) while the standalone server on the
  same code+file works; a 4h48m bridge run left the journal trashed.
  Root cause NOT yet diagnosed; the wave's smoke ran on the standalone
  server with `SERVE_STATIC_DIR=dist/client` (single process, SPA + API
  same-origin) — bridge investigation is a follow-up. Known residuals:
  CustomAbiPanel's label-swap copy button still bespoke (same family as
  the deferred pair), SegmentedProgressBar's opacity-pulse stays local
  (genuinely different shape from shimmerPulse, incl. its missing
  reduced-motion opt-out — pre-existing), deferred families unchanged
  (in-flight Maps now 8, scan ladders, Address-view micro-extractions).

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
