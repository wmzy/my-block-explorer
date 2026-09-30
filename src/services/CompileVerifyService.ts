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
//   they are used and cached under data/solc-cache/ — a list entry that
//   carries no checksum is refused outright, never downloaded;
// - the comparison reports three honest tiers: exact (raw equal),
//   matches-metadata-only (equal after stripping the trailing CBOR
//   auxdata block — the differing auxdata is reported), mismatch (first
//   differing byte offset plus both lengths);
// - offline/unfetchable compiler resources surface as typed errors
//   naming the network need; a cached build stays usable without it;
// - the compile itself runs in a worker_threads Worker (never on the
//   event loop) under a hard timeout that terminates the worker, and
//   resident compilers are capped — see WorkerSolcRunner.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
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
// The compile itself gets one hard minute inside its worker thread: on
// expiry the worker is terminated and the caller hears a typed timeout.
// solc's constant-expression solver can loop forever on pathological
// inputs, so a budget is the only honest ceiling a compile can have.
export const COMPILE_TIMEOUT_MS = 60_000;
// Resident compiler workers are capped: each holds a live wasm solc
// instance, so at capacity the least-recently-used worker is evicted
// (terminated). The on-disk soljson cache stays — it is the expensive,
// content-verified part, and re-creating a worker from it is cheap.
export const MAX_RESIDENT_COMPILERS = 3;
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
  readonly status: 400 | 500 | 502 | 504;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: 400 | 500 | 502 | 504,
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

export const compileTimedOut = (message: string) =>
  new CompileVerifyHttpError(504, 'compile_timeout', message);

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

// The execution boundary the service consumes: compile runs OFF the
// main thread under a hard timeout (a synchronous solc compile on the
// event loop stalls every request, WatchService tick and SSE frame for
// as long as solc feels like taking), and dispose tears the underlying
// worker down once it is idle.
export type SolcCompileRunner = {
  /** One Standard-JSON compile; resolves with solc's JSON output. */
  compile: (input: string) => Promise<string>;
  /** True once the runner's worker is gone (timeout, crash, eviction). */
  isDead: () => boolean;
  /** Releases the worker; in-flight compiles are allowed to finish. */
  dispose: () => void;
};

export type CompileRunnerParams = {
  /** Absolute path of the sha256-verified soljson cache file. */
  solcPath: string;
  longVersion: string;
};

export type CompileRunnerFactory = (params: CompileRunnerParams) => Promise<SolcCompileRunner>;

// ---------------------------------------------------------------------------
// Compile worker — worker_threads delivery of the solc execution
// ---------------------------------------------------------------------------

