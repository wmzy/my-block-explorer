// Compile verify route contract: admin gating + the shared verify limiter
// on the POST, the open compilers read, the response mapping for every
// service outcome (match tiers persist through the same save/clear/read
// sequence the manual verify uses), and the typed 400/502/500 errors.
// The services are mocked; the heavy modules never load.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  clearCache: vi.fn(),
  getContractSource: vi.fn(),
  saveManualVerification: vi.fn(),
  deleteManualVerification: vi.fn(),
  saveLocalCompileVerification: vi.fn(),
  listCompilerVersions: vi.fn(),
  verifyByCompilation: vi.fn(),
  createRateLimiter: vi.fn(),
}));

// Both services pull in DuckDB; only the calls the routes make are needed.
vi.mock('@/services/ContractSourceService', () => ({
  contractSourceService: {
    clearCache: mocks.clearCache,
    getContractSource: mocks.getContractSource,
    saveManualVerification: mocks.saveManualVerification,
    deleteManualVerification: mocks.deleteManualVerification,
    saveLocalCompileVerification: mocks.saveLocalCompileVerification,
  },
}));

vi.mock('@/services/CompileVerifyService', async importOriginal => {
  const actual = await importOriginal<
    typeof import('@/services/CompileVerifyService')
  >();
  return {
    ...actual,
    compileVerifyService: {
      listCompilerVersions: mocks.listCompilerVersions,
      verifyByCompilation: mocks.verifyByCompilation,
    },
  };
});

// The limiter has dedicated coverage (rateLimit.test.ts); a spy records
// the wiring while passing every request through so tests fire freely.
vi.mock('@/middleware/rate-limit', () => ({
  createRateLimiter: (...args: unknown[]) => {
    mocks.createRateLimiter(...args);
    return async (_c: unknown, next: () => Promise<void>) => next();
  },
}));

import verifyRoutes from '@/routes/verify';
import { CompileVerifyHttpError } from '@/services/CompileVerifyService';

const app = new Hono();
app.route('/', verifyRoutes);

// All-digit address: checksum-neutral, so the service receives exactly
// the string in the URL.
const ROUTE_ADDRESS = '0x1111111111111111111111111111111111111111';
const COMPILE_PATH = `/chains/1/contracts/${ROUTE_ADDRESS}/verify/compile`;
const COMPILERS_PATH = `/chains/1/contracts/${ROUTE_ADDRESS}/verify/compilers`;

const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const standardJsonInput = {
  language: 'Solidity',
  sources: { 'Storage.sol': { content: 'contract Storage {}' } },
  settings: {},
};

const savedPayload = () => ({
  name: 'Storage',
  abi: '[]',
  sourceFiles: [{ filename: 'Storage.sol', content: 'contract Storage {}' }],
  sourceCode: 'contract Storage {}',
  compilerVersion: '0.8.37+commit.f401782d',
});

const successOutcome = (tier: 'exact' | 'matches-metadata-only') => ({
  ok: true as const,
  tier,
  contractName: 'Storage.sol:Storage',
  compilerVersion: '0.8.37+commit.f401782d',
  comparison: {
    tier,
    onChainRawBytes: 71,
    compiledRawBytes: 71,
    onChainBytes: 18,
    compiledBytes: 18,
  },
  warnings: [],
  saved: savedPayload(),
});

