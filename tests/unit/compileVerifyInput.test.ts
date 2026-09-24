// Pure input-side semantics of compile verification: Standard JSON
// normalization (verbatim objects, Hardhat build-info unwrap, structural
// rejections, caps), version-string resolution (only from the official
// list; ambiguous short versions refused), list parsing (rebuild
// dedup via the releases map, prerelease flags, newest-first order),
// offline cache-name parsing, and the compiled-contract selection rules.
import { describe, it, expect } from 'vitest';
import {
  normalizeStandardJsonInput,
  buildCompileInput,
  resolveCompilerVersion,
  parseSolcVersionList,
  parseCachedCompilerNames,
  flattenCompiledContracts,
  selectCompiledContract,
  CompileVerifyHttpError,
  MAX_STANDARD_JSON_BYTES,
} from '@/services/CompileVerifyService';

const validInput = () => ({
  language: 'Solidity',
  sources: { 'contracts/Storage.sol': { content: 'contract Storage {}' } },
  settings: { optimizer: { enabled: false, runs: 200 } },
});

describe('normalizeStandardJsonInput', () => {
  it('accepts a verbatim Standard JSON object', () => {
    const result = normalizeStandardJsonInput(validInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unwrappedFromBuildInfo).toBe(false);
      expect(result.input.language).toBe('Solidity');
      expect(result.input.settings).toEqual({ optimizer: { enabled: false, runs: 200 } });
    }
  });

  it('unwraps a Hardhat build-info file (input member) verbatim', () => {
    const buildInfo = {
      id: 'abc123',
      solcVersion: '0.8.20',
      input: validInput(),
      output: { errors: [] },
    };
    const result = normalizeStandardJsonInput(buildInfo);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unwrappedFromBuildInfo).toBe(true);
      expect(result.input.sources['contracts/Storage.sol'].content).toBe('contract Storage {}');
    }
  });

  it('does not unwrap when the top level already carries language', () => {
    const result = normalizeStandardJsonInput({ ...validInput(), input: { language: 'Yul' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.unwrappedFromBuildInfo).toBe(false);
  });

  it('rejects non-objects, wrong language, and missing pieces', () => {
    expect(!normalizeStandardJsonInput('nope').ok).toBe(true);
    expect(!normalizeStandardJsonInput([validInput()]).ok).toBe(true);
    expect(!normalizeStandardJsonInput({ ...validInput(), language: 'Yul' }).ok).toBe(true);

    const noLanguage = validInput() as Record<string, unknown>;
    delete noLanguage.language;
    const languageReject = normalizeStandardJsonInput(noLanguage);
    expect(!languageReject.ok && languageReject.message).toContain('language');

    const noSources = validInput() as Record<string, unknown>;
    delete noSources.sources;
    expect(!normalizeStandardJsonInput(noSources).ok).toBe(true);
    expect(!normalizeStandardJsonInput({ ...validInput(), sources: {} }).ok).toBe(true);

    const noSettings = validInput() as Record<string, unknown>;
    delete noSettings.settings;
    const settingsReject = normalizeStandardJsonInput(noSettings);
    expect(!settingsReject.ok && settingsReject.message).toContain('settings');

    // An empty settings object is fine — present is what matters.
    expect(normalizeStandardJsonInput({ ...validInput(), settings: {} }).ok).toBe(true);
  });

  it('rejects source entries without inline content or with non-string content', () => {
    expect(
      !normalizeStandardJsonInput({
        ...validInput(),
        sources: { 'A.sol': { keccak256: '0xabc' } },
      }).ok,
    ).toBe(true);
    expect(
      !normalizeStandardJsonInput({
        ...validInput(),
        sources: { 'A.sol': { content: 42 } },
      }).ok,
    ).toBe(true);
    expect(
      !normalizeStandardJsonInput({ ...validInput(), sources: { 'A.sol': 'text' } }).ok,
    ).toBe(true);
  });

  it('rejects sources above the 4 MB cap with the honest total', () => {
    const big = 'x'.repeat(MAX_STANDARD_JSON_BYTES + 1);
    const result = normalizeStandardJsonInput({
      ...validInput(),
      sources: { 'A.sol': { content: big } },
    });
    expect(!result.ok).toBe(true);
    if (!result.ok) expect(result.message).toContain('4 MB');
  });
});

