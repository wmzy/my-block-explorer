// Contract verification submission: forwards the user's metadata.json +
// source files to the Sourcify server through the backend (the browser
// cannot cross-origin POST sourcify.dev, and the fixed server URL must
// never come from the caller).
//
// Wire protocol: Sourcify APIv2's metadata verification — POST
// {server}/v2/verify/metadata/{chainId}/{address} answers a verificationId
// ticket, then GET {server}/v2/verify/{id} is polled until the job
// completes. The legacy synchronous /verify-files endpoint this feature
// was originally specced against was removed from the production server
// (it answers 404 today), so the v2 ticketing flow is what actually
// works against https://sourcify.dev/server; SOURCIFY_SERVER_URL can point
// at any v2-compatible self-host.
//
// Outcome mapping (honesty contract):
// - job result match 'exact_match'          -> { ok: true, status: 'perfect' }
// - job result match 'match'                -> { ok: true, status: 'partial' }
// - unsupported chain (customCode
//   'unsupported_chain', or v1-style 'unknown-chain' / "chain not
//   supported" texts)                       -> { ok: false, kind: 'unsupported_chain', message }
// - any other sourcify refusal (validation,
//   compilation, no_match, rate limit, already
//   verified...) — sourcify's own words     -> { ok: false, kind: 'rejected', message }
// - network failure, HTTP 5xx, or the 30s
//   deadline                               -> throws SourcifyUnreachableError
//   (the route maps that to 502 sourcify_unreachable; everything above is
//   a domain outcome answered with HTTP 200).
import { createLogger } from '../server/logger';
import type { Address } from 'viem';

const logger = createLogger('contract-verify-service');

const DEFAULT_SOURCIFY_SERVER_URL = 'https://sourcify.dev/server';
// One budget for the whole submit + poll cycle: the AbortSignal aborts the
// POST, every poll fetch, and the sleeps in between.
export const VERIFY_TIMEOUT_MS = 30_000;
const POLL_INITIAL_DELAY_MS = 750;
const POLL_DELAY_GROWTH = 1.5;
const POLL_MAX_DELAY_MS = 3_000;

// Bundle caps, mirrored client-side by the verify panel: they bound one
// upstream submission (and its JSON body) regardless of caller.
export const MAX_VERIFY_FILES = 50;
export const MAX_VERIFY_TOTAL_BYTES = 2 * 1024 * 1024;
export const METADATA_FILE_NAME = 'metadata.json';

// Typed upstream failure: sourcify was not successfully consulted (network
// error, server error, timeout). The route maps this to 502
// sourcify_unreachable; the message says which of the three happened.
export class SourcifyUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourcifyUnreachableError';
  }
}

export type SourcifyVerifyOutcome =
  | { ok: true; status: 'perfect' | 'partial' }
  | { ok: false; kind: 'unsupported_chain'; message: string }
  | { ok: false; kind: 'rejected'; message: string };

// Validation result for a caller-supplied file bundle. ok carries the
// narrowed Record so the route can hand it straight to submitVerification
// without re-asserting the shape.
export type VerificationFilesValidation =
  | { ok: true; files: Record<string, string> }
  | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Structural validation of the file bundle: an object of file name ->
