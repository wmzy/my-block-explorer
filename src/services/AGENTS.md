# Services Layer

Business logic layer for blockchain explorer. All services are chain-agnostic.

## STRUCTURE

```
services/
├── RpcManager.ts              # Central RPC client manager (singleton)
├── EventIndexingService.ts    # Batch event indexing (2000 blocks/batch)
├── EventValidationService.ts  # Zod validation schemas
├── EventDecodingService.ts    # ABI event decoding
├── EventQueryService.ts       # Event querying with filters
├── EventPerformanceOptimizer.ts # Caching, 1-9ms target
├ ContractSourceService.ts     # Contract verification (Sourcify/Etherscan)
├── ContractInteractionService.ts # Contract read/simulate
├── AbiParsingService.ts       # ABI parsing, signature extraction
├── DynamicTableManager.ts     # Dynamic event table creation
├── BlockService.ts            # Block data (RPC + DB hybrid)
├── TransactionService.ts      # Transaction data
├── AddressService.ts          # Address data, binary search tx discovery
├── SearchService.ts           # Unified search
└── PerformanceMonitor.ts      # Global performance tracking
```

## WHERE TO LOOK

| Task                        | Service                    | Key Function             |
| --------------------------- | -------------------------- | ------------------------ |
| Index contract events       | EventIndexingService       | `startIndexing()`        |
| Get contract source/ABI     | ContractSourceService      | `getContractSource()`    |
| Validate event filters      | EventValidationService     | `validateEventFilters()` |
| Query indexed events        | EventQueryService          | `getContractEvents()`    |
| Read contract function      | ContractInteractionService | `readContract()`         |
| Get RPC client              | RpcManager                 | `getClient(chainId)`     |
| Search blocks/txs/addresses | SearchService              | `search()`               |

## KEY PATTERNS

### Singleton Manager

```typescript
export const rpcManager = new RpcManager(); // Line 218
```

### Per-Chain Service Instances

```typescript
class EventQueryServiceManager {
  private instances = new Map<number, EventQueryService>();
  getService(chainId: number): EventQueryService { ... }
}
```

### Hybrid Data Access (RPC + DB)

- Real-time data: fetched from RPC via viem
- Persistent data: cached in DuckDB
- Target: 1-9ms for cached queries

## DEPENDENCIES

```
RpcManager (foundation)
├── BlockService
├── TransactionService
├── AddressService
├── ContractSourceService
├── ContractInteractionService
└── EventIndexingService
```

## NOTES

- All services receive `chainId` parameter for multi-chain support
- Large files: ContractSourceService (1585 lines), EventValidationService (1290
  lines), EventIndexingService (1090 lines)
- Retry logic via `createRetryableRpcCall()` wrapper