describe('buildCompileInput', () => {
  it('merges the needed output selections and keeps existing ones', () => {
    const built = buildCompileInput({
      language: 'Solidity',
      sources: {},
      settings: {
        optimizer: { enabled: true, runs: 999 },
        outputSelection: { 'A.sol': { Storage: ['abi'] } },
        stopAfter: 'parsing',
      },
    });
    const selection = built.settings.outputSelection as Record<string, unknown>;
    expect(selection['A.sol']).toEqual({ Storage: ['abi'] });
    expect((selection['*'] as Record<string, unknown>)['*']).toEqual([
      'abi',
      'evm.bytecode.object',
      'evm.deployedBytecode.object',
    ]);
    // Verification needs the full compilation, never a parse-only run.
    expect('stopAfter' in built.settings).toBe(false);
    expect(built.settings.optimizer).toEqual({ enabled: true, runs: 999 });
  });
});

describe('parseSolcVersionList', () => {
  const rawList = {
    builds: [
      { path: 'soljson-v0.8.35+commit.aaa.js', version: '0.8.35', longVersion: '0.8.35+commit.aaa', sha256: '0x1' },
      { path: 'soljson-v0.8.35+commit.bbb.js', version: '0.8.35', longVersion: '0.8.35+commit.bbb', sha256: '0x2' },
      { path: 'soljson-v0.8.37+commit.f4.js', version: '0.8.37', longVersion: '0.8.37+commit.f4', sha256: '0x3' },
      { path: 'soljson-v0.8.38-nightly.1+commit.n.js', version: '0.8.38-nightly.1', longVersion: '0.8.38-nightly.1+commit.n' },
    ],
    releases: {
      '0.8.35': 'soljson-v0.8.35+commit.bbb.js',
      '0.8.37': 'soljson-v0.8.37+commit.f4.js',
    },
    latestRelease: '0.8.37',
  };

  it('dedupes rebuilds via the releases map and orders newest first', () => {
    const versions = parseSolcVersionList(rawList);
    expect(versions.map(v => v.longVersion)).toEqual([
      '0.8.38-nightly.1+commit.n',
      '0.8.37+commit.f4',
      '0.8.35+commit.bbb',
    ]);
  });

  it('flags prereleases', () => {
    const versions = parseSolcVersionList(rawList);
    expect(versions[0].prerelease).toBe(true);
    expect(versions[1].prerelease).toBe(false);
  });

  it('answers empty for malformed lists', () => {
    expect(parseSolcVersionList(null)).toEqual([]);
    expect(parseSolcVersionList({})).toEqual([]);
    expect(parseSolcVersionList({ builds: 'nope' })).toEqual([]);
    expect(parseSolcVersionList({ builds: [{ version: '0.8.1' }] })).toEqual([]);
  });
});

describe('parseCachedCompilerNames', () => {
  it('derives version entries from cached soljson file names', () => {
    const entries = parseCachedCompilerNames([
      'soljson-v0.8.20+commit.a1b79de6.cjs',
      'soljson-v0.8.37+commit.f401782d.cjs',
      'unrelated.txt',
      'soljson-v0.8.38-nightly.2026.1.1+commit.x.cjs',
    ]);
    expect(entries.map(e => e.longVersion)).toEqual([
      '0.8.38-nightly.2026.1.1+commit.x',
      '0.8.37+commit.f401782d',
      '0.8.20+commit.a1b79de6',
    ]);
    expect(entries[0].prerelease).toBe(true);
    expect(entries[0].version).toBe('0.8.38-nightly.2026.1.1');
  });
});

