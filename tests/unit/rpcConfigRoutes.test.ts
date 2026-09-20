/**
 * Route-level behavior of POST /rpc-configs: chainId must be a positive
 * integer naming a supported chain and url an absolute http(s) URL —
 * violations answer 400 with a machine-readable `code` and a human-readable
 * reason. Successful upserts report whether the row was created or replaced
 * (additive `action` field) and hot-reload the RPC manager. The DB and RPC
 * manager are mocked; these tests pin the validation contract, not the
 * storage semantics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isChainSupported } from '@/config/chains';

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  reloadConfigs: vi.fn(),
  // Rows the upsert's existence select resolves with.
  rows: [] as Array<Record<string, unknown>>,
  insertValues: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('@/middleware/admin-token', () => ({
  requireAdminTokenIfConfigured: mocks.gate,
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { reloadConfigs: mocks.reloadConfigs },
}));

vi.mock('@/database/init', () => ({
  userRpcConfigs: {},
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([...mocks.rows])),
      })),
    })),
    insert: vi.fn(() => ({ values: mocks.insertValues })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: mocks.updateWhere })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
  },
}));

import app from '@/routes/rpc-config';

const request = (path: string, init?: RequestInit) => app.request(path, init);

const post = (body: unknown) =>
  request('/rpc-configs', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

const VALID = { chainId: 1, name: 'Mainnet custom', url: 'https://eth.llamarpc.xyz' };

// Far outside any real chain id; asserted so the test fails loudly if viem
// ever grows a chain with this id.
const UNSUPPORTED_CHAIN_ID = 2 ** 40;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockImplementation(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  });
  mocks.rows.length = 0;
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.updateWhere.mockResolvedValue(undefined);
  mocks.reloadConfigs.mockResolvedValue(undefined);
});

describe('POST /rpc-configs field validation', () => {
  it('rejects an unparseable URL with 400 invalid_url', async () => {
    const res = await post({ ...VALID, url: 'not a url' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_url');
    expect(typeof body.message).toBe('string');
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) scheme with 400 invalid_url', async () => {
    const res = await post({ ...VALID, url: 'ws://localhost:8545' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_url');
    expect(body.message).toContain('http');
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('rejects a non-string url with 400 invalid_url', async () => {
    const res = await post({ ...VALID, url: 42 });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_url');
  });

  it('rejects a non-integer chainId with 400 invalid_chain_id', async () => {
    const res = await post({ ...VALID, chainId: 1.5 });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_chain_id');
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('rejects a non-positive chainId with 400 invalid_chain_id', async () => {
    // Note: chainId 0 is falsy and classifies as missing_fields; -1 is
    // truthy and reaches the integer/positivity check.
    const res = await post({ ...VALID, chainId: -1 });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_chain_id');
  });

  it('rejects a chainId that names no supported chain with 400 invalid_chain_id', async () => {
    expect(isChainSupported(UNSUPPORTED_CHAIN_ID)).toBe(false);

    const res = await post({ ...VALID, chainId: UNSUPPORTED_CHAIN_ID });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_chain_id');
    expect(body.message).toContain(String(UNSUPPORTED_CHAIN_ID));
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body with 400 invalid_json instead of 500', async () => {
    const res = await post('{not json');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_json');
  });

  it('still rejects missing required fields with 400', async () => {
    const res = await post({ chainId: 1, url: VALID.url });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('missing_fields');
  });

  it('rejects a non-string name with 400 invalid_name', async () => {
    const res = await post({ ...VALID, name: 42 });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_name');
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('rejects mistyped optional fields with 400 invalid_fields', async () => {
    const res = await post({ ...VALID, maxEventRange: 'lots' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_fields');
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});

describe('POST /rpc-configs upsert action', () => {
  it('reports action "created" for a new row and reloads RPC configs', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('created');
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.reloadConfigs).toHaveBeenCalledTimes(1);
  });

  it('reports action "replaced" when a config already exists for the chain', async () => {
    mocks.rows.push({ chainId: 1 });

    const res = await post(VALID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('replaced');
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.reloadConfigs).toHaveBeenCalledTimes(1);
  });
});