// content strings, with metadata.json present, at most MAX_VERIFY_FILES
// entries and MAX_VERIFY_TOTAL_BYTES of content. Shared by the route (400
// invalid_files) and the service (defense in depth for other callers).
export function validateVerificationFiles(
  files: unknown,
): VerificationFilesValidation {
  if (!isRecord(files) || Array.isArray(files)) {
    return { ok: false, message: 'files must be an object mapping file names to their string contents' };
  }
  if (Object.keys(files).length === 0) {
    return { ok: false, message: 'files must not be empty' };
  }
  if (!(METADATA_FILE_NAME in files)) {
    return { ok: false, message: `${METADATA_FILE_NAME} is required` };
  }
  let totalBytes = 0;
  for (const [name, content] of Object.entries(files)) {
    if (typeof content !== 'string') {
      return { ok: false, message: `file "${name}" must be a string` };
    }
    totalBytes += Buffer.byteLength(content, 'utf8');
  }
  if (Object.keys(files).length > MAX_VERIFY_FILES) {
    return {
      ok: false,
      message: `Too many files (${Object.keys(files).length}); the limit is ${MAX_VERIFY_FILES}`,
    };
  }
  if (totalBytes > MAX_VERIFY_TOTAL_BYTES) {
    return {
      ok: false,
      message: `Files total ${(totalBytes / 1024 / 1024).toFixed(2)} MB; the limit is 2 MB (${MAX_VERIFY_TOTAL_BYTES} bytes)`,
    };
  }
  return { ok: true, files: files as Record<string, string> };
}

// Abort-aware sleep: resolves after `ms`, or rejects as soon as the signal
// fires so a shared deadline bounds a polling loop's idle gaps too.
const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

// DOMException (what AbortSignal.timeout rejects with) is not an
// instanceof Error in Node, so both fields are read defensively.
const errorField = (error: unknown, field: 'name' | 'message'): string => {
  if (typeof error === 'object' && error !== null && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
  }
  return '';
};

