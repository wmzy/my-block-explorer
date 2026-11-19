# Changelog

Versions are published by
[semantic-release](https://semantic-release.gitbook.io/) from conventional
commit messages — the git tags and npm dist-tags are authoritative. This file is
maintained by hand: entries for 0.0.0–1.2.0 were reconstructed after the fact
from `git log` and the npm publish timestamps, so individual lines summarize
commit subjects rather than a curated release notes process.

## Unreleased

- **2026-11-19 duplication review fix wave round 18 (4 read-only scouts +
  Main-sequenced fixes)** — 10 findings adjudicated (8 fixed, 2 rejected on
  re-verification); the surface stays converged (all four scopes reported
  near-clean; no P0 real bugs). **Canonicals** — `getNativeDecimals` in
  config/chains.ts (the `?.nativeCurrency.decimals ?? 18` lookup idiom had
  9 hand-rolled sites across views + realTimeData); `readOptionalJsonBody`
  in utils/api-error.ts (the lenient empty-body-is-valid `c.req.json()`
  try/catch, 3 sites: events range-start ABI hint, address-scan default
  bounds, watch no-label upsert — distinct from `readJsonBody`'s 400 path).
  **fetchJson now delegates to fetchWithTimeout** (the byte-equal
  AbortController+setTimeout copy is gone; utils/AGENTS.md's
  "fetchWithTimeout + !ok-throw + .json()" description is finally true —
  budget covers through response headers per fetchWithTimeout's contract).
  **Type-drift traps closed** — `StorageLayoutResponse` (services/contracts)
  is now `Omit<StorageLayoutResponse, 'error'>` off the shared types/storage
  envelope (the 200 body never carries `error`; found:false is a 404), and
  `buildBlockValues` carries the `typeof blocks.$inferInsert` return
  annotation (round-17 rule; the comment claimed the typing but there was
  none). **Dead exports de-exported** — `specJson` (routes/openapi),
  `MAX_RESULT_ROWS`/`normalizeSqlCell` (routes/sql), `jsonText` (mcp/tools);
  all importer-audited to zero external consumers. **Rejected on
  re-verification** — "normalizeError is dead" was wrong (used internally ×2
  by createRetryableRpcCall/logError); the ECONNRESET/ENOTFOUND/ETIMEDOUT
  triple ×2 in errorHandler.ts stays (same-file pair, the round-14/15
  no-payoff class). **Test-mock fallout pinned**: the getNativeDecimals
  migration re-exposed the round-8 rule — factory mocks of `@/config/chains`
  must model every export the view imports; 13 suites updated (6 failing +
  7 latent). En-route incident: a fuzzy `edit` old_string with an assumed
  (nonexistent) context tail silently rewrote `vi.mock('@/services/addressRealTime'`
  into a duplicate prices mock in tokenPageNftItems.test.tsx — always build
  edit anchors from the just-read verbatim lines, and audit multi-file test
  edits with `git diff HEAD` (one intended line per file). All verified:
  tsc 0, eslint 0 errors, `vitest --changed --maxWorkers=4` 252 files /
  3295 tests green, `pnpm build` green.

- **2026-11-18 duplication review fix wave round 17 (4 read-only scouts +
  Main-sequenced fixes)** — 16 findings adjudicated (9 fixed, 7
  skipped/documented); the residual surface keeps shrinking (services and
  routes scopes reported near-clean; the real finds came from Main's own
  cross-cutting sweeps). **Real bug: TransactionService timestamp column
  writes** — `buildTransactionValues` handed the `timestamp` column an
  ISO STRING while the column's customType contract is seconds NUMBERS
  (`toDriver` multiplies by 1000 — `'<iso>' * 1000` is NaN, so every
  insert with a resolvable block timestamp threw inside drizzle and was
  swallowed upstream: block tx caching never landed, tx-by-hash fell
  back to the in-memory path on every read). Compounding falsy-zero:
  `receipt?.blockNumber ? …` skipped the lookup entirely for genesis
  receipts (0n). Fixed to seconds + `!= null` presence, the builder is
  now typed `Promise<typeof transactions.$inferInsert>` (BlockService
  round-16 contract) and both `any`s + eslint-disables are gone;
  regression-pinned in `tests/unit/falsyZeroWritePath.test.ts` (red on
  pre-fix code, both failure modes). **MCP receipt honesty** —
  `getTransactionWithReceipt`'s `.catch(() => null)` laundered transport
  failures into "no receipt" for transactions already known to be mined;
  only viem's `TransactionReceiptNotFoundError` maps to null now,
  everything else rethrows. **Dead** — `hasRpcPresets`
  (config/rpcPresets, zero importers). **Canonicals** —
  `formatDecimalString` in utils/format.ts (the gas-string formatter
  generalized; `formatGasString` stays as its gas-domain name, Address's
  hand-rolled `formatBlockNumber` twin deleted);
  `chartSkeletonShape` in components/ui/skeleton (Charts/Token
  chart-placeholder css pair folded, heights stay site-local);
  `explorerLinks` private helper in config/externalTools (the three
  explorer+Routescan builders). **Routes** — debug.ts uses
  `readJsonBody` hoisted above its try (malformed SQL bodies answer the
  repo-wide 400 `invalid_json`, was an opaque 500 `query_failed`) +
  `respondError`; two live-RPC endpoints gained the rate buckets their
  siblings always had (`storage-read` 60/min·20 on
  `GET .../storage/:slot`, `rpc-config-write` 5/min·2 on
  `POST /api/rpc-configs`) — both verified live (ops stats: 80 rejected
  at exactly burst capacity; 429 by the 3rd write). **Documented, not
  unified** — SearchService↔contractDirectory `CachedContractSummary`/
  `LocalContractHit` are a wire-mirror pair (backend produces, frontend
  consumes; cross-referenced comments now mark both, the
  TokenTransferStandard convention); watchlist's inline two-tier check
  stays (its rejection needs `validity.tier`, which the
  checksum-or-reject canonical collapses — comment added);
  storage-route slot parsing stays deliberately stricter than
  `parseSlotNumber`.

- **2026-11-18 duplication review fix wave round 16 (4 read-only scouts +
  Main-sequenced fixes)** — 7 findings adjudicated (6 fixed, 1 deferred);
  the tiers are converging: Views/Shared/backend-routing scopes reported
  "surface clean". **Type-honesty closure in BlockService** —
  `buildBlockValues` now returns the schema's insert shape (bigint for
  bignum columns — their `toDriver` stringifies — `0x${string}` for hex,
  presence tests instead of truthiness), deleting the file's two
  `values as any` + eslint-disables (the last `as any` in src/services);
  `formatBlock` gained `toBigintOrUndefined` so the synthesized RPC path
  and the fromDriver DB path share one mapper, closing the latent
  bigint-0n truthiness drop on gasLimit/gasUsed/baseFeePerGas and making
  difficulty/totalDifficulty actually match their declared `string`
  type. **Falsy-zero class** — `getTransactionByHash`
  (utils/blockRpcData) skipped block-timestamp enrichment for genesis
  transactions (`blockNumber 0n` is falsy); now a `!= null` presence
  test. **Dead weight** — `duckdbIndex` re-export (zero importers),
  OpsService's `parseMainDbPath` move-shim (its one consumer, the ops
  test, now imports the `dbPath` leaf directly), and the whole
  `src/database/README.md` (428 lines documenting a design that no
  longer exists: phantom `duckdbBigint`/`duckdbTimestamp` constructors,
  "bignum = VARCHAR(32)", "reads come back as strings"; db-types.ts +
  database/AGENTS.md are the living truth — the AGENTS KEY TYPES bignum
  line was corrected to BIGNUM/bigint in the same change). **Doc-truth**
  — the adapter constructor's mkdir rationale no longer cites the
  per-chain event stores removed in the 2026-11-09 wave. Deferred:
  BalanceHistory's chart-path construction partially re-rolls the
  geometry builder (~10 lines, gap-splitting genuinely diverged — the
  Address-view micro-extraction family). All verified: tsc 0 errors,
  eslint 0 errors on touched files, `vitest --changed --maxWorkers=4`
  141 files / 1588 tests green, `pnpm build` green.

- **2026-11-17 duplication review fix wave round 14 (4 read-only scouts +
  Main-sequenced fixes)** — 9 findings adjudicated (6 fixed, 1 rejected on
  round-8 precedent, 2 keep-deliberate). **Dedup** — the byte-equal
  `METHOD_UNSUPPORTED_PATTERN` regex + failure-classify twins in
  chartStats/gasHistory collapsed into canonical
  `isMethodUnsupportedText`/`isMethodUnsupportedMessage` predicates in
  `utils/errorHandler.ts` (errorMessage/flattenErrorMessage's existing
  home; both callers already imported from it). **Dead code** —
  blockRpcData's `normalizeTransactionType` re-export (stale "for the
  barrel" comment; the utils barrel was deleted rounds ago), viemScript's
  zero-importer `CastableFunction` type re-export, and three dead
  `export default` lines (SegmentedProgressBar, TxStatusBadge, UnitToggle
  — default exports escape named-symbol scans). **Naming** — the legacy
  thin `AddressInfo` in `types/blockchain.ts` renamed
  `SearchAddressResult`: `services/AddressService.ts` owns a different,
  richer `AddressInfo`, and the shared name was a drift trap for anyone
  "unifying" them (only the Search view consumed the thin shape).
  **Routes** — the opt-in debug SQL endpoint's envelope moved to the
  project convention (snake_case `invalid_query`/`query_failed` codes via
  `createApiError`, 500 message through `errorMessage` — replacing a
  one-element `causeChain` vestige); test pins updated in the same
  change. **Docs** — AGENTS.md truth fixes: the debug API is behind the
  opt-in admin tier scoped `/debug/db/*` (was documented "carries no gate
  at all"), overview now says Node 26 (engines require `>=26`), and the
  `build:client` `_redirects` claim (no such generation exists) is gone.
  Rejected: unifying the `truncatedAddress` `…` glyph with `cellText`'s
  `...` (round-8 glyph-breaking-merge precedent — visible change, needs
  an explicit mandate). All verified: tsc 0 errors, eslint 0 errors (111
  warnings, baseline), `vitest --changed --maxWorkers=4` green,
  `pnpm build` green.

- **2026-11-16/17 duplication review fix wave round 13 (4 read-only scouts +
  Main-sequenced fixes)** — 18 findings adjudicated (12 fixed, 2 deferred to
  the standing list, 4 rejected on re-verification); one scout claim was
  overturned at adjudication (the "button chrome twins fit ui/Button"
  finding — `variantMap` maps `secondary` to haze's OUTLINE, so RpcConfig's
  filled-gray secondary has no canonical equivalent; migration is visual
  churn, same class as the deferred card-recipe family). All verified: tsc
  0 errors, eslint 0 errors (111 warnings, baseline), `vitest --changed
  --maxWorkers=4` 187 files / 2486 tests green, `pnpm build` green, curl
  smoke on the built server. **Backend** — `fetchFromBlockscan` was the
  only source fetch with NO timeout (now `fetchWithTimeout(url, {}, 8000)`
  like its Sourcify/Routescan siblings); the Sourcify↔Blockscan
  `sources`→`sourceCode`/`sourceFiles` building blocks were duplicated with
  a behavioral divergence (single file: Sourcify served bare content,
  Blockscan wrapped it in a `// File:` header) — one `buildSourceBundle`
  helper pins the single-file-bare convention for BOTH upstreams;
  `_detectProxyImpl` re-implemented `utils/proxyDetection` wholesale
  (EIP-1967 impl/beacon slot literals, `slice(-40)` decoding, an 1167
  prefix/suffix match, plus a dead "Check UUPS" comment with no code) — it
  now takes `EIP1967_*_SLOT` + `slotValueToAddress` + `decodeMinimalProxy`
  from the canonical (malformed/zero slots the raw slice never checked are
  now rejected; the 1167 branch uses the canonical EXACT runtime match, so
  clone-with-args variants are an honest miss on both sides; detected
  addresses are EIP-55 checksummed like the beacon branch always was);
  routes/watch.ts's hand-rolled webhook URL validator → `parseHttpUrl`
  (512-char cap stays route-local); routes/storage.ts slot params accept
  strict shapes only (hex regex `+` not `*` — bare `0x` used to reach the
  RPC layer; decimal via `parseDecimalBigInt` — raw `BigInt()` accepted
  `+7`/whitespace/`0X10`/`0b101`). **Frontend** — new canonical
  `ownResult(data, args)` in util/useQuery.ts for the cross-args settle
  guard (`data?.chainId === chainId ? data : undefined` hand-rolled in 8
  view sites; the contracts directory's normalized 3-key comparison stays
  bespoke, documented); views/Address/index.tsx's hand-rolled multicall
  bigint narrower → `readMulticallBigint` (the fifth copy that escaped the
  2026-11-10 wave); EventTable's local `formatValue` renamed `formatEthCell`
  (same-name-different-semantics trap vs utils/format's 4-decimal
  canonical); IndexingRangeManager adopts the shared `LoadingState`
  primitive (StoragePanel round-8 precedent) and drops its identity
  `formatBlock` wrapper; ConnectionStatus's health probe routes through
  `fetchWithTimeout` (was the only `AbortSignal.timeout` user);
  bannerStyles drops dead light-only hex fallbacks (the round-8 dark-mode
  hazard class — the tokens exist and every other consumer omits
  fallbacks). **Deferred**: searchHistory↔sqlConsole tolerant-read history
  modules (2 members, different row shapes); checkpointed-range interval
  derivation shared between EventStatistics/IndexingRangeManager (~10-line
  payoff). **Rejected besides the button claim**: host-for-log twin pair
  (cross-referenced 6-line leaves), truncatedAddress `…`-vs-`...` glyph
  unification (round-8 adjudicated deliberate), CompileVerifyPanel
  hex-truncation (byte context differs), BlockService `formatBlock`'s
  `|| 0` (number is the PK conflict target — always present; theoretical).

- **2026-11-16 duplication review fix wave round 12 (4 read-only scouts +
  Main-sequenced fixes)** — 11 findings adjudicated (8 fixed, 3 no-payoff
  skipped); the surface is near-exhausted: every round-6–11 canonical is
  fully adopted (scouts verified importer counts in both directions).
  All verified: tsc 0 errors, eslint 0 errors, `vitest --changed
  --maxWorkers=4` green, `pnpm build` green. **Docs-truth (P2)** —
  `db:migrate`/`db:push`/`db:studio` were documented in 5 places but
  NEVER worked: drizzle.config.ts's `connectionString` line had been
  swallowed by a comment (and the file carried Chinese comments, violating
  the project standard); Drizzle Kit cannot connect to DuckDB and the
  official migrator would write journal rows the boot-time runner can't
  match. The three scripts are deleted from package.json (only
  `db:generate` — snapshot diffing, no connection — survives) and
  README/INSTALLATION/CONTRIBUTING/CLAUDE/AGENTS now state the truth:
  migrations apply at server boot; inspect via the /sql console or DuckDB
  CLI. INSTALLATION's stale per-chain-DB "Data management" section is
  rewritten for the single-main-DB reality. **Consistency** — events.ts's
  three range-write handlers (POST ranges, POST quick, PATCH :rangeId)
  parsed bodies inline inside their 500-catch: malformed JSON answered
  `500 internal_error` (+ a false alarm log) while every other JSON write
  route answered `400 invalid_json`; all three now hoist `readJsonBody`
  above the try (contracts.ts pattern), regression-pinned in
  eventsRoutesErrorBodies. The pass-through wire shapes the old `any`
  implied are written down (`RangeWriteBody`/`QuickRangeBody`); the
  blockCount guard-proven narrowing uses one documented `!`. **New
  canonicals** — `views/chainNav.ts useChainlessNav()` (the chain-less
  nav shell ×6: Ops/Sql/Tools/Signatures/Help/HelpPage — Search keeps its
  bespoke handler, it re-runs the query on chain switch); `clampWindowBlocks`
  in utils/scanLadder (byte-equal window clamp ×2,
  TokenTransfer/ApprovalScan); `views/Help/helpStyles.ts`
  (sectionCard/proseParagraph/proseLink twins ×2). **Dead weight** —
  eslint.config.mjs's duplicate `no-non-null-assertion` key ('error' then
  'off' — last-wins made 'off' effective; kept 'off' with a rationale
  comment); uninstall.ts's zero-importer `DEFAULT_PROBE_PORTS` re-export;
  Ops.tsx's `opsAdminGateFromError` alias (test migrated to import
  `util/adminGate` directly — ScoutShared's "zero importers" claim was
  WRONG, the test file imported it: re-verification before dispatch
  caught it); `formatSelectorForDisplay` (a `?? ''` wrapper with one call
  site + own test describe — inlined); mcp/abi.ts's local copy of
  `ARRAY_SUFFIX_PATTERN` → imports paramParsing's canonical. **Scout
  claims re-verified before dispatch (round-7 rule)**: 1 of 4 scouts'
  zero-importer claims was wrong; 1 P2's "byte-equal css" needed manual
  care (a fuzzy edit initially merged two distinct HelpPage styles —
  whereStyle restored). Deferred (standing list unchanged).

