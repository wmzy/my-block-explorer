# Changelog

Versions are published by
[semantic-release](https://semantic-release.gitbook.io/) from conventional
commit messages — the git tags and npm dist-tags are authoritative. This file is
maintained by hand: entries for 0.0.0–1.2.0 were reconstructed after the fact
from `git log` and the npm publish timestamps, so individual lines summarize
commit subjects rather than a curated release notes process.

## Unreleased

- **2026-11-10 duplication review fix wave (7 agents, 2 waves + integration)** —
  round 4 of the dedup review; every confirmed finding fixed. All verified:
  `tsc` 0 errors, eslint 0 errors (46 warnings, all pre-existing
  react-refresh/exhaustive-deps classes; 39 matched at HEAD), `vitest
  --changed` 263 files / 3,347 tests green, `pnpm build` green (client +
  server). **Dead code** — `EventDecodingService` (562 lines, zero
  importers; its sibling family died 2026-09-30 but this file escaped) +
  the 7 decoding types in `types/events.ts` that existed only for it. **New
  canonical modules** — `utils/multicall.ts` (MULTICALL3_ADDRESS +
  readMulticallValue/Bigint/Result; was re-declared in 4 services + the
  Address view), `utils/transactionType.ts` (the toDb/toRpc tx-type mirror,
  in an import-free leaf), `utils/scanParams.ts` (?refresh=1 literal +
  readStrictInt; was verbatim twins in transfers/approvals),
  `middleware/rpc-url-visibility.ts` (redactUrl + requestSeesFullUrl; was
  verbatim twins in routes/chains + routes/rpc-config — the URL-secret
  policy now changes in one place; startupChecks' HOST loopback predicate
  folds onto the same core, gaining ::ffff:127.x-mapped-HOST recognition),
  `util/useGenerationGuard.ts` (the ++claim guard ×3 — claim-only API so
  the read-based regression class cannot return; NOT needed on query-cache
  fetches, whose newest-run-wins is native to react-toolroom),
  `util/useDebouncedQueryParam.ts` + `useDebouncedValue` (the ?q=
  input-leads-URL state machine ×3 + two debounce twins),
  `resolveMainnetDefaultChainId` in utils/chainParam (the two-tier chainId
  guard ×4). **Events poll unified** — `services/eventsRanges.ts`: ONE
  query-cache entry + ONE module-level coordinator interval behind both
  EventStatistics and IndexingRangeManager (was two parallel 3s polls of
  the same /events/ranges; now 3 GET/3s total incl. status + head, both
  panels fed by the same request; mutations refetch the shared entry;
  IndexingRangeManager's per-tick full-panel "Loading…" re-flash removed —
  initial-load only now). **Behavior fixes** — `formatValue` learns native
  decimals (was hardcoded 18-decimal scaling on every tx surface; Home/tx
  list/detail/call-trace/internal-txns now thread
  nativeCurrency.decimals — non-18-decimal chains render correct values);
  AddressScanService's defensive datetime parse + db-types' timestamp
  customTypes route through `toIsoTimestamp` (naive strings parsed as UTC,
  never machine-local; the datetime customType's dead-branch twin fixed
  with it); labels/signatures/verify 400s migrate onto the canonical
  `respondError` envelope (additive statusCode/timestamp; the
  deliberately-bare contracts stay bare and are documented in api-error.ts
  — watch's chain-id 400 now renders through the shared envelope instead
  of a bare invalid_request). **Consolidations** — errorMessage where
  genuinely pure-form (mcp/rest's causeMessage; the ~20 scout-flagged
  ternaries mostly proved to be deliberate custom-fallbacks and stayed),
  `formatRawUnits` (the formatUnits+symbol pattern ×7), `formatGasString`
  (×2), `shortSlot` (storage chips ×2), `spinnerBase` (Button/EventTable
  border-spinner twins, exported base class per the Linaria keyframe
  lesson), `toastCopy` in util/clipboard (copy+toast ×3 + Ops
  diagnostics), `useConditionalPolling` + `POLL_DISABLED_INTERVAL` in
  polledQuery (×2), bare `toLocaleString()` display sites →
  formatNumber/formatNumber-en-US across views (BigInt-exact sites use
  formatBigInt — formatNumber's bigint path rounds through Number),
  `effectiveTransferStandard` identity export inlined, clampPage dedup,
  watch's inline limit parse → parsePaginationParams. **Integration finds
  (pinned)**: (1) consolidating the tx-type mirror by importing
  blockRpcData from TransactionService dragged
  realTimeData→config/chains→customChains→'@/util/http' into the
  vite.config bundle and broke `vite build` — the browser-RPC-in-backend-
  graph rule re-proven; the shared helper lives in an import-free leaf and
  a pure re-export is NOT enough for a module's own internal calls (bind
  via import + re-export). (2) react-toolroom's useRun defers the initial
  load past render — tests asserting mount-parked requests need one
  `await act(async () => {})` flush first. (3) vitest's jsdom reports
  `document.hidden === true` (visibilityState 'prerender') — any
  visibility-gated poll tick is dead in tests; the coordinator now polls
  regardless of visibility, matching the hand-rolled intervals it
  replaced. (4) The ETA sampler being fed the mount payload makes the
  ≥6s window form one tick earlier (mount → first tick counts); the
  estimate is unchanged. (5) Agent C's formatGasString test expectations
  contradicted BigInt's own semantics (BigInt('') is 0n, '0x1a' parses as
  hex) — tests now pin the real contract.

