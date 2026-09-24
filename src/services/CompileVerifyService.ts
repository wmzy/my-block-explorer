// Local compile-based contract verification (Blockscout's core capability,
// local edition): the backend downloads the requested solc build (the
// wasm soljson from binaries.soliditylang.org), compiles the caller's
// Standard JSON input with it, and matches the recompiled runtime
// bytecode against the chain's own eth_getCode — the verification path
// that works for custom/private chains (anvil, hardhat, private
// deployments) where Sourcify has no coverage and a manual mark is an
// assertion, not a match.
//
// Honesty contract:
// - compiler versions are accepted only as-is from the official wasm list
//   (binaries.soliditylang.org/wasm/list.json) or from a soljson file
//   already in the local cache — never as a free-form URL (no SSRF
//   surface; the download URL is always derived server-side);
// - downloaded soljson files are sha256-verified against the list before
//   they are used and cached under data/solc-cache/;
// - the comparison reports three honest tiers: exact (raw equal),
//   matches-metadata-only (equal after stripping the trailing CBOR
//   auxdata block — the differing auxdata is reported), mismatch (first
//   differing byte offset plus both lengths);
// - offline/unfetchable compiler resources surface as typed errors
//   naming the network need; a cached build stays usable without it.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createLogger } from '../server/logger';
import type { Address } from 'viem';

const logger = createLogger('compile-verify-service');

// Official solc binary distribution (the same source solc-js itself
// uses). The wasm builds run under Node as well as the browser.
const SOLC_LIST_URL = 'https://binaries.soliditylang.org/wasm/list.json';
const SOLC_BINARIES_BASE_URL = 'https://binaries.soliditylang.org/wasm/';
// Downloading a soljson (~9 MB) plus the first wasm instantiation gets
// one minute before the caller hears an honest timeout.
export const COMPILER_LOAD_BUDGET_MS = 60_000;
// The version list changes rarely; one fetch per day per process.
const VERSION_LIST_TTL_MS = 24 * 60 * 60 * 1000;
// A degraded (offline) list answer must not pin "unavailable" for a day.
const DEGRADED_LIST_TTL_MS = 5 * 60 * 1000;
// Bounds the caller-supplied sources so one submission cannot turn into
// an unbounded compile (mirrors the bundle caps of the Sourcify flow).
export const MAX_STANDARD_JSON_BYTES = 4 * 1024 * 1024;
// solc-cache directory, relative to the working directory exactly like
// the DuckDB data/ files (data/ is gitignored as a whole).
const SOLC_CACHE_DIR = path.join('data', 'solc-cache');

// ---------------------------------------------------------------------------
// Typed failures the route maps onto HTTP codes. Everything else is a
// domain outcome returned through the result union (compile errors,
// bytecode mismatch) — user input, answered with HTTP 200.
// ---------------------------------------------------------------------------