export class ContractVerifyService {
  /**
   * Submit a metadata.json + sources bundle to Sourcify and wait for the
   * verification job's outcome. Domain outcomes resolve; only upstream
   * infrastructure failures throw (SourcifyUnreachableError).
   */
  async submitVerification(
    chainId: number,
    address: Address,
    files: Record<string, string>,
  ): Promise<SourcifyVerifyOutcome> {
    const bundle = validateVerificationFiles(files);
    if (!bundle.ok) return { ok: false, kind: 'rejected', message: bundle.message };

    // The v2 endpoint takes the metadata as a parsed object and the
    // remaining files as a path -> content mapping.
    let metadata: unknown;
    try {
      metadata = JSON.parse(files[METADATA_FILE_NAME]);
    } catch (error) {
      return {
        ok: false,
        kind: 'rejected',
        message: `${METADATA_FILE_NAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const sources: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      if (name !== METADATA_FILE_NAME) sources[name] = content;
    }

    const signal = AbortSignal.timeout(VERIFY_TIMEOUT_MS);
    const submitUrl = `${this.serverBaseUrl()}/v2/verify/metadata/${chainId}/${address}`;
    try {
      const response = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ sources, metadata }),
        signal,
      });
      if (!response.ok) return await this.mapErrorResponse(response);

      const payload: unknown = await response.json();
      const verificationId =
        isRecord(payload) && typeof payload.verificationId === 'string'
          ? payload.verificationId
          : null;
      if (!verificationId) {
        throw new SourcifyUnreachableError(
          'Sourcify accepted the submission but answered without a verificationId',
        );
      }
      logger.info({ chainId, address, verificationId }, 'Sourcify verification job submitted');
      return await this.awaitJobResult(verificationId, signal);
    } catch (error) {
      throw this.toUnreachable(error, 'submitting the verification');
    }
  }

  // Poll the job until it completes. The shared 30s signal bounds the
  // loop: an in-flight fetch or a sleep rejects once it fires, so a
  // never-completing job surfaces as SourcifyUnreachableError instead of
  // a hang.
  private async awaitJobResult(
    verificationId: string,
    signal: AbortSignal,
  ): Promise<SourcifyVerifyOutcome> {
    const statusUrl = `${this.serverBaseUrl()}/v2/verify/${verificationId}`;
    let delay = POLL_INITIAL_DELAY_MS;
    for (;;) {
      await sleep(delay, signal);
      delay = Math.min(Math.round(delay * POLL_DELAY_GROWTH), POLL_MAX_DELAY_MS);

      const response = await fetch(statusUrl, {
        headers: { accept: 'application/json' },
        signal,
      });
      if (!response.ok) return await this.mapErrorResponse(response);

      const job: unknown = await response.json();
      if (!isRecord(job) || job.isJobCompleted !== true) continue;

      const jobError = isRecord(job.error) ? job.error : null;
      if (jobError) {
        const code = typeof jobError.customCode === 'string' ? jobError.customCode : '';
        const message =
          typeof jobError.message === 'string' && jobError.message.trim() !== ''
            ? jobError.message
            : 'Sourcify reported a verification error';
        if (this.isUnsupportedChain(code, message)) {
          return { ok: false, kind: 'unsupported_chain', message };
        }
        return { ok: false, kind: 'rejected', message };
      }

      // APIv2's match enum: 'exact_match' is a full (creation + runtime)
      // match — v1 called that "perfect"; 'match' alone is runtime-only,
      // v1's "partial".
      const contract = isRecord(job.contract) ? job.contract : null;
      const match = contract !== null && typeof contract.match === 'string' ? contract.match : '';
      if (match === 'exact_match') return { ok: true, status: 'perfect' };
      if (match === 'match') return { ok: true, status: 'partial' };
      return {
        ok: false,
        kind: 'rejected',
        message: 'Sourcify finished the verification without reporting a match',
      };
    }
  }

  // Maps a non-OK sourcify response to a domain outcome. 4xx bodies are
  // {customCode, message} — the message is sourcify's own wording and is
  // passed through verbatim. 5xx means sourcify is unhealthy: typed error.
  private async mapErrorResponse(response: Response): Promise<SourcifyVerifyOutcome> {
    if (response.status >= 500) {
      throw new SourcifyUnreachableError(`Sourcify server error (HTTP ${response.status})`);
    }
    const body: unknown = await response.json().catch(() => null);
    const code = isRecord(body) && typeof body.customCode === 'string' ? body.customCode : '';
    const message =
      isRecord(body) && typeof body.message === 'string' && body.message.trim() !== ''
        ? body.message
        : `Sourcify rejected the request (HTTP ${response.status})`;
    if (this.isUnsupportedChain(code, message)) {
      return { ok: false, kind: 'unsupported_chain', message };
    }
    return { ok: false, kind: 'rejected', message };
  }

  // Chain-support detection across sourcify's vocabularies: APIv2's
  // 'unsupported_chain' customCode, the v1-era 'unknown-chain' result, and
  // plain-English "chain ... not supported" texts from self-hosts.
  private isUnsupportedChain(code: string, message: string): boolean {
    const haystack = `${code} ${message}`.toLowerCase();
    if (haystack.includes('unknown-chain')) return true;
    if (haystack.includes('unsupported') && haystack.includes('chain')) return true;
    return haystack.includes('chain') && haystack.includes('not supported');
  }

  private toUnreachable(error: unknown, phase: string): SourcifyUnreachableError {
    if (error instanceof SourcifyUnreachableError) return error;
    const name = errorField(error, 'name');
    const message = errorField(error, 'message');
    const aborted =
      name === 'TimeoutError' || name === 'AbortError' || /abort|timed out/i.test(message);
    if (aborted) {
      return new SourcifyUnreachableError(
        `Sourcify did not finish within ${VERIFY_TIMEOUT_MS / 1000}s while ${phase} — the job may still complete there; retry, or Force Refresh later`,
      );
    }
    const detail = message !== '' ? message : String(error);
    return new SourcifyUnreachableError(`Could not reach the Sourcify server while ${phase}: ${detail}`);
  }

  // Fixed upstream host: the base URL comes from the environment only,
  // never from request data (no proxying of caller-supplied URLs).
  private serverBaseUrl(): string {
    const raw = process.env.SOURCIFY_SERVER_URL?.trim();
    if (!raw) return DEFAULT_SOURCIFY_SERVER_URL;
    return raw.replace(/\/+$/, '');
  }
}

export const contractVerifyService = new ContractVerifyService();
