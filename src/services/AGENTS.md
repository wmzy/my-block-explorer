# Services Layer

Business logic layer for blockchain explorer. All services are chain-agnostic.

## STRUCTURE

```
services/
├── RpcManager.ts              # Central RPC client manager (singleton)
├── EventIndexingService.ts    # Batch event indexing (2000 blocks/batch)
├── EventDecodingService.ts    # ABI event decoding
├ ContractSourceService.ts     # Contract verification (Sourcify/Etherscan)
├── ContractInteractionService.ts # Contract read/simulate
├── BlockService.ts            # Block data (RPC + DB hybrid)
├── TransactionService.ts      # Transaction data
├── AddressService.ts          # Address data, binary search tx discovery
├── SearchService.ts           # Unified search
├── ens.ts                     # ENS reverse resolution hook (mainnet-pinned, frontend)
└── PerformanceMonitor.ts      # Global performance tracking
```

## WHERE TO LOOK

| Task                        | Service                    | Key Function                                                             |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| Index contract events       | EventIndexingService       | `addIndexingRange()`, `createRange{All,Recent,First,Continue,Catchup}()` |
| Get contract source/ABI     | ContractSourceService      | `getContractSource()`                                                    |
| Read contract function      | ContractInteractionService | `readContract()`                                                         |
| Get RPC client              | RpcManager                 | `getClient(chainId)`                                                     |
| Search blocks/txs/addresses | SearchService              | `search()`                                                               |

## KEY PATTERNS

### Singleton Manager

```typescript
export const rpcManager = new RpcManager(); // Line 218
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
- Large files: ContractSourceService (1585 lines), EventIndexingService (1090
  lines)
- Retry logic via `createRetryableRpcCall()` wrapper