export class CompileVerifyHttpError extends Error {
  readonly status: 400 | 500 | 502;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: 400 | 500 | 502,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CompileVerifyHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const invalidInput = (message: string) =>
  new CompileVerifyHttpError(400, 'invalid_input', message);

export const compilersUnavailable = (message: string) =>
  new CompileVerifyHttpError(502, 'compilers_unavailable', message);

export const compilerUnavailable = (message: string) =>
  new CompileVerifyHttpError(502, 'compiler_unavailable', message);

export const rpcUnavailable = (message: string) =>
  new CompileVerifyHttpError(502, 'rpc_unavailable', message);

export const compileFailed = (message: string) =>
  new CompileVerifyHttpError(500, 'compile_failed', message);

// ---------------------------------------------------------------------------
// Version list (pure parsing + resolution, exported for unit tests)
// ---------------------------------------------------------------------------

export type SolcVersionEntry = {
  /** Short semver, e.g. '0.8.37'. */
  version: string;
  /** Exact build identifier, e.g. '0.8.37+commit.f401782d'. */
  longVersion: string;
  /** True for nightly/prerelease builds (longVersion carries a '-'). */
  prerelease: boolean;
};

/** Internal resolution target: the list entry plus how to fetch it. */
export type ResolvedSolcBuild = {
  longVersion: string;
  version: string;
  prerelease: boolean;
  fileName: string;
  sha256?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

type RawListBuild = { path: string; version: string; longVersion: string; sha256?: string };

// Parses the upstream list.json: builds (oldest→newest, one entry per
// build — rebuilds of the same release appear twice) plus the releases
// map (short version → canonical build file). The canonical entry for a
// short version is the releases build when the list has one, the newest
// build otherwise, so a duplicated version never yields two identical
// dropdown entries or an ambiguous resolution.
export function parseSolcVersionList(raw: unknown): SolcVersionEntry[] {
  if (!isRecord(raw) || !Array.isArray(raw.builds)) return [];
  const builds: RawListBuild[] = [];
  for (const build of raw.builds) {
    const buildPath = asString(build?.path);
    const version = asString(build?.version);
    const longVersion = asString(build?.longVersion);
    if (buildPath === undefined || version === undefined || longVersion === undefined) continue;
    builds.push({ path: buildPath, version, longVersion, sha256: asString(build.sha256) });
  }
  if (builds.length === 0) return [];

  const byShort = new Map<string, RawListBuild>();
  for (const build of builds) byShort.set(build.version, build);
  const releases = isRecord(raw.releases) ? raw.releases : {};
  for (const [short, fileName] of Object.entries(releases)) {
    const releaseFile = asString(fileName);
    const canonical =
      releaseFile !== undefined ? builds.find(b => b.path === releaseFile) : undefined;
    if (canonical !== undefined) byShort.set(short, canonical);
  }

  return [...byShort.values()]
    .map(build => ({
      version: build.version,
      longVersion: build.longVersion,
      prerelease: build.longVersion.includes('-'),
    }))
    .sort(compareVersionEntriesDesc);
}

// Newest first; at equal numbers a release sorts before its prereleases.
export function compareVersionEntriesDesc(a: SolcVersionEntry, b: SolcVersionEntry): number {
  const parse = (v: string): number[] => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  };
  const [aMajor, aMinor, aPatch] = parse(a.version);
  const [bMajor, bMinor, bPatch] = parse(b.version);
  if (aMajor !== bMajor) return bMajor - aMajor;
  if (aMinor !== bMinor) return bMinor - aMinor;
  if (aPatch !== bPatch) return bPatch - aPatch;
  if (a.prerelease !== b.prerelease) return a.prerelease ? 1 : -1;
  return b.longVersion.localeCompare(a.longVersion);
}

// Version strings are honored only when they resolve to a listed build —
// exactly one longVersion match, or a short version that maps to exactly
// one entry. Anything else is refused (never turned into a URL).
export function resolveCompilerVersion(
  version: string,
  entries: readonly SolcVersionEntry[],
): SolcVersionEntry | null {
  const exact = entries.find(entry => entry.longVersion === version);
  if (exact !== undefined) return exact;
  const byShort = entries.filter(entry => entry.version === version);
  return byShort.length === 1 ? byShort[0] : null;
}

// Offline fallback: soljson files already in the local cache identify
// their version in the file name (soljson-v<version>.cjs — cached with a
// .cjs extension so "type": "module" packages can still require them).
// These entries carry no checksum (they were verified when downloaded)
// but make their compilers usable without the network.
export function parseCachedCompilerNames(fileNames: readonly string[]): SolcVersionEntry[] {
  const entries: SolcVersionEntry[] = [];
  for (const fileName of fileNames) {
    const match = /^soljson-v(.+)\.cjs$/.exec(fileName);
    if (match === null) continue;
    const longVersion = match[1];
    entries.push({
      version: longVersion.split('+')[0],
      longVersion,
      prerelease: longVersion.includes('-'),
    });
  }
  return entries.sort(compareVersionEntriesDesc);
}

// ---------------------------------------------------------------------------
// Auxdata splitter + tier classification (pure, exported for unit tests)
// ---------------------------------------------------------------------------

export type BytecodeSplit = { code: string; auxdata: string | null };

const HEX_BODY_RE = /^[0-9a-f]*$/;

const normalizeHex = (hex: string): string => {
  const lowered = hex.toLowerCase();
  return lowered.startsWith('0x') ? lowered.slice(2) : lowered;
};

// Every metadata block Solidity appends carries the compiler version
// under the 'solc' CBOR key; combined with the map head and trailing
// 2-byte length check this makes false positives on real bytecode
// vanishingly unlikely.
const SOLC_KEY_BYTES = Buffer.from('solc', 'utf8');
// CBOR map heads for 1..23 entries: 0xa1..0xb7.
const CBOR_MAP_HEAD_MIN = 0xa1;
const CBOR_MAP_HEAD_MAX = 0xb7;

// Strips ONE trailing CBOR auxdata block (the `a1…0033`-style,
// 2-byte-BE-length-terminated metadata Solidity appends with the default
// metadata settings). Exactly one block is stripped — that is what
// Solidity emits, and looping would risk cutting real code whose tail
// merely looks like a block (immutable values, pushed constants).
// Lookalikes mid-code are never touched.
export function stripTrailingAuxdata(hex: string): BytecodeSplit {
  const normalized = normalizeHex(hex);
  if (normalized.length < 8 || normalized.length % 2 !== 0 || !HEX_BODY_RE.test(normalized)) {
    return { code: normalized, auxdata: null };
  }
  const bytes = Buffer.from(normalized, 'hex');
  const declaredLength = bytes.readUInt16BE(bytes.length - 2);
  if (declaredLength < 2 || declaredLength + 2 > bytes.length) {
    return { code: normalized, auxdata: null };
  }
  const payload = bytes.subarray(bytes.length - 2 - declaredLength, bytes.length - 2);
  const head = payload[0];
  if (head < CBOR_MAP_HEAD_MIN || head > CBOR_MAP_HEAD_MAX) {
    return { code: normalized, auxdata: null };
  }
  if (!payload.includes(SOLC_KEY_BYTES)) {
    return { code: normalized, auxdata: null };
  }
  return {
    code: bytes.subarray(0, bytes.length - 2 - declaredLength).toString('hex'),
    auxdata: payload.toString('hex'),
  };
}

export type BytecodeComparisonTier = 'exact' | 'matches-metadata-only' | 'mismatch';

export type BytecodeComparison = {
  tier: BytecodeComparisonTier;
  /** Raw (pre-strip) byte lengths of both sides. */
  onChainRawBytes: number;
  compiledRawBytes: number;
  /** Normalized (post-strip) byte lengths. */
  onChainBytes: number;
  compiledBytes: number;
  /** mismatch: byte offset of the first difference between the normalized codes. */
  firstDiffByteOffset?: number;
  /** matches-metadata-only: the stripped auxdata blocks ('' when a side had none). */
  onChainAuxdata?: string;
  compiledAuxdata?: string;
};

export function compareRuntimeBytecode(
  onChainHex: string,
  compiledHex: string,
): BytecodeComparison {
  const onChainRaw = normalizeHex(onChainHex);
  const compiledRaw = normalizeHex(compiledHex);
  const onChain = stripTrailingAuxdata(onChainRaw);
  const compiled = stripTrailingAuxdata(compiledRaw);
  const base = {
    onChainRawBytes: onChainRaw.length / 2,
    compiledRawBytes: compiledRaw.length / 2,
    onChainBytes: onChain.code.length / 2,
    compiledBytes: compiled.code.length / 2,
  };
  if (onChainRaw === compiledRaw) {
    return { tier: 'exact', ...base };
  }
  if (onChain.code === compiled.code) {
    return {
      tier: 'matches-metadata-only',
      ...base,
      onChainAuxdata: onChain.auxdata ?? '',
      compiledAuxdata: compiled.auxdata ?? '',
    };
  }
  // First differing byte over the normalized halves — the offset a user
  // diffs from when recompiling with different settings. Bytes (not hex
  // chars) are compared so a low-nibble-only difference is caught; a
  // strict prefix reports the shorter length.
  let byteOffset = 0;
  const maxBytes = Math.min(onChain.code.length, compiled.code.length) / 2;
  while (
    byteOffset < maxBytes &&
    onChain.code.slice(byteOffset * 2, byteOffset * 2 + 2) ===
    compiled.code.slice(byteOffset * 2, byteOffset * 2 + 2)
  ) {
    byteOffset += 1;
  }
  return { tier: 'mismatch', ...base, firstDiffByteOffset: byteOffset };
}

// ---------------------------------------------------------------------------
// Standard JSON input normalization (pure, exported for unit tests)
// ---------------------------------------------------------------------------

export type StandardJsonInput = {
  language: string;
  sources: Record<string, { content?: string }>;
  settings: Record<string, unknown>;
};

export type StandardJsonValidation =
  | { ok: true; input: StandardJsonInput; unwrappedFromBuildInfo: boolean }
  | { ok: false; message: string };

// Accepts a Standard JSON input object verbatim, or a Hardhat build-info
// file verbatim (its `input` member is unwrapped — build-info objects
// carry {input, output, solcVersion, …} and no top-level language).
export function normalizeStandardJsonInput(raw: unknown): StandardJsonValidation {
  if (!isRecord(raw)) {
    return { ok: false, message: 'standardJsonInput must be a JSON object' };
  }
  let candidate: Record<string, unknown> = raw;
  let unwrappedFromBuildInfo = false;
  if (
    !('language' in candidate) &&
    isRecord(candidate.input) &&
    'language' in candidate.input &&
    'sources' in candidate.input
  ) {
    candidate = candidate.input;
    unwrappedFromBuildInfo = true;
  }

  const language = asString(candidate.language);
  if (language === undefined) {
    return {
      ok: false,
      message:
        'standardJsonInput.language is required (a Hardhat build-info file is accepted verbatim and unwrapped automatically)',
    };
  }
  if (language !== 'Solidity') {
    return { ok: false, message: `language must be "Solidity" (got "${language}")` };
  }

  if (!isRecord(candidate.sources) || Object.keys(candidate.sources).length === 0) {
    return { ok: false, message: 'standardJsonInput.sources must be a non-empty object' };
  }
  const sources: Record<string, { content?: string }> = {};
  let totalBytes = 0;
  let withContent = 0;
  for (const [fileName, source] of Object.entries(candidate.sources)) {
    if (!isRecord(source)) {
      return { ok: false, message: `sources["${fileName}"] must be an object` };
    }
    if ('content' in source && typeof source.content !== 'string') {
      return { ok: false, message: `sources["${fileName}"].content must be a string` };
    }
    const content = asString(source.content);
    sources[fileName] = content !== undefined ? { content } : {};
    if (content !== undefined) {
      withContent += 1;
      totalBytes += Buffer.byteLength(content, 'utf8');
    }
  }
  if (withContent === 0) {
    return {
      ok: false,
      message: 'at least one source must carry inline content (solc cannot resolve imports here)',
    };
  }
  if (totalBytes > MAX_STANDARD_JSON_BYTES) {
    return {
      ok: false,
      message: `sources total ${(totalBytes / 1024 / 1024).toFixed(2)} MB; the limit is 4 MB`,
    };
  }

  if (!isRecord(candidate.settings)) {
    return {
      ok: false,
      message: 'standardJsonInput.settings is required (an empty object {} is fine)',
    };
  }

  return {
    ok: true,
    input: { language, sources, settings: candidate.settings },
    unwrappedFromBuildInfo,
  };
}

// Merges the output selections we need (ABI + runtime bytecode) into the
// caller's settings and drops `stopAfter` — verification needs the full
// compilation, not a parse-only run.
export function buildCompileInput(input: StandardJsonInput): StandardJsonInput {
  const settings: Record<string, unknown> = { ...input.settings };
  delete settings.stopAfter;
  const outputSelection: Record<string, unknown> = isRecord(settings.outputSelection)
    ? { ...settings.outputSelection }
    : {};
  const star = isRecord(outputSelection['*']) ? { ...outputSelection['*'] } : {};
  const requested = Array.isArray(star['*']) ? star['*'] : [];
  star['*'] = [
    ...new Set([...requested, 'abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']),
  ];
  outputSelection['*'] = star;
  settings.outputSelection = outputSelection;
  return { language: input.language, sources: input.sources, settings };
}

// ---------------------------------------------------------------------------
// Compiled-contract selection (pure, exported for unit tests)
// ---------------------------------------------------------------------------

export type CompiledContract = {
  /** Canonical 'File.sol:Name' identifier. */
  key: string;
  name: string;
  contract: Record<string, unknown>;
};

export function flattenCompiledContracts(contracts: unknown): CompiledContract[] {
  if (!isRecord(contracts)) return [];
  const flattened: CompiledContract[] = [];
  for (const [file, fileContracts] of Object.entries(contracts)) {
    if (!isRecord(fileContracts)) continue;
    for (const [name, contract] of Object.entries(fileContracts)) {
      if (!isRecord(contract)) continue;
      flattened.push({ key: `${file}:${name}`, name, contract });
    }
  }
  return flattened.sort((a, b) => a.key.localeCompare(b.key));
}

const MAX_CANDIDATES = 10;

// contractName is optional when the input compiles to exactly one
// contract and required otherwise. Accepted forms: the full
// 'File.sol:Name' key or a bare 'Name' that is unambiguous.
export function selectCompiledContract(
  contracts: readonly CompiledContract[],
  contractName: string | undefined,
): CompiledContract {
  if (contractName !== undefined && typeof contractName !== 'string') {
    throw invalidInput('contractName must be a string when present');
  }
  const trimmed = contractName?.trim() ?? '';
  if (contracts.length === 1 && trimmed === '') {
    return contracts[0];
  }
  if (contracts.length !== 1 && trimmed === '') {
    throw new CompileVerifyHttpError(
      400,
      'contract_name_required',
      `The input compiled to ${contracts.length} contracts; contractName is required to pick one`,
      { candidates: contracts.map(contract => contract.key) },
    );
  }
  const byKey = contracts.find(contract => contract.key === trimmed);
  if (byKey !== undefined) return byKey;
  const byName = contracts.filter(contract => contract.name === trimmed);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new CompileVerifyHttpError(
      400,
      'unknown_contract',
      `contractName "${trimmed}" matches ${byName.length} contracts; use the full File:Name form`,
      { candidates: byName.map(contract => contract.key) },
    );
  }
  throw new CompileVerifyHttpError(
    400,
    'unknown_contract',
    `contractName "${trimmed}" matches none of the ${contracts.length} compiled contracts`,
    { candidates: contracts.slice(0, MAX_CANDIDATES).map(contract => contract.key) },
  );
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

// The solc wrapper API the service needs (the package's own d.ts is
// `any` end to end, so the surface is declared structurally here).
export type SolcCompilerHandle = {
  compile: (input: string) => string;
  semver: () => string;
};
type SolcWrapper = (soljson: unknown) => SolcCompilerHandle;

// The wrapper and the soljson builds are CommonJS artifacts; createRequire
// keeps them true runtime requires so bundling the server (tsup) never
// inlines the 9 MB soljson graph — they resolve from node_modules / the
// solc cache at runtime under tsx and the built server alike.
const nodeRequire = createRequire(import.meta.url);

const loadSolcWrapper = (): SolcWrapper => nodeRequire('solc/wrapper') as SolcWrapper;

export type CompilerListResult = {
  versions: SolcVersionEntry[];
  /**
   * Set when the upstream list could not be fetched: the versions then
   * come from the local soljson cache (possibly none) — an honest
   * degraded state, not fabricated data.
   */
  degraded?: string;
};

export type CompileVerifySuccess = {
  ok: true;
  tier: 'exact' | 'matches-metadata-only';
  /** Resolved 'File.sol:Name'. */
  contractName: string;
  /** Resolved longVersion. */
  compilerVersion: string;
  comparison: BytecodeComparison;
  warnings: string[];
  /** Fields the route persists through contractSourceService. */
  saved: {
    name: string;
    abi: string;
    sourceFiles: { filename: string; content: string }[];
    sourceCode: string;
    compilerVersion: string;
    optimizationEnabled?: boolean;
    optimizationRuns?: number;
    evmVersion?: string;
  };
};

export type CompileVerifyFailure =
  | {
    ok: false;
    kind: 'mismatch';
    message: string;
    comparison: BytecodeComparison;
    warnings: string[];
  }
  | { ok: false; kind: 'compile_error'; errors: string[] }
  | { ok: false; kind: 'no_contracts'; message: string }
  | { ok: false; kind: 'no_runtime_bytecode'; message: string };

export type CompileVerifyOutcome = CompileVerifySuccess | CompileVerifyFailure;

export type CompileVerifyDeps = {
  /** JSON fetcher for the version list (injectable for tests). */
  fetchJson?: (url: string, signal: AbortSignal) => Promise<unknown>;
  /** Compiler loader (injectable for tests). */
  loadCompilerBuild?: (build: ResolvedSolcBuild) => Promise<SolcCompilerHandle>;
  /** On-chain eth_getCode boundary (injectable for tests). */
  fetchRuntimeCode?: (chainId: number, address: Address) => Promise<string>;
  /** solc-cache directory reader (injectable for tests). */
  readCacheDir?: () => Promise<string[]>;
};

export class CompileVerifyService {
  private readonly deps: CompileVerifyDeps;
  // The raw list is kept alongside the parsed entries so checksum
  // resolution (resolveBuild) never refetches what the 24h cache holds.
  private versionListState: {
    raw: unknown | null;
    result: CompilerListResult;
    ttlMs: number;
    resolvedAt: number;
  } | null = null;

