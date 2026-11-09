/**
 * PerformanceMonitor.checkOperation: the returned duration is real
 * measured elapsed time on both outcomes (it was previously hardcoded
 * 0), retries announce themselves via console.warn (the module's
 * operational log level — never console.log), and timeout/retries
 * behave as documented.
 */

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { PerformanceMonitor, performanceMonitor } from '@/services/PerformanceMonitor';

const monitor = new PerformanceMonitor();

afterEach(() => {
  monitor.stop();
  monitor.clear();
  vi.restoreAllMocks();
});

// The module-level singleton starts a report interval at import time;
// stop it so the suite leaves no dangling timer.
afterAll(() => {
  performanceMonitor.stop();
});

describe('checkOperation', () => {
  it('returns success with the result and a real elapsed duration', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await monitor.checkOperation('unit-check', async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      return 42;
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
    expect(result.error).toBeUndefined();
    // A hardcoded 0 cannot pass: the operation itself takes >= 15ms.
    // (record() also fires its own slow-op console.warn for this
    // deliberately slow operation — silenced above, not asserted.)
    expect(result.duration).toBeGreaterThanOrEqual(10);
  });

  it('returns failure with the last error, measured duration, and warns (never console.log) between retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await monitor.checkOperation(
      'unit-fail',
      async () => {
        await new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), 10));
      },
      { retries: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.result).toBeUndefined();
    expect(result.error?.message).toBe('boom');
    // Two ~10ms attempts: the duration spans the whole retry loop.
    expect(result.duration).toBeGreaterThanOrEqual(15);
    expect(warn).toHaveBeenCalledWith('Retrying operation unit-fail (attempt 2)');
    expect(log).not.toHaveBeenCalled();
  });
});
