import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";

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
  details?: unknown
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
  details?: unknown
) => {
  const body = createApiError(
    statusCode,
    error,
    message ?? error,
    details
  );
  return c.json(body, statusCode as 400 | 401 | 403 | 404 | 500);
};

export const handleRouteError = (
  c: Context,
  err: unknown,
  fallbackMessage: string
) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  const message = err instanceof Error ? err.message : fallbackMessage;
  return respondError(c, 500, "Internal Server Error", message);
};
