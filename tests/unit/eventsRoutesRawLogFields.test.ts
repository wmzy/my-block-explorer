/**
 * Response-field contract for GET .../events: the raw log fields stored on
 * contract_events rows (topic0..topic3, data hex, logIndex, emitting
 * contractAddress, tx identity) pass through to the API response verbatim —
 * the additive surface the EventTable raw-log disclosure renders from. The
 * service is mocked with a fixture row (mirroring the drizzle row shape),
 * so the test pins the route wiring only: no DB, no network. If a future
 * projection ever narrows the response, the disclosure would silently
 * degrade to "not stored" — this is the tripwire.
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

const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DATA_HEX = `0x${'ab'.repeat(64)}`;

// Fixture row in the shape getContractEvents returns (drizzle row over the
// contract_events table; BIGNUM values surface as BigInt and serialize to
// strings via safeJsonResponse).
const fixtureRow = {
  chainId: CHAIN_ID,
  contractAddress: ADDRESS,
  blockNumber: 123n,
  blockTimestamp: '2023-11-14T22:13:20.000Z',
  transactionHash: TX_HASH,
  transactionIndex: 5,
  logIndex: 4,
  eventName: 'Transfer',
  eventSignature: TRANSFER_TOPIC0,
  decodedArgs: '{"from":"0x1111111111111111111111111111111111111111"}',
  topic0: TRANSFER_TOPIC0,
  topic1: `0x${'11'.repeat(32)}`,
  topic2: null,
  topic3: null,
  data: DATA_HEX,
  isFinalized: true,
  indexedAt: '2023-11-14T22:14:00.000Z',
};

const request = (path: string, init?: RequestInit) => app.request(path, init);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockImplementation(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  });
  mocks.getContractEvents.mockResolvedValue({
    events: [fixtureRow],
    total: 1,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  });
});

describe('GET .../events raw log fields', () => {
  it('returns the stored raw log fields on every row, unmodified', async () => {
    const res = await request(BASE);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<Record<string, unknown>>;
    };
    expect(body.events).toHaveLength(1);
    const row = body.events[0];

    // Raw log payload — what the raw-log disclosure renders.
    expect(row.topic0).toBe(TRANSFER_TOPIC0);
    expect(row.topic1).toBe(`0x${'11'.repeat(32)}`);
    expect(row.topic2).toBeNull();
    expect(row.topic3).toBeNull();
    expect(row.data).toBe(DATA_HEX);
    // Log identity and emitting address.
    expect(row.logIndex).toBe(4);
    expect(row.transactionIndex).toBe(5);
    expect(row.contractAddress).toBe(ADDRESS);
    expect(row.transactionHash).toBe(TX_HASH);
    // BIGNUM serializes to a string, never a lossy number.
    expect(String(row.blockNumber)).toBe('123');
    // The decoded side rides along unchanged.
    expect(row.eventName).toBe('Transfer');
    expect(row.eventSignature).toBe(TRANSFER_TOPIC0);
    expect(row.isFinalized).toBe(true);
  });

  it('keeps null raw fields null for legacy rows instead of fabricating values', async () => {
    mocks.getContractEvents.mockResolvedValue({
      events: [
        {
          chainId: CHAIN_ID,
          contractAddress: ADDRESS,
          blockNumber: 99n,
          blockTimestamp: null,
          transactionHash: TX_HASH,
          transactionIndex: null,
          logIndex: 0,
          eventName: 'Unknown',
          eventSignature: null,
          decodedArgs: '{}',
          topic0: null,
          topic1: null,
          topic2: null,
          topic3: null,
          data: null,
          isFinalized: false,
          indexedAt: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    const res = await request(BASE);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<Record<string, unknown>> };
    const row = body.events[0];
    for (const field of ['topic0', 'topic1', 'topic2', 'topic3', 'data']) {
      expect(row[field]).toBeNull();
    }
  });
});
