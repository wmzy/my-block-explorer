/**
 * Deep-scan route contract conformance: the five /scan endpoints (202
 * async start, 200 idempotent, 400 invalid_bounds / scan_conflict /
 * invalid_state / already_caught_up, 404 no_scan_job, 204 idempotent
 * delete), admin opt-in gating on writes, the shared 3/min burst-2 write
 * limiter, and the additive deepScan field on the transactions endpoint
 * (absent key when no job row exists — legacy responses byte-identical).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// Pure helpers stay real (bounds validation, DTO derivation); everything
// db/RPC-touching is scripted per test. A shallow db mock keeps the real
// module graph from opening DuckDB.
vi.mock('@/database/drizzle', () => ({ db: {} }));
vi.mock('@/services/AddressService', () => ({
  addressService: { getAddressTransactions: mocks.getAddressTransactions },
}));
vi.mock('@/services/RpcManager', () => ({ rpcManager: {} }));
vi.mock('@/services/ContractSourceService', () => ({ contractSourceService: {} }));
vi.mock('@/services/AddressScanService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/AddressScanService')>();
  return {
    ...actual,
    createOrReplaceScanJob: mocks.createOrReplaceScanJob,
    catchupScanJob: mocks.catchupScanJob,
    getScanJobRow: mocks.getScanJobRow,
    getScanFindings: mocks.getScanFindings,
    hydrateFindings: mocks.hydrateFindings,
    isScanJobActive: mocks.isScanJobActive,
    pauseScanJob: mocks.pauseScanJob,
    resumeScanJob: mocks.resumeScanJob,
    deleteScanJob: mocks.deleteScanJob,
  };
});

import addressesRoutes from '@/routes/addresses';
import { resetRateLimiterState } from '@/middleware/rate-limit';
import type { AddressScanJobRecord } from '@/database/schema';
import type { ScanJobDto } from '@/services/AddressScanService';
import type { AddressTransactionsResult } from '@/services/AddressService';

// All-digit address: viem's checksum leaves it byte-identical.
const ROUTE_ADDRESS = '0x1111111111111111111111111111111111111111';

const mocks = vi.hoisted(() => ({
  getAddressTransactions: vi.fn(),
  createOrReplaceScanJob: vi.fn(),
  catchupScanJob: vi.fn(),
  getScanJobRow: vi.fn(),
  getScanFindings: vi.fn(),
  hydrateFindings: vi.fn(),
  isScanJobActive: vi.fn(),
  pauseScanJob: vi.fn(),
  resumeScanJob: vi.fn(),
  deleteScanJob: vi.fn(),
}));

const app = new Hono();
app.route('/', addressesRoutes);

const jobRow = (overrides: Partial<AddressScanJobRecord>): AddressScanJobRecord => ({
  chainId: 1,
  address: ROUTE_ADDRESS,
  fromBlock: 0n,
  toBlock: 1000n,
  cursorBlock: 499n,
  status: 'running',
  txsFound: 0,
  errorMessage: null,
  updatedAt: new Date('2026-09-24T00:00:00.000Z'),
  ...overrides,
});

const txResult = (
  overrides: Partial<AddressTransactionsResult> = {},
): AddressTransactionsResult => ({
  transactions: [],
  total: 0,
  method: 'binary-search',
  coverage: 'partial',
  searchWindowBlocks: 10_000_000,
  ...overrides,
});

const scanPath = (suffix = '') =>
  `/chains/1/addresses/${ROUTE_ADDRESS}/scan${suffix}`;

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiterState();
  mocks.getAddressTransactions.mockResolvedValue(txResult());
  mocks.getScanJobRow.mockResolvedValue(null);
  mocks.getScanFindings.mockResolvedValue([]);
  mocks.hydrateFindings.mockResolvedValue([]);
  mocks.isScanJobActive.mockReturnValue(false);
  mocks.deleteScanJob.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /chains/:chainId/addresses/:address/scan', () => {
  it('creates a job and answers 202 with the pinned job body (default bounds)', async () => {
    mocks.createOrReplaceScanJob.mockResolvedValue({
      ok: true,
      result: { outcome: 'created', job: jobRow({ status: 'pending', cursorBlock: -1n }), started: null },
    });

    const res = await app.request(scanPath(), { method: 'POST' });
    expect(res.status).toBe(202);
    const body = await res.json();
    // Exactly the pinned field set — nothing more.
    expect(Object.keys(body).sort()).toEqual(
      [
        'blocksTotal',
        'blocksWalked',
        'coverage',
        'cursorBlock',
        'errorMessage',
        'fromBlock',
        'status',
        'toBlock',
        'txsFound',
        'updatedAt',
      ].sort(),
    );
    expect(body).toMatchObject({ status: 'pending', fromBlock: 0, cursorBlock: -1, blocksWalked: 0 });
    expect(mocks.createOrReplaceScanJob).toHaveBeenCalledWith(1, ROUTE_ADDRESS, {
      fromBlock: 'earliest',
      toBlock: 'latest',
      force: false,
    });
  });

  it('answers 200 with the existing job when bounds match (idempotent)', async () => {
    mocks.createOrReplaceScanJob.mockResolvedValue({
      ok: true,
      result: { outcome: 'idempotent', job: jobRow({}), started: null },
    });

    const res = await app.request(scanPath(), {
      method: 'POST',
      body: JSON.stringify({ fromBlock: 0, toBlock: 1000 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('running');
  });

  it('maps the service conflict outcome to 400 scan_conflict', async () => {
    mocks.createOrReplaceScanJob.mockResolvedValue({
      ok: true,
      result: { outcome: 'conflict', message: 'bounds differ; pass force: true' },
    });

    const res = await app.request(scanPath(), {
      method: 'POST',
      body: JSON.stringify({ fromBlock: 5, toBlock: 1000 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'scan_conflict',
      message: 'bounds differ; pass force: true',
    });
  });

  it('rejects invalid bounds with 400 invalid_bounds without touching the service', async () => {
    for (const body of [
      { fromBlock: 10, toBlock: 5 },
      { fromBlock: -1 },
      { toBlock: 1.5 },
      { fromBlock: 'finalized' },
      { toBlock: 'safe' },
      { force: 'yes' },
      { fromBlock: 'latest', toBlock: 'earliest' },
    ]) {
      // The real limiter allows burst 2; reset per iteration so every
      // case reaches validation instead of the shared bucket.
      resetRateLimiterState();
      const res = await app.request(scanPath(), {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_bounds' });
    }
    expect(mocks.createOrReplaceScanJob).not.toHaveBeenCalled();
  });

  it('also maps resolved-bound failures (from beyond head) to 400 invalid_bounds', async () => {
    mocks.createOrReplaceScanJob.mockResolvedValue({
      ok: false,
      error: 'invalid_bounds',
      message: 'fromBlock (5000) must not be after toBlock (1000)',
    });
    const res = await app.request(scanPath(), {
      method: 'POST',
      body: JSON.stringify({ fromBlock: 5000, toBlock: 1000 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_bounds',
      message: 'fromBlock (5000) must not be after toBlock (1000)',
    });
  });
});

describe('GET /chains/:chainId/addresses/:address/scan', () => {
  it('returns the job DTO for an open read', async () => {
    mocks.getScanJobRow.mockResolvedValue(jobRow({}));

    const res = await app.request(scanPath());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('running');
    expect(body.blocksWalked).toBe(500);
    expect(body.blocksTotal).toBe(1001);
    expect(body.coverage).toBeNull();
  });

  it('answers 404 no_scan_job when no row exists', async () => {
    mocks.getScanJobRow.mockResolvedValue(null);
    const res = await app.request(scanPath());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_scan_job' });
  });
});

describe('POST /scan/pause and /scan/resume', () => {
  it('pauses a running job with an active loop → 202', async () => {
    mocks.getScanJobRow.mockResolvedValue(jobRow({ status: 'running' }));
    mocks.isScanJobActive.mockReturnValue(true);
    mocks.pauseScanJob.mockReturnValue(true);

    const res = await app.request(scanPath('/pause'), { method: 'POST' });
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe('running');
    expect(mocks.pauseScanJob).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
  });

  it('rejects pause with 400 invalid_state when the job is not running', async () => {
    mocks.getScanJobRow.mockResolvedValue(jobRow({ status: 'paused' }));
    const res = await app.request(scanPath('/pause'), { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_state' });
  });

  it('rejects pause with 400 when a running row has no live loop (restart-stranded)', async () => {
    mocks.getScanJobRow.mockResolvedValue(jobRow({ status: 'running' }));
    mocks.isScanJobActive.mockReturnValue(false);
    const res = await app.request(scanPath('/pause'), { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_state' });
  });

  it('resumes a paused job → 202 with the queued job', async () => {
    mocks.resumeScanJob.mockResolvedValue({
      ok: true,
      job: jobRow({ status: 'pending' }),
      started: null,
    });
    const res = await app.request(scanPath('/resume'), { method: 'POST' });
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe('pending');
  });

  it('rejects resume with 400 invalid_state when not paused', async () => {
    mocks.resumeScanJob.mockResolvedValue({
      ok: false,
      message: 'Scan job is not paused (status: running)',
    });
    const res = await app.request(scanPath('/resume'), { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_state',
      message: 'Scan job is not paused (status: running)',
    });
  });
});

describe('POST /scan/catchup', () => {
  beforeEach(() => {
    mocks.catchupScanJob.mockResolvedValue({
      ok: true,
      job: jobRow({ status: 'pending', toBlock: 1500n, cursorBlock: 1000n, txsFound: 1 }),
      started: null,
    });
  });

  it('extends the walk to the head → 202 with the updated job DTO', async () => {
    const res = await app.request(scanPath('/catchup'), { method: 'POST' });
    expect(res.status).toBe(202);
    const body = await res.json();
    // Same pinned 10-field shape as the other scan endpoints.
    expect(Object.keys(body).sort()).toEqual(
      [
        'blocksTotal',
        'blocksWalked',
        'coverage',
        'cursorBlock',
        'errorMessage',
        'fromBlock',
        'status',
        'toBlock',
        'txsFound',
        'updatedAt',
      ].sort(),
    );
    // blocksTotal recomputed against the new head; walked unchanged.
    expect(body).toMatchObject({
      status: 'pending',
      fromBlock: 0,
      toBlock: 1500,
      cursorBlock: 1000,
      blocksWalked: 1001,
      blocksTotal: 1501,
      txsFound: 1,
    });
    expect(mocks.catchupScanJob).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
  });

  it('answers 404 no_scan_job (no message) when no row exists', async () => {
    mocks.catchupScanJob.mockResolvedValue({ ok: false, error: 'no_scan_job' });
    const res = await app.request(scanPath('/catchup'), { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_scan_job' });
  });

  it('answers 400 invalid_state with the displayable message when the scan is running', async () => {
    mocks.catchupScanJob.mockResolvedValue({
      ok: false,
      error: 'invalid_state',
      message: 'Scan is running — wait for it to finish or pause it first',
    });
    const res = await app.request(scanPath('/catchup'), { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_state',
      message: 'Scan is running — wait for it to finish or pause it first',
    });
  });

  it('answers 400 already_caught_up with the displayable message', async () => {
    mocks.catchupScanJob.mockResolvedValue({
      ok: false,
      error: 'already_caught_up',
      message: 'Scan is already at the chain head',
    });
    const res = await app.request(scanPath('/catchup'), { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'already_caught_up',
      message: 'Scan is already at the chain head',
    });
  });

  it('is admin gated like the other writes: 403 tiers, service untouched until authorized', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'secret-token');

    const noToken = await app.request(scanPath('/catchup'), { method: 'POST' });
    expect(noToken.status).toBe(403);
    const wrongToken = await app.request(scanPath('/catchup'), {
      method: 'POST',
      headers: { 'x-admin-token': 'wrong' },
    });
    expect(wrongToken.status).toBe(403);
    expect(mocks.catchupScanJob).not.toHaveBeenCalled();

    const rightToken = await app.request(scanPath('/catchup'), {
      method: 'POST',
      headers: { 'x-admin-token': 'secret-token' },
    });
    expect(rightToken.status).toBe(202);
    expect(mocks.catchupScanJob).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
  });

  it('shares the address-scan-write bucket: throttled once the burst is spent', async () => {
    mocks.createOrReplaceScanJob.mockResolvedValue({
      ok: true,
      result: { outcome: 'created', job: jobRow({ status: 'pending', cursorBlock: -1n }), started: null },
    });

    const first = await app.request(scanPath(), { method: 'POST' });
    const second = await app.request(scanPath(), { method: 'POST' });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);

    // Third write in the same window — the catchup draws from the SAME
    // bucket as create/pause/resume/delete, not a new one.
    const third = await app.request(scanPath('/catchup'), { method: 'POST' });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: 'rate_limited' });
    expect(mocks.catchupScanJob).not.toHaveBeenCalled();
  });
});

describe('DELETE /chains/:chainId/addresses/:address/scan', () => {
  it('deletes the job and findings → 204, idempotent on repeat', async () => {
    const first = await app.request(scanPath(), { method: 'DELETE' });
    expect(first.status).toBe(204);
    expect(await first.text()).toBe('');
    expect(mocks.deleteScanJob).toHaveBeenCalledWith(1, ROUTE_ADDRESS);

    mocks.deleteScanJob.mockClear();
    const second = await app.request(scanPath(), { method: 'DELETE' });
    expect(second.status).toBe(204);
    expect(mocks.deleteScanJob).toHaveBeenCalled();
  });
});

describe('admin opt-in gating on scan writes', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_TOKEN', 'secret-token');
    mocks.createOrReplaceScanJob.mockResolvedValue({
      ok: true,
      result: { outcome: 'created', job: jobRow({ status: 'pending', cursorBlock: -1n }), started: null },
    });
  });

  it('rejects writes without a token and with a wrong token; passes with the right one', async () => {
    const noToken = await app.request(scanPath(), { method: 'POST' });
    expect(noToken.status).toBe(403);

    const wrongToken = await app.request(scanPath(), {
      method: 'POST',
      headers: { 'x-admin-token': 'wrong' },
    });
    expect(wrongToken.status).toBe(403);
    expect(mocks.createOrReplaceScanJob).not.toHaveBeenCalled();

    // Limiter state resets in beforeEach, so this request is in-burst.
    const rightToken = await app.request(scanPath(), {
      method: 'POST',
      headers: { 'x-admin-token': 'secret-token' },
    });
    expect(rightToken.status).toBe(202);
    expect(mocks.createOrReplaceScanJob).toHaveBeenCalled();

    const deleteNoToken = await app.request(scanPath(), { method: 'DELETE' });
    expect(deleteNoToken.status).toBe(403);
    const pauseNoToken = await app.request(scanPath('/pause'), { method: 'POST' });
    expect(pauseNoToken.status).toBe(403);
    const resumeNoToken = await app.request(scanPath('/resume'), { method: 'POST' });
    expect(resumeNoToken.status).toBe(403);
  });

  it('keeps GET scan an open read even with a token configured', async () => {
    mocks.getScanJobRow.mockResolvedValue(jobRow({}));
    const res = await app.request(scanPath());
    expect(res.status).toBe(200);
  });

  it('keeps the transactions read open (deepScan field included)', async () => {
    mocks.getScanJobRow.mockResolvedValue(jobRow({}));
    const res = await app.request(`/chains/1/addresses/${ROUTE_ADDRESS}/transactions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('deepScan');
  });
});

describe('address-scan-write limiter (3/min, burst 2)', () => {
  it('lets the burst through and throttles the third write within the window', async () => {
    mocks.createOrReplaceScanJob.mockResolvedValue({
      ok: true,
      result: { outcome: 'created', job: jobRow({ status: 'pending', cursorBlock: -1n }), started: null },
    });
    mocks.resumeScanJob.mockResolvedValue({
      ok: true,
      job: jobRow({ status: 'pending' }),
      started: null,
    });

    const first = await app.request(scanPath(), { method: 'POST' });
    const second = await app.request(scanPath(), { method: 'POST' });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);

    // The four write routes share one bucket: the third write (any verb)
    // is over burst within the same minute.
    const third = await app.request(scanPath('/resume'), { method: 'POST' });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: 'rate_limited' });
    expect(mocks.resumeScanJob).not.toHaveBeenCalled();
  });
});

describe('GET transactions — additive deepScan contract', () => {
  const txPath = () => `/chains/1/addresses/${ROUTE_ADDRESS}/transactions`;

  it('stays byte-identical in shape when no job row exists (no deepScan key)', async () => {
    mocks.getScanJobRow.mockResolvedValue(null);

    const res = await app.request(txPath());
    expect(res.status).toBe(200);
    const body = await res.json();
    // The heuristic fixture carries no `reason`, and safeJsonResponse
    // drops undefined values — the legacy shape has no reason key. This
    // is the byte-identity pin: exactly the pre-deep-scan key set.
    expect(Object.keys(body).sort()).toEqual(
      [
        'address',
        'chainId',
        'chainName',
        'coverage',
        'method',
        'pagination',
        'searchWindowBlocks',
        'timestamp',
        'total',
        'transactions',
      ].sort(),
    );
    expect('deepScan' in body).toBe(false);
  });

  it('includes the job DTO and passes hydrated findings into the merge', async () => {
    const job = jobRow({ status: 'running', txsFound: 3 });
    mocks.getScanJobRow.mockResolvedValue(job);
    mocks.getScanFindings.mockResolvedValue([
      {
        chainId: 1,
        address: ROUTE_ADDRESS,
        txHash: `0x${'f1'.repeat(32)}`,
        blockNumber: 700n,
      },
    ]);
    const hydrated = [
      {
        hash: `0x${'f1'.repeat(32)}`,
        blockNumber: 700n,
        fromAddress: `0x${'2'.repeat(40)}`,
        toAddress: ROUTE_ADDRESS,
        value: '5',
        timestamp: '2026-09-24T00:00:00.000Z',
      },
    ];
    mocks.hydrateFindings.mockResolvedValue(hydrated);
    mocks.getAddressTransactions.mockResolvedValue(
      txResult({ total: 1, coverage: 'partial' }),
    );

    const res = await app.request(txPath());
    expect(res.status).toBe(200);
    const body = await res.json();
    const deepScan = body.deepScan as ScanJobDto;
    expect(deepScan.status).toBe('running');
    expect(deepScan.txsFound).toBe(3);
    // The route passes the hydrated envelopes to the service merge.
    expect(mocks.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
      expect.objectContaining({ deepScanFindings: hydrated }),
    );
    expect(body.total).toBe(1);
    // Job not complete → heuristic coverage verdict stands.
    expect(body.coverage).toBe('partial');
  });

  it('lifts coverage to complete with reason deep-scan ONLY for a finished genesis walk', async () => {
    mocks.getScanJobRow.mockResolvedValue(
      jobRow({ status: 'complete', cursorBlock: 1000n, fromBlock: 0n, toBlock: 1000n }),
    );
    mocks.getAddressTransactions.mockResolvedValue(txResult({ coverage: 'partial' }));

    const res = await app.request(txPath());
    const body = await res.json();
    expect(body.coverage).toBe('complete');
    expect(body.reason).toBe('deep-scan');
    expect(body.deepScan.coverage).toBe('complete');

    // A finished walk that is NOT genesis-anchored must not lift.
    mocks.getScanJobRow.mockResolvedValue(
      jobRow({ status: 'complete', cursorBlock: 1000n, fromBlock: 50n, toBlock: 1000n }),
    );
    const res2 = await app.request(txPath());
    const body2 = await res2.json();
    expect(body2.coverage).toBe('partial');
    expect(body2.reason).toBeUndefined();
  });

  it('degrades to the heuristic-only list when findings hydration fails', async () => {
    mocks.getScanJobRow.mockResolvedValue(jobRow({ status: 'running' }));
    mocks.getScanFindings.mockResolvedValue([
      {
        chainId: 1,
        address: ROUTE_ADDRESS,
        txHash: `0x${'f1'.repeat(32)}`,
        blockNumber: 700n,
      },
    ]);
    mocks.hydrateFindings.mockRejectedValue(new Error('RPC down'));

    const res = await app.request(txPath());
    expect(res.status).toBe(200);
    const body = await res.json();
    // deepScan still reported; no findings merged.
    expect(body.deepScan.status).toBe('running');
    expect(mocks.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
      expect.not.objectContaining({ deepScanFindings: expect.anything() }),
    );
  });
});
