# Utilities

RPC data layer, formatting, caching, and error handling utilities.

## STRUCTURE

```
utils/
├── realTimeData.ts        # Frontend RPC client factory (per-chain cache)
├── blockRpcData.ts        # Block/transaction RPC reads
├── format.ts              # Formatting: formatEth/formatGasPrice/formatNumber,
│                          #   truncateMiddle, formatNativeDisplay, formatBigInt,
│                          #   formatAddress/formatHash (middle truncation),
│                          #   formatFileSize — import-free by design
├── address.ts             # HEX_ADDRESS_RE, isAddressShape, addressVerdict
│                          #   (two-tier shape→EIP-55), checksumAddress
├── cache.ts               # LRU machinery + blockCache (its only instance)
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
├── api-error.ts           # API error factory
└── index.ts               # Barrel export
```

## WHERE TO LOOK

| Task                        | File               | Key Export                                |
| --------------------------- | ------------------ | ----------------------------------------- |
| Create RPC client           | realTimeData.ts    | `createRpcClient()`                       |
| Get address balance/nonce   | realTimeData.ts    | `getRealTimeAddressData()`                |
| Fetch blocks                | blockRpcData.ts    | `getLatestBlocks()`, `getBlockByNumber()` |
| Get cached block data       | cache.ts           | `blockCache`                              |
| Validate address (2-tier)   | address.ts         | `addressVerdict()`, `isAddressShape()`    |
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

## BARREL

`index.ts` re-exports all util modules (2 cross-module name collisions are
resolved with explicit re-exports that take precedence over ambiguous star
exports: `isValidAddress`/`sanitizeInput` → `validation`). Deep imports remain
canonical for call sites — the barrel is convenience surface, and
`serialization.ts` pulls the pino logger through it (browser code should keep
deep imports there).

```typescript
// Both work; deep imports are still the norm in call sites
import { createRpcClient } from '@/utils';
import { createRpcClient } from '@/utils/realTimeData';
```

## NOTES

- `formatAddress` resolves to exactly ONE semantics repo-wide (format.ts
  truncation); the checksum twin is `checksumAddress` in address.ts.
- Dead-file discipline: `event-search-optimization.ts`, `form-validation.ts`
  and the Dynamic form components were deleted 2026-11-08 (zero importers).
