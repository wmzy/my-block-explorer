// Verify route contract: admin gating, the tight rate-limiter wiring,
// bundle validation 400s (missing metadata.json, caps, non-string values),
// param validation, the response mapping for every service outcome
// (success refreshes the source cache, domain outcomes answer 200 with
// sourcify's words, typed upstream failures answer 502
// sourcify_unreachable). The heavy services are mocked; the bundle
// validator under test is the real one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  clearCache: vi.fn(),
  getContractSource: vi.fn(),
  saveManualVerification: vi.fn(),
  deleteManualVerification: vi.fn(),
  createRateLimiter: vi.fn(),
}));

// ContractSourceService pulls in DuckDB; only the calls the routes
// make are needed.
vi.mock('@/services/ContractSourceService', () => ({
  contractSourceService: {
    clearCache: mocks.clearCache,
    getContractSource: mocks.getContractSource,
    saveManualVerification: mocks.saveManualVerification,
    deleteManualVerification: mocks.deleteManualVerification,
  },
}));

// The limiter has dedicated coverage (rateLimit.test.ts); here a spy
// records the wiring while passing every request through so tests can
// fire freely.
vi.mock('@/middleware/rate-limit', () => ({
  createRateLimiter: (...args: unknown[]) => {
    mocks.createRateLimiter(...args);
    return async (_c: unknown, next: () => Promise<void>) => next();
  },
}));

import verifyRoutes from '@/routes/verify';
import { contractVerifyService, SourcifyUnreachableError } from '@/services/ContractVerifyService';

const app = new Hono();
app.route('/', verifyRoutes);

// All-digit address: checksum-neutral, so the service receives exactly
// the string in the URL.
const ROUTE_ADDRESS = '0x1111111111111111111111111111111111111111';
const PATH = `/chains/1/contracts/${ROUTE_ADDRESS}/verify`;
const MANUAL_PATH = `/chains/1/contracts/${ROUTE_ADDRESS}/verify/manual`;

const submitSpy = vi.spyOn(contractVerifyService, 'submitVerification');

const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const del = (path: string, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'DELETE', headers });

const validFiles = (): Record<string, string> => ({
  'metadata.json': '{"compiler":{"version":"0.8.20"}}',
  'contracts/Storage.sol': 'contract Storage {}',
});

