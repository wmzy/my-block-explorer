// The utils barrel's contract: every module under src/utils is reachable
// through it, and the eight cross-module name collisions resolve to the
// documented winner. A bare `export *` surface would silently DROP an
// ambiguous name — these identity pins keep the resolution intentional
// (the losing variants stay reachable via deep imports, not via the
// barrel). The server logger serialization.ts pulls is stubbed to keep
// the jsdom suite free of node-only transports.
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
import { withRetry as errorHandlerWithRetry } from '@/utils/errorHandler';
import {
  getRpcConfigs,
  saveRpcConfig,
  deleteRpcConfig,
  testRpcConnection,
} from '@/utils/rpcConfigService';

describe('utils barrel', () => {
  it('resolves every colliding name to the documented winner', () => {
    expect(barrel.formatAddress).toBe(formatFormatAddress);
    expect(barrel.isValidAddress).toBe(validationIsValidAddress);
    expect(barrel.sanitizeInput).toBe(validationSanitizeInput);
    expect(barrel.withRetry).toBe(errorHandlerWithRetry);
    expect(barrel.getRpcConfigs).toBe(getRpcConfigs);
    expect(barrel.saveRpcConfig).toBe(saveRpcConfig);
    expect(barrel.deleteRpcConfig).toBe(deleteRpcConfig);
    expect(barrel.testRpcConnection).toBe(testRpcConnection);
  });

  it('exposes a representative export of every utils module', () => {
    const representative = {
      addressEquals: 'address',
      createApiError: 'api-error',
      getLatestBlocks: 'blockRpcData',
      isBlockTagSentinel: 'blockTagUtils',
      LRUCache: 'cache',
      buildCastCommand: 'castCommand',
      parseChainIdParam: 'chainParam',
      parseContractFunctions: 'contractInteraction',
      withRetry: 'errorHandler',
      searchEventsOptimized: 'event-search-optimization',
      registerAbiEvents: 'events',
      validateSolidityInput: 'form-validation',
      formatEth: 'format',
      getFunctionSelector: 'functionSelector',
      clampInternalTxDepth: 'internalTxScan',
      createRpcClient: 'realTimeData',
      getRpcClient: 'rpcClient',
      testMultipleRpcConnections: 'rpcConfig',
      analyzeRpcError: 'rpcErrorHandler',
      serializeForJson: 'serialization',
      optimizedSort: 'sorting-optimization',
      decodeTokenTransfersFromLogs: 'tokenTransferDecode',
      normalizeCallTrace: 'traceFormat',
      decodeFunctionCall: 'txDecode',
      detectSearchType: 'validation',
    } as const;

    const missing = Object.keys(representative).filter(
      (name) => (barrel as Record<string, unknown>)[name] === undefined,
    );
    expect(missing).toEqual([]);
  });
});