  private versionListInFlight: Promise<CompilerListResult> | null = null;
  private readonly compilerCache = new Map<string, Promise<SolcCompilerHandle>>();

  constructor(deps: CompileVerifyDeps = {}) {
    this.deps = deps;
  }

  // The compilers endpoint's answer: the official wasm list, 24h
  // process-cached; offline it degrades to the locally cached builds
  // (possibly none) with an honest note instead of throwing. Degraded
  // answers re-probe after 5 minutes, so a network blip never pins
  // "unavailable" for a day.
  async listCompilerVersions(): Promise<CompilerListResult> {
    if (this.versionListState !== null) {
      const age = Date.now() - this.versionListState.resolvedAt;
      if (age < this.versionListState.ttlMs) return this.versionListState.result;
    }
    if (this.versionListInFlight !== null) return this.versionListInFlight;
    this.versionListInFlight = this.fetchVersionList().finally(() => {
      this.versionListInFlight = null;
    });
    const result = await this.versionListInFlight;
    return result;
  }

  private async fetchVersionList(): Promise<CompilerListResult> {
    try {
      const raw = await (this.deps.fetchJson ?? defaultFetchJson)(
        SOLC_LIST_URL,
        AbortSignal.timeout(15_000),
      );
      const versions = parseSolcVersionList(raw);
      if (versions.length === 0) {
        throw new Error('the list contained no usable builds');
      }
      this.versionListState = {
        raw,
        result: { versions },
        ttlMs: VERSION_LIST_TTL_MS,
        resolvedAt: Date.now(),
      };
      return { versions };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      const cached = await this.listCachedVersions();
      const degraded =
        cached.length > 0
          ? `Compiler list unavailable (binaries.soliditylang.org: ${reason}); showing ${cached.length} build(s) already downloaded to this server — they remain usable offline.`
          : `Compiler list unavailable (binaries.soliditylang.org: ${reason}) and no soljson is cached locally — compiling needs internet access to binaries.soliditylang.org (once per compiler version).`;
      logger.warn({ reason, cached: cached.length }, 'solc version list degraded to cache');
      const result: CompilerListResult = { versions: cached, degraded };
      this.versionListState = {
        raw: null,
        result,
        ttlMs: DEGRADED_LIST_TTL_MS,
        resolvedAt: Date.now(),
      };
      return result;
    }
  }

