// Route-level contract of the optional `stateOverride` body field on
// POST /chains/:chainId/contracts/:address/simulate and .../estimate-gas
// (eth_call-style state overrides, foundry parity). The services are
// stubbed at the module boundary so these tests pin the route↔validator↔
// service seam without any RPC or DuckDB access: absent or {} must reach
// the service as undefined (byte-identical legacy behavior), a valid map
// must arrive parsed but untouched (hex strings, no numeric coercion),
// and every invalid shape must 400 with `invalid_state_override` plus
// field-path'd detail sentences naming the offending address and field.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// The route module pulls the RPC/verification-oriented services for its
// OTHER endpoints; stubbed so this test imports only the simulate /
// estimate-gas paths' real code (same set as contractDirectoryRoutes).
vi.mock('@/services/IdeService', () => ({
  detectInstalledIdes: () => [],
  getDetectedIdesInfo: () => ({}),
  openInIde: vi.fn(),
}));
vi.mock('@/services/BlockService', () => ({ blockService: {} }));
vi.mock('@/services/TransactionService', () => ({ transactionService: {} }));
vi.mock('@/services/AddressService', () => ({ addressService: {} }));

import app from '@/routes/contracts';
import { parseStateOverride } from '@/utils/stateOverride';

const CONTRACT = '0xabc0000000000000000000000000000000000001';
const OVERRIDE_ADDR = '0xdef0000000000000000000000000000000000002';
const MIXED_CASE_ADDR = `0xAbC${'0'.repeat(37)}`;
const SLOT = `0x${'01'.padStart(64, '0')}`;
const VALUE_32 = `0x${'ab'.repeat(32)}`;
// 62 hex chars — one byte short of a 32-byte storage value.
const VALUE_31 = `0x${'ab'.repeat(31)}`;
const CODE = '0x6001600101';

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const simulate = (body: unknown) => post(`/chains/1/contracts/${CONTRACT}/simulate`, body);
const estimateGas = (body: unknown) => post(`/chains/1/contracts/${CONTRACT}/estimate-gas`, body);

const simulateParams = () => vi.mocked(mocks.simulateContractWithABI).mock.calls.at(-1)?.[0];
const estimateParams = () => vi.mocked(mocks.estimateContractGasWithABI).mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
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

describe('parseStateOverride (pure validator)', () => {
  it('rejects a leading-zero hex quantity with a field-path detail', () => {
    const parsed = parseStateOverride({ [OVERRIDE_ADDR]: { balance: '0x01' } });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.details).toHaveLength(1);
      expect(parsed.details[0]).toContain(`${OVERRIDE_ADDR}.balance`);
    }
  });

  it('accepts canonical zero and preserves the address key casing as given', () => {
    const parsed = parseStateOverride({ [MIXED_CASE_ADDR]: { nonce: '0x0' } });
    expect(parsed).toEqual({ ok: true, value: { [MIXED_CASE_ADDR]: { nonce: '0x0' } } });
  });

  it('rejects odd-length bytecode', () => {
    const parsed = parseStateOverride({ [OVERRIDE_ADDR]: { code: '0x606' } });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details[0]).toContain(`${OVERRIDE_ADDR}.code`);
  });

  it('rejects an entry with no fields at all', () => {
    const parsed = parseStateOverride({ [OVERRIDE_ADDR]: {} });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details[0]).toContain('at least one override field');
  });

  it('caps stateOverride at 10 addresses and each map at 32 slots', () => {
    const addresses: Record<string, { balance: string }> = {};
    for (let i = 0; i < 11; i++) {
      addresses[`0x${i.toString(16).padStart(40, '0')}`] = { balance: '0x1' };
    }
    expect(parseStateOverride(addresses).ok).toBe(false);

    const slots: Record<string, string> = {};
    for (let i = 0; i < 33; i++) {
      slots[`0x${i.toString(16).padStart(64, '0')}`] = VALUE_32;
    }
    const tooManySlots = parseStateOverride({ [OVERRIDE_ADDR]: { state: slots } });
    expect(tooManySlots.ok).toBe(false);
    if (!tooManySlots.ok) {
      expect(tooManySlots.details[0]).toContain(`${OVERRIDE_ADDR}.state`);
      expect(tooManySlots.details[0]).toContain('max 32');
    }
  });
});

