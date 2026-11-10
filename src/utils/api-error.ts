import type { Context } from 'hono';

type ApiErrorResponse = {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
  timestamp: string;
};

export const createApiError = (
  statusCode: number,
  error: string,
  message: string,
  details?: unknown,
): ApiErrorResponse => ({
  error,
  message,
  statusCode,
  details,
  timestamp: new Date().toISOString(),
});

export const respondError = (
  c: Context,
  statusCode: number,
  error: string,
  message?: string,
  details?: unknown,
) => {
  const body = createApiError(statusCode, error, message ?? error, details);
  return c.json(body, statusCode as 400 | 401 | 403 | 404 | 500);
};

// The shared 400 envelopes for parsePaginationParams' null results: the
// blocks/transactions/addresses/contracts/events list routes all answer
// a junk limit/offset/page with these exact bodies, so the error codes
// and messages live here once. The endpoints that still answer with a
// deliberately bare {error, message} body (no statusCode/timestamp),
// each pinned by its own tests: the transfers scan endpoint's
// invalid_cursor/invalid_limit 400s (routes/transfers.ts), the watch
// list/write endpoints (routes/watch.ts) and the watch-events limit 400,
// the labels/watch shared invalid_request param contract
// (server/validation.ts parseChainAndAddressRequest, rendered bare by
// both route files), and the compile-verification endpoint's
// CompileVerifyHttpError mapping whose documented extras (candidates)
// spread top-level beside error/message (routes/verify.ts). Everything
// else renders respondError. Callers with a site-specific message — the
// contracts directory's cap-naming limit 400 — stay on respondError.
export const invalidLimitResponse = (c: Context) =>
  respondError(c, 400, 'invalid_limit', 'limit must be a positive integer');

export const invalidOffsetResponse = (c: Context) =>
  respondError(c, 400, 'invalid_offset', 'offset must be a non-negative integer');

export const invalidPageResponse = (c: Context) =>
  respondError(c, 400, 'invalid_page', 'page must be a positive integer');