  private async listCachedVersions(): Promise<SolcVersionEntry[]> {
    try {
      const readDir = this.deps.readCacheDir ?? readdir;
      const fileNames = await readDir(SOLC_CACHE_DIR);
      return parseCachedCompilerNames(fileNames);
    } catch {
      // Missing/empty cache dir is the normal cold start, not an error.
      return [];
    }
  }

  // Resolves a listed version entry to its build descriptor (file name +
  // checksum) from the cached raw list. When the list is unavailable but
  // the soljson is already cached, the cache-file name alone is enough
  // (its checksum was verified at download time).
  private async resolveBuild(entry: SolcVersionEntry): Promise<ResolvedSolcBuild> {
    const base: ResolvedSolcBuild = {
      longVersion: entry.longVersion,
      version: entry.version,
      prerelease: entry.prerelease,
      fileName: `soljson-v${entry.longVersion}.js`,
    };
    await this.listCompilerVersions();
    const raw = this.versionListState?.raw;
    if (!isRecord(raw) || !Array.isArray(raw.builds)) return base;
    for (const build of raw.builds) {
      if (asString(build?.longVersion) === entry.longVersion) {
        const sha256 = asString(build.sha256);
        if (sha256 !== undefined) return { ...base, sha256 };
      }
    }
    return base;
  }

