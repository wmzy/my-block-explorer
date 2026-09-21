// SignatureService behavior: DuckDB-first caching with immutable hits,
// TTL-bounded NOT_FOUND rows, one batched openchain round trip per flush
// with in-flight dedup, and honest { unavailable } degradation on upstream
// failure. The database client and global fetch are mocked — no network,
// no DuckDB file lock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Partial mock: the real signatureCache table export stays intact so
// drizzle operators receive real columns; only the db client is faked.
const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return {
    ...actual,
    db: mockDb,
  };
});

import {
  signatureService,
  type SelectorLookup,
  type SignatureLookupOutcome,
} from '@/services/SignatureService';

const MS_PER_HOUR = 1000 * 60 * 60;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * MS_PER_HOUR);

const FN_SELECTOR = '0xa9059cbb'; // transfer(address,uint256)
const FN_SELECTOR_2 = '0x23b872dd'; // transferFrom(address,address,uint256)
const EVENT_TOPIC0 = `0x${'dd'.repeat(32)}`;

const fn = (selector: string): SelectorLookup => ({ kind: 'function', selector });
const ev = (selector: string): SelectorLookup => ({ kind: 'event', selector });

// Narrows an outcome to its resolved form for assertions; unavailable and
// absent outcomes collapse to an empty list, which every expectation below
// would catch as a mismatch.
const signaturesOf = (
  outcome: SignatureLookupOutcome | undefined,
): string[] => (outcome !== undefined && 'signatures' in outcome ? outcome.signatures : []);

// A minimal openchain-shaped payload: names carry the candidate list in
// popularity order; absent selectors mean "no match". Entry shapes are
// deliberately unknown — malformed-candidate handling is under test.
const openchainPayload = (overrides: {
  function?: Record<string, unknown[]>;
  event?: Record<string, unknown[]>;
} = {}) => ({
  ok: true,
  result: {
    function: overrides.function ?? {},
    event: overrides.event ?? {},
  },
});

const okResponse = (payload: unknown) =>
  ({ ok: true, json: async () => payload }) as unknown as Response;

const selectReturns = (rows: unknown[]) =>
  mockDb.select.mockImplementation(() => ({
    from: () => ({
      where: async () => rows,
    }),
  }));

