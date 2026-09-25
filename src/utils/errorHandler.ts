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
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
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

/**
 * Database error type
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Validation error type
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Check whether an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  const err = error as { code?: string; status?: number };
  // Network errors
  if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
    return true;
  }

  // HTTP status code errors
  if (typeof err.status === 'number' && err.status >= 500 && err.status < 600) {
    return true;
  }

  // RPC-specific errors
  if (error instanceof RpcError) {
    // Some RPC error codes are retryable
    const retryableCodes = [-32603, -32005, -32000]; // Internal error, limit exceeded, unknown error
    return retryableCodes.includes(error.code ?? 0);
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

  if (error instanceof DatabaseError) {
    return {
      message: error.message,
      type: 'database',
      retryable: false,
    };
  }

  if (error instanceof ValidationError) {
    return {
      message: error.message,
      type: 'validation',
      retryable: false,
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

  // Default error case
  return {
    message: (error instanceof Error ? error.message : err.message) ?? 'Unknown error',
    type: 'unknown',
    retryable: false,
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
  if (!normalized.retryable && normalized.type !== 'validation') {
    console.error(`[${context}] CRITICAL ERROR - Manual intervention may be required`);
  }
}