- **2026-11-09/10 duplication review fix wave (3 waves, 9 agents + integration)** —
  a fresh full-repo review for duplicated/inelegant implementations; every
  confirmed finding fixed. All verified: `tsc` 0 errors, eslint 0 errors (103
  warnings, all pre-existing react-refresh/exhaustive-deps classes),
  `vitest --changed` 370 files green, `pnpm build` green, live Chromium smoke
  on mainnet. **Correctness** — the divergent second migration system
  (`src/database/migrate.ts`, drizzle's official postgres-js migrator whose
  name-less journal rows the runtime adapter's runner can never match, causing
  full-migration replays) is deleted along with the undocumented `pnpm
  migrate` script: the adapter's auto-migrating runner is the one system;
  `toIsoTimestamp` (the naive-UTC-safe datetime parser — exact class of the
  recorded +8h DuckDB skew bugs) is extracted to `utils/dbTime.ts` (was
  verbatim ×2 in SearchService + routes/labels, acknowledged in comments);
  three DEAD methods deleted from ContractInteractionService
  (`readContract`/`simulateContract`/`estimateContractGas` non-ABI variants,
  ~150 lines, zero callers — they were near-clones of the live WithABI trio
  with an already-drifted `stateOverride` asymmetry); label/note wire caps
  (64/500) single-sourced in `utils/labelContract.ts` (were independently
  defined by the route and the backup restorer — a one-sided change silently
  dropped restores). **Real bug found by the integration smoke (pre-existing,
  user-visible)** — the SSE live block stream NEVER worked: streamRoutes'
  literal `/chains/:chainId/blocks/stream` was mounted AFTER blocksRoutes'
  `/blocks/:blockNumber`, so every EventSource connect was captured by the
  block-detail route and answered `400 Invalid block number`; the app
  silently degraded to polling forever and the "Live" badge never lit. Fixed
  by mount order in api-app.ts; proven streaming `text/event-stream` with
  real block frames on the built server. **Consolidations** —
  `utils/csv.ts` (RFC-4180 escaping + timestamp cells + attachment headers;
  was byte-identical pairs across the two export services and two routes);
  events-route pagination migrated onto `parsePaginationParams` (new
  `limitBelowOne: 'clamp'` option preserves the legacy clamp-`pageSize=0`
  wire behavior, pinned by test); canonical `errorMessage()` in
  utils/errorHandler.ts replaces ~25 pure-form inline ternaries and 5 local
  definitions (custom-fallback and variant-semantics sites deliberately
  untouched, classification pinned in the agent report);
  AddressScanService's hand-rolled LRU → `createTtlLruCache({ ttlMs:
  Infinity })` (plus the `cacheMisses` debug label no longer lies);
  PerformanceMonitor.checkOperation lost its dead `expectedDuration` option,
  measures real `duration`, and logs retries via `console.warn`. **localStorage
  discipline completed** — all five storageAccess helpers take an optional
  injectable `GuardedStorage` (default resolves INSIDE the try, keeping the
  Safari-private-mode property-GET guard); themePreference/units/watchlist/
  adminAuth/privateNotes/tokenDirectory/RpcConfig/GettingStarted/Sql/
  Contract-custom-ABI all migrated off hand-rolled try/catch; the eslint
  allowlist shrank 17 → 2 files (storageAccess + backupRestore's
  enumeration loop); `be:sqlConsole` and `be:onboardingDismissed` registered
  in the storageKeys manifest (previously invisible to the backup planner)
  and the `be:viewedTokens:` literal single-sourced. **Frontend CSS layer**
  — EventTable composes shared exports from DataTable
  (`tableShellStyle`/`tableBaseStyle`/`paginationBarStyle`/`pageInfoStyle`/
  `pageButtonsStyle`) and imports `monoStyle`, fixing the hardcoded-12px
  drift (`--haze-text-xs` is exactly 12px, so zero visual change); its
  within-file twins (sort/page-size selects, labels, raw-log chips, loading
  JSX) collapsed; `components/ui/noticeBar.ts` absorbs the five verbatim
  notice-strip copies; `components/ui/skeleton.ts` ships Home's
  skeletonBase (keyframes are block-scoped in wyw-in-js — cross-file sharing
  must be a base class; the NftHoldings/NftGrid pulse pair deduped as
  `shimmerPulse`, the four genuinely-different pulses stay local);
  `components/internalTxnsShared.ts` + `TracedProgress` absorb the
  InternalTxns twin styles and progress copy; `util/useClickOutside.ts`
  absorbs the three hand-rolled close-on-outside-click effects; BigInt
  display goes through `formatBigInt` (locale-stable grouping, exact beyond
  2^53) in TokenTransfers/Address/Blocks-Detail. **Deferred (deliberate,
  unchanged)**: in-flight-dedup Map family (now 7 instances), the three
  adaptive-halving scan ladders, Address-view micro-extractions.

- **2026-11-09 duplication follow-up wave (6 agents, 2 waves + integration)** —
  the residue the 2026-11-08 review left behind, fixed end-to-end. All
  verified: `tsc` 0 errors, eslint 0 errors (98 pre-existing warnings),
  `vitest --changed` green, `pnpm build` green. **Dead code deleted
  (~1,900 more lines)** — the entire vestigial per-chain DB subsystem
  (`database/chain-database-manager.ts` + `chain-schema.ts` +
  `chain-drizzle.ts` + `config/zero-config.ts` + `zero-config-bootstrap.ts`;
  every service writes the main DB, the manager's only "live" consumer was
  itself dead), 17 dead exports in `config/chains.ts` (incl. the duplicated
  `data/chains/{type}/{name}-{id}.db` path formula, which died with them),
  the `DatabaseManager` alias in `database/init.ts`, the never-called
  `registerAbiEvents`/`getEventSelectorFromName`/`decodeEventData` trio in
  `utils/events.ts`, and the never-read `SortingPerformanceMonitor`. **Real
  bug fixed en route** — webhook event names were ALWAYS `null` in
  production: the fallback consulted a registry cache that only the
  never-called dead trio could populate. Webhook payloads now resolve
  event names honestly (subscription-ABI decode first, then a deduped
  batched openchain signature lookup per sweep, local canonical table for
  the standards; unknown stays `null`, resolution failure never blocks
  delivery). **Consolidations** — `codeVerdict()` in `utils/address.ts` is
  now the single home for the `code !== '0x' && code.length > 2` predicate
  (was hand-rolled at 8 sites, EIP-7702-aware); the callTracer family
  shares `utils/callTraceRpc.ts` + `CallTypeBadge` + a parameterized DFS
  walk (debug_trace cast ×3, badge switch ×3, batch pool ×2, shortMessage
  ×2 gone); `formatHash`/`addressCell`/tokenId comparator/`sleep`/
  timeout-wrapper/`ADMIN_TOKEN_GUIDANCE`/`MAX_WINDOW_BLOCKS`/selector-regex
  copies all collapsed onto their canonical homes; `withTimeout`/
  `withTimeoutOrNull`/`fetchWithTimeout` absorbed six hand-rolled
  AbortController/race copies (prices ×2, txpool, crossChainProbe,
  StorageLayoutService, ContractSourceService's unclosed detectProxy race);
  five unbounded `Map`+expiry caches (prices ×2, tokenMetadata ×2,
  nftMetadata) moved to `createTtlLruCache`; labels/watch route twins and
  the limit/offset/page 400 leaves share one mapping; chain-id validation
  is one leaf; `errorMessage()` replaces ~15 `error instanceof Error`
  ternaries. Notable copy changes: crossChainProbe's timeout reason says
  `4000ms` instead of `4s`; absolute datetimes are pinned en-US (one
  `formatDateTime`); `formatBigIntSafe` replaces a host-locale
  `toLocaleString` in the address page.

- **Sorting perf-monitor removal + absolute-datetime unification** — the
  never-actionable `SortingPerformanceMonitor` (a process-lifetime metrics
  buffer in `utils/sorting-optimization.ts`, its only consumer EventTable)
  is deleted. EventTable's perf panel now reports per-sort facts straight
  from the sorter's own metrics (real `algorithmUsed`, honest `cacheHit`,
  sorter-timed duration) instead of deriving "algorithm" from the global
  buffer and guessing cache hits from `sortTime < 5`; the monitor-backed
  "avg time / cache hit rate" rows went with it. Absolute datetimes across
  the UI render through one `formatDateTime` (`utils/format.ts`, pinned
  en-US, '—' for missing/unparseable input), replacing six host-locale
  `toLocaleString()` copies in EventTable, Address (seen boundaries,
  approvals scanned-at), Blocks Detail, Contract creation time, and
  Transaction Detail; `formatRelativeTime`'s >30-day fallback is pinned to
  en-US too.

- **2026-11-08 duplication-review fix wave (8 agents, 2 waves + integration)** —
  a full-repo review for duplicate logic / inelegant implementations, then every
  finding fixed. All verified: `tsc` 0 errors, eslint 0 errors (98 pre-existing
  warnings), `vitest --changed` 287 files / 3,703 tests green, `pnpm build`
  green. **Dead code deleted (~2,900 lines)** — the never-imported Dynamic
  event-filter subsystem (`DynamicEventFilterForm` + `DynamicFormGenerator` +
  `form-validation` + `types/forms`), `event-search-optimization.ts`,
  `cache.ts`'s unused instances/stats/timer (only `blockCache` was ever read),
  `validatePaginationParams`, `serialization` dead formatters, `types/events`
  dead error classes, and a stale `examples/` file importing services deleted
  in September. **Scan-family consolidation** — one `utils/scanLadder.ts`
  (constants + provider-ceiling memory), `utils/withTimeout.ts`,
  `utils/ttlLruCache.ts`; fixed a real budget drift: the approvals scan
  counted 2-getLogs steps as 1 call, so its `DEFAULT_MAX_SCAN_CALLS=40`
  ceiling was silently 80 actual RPC calls (now 40, pinned red-on-old).
  **Address validation unified** — canonical `addressVerdict` (two-tier
  shape→EIP-55) in `utils/address.ts` consumed by server validation,
  SearchService, the Address page, and (new) **every MCP tool input**:
  wrong-checksum addresses now fail fast with a caller-ready message instead
  of being silently checksummed; `HEX_ADDRESS_RE`/`isAddressShape` replaced
  ~20 private/inline copies. **Frontend** — one `useCopyFeedback` hook (11
  hand-rolled copy state machines migrated), one `searchDispatch` core (the
  top-bar box and the Search page shared two full dispatch pipelines; history
  recording + ENS resolution now have one home, `<SearchBox/>` extracted from
  TopNavigation), `useLazyExpand` (3 hand-rolled fetch-once-on-expand
  machines), shared verify-panel module, EventTable back on shared
  ErrorState/EmptyState. **Formatting** — `truncateMiddle`/`formatNativeDisplay`/`formatBigInt`
  replace ~15 view-local copies; `formatAddress` (checksum) renamed
  `checksumAddress` so the name has exactly one semantics; `parseHexQuantity`
  and the fetch-timeout probe each reduced to one shared helper; uninstall
  byte sizes use `formatFileSize`. **Backend** — unified retryability
  predicate (429-by-message now retryable in both paths, red-on-old pinned),
  `negativeEntryFresh` fixes NOT_FOUND negative-cache rows with a null
  `fetchedAt` never expiring, shared route pagination/chain+address param
  parsers (4 routes), MCP chain precedence routed through `getChainInfo`.
  Deferred deliberately (pattern-similarity, not copy-paste; see AGENTS.md):
  in-flight-dedup cache ×5 unification, Address view micro-extractions.

- **Help section (`/help`)** — a documentation section in the app, reachable
  from a top-bar **Help** link, the command palette (Ctrl/Cmd+K, "faq"
  keyword) and a Tools-hub card. The index lists eight topics — Troubleshooting,
  Getting started, Navigation & shortcuts, Addresses & transactions, Contracts &
  interacting, Tokens & prices, Storage & raw data, RPC & backend settings —
  each on its own `/help/:topic` page so a single answer is linkable, plus the
  shared reference (keyboard shortcuts, glossary, FAQ) and pointers to the data
  coverage legend and the Tools hub. All copy comes from one React-free model
  (`src/views/Help/helpContent.ts`), so the index and a topic page can never
  disagree. The former standalone `/help/troubleshooting` page was absorbed as
  the troubleshooting topic — same URL, no links broken — and its two
  structured blocks (the verbatim provider-symptom list and the `/api/health`
  field table) became structured fields the topic page renders generically.
  An unknown topic raises the router's `NotFoundError`, so a mistyped help URL
  gets the app's 404 rather than a blank page or a themed dead end. Each topic
  page derives its own tab title and share description from the same model;
  the section fetches nothing, so it works with the backend offline.

- **2026-09-30 full-review implementation wave (14 slices, 4 dispatch waves +
  integration)** — the second review's complete P0–P3 list landed. All verified
  below in this entry's trailing paragraph.
  **Security (P0/P1)** — the `/api/ops/uninstall` pair moved to the STRICT
  admin tier (fails closed without `ADMIN_TOKEN`; the zero-config Docker bind
  `HOST=0.0.0.0` previously left remote data destruction one guessable
  confirm-phrase away, and the unauthenticated preview even handed the phrase
  out; the Ops card now explains the two recovery paths); `hono/body-limit`
  (8 MB) guards every route with the JSON 413 envelope; `estimate-gas` gained
  the rate bucket its read/simulate twins already had; the global proxy
  dispatcher became an `EnvHttpProxyAgent` that bypasses loopback by default
  (`NO_PROXY` honored).
  **Correctness (P1/P2)** — the DuckDB adapter's `DEFAULT→NULL` rewrite is
  now scoped to INSERT statements outside string literals (any query
  containing the word `default` — including `'default'` literals in WHERE
  clauses — was silently corrupted; repro'd before, verified after);
  contract proxy resolution carries a visited-set + depth cap (cyclic
  proxies could hang the backend until stack overflow with per-hop network
  amplification — mutation check: guard off = heap death, guard on = honest
  proxy-level degrade); migration application tolerates the dual-process
  first-boot race (duplicate-class errors verified-then-tolerated); event
  range writes are compare-and-set (`onlyIfIndexing`) and startup
  reconciliation only flips jobs stale >2 min (the vite-bridge + standalone
  dev topology could double-start live ranges); `addIndexingRange` retries
  the range-id race once; solc compilation moved into a worker_thread with a
  60s hard timeout + terminate and an LRU-capped (3) resident-compiler cache
  (a 4 MB Standard-JSON input used to stall the whole backend; pathological
  inputs could hang it forever), and the missing `solc/wrapper` dependency —
  dead since the 09-30 dependency cleanup removed `solc` — was replaced by an
  inlined MIT-attributed wrapper re-derivation proven against the real
  soljson 0.8.37 wasm in both dev and bundled modes; `argFilters` non-scalar
  values and junk `fromBlock`/`toBlock` now answer specific 400s instead of
  silently running unfiltered queries; the events pause route consumes the
  service's CAS refusal (no more canned "completed" body over a live row);
  the SSE watch queue is capped (1000, drop-oldest) and the stats route
  clears its losing timeout timer.
  **Frontend** — the full `viem/chains` barrel (~1000 chain definitions,
  ~1.1 MB eager) is now a lazy post-boot chunk: 25 curated named imports
  serve the shell (eager JS −58.6%, 1,129,438 → 467,205 B), the full
  registry rebuilds in place once loaded (byte-identical ordering pinned),
  rare-chain deep links await it in the unsupported-chain view before
  rendering a verdict, and the backend/MCP boots await it before serving the
  custom-chain 409 gate; the four bare-`localStorage` boot paths
  (apiBase/remembered-chain) are guarded (Safari private mode no longer
  crashes startup outside any ErrorBoundary); the dead
  `document.permissionchange` listener is gone; `qrcode` loads lazily behind
  the QR dialog; the self-destruct's injectable `prune` option is actually
  called (dead assignment surfaced by lint as a real bug).
  **API/docs/tooling** — the OpenAPI spec is complete: 69 paths / 79
  operations (was 54/63 with the whole storage + verify families and the
  contracts extras missing), guarded by a route-vs-spec coverage test proven
  by mutation; API-only routes (blocks/transactions GET families,
  stats/overview, persistent-address, contracts/stats) are deliberately kept
  and annotated; legacy route error bodies unified onto the
  `{error: snake_case, message}` envelope (mixed prose codes like
  `'Invalid offset'` next to `invalid_limit` gone); lifecycle-critical
  modules gained first-ever tests (startupChecks 16-cell posture matrix,
  pure-extracted CLI arg parser, in-process server boot/health/graceful-
  shutdown smoke, mounted debug-route handler); CI/Docker pnpm majors
  aligned (11.22.0 everywhere), `--frozen-lockfile` on all workflows,
  deploy-pages runs lint+typecheck, release runs lint; `build` invokes
  `vite build && tsup` directly (no nested npm); the darwin-arm64 DuckDB
  binding pin removed from dependencies (the api package resolves platform
  bindings itself); Dockerfile comments match code truth (Node 26; the
  native toolchain exists for drizzle-orm's optional better-sqlite3 peer);
  ESLint noise engineered to zero on the console rule (CLI-entry allowlist),
  a localStorage guard rule keeps the guarded-helper convention from
  regressing, and `no-explicit-any` is a hard error in `src/` (the remaining
  six `as any` in the drizzle client were properly typed). Provider getLogs
  span ceilings persist per chain (new `provider_limits` table, migration
  0016) so restarts stop re-paying the provider-probing burst;
  `RpcManager` dedupes concurrent client creation; the scan services clear
  their losing timeout timers.
  **Verification** — every slice landed with targeted green suites (agent
  reports: 58+20 frontend, 18+39 adapter, 38 proxy, 133+160 HTTP, 259
  indexing, 310 scan-services, 13+134 solc, 15 openapi, 495 chains, 53
  lifecycle, 115 events, plus Main's own lint/typecheck/build/browser
  passes); integration re-ran typecheck (clean) and full lint (0 errors).
- **Uninstall from the /ops page** — the CLI's `my-block-explorer uninstall`
  now has an in-server face: the Ops dashboard carries an "Uninstall — erase
  server data" danger zone. `POST /api/ops/uninstall/preview` lists exactly
  what would be deleted (same enumeration as the CLI — one list,
  `src/uninstall.ts`), and `POST /api/ops/uninstall` (body
  `{confirm: "uninstall"}`, typed in the UI) answers `202` then self-destructs:
  close HTTP listener → close per-chain DuckDB handles → close/checkpoint the
  main adapter → delete the enumerated files → exit (exit code reports full
  vs partial removal). Double-arm inside the grace window → `409`. Opt-in
  admin tier like the rest of the dashboard; 4/min·burst 3.
  **Full-project review fix wave (security, correctness, cleanup)** —
  landed the complete P0–P3 review list. Security: the server now binds
  loopback by default (`HOST` unset → `127.0.0.1`; previously it bound all
  interfaces while the startup checks assumed loopback, silencing the
  ADMIN_TOKEN warning and the `ENABLE_DEBUG_API` refusal); the Docker api
  image sets `HOST=0.0.0.0` so the posture evaluates the real bind; graceful
  shutdown now closes keep-alive connections with a 5s force-exit; open-in-ide
  source writes are containment-checked; RPC manager logs carry host only
  (API keys no longer land in logs); the admin token compares sha256 digests
  (length oracle removed); solc downloads without a checksum are refused; the
  dev-server bridge only synthesizes an Origin for loopback requests (Host
  forgery can no longer unlock unredacted RPC URLs). Correctness: event
  indexing no longer silently drops rows on non-duplicate insert errors (the
  range errors and replays); getLogs batches shrink under provider range
  caps; the contract Interact tab uses the full RPC client stack (custom
  chains work); thrown validation errors return the JSON error envelope (the
  frontend previously lost the reason); junk query/body input answers
  specific 400s instead of 500s across storage/events/contracts/blocks;
  webhook notifications dedupe only after confirmed delivery; deep-scan
  findings respect force-replace; startup reconciliation runs before listen;
  the events table is race-safe (stale page responses discarded) and renders
  memoized rows; watch notifications only subscribe while browser
  notification permission is granted. Cleanup: ~6.3k lines of dead code
  removed (unused event-query family, `/api/performance`, legacy RPC config
  store, orphaned schema/performance modules, dead test scaffolding);
  localStorage keys centralized behind one manifest that backup/restore
  consumes. Packaging: `--version` reports the real version; runtime
  dependencies reduced 24 → 11 (frontend stack and build tools moved to
  devDependencies, unused `solc` removed); CI builds the client; the missing
  drizzle 0006 snapshot was reconstructed and the chain re-linked
  (`drizzle-kit check` clean); docs corrected (Node 26+ requirement, complete
  env-var table, accurate admin-gate labels).
- **MCP server** — `my-block-explorer-mcp` (also `pnpm mcp` in the repo)
  exposes the explorer to AI assistants (Claude Desktop, Cursor, VS Code,
  agent harnesses) as a stdio Model Context Protocol server. A separate
  process by design — it never opens DuckDB (single-writer lock): persistent
  data (verified sources/ABIs, indexed events, discovered address
  transactions, search) travels over the backend REST API, live chain data
  (blocks, transactions, balances, storage, view/pure contract calls) via
  its own viem clients with the browser's RPC precedence (stored rpc-config
  → custom chain → viem default). 12 read-only tools, zod-validated inputs,
  bigint-safe decimal-string serialization, and the UI's honesty contracts
  carried verbatim (tx coverage fields, "events cover only configured
  ranges", EIP-7702 classification, backend-down advice). Client config
  snippets + tool table in docs/MCP.md.
- **Toolchain upgrade (TypeScript 6, Node 26 floor)** — dependencies bumped
  across the board, notably TypeScript 5.9 → 6.0 and `@types/node` 25 → 26.
  The Node.js floor rises from 22 to 26 everywhere it's pinned: `engines.node`,
  the zero-config startup version check, the tsup build target, the Docker
  images (`node:26-slim`), and every CI/release workflow. `tsconfig.json` drops
  the `baseUrl` option (deprecated in TypeScript 6 — `paths` resolves relative
  to the tsconfig without it). A stale peer-resolved link in `node_modules`
  (left over from the pre-upgrade install) had silently disabled the
  `@stylistic` lint rules; the relink re-enabled them and the resulting ~600
  mechanical style violations were autofixed in the same change.
- **Storage explorer rebuild (column drill-down)** — the Contract page's Storage
  tab is now a Finder-style column explorer: drilling a struct member, mapping
  key, or array opens a new column to the right (path breadcrumb + base slot in
  every header; close truncates the path). Slot VALUES are read browser-side via
  the chain's RPC client (per-column requests deduped through a
  bounded-concurrency store — no more one backend HTTP call per slot, and values
  work in RPC-only mode). Dynamic arrays read their live length and page through
  ranges (fixed arrays ≥ the span cap paginate too); mapping rows take typed
  keys with inline validation, leaf values resolve inline, composite values open
  columns. Every column header — including the root — copies its slot hex, a
  runnable viem snippet with the symbolic slot derivation, or the `cast storage`
  command, and every member row carries its own viem-snippet copy (no drilling
  needed to grab read code for a leaf). The drill path rides the URL as `?sv=`
  (deep-linkable, junk degrades to root) and stacks vertically at ≤768px.
  evmole-inferred layouts (unverified contracts) are augmented from their type
  labels so strings decode, mappings drill, and arrays paginate the same as
  verified layouts. Copy buttons go through a clipboard helper with a legacy
  `execCommand` fallback, so copies still work where the async Clipboard API is
  unavailable or denied (plain-http LAN access, withheld permission).
- **Broadcast raw transactions** — `/chain/:id/broadcast` page (nav: Broadcast):
  paste a signed raw transaction, get a local pre-flight decode (type, chain ID,
  recovered sender, value, fees, data preview), a hard wrong-chain warning
  naming both chains that disables the button, an amber note for pre-EIP-155
  replayable payloads, then broadcast through the RPC this explorer uses for the
  chain — browser-side only (works in RPC-only mode), nothing stored, RPC
  rejections rendered verbatim. The Pending page links to it.
- **State overrides in Interact (advanced)** — write-function forms accept an
  eth_call state-override map (balance/nonce/code/state/stateDiff per address;
  caps 10 addresses / 32 slots; field-path errors mirrored client and server).
  Applied to the simulated eth_call only — never attached to wallet sends, never
  broadcast, never persisted. The REST `simulate` + `estimate-gas` endpoints
  accept the same optional `stateOverride` body field (invalid →
  `400 {error:'invalid_state_override', details:[…]}`).
- **Blob payloads on transaction pages** — type-3 transaction detail lists the
  blob versioned hashes and links Blobscan for the payloads (external site,
  labeled as such; honest "Not returned by this RPC" when the node omits them).
- **Fixed: literal `undefined` in simulate results** — write-simulation result
  cards rendered `undefined` beside the value whenever the node left the gas
  estimate unset; the field is now omitted.
- **Dev-chain reset lifecycle** — `DELETE /api/chains/:chainId/cached-data`
  (opt-in admin) clears the chain's cached contract sources and storage layouts;
  a per-chain high-water head mark detects ≥5-block chain resets (dev chains
  re-deployed from genesis) and shows a dismissible banner on Home with a
  one-click clear that reports what was actually removed.
- **Command palette & Tools hub** — Ctrl/Cmd+K palette (combobox ARIA,
  keyboard-navigable) jumping to every page, chain, and theme toggle; `/tools`
  hub card grid (15 tools incl. informational cards — no dead links; SQL/Ops
  carry admin chips).
- **Palette trigger spells its shortcut** — the top bar's palette button no
  longer draws a magnifier icon (it read as a second search button beside the
  search box); it shows the actual shortcut as a keycap label — `Ctrl+K`, or
  `⌘K` on Apple platforms — and the accessible name states it in words.
- **Troubleshooting, issue templates & ops diagnostics** —
  `/help/troubleshooting` static guide (backend-banner modes, provider quirks,
  dev-chain resets, health checklist); GitHub issue templates; the Ops dashboard
  gained Copy-diagnostics (all sections verbatim, unavailable ones honestly
  labeled).
- **Block internal transactions** — block detail gains a lazy "Internal
  Transactions (traced)" card (callTracer over the block's txs, concurrency 4,
  cap 50 with truncation disclosure); zero-tx blocks trace nothing; unsupported
  RPCs get an honest card.
- **Address tx method filter** — fifth filter `?tfMethod=` (4-byte selector,
  server-side `method=` param) over the same cached discovered set; rows carry
  an additive `selector` field (null for transfers/creations); selector chips
  resolve via the openchain batch.
- **Gas inclusion estimates** — GasPanel tiers show "~N blocks (est.)" from
  sampled blocks whose paid tip stayed within the tier tip (BigInt-exact; p=0
  renders nothing), with a "never a promise" caveat.
- **Slot / Epoch on block detail** — mainnet-only derivation from the merge
  schedule (timestamp-based, labeled as derived); other chains render nothing.
- **Onboarding education** — GettingStarted restructured into a 3-step walk
  whose final step explains coverage honesty and links the coverage legend; the
  RPC/settings modal footer carries a persistent legend link.
- **OpenAPI** — `GET /api/openapi.json` (open, cached 1h): hand-maintained 3.1
  spec; six endpoints found missing from docs/API.md during the audit were
  documented in the same change. (The spec stood at 54 paths at the time;
  the later 2026-09-30/10-01 wave completed it to 69 paths / 79 operations
  and added a route-vs-spec coverage guard test.)
- **Contributor readiness** — docs/CONTRIBUTING.md + docs/adr/0001–0008 (data
  separation, honesty model, local positioning, DuckDB adapter, frontend stack,
  verification sources, browser capability surface, route-mount discipline).

## 1.3.0 — 2026-09-26

- **Tokens directory** — `/chain/:id/tokens` page: curated known tokens plus
  tokens opened in this browser (localStorage), one Multicall3 enrichment batch,
  DefiLlama prices, Curated/Viewed provenance chips, "not a complete registry"
  caveat.
- **Block prev/next navigation** — block detail pages link to their neighbors
  with honest genesis/head boundaries (disabled with reasons; unknown head stays
  clickable, labeled).
- **Event raw logs** — every indexed event row in the Events table expands to
  its raw log (topics, data hex, log index, emitter) with copy affordances;
  unknown topic0 hashes link to the signature lookup.
- **Signature lookup page** — `/signatures` resolves 4-byte selectors and
  32-byte event topic0 hashes via the openchain-backed cache; `?q=` is shareable
  (name fragments degrade honestly — the registry is exact-hash only).
- **ENS in transaction lists** — verified ENS names replace From/To addresses on
  the first 25 rows of tx list pages; the full checksummed address stays one
  hover away.
- **Address tx advanced filters** —
  `fromAddress`/`toAddress`/`minValue`/`maxValue` (wei) filter the discovered
  transaction set server-side with no new scan; filters ride the URL (`?tfFrom=`
  family) and the response echoes `filtersApplied`; unfiltered responses
  byte-identical.
- **Watch webhooks** — watch subscriptions accept an optional webhook URL
  (Discord embeds detected automatically); per-event POSTs with one retry,
  delivery status recorded on the subscription row (migration 0015).
- **Ops dashboard** — `/ops` page + `GET /api/ops/summary` (opt-in admin):
  storage sizes (main/per-chain/solc cache), indexing + deep-scan status, watch
  subscriptions, rate-limit totals, and backup guidance — every section degrades
  independently.
- **Mempool analysis** — the Pending page summarizes fee caps/tips (BigInt-exact
  quartiles) and flags replaceable same-nonce conflicts with likely winners;
  `?group=1` groups conflicts.
- **NFT items grid** — token pages for NFT contracts show up to 24 items
  discovered from scanned transfers, with per-tile metadata honesty states;
  ERC-1155 amounts are net mint/burn aggregates.
- **Private notes & address QR** — per-chain browser-local notes (280 chars,
  never sent to the server) and a QR modal for addresses; explorer-backup v2
  carries notes (v1 files still importable).
- **OG meta prerender** — `SERVE_STATIC_DIR` lets the Hono server serve the
  built SPA and inject og:title/og:description/twitter:card meta for shareable
  links without JS (static-frontend serving is new; API-only and dev modes
  unchanged).
- **Accessibility & IA** — anchor chip navigation on long address pages;
  DataTable column scopes, optional captions/labels, accessible names on
  icon-only controls.
- **Fixed: admin gate swallowing watch/SSE routes** — a Hono mount-order quirk
  let the SQL console's fail-closed gate intercept every route mounted after it,
  so watch subscriptions, the live block stream and unknown `/api` paths
  answered 403 in zero-config sessions (no `ADMIN_TOKEN` set). Sub-app gates are
  now scoped to their own path prefixes, pinned by a mount-isolation regression
  test.
- **Fixed: QR dialog never opening** — haze-ui's Dialog treats a plain boolean
  `open` prop as an initial value only; the address QR now drives it with a
  react-use-control Control, and the test-suite's Dialog mock is control-aware
  so the value-prop bug class can no longer hide behind mock infidelity.

- **Address deep scan** — persistent, resumable per-address
  transaction-discovery jobs (`POST/GET …/addresses/:a/scan` +
  pause/resume/delete): a forward balance-checkpoint walk (adaptive 50k batches
  halving on provider range errors, binary-searched change blocks) that persists
  findings in DuckDB, checkpoints progress every segment, reconciles interrupted
  jobs at startup, and upgrades address coverage to `complete` **only** for
  genesis-anchored finished walks — the first sanctioned complete path. The
  address page's transactions tab gains the Deep Scan panel (live progress,
  honest ETA, pause/resume).
- **Entity search** — free-text `/api/search` matches curated known-token
  symbols and your address labels (`tokenHits`, ≤5, label-wins dedup; the field
  is dropped, not emptied, on a failed labels read).
- **Approval history** — the approvals response carries the swept raw approval
  events (`history`, newest-first cap 200 + `historyTruncated`), rendered as a
  collapsible timeline; the approvals section also gains the missing inline
  Retry.
- **Token standard filter** — transfer rows carry `logStandard` (the standard
  the log shape alone proves) and the Token Transfers tab gains
  All/ERC-20/721/1155 chips riding `?ttStandard=`. En-route bug fix: 4-topic
  ERC-721 Transfer rows were silently dropped by every scan (missing `value`);
  the token id is now read from the indexed topic.
- **Safe multisig decode** — `execTransaction` calls render a structured card
  (inner call target/value/operation, inner selector resolved, ≈N-signature
  estimate) with selector-based-detection honesty copy; the decoder re-encodes
  round-trip as a guard against viem's lenient tail-truncated bytes decoding.
- **Protocol method labels** — curated Uniswap router family (62 corroborated
  addresses across 8 chains, per-entry source citations + on-chain liveness
  checks; chains without official deployments ship empty) chip the tx-list
  Method column and tx detail.
- **Local data portability** — `GET /api/labels` (opt-in admin) + a
  settings-modal Backup & restore section exporting/importing
  `explorer-backup.json` (labels, custom chains, watchlist/theme/IPFS
  gateway/custom ABIs; localStorage keys pattern-pinned so a hostile file cannot
  write arbitrary keys).
- **Admin SQL console** — `/sql` page + `POST /api/sql/query` /
  `GET /api/sql/tables` over the explorer's own DuckDB: strict fail-closed admin
  tier, single SELECT/WITH statement guard, 22 forbidden word tokens, 500-row
  measured cap, JSON-normalized cells.
- **Cleanup** — vestigial `search_history` table dropped (migration 0012; the
  parallel per-chain `chain-schema.ts` definition removed too); deep-scan tables
  are migration 0013; the `@/utils` barrel now re-exports all util modules (8
  name collisions resolved explicitly).
- **Deep scan catch-up** — `POST …/scan/catchup` extends a settled walk's
  `toBlock` to the current chain head (cursor + findings preserved, no re-walk);
  the Deep Scan panel offers "Catch up to latest" and scopes the complete claim
  to "… up to block N". En-route fix: the panel's job parser only accepted
  `{job}`-wrapped envelopes while every scan route returns the flat DTO — the
  panel was broken against the real backend behind mocked tests.

## 1.2.0 — 2026-09-19

- Honest degradation across offline state, search, ENS, the contract form and
  cache tiers; ENS reverse names roundtrip-verified (spoofed reverse records
  render as no name).
- Reorg reconciliation (unfinalized rows receipt-verified, reorged-out rows
  deleted), chain-scoped search (`?chainId=`), RPC endpoint redaction for
  untrusted origins.
- Token transfers tab on the address page, block finality badges, URL-driven
  pagination for lists and search windows.
- Degraded-mode explorer: parallel localhost port scan, per-browser search
  history, address search window.
- Two-tier admin gate (`requireAdminToken` fail-closed vs.
  `requireAdminTokenIfConfigured`), shared CORS allowlist consumed by both the
  API and the Vite dev server, async range indexing and pending-tx polling.
- Indexing queue removed (one serial job per range); admin auth util;
  search-degradation and cache-invalidation tests.

## 1.1.0 — 2026-09-17

- Admin-token gating for core-workflow writes; async event indexing with
  decoded-argument filters; custom ABI upload and transaction decode.
- Frontend migrated to the painless-template architecture:
  `@native-router/react` (flat typed route table), react-toolroom query layer,
  fetch-fun HTTP chain, Linaria + haze-ui styling.
- Dynamic chain landing, transaction pagination and search fixes; external
  links; event-filter fixes; database schema refactor.

## 1.0.0 — 2026-04-07

- First semantic-release tag. Contract storage-layout viewer, contract-source
  and verify-refresh fixes, `verification_source` tracking, DuckDB WAL recovery
  and graceful shutdown.
- Block-number search; GitHub Pages SPA deploy (base URL, home page, CORS,
  service status); "open in IDE"; CI release pipeline.

## 0.0.0 — 2026-03-22

- Initial npm publish (pre-semantic-release). Multi-chain explorer core: all
  viem chains supported with popular-chain pinning, top navigation with global
  search and chain switching, complete backend service suite with tests,
  DuckDB + Drizzle ORM storage with type-safe schema, contract event indexing
  with ABI-based filtering/sorting/pagination, multi-chain contract
  verification, proxy contract detection and switching UI, client-side contract
  interaction, contract data caching, address data separation (persistent DB
  cache + live RPC reads).
