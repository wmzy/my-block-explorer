/**
 * Shared shrinkable-provider-error classification (utils/providerErrors):
 * the single definition EventIndexingService and AddressScanService both
 * import (formerly a conscious copy in each — the exact drift trap this
 * module exists to close). Pins the match surface both services rely on
 * and, just as importantly, the errors that must NOT classify as
 * shrinkable (archive/permanent class — shrinking cannot help there).
 */
import { describe, it, expect } from 'vitest';
import {
  SHRINKABLE_PROVIDER_ERROR_RE,
  isShrinkableProviderError,
} from '@/utils/providerErrors';

describe('isShrinkableProviderError', () => {
  it('matches provider range-cap and throttle shapes', () => {
    const shrinkable = [
      'Limit exceeded: block range too large for this provider',
      '429 Too Many Requests',
      'rate limit reached',
      'query exceeds 10k results limit',
      'request timeout after 30000ms',
      'connect ECONNREFUSED',
      'socket hang up',
      'fetch failed',
      'ECONNRESET',
      'network error while fetching',
    ];
    for (const message of shrinkable) {
      expect(isShrinkableProviderError(new Error(message)), message).toBe(true);
    }
  });

  it('does not match permanent or execution-level errors', () => {
    const notShrinkable = [
      'execution reverted',
      'historical state not available',
      'missing trie node',
      'invalid address checksum',
      // 'limit' as part of an unrelated word must not match on its own —
      // and these shapes are the provider's definitive refusals.
      'the method eth_getLogs does not exist/is not available',
    ];
    for (const message of notShrinkable) {
      expect(isShrinkableProviderError(new Error(message)), message).toBe(false);
    }
  });

  it('classifies non-Error values by their string form', () => {
    expect(isShrinkableProviderError('upstream 429')).toBe(true);
    expect(isShrinkableProviderError('execution reverted')).toBe(false);
    expect(isShrinkableProviderError(null)).toBe(false);
  });

  it('is case-insensitive via the exported regex', () => {
    expect(SHRINKABLE_PROVIDER_ERROR_RE.test('Rate Limit Exceeded')).toBe(true);
    expect(SHRINKABLE_PROVIDER_ERROR_RE.test('Request Timed Out')).toBe(true);
  });
});