- **2026-11-16 duplication review fix wave round 11 (4 read-only scouts +
  2 fix agents + integration)** — the leanest round yet: 10 findings
  adjudicated (7 fixed, 1 rejected on re-verification, 2 deliberate).
  All verified: tsc 0 errors, eslint 0 errors (2 new warnings, the
  pre-existing react-refresh class on the new shared module), focused +
  `vitest --changed --maxWorkers=4` green, `pnpm build` green, browser
  smoke on the three migrated lazy cards. **New canonical**:
  `components/ui/LazyCollapsibleHeader.tsx` — the lazily-fetched cards'
  clickable header (role=button/keyboard/chevron) was byte-copied across
  CallTrace, block InternalTxnsSection, and RawJson (each with a "why not
  Collapsible" comment); one shared component + exported
  `lazyHeaderTitleRowStyle`/`lazyHeaderMetaStyle` now serves all three,
  DOM byte-identical (data-testid/aria/svg preserved). **Dedup** —
  ConnectionStatus's hand-rolled mousedown-outside effect → the canonical
  `util/useClickOutside`; AddressService.getAddressTransactions's two
  byte-equivalent served-page tails (cached/fresh) → one local
  `shapeServedPage` closure (merge findings → coverage honesty floor →
  filter → slice), all three semantics comments preserved. **Dead code
  deleted**: `runningScanJobCount` (AddressScanService, zero importers),
  `components/events/index.ts` barrel (zero importers; EventsPanel
  deep-imports), ConnectionStatus's never-applied `className` prop.
  **Docs truth**: stale `parseStrictInteger` route enumeration in
  utils/validation.ts replaced with a non-brittle description;
  utils/AGENTS.md format.ts "import-free" claim corrected to "free of
  PROJECT imports" (it uses viem formatters); specs/001-abi/quickstart.md
  gained a historical-document banner (its dynamic-filter examples
  referenced the subsystem deleted 2026-11-08). **Rejected on Main
  re-verification**: scout claim that `contract_sources
  .constructorArguments` is write-only-empty was wrong —
  ContractSourceService writes REAL constructor args from external
  payloads (Sourcify/Blockscan path) and the frontend type consumes
  them; column stays. **Deliberate**: per-test-file `BlockHookResult`
  partial shapes stay (scenario-specific known-answer fixtures; full
  ReturnType typing would force mocks all-field).

- **2026-11-15 duplication review fix wave round 10 (4 read-only scouts +
  8 concurrent fix agents + integration)** — round 10; 20 findings from a
  four-scout review, all fixed. All verified: tsc 0 errors, eslint 0 errors
  (110 warnings, pre-existing classes), `vitest --changed --maxWorkers=4`
  287 files / 3765 tests green, `pnpm build` green, three-boot live smoke
  on a throwaway DuckDB + curl boundary probes + browser pass (Home / /ops
  / /sql with the fail-closed admin faces). **Critical en-route fix —
  migration re-apply loop (pre-existing since migration 0017)**: the
  adapter re-verified RECORDED migrations by checking their tables still
  existed; 0017 legitimately drops four old tables, so every boot after it
  applied re-ran the old chain (recreating dropped tables, duplicating
  journal ids, hard-failing on `ALTER ... ADD COLUMN already exists` and
  aborting mid-boot). This — not concurrent writers alone — was the
  recurring "trashed journal" incident of the 2026-11-13/14 waves. A
  recorded+hash-matching migration now skips unconditionally, and the
  resume tolerance covers verified duplicate CREATE TABLE and ADD COLUMN;
  regression-pinned (red on the old adapter) and live three-boot proven.
  **Dead code deleted**: RpcErrorAlert.tsx (zero importers), three dead
  RpcManager methods, CardFooter, TokenOverviewCardLink, types/rpc.ts,
  five dead schema columns (migration 0018: contract_sources
  library/licenseType/swarmSource, indexed_addresses
  lastActivity/transactionCount). **New canonicals**: util/adminGate.ts
  (Ops↔Sql 403/429 twins), utils/fetchJson.ts (one leaf for JSON GETs),
  utils/interruptedRow.ts (shared restart-reconciliation const+message),
  strictInteger.parseQuantity (traceFormat↔txpool verbatim copy),
  scanParams.windowParam (ONE strict `?window=` reader — closes the
  transfers z.coerce hole that accepted `1e5`/`+7`), util/units GWEI
  constants (had 4 homes), ENS_RESOLUTION_CHAIN_ID shared by both ENS
  modules, methodColumn.truncatedAddress,
  api-app API_ENDPOINT_DIRECTORY (the `/api` index advertised three
  endpoints that never existed; banner/notFound//api now quote one const).
  **Behavior deltas (intentional)**: watch label cap 100→64 (canonical
  labelContract; live 65→400 / 64→200 verified), `?window=` junk degrades
  to the tiered default on addresses/transfers, gasShare rejects
  0x/+sign/whitespace forms, CallTrace gas share renders '—' instead of
  'Infinity%' on non-finite ratios, StoragePanel uses the LoadingState
  primitive, `/api` endpoints is an array of real path templates
  (integration test maps each onto a mounted route). **Inelegance fixed**:
  sorting-optimization.ts collapsed 455→136 lines (heap machinery + a
  self-defeating O(n)-per-sort cache key deleted; perf panel now renders
  rowCount/sortKeys/durationMs), parseDecimalInteger alias-shim family
  dissolved into parseDecimalBigInt, startupChecks stale endpoint
  enumeration replaced with the generic tier description, stale
  cors-origins mirror comment corrected.

- **2026-11-14 duplication review fix wave round 9 (4 read-only scouts +
  4 concurrent fix agents + integration)** — round 9; 21 findings
  adjudicated (16 fixed, 5 deferred), net −22 lines / 45 files (the line
  count is dominated by helper extraction replacing inline copies). All
  verified: tsc 0 errors, eslint 0 errors (112 warnings, pre-existing
  classes), `vitest --changed --maxWorkers=4` 3551 tests green,
  `pnpm build` green. **Test-isolation fix (incident-driven)** — a third
  consecutive wave found `data/blockchain.db` journal-trashed
  (non-contiguous migration ids, cause-less Failed query on every read)
  after `vitest --changed --maxWorkers=4`: suites that transitively
  import the database graph without mocking '@/database/*' (the composed
  route-table/gate-isolation tests) instantiate the real adapter on the
  DEV database at import time, and parallel workers are concurrent
  DuckDB writers. tests/setup.ts now defaults DATABASE_URL (only when
  unset) to a per-worker temp file `be-vitest-<pid>.db` — explicit
  stubs and CI values win, mocked suites unaffected, dev DB never
  touched by tests again (recovery per the documented recipe: db set
  aside, fresh migrate, labels reseed). Live smoke on the built server
  after recovery: /functions on WETH via the consolidated
  resolveTargetAbi, shared-validator 400, events ranges list, and
  range_not_found 404 through the merged start/resume core.
  **Dead code deleted** — the `DatabaseManager` re-export in
  database/init.ts (AGENTS.md had claimed the 2026-11-09 wave removed it —
  doc and code disagreed); `types/rpc.ts` `RpcConfig`/`RpcStatus`
  (shape-diverged from the live rpcConfigService RpcConfig; only
  RpcErrorInfo had an importer); `getChainExplorerUrl` (config/chains);
  `UserRpcConfig.rpcBackups`/`.rateLimit` (write-only-undefined / never
  read); `views/Contract/styles.ts` `linkStyle` (every consumer imports
  DataTable's mono variant). **Route consolidations** —
  contracts.ts read/simulate/estimate-gas carried three ~30-line
  near-identical blocks plus a fourth proxy-resolution partial →
  `resolveTargetAbi` + `validateInteractionBody` (wire byte-identical);
  events.ts start/resume were ~80-line structural clones →
  `START_RESUME_KINDS` table + `startOrResumeIndexing(c, kind)` core +
  `resolveRangeParams` prologue shared by all five :rangeId routes;
  stats 503 and rate-limit 429 moved onto the canonical createApiError
  envelope (additive statusCode/timestamp; retryAfterSeconds kept);
  sql.ts 500 code `'Schema Listing Failed'` → `schema_listing_failed`;
  debug.ts's `app.use('*')` gate scoped to `/db/*` per the mount-hoisting
  invariant (unknown /debug/* now 404, not 403, under ADMIN_TOKEN).
  **Canonical modules born** — paramParsing exports
  `parseFormArgsForBuild` + the int/array type patterns (castCommand +
  viemScript deleted their verbatim ~30-line shared preambles and regex
  twins); `strictInteger.parseDecimalBigInt` (chainParam, validation's
  parseChainAndAddressParams, holdings, Blocks/Detail, and via re-export
  nftHoldings all delegate — five hand-rolled decimal walks gone, and
  holdings.ts exports the family's `compareTokenIds` so nftHoldings's
  twin died too); adapter exports `isUniqueViolation` (the 23505 core
  EventIndexingService's local `isDuplicateRowError` duplicated);
  `isValidAddress` has one definition (utils/address; validation
  re-exports); `getEffectiveRpcUrl` actually used by its two natural
  callers (RpcManager, WatchService); `src/config/discovery.ts` +
  `src/config/uninstallConfirm.ts` (import-free leaves killing the
  discovery-port and confirm-phrase twins; opsSummary is
  browser-imported, so the phrase could not live in selfDestruct);
  `components/ui/listToolbar.ts` (Contracts/Tokens toolbar quartet,
  byte-identical), `components/ui/RefreshButton.tsx` (5 list views),
  `components/ui/wrongRouteCopy.ts` (`NO_ON_CHAIN_CODE_CAVEAT`, the
  verbatim Contract/Token string); `internalTxnsShared` gains
  `RetryRow` + `TRUNCATED_LIST_NOTE`; Contract/styles noticeBox trio
  composes `cx(badgeX, noticeShape)`. **Logging** — AddressService's
  emoji `console.log` traces and TransactionService's console.warn/error
  migrated to their existing pino `createLogger` loggers; AddressService
  dropped off eslint's no-console allowlist. **db barrel unified** —
  server.ts, AddressScanService, EventIndexingService, EventExportService,
  selfDestruct, providerCeilings all import `db` from database/init
  (drizzle.ts stays the adapter+schema owner; vitest mocks key by
  resolved module id, so the init re-export flows the drizzle mocks).
  **Conventions pinned**: (1) a shared route-helper must take the raw
  strings, not `c: Context` — the generic annotation widens
  `c.req.param()` to `string | undefined` and breaks compilation at
  every call site the route-typed inference used to cover (map the
  impossible case to the same 400 instead); (2) scout structural-claim
  verification pays for itself — the "three wrong-route verdict cards
  share one skeleton" finding was one-third wrong on inspection
  (Address's card is the checksum-guidance shape), so only the verbatim
  string consolidated; (3) opsSummary.ts is browser-imported (views/Ops)
  — constants shared with server-only modules must live in an
  import-free leaf, not in either importer. **Deferred (unchanged
  list)**: in-flight-dedup Maps, scan ladders, Address-view
  micro-extractions, card-recipe css family, mono-right-row family,
  SearchService result-scaffolding, errorHandler console (browser-graph
  safety).

- **2026-11-14 duplication review fix wave round 8 (4 read-only scouts +
  6 concurrent fix agents + integration)** — the round-8 review's 27
  findings adjudicated (16 fixed, 6 newly deferred, 5 verified
  deliberate); net −336 lines / 57 files. All verified: tsc 0 errors,
  eslint 0 errors, `vitest --changed --maxWorkers=4` 298 files / 3861
  tests green after integration seam fixes, `pnpm build` green, dark-theme
  browser smoke on the built bundle (DeepScan panel and SourceCodeViewer
  now follow the theme; zero hardcoded light hexes on the contract page).
  **Canonical migrations** — the count(*) idiom is gone (14 total-count
  sites → drizzle `count()` + `sqlCountTotal`; real-DuckDB integration
  test pins numeric totals); `parseHttpUrl` (one URL validator for the
  chains/rpc-config routes); `parseHttpErrorBody` exported from util/http
  (addressScan's copy deleted); verify.ts's three hand-rolled JSON parses
  → readJsonBody (malformed JSON now `invalid_json`); `runBoundedPool`
  gained `onSettled` and runTracePool is a one-line delegate;
  `flattenErrorMessage` (errorHandler) + `errorChainText` (traceFormat)
  collapse five duplicated error-walk implementations; `traceOneTxOutcome`
  shared skeleton (Address/Blocks internal-tx twins); `shortTokenId`,
  `formatGweiLabel`, `formatValueAmount` (format.ts) with corpus-proven
  byte-equality; formatNumber's bigint branch no longer loses precision
  past 2^53; three isRecord re-declarations deleted; RpcError type
  renamed `RpcErrorInfo`; approval ScanLog fixture builders converged.
  **Real bugs fixed** — DeepScan used nonexistent haze tokens
  (`--haze-border`/`--haze-surface`) so dark theme rendered it as the
  only hardcoded-light panel; SourceCodeViewer's bootstrap hex palette
  tokenized (was unreadable in dark mode); SetupRequiredScreen's copy
  button had been invisible since landing (hover-reveal selector on a
  linaria-hashed class name → opacity 0 forever) — now an always-visible
  CopyButton. **Dead code deleted** — `src/server/create-server.ts`, the
  whole utils barrel (`src/utils/index.ts` + its test; product importers
  were zero — deep imports are now the only convention), the orphaned
  tests/mocks/rpcManager.mock.ts helper.
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
