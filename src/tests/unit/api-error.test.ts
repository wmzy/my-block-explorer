import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiError } from '@/utils/api-error';

describe('api-error utilities', () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(
      '2025-03-17T12:00:00.000Z',
    );
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  describe('createApiError', () => {
    it('returns correct structure with all fields', () => {
      const result = createApiError(404, 'Not Found', 'Resource not found');

      expect(result).toEqual({
        error: 'Not Found',
        message: 'Resource not found',
        statusCode: 404,
        timestamp: '2025-03-17T12:00:00.000Z',
      });
    });

    it('includes timestamp', () => {
      const result = createApiError(500, 'Server Error', 'Something went wrong');

      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('string');
      expect(result.timestamp).toBe('2025-03-17T12:00:00.000Z');
    });

    it('handles optional details', () => {
      const details = { availableEndpoints: ['/api', '/api/health'] };
      const result = createApiError(
        404,
        'Not Found',
        'Endpoint not found',
        details,
      );

      expect(result).toEqual({
        error: 'Not Found',
        message: 'Endpoint not found',
        statusCode: 404,
        details,
        timestamp: '2025-03-17T12:00:00.000Z',
      });
    });
  });
});