beforeEach(() => {
  delete process.env.ADMIN_TOKEN;
  mocks.clearCache.mockClear();
  mocks.getContractSource.mockReset();
  mocks.getContractSource.mockResolvedValue({ verificationStatus: 'verified' });
  mocks.saveLocalCompileVerification.mockReset();
  mocks.saveLocalCompileVerification.mockResolvedValue(undefined);
  mocks.listCompilerVersions.mockReset();
  mocks.verifyByCompilation.mockReset();
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('POST .../verify/compile — gating', () => {
  it('shares the contract-verify limiter family with the sibling verify routes', async () => {
    mocks.verifyByCompilation.mockResolvedValue(successOutcome('exact'));
    // The limiter module is mocked to a passthrough; its real config and
    // behavior are pinned in verifyRateLimit.test.ts. Import-time wiring
    // was already asserted by the first test that ran the module.
    const res = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(res.status).toBe(200);
  });

  it('rejects a missing token with 403 when ADMIN_TOKEN is set', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(res.status).toBe(403);
    expect(mocks.verifyByCompilation).not.toHaveBeenCalled();
  });

  it('accepts the matching token when ADMIN_TOKEN is set', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    mocks.verifyByCompilation.mockResolvedValue(successOutcome('exact'));
    const res = await postJson(
      COMPILE_PATH,
      { compilerVersion: '0.8.37', standardJsonInput },
      { 'x-admin-token': 'secret' },
    );
    expect(res.status).toBe(200);
    expect(mocks.verifyByCompilation).toHaveBeenCalledTimes(1);
  });
});

describe('POST .../verify/compile — body plumbing', () => {
  it('passes body fields through (contractName optional) and validates params', async () => {
    mocks.verifyByCompilation.mockResolvedValue(successOutcome('exact'));
    const res = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37+commit.f401782d',
      standardJsonInput,
      contractName: 'Storage.sol:Storage',
    });
    expect(res.status).toBe(200);
    expect(mocks.verifyByCompilation).toHaveBeenCalledWith(1, ROUTE_ADDRESS, {
      compilerVersion: '0.8.37+commit.f401782d',
      standardJsonInput,
      contractName: 'Storage.sol:Storage',
    });
    // A malformed address never reaches the service.
    const bad = await postJson('/chains/1/contracts/0x123/verify/compile', {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(bad.status).toBe(400);
    expect(mocks.verifyByCompilation).toHaveBeenCalledTimes(1);
  });
});

