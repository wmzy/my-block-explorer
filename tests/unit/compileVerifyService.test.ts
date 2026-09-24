// CompileVerifyService.verifyByCompilation end to end with every boundary
// mocked (version list fetch, compiler load, on-chain code) — no network,
// no real soljson. Pins the honesty contract: match tiers, the saved
// payload, EOA refusal, contract-name enforcement, compile-error pass-
// through, and the typed offline/compiler failures.
import { describe, it, expect, vi } from 'vitest';
import type { Address } from 'viem';

import {
  CompileVerifyService,
  CompileVerifyHttpError,
  type ResolvedSolcBuild,
  type SolcCompilerHandle,
} from '@/services/CompileVerifyService';

const CHAIN_ID = 31337;
const ADDRESS = '0x1111111111111111111111111111111111111111' as Address;

const LONG_VERSION = '0.8.37+commit.f401782d';

const LIST = {
  builds: [
    {
      path: `soljson-v${LONG_VERSION}.cjs`,
      version: '0.8.37',
      longVersion: LONG_VERSION,
      sha256: '0xdeadbeef',
    },
  ],
  releases: { '0.8.37': `soljson-v${LONG_VERSION}.cjs` },
};

// Real-shape auxdata (ipfs variant) so metadata-only tiers exercise the
// actual splitter.
const AUXDATA =
  'a2656970667358221220567d602f5bb4729467e6780a0a4546c7dcd1d07987b4bb2fb9b3b923b097c72b64736f6c6343000825';
const auxdataBlock = (payload: string): string => {
  const length = payload.length / 2;
  return `${payload}${length.toString(16).padStart(4, '0')}`;
};
const OTHER_AUXDATA =
  'a2656970667358221220ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff64736f6c6343000825';

const RUNTIME = '60806040523480156100115760006000fdff';

const standardInput = (sources: Record<string, string> = { 'Storage.sol': 'contract Storage {}' }) => ({
  language: 'Solidity',
  sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { content: v }])),
  settings: {
    optimizer: { enabled: true, runs: 999 },
    evmVersion: 'shanghai',
  },
});

const compileOutput = (deployedBytecode: string, name = 'Storage') => ({
  contracts: {
    'Storage.sol': {
      [name]: {
        abi: [{ type: 'function', name: 'get', inputs: [], outputs: [] }],
        evm: { deployedBytecode: { object: deployedBytecode }, bytecode: { object: '0x' } },
      },
    },
  },
  errors: [
    { severity: 'warning', formattedMessage: 'Warning: SPDX license identifier not provided' },
  ],
});

type Harness = {
  service: CompileVerifyService;
  compile: ReturnType<typeof vi.fn>;
  getRuntimeCode: ReturnType<typeof vi.fn>;
};

const createHarness = (options?: {
  compileReturn?: unknown;
  runtimeCode?: string | Error;
  list?: unknown;
}): Harness => {
  const compile = vi.fn(() =>
    JSON.stringify(options?.compileReturn ?? compileOutput(`0x${RUNTIME}${auxdataBlock(AUXDATA)}`)),
  );
  const getRuntimeCode = vi.fn(async () => {
    const code = options?.runtimeCode;
    if (code === undefined) return `0x${RUNTIME}${auxdataBlock(AUXDATA)}`;
    if (code instanceof Error) throw code;
    return code;
  });
  const service = new CompileVerifyService({
    fetchJson: async () => (options?.list === undefined ? LIST : options.list),
    loadCompilerBuild: async (_build: ResolvedSolcBuild): Promise<SolcCompilerHandle> => ({
      compile: compile as unknown as SolcCompilerHandle['compile'],
      semver: () => LONG_VERSION,
    }),
    fetchRuntimeCode: getRuntimeCode,
  });
  return { service, compile, getRuntimeCode };
};

