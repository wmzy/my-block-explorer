/**
 * Pure deep-scan helpers: bounds validation (tags, ordering, negatives,
 * the includeTraces opt-in), conflict/force decision table, catch-up
 * decision table (status × head), checkpoint math (cursor advance,
 * blocksWalked/blocksTotal), coverage derivation (genesis-only), the
 * job DTO mapping (incl. the additive traces* fields), the trace-frame
 * flattening for internal transactions, and the heuristic ∪ findings
 * merge.
 */

import { describe, it, expect, vi } from 'vitest';

// AddressService's module graph touches db/rpc — none of it runs for the
// pure merge function, but the module-level singleton needs the imports
// to resolve. Shallow mocks keep this test file free of DuckDB/RPC.
vi.mock('@/database/init', () => ({ db: {}, indexedAddresses: {} }));
vi.mock('@/services/RpcManager', () => ({ rpcManager: {} }));
vi.mock('@/services/ContractSourceService', () => ({ contractSourceService: {} }));

import {
  computeBlocksTotal,
  computeBlocksWalked,
  decideScanJobCreation,
  deriveScanCoverage,
  flattenTraceFramesForAddress,
  initialCursorBlock,
  planCatchup,
  toScanJobDto,
  validateScanJobBody,
} from '@/services/AddressScanService';
import { normalizeCallTrace } from '@/utils/traceFormat';
import type { CallTraceNode } from '@/utils/traceFormat';
import type { AddressScanJobRecord } from '@/database/schema';
import { mergeDiscoveredTransactions } from '@/services/AddressService';
import type { DiscoveredTransaction } from '@/services/AddressService';

describe('validateScanJobBody', () => {
  it('defaults to earliest..latest with force false and includeTraces false', () => {
    expect(validateScanJobBody({})).toEqual({
      ok: true,
      fromBlock: 'earliest',
      toBlock: 'latest',
      force: false,
      includeTraces: false,
    });
    expect(validateScanJobBody(undefined)).toEqual(
      validateScanJobBody({}),
    );
  });

  it('accepts explicit non-negative integer bounds and boolean force', () => {
    expect(validateScanJobBody({ fromBlock: 100, toBlock: 900, force: true })).toEqual({
      ok: true,
      fromBlock: 100,
      toBlock: 900,
      force: true,
      includeTraces: false,
    });
    expect(validateScanJobBody({ fromBlock: 0, toBlock: 0 })).toEqual({
      ok: true,
      fromBlock: 0,
      toBlock: 0,
      force: false,
      includeTraces: false,
    });
  });

  it('accepts boolean includeTraces and defaults it to false when absent', () => {
    expect(validateScanJobBody({ includeTraces: true })).toMatchObject({
      ok: true,
      includeTraces: true,
    });
    expect(validateScanJobBody({ fromBlock: 5, toBlock: 10 })).toMatchObject({
      ok: true,
      includeTraces: false,
    });
  });

  it('rejects non-boolean includeTraces', () => {
    expect(validateScanJobBody({ includeTraces: 'yes' })).toMatchObject({ ok: false });
    expect(validateScanJobBody({ includeTraces: 1 })).toMatchObject({ ok: false });
    expect(validateScanJobBody({ includeTraces: null })).toMatchObject({ ok: false });
  });

  it('rejects unknown tags (including event-range tags)', () => {
    for (const bad of ['finalized', 'safe', 'head', 'latest', 'foo']) {
      const result = validateScanJobBody({ fromBlock: bad });
      expect(result).toMatchObject({ ok: false });
    }
    for (const bad of ['finalized', 'safe', 'earliest', 'pending', '']) {
      const result = validateScanJobBody({ toBlock: bad });
      expect(result).toMatchObject({ ok: false });
    }
  });

  it('rejects negative, fractional, and non-numeric bounds', () => {
    expect(validateScanJobBody({ fromBlock: -1 })).toMatchObject({ ok: false });
    expect(validateScanJobBody({ toBlock: 1.5 })).toMatchObject({ ok: false });
    expect(validateScanJobBody({ fromBlock: '12' })).toMatchObject({ ok: false });
    expect(validateScanJobBody({ toBlock: true })).toMatchObject({ ok: false });
  });

  it('rejects non-boolean force', () => {
    expect(validateScanJobBody({ force: 'yes' })).toMatchObject({ ok: false });
    expect(validateScanJobBody({ force: 1 })).toMatchObject({ ok: false });
  });

  it('rejects from after to on every comparable combination', () => {
    expect(validateScanJobBody({ fromBlock: 10, toBlock: 5 })).toMatchObject({ ok: false });
    // latest (head) before earliest (0) is an inverted range
    expect(validateScanJobBody({ fromBlock: 'latest', toBlock: 'earliest' })).toMatchObject({
      ok: false,
    });
    expect(validateScanJobBody({ fromBlock: 5, toBlock: 'earliest' })).toMatchObject({
      ok: false,
    });
  });

  it('accepts the tag-edge orderings that are well-formed', () => {
    expect(validateScanJobBody({ fromBlock: 'earliest', toBlock: 0 })).toMatchObject({ ok: true });
    expect(validateScanJobBody({ fromBlock: 0, toBlock: 'latest' })).toMatchObject({ ok: true });
    expect(validateScanJobBody({ fromBlock: 'earliest', toBlock: 'latest' })).toMatchObject({
      ok: true,
    });
  });
});

