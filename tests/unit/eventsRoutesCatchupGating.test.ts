/**
 * Route-level behavior for the events range API:
 * - quick mode 'catchup' (dispatch, no blockCount required, contract 400 body
 *   when no previous range exists, generic envelope for other failures),
 * - PATCH bound validation (numbers or block tags only),
 * - mutating routes are wrapped in requireAdminTokenIfConfigured while the
 *   GET endpoints stay open,
 * - contract-address validation tiers (all-lower/all-upper pass, mixed case
 *   must be EIP-55 correct) with lowercase storage keys preserved,
 * - a missing range is a 404 resource state on start/resume/delete while
 *   state conflicts stay 400.
 *
 * The service and middleware modules are mocked: these tests pin the route
 * wiring, not the service semantics (covered by eventIndexingRanges.test.ts)
 * or the token comparison itself (covered by adminToken.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  addIndexingRange: vi.fn(),
  updateIndexingRange: vi.fn(),
  deleteIndexingRange: vi.fn(),
  startIndexingRange: vi.fn(),
  pauseIndexingRange: vi.fn(),
  resumeIndexingRange: vi.fn(),
  getActiveRangeJob: vi.fn(),
  updateRangeStatus: vi.fn(),
  createRangeAll: vi.fn(),
  createRangeRecent: vi.fn(),
  createRangeFirst: vi.fn(),
  createRangeContinue: vi.fn(),
  createRangeCatchup: vi.fn(),
  getIndexingRanges: vi.fn(),
  getContractEvents: vi.fn(),
  getEventStatistics: vi.fn(),
  getIndexingStatus: vi.fn(),
}));

vi.mock('@/middleware/admin-token', () => ({
  requireAdminTokenIfConfigured: mocks.gate,
}));

vi.mock('@/services/EventIndexingService', () => ({
  addIndexingRange: mocks.addIndexingRange,
  updateIndexingRange: mocks.updateIndexingRange,
  deleteIndexingRange: mocks.deleteIndexingRange,
  startIndexingRange: mocks.startIndexingRange,
  pauseIndexingRange: mocks.pauseIndexingRange,
  resumeIndexingRange: mocks.resumeIndexingRange,
  getActiveRangeJob: mocks.getActiveRangeJob,
  updateRangeStatus: mocks.updateRangeStatus,
  createRangeAll: mocks.createRangeAll,
  createRangeRecent: mocks.createRangeRecent,
  createRangeFirst: mocks.createRangeFirst,
  createRangeContinue: mocks.createRangeContinue,
  createRangeCatchup: mocks.createRangeCatchup,
  getIndexingRanges: mocks.getIndexingRanges,
  getContractEvents: mocks.getContractEvents,
  getEventStatistics: mocks.getEventStatistics,
  getIndexingStatus: mocks.getIndexingStatus,
  // Re-imported by the real EventExportService from the same module.
  buildEventFilterConditions: vi.fn(() => []),
}));

vi.mock('@/services/EventExportService', () => ({
  buildEventsCsv: vi.fn(),
  EXPORT_MAX_ROWS: 100_000,
  fetchFilteredEventsForExport: vi.fn(),
  getFilteredEventCount: vi.fn(),
}));

vi.mock('@/services/ContractSourceService', () => ({
  contractSourceService: {
    getContractSource: vi.fn().mockResolvedValue(null),
  },
}));

import app from '@/routes/events';
import { contractSourceService } from '@/services/ContractSourceService';
import { getAddress } from 'viem';

const CHAIN_ID = 1;
const ADDRESS = '0x1234567890123456789012345678901234567890';
const BASE = `/chains/${CHAIN_ID}/contracts/${ADDRESS}/events`;

const request = (path: string, init?: RequestInit) => app.request(path, init);

const post = (path: string, body: unknown) =>
  request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Default gate behavior: allow through (the open/unset branch).
  mocks.gate.mockImplementation(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  });
  mocks.getIndexingRanges.mockResolvedValue([]);
  mocks.getContractEvents.mockResolvedValue({
    events: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
  });
  mocks.getEventStatistics.mockResolvedValue({
    totalEvents: 0,
    eventsByType: {},
    uniqueEventTypes: 0,
  });
  mocks.getIndexingStatus.mockResolvedValue({ status: 'idle', ranges: [] });
});

describe('quick range mode: catchup', () => {
  it('lists catchup as a valid mode in the validation message', async () => {
    const res = await post(`${BASE}/ranges/quick`, { mode: 'bogus' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('catchup');
  });

  it('dispatches catchup without requiring blockCount and mirrors the quick response shape', async () => {
    mocks.createRangeCatchup.mockResolvedValue({
      success: true,
      rangeId: 7,
      fromBlock: 900,
      toBlock: 20_000_000,
    });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'catchup' });

    expect(res.status).toBe(201);
    expect(mocks.createRangeCatchup).toHaveBeenCalledTimes(1);
    expect(mocks.createRangeCatchup).toHaveBeenCalledWith(CHAIN_ID, ADDRESS, {
      direction: undefined,
      priority: undefined,
    });
    const body = await res.json();
    expect(body.mode).toBe('catchup');
    expect(body.rangeId).toBe(7);
    expect(body.fromBlock).toBe(900);
    expect(body.toBlock).toBe(20_000_000);
    expect(typeof body.timestamp).toBe('string');
    // No ABI resolves (the mocked contract source has none), so the range
    // stays pending and the response says so instead of failing the create.
    expect(body.started).toBe(false);
    expect(body.startError).toContain('No ABI available');
    expect(mocks.startIndexingRange).not.toHaveBeenCalled();
  });

  it('returns the contract 400 body when no previous range exists', async () => {
    mocks.createRangeCatchup.mockResolvedValue({
      success: false,
      error: 'No previous range found. Cannot catch up.',
    });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'catchup' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'No previous range found. Cannot catch up.',
    });
    // A failed create never auto-starts anything.
    expect(mocks.startIndexingRange).not.toHaveBeenCalled();
  });

  it('maps other catchup failures to the generic quick error envelope', async () => {
    mocks.createRangeCatchup.mockResolvedValue({ success: false, error: 'boom' });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'catchup' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Failed to create range with mode: catchup');
    expect(body.message).toBe('boom');
    expect(mocks.startIndexingRange).not.toHaveBeenCalled();
  });
});

describe('quick range auto-start', () => {
  beforeEach(() => {
    mocks.startIndexingRange.mockResolvedValue({ success: true });
  });

  it('auto-starts the created range with the contract-source ABI', async () => {
    const serverAbi = [{ type: 'event', name: 'Transfer', inputs: [] }];
    vi.mocked(contractSourceService.getContractSource).mockResolvedValueOnce({
      abi: JSON.stringify(serverAbi),
    } as never);
    mocks.createRangeRecent.mockResolvedValue({
      success: true,
      rangeId: 12,
      fromBlock: 900,
      toBlock: 1_900,
    });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'recent', blockCount: 1000 });

    expect(res.status).toBe(201);
    expect(mocks.getActiveRangeJob).toHaveBeenCalledWith(CHAIN_ID, ADDRESS, 12);
    expect(mocks.startIndexingRange).toHaveBeenCalledWith(CHAIN_ID, ADDRESS, 12, serverAbi);
    const body = await res.json();
    expect(body.started).toBe(true);
    expect(body.startError).toBeUndefined();
  });

  it('prefers the request-body ABI over the contract source', async () => {
    const bodyAbi = [{ type: 'event', name: 'Custom', inputs: [] }];
    mocks.createRangeAll.mockResolvedValue({
      success: true,
      rangeId: 13,
      fromBlock: 0,
      toBlock: 5_000,
    });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'all', abi: bodyAbi });

    expect(res.status).toBe(201);
    expect(contractSourceService.getContractSource).not.toHaveBeenCalled();
    expect(mocks.startIndexingRange).toHaveBeenCalledWith(CHAIN_ID, ADDRESS, 13, bodyAbi);
    expect(await res.json()).toMatchObject({ started: true });
  });

  it('keeps the range pending (reported, not thrown) when no ABI resolves', async () => {
    mocks.createRangeFirst.mockResolvedValue({
      success: true,
      rangeId: 14,
      fromBlock: 10,
      toBlock: 1_010,
    });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'first', blockCount: 1000 });

    expect(res.status).toBe(201);
    expect(mocks.startIndexingRange).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.started).toBe(false);
    expect(body.startError).toContain('No ABI available');
  });
});

describe('quick range mode: all (full-history gate)', () => {
  it('maps the unconfirmed full-history refusal to a 400 carrying the span facts in details', async () => {
    mocks.createRangeAll.mockResolvedValue({
      success: false,
      error:
        'Indexing the full history spans about 20,000,000 blocks — confirm with confirmFullHistory: true',
      reason: 'full-history-unconfirmed',
      spanBlocks: 20_000_000,
      fromBlock: 0,
      head: 20_000_000,
    });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'all' });

    expect(res.status).toBe(400);
    // Only an explicit true confirms — anything else keeps the gate.
    expect(mocks.createRangeAll).toHaveBeenCalledWith(CHAIN_ID, ADDRESS, {
      direction: undefined,
      priority: undefined,
      confirmFullHistory: false,
    });
    const body = await res.json();
    expect(body.error).toBe('Full history confirmation required');
    expect(body.message).toContain('20,000,000');
    expect(body.reason).toBe('full-history-unconfirmed');
    // `details` is the channel the frontend HTTP layer surfaces on
    // ApiError — the UI arms its confirmation gate from these facts.
    expect(body.details).toEqual({
      reason: 'full-history-unconfirmed',
      spanBlocks: 20_000_000,
      fromBlock: 0,
      head: 20_000_000,
    });
    // A refused create never auto-starts anything.
    expect(mocks.startIndexingRange).not.toHaveBeenCalled();
  });

  it('forwards confirmFullHistory === true and mirrors truncatedToBlock on success', async () => {
    mocks.createRangeAll.mockResolvedValue({
      success: true,
      rangeId: 3,
      fromBlock: 0,
      toBlock: 20_000_000,
      truncatedToBlock: 20_000_000,
    });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'all', confirmFullHistory: true });

    expect(res.status).toBe(201);
    expect(mocks.createRangeAll).toHaveBeenCalledWith(CHAIN_ID, ADDRESS, {
      direction: undefined,
      priority: undefined,
      confirmFullHistory: true,
    });
    const body = await res.json();
    expect(body.truncatedToBlock).toBe(20_000_000);
    expect(body.fromBlock).toBe(0);
    expect(body.toBlock).toBe(20_000_000);
  });
});

describe('PATCH range bound validation', () => {
  it('rejects a non-numeric, non-tag bound with 400 before reaching the service', async () => {
    const res = await request(`${BASE}/ranges/1`, {
      method: 'PATCH',
      body: JSON.stringify({ fromBlock: 'bogus' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
    expect(mocks.updateIndexingRange).not.toHaveBeenCalled();
  });

  it('forwards valid numeric and tag bounds to the service', async () => {
    mocks.updateIndexingRange.mockResolvedValue({ success: true, overlaps: [] });

    const res = await request(`${BASE}/ranges/1`, {
      method: 'PATCH',
      body: JSON.stringify({ fromBlock: 100, toBlock: 'latest' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(mocks.updateIndexingRange).toHaveBeenCalledWith(CHAIN_ID, ADDRESS, 1, {
      fromBlock: 100,
      toBlock: 'latest',
      direction: undefined,
      priority: undefined,
    });
  });
});

describe('admin gating of mutating event routes', () => {
  it('runs the gate on every mutating range route', async () => {
    // Each request reaches the handler fast: the gate is asserted per route
    // regardless of the handler's own response (400/404 bodies are fine).
    const mutatingRequests: Array<[string, RequestInit]> = [
      [`${BASE}/ranges`, { method: 'POST' }],
      [`${BASE}/ranges/quick`, { method: 'POST' }],
      [`${BASE}/ranges/1`, { method: 'PATCH' }],
      [`${BASE}/ranges/1`, { method: 'DELETE' }],
      [`${BASE}/ranges/1/start`, { method: 'POST' }],
      [`${BASE}/ranges/1/pause`, { method: 'POST' }],
      [`${BASE}/ranges/1/resume`, { method: 'POST' }],
    ];

    for (const [path, init] of mutatingRequests) {
      await request(path, init);
      expect(mocks.gate).toHaveBeenCalledTimes(1);
      mocks.gate.mockClear();
    }
  });

  it('leaves the read-only endpoints ungated', async () => {
    await request(`${BASE}/ranges`);
    await request(`${BASE}?page=1`);
    await request(`${BASE}/statistics`);
    await request(`${BASE}/indexing-status`);

    expect(mocks.gate).not.toHaveBeenCalled();
  });

  it('blocks mutating routes when the gate rejects, while GETs still answer', async () => {
    mocks.gate.mockImplementation(async (c: { json: (body: unknown, status: number) => unknown }) =>
      c.json({ error: 'Forbidden' }, 403),
    );

    const blocked = await post(`${BASE}/ranges/quick`, { mode: 'catchup' });
    expect(blocked.status).toBe(403);

    const open = await request(`${BASE}/ranges`);
    expect(open.status).toBe(200);
    expect(mocks.gate).toHaveBeenCalledTimes(1);
  });
});

describe('contract address validation (EIP-55 tiers)', () => {
  // Contains hex letters so case actually matters for the checksum.
  const LOWER = '0x1234567890abcdef1234567890abcdef12345678';
  const CHECKSUMMED = getAddress(LOWER);
  // Wrong checksum: flip the first hex letter's case — still mixed-case,
  // so it carries checksum information that no longer matches EIP-55.
  const BAD_CHECKSUM = CHECKSUMMED.replace(/[a-f]/, ch => ch.toUpperCase());
  const UPPER = `0x${LOWER.slice(2).toUpperCase()}`;

  it('rejects a mixed-case address with a wrong EIP-55 checksum', async () => {
    const res = await request(`/chains/${CHAIN_ID}/contracts/${BAD_CHECKSUM}/events`);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid contract address');
    expect(body.message).toContain('checksum');
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });

  it('accepts an all-lowercase address (checksum-less convention)', async () => {
    const res = await request(`/chains/${CHAIN_ID}/contracts/${LOWER}/events`);

    expect(res.status).toBe(200);
    expect(mocks.getContractEvents.mock.calls[0]?.[1]).toBe(LOWER);
  });

  it('accepts an all-uppercase address (checksum-less convention)', async () => {
    const res = await request(`/chains/${CHAIN_ID}/contracts/${UPPER}/events`);

    expect(res.status).toBe(200);
    expect(mocks.getContractEvents.mock.calls[0]?.[1]).toBe(LOWER);
  });

  it('keeps the storage key lowercase when given a correct checksum address', async () => {
    const res = await request(`/chains/${CHAIN_ID}/contracts/${CHECKSUMMED}/events`);

    expect(res.status).toBe(200);
    // Rows written with lowercase keys before checksum-tight validation
    // must stay reachable from a checksummed URL.
    expect(mocks.getContractEvents.mock.calls[0]?.[1]).toBe(LOWER);
  });

  it('rejects a malformed address shape', async () => {
    const res = await request(`/chains/${CHAIN_ID}/contracts/0xzz/events`);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid contract address');
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });
});

describe('missing range: 404 resource state', () => {
  const ABI = [{ type: 'event', name: 'Transfer', inputs: [] }];

  it('start answers 404 (not 400) when the range does not exist', async () => {
    const res = await post(`${BASE}/ranges/9/start`, { abi: ABI });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Range not found' });
    expect(mocks.startIndexingRange).not.toHaveBeenCalled();
  });

  it('resume answers 404 (not 400) when the range does not exist', async () => {
    const res = await post(`${BASE}/ranges/9/resume`, { abi: ABI });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Range not found' });
    expect(mocks.resumeIndexingRange).not.toHaveBeenCalled();
  });

  it('delete answers 404 when the service reports Range not found', async () => {
    mocks.deleteIndexingRange.mockResolvedValue({ success: false, error: 'Range not found' });

    const res = await request(`${BASE}/ranges/9`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Range not found' });
  });

  it('delete keeps non-missing-range service failures as 400', async () => {
    mocks.deleteIndexingRange.mockResolvedValue({
      success: false,
      error: 'Cannot delete range while indexing',
    });

    const res = await request(`${BASE}/ranges/9`, { method: 'DELETE' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Failed to delete indexing range');
    expect(body.message).toBe('Cannot delete range while indexing');
  });

  it('start keeps state conflicts (already completed) as 400', async () => {
    mocks.getIndexingRanges.mockResolvedValue([
      { rangeId: 9, status: 'completed' },
    ]);

    const res = await post(`${BASE}/ranges/9/start`, { abi: ABI });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('Range is already completed');
    expect(mocks.startIndexingRange).not.toHaveBeenCalled();
  });
});
