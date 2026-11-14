# Utilities

RPC data layer, formatting, caching, and error handling utilities.

## STRUCTURE

```
utils/
├── realTimeData.ts        # Frontend RPC client factory (per-chain cache)
├── blockRpcData.ts        # Block/transaction RPC reads
├── format.ts              # Formatting: formatValue/formatGasPrice/formatNumber,
│                          #   truncateMiddle, formatNativeDisplay, formatBigInt,
│                          #   formatAddress/formatHash (middle truncation),
│                          #   formatFileSize — import-free by design
├── address.ts             # HEX_ADDRESS_RE, isAddressShape, addressVerdict
│                          #   (two-tier shape→EIP-55), checksumAddress
├── addressValidity.ts     # checkAddressValidity — page-level two-tier guard
│                          #   (frontend twin of server getValidatedAddress;
│                          #   moved from views/Address 2026-11-11 so util/
│                          #   never imports from views/)
├── paramParsing.ts        # Interact-form composite-arg parsing + overload
│                          #   omission rules + failure classification (moved
│                          #   from views/Contract 2026-11-11; consumed by
│                          #   castCommand/viemScript — utils never imports
│                          #   from views/)
├── multicall.ts           # MULTICALL3_ADDRESS + readMulticallValue/Bigint/
│                          #   Result outcome narrowers (pure)
├── scanParams.ts          # refreshSchema (?refresh=1) + readStrictInt
│                          #   (transfers/approvals shared query params)
├── dbTime.ts              # secondsToDate + toIsoTimestamp (naive-UTC-safe
│                          #   DuckDB datetime parsing — the ONE home)
├── callTraceRpc.ts        # Trace family's browser RPC read: rpcRequest
│                          #   (narrow untyped cast) + fetchCallTraceTree
├── withTimeout.ts         # TimeoutError + withTimeout / withTimeoutOrNull
├── ttlLruCache.ts         # createTtlLruCache (TTL + LRU, injectable clock)
├── scanLadder.ts          # getLogs chunk-ladder constants + provider-ceiling
│                          #   anti-oscillation memory (transfers+approvals)
├── negativeCache.ts       # negativeEntryFresh (null fetchedAt = expired)
├── jsonReplacer.ts        # import-free bigint JSON replacer (mcp + serialization)
├── errorHandler.ts        # withRetry + unified retryability predicate
├── rpcErrorHandler.ts     # analyzeRpcError (shares the retryability predicate)
├── rpcReadRetry.ts        # withOneRetry (browser idempotent reads)
├── providerErrors.ts      # isShrinkableProviderError etc.
├── rpcConfigService.ts    # RPC config management (parseHexQuantity consumer)
├── strictInteger.ts       # parseStrictInteger + parseHexQuantity (import-free leaf)
├── fetchWithTimeout.ts    # AbortController-bounded fetch probe
├── contractInteraction.ts # Contract call utilities (browser-side viem)
├── sorting-optimization.ts# Large dataset sorting with caching
├── serialization.ts       # JSON serialization (BigInt via jsonReplacer)
├── validation.ts          # parsePaginationParams, parseChainAndAddressParams
└── api-error.ts           # API error factory
```

## WHERE TO LOOK

| Task                        | File               | Key Export                                |
| --------------------------- | ------------------ | ----------------------------------------- |
| Create RPC client           | realTimeData.ts    | `createRpcClient()`                       |
| Get address balance/nonce   | realTimeData.ts    | `getRealTimeAddressData()`                |
| Fetch blocks                | blockRpcData.ts    | `getLatestBlocks()`, `getBlockByNumber()` |
| Validate address (2-tier)   | address.ts         | `addressVerdict()`, `isAddressShape()`    |
| Multicall3 batch reads      | multicall.ts       | `readMulticallBigint()`, `MULTICALL3_ADDRESS` |
| Truncate address/hash       | format.ts          | `truncateMiddle()`, `formatAddress()`     |
| Native amount display       | format.ts          | `formatNativeDisplay()`                   |
| Timeout a promise           | withTimeout.ts     | `withTimeout()` / `withTimeoutOrNull()`   |
| TTL cache                   | ttlLruCache.ts     | `createTtlLruCache()`                     |
| Retry logic                 | errorHandler.ts    | `withRetry()`                             |
| Analyze RPC errors          | rpcErrorHandler.ts | `analyzeRpcError()`                       |

## KEY PATTERNS

### Shared scan machinery

TokenTransferService / ApprovalScanService / AddressService consume the SAME
`scanLadder` constants, `withTimeout`, and `ttlLruCache` — never re-grow local
copies (the 2026-11-08 review found the budget semantics had drifted between
copies; `DEFAULT_MAX_SCAN_CALLS` counts ACTUAL getLogs dispatched).

### Canonical address semantics

- `utils/format.ts formatAddress` = middle truncation (display).
- `utils/address.ts checksumAddress` = EIP-55 checksumming (was `formatAddress`;
  renamed because one name with two meanings leaked through the barrel).
- `addressVerdict` = the two-tier verdict (shape → mixed-case checksum) used by
  server validation (throw), SearchService (null), the Address page ({tier}),
  and every MCP tool input.

### Retry Decorator

```typescript
export const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T>
```

## IMPORTS (no barrel)

The former `index.ts` barrel was deleted 2026-11-14 (zero product
importers; only its own contract test consumed it). Deep imports
(`@/utils/<module>`) are the ONLY way to consume utils — do not recreate
a barrel or any other aggregation re-export here. Historical lesson: a
star-export once dragged the browser-RPC graph (`realTimeData` →
`@/util/http`, an alias the vite.config esbuild bundle cannot resolve)
into backend consumers and broke `pnpm build` at config load.

The old barrel's exclusion boundary survives as a convention: modules
whose import graph reaches the browser RPC layer — `realTimeData`,
`rpcConfigService`, `contractInteraction`, `callTraceRpc` — and
`serialization.ts` (pino logger) must never be re-exported through any
future aggregation point; browser code deep-imports serialization.
`addressValidity.ts` and `paramParsing.ts` (both moved here from views/
2026-11-11) are deep-import-only as well.

```typescript
import { formatBigInt } from '@/utils/format'; // the only import shape
```

## NOTES

- `formatAddress` resolves to exactly ONE semantics repo-wide (format.ts
  truncation); the checksum twin is `checksumAddress` in address.ts.
- Dead-file discipline: `event-search-optimization.ts`, `form-validation.ts`
  and the Dynamic form components were deleted 2026-11-08 (zero importers).