// Delivery mechanism: an eval'd bootstrap worker (new Worker(code,
// { eval: true })) rather than a separate worker FILE. The bootstrap is
// a self-contained string that ships inside this module unchanged under
// tsx (dev) and inside the tsup bundle (production) — there is no worker
// file path that would have to resolve differently per mode, and no
// runtime dependency on the `solc` npm package (removed from this repo's
// dependencies on 2026-09-30): the only input is the ABSOLUTE path of
// the sha256-verified soljson cache file, passed through workerData.
// CJS require is available inside eval'd workers.
//
// The wrapper semantics implemented inline in the bootstrap are a
// minimal re-derivation of solc-js's wrapper.js + bindings
// (https://github.com/ethereum/solc-js, MIT License, (c) Ethereum
// contributors) — the subset this service's compile path uses: native
// Standard-JSON compilation through `solidity_compile` with inline
// sources only (no import callback), callback registration via
// addFunction('viiiii'), and solidity_reset() after every compile to
// free compiler allocations. Older callback/translate fallbacks
// (compileJSON*/translateJsonCompilerOutput) are deliberately NOT
// reimplemented: every build in the official wasm list exposes
// solidity_compile, and one that does not is refused with an honest
// init error instead of being silently mis-driven.
// Both the 9 MB Emscripten module evaluation and the wasm instantiation
// happen HERE, in the worker — the main thread never loads soljson at
// all. A compile crash is reported as a message (the service maps it to
// compile_failed) instead of killing the worker.
const COMPILE_WORKER_BOOTSTRAP = `'use strict';
// Minimal inline re-derivation of solc-js wrapper semantics (MIT, see
// the attribution note next to this constant's declaration).
const { parentPort, workerData } = require('node:worker_threads');
const reasonOf = (error) => (error instanceof Error ? error.message : String(error));

function createCompiler(soljson) {
  if (typeof soljson.cwrap !== 'function' || typeof soljson._solidity_compile !== 'function') {
    throw new Error('the build does not expose the native Standard-JSON interface (solidity_compile)');
  }
  if (typeof soljson.addFunction !== 'function' || typeof soljson.removeFunction !== 'function') {
    throw new Error('the build does not expose function-pointer registration (addFunction/removeFunction)');
  }
  // Arity: solc >= 0.6 passes (input, callback, callback_context = 0);
  // older builds pass (input, callback). Decided from the raw version
  // string, mirroring solc-js's isVersion6OrNewer (semver > 0.5.99);
  // an unparseable version is treated as modern.
  const version = (typeof soljson._solidity_version === 'function'
    ? soljson.cwrap('solidity_version', 'string', [])
    : soljson.cwrap('version', 'string', []))();
  const match = /^\\D*(\\d+)\\.(\\d+)/.exec(version);
  const version6OrNewer = match === null || Number(match[1]) > 0 || Number(match[2]) >= 6;

  const compile = version6OrNewer
    ? soljson.cwrap('solidity_compile', 'string', ['string', 'number', 'number'])
    : soljson.cwrap('solidity_compile', 'string', ['string', 'number']);
  // reset() frees the compile-time allocations after every run (solc
  // >= 0.6); absent on older builds.
  const reset = typeof soljson._solidity_reset === 'function'
    ? soljson.cwrap('solidity_reset', null, [])
    : null;
  const alloc = typeof soljson._solidity_alloc === 'function'
    ? soljson.cwrap('solidity_alloc', 'number', ['number'])
    : soljson._malloc;
  if (typeof alloc !== 'function') {
    throw new Error('the build exposes no allocator (solidity_alloc / _malloc)');
  }

  // Inline sources only: an import or SMT request the compiler makes is
  // refused exactly the way solc-js refuses it when no caller callback
  // was supplied — written through the Emscripten string helpers into
  // the error out-pointer (copyToCString semantics).
  const writeCString = (str, pointer) => {
    const length = soljson.lengthBytesUTF8(str);
    const buffer = alloc(length + 1);
    soljson.stringToUTF8(str, buffer, length + 1);
    soljson.setValue(pointer, buffer, '*');
  };
  // >= 0.6: (context, kind, data, contents, error); older: (data, contents, error)
  const callback = version6OrNewer
    ? (context, kind, data, contents, error) => {
        writeCString('File import callback not supported', error);
      }
    : (data, contents, error) => {
        writeCString('File import callback not supported', error);
      };

  const compileStandard = (input) => {
    const callbackPointer = soljson.addFunction(callback, 'viiiii');
    try {
      return version6OrNewer ? compile(input, callbackPointer, 0) : compile(input, callbackPointer);
    } finally {
      soljson.removeFunction(callbackPointer);
      if (reset !== null) reset();
    }
  };

  return { compile: compileStandard, version: String(version) };
}

try {
  const soljson = require(workerData.solcPath);
  const compiler = createCompiler(soljson);
  parentPort.on('message', (message) => {
    if (message.kind !== 'compile') return;
    try {
      parentPort.postMessage({ kind: 'compiled', id: message.id, output: compiler.compile(message.input) });
    } catch (error) {
      parentPort.postMessage({ kind: 'compile_crashed', id: message.id, reason: reasonOf(error) });
    }
  });
  parentPort.postMessage({ kind: 'ready', version: compiler.version });
} catch (error) {
  parentPort.postMessage({ kind: 'init_failed', reason: reasonOf(error) });
}
`;

type CompileWorkerMessage =
  | { kind: 'ready'; version: string }
  | { kind: 'init_failed'; reason: string }
  | { kind: 'compiled'; id: number; output: string }
  | { kind: 'compile_crashed'; id: number; reason: string };

