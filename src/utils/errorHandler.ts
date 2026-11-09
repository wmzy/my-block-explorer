/**
 * Error handling and retry mechanisms
 */

export type RetryOptions = {
  maxRetries: number;
  delay: number;
  backoff: number;
  retryCondition?: (error: unknown) => boolean;
};

/**
 * The one unknown-error → string renderer: an Error's message, else the
 * value's string form.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Retry decorator
 */
export function withRetry<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  options: RetryOptions = {
    maxRetries: 3,
    delay: 1000,
    backoff: 2,
  },
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    let lastError: unknown;
    let currentDelay = options.delay;

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;

        // Check whether to retry
        if (options.retryCondition && !options.retryCondition(error)) {
          throw error;
        }

        // On the final attempt, rethrow immediately
        if (attempt === options.maxRetries) {
          break;
        }

        // Wait, then retry
        await sleep(currentDelay);
        currentDelay *= options.backoff;

        console.warn(`Retry attempt ${attempt + 1}/${options.maxRetries} failed:`, error);
      }
    }

    throw lastError;
  };
}

/**
 * Sleep helper — the canonical `await sleep(ms)` for polling/backoff
 * loops. Signal-aware variants (ContractVerifyService's polling sleep)
 * stay local: abort semantics are their own contract.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * RPC error type
 */
export class RpcError extends Error {
  constructor(
    message: string,
    public code?: number,
    public data?: unknown,
    public chainId?: number,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

// Transient RPC conditions that arrive only in the error MESSAGE (no
// code, no status): provider rate limiting (429), temporary
// unavailability (503), and timeouts. viem-style Errors carry these
// verbatim — rpcErrorHandler.analyzeRpcError has always message-sniffed
// them, and the retry predicate must agree or createRetryableRpcCall
// drops exactly the errors the analysis calls retryable.
const TRANSIENT_RPC_MESSAGE_RE = /\b(?:429|503)\b|rate limit|service unavailable|timeout/i;

/**
 * Whether an error message names a transient RPC condition
 * (429 / rate limit / 503 / service unavailable / timeout).
 */
export function isTransientRpcMessage(message: string): boolean {
  return TRANSIENT_RPC_MESSAGE_RE.test(message);
}

/**
 * Check whether an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  const err = error as { code?: string; status?: number; message?: string };
  // Network errors
  if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
    return true;
  }

  // HTTP status code errors
  if (typeof err.status === 'number' && err.status >= 500 && err.status < 600) {
    return true;
  }

  // RPC-specific errors: some RPC error codes are retryable
  if (error instanceof RpcError) {
    const retryableCodes = [-32603, -32005, -32000]; // Internal error, limit exceeded, unknown error
    if (retryableCodes.includes(error.code ?? 0)) {
      return true;
    }
    // Fall through: a rate-limited RpcError is as retryable as a
    // rate-limited plain Error.
  }

  // Transient conditions named only in the message (viem-style Errors
  // carry no code/status): rate limits, 503s, timeouts.
  if (typeof err.message === 'string' && isTransientRpcMessage(err.message)) {
    return true;
  }

  return false;
}

/**
 * Normalize an error response
 */
export function normalizeError(error: unknown): {
  message: string;
  code?: string | number;
  type: string;
  retryable: boolean;
} {
  if (error instanceof RpcError) {
    return {
      message: error.message,
      code: error.code,
      type: 'rpc',
      retryable: isRetryableError(error),
    };
  }

  const err = error as { code?: string; message?: string };
  // Network errors
  if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
    return {
      message: `Network error: ${err.message ?? 'Unknown'}`,
      code: err.code,
      type: 'network',
      retryable: true,
    };
  }

  // Default error case — retryability comes from the SAME shared
  // predicate createRetryableRpcCall ultimately consults, so a
  // transient-by-message error (429/503/timeout) stays retryable here too.
  return {
    message: (error instanceof Error ? error.message : err.message) ?? 'Unknown error',
    type: 'unknown',
    retryable: isRetryableError(error),
  };
}

/**
 * Create a retryable RPC call function
 */
export function createRetryableRpcCall<T extends unknown[], R>(
  rpcFunction: (...args: T) => Promise<R>,
  chainId?: number,
): (...args: T) => Promise<R> {
  return withRetry(rpcFunction, {
    maxRetries: 3,
    delay: 1000,
    backoff: 1.5,
    retryCondition: error => {
      const normalized = normalizeError(error);
      if (!normalized.retryable) {
        console.error(`Non-retryable RPC error for chain ${chainId}:`, normalized);
        return false;
      }
      return true;
    },
  });
}

/**
 * Create a retryable database operation function
 */
export function createRetryableDbCall<T extends unknown[], R>(
  dbFunction: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return withRetry(dbFunction, {
    maxRetries: 2,
    delay: 500,
    backoff: 2,
    retryCondition: (error: unknown) => {
      const err = error instanceof Error ? error : { message: String(error) };
      // Database-locked errors can be retried
      if (err.message?.includes('database is locked') || err.message?.includes('SQLITE_BUSY')) {
        return true;
      }
      return false;
    },
  });
}

/**
 * Error logging
 */
export function logError(
  error: unknown,
  context: string,
  additionalInfo?: Record<string, unknown>,
): void {
  const normalized = normalizeError(error);

  console.error(`[${context}] ${normalized.type.toUpperCase()} ERROR:`, {
    message: normalized.message,
    code: normalized.code,
    retryable: normalized.retryable,
    timestamp: new Date().toISOString(),
    ...additionalInfo,
  });

  // Critical errors could trigger alerting here
  if (!normalized.retryable) {
    console.error(`[${context}] CRITICAL ERROR - Manual intervention may be required`);
  }
}