describe('decideScanJobCreation — conflict/force semantics', () => {
  const existing = { fromBlock: 0, toBlock: 1000 };

  it('creates when no job exists', () => {
    expect(decideScanJobCreation(null, { fromBlock: 0, toBlock: 500 }, false)).toEqual({
      action: 'create',
    });
    expect(decideScanJobCreation(null, { fromBlock: 0, toBlock: 500 }, true)).toEqual({
      action: 'create',
    });
  });

  it('is idempotent on equal resolved bounds without force', () => {
    expect(decideScanJobCreation(existing, { fromBlock: 0, toBlock: 1000 }, false)).toEqual({
      action: 'idempotent',
    });
  });

  it('conflicts on different bounds without force', () => {
    const decision = decideScanJobCreation(existing, { fromBlock: 10, toBlock: 1000 }, false);
    expect(decision.action).toBe('conflict');
    if (decision.action === 'conflict') {
      expect(decision.message).toContain('force');
      expect(decision.message).toContain('[0..1000]');
    }
  });

  it('replaces on force regardless of bounds equality', () => {
    expect(decideScanJobCreation(existing, { fromBlock: 10, toBlock: 500 }, true)).toEqual({
      action: 'replace',
    });
    expect(decideScanJobCreation(existing, { fromBlock: 0, toBlock: 1000 }, true)).toEqual({
      action: 'replace',
    });
  });
});

describe('planCatchup — catch-up decision table', () => {
  it('rejects a running walk first, regardless of the head relation', () => {
    // The running check precedes the head comparison on every
    // combination — extending bounds under a live loop is unsafe even
    // when the head has not moved.
    for (const head of [500, 1000, 1500]) {
      expect(planCatchup({ status: 'running', toBlock: 1000 }, head)).toEqual({
        action: 'invalid-state',
        message: 'Scan is running — wait for it to finish or pause it first',
      });
    }
  });

  it('extends every settled status to the head when the chain moved on', () => {
    for (const status of ['pending', 'paused', 'error', 'complete'] as const) {
      expect(planCatchup({ status, toBlock: 1000 }, 1500)).toEqual({
        action: 'extend',
        toBlock: 1500,
      });
    }
  });

  it('is already caught up at an equal head (no extension, any settled status)', () => {
    for (const status of ['pending', 'paused', 'error', 'complete'] as const) {
      expect(planCatchup({ status, toBlock: 1000 }, 1000)).toEqual({
        action: 'already-caught-up',
      });
    }
  });

  it('is already caught up when the head sits below the stored bound (reorg aside)', () => {
    expect(planCatchup({ status: 'complete', toBlock: 1000 }, 999)).toEqual({
      action: 'already-caught-up',
    });
    expect(planCatchup({ status: 'paused', toBlock: 1000 }, 0)).toEqual({
      action: 'already-caught-up',
    });
  });
});

describe('checkpoint math', () => {
  it('initial cursor is one below fromBlock (nothing verified yet)', () => {
    expect(initialCursorBlock(0)).toBe(-1);
    expect(initialCursorBlock(12345)).toBe(12344);
  });

  it('blocksWalked derives from the contiguous cursor', () => {
    expect(computeBlocksWalked(0, -1)).toBe(0);
    expect(computeBlocksWalked(0, 0)).toBe(1);
    expect(computeBlocksWalked(100, 350)).toBe(251);
  });

  it('blocksTotal is the inclusive span', () => {
    expect(computeBlocksTotal(0, 0)).toBe(1);
    expect(computeBlocksTotal(0, 999)).toBe(1000);
    expect(computeBlocksTotal(100, 350)).toBe(251);
  });
});

describe('deriveScanCoverage — genesis anchor only', () => {
  it('is \'complete\' only for a finished walk anchored at block 0', () => {
    expect(deriveScanCoverage('complete', 0)).toBe('complete');
  });

  it('stays null for every other status, even at genesis', () => {
    expect(deriveScanCoverage('running', 0)).toBeNull();
    expect(deriveScanCoverage('paused', 0)).toBeNull();
    expect(deriveScanCoverage('error', 0)).toBeNull();
    expect(deriveScanCoverage('pending', 0)).toBeNull();
  });

  it('stays null for finished walks that are not genesis-anchored', () => {
    expect(deriveScanCoverage('complete', 1)).toBeNull();
    expect(deriveScanCoverage('complete', 892_000)).toBeNull();
  });
});