type PendingCompile = {
  resolve: (output: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

// One resident compiler = one worker thread. The worker loads the build
// and answers compile requests; the main thread owns the hard timeout —
// on expiry the worker is terminated outright, so even an infinite
// constant-expression loop inside solc cannot outlive COMPILE_TIMEOUT_MS.
export class WorkerSolcRunner implements SolcCompileRunner {
  readonly threadId: number;

  private readonly worker: Worker;
  private readonly longVersion: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, PendingCompile>();
  private nextId = 1;
  private activeCompiles = 0;
  private disposeRequested = false;
  private terminated = false;

  private constructor(worker: Worker, longVersion: string, timeoutMs: number) {
    this.worker = worker;
    this.longVersion = longVersion;
    this.timeoutMs = timeoutMs;
    this.threadId = worker.threadId;
    this.worker.on('message', (message: CompileWorkerMessage) => {
      this.onCompileResult(message);
    });
    this.worker.on('exit', () => {
      this.rejectAllPending(new Error(`The solc ${this.longVersion} compile worker exited`));
    });
    this.worker.on('error', (error: Error) => {
      this.rejectAllPending(error);
    });
  }

  // Spawns the worker and waits for it to load the soljson build (the
  // wasm load can take seconds; it gets the same load budget as the
  // download). Init failures, an init timeout or a dying worker surface
  // as the honest compiler_unavailable — the worker is torn down either
  // way, never left half-loaded.
  static async start(params: {
    solcPath: string;
    longVersion: string;
    timeoutMs?: number;
  }): Promise<WorkerSolcRunner> {
    const worker = new Worker(COMPILE_WORKER_BOOTSTRAP, {
      eval: true,
      workerData: { solcPath: params.solcPath },
    });
    const runner = new WorkerSolcRunner(worker, params.longVersion, params.timeoutMs ?? COMPILE_TIMEOUT_MS);
    try {
      await new Promise<void>((resolve, reject) => {
        const settle = (action: () => void) => {
          clearTimeout(timer);
          worker.off('message', onMessage);
          worker.off('exit', onExit);
          worker.off('error', onError);
          action();
        };
        const timer = setTimeout(() => {
          settle(() =>
            reject(
              compilerUnavailable(
                `Failed to initialize the solc ${params.longVersion} build: timed out after ${Math.round(COMPILER_LOAD_BUDGET_MS / 1000)}s`,
              ),
            ),
          );
        }, COMPILER_LOAD_BUDGET_MS);
        timer.unref();
        const onMessage = (message: CompileWorkerMessage): void => {
          if (message.kind === 'ready') {
            settle(resolve);
          } else if (message.kind === 'init_failed') {
            settle(() =>
              reject(
                compilerUnavailable(
                  `Failed to initialize the solc ${params.longVersion} build: ${message.reason}`,
                ),
              ),
            );
          }
        };
        const onExit = (): void => {
          settle(() =>
            reject(
              compilerUnavailable(
                `Failed to initialize the solc ${params.longVersion} build: the compile worker exited before the build was ready`,
              ),
            ),
          );
        };
        const onError = (error: Error): void => {
          settle(() =>
            reject(
              compilerUnavailable(
                `Failed to initialize the solc ${params.longVersion} build: ${error.message}`,
              ),
            ),
          );
        };
        worker.on('message', onMessage);
        worker.on('exit', onExit);
        worker.on('error', onError);
      });
    } catch (error) {
      void worker.terminate();
      throw error;
    }
    return runner;
  }

  compile(input: string): Promise<string> {
    if (this.terminated) {
      return Promise.reject(
        new Error(`The solc ${this.longVersion} compile worker was terminated`),
      );
    }
    this.activeCompiles++;
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Hard stop: the compile is terminated, never left running, and
        // the caller hears the typed timeout (504 compile_timeout).
        this.pending.delete(id);
        void this.worker.terminate();
        this.terminated = true;
        reject(
          compileTimedOut(
            `The solc ${this.longVersion} compile timed out after ${Math.round(this.timeoutMs / 1000)}s and was terminated — try a smaller contract, fewer sources, or lower optimizer runs`,
          ),
        );
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ kind: 'compile', id, input });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }).finally(() => {
      this.activeCompiles--;
      // A dispose that arrived mid-compile takes effect once idle.
      if (this.disposeRequested && this.activeCompiles === 0 && !this.terminated) {
        this.terminateNow();
      }
    });
  }

  isDead(): boolean {
    return this.terminated;
  }

  dispose(): void {
    this.disposeRequested = true;
    if (this.activeCompiles === 0 && !this.terminated) this.terminateNow();
  }

  private terminateNow(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.rejectAllPending(new Error(`The solc ${this.longVersion} compile worker was disposed`));
    void this.worker.terminate();
  }

  private rejectAllPending(error: Error): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  private onCompileResult(message: CompileWorkerMessage): void {
    if (message.kind !== 'compiled' && message.kind !== 'compile_crashed') return;
    const entry = this.pending.get(message.id);
    if (entry === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.kind === 'compiled') entry.resolve(message.output);
    else entry.reject(new Error(message.reason));
  }
}