  private async loadCompiler(build: ResolvedSolcBuild): Promise<SolcCompilerHandle> {
    const loader = this.deps.loadCompilerBuild;
    if (loader !== undefined) return loader(build);
    const cached = this.compilerCache.get(build.longVersion);
    if (cached !== undefined) return cached;
    const loading = this.downloadAndLoad(build);
    this.compilerCache.set(build.longVersion, loading);
    // Drop rejected promises so a transient failure can be retried.
    void loading.catch(() => this.compilerCache.delete(build.longVersion));
    return loading;
  }

  private async downloadAndLoad(build: ResolvedSolcBuild): Promise<SolcCompilerHandle> {
    // The cache file keeps the official name but with a .cjs extension:
    // this package is "type": "module", and Node would otherwise load a
    // cached .js soljson as ESM — the Emscripten build needs CommonJS
    // (__dirname/module.exports). tsx masks this (its require hook treats
    // .js as CJS); the real `node dist/server/cli.js` run does not.
    const cacheFileName = build.fileName.replace(/\.js$/, '.cjs');
    const cachePath = path.join(SOLC_CACHE_DIR, cacheFileName);
    try {
      const existing = await readFile(cachePath);
      logger.info({ longVersion: build.longVersion, bytes: existing.length }, 'soljson cache hit');
    } catch {
      // Not cached: download under the load budget, verify the checksum
      // from the list, then write atomically (tmp + rename) so a partial
      // download can never be mistaken for a usable build.
      let response: Response;
      try {
        response = await fetch(`${SOLC_BINARIES_BASE_URL}${build.fileName}`, {
          signal: AbortSignal.timeout(COMPILER_LOAD_BUDGET_MS),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        throw compilerUnavailable(
          `Could not download solc ${build.longVersion} from binaries.soliditylang.org (${reason}); this server needs internet access the first time a compiler version is used`,
        );
      }
      if (!response.ok) {
        throw compilerUnavailable(
          `binaries.soliditylang.org answered HTTP ${response.status} for solc ${build.longVersion}`,
        );
      }
      const downloaded = Buffer.from(await response.arrayBuffer());
      if (build.sha256 !== undefined) {
        const digest = `0x${createHash('sha256').update(downloaded).digest('hex')}`;
        if (digest !== build.sha256.toLowerCase()) {
          throw compilerUnavailable(
            `soljson checksum mismatch for solc ${build.longVersion} — the downloaded file was discarded`,
          );
        }
      }
      await mkdir(SOLC_CACHE_DIR, { recursive: true });
      const tempPath = `${cachePath}.tmp`;
      await writeFile(tempPath, downloaded);
      await rename(tempPath, cachePath);
      logger.info(
        { longVersion: build.longVersion, bytes: downloaded.length },
        'soljson downloaded and cached',
      );
    }

    // The soljson file is a CommonJS Emscripten build; loading it through
    // require lets it set up module.exports the way the wrapper expects.
    let soljson: unknown;
    try {
      soljson = nodeRequire(path.resolve(cachePath));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw compilerUnavailable(`Failed to load the solc ${build.longVersion} build: ${reason}`);
    }
    try {
      return loadSolcWrapper()(soljson);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw compilerUnavailable(
        `Failed to initialize the solc ${build.longVersion} build: ${reason}`,
      );
    }
  }

  // The whole flow: validate → resolve version → load compiler → compile
  // → pick contract → fetch on-chain runtime code → compare.
  async verifyByCompilation(
    chainId: number,
    address: Address,
    input: { compilerVersion: unknown; standardJsonInput: unknown; contractName?: unknown },
  ): Promise<CompileVerifyOutcome> {
    const compilerVersion = asString(input.compilerVersion);
    if (compilerVersion === undefined || compilerVersion.trim() === '') {
      throw invalidInput('compilerVersion is required and must be a non-empty string');
    }
    if (input.contractName !== undefined && typeof input.contractName !== 'string') {
      throw invalidInput('contractName must be a string when present');
    }
    const validation = normalizeStandardJsonInput(input.standardJsonInput);
    if (!validation.ok) {
      throw invalidInput(validation.message);
    }

    const list = await this.listCompilerVersions();
    const versionEntry = resolveCompilerVersion(compilerVersion.trim(), list.versions);
    if (versionEntry === null) {
      throw invalidInput(
        list.versions.length > 0
          ? `Unknown compiler version "${compilerVersion}" — use one from GET .../verify/compilers (${list.versions.length} available)`
          : `Compiler versions are currently unavailable, so "${compilerVersion}" cannot be verified against the official list`,
      );
    }

    const build = await this.resolveBuild(versionEntry);
    const compiler = await this.loadCompiler(build);

    const compileInput = buildCompileInput(validation.input);
    let output: unknown;
    try {
      output = JSON.parse(compiler.compile(JSON.stringify(compileInput)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw compileFailed(`The solc ${versionEntry.longVersion} build crashed while compiling: ${reason}`);
    }

    const diagnostics = isRecord(output) && Array.isArray(output.errors) ? output.errors : [];
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const diagnostic of diagnostics) {
      if (!isRecord(diagnostic)) continue;
      const severity = asString(diagnostic.severity) ?? 'error';
      const message = asString(diagnostic.formattedMessage) ?? JSON.stringify(diagnostic);
      (severity === 'warning' ? warnings : errors).push(message);
    }
    if (errors.length > 0) {
      return { ok: false, kind: 'compile_error', errors };
    }

    const contracts = flattenCompiledContracts(isRecord(output) ? output.contracts : undefined);
    if (contracts.length === 0) {
      return {
        ok: false,
        kind: 'no_contracts',
        message: 'The input compiled without errors but produced no contracts',
      };
    }
    const selected = selectCompiledContract(contracts, input.contractName);

    const runtimeCode = extractRuntimeBytecode(selected.contract);
    if (runtimeCode === null) {
      return {
        ok: false,
        kind: 'no_runtime_bytecode',
        message: `Contract "${selected.key}" compiled without runtime bytecode (abstract contracts and interfaces have none)`,
      };
    }

    const onChainCode = await this.fetchOnChainCode(chainId, address);
    // Same contract-vs-EOA check as ContractSourceService.getContractSource:
    // empty/0x code is an EOA (or an undeployed name), never a verify target.
    if (!onChainCode || onChainCode === '0x' || onChainCode.length <= 2) {
      throw new CompileVerifyHttpError(
        400,
        'not_a_contract',
        'The address has no deployed code — an EOA cannot be verified',
      );
    }

    const comparison = compareRuntimeBytecode(onChainCode, runtimeCode);
    if (comparison.tier === 'mismatch') {
      return {
        ok: false,
        kind: 'mismatch',
        message: `Recompiled runtime bytecode does not match the on-chain code (first difference at byte ${comparison.firstDiffByteOffset}; on-chain ${comparison.onChainBytes} bytes vs recompiled ${comparison.compiledBytes} bytes after metadata strip)`,
        comparison,
        warnings,
      };
    }

    const settings = validation.input.settings;
    const optimizer = isRecord(settings.optimizer) ? settings.optimizer : undefined;
    const optimizerEnabled =
      optimizer !== undefined && typeof optimizer.enabled === 'boolean'
        ? optimizer.enabled
        : undefined;
    const optimizerRuns =
      optimizer !== undefined && typeof optimizer.runs === 'number' ? optimizer.runs : undefined;
    const evmVersion = asString(settings.evmVersion);

    const sourceFiles = Object.entries(validation.input.sources)
      .filter(([, source]) => typeof source.content === 'string')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filename, source]) => ({ filename, content: source.content as string }));
    const abi = extractAbi(selected.contract);

    return {
      ok: true,
      tier: comparison.tier,
      contractName: selected.key,
      compilerVersion: versionEntry.longVersion,
      comparison,
      warnings,
      saved: {
        name: selected.name,
        abi,
        sourceFiles,
        sourceCode: sourceFiles[0]?.content ?? '',
        compilerVersion: versionEntry.longVersion,
        ...(optimizerEnabled !== undefined ? { optimizationEnabled: optimizerEnabled } : {}),
        ...(optimizerRuns !== undefined ? { optimizationRuns: optimizerRuns } : {}),
        ...(evmVersion !== undefined ? { evmVersion } : {}),
      },
    };
  }

