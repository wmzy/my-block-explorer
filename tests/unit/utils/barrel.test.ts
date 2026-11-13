// The utils barrel's contract: the modules it re-exports are reachable
// through it, and the cross-module name collisions resolve to the
// documented winner. A bare `export *` surface would silently DROP an
// ambiguous name — these identity pins keep the resolution intentional
// (the losing variants stay reachable via deep imports, not via the
// barrel). Browser-RPC modules (realTimeData, rpcConfigService,
// contractInteraction, callTraceRpc) are deliberately NOT re-exported —
// their import graph pulls @/util/http, which the vite.config esbuild
// bundle cannot resolve — and the negative pins below keep that boundary
// intentional too. The server logger serialization.ts pulls is stubbed
// to keep the jsdom suite free of node-only transports.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/logger', () => ({
  createLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

import * as barrel from '@/utils';
import { formatAddress as formatFormatAddress } from '@/utils/format';
import {
  isValidAddress as validationIsValidAddress,
  sanitizeInput as validationSanitizeInput,
} from '@/utils/validation';

describe('utils barrel', () => {
  it('resolves every colliding name to the documented winner', () => {
    expect(barrel.formatAddress).toBe(formatFormatAddress);
    expect(barrel.isValidAddress).toBe(validationIsValidAddress);
    expect(barrel.sanitizeInput).toBe(validationSanitizeInput);
  });

  it('exposes a representative export of every re-exported utils module', () => {
    const representative = {
      addressEquals: 'address',
      createApiError: 'api-error',
      getLatestBlocks: 'blockRpcData',
      resolveToBlock: 'blockTagUtils',
      chunk: 'chunk',
      createTtlLruCache: 'ttlLruCache',
      buildCastCommand: 'castCommand',
      parseChainIdParam: 'chainParam',
      escapeCsvField: 'csv',
      withRetry: 'errorHandler',
      getContractCreationBlock: 'events',
      formatValue: 'format',
      getFunctionSelector: 'functionSelector',
      clampInternalTxDepth: 'internalTxScan',
      LABEL_MAX_LENGTH: 'labelContract',
      isShrinkableProviderError: 'providerErrors',
      analyzeRpcError: 'rpcErrorHandler',
      safeJsonResponse: 'serialization',
      optimizedSort: 'sorting-optimization',
      decodeTokenTransfersFromLogs: 'tokenTransferDecode',
      normalizeCallTrace: 'traceFormat',
      decodeFunctionCall: 'txDecode',
      detectSearchType: 'validation',
    } as const;

    const missing = Object.keys(representative).filter(
      name => (barrel as Record<string, unknown>)[name] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('does not re-export the browser-RPC modules (deep-import only)', () => {
    // realTimeData / rpcConfigService / contractInteraction reach
    // @/util/http (browser service discovery); re-exporting them would
    // drag that graph into backend barrel consumers (vite.config
    // esbuild bundle cannot resolve @/).
    const browserRpcNames = [
      'createRpcClient',
      'invalidateRpcClients',
      'getRealTimeAddressData',
      'readContract',
      'simulateContract',
      'parseContractFunctionsUnified',
      'getRpcConfigs',
    ];
    const leaked = browserRpcNames.filter(
      name => (barrel as Record<string, unknown>)[name] !== undefined,
    );
    expect(leaked).toEqual([]);
  });
});