// Default runner factory: hand the verified soljson path to the worker;
// the wrapper semantics live inline in the bootstrap (no `solc` npm
// dependency — see the attribution note above).
const defaultCreateCompileRunner: CompileRunnerFactory = async params =>
  WorkerSolcRunner.start(params);

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
  /** solc-cache directory override (injectable for tests; default data/solc-cache). */
  cacheDir?: string;
  /**
   * Compile-runner factory (injectable for tests). Default: a
   * worker_threads Worker that loads the verified soljson off the main
   * thread (see WorkerSolcRunner).
   */
  createCompileRunner?: CompileRunnerFactory;
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
  // Resident compile runners (one worker thread each), insertion order
  // = least-recently-used order; capped at MAX_RESIDENT_COMPILERS.
  private readonly compilerCache = new Map<string, Promise<SolcCompileRunner>>();

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
      // The cache-dir override applies here too — the offline fallback
      // must see the same directory downloads land in.
      const fileNames = await readDir(this.deps.cacheDir ?? SOLC_CACHE_DIR);
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

  private async loadCompiler(build: ResolvedSolcBuild): Promise<SolcCompileRunner> {
    const loader = this.deps.loadCompilerBuild;
    if (loader !== undefined) {
      // Test/inline path: a directly-injected handle compiles
      // synchronously — wrap it in the runner surface (no worker, no
      // timeout, no residency; the stub owns its own lifecycle).
      const handle = await loader(build);
      return {
        compile: input => {
          try {
            return Promise.resolve(handle.compile(input));
          } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        isDead: () => false,
        dispose: () => {},
      };
    }
    const cached = this.compilerCache.get(build.longVersion);
    if (cached !== undefined) {
      // Delete + re-insert moves the version to the back of the Map —
      // insertion order IS the least-recently-used order.
      this.compilerCache.delete(build.longVersion);
      this.compilerCache.set(build.longVersion, cached);
      return cached;
    }
    const loading = this.downloadAndLoad(build);
    this.compilerCache.set(build.longVersion, loading);
    // Drop rejected promises so a transient failure can be retried.
    void loading.catch(() => {
      this.compilerCache.delete(build.longVersion);
    });
    this.evictLeastRecentlyUsed(build.longVersion);
    return loading;
  }

  // Evicts from the Map's front (least recently used) while over
  // capacity; the version just inserted is never the victim. A victim
  // that is still loading is disposed once it resolves — dispose lets
  // its in-flight compiles finish first.
  private evictLeastRecentlyUsed(keep: string): void {
    for (const [version, runnerPromise] of this.compilerCache) {
      if (this.compilerCache.size <= MAX_RESIDENT_COMPILERS) return;
      if (version === keep) continue;
      this.compilerCache.delete(version);
      void runnerPromise
        .then(runner => runner.dispose())
        .catch(() => {
          // The load itself failed; nothing resident to dispose.
        });
    }
  }

  private async downloadAndLoad(build: ResolvedSolcBuild): Promise<SolcCompileRunner> {
    // The cache file keeps the official name but with a .cjs extension:
    // this package is "type": "module", and Node would otherwise load a
    // cached .js soljson as ESM — the Emscripten build needs CommonJS
    // (__dirname/module.exports). tsx masks this (its require hook treats
    // .js as CJS); the real `node dist/server/cli.js` run does not.
    const cacheFileName = build.fileName.replace(/\.js$/, '.cjs');
    const cachePath = path.join(this.deps.cacheDir ?? SOLC_CACHE_DIR, cacheFileName);
    try {
      const existing = await readFile(cachePath);
      logger.info({ longVersion: build.longVersion, bytes: existing.length }, 'soljson cache hit');
    } catch {
      // Not cached: download under the load budget, verify the checksum
      // from the list, then write atomically (tmp + rename) so a partial
      // download can never be mistaken for a usable build.
      // Fail closed on unverifiable builds: a list entry without a sha256
      // would let an unauthenticated blob — arbitrary in-process JS once
      // require()d — reach the cache, so the download is refused and the
      // malformed upstream entry named. (A build already in the local
      // cache stays usable offline; it was verified at download time.)
      const expectedSha256 = build.sha256;
      if (expectedSha256 === undefined) {
        throw compilerUnavailable(
          `solc list entry for ${build.longVersion} (${build.fileName}) carries no sha256 checksum — refusing to download an unverifiable build`,
        );
      }
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
      const digest = `0x${createHash('sha256').update(downloaded).digest('hex')}`;
      if (digest !== expectedSha256.toLowerCase()) {
        throw compilerUnavailable(
          `soljson checksum mismatch for solc ${build.longVersion} — the downloaded file was discarded`,
        );
      }
      await mkdir(this.deps.cacheDir ?? SOLC_CACHE_DIR, { recursive: true });
      const tempPath = `${cachePath}.tmp`;
      await writeFile(tempPath, downloaded);
      await rename(tempPath, cachePath);
      logger.info(
        { longVersion: build.longVersion, bytes: downloaded.length },
        'soljson downloaded and cached',
      );
    }

    // The soljson file is a CommonJS Emscripten build. It is no longer
    // required on this thread: the compile runs inside a worker that
    // loads the soljson build by absolute path and drives it through the
    // inline wrapper semantics in its bootstrap (see
    // WorkerSolcRunner) — the 9 MB module evaluation and the wasm
    // instantiation happen off the main thread, under a hard timeout.
    try {
      return await (this.deps.createCompileRunner ?? defaultCreateCompileRunner)({
        solcPath: path.resolve(cachePath),
        longVersion: build.longVersion,
      });
    } catch (error) {
      if (error instanceof CompileVerifyHttpError) throw error;
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw compilerUnavailable(`Failed to initialize the solc ${build.longVersion} build: ${reason}`);
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
    const runner = await this.loadCompiler(build);

    const compileInput = buildCompileInput(validation.input);
    let output: unknown;
    try {
      // The compile runs inside the runner's worker thread — a heavy
      // multi-file input or a pathological constant-expression loop
      // can no longer stall the event loop (or outlive the timeout).
      output = JSON.parse(await runner.compile(JSON.stringify(compileInput)));
    } catch (error) {
      // A dead runner (hard compile timeout or worker crash) is dropped
      // so the next request re-creates it from the verified on-disk
      // soljson instead of reusing a terminated worker.
      if (runner.isDead()) this.compilerCache.delete(versionEntry.longVersion);
      if (error instanceof CompileVerifyHttpError) throw error;
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw compileFailed(
        `The solc ${versionEntry.longVersion} build crashed while compiling: ${reason}`,
      );
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
    // Ingest-time guard for the same rule IdeService enforces at write
    // time: these filenames flow verbatim into the IDE export directory,
    // so absolute or '..'-bearing Standard JSON keys are rejected here
    // with an honest 400 naming the file instead of failing later.
    const unsafeFilename = sourceFiles.find(
      f =>
        f.filename === '' || path.isAbsolute(f.filename) || f.filename.split(/[\\/]/).includes('..'),
    );
    if (unsafeFilename) {
      throw invalidInput(
        `Source filename must be a relative path without '..' segments: ${unsafeFilename.filename}`,
      );
    }
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