  // eth_getCode boundary. Imported dynamically so importing this service
  // (e.g. through the routes in unit tests) never pulls the DuckDB-backed
  // RpcManager graph at module load.
  private async fetchOnChainCode(chainId: number, address: Address): Promise<string> {
    const fetcher = this.deps.fetchRuntimeCode;
    if (fetcher !== undefined) {
      try {
        return await fetcher(chainId, address);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        throw rpcUnavailable(`Could not fetch the on-chain code: ${reason}`);
      }
    }
    const { rpcManager } = await import('./RpcManager');
    let client: Awaited<ReturnType<typeof rpcManager.getClient>>;
    try {
      client = await rpcManager.getClient(chainId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw rpcUnavailable(`No RPC client for chain ${chainId}: ${reason}`);
    }
    try {
      // viem types getCode as string | undefined (undefined on skipped
      // requests); both empty and undefined mean "no code" to the caller.
      return (await client.getCode({ address })) ?? '';
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw rpcUnavailable(`eth_getCode failed for ${address} on chain ${chainId}: ${reason}`);
    }
  }
}

const extractRuntimeBytecode = (contract: Record<string, unknown>): string | null => {
  const evm = contract.evm;
  if (!isRecord(evm)) return null;
  const deployed = evm.deployedBytecode;
  if (!isRecord(deployed)) return null;
  const object = asString(deployed.object);
  if (object === undefined || object === '' || object === '0x') return null;
  return object;
};

const extractAbi = (contract: Record<string, unknown>): string => {
  const abi = contract.abi;
  return Array.isArray(abi) ? JSON.stringify(abi) : '[]';
};

const defaultFetchJson = async (url: string, signal: AbortSignal): Promise<unknown> => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
};

export const compileVerifyService = new CompileVerifyService();
