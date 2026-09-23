// Focused tests for the Address Overview's summary stats PURE module
// (src/views/Address/summaryStats.ts). The stats are over the CURRENT
// WINDOW's discovered set — the tests pin that honesty contract: missing
// timestamps stay undefined (block fallback), creation rows count on
// neither side, and values stay BigInt-exact past
// Number.MAX_SAFE_INTEGER. Rendering behavior lives in
// addressSummaryStatsRow.test.tsx.
import { describe, it, expect } from 'vitest';
import {
  computeAddressSummaryStats,
  formatNativeTotal,
  formatSeenBoundary,
  type SummaryTxRow,
} from '@/views/Address/summaryStats';

const ADDRESS = '0xAbCdEf0123456789012345678901234567890123';
const OTHER = '0x1111111111111111111111111111111111111111';
const CREATOR = '0x2222222222222222222222222222222222222222';

const row = (overrides: Partial<SummaryTxRow>): SummaryTxRow => ({
  blockNumber: 100,
  fromAddress: OTHER,
  toAddress: ADDRESS,
  value: '0',
  ...overrides,
});

// Deterministic case-swap helper: flips the hex case so the
// case-insensitivity tests cannot accidentally pass on identical strings.
function otherCase(address: string): string {
  return address
    .split('')
    .map(ch => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
    .join('');
}

describe('computeAddressSummaryStats', () => {
  it('returns null boundaries, zero totals and zero count for an empty set', () => {
    expect(computeAddressSummaryStats([], ADDRESS)).toEqual({
      firstSeen: null,
      lastSeen: null,
      totalIn: 0n,
      totalOut: 0n,
      txCount: 0,
    });
  });

  it('sums a single incoming row into totalIn only', () => {
    const stats = computeAddressSummaryStats(
      [row({ blockNumber: 42, value: '1500000000000000000' })],
      ADDRESS,
    );
    expect(stats.totalIn).toBe(1500000000000000000n);
    expect(stats.totalOut).toBe(0n);
    expect(stats.txCount).toBe(1);
    expect(stats.firstSeen).toEqual({ blockNumber: 42 });
    expect(stats.lastSeen).toEqual({ blockNumber: 42 });
  });

  it('sums a single outgoing row into totalOut only', () => {
    const stats = computeAddressSummaryStats(
      [row({ blockNumber: 42, fromAddress: ADDRESS, toAddress: OTHER, value: '7' })],
      ADDRESS,
    );
    expect(stats.totalIn).toBe(0n);
    expect(stats.totalOut).toBe(7n);
  });

  it('aggregates a mixed set and takes min/max blocks as boundaries', () => {
    const stats = computeAddressSummaryStats(
      [
        row({ blockNumber: 200, fromAddress: ADDRESS, toAddress: OTHER, value: '10' }),
        row({ blockNumber: 50, value: '5' }),
        row({ blockNumber: 120, fromAddress: ADDRESS, toAddress: OTHER, value: '2' }),
      ],
      ADDRESS,
    );
    expect(stats.totalIn).toBe(5n);
    expect(stats.totalOut).toBe(12n);
    expect(stats.txCount).toBe(3);
    expect(stats.firstSeen?.blockNumber).toBe(50);
    expect(stats.lastSeen?.blockNumber).toBe(200);
  });

  it('breaks same-block ties stably: the first row in input order wins', () => {
    const stats = computeAddressSummaryStats(
      [
        row({ blockNumber: 77, value: '1', timestamp: '2024-05-05T00:00:00Z' }),
        row({ blockNumber: 77, value: '2', timestamp: '2024-05-05T09:00:00Z' }),
      ],
      ADDRESS,
    );
    // Boundaries come from the FIRST row on the tie — including its
    // timestamp, never the later row's.
    expect(stats.firstSeen).toEqual({
      blockNumber: 77,
      timestamp: Date.parse('2024-05-05T00:00:00Z'),
    });
    expect(stats.lastSeen).toEqual({
      blockNumber: 77,
      timestamp: Date.parse('2024-05-05T00:00:00Z'),
    });
    // The tie never leaks into the totals: both rows still count.
    expect(stats.totalIn).toBe(3n);
  });

  it('counts contract-creation rows (null or empty to) on neither side', () => {
    const stats = computeAddressSummaryStats(
      [
        row({ blockNumber: 10, fromAddress: CREATOR, toAddress: null, value: '99' }),
        row({ blockNumber: 11, fromAddress: CREATOR, toAddress: '', value: '98' }),
        // A creation FROM the viewed address is outgoing (its value left);
        // a null/empty recipient simply never credits totalIn.
        row({ blockNumber: 12, fromAddress: ADDRESS, toAddress: null, value: '1' }),
      ],
      ADDRESS,
    );
    expect(stats.totalIn).toBe(0n);
    expect(stats.totalOut).toBe(1n);
    expect(stats.txCount).toBe(3);
  });

  it('counts a self-transfer on both sides (sent and received)', () => {
    const stats = computeAddressSummaryStats(
      [row({ blockNumber: 30, fromAddress: ADDRESS, toAddress: ADDRESS, value: '5' })],
      ADDRESS,
    );
    expect(stats.totalIn).toBe(5n);
    expect(stats.totalOut).toBe(5n);
  });

  it('matches addresses case-insensitively', () => {
    const stats = computeAddressSummaryStats(
      [
        // A case-swapped self-transfer: both sides match the viewed
        // address despite none of the three strings being identical.
        row({ fromAddress: ADDRESS.toUpperCase(), toAddress: otherCase(ADDRESS), value: '3' }),
        row({ fromAddress: OTHER, toAddress: ADDRESS.toLowerCase(), value: '4' }),
      ],
      ADDRESS,
    );
    expect(stats.totalIn).toBe(7n);
    expect(stats.totalOut).toBe(3n);
  });

  it('keeps totals BigInt-exact beyond Number.MAX_SAFE_INTEGER', () => {
    // 2^60 + 1 twice: any Number coercion would lose the +2.
    const huge = 2n ** 60n + 1n;
    const stats = computeAddressSummaryStats(
      [
        row({ blockNumber: 1, value: huge.toString() }),
        row({ blockNumber: 2, value: huge }),
      ],
      ADDRESS,
    );
    expect(stats.totalIn).toBe(huge * 2n);
    expect(stats.totalOut).toBe(0n);
    expect(stats.totalIn).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it('carries a parseable row timestamp as epoch ms and drops an unparsable one', () => {
    const stats = computeAddressSummaryStats(
      [
        row({ blockNumber: 5, timestamp: '2024-01-01T00:00:00Z' }),
        row({ blockNumber: 6, timestamp: 'not-a-date' }),
      ],
      ADDRESS,
    );
    expect(stats.firstSeen?.timestamp).toBe(Date.parse('2024-01-01T00:00:00Z'));
    // Unparsable stays undefined — never NaN and never a fabricated epoch.
    expect(stats.lastSeen?.timestamp).toBeUndefined();
  });
});

describe('formatNativeTotal', () => {
  it('renders zero exactly and floors sub-4-decimal dust', () => {
    expect(formatNativeTotal(0n, 18, 'ETH')).toBe('0 ETH');
    expect(formatNativeTotal(99_999_999_999_999n, 18, 'ETH')).toBe('<0.0001 ETH');
  });

  it('renders 4 decimals with grouped integer digits', () => {
    expect(formatNativeTotal(1_500_000_000_000_000_000n, 18, 'ETH')).toBe('1.5000 ETH');
    // 1234.567890123456789 ETH, wei-scaled.
    expect(formatNativeTotal(1_234_567_890_123_456_789_000n, 18, 'ETH')).toBe(
      '1,234.5678 ETH',
    );
  });

  it('uses the chain decimals — never a hardcoded 18', () => {
    // A 6-decimal native currency: 12.5 units is 12,500,000 base units.
    expect(formatNativeTotal(12_500_000n, 6, 'POL')).toBe('12.5000 POL');
    // Dust floor scales with the decimals too (10^(decimals-4) = 100).
    expect(formatNativeTotal(99n, 6, 'POL')).toBe('<0.0001 POL');
  });

  it('stays grouped past the range where Number formatting goes exponential', () => {
    // A 16-digit integer part (10^33 wei = 10^15 ETH): Number#toLocaleString
    // would flip to exponential notation; the string path keeps every digit.
    const value = 10n ** 33n + 500_000_000_000_000_000n;
    expect(formatNativeTotal(value, 18, 'ETH')).toBe(
      '1,000,000,000,000,000.5000 ETH',
    );
  });
});

describe('formatSeenBoundary', () => {
  const injected = (ms: number) => `@${ms}`;

  it('formats the date through the injected formatter', () => {
    expect(formatSeenBoundary({ blockNumber: 9, timestamp: 123_456 }, injected)).toBe(
      '@123456',
    );
  });

  it('falls back to the block number when no timestamp is known', () => {
    expect(formatSeenBoundary({ blockNumber: 1234567 }, injected)).toBe('Block 1,234,567');
  });
});
