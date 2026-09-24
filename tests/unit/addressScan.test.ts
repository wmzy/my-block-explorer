// parseScanJob / scanJobFromTxPayload unit tests: the narrow pure guard
// the Deep Scan panel trusts for BOTH wire sources (the scan endpoint's
// {job} envelope and the additive deepScan field on the transactions
// payload). A malformed job must degrade to null — never throw, never
// half-parse — so a legacy or junk payload renders the panel's fallback
// states instead of crashing the transactions tab.
//
// catchupScanJob tests pin the imperative helper's wire behavior against
// the pinned catch-up contract: the flat-DTO 202 the backend's own route
// tests freeze, both 400 discriminators (invalid_state / already_caught_up
// via ApiError.code), the 404-resolves-null vanish semantics, and the
// admin-gate 403 that the panel decorates with its token hint.
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ApiError } from '@/util/apiError';
import {
  catchupScanJob,
  parseScanJob,
  scanJobFromTxPayload,
  type ScanJob,
} from '@/services/addressScan';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

// Only the network edge is replaced (deepScanPanel.test.tsx's mock
// shape); `api` needs a pipe() stub because the service derives its
// scanApi chain at module level. Rejections are constructed as ApiError
// exactly the way the real scanError mapper would surface them.
vi.mock('@/util/http', () => ({
  get: vi.fn(),
  post: (...args: unknown[]) => mocks.post(...args),
  del: vi.fn(),
  api: { pipe: () => ({}) },
  withSignal: (o: unknown) => o,
}));

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

describe('catchupScanJob', () => {
  const CHAIN_ID = 1;
  const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
  const CATCHUP_URL = `/api/chains/${CHAIN_ID}/addresses/${ADDRESS}/scan/catchup`;

  beforeEach(() => {
    mocks.post.mockReset();
  });

  it('202 → resolves the updated job, parsing the AWAITED body (flat DTO, the shape the route tests pin)', async () => {
    // The backend answers c.json(toScanJobDto(row)) — a flat DTO, no
    // wrapper. An unawaited post (the wave-3 bug class) would hand the
    // parser a Promise and reject with 'Malformed scan job response'.
    const updated: ScanJob = {
      ...validJob,
      status: 'pending',
      toBlock: 21_000_000,
      blocksTotal: 21_000_001,
      blocksWalked: 1_234_568,
    };
    mocks.post.mockResolvedValue(updated);

    await expect(catchupScanJob(CHAIN_ID, ADDRESS)).resolves.toEqual(updated);
    expect(mocks.post).toHaveBeenCalledWith(CATCHUP_URL, {}, expect.anything());
  });

  it('still parses the {job}-wrapped envelope the first frontend tests froze', async () => {
    mocks.post.mockResolvedValue({ job: validJob });
    await expect(catchupScanJob(CHAIN_ID, ADDRESS)).resolves.toEqual(validJob);
  });

  it('rejects a malformed 202 body loudly instead of rendering a lie', async () => {
    mocks.post.mockResolvedValue({ status: 'running' });
    await expect(catchupScanJob(CHAIN_ID, ADDRESS)).rejects.toMatchObject({
      message: 'Malformed scan job response',
      status: 0,
    });
  });

  it('400 invalid_state → rejects with the backend message verbatim and its discriminator code', async () => {
    mocks.post.mockRejectedValue(
      new ApiError('Scan is running — wait for it to finish or pause it first', 400, 'invalid_state'),
    );
    await expect(catchupScanJob(CHAIN_ID, ADDRESS)).rejects.toMatchObject({
      message: 'Scan is running — wait for it to finish or pause it first',
      status: 400,
      code: 'invalid_state',
    });
  });

  it('400 already_caught_up → rejects with the already_caught_up code (a notice upstream, not an error)', async () => {
    mocks.post.mockRejectedValue(
      new ApiError('Scan is already at the chain head', 400, 'already_caught_up'),
    );
    await expect(catchupScanJob(CHAIN_ID, ADDRESS)).rejects.toMatchObject({
      message: 'Scan is already at the chain head',
      status: 400,
      code: 'already_caught_up',
    });
  });

  it('404 no_scan_job → resolves null (the job vanished; the caller refetches)', async () => {
    mocks.post.mockRejectedValue(new ApiError('no_scan_job', 404, 'no_scan_job'));
    await expect(catchupScanJob(CHAIN_ID, ADDRESS)).resolves.toBeNull();
  });

  it('403 admin-gated → rejects with the ApiError the panel decorates with its token hint', async () => {
    mocks.post.mockRejectedValue(new ApiError('Invalid admin token.', 403));
    await expect(catchupScanJob(CHAIN_ID, ADDRESS)).rejects.toMatchObject({
      message: 'Invalid admin token.',
      status: 403,
    });
  });
});
