# Utilities

RPC data layer, formatting, caching, and error handling utilities.

## STRUCTURE

```
utils/
├── realTimeData.ts           # Frontend RPC client factory + address data
├── blockRpcData.ts           # Block/transaction RPC calls
├── cache.ts                  # LRU cache + global instances
├── format.ts                 # Value formatting (Eth, Gas, tokens)
├── errorHandler.ts           # Error classes + withRetry decorator
├── rpcErrorHandler.ts        # RPC error analysis
├── rpcClient.ts              # Simple RPC client
├── rpcConfig.ts              # RPC configuration
├── rpcConfigService.ts       # RPC config management
├── contractInteraction.ts    # Contract call utilities
├── sorting-optimization.ts   # Large dataset sorting with caching (543 lines)
├── event-search-optimization.ts # Search caching (519 lines)
├── serialization.ts          # JSON serialization (BigInt handling)
├── form-validation.ts        # Form validation utilities
├── validation.ts             # Input validation
├── address.ts                # Ethereum address utilities
├── api-error.ts              # API error factory
├── events.ts                 # Event utilities
└── index.ts                  # Barrel export (incomplete!)
```

## WHERE TO LOOK

| Task                      | File               | Key Export                                |
| ------------------------- | ------------------ | ----------------------------------------- |
| Create RPC client         | realTimeData.ts    | `createRpcClient()`                       |
| Get address balance/nonce | realTimeData.ts    | `getRealTimeAddressData()`                |
| Fetch blocks              | blockRpcData.ts    | `getLatestBlocks()`, `getBlockByNumber()` |
| Fetch transactions        | blockRpcData.ts    | `getTransactionByHash()`                  |
| Get cached data           | cache.ts           | `blockCache`, `addressCache`              |
| Format values             | format.ts          | `formatEther()`, `formatGas()`            |
| Retry logic               | errorHandler.ts    | `withRetry()`                             |
| Analyze RPC errors        | rpcErrorHandler.ts | `analyzeRpcError()`                       |

## KEY PATTERNS

### Singleton Caches

```typescript
export const blockCache = new LRUCache(...);
export const addressCache = new LRUCache(...);
```

### Factory Functions

```typescript
export const createRpcClient = async (chainId: number): Promise<PublicClient>
```

### Retry Decorator

```typescript
export const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T>
```

## BARREL

`index.ts` re-exports all util modules (8 cross-module name collisions are
resolved with explicit re-exports that take precedence over ambiguous star
exports: `formatAddress`→`format`, `isValidAddress`/`sanitizeInput`→
`validation`, `withRetry`→`errorHandler`, the five `rpcConfigService`
functions). Deep imports remain canonical for call sites — the barrel is
convenience surface, and `serialization.ts` pulls the pino logger through it
(browser code should keep deep imports there).

```typescript
// Both work; deep imports are still the norm in call sites
import { createRpcClient } from '@/utils';
import { createRpcClient } from '@/utils/realTimeData';
```

## NOTES

- Two RPC client systems: `realTimeData.ts` (frontend), `rpcClient.ts` (simpler)
- Duplicate functions: `formatAddress()` exists in both `address.ts` and
  `format.ts`
- Large files: `sorting-optimization.ts` (543 lines),
  `event-search-optimization.ts` (519 lines)
