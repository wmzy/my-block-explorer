// The compile-execution boundary: solc compiles run inside a
// worker_threads Worker (WorkerSolcRunner) with a hard timeout, and the
// service caps resident compilers with LRU eviction. No real solc is
// ever downloaded here — the worker loads fake soljson/wrapper .cjs
// fixtures from a per-test tmpdir through the exact production
// bootstrap (eval'd worker + absolute CommonJS paths in workerData), so
// the delivery mechanism itself is what these tests exercise.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Address } from 'viem';
import {
  WorkerSolcRunner,
  CompileVerifyService,
  CompileVerifyHttpError,
  compileTimedOut,
  MAX_RESIDENT_COMPILERS,
  type CompileRunnerParams,
  type ResolvedSolcBuild,
  type SolcCompileRunner,
} from '@/services/CompileVerifyService';

// Fake soljson mimicking the emscripten Module surface the inline
// wrapper consumes: the exported _solidity_* symbols, cwrap, function-
// pointer registration, and the UTF8/pointer helpers the import-refusal
// path writes through. compileImpl replaces solidity_compile's body and
// closes over the module-scope probe state (registered, lastWritten,
// resetCalls, compileArity) so tests can assert the wrapper wiring.
const fakeSoljsonCjs = (
  compileImpl: string,
  version = '0.8.99-test+commit.fake',
): string => `
  var impl = (input) => { ${compileImpl} };
  var registered = null;
  var lastWritten = null;
  var resetCalls = 0;
  var compileArity = 0;
  module.exports = {
    _solidity_compile: function () {},
    _solidity_version: function () {},
    _solidity_reset: function () {},
    _solidity_alloc: function () {},
    cwrap: function (method, returnType, argTypes) {
      if (method === 'solidity_compile') {
        compileArity = argTypes.length;
        return function () {
          var input = arguments[0];
          var callbackPointer = arguments[1];
          if (typeof callbackPointer !== 'number') {
            throw new Error('callback pointer must be a number');
          }
          if (registered === null) {
            throw new Error('callback was not registered via addFunction');
          }
          if (argTypes.length === 3 && arguments[2] !== 0) {
            throw new Error('v6+ compile must pass context 0');
          }
          if (argTypes.length === 2 && arguments.length > 2) {
            throw new Error('legacy compile must not pass a context argument');
          }
          return impl(input);
        };
      }
      if (method === 'solidity_version') {
        return function () { return ${JSON.stringify(version)}; };
      }
      if (method === 'solidity_reset') {
        return function () { resetCalls += 1; };
      }
      if (method === 'solidity_alloc') {
        return function () { return 4096; };
      }
      throw new Error('unexpected cwrap: ' + method);
    },
    addFunction: function (fn, signature) {
      if (signature !== 'viiiii') throw new Error('unexpected callback signature: ' + signature);
      registered = fn;
      return 7;
    },
    removeFunction: function (pointer) {
      if (pointer !== 7) throw new Error('removeFunction got a foreign pointer');
      registered = null;
    },
    lengthBytesUTF8: function (str) { return Buffer.byteLength(String(str), 'utf8'); },
    stringToUTF8: function (str) { lastWritten = String(str); },
    setValue: function () {},
  };
`;

let dir: string;

