// Barrel for src/utils — a convenience re-export surface only. Deep
// imports (`@/utils/<module>`) remain fully supported; no call site is
// expected to migrate.
//
// Cycle safety: no module under src/utils imports this barrel (no
// `from '@/utils'`, `'../utils'` or `'.'` self-imports exist), so these
// star re-exports cannot introduce an import cycle.
//
// Eight names are exported by two modules each; a bare star-export surface
// would silently DROP an ambiguous name. They are resolved explicitly at
// the bottom — the losing variant stays reachable via its deep import:
//   formatAddress / isValidAddress / sanitizeInput → format.ts and
//     validation.ts (the barrel's original surface) win over address.ts
//     and form-validation.ts.
//   withRetry → errorHandler.ts (generic retry) over rpcClient.ts
//     (RPC-bound variant).
//   getRpcConfigs / saveRpcConfig / deleteRpcConfig / testRpcConnection →
//     rpcConfigService.ts (API-backed, used by the settings modal) over
//     the legacy localStorage rpcConfig.ts.
//
// Graph note: serialization.ts reaches src/server/logger (pino), so
// browser code that imports this barrel pulls that node-side dependency —
// prefer the deep import there.
export * from './address';
export * from './api-error';
export * from './blockRpcData';
export * from './blockTagUtils';
export * from './cache';
export * from './castCommand';
export * from './chainParam';
export * from './contractInteraction';
export * from './errorHandler';
export * from './event-search-optimization';
export * from './events';
export * from './form-validation';
export * from './format';
export * from './functionSelector';
export * from './internalTxScan';
export * from './realTimeData';
export * from './rpcClient';
export * from './rpcConfig';
export * from './rpcConfigService';
export * from './rpcErrorHandler';
export * from './rawTxDecode';
export * from './serialization';
export * from './sorting-optimization';
export * from './stateOverride';
export * from './tokenTransferDecode';
export * from './traceFormat';
export * from './txDecode';
export * from './validation';

// Collision winners — an explicit re-export takes precedence over an
// ambiguous star export.
export { formatAddress } from './format';
export { isValidAddress, sanitizeInput } from './validation';
export { withRetry } from './errorHandler';
export {
  getRpcConfigs,
  saveRpcConfig,
  deleteRpcConfig,
  testRpcConnection,
} from './rpcConfigService';
