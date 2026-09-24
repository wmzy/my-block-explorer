/**
 * Pure deep-scan helpers: bounds validation (tags, ordering, negatives),
 * conflict/force decision table, catch-up decision table (status × head),
 * checkpoint math (cursor advance, blocksWalked/blocksTotal), coverage
 * derivation (genesis-only), the job DTO mapping, and the heuristic ∪
 * findings merge.
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
  initialCursorBlock,
  planCatchup,
  toScanJobDto,
  validateScanJobBody,
} from '@/services/AddressScanService';
import type { AddressScanJobRecord } from '@/database/schema';
import { mergeDiscoveredTransactions } from '@/services/AddressService';
import type { DiscoveredTransaction } from '@/services/AddressService';

describe('validateScanJobBody', () => {
  it('defaults to earliest..latest with force false', () => {
    expect(validateScanJobBody({})).toEqual({
      ok: true,
      fromBlock: 'earliest',
      toBlock: 'latest',
      force: false,
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
    });
    expect(validateScanJobBody({ fromBlock: 0, toBlock: 0 })).toEqual({
      ok: true,
      fromBlock: 0,
      toBlock: 0,
      force: false,
    });
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
      errorMessage: null,
      coverage: null,
      updatedAt: '2026-09-24T00:00:00.000Z',
    });
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