const writeFixture = async (name: string, body: string): Promise<string> => {
  const filePath = join(dir, name);
  await writeFile(filePath, body);
  return filePath;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'solc-worker-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('WorkerSolcRunner', () => {
  it('runs the compile inside a real worker thread through the inline wrapper', async () => {
    const solcPath = await writeFixture(
      'soljson-ok.cjs',
      fakeSoljsonCjs(
        `return JSON.stringify({ echo: JSON.parse(input), registered: registered !== null, arity: compileArity });`,
      ),
    );
    // threadId > 0 proves execution happened on a worker thread (the
    // main thread is always thread 0).
    const runner = await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.8.99-test',
      timeoutMs: 10_000,
    });
    try {
      expect(runner.threadId).toBeGreaterThan(0);
      const output = JSON.parse(await runner.compile(JSON.stringify({ language: 'Solidity' }))) as {
        echo: { language: string };
        registered: boolean;
        arity: number;
      };
      expect(output.echo.language).toBe('Solidity');
      // Modern solc wiring: callback registered, three-argument form.
      expect(output.registered).toBe(true);
      expect(output.arity).toBe(3);
    } finally {
      runner.dispose();
    }
  });

  it('answers the compiler import callback with the honest refusal', async () => {
    const solcPath = await writeFixture(
      'soljson-import.cjs',
      fakeSoljsonCjs(
        `registered(0, 'source', 'missing.sol', 0, 1);
         return JSON.stringify({ refused: lastWritten });`,
      ),
    );
    const runner = await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.8.99-test',
      timeoutMs: 10_000,
    });
    try {
      const output = JSON.parse(await runner.compile('{}')) as { refused: string | null };
      expect(output.refused).toBe('File import callback not supported');
    } finally {
      runner.dispose();
    }
  });

  it('drives legacy (<0.6) builds with the two-argument compile form', async () => {
    const solcPath = await writeFixture(
      'soljson-legacy.cjs',
      fakeSoljsonCjs(
        `registered('missing.sol', 0, 1);
         return JSON.stringify({ refused: lastWritten, arity: compileArity });`,
        '0.5.16+commit.legacy',
      ),
    );
    const runner = await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.5.16+commit.legacy',
      timeoutMs: 10_000,
    });
    try {
      const output = JSON.parse(await runner.compile('{}')) as {
        refused: string | null;
        arity: number;
      };
      expect(output.arity).toBe(2);
      expect(output.refused).toBe('File import callback not supported');
    } finally {
      runner.dispose();
    }
  });

  it('frees compiler allocations via solidity_reset after every compile', async () => {
    const solcPath = await writeFixture(
      'soljson-reset.cjs',
      fakeSoljsonCjs(`return JSON.stringify({ resetCalls: resetCalls });`),
    );
    const runner = await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.8.99-test',
      timeoutMs: 10_000,
    });
    try {
      await expect(runner.compile('{}')).resolves.toBe('{"resetCalls":0}');
      await expect(runner.compile('{}')).resolves.toBe('{"resetCalls":1}');
    } finally {
      runner.dispose();
    }
  });

  it('keeps the main thread responsive while the worker grinds on a busy loop', async () => {
    const solcPath = await writeFixture('soljson-busy.cjs', fakeSoljsonCjs('while (true) {}'));
    const runner = await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.8.99-busy',
      timeoutMs: 10_000,
    });
    const compilePromise = runner.compile('{}');
    // A 30ms main-thread sleep must not be stretched by the worker's
    // infinite loop — the exact stall this worker exists to prevent.
    const startedAt = Date.now();
    await new Promise(resolve => setTimeout(resolve, 30));
    const stretch = Date.now() - startedAt - 30;
    await compilePromise.catch(() => {});
    runner.dispose();
    expect(stretch).toBeLessThan(100);
  });

  it('terminates the worker and rejects with the typed timeout error when the budget expires', async () => {
    const solcPath = await writeFixture('soljson-hang.cjs', fakeSoljsonCjs('while (true) {}'));
    const runner = await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.8.99-hang',
      timeoutMs: 150,
    });

    const error = (await runner.compile('{}').catch(
      (caught: unknown) => caught as CompileVerifyHttpError,
    )) as CompileVerifyHttpError;
    expect(error).toBeInstanceOf(CompileVerifyHttpError);
    expect(error.status).toBe(504);
    expect(error.code).toBe('compile_timeout');
    expect(error.message).toContain('timed out after');
    expect(error.message).toContain('0.8.99-hang');
    expect(runner.isDead()).toBe(true);
    // The dead runner refuses further work instead of posting into the void.
    await expect(runner.compile('{}')).rejects.toThrow('terminated');
  });

  it('reports a compile crash as a plain rejection and keeps the worker alive for the next request', async () => {
    const solcPath = await writeFixture(
      'soljson-throw.cjs',
      fakeSoljsonCjs(`throw new Error('out of gas in asm.js');`),
    );
    const runner = await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.8.99-throw',
      timeoutMs: 10_000,
    });
    try {
      await expect(runner.compile('{}')).rejects.toThrow('out of gas in asm.js');
      expect(runner.isDead()).toBe(false);
      await expect(runner.compile('{}')).rejects.toThrow('out of gas in asm.js');
    } finally {
      runner.dispose();
    }
  });

  it('lets an in-flight compile finish when disposed mid-compile, then terminates the worker', async () => {
    const solcPath = await writeFixture(
      'soljson-slow.cjs',
      fakeSoljsonCjs(`const t = Date.now(); while (Date.now() - t < 120) {} return '"slow-ok"';`),
    );
    const runner = await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.8.99-slow',
      timeoutMs: 10_000,
    });
    const inFlight = runner.compile('{}');
    runner.dispose(); // deferred: a compile is active
    await expect(inFlight).resolves.toBe('"slow-ok"');
    await vi.waitFor(() => expect(runner.isDead()).toBe(true));
    await expect(runner.compile('{}')).rejects.toThrow('terminated');
  });

  it('surfaces a soljson that cannot initialize as compiler_unavailable', async () => {
    const solcPath = await writeFixture('soljson-broken.cjs', 'this is { not javascript');
    await expect(
      WorkerSolcRunner.start({ solcPath, longVersion: '0.8.99-broken' }),
    ).rejects.toMatchObject({ status: 502, code: 'compiler_unavailable' });
  });

  it('refuses a module that does not expose the native Standard-JSON interface', async () => {
    const solcPath = await writeFixture(
      'soljson-empty.cjs',
      'module.exports = { cwrap: function () {} };',
    );
    const error = (await WorkerSolcRunner.start({
      solcPath,
      longVersion: '0.8.99-empty',
    }).catch(caught => caught as CompileVerifyHttpError)) as CompileVerifyHttpError;
    expect(error).toMatchObject({ status: 502, code: 'compiler_unavailable' });
    expect(error.message).toContain('solidity_compile');
  });
});