describe('resolveCompilerVersion', () => {
  const versions = parseSolcVersionList({
    builds: [
      { path: 'a.js', version: '0.8.35', longVersion: '0.8.35+commit.aaa' },
      { path: 'b.js', version: '0.8.35', longVersion: '0.8.35+commit.bbb' },
      { path: 'c.js', version: '0.8.37', longVersion: '0.8.37+commit.f4' },
    ],
  });

  it('accepts an exact longVersion', () => {
    expect(resolveCompilerVersion('0.8.37+commit.f4', versions)?.longVersion).toBe(
      '0.8.37+commit.f4',
    );
  });

  it('accepts an unambiguous short version', () => {
    expect(resolveCompilerVersion('0.8.37', versions)?.longVersion).toBe('0.8.37+commit.f4');
  });

  it('refuses an ambiguous short version when a caller-supplied list carries two builds of one release', () => {
    // parseSolcVersionList dedupes rebuilds via the releases map, so its
    // output never carries two entries per short version; the resolver
    // stays defensive for arbitrary entry arrays.
    const duplicated = [
      { version: '0.8.35', longVersion: '0.8.35+commit.aaa', prerelease: false },
      { version: '0.8.35', longVersion: '0.8.35+commit.bbb', prerelease: false },
    ];
    expect(resolveCompilerVersion('0.8.35', duplicated)).toBeNull();
    // ...while the deduped list resolves the short form deterministically.
    expect(resolveCompilerVersion('0.8.35', versions)?.longVersion).toBe('0.8.35+commit.bbb');
  });

  it('refuses unknown and free-form strings — they are never turned into URLs', () => {
    expect(resolveCompilerVersion('0.8.99', versions)).toBeNull();
    expect(resolveCompilerVersion('../../etc/passwd', versions)).toBeNull();
    expect(resolveCompilerVersion('0.8.20/../../other-host/x', versions)).toBeNull();
  });
});

describe('selectCompiledContract', () => {
  const contracts = flattenCompiledContracts({
    'A.sol': { Storage: { abi: [] }, Reader: { abi: [] } },
    'B.sol': { Storage: { abi: [] }, Only: { abi: [] } },
  });

  it('flattens the contracts map deterministically (file:name keys)', () => {
    expect(contracts.map(c => c.key)).toEqual([
      'A.sol:Reader',
      'A.sol:Storage',
      'B.sol:Only',
      'B.sol:Storage',
    ]);
  });

  it('requires contractName when the output has more than one contract', () => {
    expect(() => selectCompiledContract(contracts, undefined)).toThrowError(
      CompileVerifyHttpError,
    );
    try {
      selectCompiledContract(contracts, undefined);
      expect.unreachable();
    } catch (error) {
      const typed = error as CompileVerifyHttpError;
      expect(typed.code).toBe('contract_name_required');
      expect((typed.details?.candidates as string[]).length).toBe(4);
    }
  });

  it('also requires it when the output has zero contracts', () => {
    expect(() => selectCompiledContract([], undefined)).toThrowError(CompileVerifyHttpError);
  });

  it('auto-selects a single contract without a name', () => {
    const single = flattenCompiledContracts({ 'A.sol': { Only: { abi: [] } } });
    expect(selectCompiledContract(single, undefined).key).toBe('A.sol:Only');
    expect(selectCompiledContract(single, '').key).toBe('A.sol:Only');
  });

  it('selects by full file:name key, unique bare name, and rejects ambiguity', () => {
    expect(selectCompiledContract(contracts, 'B.sol:Storage').key).toBe('B.sol:Storage');
    expect(selectCompiledContract(contracts, 'Reader').key).toBe('A.sol:Reader');
    try {
      selectCompiledContract(contracts, 'Storage');
      expect.unreachable();
    } catch (error) {
      expect((error as CompileVerifyHttpError).code).toBe('unknown_contract');
    }
    try {
      selectCompiledContract(contracts, 'Nope');
      expect.unreachable();
    } catch (error) {
      expect((error as CompileVerifyHttpError).code).toBe('unknown_contract');
    }
  });
});
