/**
 * Failure-shape contract for the two read-only events endpoints:
 * - GET .../events must answer 500 with an error envelope ({error, message}),
 *   never a success-shaped body (empty events page) that clients could
 *   render as "no events found";
 * - GET .../indexing-status must answer 503 with an error envelope instead
 *   of fabricating a zeroed status object ("indexed nothing") the database
 *   never reported.
 * - GET .../events pagination: non-numeric page/pageSize must 400 with
 *   invalid_page/invalid_page_size (addresses.ts contract), never leak NaN
 *   into SQL offsets; numeric input keeps the legacy clamp behavior.
 * - GET .../events argFilters: non-object JSON and non-scalar values
 *   (arrays/objects/null — a typo like {a: [1,2]}) must 400 with
 *   invalid_arg_filters naming the offending key; silently dropping them
 *   would run the query unfiltered and return a wrong answer that looks
 *   right. Scalar filters keep flowing through unchanged.
 * - GET .../events block bounds: junk like fromBlock=abc must 400 with
 *   invalid_from_block/invalid_to_block instead of being treated as absent
 *   (the silent-unfilter class again); numeric and empty/absent stay as-is.
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
    await expect(res.json()).resolves.toMatchObject({
      error: 'internal_error',
      message: 'Failed to query contract events',
    });
  });
});

describe('GET .../events pagination validation', () => {
  it('answers 400 invalid_page for a non-numeric page instead of a 500 from NaN SQL offsets', async () => {
    const res = await request(`${BASE}?page=abc`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_page',
      message: 'page must be a positive integer',
    });
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_page_size for a non-numeric pageSize', async () => {
    const res = await request(`${BASE}?pageSize=abc`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_page_size',
      message: 'pageSize must be a positive integer',
    });
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });

  it('keeps the legacy clamps for numeric input: page floors at 1, pageSize caps at 1000', async () => {
    await request(`${BASE}?page=0&pageSize=5000`);

    expect(mocks.getContractEvents).toHaveBeenCalledTimes(1);
    expect(mocks.getContractEvents).toHaveBeenCalledWith(
      CHAIN_ID,
      ADDRESS,
      expect.objectContaining({ page: 1, pageSize: 1000 }),
    );
  });

  it('treats empty pagination params as absent (defaults 1/50)', async () => {
    const res = await request(`${BASE}?page=&pageSize=`);

    expect(res.status).toBe(200);
    expect(mocks.getContractEvents).toHaveBeenCalledWith(
      CHAIN_ID,
      ADDRESS,
      expect.objectContaining({ page: 1, pageSize: 50 }),
    );
  });
});

describe('GET .../events argFilters validation', () => {
  it('answers 400 invalid_arg_filters naming the key when a value is an array', async () => {
    const res = await request(`${BASE}?argFilters=${encodeURIComponent('{"owner":"0xabc","ids":[1,2]}')}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_arg_filters');
    expect(body.message).toContain('ids');
    expect(body.message).toContain('string | number | boolean');
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_arg_filters for null and object values too', async () => {
    for (const bad of ['{"weird":null}', '{"weird":{"a":1}}']) {
      const res = await request(`${BASE}?argFilters=${encodeURIComponent(bad)}`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_arg_filters');
      expect(body.message).toContain('weird');
    }
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });

  it('keeps answering 400 invalid_arg_filters for unparseable JSON', async () => {
    const res = await request(`${BASE}?argFilters=not-json`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_arg_filters');
    expect(body.message).toContain('{argName: string | number | boolean}');
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });

  it('forwards valid scalar filters unchanged', async () => {
    const filters = encodeURIComponent('{"owner":"0xabc","value":1000,"active":true}');
    const res = await request(`${BASE}?argFilters=${filters}`);

    expect(res.status).toBe(200);
    expect(mocks.getContractEvents).toHaveBeenCalledWith(
      CHAIN_ID,
      ADDRESS,
      expect.objectContaining({
        argFilters: { owner: '0xabc', value: 1000, active: true },
      }),
    );
  });
});

describe('GET .../events block bound validation', () => {
  it('answers 400 invalid_from_block for junk instead of dropping the bound', async () => {
    const res = await request(`${BASE}?fromBlock=abc`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_from_block');
    expect(body.message).toContain('fromBlock');
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_to_block for junk', async () => {
    const res = await request(`${BASE}?toBlock=abc`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_to_block');
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
  });

  it('forwards numeric bounds and treats empty values as absent', async () => {
    const res = await request(`${BASE}?fromBlock=18000000&toBlock=18000100`);

    expect(res.status).toBe(200);
    expect(mocks.getContractEvents).toHaveBeenCalledWith(
      CHAIN_ID,
      ADDRESS,
      expect.objectContaining({ fromBlock: 18000000, toBlock: 18000100 }),
    );

    const empty = await request(`${BASE}?fromBlock=&toBlock=`);
    expect(empty.status).toBe(200);
    expect(mocks.getContractEvents).toHaveBeenLastCalledWith(
      CHAIN_ID,
      ADDRESS,
      expect.objectContaining({ fromBlock: undefined, toBlock: undefined }),
    );
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
    await expect(res.json()).resolves.toMatchObject({
      error: 'indexing_status_unavailable',
      message: 'Failed to load indexing status',
    });
  });
});
