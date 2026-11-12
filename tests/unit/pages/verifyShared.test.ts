// The verify panels' shared module: ONE result union and ONE infra
// failure taxonomy. The unreachable-backend and admin-token sentences are
// pinned verbatim — they used to be duplicated across all three panels —
// and the panel-specific status branches (Sourcify 502, compile 504,
// manual 404-on-remove) stay the panels' own.
import { describe, it, expect } from 'vitest';
import { ApiError } from '@/util/apiError';
import { describeSubmitError } from '@/views/Contract/verifyShared';

const sourcifyOptions = {
  fallback: 'Verification request failed.',
  statusText: (e: ApiError) => (e.status === 502 ? `${e.message} Try again in a moment.` : null),
};
const compileOptions = {
  fallback: 'Verification request failed.',
  statusText: (e: ApiError) =>
    e.status === 504
      ? 'The compile run exceeded its time budget — try a smaller input or a compiler version already downloaded.'
      : null,
};
const manualRemoveOptions = {
  fallback: 'Request failed.',
  statusText: (e: ApiError) =>
    e.status === 404
      ? 'No manual mark was found — the contract may have been re-verified or the mark already removed.'
      : null,
};

describe('describeSubmitError (shared verify taxonomy)', () => {
  it('attributes a status-0 failure to the unreachable backend, verbatim', () => {
    const error = new ApiError('network down', 0);
    for (const options of [sourcifyOptions, compileOptions, manualRemoveOptions]) {
      expect(describeSubmitError(error, options)).toBe(
        'The explorer API is unreachable — start the backend (or fix its address in ⚙ RPC settings) and try again.',
      );
    }
  });

  it('attributes a 403 to the admin-token gate, verbatim', () => {
    const error = new ApiError('forbidden', 403);
    expect(describeSubmitError(error, sourcifyOptions)).toBe(
      'Requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.',
    );
  });

  it('lets each panel keep its own status sentence', () => {
    expect(describeSubmitError(new ApiError('sourcify round trip failed', 502), sourcifyOptions)).toBe(
      'sourcify round trip failed Try again in a moment.',
    );
    expect(describeSubmitError(new ApiError('gateway timeout', 504), compileOptions)).toBe(
      'The compile run exceeded its time budget — try a smaller input or a compiler version already downloaded.',
    );
    expect(describeSubmitError(new ApiError('gone', 404), manualRemoveOptions)).toBe(
      'No manual mark was found — the contract may have been re-verified or the mark already removed.',
    );
    // A 404 with no matching branch falls through to the message.
    expect(describeSubmitError(new ApiError('gone', 404), sourcifyOptions)).toBe('gone');
  });

  it('falls back to the message, then to the action-noun fallback', () => {
    expect(describeSubmitError(new Error('socket hung up'), sourcifyOptions)).toBe(
      'socket hung up',
    );
    // A thrown non-Error keeps its own string form (errorMessage's
    // contract: real information always beats the fallback) — only a
    // falsy or empty-message failure reaches the action-noun fallback.
    expect(describeSubmitError('not an error', sourcifyOptions)).toBe('not an error');
    expect(describeSubmitError('', manualRemoveOptions)).toBe('Request failed.');
  });
});
