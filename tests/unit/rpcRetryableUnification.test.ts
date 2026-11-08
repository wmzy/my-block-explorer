// Retryability unification: errorHandler.isRetryableError (the predicate
// behind createRetryableRpcCall) and rpcErrorHandler.analyzeRpcError used
// to disagree on transient conditions that arrive only in the error
// MESSAGE — a viem-style Error('429 Too Many Requests') with no
// code/status was "retryable" per the analysis but "final" per the
// predicate, so rate-limited reads never retried. These pins hold BOTH
// classifications to the same answer.
import { describe, it, expect, vi } from 'vitest';
import { createRetryableRpcCall, isRetryableError } from '@/utils/errorHandler';
import { analyzeRpcError } from '@/utils/rpcErrorHandler';

const CONTEXT = { blockNumber: 100, contractAddress: '0xabc', rpcUrl: 'http://rpc', chainId: 1 };

// viem-style failures: plain Errors whose only signal is the message.
const transientMessages = [
  '429 Too Many Requests',
  'Request failed with status 503 Service Unavailable',
  'The operation timed out (timeout exceeded)',
  'Rate limit exceeded for this endpoint',
];

describe('retryable classification agrees between predicate and analysis', () => {
  it.each(transientMessages)('classifies %j as retryable in BOTH modules', message => {
    const error = new Error(message);

    expect(analyzeRpcError(error, CONTEXT).retryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
  });

  it('retries a rate-limited read inside createRetryableRpcCall (was final before unification)', async () => {
    const rpcFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValue('block');

    const retryable = createRetryableRpcCall(rpcFn, 1);

    // Red on the pre-unification predicate: the 429-by-message error was
    // not retryable, so the call rejected immediately after ONE attempt.
    await expect(retryable()).resolves.toBe('block');
    expect(rpcFn).toHaveBeenCalledTimes(2);
  });

  it('keeps a permanent 4xx-shaped failure final in BOTH modules', () => {
    const error = new Error('Invalid parameters: execution reverted');

    expect(analyzeRpcError(error, CONTEXT).retryable).toBe(true); // generic-branch default
    // The predicate stays stricter than the analysis's generic default:
    // only KNOWN transient signals (429/503/timeout/rate limit) retry.
    expect(isRetryableError(error)).toBe(false);
  });
});