describe('verifyByCompilation — match tiers', () => {
  it('answers exact when the recompiled runtime equals the on-chain code', async () => {
    const { service } = createHarness();
    const outcome = await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: standardInput(),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.tier).toBe('exact');
      expect(outcome.contractName).toBe('Storage.sol:Storage');
      expect(outcome.compilerVersion).toBe(LONG_VERSION);
      expect(outcome.warnings).toEqual(['Warning: SPDX license identifier not provided']);
    }
  });

  it('answers matches-metadata-only when only the auxdata differs, reporting both blocks', async () => {
    const { service } = createHarness({
      compileReturn: compileOutput(`0x${RUNTIME}${auxdataBlock(OTHER_AUXDATA)}`),
    });
    const outcome = await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: '0.8.37',
      standardJsonInput: standardInput(),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.tier).toBe('matches-metadata-only');
      expect(outcome.comparison.onChainAuxdata).toBe(AUXDATA);
      expect(outcome.comparison.compiledAuxdata).toBe(OTHER_AUXDATA);
    }
  });

  it('answers mismatch with the first differing byte offset and no save payload', async () => {
    const { service } = createHarness({
      compileReturn: compileOutput(`0x60806040523480156100115760006000fdfe${auxdataBlock(AUXDATA)}`),
    });
    const outcome = await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: standardInput(),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.kind === 'mismatch') {
      // RUNTIME is 18 bytes; the compiled side differs in its final byte.
      expect(outcome.comparison.firstDiffByteOffset).toBe(RUNTIME.length / 2 - 1);
      expect(outcome.message).toContain('byte 17');
    } else {
      expect.unreachable();
    }
  });

  it('carries the resolved settings and sources in the saved payload', async () => {
    const { service } = createHarness();
    const outcome = await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: standardInput({ 'B.sol': 'contract B {}', 'A.sol': 'contract A {}' }),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // Sorted by file name; sourceCode is the first file's content.
      expect(outcome.saved.sourceFiles.map(f => f.filename)).toEqual(['A.sol', 'B.sol']);
      expect(outcome.saved.sourceCode).toBe('contract A {}');
      expect(outcome.saved.compilerVersion).toBe(LONG_VERSION);
      expect(outcome.saved.optimizationEnabled).toBe(true);
      expect(outcome.saved.optimizationRuns).toBe(999);
      expect(outcome.saved.evmVersion).toBe('shanghai');
      expect(JSON.parse(outcome.saved.abi)[0].name).toBe('get');
    }
  });

  it('compiles with the merged output selection and dropped stopAfter', async () => {
    const { service, compile } = createHarness();
    await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: { ...standardInput(), settings: { stopAfter: 'parsing' } as never },
    });
    const [inputJson] = compile.mock.calls[0] as [string];
    const parsed = JSON.parse(inputJson) as { settings: Record<string, unknown> };
    expect(parsed.settings.stopAfter).toBeUndefined();
    expect((parsed.settings.outputSelection as Record<string, unknown>)['*']).toBeTruthy();
  });
});

