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
// and messages live here once. (The transfers and watch list endpoints
// serve a different bare {error, message} body and keep their own
// inline envelopes.) Callers with a site-specific message — the
// contracts directory's cap-naming limit 400 — stay on respondError.
export const invalidLimitResponse = (c: Context) =>
  respondError(c, 400, 'invalid_limit', 'limit must be a positive integer');

export const invalidOffsetResponse = (c: Context) =>
  respondError(c, 400, 'invalid_offset', 'offset must be a non-negative integer');

export const invalidPageResponse = (c: Context) =>
  respondError(c, 400, 'invalid_page', 'page must be a positive integer');
