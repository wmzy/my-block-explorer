/**
 * Route-level behavior for the events range API:
 * - quick mode 'catchup' (dispatch, no blockCount required, contract 400 body
 *   when no previous range exists, generic envelope for other failures),
 * - PATCH bound validation (numbers or block tags only),
 * - mutating routes are wrapped in requireAdminTokenIfConfigured while the
 *   GET endpoints stay open.
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
  });

  it('maps other catchup failures to the generic quick error envelope', async () => {
    mocks.createRangeCatchup.mockResolvedValue({ success: false, error: 'boom' });

    const res = await post(`${BASE}/ranges/quick`, { mode: 'catchup' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Failed to create range with mode: catchup');
    expect(body.message).toBe('boom');
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
