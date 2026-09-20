/**
 * Integration tests for the events CSV export endpoint: happy path (headers,
 * escaping), the >100k rejection, and shared filter-param validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '@/api-app';
import * as exportService from '@/services/EventExportService';

// The export endpoint is rate-limited in production (5/min, burst 2) and
// test requests share the single no-conninfo fallback bucket — this file
// fires 6 exports in well under a second. These tests exercise validation
// and serialization, not throttling; the limiter has dedicated coverage in
// tests/unit/rateLimit.test.ts.
vi.mock('@/middleware/rate-limit', () => ({
  createRateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Mock the EventIndexingService to avoid database access
vi.mock('@/services/EventIndexingService', () => ({
  addIndexingRange: vi.fn(),
  getIndexingRanges: vi.fn().mockResolvedValue([]),
  updateIndexingRange: vi.fn(),
  deleteIndexingRange: vi.fn(),
  startIndexingRange: vi.fn(),
  pauseIndexingRange: vi.fn(),
  resumeIndexingRange: vi.fn(),
  getActiveRangeJob: vi.fn().mockReturnValue(false),
  // api-app calls this at module scope; it must resolve or import fails.
  reconcileInterruptedRanges: vi.fn().mockResolvedValue(undefined),
  getContractEvents: vi.fn().mockResolvedValue({
    events: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
  }),
  getEventStatistics: vi.fn().mockResolvedValue({ totalEvents: 0, eventTypes: [] }),
  getIndexingStatus: vi.fn().mockResolvedValue({
    chainId: 1,
    contractAddress: '0x1234567890123456789012345678901234567890',
    status: 'idle',
    creationBlock: 0,
    lastIndexedBlock: 0,
    latestBlock: 0,
    lastFinalizedBlock: 0,
    totalEventsIndexed: 0,
    eventTypes: [],
  }),
  updateRangeStatus: vi.fn(),
}));

// Keep the real EventExportService implementation (so the route's CSV
// building runs for real) while making the two db-touching functions spyable.
vi.mock('@/services/EventExportService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/EventExportService')>()),
}));

// Minimal RFC 4180 parser: fields may be quoted, embedded quotes are doubled,
// and embedded newlines stay inside the quoted field.
const parseCsv = (csv: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && csv[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

describe('Events CSV export API', () => {
  const chainId = 1;
  const contractAddress = '0x1234567890123456789012345678901234567890';
  const exportBase = `/api/chains/${chainId}/contracts/${contractAddress}/events/export`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams a CSV with Content-Disposition and escaped fields', async () => {
    const decodedArgs = '{"note":"a,b","quote":"say ""hi""","text":"l1\nl2"}';
    const countSpy = vi.spyOn(exportService, 'getFilteredEventCount').mockResolvedValue(1);
    const fetchSpy = vi
      .spyOn(exportService, 'fetchFilteredEventsForExport')
      .mockResolvedValue(
        [
          {
            blockNumber: 18000001n,
            blockTimestamp: 1700000000,
            transactionHash: '0xabc0000000000000000000000000000000000000000000000000000000000def',
            logIndex: 3,
            eventName: 'Transfer',
            decodedArgs,
            address: contractAddress,
            isFinalized: false,
          },
        ] as unknown as Awaited<ReturnType<typeof exportService.fetchFilteredEventsForExport>>,
      );

    const res = await app.request(`${exportBase}?argFilters=${encodeURIComponent('{"note":"a,b"}')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(
      new RegExp(`^attachment; filename="events-${chainId}-${contractAddress}-[^"]+\\.csv"$`),
    );

    const csv = await res.text();
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      'block_number',
      'block_timestamp',
      'tx_hash',
      'log_index',
      'event_name',
      'decoded_args',
      'address',
      'is_finalized',
    ]);
    expect(rows[1]).toEqual([
      '18000001',
      new Date(1700000000 * 1000).toISOString(),
      '0xabc0000000000000000000000000000000000000000000000000000000000def',
      '3',
      'Transfer',
      decodedArgs,
      contractAddress,
      // Unfinalized rows still export (no behavior break); the flag is a column.
      'false',
    ]);
    // The export filter must reach the count/fetch queries.
    expect(countSpy).toHaveBeenCalledWith(
      chainId,
      contractAddress,
      expect.objectContaining({ argFilters: { note: 'a,b' } }),
    );
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('rejects exports above the 100k row cap instead of truncating', async () => {
    const _countSpy = vi
      .spyOn(exportService, 'getFilteredEventCount')
      .mockResolvedValue(exportService.EXPORT_MAX_ROWS + 1);
    const fetchSpy = vi
      .spyOn(exportService, 'fetchFilteredEventsForExport')
      .mockResolvedValue([]);

    const res = await app.request(exportBase);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Export limit exceeded');
    expect(data.message).toBe('Export limited to 100,000 rows; narrow your filters');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows exports at exactly the cap', async () => {
    vi.spyOn(exportService, 'getFilteredEventCount').mockResolvedValue(
      exportService.EXPORT_MAX_ROWS,
    );
    vi.spyOn(exportService, 'fetchFilteredEventsForExport').mockResolvedValue([]);

    const res = await app.request(exportBase);
    expect(res.status).toBe(200);
  });

  it('rejects malformed argFilters with 400', async () => {
    const res = await app.request(`${exportBase}?argFilters=not-json`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid argFilters');
  });

  it('rejects unsupported chains and invalid addresses', async () => {
    const badChain = await app.request(`/api/chains/99999/contracts/${contractAddress}/events/export`);
    expect(badChain.status).toBe(400);

    const badAddress = await app.request(`/api/chains/${chainId}/contracts/0xinvalid/events/export`);
    expect(badAddress.status).toBe(400);
  });
});
