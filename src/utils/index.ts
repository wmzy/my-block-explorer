// Barrel for src/utils — a convenience re-export surface only. Deep
// imports (`@/utils/<module>`) remain fully supported; no call site is
// expected to migrate.
//
// Cycle safety: no module under src/utils imports this barrel (no
// `from '@/utils'`, `'../utils'` or `'.'` self-imports exist), so these
// star re-exports cannot introduce an import cycle.
//
// Two names are exported by two modules each; a bare star-export surface
// would silently DROP an ambiguous name. They are resolved explicitly at
// the bottom — the losing variant stays reachable via its deep import:
//   isValidAddress / sanitizeInput → format.ts and validation.ts (the
//     barrel's original surface) win over address.ts.
//     (sanitizeInput's second exporter, form-validation.ts, is deleted;
//     its explicit pin below now just restates validation.ts.
//     formatAddress used to be the third collision — address.ts's
//     checksum formatter lost to format.ts's truncation formatter; it is
//     now renamed checksumAddress, so both names flow from their single
//     home modules unambiguously.)
//
// Graph note: serialization.ts reaches src/server/logger (pino), so
// browser code that imports this barrel pulls that node-side dependency —
// prefer the deep import there.
export * from './address';
export * from './api-error';
export * from './blockRpcData';
export * from './blockTagUtils';
// NOTE: './cache' (deleted 2026-11-09 — blockCache migrated to
// ttlLruCache) and './callTraceRpc' (a browser-RPC module — browser code
// deep-imports it, like serialization/pino; re-exporting it here would
// drag realTimeData's browser graph into every backend barrel consumer,
// including the vite.config esbuild bundle, which cannot resolve @/) are
// deliberately NOT re-exported from this barrel.
export * from './castCommand';
export * from './chainParam';
export * from './contractInteraction';
export * from './csv';
export * from './dbTime';
export * from './errorHandler';
export * from './events';
export * from './format';
export * from './functionSelector';
export * from './internalTxScan';
export * from './labelContract';
export * from './providerErrors';
export * from './realTimeData';
export * from './rpcConfigService';
export * from './rpcErrorHandler';
export * from './rawTxDecode';
export * from './viemScript';
export * from './serialization';
export * from './sorting-optimization';
export * from './stateOverride';
export * from './tokenTransferDecode';
export * from './traceFormat';
export * from './ttlLruCache';
export * from './txDecode';
export * from './validation';

// Collision winners — an explicit re-export takes precedence over an
// ambiguous star export. (withRetry and the rpcConfigService functions
// each had a second exporter once — rpcClient.ts / rpcConfig.ts — both
// since deleted; the star exports now carry them unambiguously.)
export { isValidAddress, sanitizeInput } from './validation';
