// Display formatters rendered their raw arithmetic on bad input instead
// of a degraded state, so a value the app could not read reached the page
// as "Invalid Date" / "NaN undefined" / "NaNd NaNh" / "NaN%" / "-5s".
//
// Every source here is genuinely reachable with junk: an unparseable or
// empty timestamp string from a row or a payload, and a negative / NaN
// size or duration from a byte count the server could not compute (the
// ops storage section already reports mainDbBytes: null for that, and the
// uninstall preview reports a missing size as unknown — but a NaN that
// slips past a type guard still landed on the page verbatim).
//
// The rule: absence and nonsense render an explicit placeholder. Zero and
// legitimate values are untouched.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDuration,
  formatFileSize,
  formatPercentage,
  formatRelativeTime,
} from '@/utils/format';

afterEach(() => {
  vi.useRealTimers();
});

describe('degenerate input renders a placeholder, never NaN/Invalid', () => {
  it('formatRelativeTime refuses to print "Invalid Date"', () => {
    expect(formatRelativeTime('not-a-date')).toBe('—');
    expect(formatRelativeTime('')).toBe('—');
    expect(formatRelativeTime(NaN)).toBe('—');
    expect(formatRelativeTime(new Date('nope'))).toBe('—');
  });

  it('formatRelativeTime still formats real timestamps', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(formatRelativeTime('2026-10-01T11:59:30.000Z')).toBe('just now');
    expect(formatRelativeTime('2026-10-01T11:30:00.000Z')).toBe('30 min ago');
    expect(formatRelativeTime('2026-10-01T09:00:00.000Z')).toBe('3 hours ago');
    expect(formatRelativeTime('2026-09-29T12:00:00.000Z')).toBe('2 days ago');
    // A timestamp in the future must not claim "just now".
    expect(formatRelativeTime('2026-10-01T13:30:00.000Z')).toBe('in 1h 30m');
  });

  it('formatFileSize degrades a negative or NaN byte count', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(-1)).toBe('—');
    expect(formatFileSize(NaN)).toBe('—');
  });

  it('formatDuration degrades a negative or NaN duration', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
  });

  it('formatPercentage degrades a non-finite ratio', () => {
    expect(formatPercentage(12.345)).toBe('12.35%');
    expect(formatPercentage(NaN)).toBe('—');
    expect(formatPercentage(Infinity)).toBe('—');
  });
});
