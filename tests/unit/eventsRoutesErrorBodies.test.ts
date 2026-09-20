/**
 * Failure-shape contract for the two read-only events endpoints:
 * - GET .../events must answer 500 with an error envelope ({error, message}),
 *   never a success-shaped body (empty events page) that clients could
 *   render as "no events found";
 * - GET .../indexing-status must answer 503 with an error envelope instead
 *   of fabricating a zeroed status object ("indexed nothing") the database
 *   never reported.
 *
 * The service and middleware modules are mocked, mirroring
 * eventsRoutesCatchupGating.test.ts: these tests pin the route wiring, not
 * service semantics.
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

describe('GET .../events failure shape', () => {
  it('answers 500 with an error envelope, not a success-shaped empty page', async () => {
    mocks.getContractEvents.mockRejectedValue(new Error('duckdb boom'));

    const res = await request(BASE);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'internal_error',
      message: 'Failed to query contract events',
    });
  });
});

describe('GET .../events/indexing-status failure shape', () => {
  it('answers 503 with an error envelope and no fabricated counters', async () => {
    mocks.getIndexingStatus.mockRejectedValue(new Error('db locked'));

    const res = await request(`${BASE}/indexing-status`);

    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('indexing_status_unavailable');
    expect(body.message).toBe('db locked');
    // The zeroed status object of the old 200 response must not resurface.
    for (const field of [
      'status',
      'creationBlock',
      'lastIndexedBlock',
      'latestBlock',
      'lastFinalizedBlock',
      'totalEventsIndexed',
      'eventTypes',
    ]) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('falls back to a stable message when the rejection is not an Error', async () => {
    mocks.getIndexingStatus.mockRejectedValue('raw string rejection');

    const res = await request(`${BASE}/indexing-status`);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'indexing_status_unavailable',
      message: 'Failed to load indexing status',
    });
  });
});