describe('toScanJobDto', () => {
  const row = (overrides: Partial<AddressScanJobRecord>): AddressScanJobRecord => ({
    chainId: 1,
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    fromBlock: 0n,
    toBlock: 1000n,
    cursorBlock: 399n,
    status: 'running',
    txsFound: 2,
    tracesRequested: false,
    tracesSupported: null,
    tracesRecorded: 0,
    errorMessage: null,
    updatedAt: new Date('2026-09-24T00:00:00.000Z'),
    ...overrides,
  });

  it('maps every pinned field with derived progress and coverage', () => {
    expect(toScanJobDto(row({}))).toEqual({
      status: 'running',
      fromBlock: 0,
      toBlock: 1000,
      cursorBlock: 399,
      blocksWalked: 400,
      blocksTotal: 1001,
      txsFound: 2,
      tracesRequested: false,
      tracesSupported: null,
      tracesRecorded: 0,
      errorMessage: null,
      coverage: null,
      updatedAt: '2026-09-24T00:00:00.000Z',
    });
  });

  it('normalizes storage-null traces* fields to the additive DTO defaults', () => {
    // Pre-migration rows (and DuckDB's constraint-free ADD COLUMN) read
    // back null — the DTO contract pins false / null (not yet probed) / 0.
    const dto = toScanJobDto(
      row({ tracesRequested: null, tracesSupported: null, tracesRecorded: null }),
    );
    expect(dto.tracesRequested).toBe(false);
    expect(dto.tracesSupported).toBeNull();
    expect(dto.tracesRecorded).toBe(0);
  });

  it('carries recorded trace state through unchanged', () => {
    const dto = toScanJobDto(
      row({ tracesRequested: true, tracesSupported: true, tracesRecorded: 7 }),
    );
    expect(dto.tracesRequested).toBe(true);
    expect(dto.tracesSupported).toBe(true);
    expect(dto.tracesRecorded).toBe(7);
  });

  it('reports zero walked for a job that has not started (cursor from-1)', () => {
    const dto = toScanJobDto(row({ cursorBlock: -1n, status: 'pending' }));
    expect(dto.blocksWalked).toBe(0);
    expect(dto.cursorBlock).toBe(-1);
  });

  it('derives complete coverage only for the genesis-anchored finish', () => {
    expect(toScanJobDto(row({ status: 'complete', cursorBlock: 1000n })).coverage).toBe(
      'complete',
    );
    expect(
      toScanJobDto(row({ status: 'complete', cursorBlock: 1000n, fromBlock: 50n, toBlock: 1000n }))
        .coverage,
    ).toBeNull();
  });

  it('carries the verbatim error message', () => {
    expect(
      toScanJobDto(row({ status: 'error', errorMessage: 'historical state not available' }))
        .errorMessage,
    ).toBe('historical state not available');
  });
});

