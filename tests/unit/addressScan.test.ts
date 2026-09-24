// parseScanJob / scanJobFromTxPayload unit tests: the narrow pure guard
// the Deep Scan panel trusts for BOTH wire sources (the scan endpoint's
// {job} envelope and the additive deepScan field on the transactions
// payload). A malformed job must degrade to null — never throw, never
// half-parse — so a legacy or junk payload renders the panel's fallback
// states instead of crashing the transactions tab.
import { describe, it, expect } from 'vitest';

import {
  parseScanJob,
  scanJobFromTxPayload,
  type ScanJob,
} from '@/services/addressScan';

// Verbatim contract shape: every field present, coverage null (the
// honest default — only a finished genesis-anchored walk may read
// 'complete').
const validJob: ScanJob = {
  status: 'running',
  fromBlock: 0,
  toBlock: 20_000_000,
  cursorBlock: 1_234_567,
  blocksWalked: 1_234_568,
  blocksTotal: 20_000_001,
  txsFound: 42,
  errorMessage: null,
  coverage: null,
  updatedAt: '2026-09-24T00:00:00.000Z',
};

describe('parseScanJob', () => {
  it('accepts the verbatim contract shape', () => {
    expect(parseScanJob(validJob)).toEqual(validJob);
  });

  it('accepts the complete genesis-anchored walk', () => {
    const complete = {
      ...validJob,
      status: 'complete',
      cursorBlock: 20_000_000,
      blocksWalked: 20_000_001,
      txsFound: 42,
      errorMessage: null,
      coverage: 'complete' as const,
    };
    expect(parseScanJob(complete)).toEqual(complete);
  });

  it('accepts every job status in the contract vocabulary', () => {
    for (const status of ['pending', 'running', 'paused', 'error', 'complete'] as const) {
      expect(parseScanJob({ ...validJob, status })?.status).toBe(status);
    }
  });

  it('rejects an unknown status', () => {
    expect(parseScanJob({ ...validJob, status: 'finished' })).toBeNull();
    expect(parseScanJob({ ...validJob, status: 'RUNNING' })).toBeNull();
    expect(parseScanJob({ ...validJob, status: null })).toBeNull();
  });

  it('rejects missing fields', () => {
    const { status: _status, ...withoutStatus } = validJob;
    expect(parseScanJob(withoutStatus)).toBeNull();

    const { blocksWalked: _blocksWalked, ...withoutWalked } = validJob;
    expect(parseScanJob(withoutWalked)).toBeNull();

    const { updatedAt: _updatedAt, ...withoutUpdatedAt } = validJob;
    expect(parseScanJob(withoutUpdatedAt)).toBeNull();
  });

  it('rejects non-numeric or negative bounds', () => {
    expect(parseScanJob({ ...validJob, fromBlock: '0' })).toBeNull();
    expect(parseScanJob({ ...validJob, toBlock: -1 })).toBeNull();
    expect(parseScanJob({ ...validJob, blocksWalked: 1.5 })).toBeNull();
    expect(parseScanJob({ ...validJob, txsFound: Number.NaN })).toBeNull();
    expect(parseScanJob({ ...validJob, cursorBlock: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('rejects malformed errorMessage, coverage and updatedAt', () => {
    // Nested junk in a string slot must not half-parse.
    expect(parseScanJob({ ...validJob, errorMessage: { deep: true } })).toBeNull();
    expect(parseScanJob({ ...validJob, errorMessage: ['timeout'] })).toBeNull();
    // coverage admits exactly 'complete' | null.
    expect(parseScanJob({ ...validJob, coverage: 'partial' })).toBeNull();
    expect(parseScanJob({ ...validJob, coverage: undefined })).toBeNull();
    expect(parseScanJob({ ...validJob, updatedAt: '' })).toBeNull();
    expect(parseScanJob({ ...validJob, updatedAt: 123 })).toBeNull();
  });

  it('rejects non-object payloads without throwing', () => {
    for (const junk of [undefined, null, 'running', 42, [], () => undefined]) {
      expect(parseScanJob(junk)).toBeNull();
    }
  });
});

describe('scanJobFromTxPayload', () => {
  it('reads the additive deepScan field off a transactions payload', () => {
    const payload = {
      transactions: [],
      total: 0,
      coverage: 'partial' as const,
      deepScan: validJob,
    };
    expect(scanJobFromTxPayload(payload)).toEqual(validJob);
  });

  it('returns null for legacy payloads without the field (byte-identical path)', () => {
    expect(scanJobFromTxPayload({ transactions: [], total: 0 })).toBeNull();
    expect(scanJobFromTxPayload(undefined)).toBeNull();
    expect(scanJobFromTxPayload(null)).toBeNull();
  });

  it('degrades junk in the field to null, never throws', () => {
    expect(scanJobFromTxPayload({ deepScan: 'running' })).toBeNull();
    expect(scanJobFromTxPayload({ deepScan: { status: 'running' } })).toBeNull();
    expect(scanJobFromTxPayload({ deepScan: { ...validJob, status: 'weird' } })).toBeNull();
  });
});