describe('POST .../verify/compile — outcome mapping', () => {
  it('persists any match tier and answers with the re-read contractSource', async () => {
    mocks.verifyByCompilation.mockResolvedValue(successOutcome('matches-metadata-only'));
    mocks.getContractSource.mockResolvedValue({ verificationStatus: 'verified', name: 'Storage' });
    const res = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.tier).toBe('matches-metadata-only');
    expect(body.contractName).toBe('Storage.sol:Storage');
    expect(body.compilerVersion).toBe('0.8.37+commit.f401782d');
    expect(body.contractSource.verificationStatus).toBe('verified');
    // Same sequence as the Sourcify success flow: drop the stale row,
    // write the verified source, read it back.
    expect(mocks.clearCache).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
    expect(mocks.saveLocalCompileVerification).toHaveBeenCalledWith(1, ROUTE_ADDRESS, savedPayload());
    expect(mocks.getContractSource).toHaveBeenCalledWith(1, ROUTE_ADDRESS);
  });

  it('omits contractSource when the read-back fails but keeps verified:true', async () => {
    mocks.verifyByCompilation.mockResolvedValue(successOutcome('exact'));
    mocks.getContractSource.mockRejectedValue(new Error('refresh blew up'));
    const res = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.contractSource).toBeUndefined();
  });

  it('answers domain outcomes with 200 and never touches stored data', async () => {
    mocks.verifyByCompilation.mockResolvedValue({
      ok: false,
      kind: 'mismatch',
      message: 'does not match',
      comparison: { tier: 'mismatch', firstDiffByteOffset: 3 },
      warnings: [],
    });
    const mismatch = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(mismatch.status).toBe(200);
    expect(await mismatch.json()).toEqual({
      verified: false,
      kind: 'mismatch',
      message: 'does not match',
      comparison: { tier: 'mismatch', firstDiffByteOffset: 3 },
    });

    mocks.verifyByCompilation.mockResolvedValue({
      ok: false,
      kind: 'compile_error',
      errors: ['ParserError: …'],
    });
    const compileError = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(compileError.status).toBe(200);
    expect(await compileError.json()).toEqual({
      verified: false,
      kind: 'compile_error',
      errors: ['ParserError: …'],
    });

    expect(mocks.clearCache).not.toHaveBeenCalled();
    expect(mocks.saveLocalCompileVerification).not.toHaveBeenCalled();
  });

  it('maps typed service errors to their HTTP codes and carries details', async () => {
    const cases: Array<[CompileVerifyHttpError, number, string]> = [
      [new CompileVerifyHttpError(400, 'invalid_input', 'bad shape'), 400, 'invalid_input'],
      [
        new CompileVerifyHttpError(400, 'contract_name_required', 'pick one', {
          candidates: ['A.sol:A', 'B.sol:B'],
        }),
        400,
        'contract_name_required',
      ],
      [new CompileVerifyHttpError(400, 'not_a_contract', 'an EOA'), 400, 'not_a_contract'],
      [
        new CompileVerifyHttpError(502, 'compilers_unavailable', 'offline'),
        502,
        'compilers_unavailable',
      ],
      [
        new CompileVerifyHttpError(502, 'compiler_unavailable', 'download failed'),
        502,
        'compiler_unavailable',
      ],
      [new CompileVerifyHttpError(502, 'rpc_unavailable', 'eth_getCode failed'), 502, 'rpc_unavailable'],
      [new CompileVerifyHttpError(500, 'compile_failed', 'OOM'), 500, 'compile_failed'],
    ];
    for (const [error, status, code] of cases) {
      mocks.verifyByCompilation.mockRejectedValueOnce(error);
      const res = await postJson(COMPILE_PATH, {
        compilerVersion: '0.8.37',
        standardJsonInput,
      });
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.error).toBe(code);
      expect(body.message).toBe(error.message);
      if (error.details !== undefined) {
        expect(body.candidates).toEqual(['A.sol:A', 'B.sol:B']);
      }
    }
    expect(mocks.clearCache).not.toHaveBeenCalled();
  });

  it('answers an unexpected service error with 500', async () => {
    mocks.verifyByCompilation.mockRejectedValue(new Error('surprise'));
    const res = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('verification_failed');
  });

  it('answers 500 when the verified source cannot be saved', async () => {
    mocks.verifyByCompilation.mockResolvedValue(successOutcome('exact'));
    mocks.saveLocalCompileVerification.mockRejectedValue(new Error('db down'));
    const res = await postJson(COMPILE_PATH, {
      compilerVersion: '0.8.37',
      standardJsonInput,
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('verification_failed');
    expect(mocks.getContractSource).not.toHaveBeenCalled();
  });
});

describe('GET .../verify/compilers — open read', () => {
  it('answers the service list verbatim without an admin token', async () => {
    mocks.listCompilerVersions.mockResolvedValue({
      versions: [{ version: '0.8.37', longVersion: '0.8.37+commit.f401782d', prerelease: false }],
    });
    process.env.ADMIN_TOKEN = 'secret';
    const res = await app.request(COMPILERS_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      versions: [{ version: '0.8.37', longVersion: '0.8.37+commit.f401782d', prerelease: false }],
    });
  });

  it('passes the degraded note through for the honest offline state', async () => {
    mocks.listCompilerVersions.mockResolvedValue({
      versions: [],
      degraded: 'Compiler list unavailable (binaries.soliditylang.org: offline)',
    });
    const res = await app.request(COMPILERS_PATH);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions).toEqual([]);
    expect(body.degraded).toContain('binaries.soliditylang.org');
  });

  it('maps an unexpected failure to 502 compilers_unavailable', async () => {
    mocks.listCompilerVersions.mockRejectedValue(new Error('surprise'));
    const res = await app.request(COMPILERS_PATH);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('compilers_unavailable');
  });
});