describe('flattenTraceFramesForAddress', () => {
  // Mixed-case scanned address: matching is case-insensitive, and frames
  // below match via lowercase to's AND a checksummed from.
  const SCANNED = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
  const scannedLower = SCANNED.toLowerCase();
  const OTHER_A = `0x${'11'.repeat(20)}`;
  const OTHER_B = `0x${'22'.repeat(20)}`;
  const OTHER_C = `0x${'33'.repeat(20)}`;
  const OTHER_D = `0x${'44'.repeat(20)}`;

  const rawFrame = (
    type: string,
    from: string,
    to: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({ type, from, to, gas: '0x1', gasUsed: '0x1', ...extra });

  // Raw Geth-style payload normalized through the REAL normalizer, so
  // depths are computed exactly as the walk sees them.
  const tree = normalizeCallTrace({
    // depth 0 — the external transaction itself: involves the scanned
    // address with value, but the root is never a recorded frame.
    type: 'CALL',
    from: OTHER_A,
    to: SCANNED,
    value: '0x5',
    calls: [
      // [0] kept: to-side lowercase match, value-carrying, reverted.
      rawFrame('CALL', OTHER_A, scannedLower, {
        value: '0x3',
        error: 'execution reverted',
      }),
      // [1] dropped: CREATE is not a recorded call type — but its
      // subtree still walks, and its STATICCALL child to the scanned
      // address IS kept (value unreported → honest 0n).
      {
        type: 'CREATE',
        from: SCANNED,
        to: OTHER_B,
        value: '0x1',
        init: '0x6000',
        calls: [rawFrame('STATICCALL', OTHER_C, scannedLower)],
      },
      // [2] dropped: SELFDESTRUCT involves the address but is not a call.
      { type: 'SELFDESTRUCT', from: SCANNED, to: OTHER_B },
      // [3] dropped: a CALL between two OTHER addresses — value alone is
      // not the deep-scan filter; its child still keeps a path slot.
      rawFrame('CALL', OTHER_C, OTHER_D, {
        value: '0x9',
        calls: [rawFrame('CALLCODE', SCANNED, OTHER_B, { value: '0x2' })],
      }),
    ],
  }) as CallTraceNode;

  it('keeps depth>=1 address-matching call-type frames with positional tracePaths', () => {
    expect(flattenTraceFramesForAddress(tree, SCANNED, 7)).toEqual([
      {
        tracePath: '0',
        from: OTHER_A,
        to: scannedLower,
        value: 3n,
        callType: 'call',
        reverted: true,
        transactionIndex: 7,
      },
      {
        tracePath: '1.0',
        from: OTHER_C,
        to: scannedLower,
        value: 0n,
        callType: 'staticcall',
        reverted: false,
        transactionIndex: 7,
      },
      {
        tracePath: '3.0',
        from: SCANNED,
        to: OTHER_B,
        value: 2n,
        callType: 'callcode',
        reverted: false,
        transactionIndex: 7,
      },
    ]);
  });

  it('matches case-insensitively on both from and to sides', () => {
    const frames = flattenTraceFramesForAddress(tree, scannedLower, 7);
    // '0' matched via lowercase to; '3.0' matched via the checksummed
    // from — both survive the lowercase-scan variant of the address.
    expect(frames.map(f => f.tracePath)).toEqual(['0', '1.0', '3.0']);
  });

  it('never emits the root frame even when it involves the address', () => {
    const rootOnly = normalizeCallTrace(
      rawFrame('CALL', OTHER_A, SCANNED, { value: '0x5' }),
    ) as CallTraceNode;
    expect(flattenTraceFramesForAddress(rootOnly, SCANNED, 0)).toEqual([]);
  });

  it('returns [] when no frame involves the address', () => {
    const unrelated = normalizeCallTrace({
      type: 'CALL',
      from: OTHER_A,
      to: OTHER_B,
      value: '0x1',
      calls: [rawFrame('DELEGATECALL', OTHER_C, OTHER_D, { value: '0x2' })],
    }) as CallTraceNode;
    expect(flattenTraceFramesForAddress(unrelated, SCANNED, 3)).toEqual([]);
  });

  it('marks a frame reverted when it carries a revertReason instead of an error', () => {
    const reverted = normalizeCallTrace({
      type: 'CALL',
      from: OTHER_A,
      to: OTHER_B,
      calls: [rawFrame('DELEGATECALL', SCANNED, OTHER_B, { revertReason: '0x08c379a0' })],
    }) as CallTraceNode;
    const [frame] = flattenTraceFramesForAddress(reverted, scannedLower, 0);
    expect(frame?.reverted).toBe(true);
    expect(frame?.callType).toBe('delegatecall');
    expect(frame?.transactionIndex).toBe(0);
  });
});

describe('mergeDiscoveredTransactions', () => {
  const tx = (hash: string, blockNumber: number): DiscoveredTransaction => ({
    hash,
    blockNumber: BigInt(blockNumber),
    fromAddress: '0xfrom',
    toAddress: '0xto',
    value: '1',
    timestamp: '2026-09-24T00:00:00.000Z',
  });

  it('returns the heuristic list untouched when there are no findings', () => {
    const heuristic = [tx('0xa', 5), tx('0xb', 3)];
    expect(mergeDiscoveredTransactions(heuristic, [])).toEqual(heuristic);
  });

  it('unions and dedupes by hash with the heuristic entry winning', () => {
    const heuristic = [tx('0xa', 5), tx('0xb', 3)];
    const findings = [tx('0xA', 5), tx('0xc', 9)];
    const merged = mergeDiscoveredTransactions(heuristic, findings);
    // Sorted by block desc: 0xc(9), 0xa(5), 0xb(3); the case-variant
    // duplicate 0xA dedupes into the heuristic's 0xa entry.
    expect(merged.map(t => t.hash)).toEqual(['0xc', '0xa', '0xb']);
    expect(merged.length).toBe(3);
  });

  it('sorts by blockNumber descending regardless of input order', () => {
    const merged = mergeDiscoveredTransactions(
      [tx('0x2', 10)],
      [tx('0x9', 900), tx('0x1', 3)],
    );
    expect(merged.map(t => t.hash)).toEqual(['0x9', '0x2', '0x1']);
  });

  it('serves findings alone when the heuristic found nothing', () => {
    const findings = [tx('0xf1', 7), tx('0xf2', 12)];
    const merged = mergeDiscoveredTransactions([], findings);
    expect(merged.map(t => t.hash)).toEqual(['0xf2', '0xf1']);
    expect(merged.length).toBe(2);
  });
});