describe('POST /chains/:chainId/contracts/:address/simulate stateOverride', () => {
  it('passes undefined to the service when the field is absent', async () => {
    const res = await simulate({ functionName: 'mint' });

    expect(res.status).toBe(200);
    expect(mocks.simulateContractWithABI).toHaveBeenCalledTimes(1);
    expect(simulateParams()?.stateOverride).toBeUndefined();
    // The success response shape is unchanged by the optional field.
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.functionName).toBe('mint');
    expect('stateOverride' in body).toBe(false);
  });

  it('treats an empty override object exactly like an absent one', async () => {
    const res = await simulate({ functionName: 'mint', stateOverride: {} });

    expect(res.status).toBe(200);
    expect(mocks.simulateContractWithABI).toHaveBeenCalledTimes(1);
    expect(simulateParams()?.stateOverride).toBeUndefined();
  });

  it('hands the service the parsed single-address override with hex strings as given', async () => {
    const stateOverride = {
      [OVERRIDE_ADDR]: { balance: '0xdeadbeef', nonce: '0x7', code: CODE },
    };
    const res = await simulate({ functionName: 'mint', stateOverride });

    expect(res.status).toBe(200);
    expect(simulateParams()?.stateOverride).toEqual(stateOverride);
  });

  it('passes valid state and stateDiff 32-byte slot maps through', async () => {
    const stateOverride = {
      [OVERRIDE_ADDR]: {
        state: { [SLOT]: VALUE_32 },
        stateDiff: { [`0x${'02'.padStart(64, '0')}`]: VALUE_32 },
      },
    };
    const res = await simulate({ functionName: 'mint', stateOverride });

    expect(res.status).toBe(200);
    expect(simulateParams()?.stateOverride).toEqual(stateOverride);
  });

  it('rejects a 31-byte storage value with a detail naming the address and field', async () => {
    const res = await simulate({
      functionName: 'mint',
      stateOverride: { [OVERRIDE_ADDR]: { state: { [SLOT]: VALUE_31 } } },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_state_override');
    expect(body.details.some((d: string) => d.startsWith(`${OVERRIDE_ADDR}.state[`))).toBe(true);
    // Invalid input fails fast: no source fetch, no service call.
    expect(mocks.getContractSource).not.toHaveBeenCalled();
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });

  it('rejects an unknown entry field by naming it', async () => {
    const res = await simulate({
      functionName: 'mint',
      stateOverride: { [OVERRIDE_ADDR]: { foo: '0x1' } },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_state_override');
    expect(body.details.some((d: string) => d.includes('.foo'))).toBe(true);
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });

  it('rejects 11 addresses (cap 10)', async () => {
    const stateOverride: Record<string, { balance: string }> = {};
    for (let i = 0; i < 11; i++) {
      stateOverride[`0x${i.toString(16).padStart(40, '0')}`] = { balance: '0x1' };
    }
    const res = await simulate({ functionName: 'mint', stateOverride });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_state_override');
    expect(body.details.some((d: string) => d.includes('max 10'))).toBe(true);
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });

  it('rejects 33 slots in one state map (cap 32)', async () => {
    const slots: Record<string, string> = {};
    for (let i = 0; i < 33; i++) {
      slots[`0x${i.toString(16).padStart(64, '0')}`] = VALUE_32;
    }
    const res = await simulate({
      functionName: 'mint',
      stateOverride: { [OVERRIDE_ADDR]: { state: slots } },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_state_override');
    expect(body.details.some((d: string) => d.includes(`${OVERRIDE_ADDR}.state`))).toBe(true);
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });

  it('rejects non-object stateOverride values (array, string)', async () => {
    for (const bad of [[{ balance: '0x1' }], '0x1', 5]) {
      const res = await simulate({ functionName: 'mint', stateOverride: bad });
      expect(res.status, `stateOverride=${JSON.stringify(bad)}`).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_state_override');
      expect(body.details.some((d: string) => d.startsWith('stateOverride:'))).toBe(true);
    }
    expect(mocks.simulateContractWithABI).not.toHaveBeenCalled();
  });
});

describe('POST /chains/:chainId/contracts/:address/estimate-gas stateOverride', () => {
  it('passes undefined to the service when the field is absent', async () => {
    const res = await estimateGas({ functionName: 'mint' });

    expect(res.status).toBe(200);
    expect(mocks.estimateContractGasWithABI).toHaveBeenCalledTimes(1);
    expect(estimateParams()?.stateOverride).toBeUndefined();
    const body = await res.json();
    expect(body.gasLimit).toBe('50000');
  });

  it('shares the validator: an invalid override 400s before the service', async () => {
    const res = await estimateGas({
      functionName: 'mint',
      stateOverride: { [OVERRIDE_ADDR]: { balance: 'not-hex' } },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_state_override');
    expect(body.details.some((d: string) => d.startsWith(`${OVERRIDE_ADDR}.balance`))).toBe(true);
    expect(mocks.estimateContractGasWithABI).not.toHaveBeenCalled();
  });
});
