// Route-level contract for the POST bodies of /simulate and /estimate-gas
// beyond the stateOverride field (see stateOverrideRoute.test.ts): junk
// must fail loudly with a specific 400, never escape the generic catch as
// an opaque 500 'Failed to simulate/estimate'. Pins:
// - malformed JSON body → 400 invalid_json (rpc-config.ts contract);
// - wei `value` outside the 0x-hex / decimal-integer grammar ('1.5',
//   'abc', fractional numbers) → 400 invalid_value;
// - valid quantities (decimal string, 0x-hex string, integer number,
//   absent) reach the service converted to bigint exactly like the old
//   inline BigInt() call — absent stays undefined.
// Services are stubbed at the module boundary (same set as
// stateOverrideRoute.test.ts) so no RPC or DuckDB access happens.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRateLimitStats, resetRateLimiterState } from '@/middleware/rate-limit';

const mocks = vi.hoisted(() => ({
  getContractSource: vi.fn(),
  simulateContractWithABI: vi.fn(),
  estimateContractGasWithABI: vi.fn(),
}));

vi.mock('@/database/init', () => ({
  db: {},
  contractSources: {},
  addressLabels: {},
}));

vi.mock('@/services/ContractSourceService', () => ({
  contractSourceService: { getContractSource: mocks.getContractSource },
}));
vi.mock('@/services/ContractInteractionService', () => ({
  contractInteractionService: {
    simulateContractWithABI: mocks.simulateContractWithABI,
    estimateContractGasWithABI: mocks.estimateContractGasWithABI,
  },
}));

vi.mock('@/services/IdeService', () => ({
  detectInstalledIdes: () => [],
  getDetectedIdesInfo: () => ({}),
  openInIde: vi.fn(),
}));
vi.mock('@/services/BlockService', () => ({ blockService: {} }));
vi.mock('@/services/TransactionService', () => ({ transactionService: {} }));
vi.mock('@/services/AddressService', () => ({ addressService: {} }));

import app from '@/routes/contracts';

const CONTRACT = '0xabc0000000000000000000000000000000000001';

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const simulate = (body: unknown) => post(`/chains/1/contracts/${CONTRACT}/simulate`, body);
const estimateGas = (body: unknown) => post(`/chains/1/contracts/${CONTRACT}/estimate-gas`, body);

const simulateParams = () => vi.mocked(mocks.simulateContractWithABI).mock.calls.at(-1)?.[0];
const estimateParams = () => vi.mocked(mocks.estimateContractGasWithABI).mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  // In-process limiter buckets are shared across tests (module scope);
  // starting each test at full tokens keeps the burst math below exact.
  resetRateLimiterState();
  mocks.getContractSource.mockResolvedValue({
    abi: JSON.stringify([
      { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [], outputs: [] },
    ]),
  });
  mocks.simulateContractWithABI.mockResolvedValue({
    success: true,
    result: '0x1',
    gasUsed: 50_000n,
  });
  mocks.estimateContractGasWithABI.mockResolvedValue({ gasLimit: 50_000n });
});

describe('POST .../simulate value validation', () => {
  it('rejects a fractional string value with 400 invalid_value before the service', async () => {
    const res = await simulate({ functionName: 'mint', value: '1.5' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_value',
      message: 'value must be a 0x-hex or decimal integer quantity',
    });
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric string value with 400 invalid_value', async () => {
    const res = await simulate({ functionName: 'mint', value: 'abc' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_value' });
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });

  it('rejects a fractional number value with 400 invalid_value', async () => {
    const res = await simulate({ functionName: 'mint', value: 1.5 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_value' });
  });

  it('rejects a lossy JSON number value with 400 invalid_value', async () => {
    // The body literal 1000000000000000001 was already rounded by
    // JSON.parse to 1000000000000000000 before the handler saw it, so an
    // isInteger-only check forwards a wei amount the caller never wrote —
    // the eth_call would be made with a different value than requested.
    const res = await simulate({ functionName: 'mint', value: 1000000000000000000 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_value' });
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });

  it('converts a decimal integer string exactly like the old inline BigInt()', async () => {
    const res = await simulate({ functionName: 'mint', value: '1000000000000000000' });

    expect(res.status).toBe(200);
    expect(simulateParams()?.value).toBe(1_000_000_000_000_000_000n);
  });

  it('converts a 0x-hex string value', async () => {
    const res = await simulate({ functionName: 'mint', value: '0xde0b6b' });

    expect(res.status).toBe(200);
    expect(simulateParams()?.value).toBe(0xde0b6bn);
  });

  it('keeps an absent value as undefined', async () => {
    const res = await simulate({ functionName: 'mint' });

    expect(res.status).toBe(200);
    expect(simulateParams()?.value).toBeUndefined();
  });
});

describe('POST .../estimate-gas value validation', () => {
  it('rejects a junk string value with 400 invalid_value before the service', async () => {
    const res = await estimateGas({ functionName: 'mint', value: 'abc' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_value' });
    expect(mocks.estimateContractGasWithABI).not.toHaveBeenCalled();
  });

  it('converts an integer number value to bigint', async () => {
    const res = await estimateGas({ functionName: 'mint', value: 5 });

    expect(res.status).toBe(200);
    expect(estimateParams()?.value).toBe(5n);
  });
});

describe('malformed JSON bodies', () => {
  it('answers 400 invalid_json on simulate instead of 500 Failed to simulate', async () => {
    const res = await simulate('{not json');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_json',
      message: 'Request body must be valid JSON',
    });
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json on estimate-gas instead of 500 Failed to estimate', async () => {
    const res = await estimateGas('{not json');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_json' });
    expect(mocks.estimateContractGasWithABI).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json on read instead of 500 Failed to read', async () => {
    const res = await post(`/chains/1/contracts/${CONTRACT}/read`, '{not json');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_json' });
    expect(mocks.getContractSource).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json on open-in-ide instead of a generic 500', async () => {
    const res = await post(`/chains/1/contracts/${CONTRACT}/open-in-ide`, '{not json');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_json' });
  });
});

describe('POST .../estimate-gas rate limiting — 60/min, burst 20', () => {
  it('admits the burst then answers 429 with Retry-After', async () => {
    const responses = await Promise.all(
      Array.from({ length: 21 }, () => estimateGas({ functionName: 'mint' })),
    );

    expect(responses.slice(0, 20).map(r => r.status)).toEqual(Array.from({ length: 20 }, () => 200));
    expect(responses[20].status).toBe(429);
    expect(responses[20].headers.get('Retry-After')).toMatch(/^\d+$/);
    // The 429 answers before any handler: the 21st call must not have
    // reached the service at all.
    expect(mocks.estimateContractGasWithABI).toHaveBeenCalledTimes(20);
  });

  it('runs on its own bucket (independent of the simulate quota)', async () => {
    await estimateGas({ functionName: 'mint' });

    const own = getRateLimitStats().find(bucket => bucket.name === 'contract-estimate-gas');
    expect(own).toMatchObject({ capacity: 20, requestsPerMinute: 60, hits: 1, rejected: 0 });

    const simulateBucket = getRateLimitStats().find(bucket => bucket.name === 'contracts-simulate');
    expect(simulateBucket?.hits ?? 0).toBe(0);
  });
});
