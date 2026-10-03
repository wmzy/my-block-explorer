// Route contract for the `:rangeId` path param on the five mutating event
// range routes (PATCH / DELETE / start / pause / resume).
//
// parseInt() accepts a valid PREFIX and ignores the rest, so a junk path
// segment silently addressed the WRONG range: `…/ranges/3abc` was read as
// range 3, `…/ranges/0x10` as 16, `…/ranges/1e3` as 1. The route's own
// contract says "rangeId must be a number" and 400s only on NaN — a
// mutating request therefore deleted/started/paused someone else's range
// while the client was told its input was fine. Every site in the file had
// the same line (5 occurrences), so the whole class is fixed here.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateIndexingRange: vi.fn(),
  deleteIndexingRange: vi.fn(),
  startIndexingRange: vi.fn(),
  pauseIndexingRange: vi.fn(),
  resumeIndexingRange: vi.fn(),
  getIndexingRanges: vi.fn(),
  getActiveRangeJob: vi.fn(),
}));

vi.mock('@/services/EventIndexingService', () => ({
  updateIndexingRange: mocks.updateIndexingRange,
  deleteIndexingRange: mocks.deleteIndexingRange,
  startIndexingRange: mocks.startIndexingRange,
  pauseIndexingRange: mocks.pauseIndexingRange,
  resumeIndexingRange: mocks.resumeIndexingRange,
  getIndexingRanges: mocks.getIndexingRanges,
  getActiveRangeJob: mocks.getActiveRangeJob,
  getContractEvents: vi.fn(),
  getEventStatistics: vi.fn(),
  getIndexingStatus: vi.fn(),
  updateRangeStatus: vi.fn(),
  createRangeAll: vi.fn(),
  createRangeRecent: vi.fn(),
  createRangeFirst: vi.fn(),
  createRangeContinue: vi.fn(),
  createRangeCatchup: vi.fn(),
}));

vi.mock('@/services/EventExportService', () => ({
  buildEventsCsv: vi.fn(),
  EXPORT_MAX_ROWS: 100000,
  fetchFilteredEventsForExport: vi.fn(),
}));

vi.mock('@/server/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import app from '@/routes/events';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const BASE = `/chains/1/contracts/${ADDRESS}/events/ranges`;

// Every mutating verb that reads :rangeId, with the request each needs to
// get past param validation. `body` is only read by the PATCH route.
const ROUTES: Array<{ verb: 'patch' | 'delete' | 'post'; suffix: string; body?: unknown }> = [
  { verb: 'patch', suffix: '', body: {} },
  { verb: 'delete', suffix: '' },
  { verb: 'post', suffix: '/start' },
  { verb: 'post', suffix: '/pause' },
  { verb: 'post', suffix: '/resume' },
];

// parseInt()'s prefix acceptance: each of these returns a real rangeId
// instead of NaN, so the route used to act on a DIFFERENT range than the
// caller asked for.
const JUNK_THAT_PARSES = [
  { raw: '3abc', parsed: 3 },
  { raw: '0x10', parsed: 16 },
  { raw: '1e3', parsed: 1 },
  { raw: ' 4 ', parsed: 4 },
  { raw: '+7', parsed: 7 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIndexingRanges.mockResolvedValue([]);
  mocks.getActiveRangeJob.mockReturnValue(null);
  mocks.deleteIndexingRange.mockResolvedValue({ success: true });
  mocks.pauseIndexingRange.mockResolvedValue({ success: true });
  mocks.resumeIndexingRange.mockResolvedValue({ success: true });
  mocks.updateIndexingRange.mockResolvedValue({ success: true });
});

describe('event range routes: :rangeId must be a plain decimal integer', () => {
  for (const route of ROUTES) {
    for (const { raw, parsed } of JUNK_THAT_PARSES) {
      it(`400s ${route.verb.toUpperCase()} …/ranges/${raw} instead of addressing range ${parsed}`, async () => {
        const init: RequestInit = { method: route.verb.toUpperCase() };
        if (route.body !== undefined) {
          init.body = JSON.stringify(route.body);
          init.headers = { 'Content-Type': 'application/json' };
        }

        const res = await app.request(`${BASE}/${raw}${route.suffix}`, init);

        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          error: 'invalid_range_id',
          message: 'rangeId must be a number',
        });

        // The decisive assertion: no mutating service was reached, so no
        // range other than the one named could have been touched.
        expect(mocks.deleteIndexingRange).not.toHaveBeenCalled();
        expect(mocks.pauseIndexingRange).not.toHaveBeenCalled();
        expect(mocks.resumeIndexingRange).not.toHaveBeenCalled();
        expect(mocks.updateIndexingRange).not.toHaveBeenCalled();
        expect(mocks.startIndexingRange).not.toHaveBeenCalled();
      });
    }
  }

  it('still 400s a wholly non-numeric rangeId (unchanged)', async () => {
    const res = await app.request(`${BASE}/abc`, { method: 'DELETE' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_range_id' });
  });

  it('accepts a plain decimal rangeId and forwards it unchanged', async () => {
    const res = await app.request(`${BASE}/3`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(mocks.deleteIndexingRange).toHaveBeenCalledWith(1, ADDRESS, 3);
  });
});