// ---------------------------------------------------------------------------
// Service level — runner injection, timeout propagation, LRU eviction
// ---------------------------------------------------------------------------

const CHAIN_ID = 31337;
const ADDRESS = '0x1111111111111111111111111111111111111111' as Address;
const VERSIONS = [
  '0.8.40+commit.aaaaaaaa',
  '0.8.39+commit.bbbbbbbb',
  '0.8.38+commit.cccccccc',
  '0.8.37+commit.dddddddd',
];

const listOf = (versions: string[]) => ({
  builds: versions.map(v => ({
    path: `soljson-v${v}.cjs`,
    version: v.split('+')[0],
    longVersion: v,
    sha256: `0x${'ab'.repeat(32)}`,
  })),
  releases: Object.fromEntries(versions.map(v => [v.split('+')[0], `soljson-v${v}.cjs`])),
});

const buildOf = (longVersion: string): ResolvedSolcBuild => ({
  longVersion,
  version: longVersion.split('+')[0],
  prerelease: false,
  fileName: `soljson-v${longVersion}.js`,
});

// Pre-writes every soljson cache file so loadCompiler takes the
// cache-hit path and never fetches: only the runner layer is live.
const seedCache = async (cacheDir: string, versions: string[]): Promise<void> => {
  for (const v of versions) await writeFile(join(cacheDir, `soljson-v${v}.cjs`), 'fixture-bytes');
};

const standardInput = () => ({
  language: 'Solidity',
  sources: { 'Storage.sol': { content: 'contract Storage {}' } },
  settings: {},
});

type LoadCompiler = (build: ResolvedSolcBuild) => Promise<SolcCompileRunner>;

const loadCompilerOf = (service: CompileVerifyService): LoadCompiler =>
  (service as unknown as { loadCompiler: LoadCompiler }).loadCompiler.bind(service);