describe('verifyByCompilation — input and contract resolution', () => {
  it('rejects missing/non-string compilerVersion and bad input shapes with 400 invalid_input', async () => {
    const { service } = createHarness();
    await expect(
      service.verifyByCompilation(CHAIN_ID, ADDRESS, {
        compilerVersion: undefined,
        standardJsonInput: standardInput(),
      }),
    ).rejects.toSatisfy((error: unknown) => error instanceof CompileVerifyHttpError && error.code === 'invalid_input');
    await expect(
      service.verifyByCompilation(CHAIN_ID, ADDRESS, {
        compilerVersion: 42,
        standardJsonInput: standardInput(),
      }),
    ).rejects.toSatisfy((error: unknown) => error instanceof CompileVerifyHttpError);
    await expect(
      service.verifyByCompilation(CHAIN_ID, ADDRESS, {
        compilerVersion: LONG_VERSION,
        standardJsonInput: { language: 'Yul' },
      }),
    ).rejects.toSatisfy((error: unknown) => error instanceof CompileVerifyHttpError && error.code === 'invalid_input');
  });

  it('rejects versions that are not in the official list', async () => {
    const { service } = createHarness();
    await expect(
      service.verifyByCompilation(CHAIN_ID, ADDRESS, {
        compilerVersion: '0.6.12+commit.27d71776',
        standardJsonInput: standardInput(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CompileVerifyHttpError &&
        error.code === 'invalid_input' &&
        error.message.includes('verify/compilers'),
    );
  });

  it('requires contractName when the output has multiple contracts', async () => {
    const multi = {
      contracts: {
        'A.sol': {
          One: { abi: [], evm: { deployedBytecode: { object: `0x${RUNTIME}` } } },
        },
        'B.sol': {
          Two: { abi: [], evm: { deployedBytecode: { object: `0x${RUNTIME}` } } },
        },
      },
    };
    const { service } = createHarness({ compileReturn: multi });
    await expect(
      service.verifyByCompilation(CHAIN_ID, ADDRESS, {
        compilerVersion: LONG_VERSION,
        standardJsonInput: standardInput(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CompileVerifyHttpError && error.code === 'contract_name_required',
    );
    const outcome = await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: standardInput(),
      contractName: 'B.sol:Two',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.contractName).toBe('B.sol:Two');
  });
});

describe('verifyByCompilation — honest domain outcomes', () => {
  it('passes compiler errors through verbatim as a 200-tier compile_error', async () => {
    const { service } = createHarness({
      compileReturn: {
        errors: [
          { severity: 'error', formattedMessage: 'ParserError: Expected pragma...' },
        ],
      },
    });
    const outcome = await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: standardInput(),
    });
    expect(outcome).toEqual({
      ok: false,
      kind: 'compile_error',
      errors: ['ParserError: Expected pragma...'],
    });
  });

  it('answers no_contracts when the compile succeeds without contracts', async () => {
    const { service } = createHarness({ compileReturn: {} });
    const outcome = await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: standardInput(),
    });
    expect(outcome).toEqual({
      ok: false,
      kind: 'no_contracts',
      message: expect.stringContaining('no contracts'),
    });
  });

  it('answers no_runtime_bytecode for abstract/interface targets', async () => {
    const { service } = createHarness({
      compileReturn: { contracts: { 'I.sol': { Iface: { abi: [], evm: {} } } } },
    });
    const outcome = await service.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: standardInput(),
    });
    expect(outcome).toEqual({
      ok: false,
      kind: 'no_runtime_bytecode',
      message: expect.stringContaining('I.sol:Iface'),
    });
  });

  it('rejects EOAs (empty on-chain code) with 400 not_a_contract', async () => {
    const { service } = createHarness({ runtimeCode: '0x' });
    await expect(
      service.verifyByCompilation(CHAIN_ID, ADDRESS, {
        compilerVersion: LONG_VERSION,
        standardJsonInput: standardInput(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CompileVerifyHttpError &&
        error.code === 'not_a_contract' &&
        error.status === 400,
    );
  });

  it('maps a failing eth_getCode to 502 rpc_unavailable', async () => {
    const { service } = createHarness({
      runtimeCode: new Error('socket hang up'),
    });
    await expect(
      service.verifyByCompilation(CHAIN_ID, ADDRESS, {
        compilerVersion: LONG_VERSION,
        standardJsonInput: standardInput(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CompileVerifyHttpError &&
        error.code === 'rpc_unavailable' &&
        error.status === 502 &&
        error.message.includes('socket hang up'),
    );
  });

  it('maps a crashing compiler build to 500 compile_failed', async () => {
    const crashing = new CompileVerifyService({
      fetchJson: async () => LIST,
      loadCompilerBuild: async () => ({
        compile: () => {
          throw new Error('memory access out of bounds');
        },
        semver: () => LONG_VERSION,
      }),
      fetchRuntimeCode: async () => `0x${RUNTIME}`,
    });
    await expect(
      crashing.verifyByCompilation(CHAIN_ID, ADDRESS, {
        compilerVersion: LONG_VERSION,
        standardJsonInput: standardInput(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CompileVerifyHttpError &&
        error.code === 'compile_failed' &&
        error.status === 500 &&
        error.message.includes('memory access out of bounds'),
    );
  });
});

// The service reads the solc cache directory through an injectable dep
// (its default reads data/solc-cache with readdir); tests answer from
// this per-test holder so no filesystem or module mocking is involved.
const cacheDirState = { files: [] as string[] };
const readCacheDir = async (): Promise<string[]> => cacheDirState.files;

describe('listCompilerVersions — honest degradation', () => {
  it('returns the parsed list on success and caches it in-process', async () => {
    const fetchJson = vi.fn(async () => LIST);
    const service = new CompileVerifyService({ fetchJson });
    const first = await service.listCompilerVersions();
    expect(first.versions.map(v => v.longVersion)).toEqual([LONG_VERSION]);
    expect(first.degraded).toBeUndefined();
    const second = await service.listCompilerVersions();
    expect(second).toEqual(first);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('degrades to cached soljson names (with an honest note) when the list is unreachable', async () => {
    cacheDirState.files = [`soljson-v${LONG_VERSION}.cjs`];
    const fetchJson = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const service = new CompileVerifyService({ fetchJson, readCacheDir });
    const result = await service.listCompilerVersions();
    expect(result.versions.map(v => v.longVersion)).toEqual([LONG_VERSION]);
    expect(result.degraded).toContain('binaries.soliditylang.org');
    expect(result.degraded).toContain('usable offline');
    cacheDirState.files = [];
  });

  it('answers an honest empty list offline with nothing cached', async () => {
    cacheDirState.files = [];
    const fetchJson = vi.fn(async () => {
      throw new Error('offline');
    });
    const service = new CompileVerifyService({ fetchJson, readCacheDir });
    const result = await service.listCompilerVersions();
    expect(result.versions).toEqual([]);
    expect(result.degraded).toContain('internet access');
  });

  it('still verifies against cached compilers while the list is unreachable', async () => {
    cacheDirState.files = [`soljson-v${LONG_VERSION}.cjs`];
    const fetchJson = vi.fn(async () => {
      throw new Error('offline');
    });
    const offline = new CompileVerifyService({
      fetchJson,
      readCacheDir,
      loadCompilerBuild: async () => ({
        compile: () => JSON.stringify(compileOutput(`0x${RUNTIME}${auxdataBlock(AUXDATA)}`)),
        semver: () => LONG_VERSION,
      }),
      fetchRuntimeCode: async () => `0x${RUNTIME}${auxdataBlock(AUXDATA)}`,
    });
    const outcome = await offline.verifyByCompilation(CHAIN_ID, ADDRESS, {
      compilerVersion: LONG_VERSION,
      standardJsonInput: standardInput(),
    });
    expect(outcome.ok).toBe(true);
    cacheDirState.files = [];
  });
});
