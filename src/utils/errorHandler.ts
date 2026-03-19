/**
 * 错误处理和重试机制
 */

export type RetryOptions = {
  maxRetries: number;
  delay: number;
  backoff: number;
  retryCondition?: (error: unknown) => boolean;
};

/**
 * 重试装饰器
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
      }
      catch (error) {
        lastError = error;

        // 检查是否应该重试
        if (options.retryCondition && !options.retryCondition(error)) {
          throw error;
        }

        // 如果是最后一次尝试，直接抛出错误
        if (attempt === options.maxRetries) {
          break;
        }

        // 等待后重试
        await sleep(currentDelay);
        currentDelay *= options.backoff;

        console.warn(
          `Retry attempt ${attempt + 1}/${options.maxRetries} failed:`,
          error,
        );
      }
    }

    throw lastError;
  };
}

/**
 * 睡眠函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * RPC错误类型
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
 * 数据库错误类型
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
 * 验证错误类型
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
 * 检查是否为可重试的错误
 */
export function isRetryableError(error: unknown): boolean {
  const err = error as { code?: string; status?: number };
  // 网络错误
  if (
    err.code === 'ECONNRESET'
    || err.code === 'ENOTFOUND'
    || err.code === 'ETIMEDOUT'
  ) {
    return true;
  }

  // HTTP状态码错误
  if (typeof err.status === 'number' && err.status >= 500 && err.status < 600) {
    return true;
  }

  // RPC特定错误
  if (error instanceof RpcError) {
    // 某些RPC错误码是可重试的
    const retryableCodes = [-32603, -32005, -32000]; // Internal error, limit exceeded, unknown error
    return retryableCodes.includes(error.code || 0);
  }

  return false;
}

/**
 * 标准化错误响应
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
  // 网络错误
  if (
    err.code === 'ECONNRESET'
    || err.code === 'ENOTFOUND'
    || err.code === 'ETIMEDOUT'
  ) {
    return {
      message: `Network error: ${err.message ?? 'Unknown'}`,
      code: err.code,
      type: 'network',
      retryable: true,
    };
  }

  // 默认错误
  return {
    message: (error instanceof Error ? error.message : err.message) || 'Unknown error',
    type: 'unknown',
    retryable: false,
  };
}

/**
 * 创建带重试的RPC调用函数
 */
export function createRetryableRpcCall<T extends unknown[], R>(
  rpcFunction: (...args: T) => Promise<R>,
  chainId?: number,
): (...args: T) => Promise<R> {
  return withRetry(rpcFunction, {
    maxRetries: 3,
    delay: 1000,
    backoff: 1.5,
    retryCondition: (error) => {
      const normalized = normalizeError(error);
      if (!normalized.retryable) {
        console.error(
          `Non-retryable RPC error for chain ${chainId}:`,
          normalized,
        );
        return false;
      }
      return true;
    },
  });
}

/**
 * 创建带重试的数据库操作函数
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
      // 数据库锁定错误可以重试
      if (
        err.message?.includes('database is locked')
        || err.message?.includes('SQLITE_BUSY')
      ) {
        return true;
      }
      return false;
    },
  });
}

/**
 * 错误日志记录
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

  // 如果是严重错误，可以在这里添加报警逻辑
  if (!normalized.retryable && normalized.type !== 'validation') {
    console.error(
      `[${context}] CRITICAL ERROR - Manual intervention may be required`,
    );
  }
}
