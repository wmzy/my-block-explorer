import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  RpcError,
  DatabaseError,
  ValidationError,
  isRetryableError,
  normalizeError,
  createRetryableRpcCall,
  createRetryableDbCall,
} from '@/utils/errorHandler';

describe('ErrorHandler', () => {
  describe('withRetry', () => {
    it('应该在成功时直接返回结果', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      const retryFn = withRetry(mockFn, { maxRetries: 3, delay: 10, backoff: 1 });

      const result = await retryFn('arg1', 'arg2');

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledOnce();
      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('应该在失败时进行重试', async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('success');

      const retryFn = withRetry(mockFn, { maxRetries: 3, delay: 10, backoff: 1 });

      const result = await retryFn();

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('应该在达到最大重试次数后抛出错误', async () => {
      const error = new Error('persistent failure');
      const mockFn = vi.fn().mockRejectedValue(error);

      const retryFn = withRetry(mockFn, { maxRetries: 2, delay: 10, backoff: 1 });

      await expect(retryFn()).rejects.toThrow('persistent failure');
      expect(mockFn).toHaveBeenCalledTimes(3); // 初始调用 + 2次重试
    });

    it('应该根据重试条件决定是否重试', async () => {
      const retryableError = new Error('retryable');
      const nonRetryableError = new Error('non-retryable');

      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(nonRetryableError);

      const retryFn = withRetry(mockFn, {
        maxRetries: 3,
        delay: 10,
        backoff: 1,
        retryCondition: (err: unknown) => err instanceof Error && err.message === 'retryable',
      });

      await expect(retryFn()).rejects.toThrow('non-retryable');
      expect(mockFn).toHaveBeenCalledTimes(2); // 第二个错误不可重试
    });
  });

  describe('错误类型', () => {
    it('RpcError应该包含正确的属性', () => {
      const error = new RpcError('RPC failed', 500, { detail: 'timeout' }, 1);

      expect(error.name).toBe('RpcError');
      expect(error.message).toBe('RPC failed');
      expect(error.code).toBe(500);
      expect(error.data).toEqual({ detail: 'timeout' });
      expect(error.chainId).toBe(1);
    });

    it('DatabaseError应该包含正确的属性', () => {
      const originalError = new Error('DB connection failed');
      const error = new DatabaseError('Database operation failed', originalError);

      expect(error.name).toBe('DatabaseError');
      expect(error.message).toBe('Database operation failed');
      expect(error.originalError).toBe(originalError);
    });

    it('ValidationError应该包含正确的属性', () => {
      const error = new ValidationError('Invalid input', 'email');

      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Invalid input');
      expect(error.field).toBe('email');
    });
  });

  describe('isRetryableError', () => {
    it('应该识别网络错误为可重试', () => {
      const networkErrors = [{ code: 'ECONNRESET' }, { code: 'ENOTFOUND' }, { code: 'ETIMEDOUT' }];

      networkErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('应该识别5xx HTTP状态码为可重试', () => {
      const serverErrors = [{ status: 500 }, { status: 502 }, { status: 503 }, { status: 504 }];

      serverErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('应该识别特定RPC错误为可重试', () => {
      const retryableRpcErrors = [
        new RpcError('Internal error', -32603),
        new RpcError('Limit exceeded', -32005),
        new RpcError('Unknown error', -32000),
      ];

      retryableRpcErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('应该识别非可重试错误', () => {
      const nonRetryableErrors = [
        { status: 400 },
        { status: 401 },
        { status: 404 },
        new RpcError('Invalid params', -32602),
        new ValidationError('Invalid input'),
      ];

      nonRetryableErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('normalizeError', () => {
    it('应该正确标准化RpcError', () => {
      const error = new RpcError('RPC failed', 500);
      const normalized = normalizeError(error);

      expect(normalized).toEqual({
        message: 'RPC failed',
        code: 500,
        type: 'rpc',
        retryable: false, // RPC错误500不是可重试的
      });
    });

    it('应该正确标准化DatabaseError', () => {
      const error = new DatabaseError('DB failed');
      const normalized = normalizeError(error);

      expect(normalized).toEqual({
        message: 'DB failed',
        type: 'database',
        retryable: false,
      });
    });

    it('应该正确标准化ValidationError', () => {
      const error = new ValidationError('Invalid input');
      const normalized = normalizeError(error);

      expect(normalized).toEqual({
        message: 'Invalid input',
        type: 'validation',
        retryable: false,
      });
    });

    it('应该正确标准化网络错误', () => {
      const error = { code: 'ECONNRESET', message: 'Connection reset' };
      const normalized = normalizeError(error);

      expect(normalized).toEqual({
        message: 'Network error: Connection reset',
        code: 'ECONNRESET',
        type: 'network',
        retryable: true,
      });
    });

    it('应该正确标准化未知错误', () => {
      const error = new Error('Unknown error');
      const normalized = normalizeError(error);

      expect(normalized).toEqual({
        message: 'Unknown error',
        type: 'unknown',
        retryable: false,
      });
    });
  });

  describe('createRetryableRpcCall', () => {
    it('应该创建带重试的RPC调用函数', async () => {
      const mockRpcFn = vi
        .fn()
        .mockRejectedValueOnce(new RpcError('Temporary failure', -32603))
        .mockResolvedValue('success');

      const retryableRpcFn = createRetryableRpcCall(mockRpcFn, 1);

      const result = await retryableRpcFn('arg1');

      expect(result).toBe('success');
      expect(mockRpcFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('createRetryableDbCall', () => {
    it('应该创建带重试的数据库调用函数', async () => {
      const mockDbFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('database is locked'))
        .mockResolvedValue('success');

      const retryableDbFn = createRetryableDbCall(mockDbFn);

      const result = await retryableDbFn('arg1');

      expect(result).toBe('success');
      expect(mockDbFn).toHaveBeenCalledTimes(2);
    });

    it('应该不重试非锁定相关的数据库错误', async () => {
      const mockDbFn = vi.fn().mockRejectedValue(new Error('syntax error'));

      const retryableDbFn = createRetryableDbCall(mockDbFn);

      await expect(retryableDbFn()).rejects.toThrow('syntax error');
      expect(mockDbFn).toHaveBeenCalledOnce();
    });
  });
});
