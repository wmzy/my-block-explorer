// Leaf tests for util/adminGate: the admin gate's two 403 faces and the
// limiter's "retry after Ns" wait parse — shared by the Ops dashboard
// and the SQL console (each view keeps its own recovery copy; the view
// tests pin that copy, these pin the parse itself).
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/util/apiError';
import { adminGateFromError, rateLimitWaitSeconds } from '@/util/adminGate';

describe('adminGateFromError', () => {
  it('classifies the strict tier\'s "no ADMIN_TOKEN" 403 as unconfigured', () => {
    expect(
      adminGateFromError(
        new ApiError(
          'Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.',
          403,
        ),
      ),
    ).toBe('unconfigured');
  });

  it('classifies any other 403 as unauthorized', () => {
    expect(adminGateFromError(new ApiError('Invalid admin token.', 403))).toBe('unauthorized');
  });

  it('ignores non-403 statuses, plain Errors, and non-error values', () => {
    expect(adminGateFromError(new ApiError('Invalid admin token.', 401))).toBeNull();
    expect(adminGateFromError(new Error('Set ADMIN_TOKEN on the server'))).toBeNull();
    expect(adminGateFromError('Set ADMIN_TOKEN on the server')).toBeNull();
  });
});

describe('rateLimitWaitSeconds', () => {
  it('parses the wait back out of the limiter message', () => {
    expect(rateLimitWaitSeconds(new ApiError('Too many requests — retry after 3s.', 429))).toBe(3);
  });

  it('ignores other statuses, plain Errors, and messages without a wait', () => {
    expect(rateLimitWaitSeconds(new ApiError('Too many requests — retry after 3s.', 503))).toBeNull();
    expect(rateLimitWaitSeconds(new Error('retry after 3s'))).toBeNull();
    expect(rateLimitWaitSeconds(new ApiError('Too many requests.', 429))).toBeNull();
  });
});
