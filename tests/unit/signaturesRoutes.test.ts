// Signature routes contract: selector validation (shape per kind), the
// 25-selector cap, repeatable/comma-batched param parsing, and the
// { results: { [selector]: outcome } } mapping. The service is mocked —
// these tests pin the route wiring, not service semantics (mirroring
// eventsRoutesErrorBodies.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock('@/services/SignatureService', () => ({
  signatureService: { lookup: mocks.lookup },
}));

import app from '@/routes/signatures';

const FN_SELECTOR = '0xa9059cbb';
const FN_SELECTOR_2 = '0x23b872dd';
const EVENT_TOPIC0 = `0x${'ab'.repeat(32)}`;

const request = (path: string) => app.request(path);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue(new Map());
});

describe('GET /signatures - selector validation', () => {
  it('rejects a malformed function selector with 400 invalid_selector', async () => {
    const res = await request('/signatures?function=0x1234');

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_selector');
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('rejects a selector whose shape does not match its kind', async () => {
    // A 32-byte value under the function param is a kind confusion, not a
    // function selector.
    const res = await request(`/signatures?function=${EVENT_TOPIC0}`);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_selector');

    // And the mirror case: 4-byte under the event param.
    const res2 = await request(`/signatures?event=${FN_SELECTOR}`);
    expect(res2.status).toBe(400);
    expect(((await res2.json()) as { error: string }).error).toBe('invalid_selector');
  });

  it('rejects non-hex, non-0x and empty-hex bodies', async () => {
    for (const bad of ['0xzzzzzzzz', 'a9059cbb', '0x', '0xa9059cbb0']) {
      const res = await request(`/signatures?function=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_selector');
    }
  });

  it('normalizes case and whitespace instead of rejecting checksummed hex', async () => {
    const res = await request(`/signatures?function=${FN_SELECTOR.toUpperCase()}`);

    expect(res.status).toBe(200);
    expect(mocks.lookup).toHaveBeenCalledWith([{ kind: 'function', selector: FN_SELECTOR }]);
  });
});

describe('GET /signatures - batching contract', () => {
  it('parses repeatable params of both kinds, deduped', async () => {
    const res = await request(
      `/signatures?function=${FN_SELECTOR}&function=${FN_SELECTOR_2}` +
      `&event=${EVENT_TOPIC0}&function=${FN_SELECTOR}`,
    );

    expect(res.status).toBe(200);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(mocks.lookup).toHaveBeenCalledWith([
      { kind: 'function', selector: FN_SELECTOR },
      { kind: 'function', selector: FN_SELECTOR_2 },
      { kind: 'event', selector: EVENT_TOPIC0 },
    ]);
  });

  it('parses comma-batched values in a single param', async () => {
    const res = await request(`/signatures?function=${FN_SELECTOR},${FN_SELECTOR_2}`);

    expect(res.status).toBe(200);
    expect(mocks.lookup).toHaveBeenCalledWith([
      { kind: 'function', selector: FN_SELECTOR },
      { kind: 'function', selector: FN_SELECTOR_2 },
    ]);
  });

  it('treats empty segments and empty params as absent', async () => {
    const res = await request(`/signatures?function=&function=${FN_SELECTOR},`);

    expect(res.status).toBe(200);
    expect(mocks.lookup).toHaveBeenCalledWith([{ kind: 'function', selector: FN_SELECTOR }]);
  });

  it('answers an empty results object for a selector-less request', async () => {
    const res = await request('/signatures');

    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual({});
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('allows at most 25 selectors per call', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `0x${i.toString(16).padStart(8, '0')}`);
    const ok = await request(`/signatures?function=${many.join(',')}`);
    expect(ok.status).toBe(200);

    const tooMany = [...many, FN_SELECTOR].join(',');
    const res = await request(`/signatures?function=${tooMany}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('too_many_selectors');
    // Duplicates do not count toward the cap.
    const dupes = await request(`/signatures?function=${many.join(',')}&function=${many[0]}`);
    expect(dupes.status).toBe(200);
  });
});

describe('GET /signatures - response mapping', () => {
  it('maps service outcomes into a selector-keyed results object', async () => {
    mocks.lookup.mockResolvedValue(
      new Map([
        [FN_SELECTOR, { kind: 'function', signatures: ['transfer(address,uint256)'], source: 'openchain' }],
        [EVENT_TOPIC0, { kind: 'event', signatures: [], notFound: true }],
        ['0xdeadbeef', { unavailable: true }],
      ]),
    );

    const res = await request(`/signatures?function=${FN_SELECTOR}&event=${EVENT_TOPIC0}&function=0xdeadbeef`);

    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual({
      [FN_SELECTOR]: { kind: 'function', signatures: ['transfer(address,uint256)'], source: 'openchain' },
      [EVENT_TOPIC0]: { kind: 'event', signatures: [], notFound: true },
      '0xdeadbeef': { unavailable: true },
    });
  });

  it('answers a 500 error envelope when the service throws', async () => {
    mocks.lookup.mockRejectedValue(new Error('boom'));

    const res = await request(`/signatures?function=${FN_SELECTOR}`);

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('internal_error');
    expect(body.message).toBe('Signature lookup failed');
  });
});