describe('CompileVerifyService runner integration', () => {
  it('compiles through the injected compile runner', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'solc-cache-int-'));
    try {
      await seedCache(cacheDir, [VERSIONS[0]]);
      const factory = vi.fn(async ({ longVersion }: CompileRunnerParams): Promise<SolcCompileRunner> => ({
        compile: async input =>
          JSON.stringify({
            compiledBy: longVersion,
            parsed: JSON.parse(input) as { language: string },
          }),
        isDead: () => false,
        dispose: () => {},
      }));
      const service = new CompileVerifyService({
        cacheDir,
        fetchJson: async () => listOf([VERSIONS[0]]),
        createCompileRunner: factory,
      });

      const runner = await loadCompilerOf(service)(buildOf(VERSIONS[0]));
      expect(factory).toHaveBeenCalledTimes(1);
      const output = JSON.parse(await runner.compile('{"language":"Solidity"}')) as {
        compiledBy: string;
        parsed: { language: string };
      };
      expect(output.compiledBy).toBe(VERSIONS[0]);
      expect(output.parsed.language).toBe('Solidity');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('propagates the typed compile timeout and drops the dead runner from the cache', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'solc-cache-int-'));
    try {
      await seedCache(cacheDir, [VERSIONS[0]]);
      const factory = vi.fn(async (): Promise<SolcCompileRunner> => ({
        // Simulates the WorkerSolcRunner timeout behavior: typed error,
        // worker terminated (dead).
        compile: () =>
          Promise.reject(
            compileTimedOut('The solc compile timed out after 60s and was terminated'),
          ),
        isDead: () => true,
        dispose: () => {},
      }));
      const service = new CompileVerifyService({
        cacheDir,
        fetchJson: async () => listOf([VERSIONS[0]]),
        createCompileRunner: factory,
      });

      const verify = () =>
        service.verifyByCompilation(CHAIN_ID, ADDRESS, {
          compilerVersion: VERSIONS[0],
          standardJsonInput: standardInput(),
        });
      await expect(verify()).rejects.toMatchObject({ status: 504, code: 'compile_timeout' });
      // The dead runner must not be reused: the next request builds a
      // fresh one instead of answering from the terminated worker.
      await expect(verify()).rejects.toMatchObject({ status: 504, code: 'compile_timeout' });
      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('LRU-evicts and disposes the least-recently-used runner at capacity', async () => {
    expect(MAX_RESIDENT_COMPILERS).toBe(3);
    const cacheDir = await mkdtemp(join(tmpdir(), 'solc-cache-int-'));
    try {
      await seedCache(cacheDir, VERSIONS);
      const disposed: string[] = [];
      const factory = vi.fn(async ({ longVersion }: CompileRunnerParams): Promise<SolcCompileRunner> => ({
        compile: async () => '{}',
        isDead: () => false,
        dispose: () => {
          disposed.push(longVersion);
        },
      }));
      const service = new CompileVerifyService({
        cacheDir,
        fetchJson: async () => listOf(VERSIONS),
        createCompileRunner: factory,
      });
      const loadCompiler = loadCompilerOf(service);

      // Fill to capacity: no eviction yet.
      await loadCompiler(buildOf(VERSIONS[0]));
      await loadCompiler(buildOf(VERSIONS[1]));
      await loadCompiler(buildOf(VERSIONS[2]));
      expect(factory).toHaveBeenCalledTimes(3);
      expect(disposed).toEqual([]);

      // One over capacity evicts the least-recently-used (VERSIONS[0]).
      await loadCompiler(buildOf(VERSIONS[3]));
      expect(factory).toHaveBeenCalledTimes(4);
      expect(disposed).toEqual([VERSIONS[0]]);

      // Hits never re-create and refresh recency: VERSIONS[1] is now LRU.
      await loadCompiler(buildOf(VERSIONS[3]));
      await loadCompiler(buildOf(VERSIONS[2]));
      expect(factory).toHaveBeenCalledTimes(4);

      // Re-loading the evicted version re-creates it and evicts VERSIONS[1].
      await loadCompiler(buildOf(VERSIONS[0]));
      expect(factory).toHaveBeenCalledTimes(5);
      expect(disposed).toEqual([VERSIONS[0], VERSIONS[1]]);

      // The survivors are still usable through their cached runners.
      const runner = await loadCompiler(buildOf(VERSIONS[3]));
      await expect(runner.compile('{}')).resolves.toBe('{}');
      expect(factory).toHaveBeenCalledTimes(5);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