const insertCapture = () => {
  const captured: unknown[] = [];
  mockDb.insert.mockImplementation(() => ({
    values: (value: unknown) => ({
      onConflictDoUpdate: async () => {
        captured.push(value);
      },
    }),
  }));
  return captured;
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  selectReturns([]);
  insertCapture();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignatureService - database-first resolution', () => {
  it('serves a cached hit from the database without any upstream fetch', async () => {
    selectReturns([
      {
        kind: 'function',
        selector: FN_SELECTOR,
        signature: JSON.stringify(['transfer(address,uint256)']),
        source: 'openchain',
        // Hits are immutable: no TTL applies however old the row is.
        fetchedAt: hoursAgo(30 * 24),
      },
    ]);

    const results = await signatureService.lookup([fn(FN_SELECTOR)]);

    expect(results.get(FN_SELECTOR)).toEqual({
      kind: 'function',
      signatures: ['transfer(address,uint256)'],
      source: 'openchain',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('serves a fresh NOT_FOUND row as a cached miss without refetching', async () => {
    selectReturns([
      { kind: 'function', selector: FN_SELECTOR, signature: null, fetchedAt: hoursAgo(1) },
    ]);

    const results = await signatureService.lookup([fn(FN_SELECTOR)]);

    expect(results.get(FN_SELECTOR)).toEqual({
      kind: 'function',
      signatures: [],
      notFound: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('refetches an expired NOT_FOUND row and re-persists the answer', async () => {
    selectReturns([
      {
        kind: 'function',
        selector: FN_SELECTOR,
        signature: null,
        // One hour past the 24h negative window.
        fetchedAt: hoursAgo(25),
      },
    ]);
    fetchMock.mockResolvedValue(
      okResponse(openchainPayload({ function: { [FN_SELECTOR]: [{ name: 'transfer(address,uint256)' }] } })),
    );
    const captured = insertCapture();

    const results = await signatureService.lookup([fn(FN_SELECTOR)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.get(FN_SELECTOR)).toEqual({
      kind: 'function',
      signatures: ['transfer(address,uint256)'],
      source: 'openchain',
    });
    // The stale negative row is refreshed in place by the upsert.
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject([
      { kind: 'function', selector: FN_SELECTOR, signature: '["transfer(address,uint256)"]' },
    ]);
  });

  it('treats a corrupt cached payload as a miss and overwrites it', async () => {
    selectReturns([
      { kind: 'function', selector: FN_SELECTOR, signature: 'not json', fetchedAt: hoursAgo(1) },
    ]);
    fetchMock.mockResolvedValue(
      okResponse(openchainPayload({ function: { [FN_SELECTOR]: [{ name: 'transfer(address,uint256)' }] } })),
    );
    const captured = insertCapture();

    const results = await signatureService.lookup([fn(FN_SELECTOR)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signaturesOf(results.get(FN_SELECTOR))).toEqual(['transfer(address,uint256)']);
    expect(captured).toHaveLength(1);
  });
});

describe('SignatureService - openchain fetch and persistence', () => {
  it('persists all candidates in openchain order and answers per selector', async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        openchainPayload({
          function: {
            [FN_SELECTOR]: [{ name: 'transfer(address,uint256)' }, { name: 'foo(bytes32)' }],
          },
          event: { [EVENT_TOPIC0]: [{ name: 'Swap(address,uint256,uint256)' }] },
        }),
      ),
    );
    const captured = insertCapture();

    const results = await signatureService.lookup([fn(FN_SELECTOR), ev(EVENT_TOPIC0)]);

    expect(results.get(FN_SELECTOR)).toEqual({
      kind: 'function',
      signatures: ['transfer(address,uint256)', 'foo(bytes32)'],
      source: 'openchain',
    });
    expect(results.get(EVENT_TOPIC0)).toEqual({
      kind: 'event',
      signatures: ['Swap(address,uint256,uint256)'],
      source: 'openchain',
    });
    // One batched round trip for the mixed request: both kinds ride the
    // same URL as comma-joined params.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`function=${FN_SELECTOR}`);
    expect(url).toContain(`event=${EVENT_TOPIC0}`);

    // Found candidates persist with their full ordered list.
    expect(captured[0]).toMatchObject([
      { kind: 'function', selector: FN_SELECTOR, signature: JSON.stringify(['transfer(address,uint256)', 'foo(bytes32)']) },
      { kind: 'event', selector: EVENT_TOPIC0, signature: JSON.stringify(['Swap(address,uint256,uint256)']) },
    ]);
  });

  it('persists upstream misses as null-signature rows', async () => {
    fetchMock.mockResolvedValue(okResponse(openchainPayload()));
    const captured = insertCapture();

    const results = await signatureService.lookup([fn(FN_SELECTOR)]);

    expect(results.get(FN_SELECTOR)).toEqual({
      kind: 'function',
      signatures: [],
      notFound: true,
    });
    expect(captured[0]).toMatchObject([
      { kind: 'function', selector: FN_SELECTOR, signature: null },
    ]);
  });

  it('resolves { unavailable } on upstream failure and persists nothing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const results = await signatureService.lookup([fn(FN_SELECTOR)]);

    expect(results.get(FN_SELECTOR)).toEqual({ unavailable: true });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('treats a non-OK response or a bad envelope as unavailable', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(signatureService.lookup([fn(FN_SELECTOR)])).resolves.toEqual(
      new Map([[FN_SELECTOR, { unavailable: true }]]),
    );

    fetchMock.mockResolvedValueOnce(okResponse({ ok: false, result: {} }));
    await expect(signatureService.lookup([fn(FN_SELECTOR)])).resolves.toEqual(
      new Map([[FN_SELECTOR, { unavailable: true }]]),
    );

    // ok:true but result not an object — still unavailable, never a
    // fabricated "not found".
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: 'nope' }));
    await expect(signatureService.lookup([fn(FN_SELECTOR)])).resolves.toEqual(
      new Map([[FN_SELECTOR, { unavailable: true }]]),
    );
  });

  it('drops malformed candidate entries but keeps the well-formed ones', async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        openchainPayload({
          function: {
            [FN_SELECTOR]: [{ name: 'transfer(address,uint256)' }, { noName: true }, { name: 42 }, 'junk'],
          },
        }),
      ),
    );

    const results = await signatureService.lookup([fn(FN_SELECTOR)]);

    expect(signaturesOf(results.get(FN_SELECTOR))).toEqual(['transfer(address,uint256)']);
  });

  it('shares one upstream round trip between concurrent lookups of the same selector', async () => {
    fetchMock.mockResolvedValue(
      okResponse(openchainPayload({ function: { [FN_SELECTOR]: [{ name: 'transfer(address,uint256)' }] } })),
    );

    const [a, b] = await Promise.all([
      signatureService.lookup([fn(FN_SELECTOR)]),
      signatureService.lookup([fn(FN_SELECTOR)]),
    ]);

    expect(a.get(FN_SELECTOR)).toEqual(b.get(FN_SELECTOR));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('batches the misses of one call into a single request', async () => {
    fetchMock.mockResolvedValue(okResponse(openchainPayload()));

    await signatureService.lookup([fn(FN_SELECTOR), fn(FN_SELECTOR_2), ev(EVENT_TOPIC0)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    // URLSearchParams encodes the batch separators; the upstream decodes
    // them back to openchain's comma convention.
    expect(url).toContain(`function=${FN_SELECTOR}%2C${FN_SELECTOR_2}`);
    expect(url).toContain(`event=${EVENT_TOPIC0}`);
  });

  it('still answers every selector when the cache read fails', async () => {
    mockDb.select.mockImplementation(() => {
      throw new Error('duckdb read failed');
    });
    fetchMock.mockResolvedValue(
      okResponse(openchainPayload({ function: { [FN_SELECTOR]: [{ name: 'transfer(address,uint256)' }] } })),
    );

    const results = await signatureService.lookup([fn(FN_SELECTOR)]);

    expect(signaturesOf(results.get(FN_SELECTOR))).toEqual(['transfer(address,uint256)']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