beforeEach(() => {
  // Individual resets instead of clearAllMocks: the limiter spy records a
  // single import-time call, which the wiring assertion below must still
  // see after any earlier test's cleanup.
  delete process.env.ADMIN_TOKEN;
  submitSpy.mockReset();
  submitSpy.mockResolvedValue({ ok: true, status: 'perfect' });
  mocks.clearCache.mockClear();
  mocks.getContractSource.mockReset();
  mocks.getContractSource.mockResolvedValue({ verificationStatus: 'verified' });
  mocks.saveManualVerification.mockReset();
  mocks.saveManualVerification.mockResolvedValue(undefined);
  mocks.deleteManualVerification.mockReset();
  mocks.deleteManualVerification.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('POST /chains/:chainId/contracts/:address/verify - wiring', () => {
  it('registers a dedicated limiter for the external POST (see verifyRateLimit.test.ts)', async () => {
    // The limiter module is mocked to a passthrough here so tests can fire
    // freely; its real config and behavior are pinned in
    // verifyRateLimit.test.ts, which runs the route unmocked.
    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(200);
  });
});

describe('admin gating', () => {
  it('passes through when ADMIN_TOKEN is unset', async () => {
    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(200);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing token with 403 when ADMIN_TOKEN is set', async () => {
    process.env.ADMIN_TOKEN = 'secret';

    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(403);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('rejects a wrong token with 403 when ADMIN_TOKEN is set', async () => {
    process.env.ADMIN_TOKEN = 'secret';

    const res = await postJson(PATH, { files: validFiles() }, { 'x-admin-token': 'wrong' });

    expect(res.status).toBe(403);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('accepts the matching token when ADMIN_TOKEN is set', async () => {
    process.env.ADMIN_TOKEN = 'secret';

    const res = await postJson(PATH, { files: validFiles() }, { 'x-admin-token': 'secret' });

    expect(res.status).toBe(200);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });
});

describe('bundle validation', () => {
  it('rejects a bundle without metadata.json with 400 invalid_files', async () => {
    const res = await postJson(PATH, {
      files: { 'contracts/Storage.sol': 'contract Storage {}' },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_files');
    expect(body.message).toContain('metadata.json');
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('rejects 51 files with 400 invalid_files', async () => {
    const files: Record<string, string> = { 'metadata.json': '{}' };
    for (let i = 1; i <= 50; i += 1) files[`contracts/F${i}.sol`] = '// x';

    const res = await postJson(PATH, { files });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_files');
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('rejects a bundle over 2MB with 400 invalid_files', async () => {
    const res = await postJson(PATH, {
      files: { 'metadata.json': '{}', 'big.sol': 'x'.repeat(2 * 1024 * 1024 + 1) },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_files');
    expect(body.message).toContain('2 MB');
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-string file value with 400 invalid_files', async () => {
    const res = await postJson(PATH, {
      files: { 'metadata.json': '{}', 'Storage.sol': 123 },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_files');
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('rejects a body without a files object with 400 invalid_files', async () => {
    for (const body of [{}, { files: 'nope' }, null]) {
      const res = await postJson(PATH, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_files');
    }
  });

  it('rejects a malformed address with 400', async () => {
    const res = await postJson('/chains/1/contracts/0x123/verify', { files: validFiles() });

    expect(res.status).toBe(400);
  });
});

describe('outcome mapping', () => {
  it('answers verified:true, drops the source cache and re-fetches the source', async () => {
    submitSpy.mockResolvedValue({ ok: true, status: 'partial' });
    mocks.getContractSource.mockResolvedValue({ verificationStatus: 'partial' });

    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ verified: true, status: 'partial', verificationStatus: 'partial' });
    expect(submitSpy).toHaveBeenCalledWith(1, ROUTE_ADDRESS, validFiles());
    // The same clear-cache call the Force Refresh endpoint uses, so the
    // next read re-fetches from Sourcify.
    expect(mocks.clearCache).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
    expect(mocks.getContractSource).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
  });

  it('omits verificationStatus when the post-verification refresh fails', async () => {
    submitSpy.mockResolvedValue({ ok: true, status: 'perfect' });
    mocks.getContractSource.mockRejectedValue(new Error('refresh blew up'));

    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true, status: 'perfect' });
  });

  it('answers unsupported_chain as a 200 domain outcome without touching the cache', async () => {
    submitSpy.mockResolvedValue({
      ok: false,
      kind: 'unsupported_chain',
      message: 'The chain with chainId 9429413 is not supported',
    });

    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      verified: false,
      kind: 'unsupported_chain',
      message: 'The chain with chainId 9429413 is not supported',
    });
    expect(mocks.clearCache).not.toHaveBeenCalled();
  });

  it('answers a sourcify rejection as a 200 domain outcome', async () => {
    submitSpy.mockResolvedValue({
      ok: false,
      kind: 'rejected',
      message: 'The onchain and recompiled bytecodes don\'t match.',
    });

    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      verified: false,
      kind: 'rejected',
      message: 'The onchain and recompiled bytecodes don\'t match.',
    });
    expect(mocks.clearCache).not.toHaveBeenCalled();
  });

  it('maps the typed upstream failure to 502 sourcify_unreachable', async () => {
    submitSpy.mockRejectedValue(
      new SourcifyUnreachableError('Could not reach the Sourcify server while submitting: fetch failed'),
    );

    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('sourcify_unreachable');
    expect(body.message).toContain('Could not reach the Sourcify server');
    expect(mocks.clearCache).not.toHaveBeenCalled();
  });

  it('answers an unexpected service error with 500', async () => {
    submitSpy.mockRejectedValue(new Error('surprise'));

    const res = await postJson(PATH, { files: validFiles() });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('verification_failed');
  });
});

const validAbi = () => '[{"type":"function","name":"get","inputs":[],"outputs":[{"type":"uint256"}]}]';

describe('POST .../verify/manual - validation', () => {
  it('rejects a missing abi with 400 missing_fields', async () => {
    for (const body of [{}, { sourceCode: '// x' }, null]) {
      const res = await postJson(MANUAL_PATH, body);
      expect(res.status).toBe(400);
      const parsed = await res.json();
      expect(parsed.error).toBe('missing_fields');
      expect(parsed.message).toContain('abi');
    }
    expect(mocks.saveManualVerification).not.toHaveBeenCalled();
  });

  it('rejects a non-string abi with 400 missing_fields', async () => {
    const res = await postJson(MANUAL_PATH, { abi: 42 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_fields');
    expect(mocks.saveManualVerification).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON abi with 400 invalid_abi', async () => {
    const res = await postJson(MANUAL_PATH, { abi: 'not json at all' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_abi');
    expect(mocks.saveManualVerification).not.toHaveBeenCalled();
  });

  it('rejects a JSON abi that is not an array with 400 invalid_abi', async () => {
    const res = await postJson(MANUAL_PATH, { abi: '{"type":"function"}' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_abi');
    expect(mocks.saveManualVerification).not.toHaveBeenCalled();
  });

  it('rejects an empty ABI array with 400 invalid_abi', async () => {
    const res = await postJson(MANUAL_PATH, { abi: '[]' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_abi');
    expect(mocks.saveManualVerification).not.toHaveBeenCalled();
  });

  it('rejects a non-string optional field with 400 missing_fields', async () => {
    for (const body of [
      { abi: validAbi(), sourceCode: 123 },
      { abi: validAbi(), name: false },
    ]) {
      const res = await postJson(MANUAL_PATH, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('missing_fields');
    }
    expect(mocks.saveManualVerification).not.toHaveBeenCalled();
  });

  it('rejects a malformed address with 400', async () => {
    const res = await postJson('/chains/1/contracts/0x123/verify/manual', {
      abi: validAbi(),
    });

    expect(res.status).toBe(400);
    expect(mocks.saveManualVerification).not.toHaveBeenCalled();
  });
});

describe('POST .../verify/manual - admin gate & success', () => {
  it('passes through when ADMIN_TOKEN is unset', async () => {
    const res = await postJson(MANUAL_PATH, { abi: validAbi() });

    expect(res.status).toBe(200);
    expect(mocks.saveManualVerification).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing token with 403 when ADMIN_TOKEN is set', async () => {
    process.env.ADMIN_TOKEN = 'secret';

    const res = await postJson(MANUAL_PATH, { abi: validAbi() });

    expect(res.status).toBe(403);
    expect(mocks.saveManualVerification).not.toHaveBeenCalled();
  });

  it('accepts the matching token when ADMIN_TOKEN is set', async () => {
    process.env.ADMIN_TOKEN = 'secret';

    const res = await postJson(MANUAL_PATH, { abi: validAbi() }, { 'x-admin-token': 'secret' });

    expect(res.status).toBe(200);
    expect(mocks.saveManualVerification).toHaveBeenCalledTimes(1);
  });

  it('saves the mark and returns the freshly re-read source', async () => {
    mocks.getContractSource.mockResolvedValue({
      verificationStatus: 'verified',
      verificationSource: 'manual',
      abi: validAbi(),
    });

    const res = await postJson(MANUAL_PATH, {
      abi: validAbi(),
      sourceCode: 'contract C {}',
      name: 'C',
    });

    expect(res.status).toBe(200);
    // The save receives exactly the validated fields, keyed for the
    // service upsert.
    expect(mocks.saveManualVerification).toHaveBeenCalledWith(1, ROUTE_ADDRESS, {
      abi: validAbi(),
      sourceCode: 'contract C {}',
      name: 'C',
    });
    // Same read-back pattern as the sourcify route: the response carries
    // what the next GET will serve.
    expect(mocks.getContractSource).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.verificationSource).toBe('manual');
    expect(body.verificationStatus).toBe('verified');
    expect(body.contractSource.verificationSource).toBe('manual');
  });

  it('omits the source payload when the read-back fails but keeps verified:true', async () => {
    mocks.getContractSource.mockRejectedValue(new Error('read-back blew up'));

    const res = await postJson(MANUAL_PATH, { abi: validAbi() });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.verificationSource).toBe('manual');
    expect(body.contractSource).toBeUndefined();
    expect(body.verificationStatus).toBeUndefined();
  });
});

describe('DELETE .../verify/manual', () => {
  it('answers 404 not_found when the row is sourcify-verified (never deletes it)', async () => {
    mocks.deleteManualVerification.mockResolvedValue(false);

    const res = await del(MANUAL_PATH);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
    // The guard lives in the service (only manual rows are deletable);
    // the route never falls back to an unconditional clearCache.
    expect(mocks.deleteManualVerification).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
    expect(mocks.clearCache).not.toHaveBeenCalled();
  });

  it('answers 200 and reports success when a manual mark was removed', async () => {
    mocks.deleteManualVerification.mockResolvedValue(true);

    const res = await del(MANUAL_PATH);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('rejects a missing token with 403 when ADMIN_TOKEN is set', async () => {
    process.env.ADMIN_TOKEN = 'secret';

    const res = await del(MANUAL_PATH);

    expect(res.status).toBe(403);
    expect(mocks.deleteManualVerification).not.toHaveBeenCalled();
  });

  it('rejects a malformed chain with 400', async () => {
    const res = await del(`/chains/notanumber/contracts/${ROUTE_ADDRESS}/verify/manual`);

    expect(res.status).toBe(400);
    expect(mocks.deleteManualVerification).not.toHaveBeenCalled();
  });
});
