// Verification submission route: proxies a metadata.json + sources bundle
// to Sourcify via ContractVerifyService. This is a write that posts to an
// external service, so it is admin-gated when ADMIN_TOKEN is configured
// (open in a zero-config local session, like clear-cache) and carries a
// tight limiter — one submission can mean 30s of upstream compilation.
// The /verify/manual siblings write a local-trust mark instead (no
// external hop): same gate, same limiter on the POST. The /verify/compile
// sibling recompiles locally with an official solc build and matches the
// runtime bytecode on-chain (CompileVerifyService) — same gate, same
// limiter; /verify/compilers is its open read-side version list.
import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { getValidatedAddress, getValidatedChainId } from '../server/validation';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { createRateLimiter } from '../middleware/rate-limit';
import {
  contractVerifyService,
  SourcifyUnreachableError,
  validateVerificationFiles,
} from '../services/ContractVerifyService';
import { compileVerifyService, CompileVerifyHttpError } from '../services/CompileVerifyService';
import { contractSourceService } from '../services/ContractSourceService';
import { readJsonBody, respondError } from '../utils/api-error';
import { isRecord } from '../utils/isRecord';
import { safeJsonResponse } from '../utils/serialization';

const logger = createLogger('verify-routes');

const app = new Hono();

const contractVerifyRateLimiter = createRateLimiter({
  name: 'contract-verify',
  requestsPerMinute: 3,
  burst: 1,
});

// POST /chains/:chainId/contracts/:address/verify — body
// { files: { 'metadata.json': string, [name]: string } }.
//
// Response contract:
// - 200 { verified: true, status: 'perfect'|'partial', verificationStatus? }
//   (verificationStatus is the freshly re-fetched source's status when the
//   post-verification refresh succeeded — omitted when it could not run)
// - 200 { verified: false, kind: 'unsupported_chain'|'rejected', message }
//   — Sourcify's domain answer, message verbatim
// - 400 invalid_files, 502 sourcify_unreachable — the shared respondError
//   envelope ({error, message, statusCode, timestamp}); structural bundle
//   problems / upstream unavailable. Malformed raw JSON answers the shared
//   readJsonBody 400 invalid_json instead.
app.post(
  '/chains/:chainId/contracts/:address/verify',
  requireAdminTokenIfConfigured,
  contractVerifyRateLimiter,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    const body = await readJsonBody(c);
    const validation = validateVerificationFiles(isRecord(body) ? body.files : undefined);
    if (!validation.ok) {
      return respondError(c, 400, 'invalid_files', validation.message);
    }

    let outcome;
    try {
      outcome = await contractVerifyService.submitVerification(chainId, address, validation.files);
    } catch (error) {
      if (error instanceof SourcifyUnreachableError) {
        return respondError(c, 502, 'sourcify_unreachable', error.message);
      }
      logger.error({ err: error, chainId, address }, 'Contract verification submission failed');
      return respondError(c, 500, 'verification_failed', 'Contract verification failed');
    }

    if (!outcome.ok) {
      return c.json({ verified: false, kind: outcome.kind, message: outcome.message });
    }

    // Verified: drop the cached unverified source (the same
    // contractSourceService.clearCache call the Force Refresh endpoint
    // uses) so the next read re-fetches from Sourcify instead of serving
    // the up-to-an-hour-old negative cache entry.
    await contractSourceService.clearCache(chainId, address);

    // The fresh fetch re-runs the whole source pipeline (Sourcify +
    // proxy resolution) and can take a few seconds. It is informational —
    // a failure here must not mask the successful verification, so the
    // verificationStatus field is simply omitted.
    let verificationStatus: string | undefined;
    try {
      const fresh = await contractSourceService.getContractSource(chainId, address);
      verificationStatus = fresh?.verificationStatus;
    } catch (error) {
      logger.warn(
        { err: error, chainId, address },
        'Post-verification source refresh failed; verification itself succeeded',
      );
    }

    return c.json({
      verified: true,
      status: outcome.status,
      ...(verificationStatus !== undefined ? { verificationStatus } : {}),
    });
  },
);

// POST /chains/:chainId/contracts/:address/verify/manual — local-trust
// mark for contracts the remote verifiers cannot cover (anvil/hardhat/
// private deployments). Body { abi: string, sourceCode?: string,
// name?: string }: the ABI must parse to a non-empty array. The mark is
// sticky local annotation, NOT cryptographic verification — the UI
// badge and panel copy say so, and a later Sourcify match supersedes it
// via the GET pipeline's TTL re-probe.
//
// Response contract:
// - 200 { verified: true, verificationSource: 'manual', verificationStatus?,
//        contractSource? } — contractSource is the freshly re-read source
//   (same shape as GET .../source); omitted only when the read-back failed
// - 400 missing_fields | invalid_abi (malformed raw JSON: the shared
//   readJsonBody invalid_json) — the shared respondError envelope
//   ({error, message, statusCode, timestamp})
app.post(
  '/chains/:chainId/contracts/:address/verify/manual',
  requireAdminTokenIfConfigured,
  contractVerifyRateLimiter,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    const body = await readJsonBody(c);

    const record = isRecord(body) ? body : {};
    const abi = typeof record.abi === 'string' ? record.abi : undefined;
    const sourceCode = typeof record.sourceCode === 'string' ? record.sourceCode : undefined;
    const name = typeof record.name === 'string' ? record.name : undefined;

    if (abi === undefined || abi.trim() === '') {
      return respondError(
        c,
        400,
        'missing_fields',
        'abi is required and must be a non-empty string',
      );
    }
    if (
      (record.sourceCode !== undefined && sourceCode === undefined) ||
      (record.name !== undefined && name === undefined)
    ) {
      return respondError(
        c,
        400,
        'missing_fields',
        'sourceCode and name must be strings when present',
      );
    }
    let parsedAbi: unknown;
    try {
      parsedAbi = JSON.parse(abi);
    } catch {
      parsedAbi = null;
    }
    if (!Array.isArray(parsedAbi) || parsedAbi.length === 0) {
      return respondError(
        c,
        400,
        'invalid_abi',
        'abi must be valid JSON parsing to a non-empty array',
      );
    }

    try {
      await contractSourceService.saveManualVerification(chainId, address, {
        abi,
        ...(sourceCode !== undefined ? { sourceCode } : {}),
        ...(name !== undefined ? { name } : {}),
      });
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Manual verification save failed');
      return respondError(
        c,
        500,
        'verification_failed',
        'Failed to save manual verification',
      );
    }

    // Read the mark back through the normal source pipeline so the
    // response carries exactly what the next GET will serve. Informational:
    // a read failure must not mask the successful save.
    let fresh: Awaited<ReturnType<typeof contractSourceService.getContractSource>>;
    try {
      fresh = await contractSourceService.getContractSource(chainId, address);
    } catch (error) {
      logger.warn(
        { err: error, chainId, address },
        'Post-manual-verification source read-back failed; the mark itself was saved',
      );
      fresh = null;
    }

    // safeJsonResponse round-trips the ContractSource's Date fields to
    // ISO strings (same treatment as the GET .../source route).
    return c.json(
      safeJsonResponse({
        verified: true,
        verificationSource: 'manual',
        ...(fresh ? { verificationStatus: fresh.verificationStatus, contractSource: fresh } : {}),
      }),
    );
  },
);

// DELETE /chains/:chainId/contracts/:address/verify/manual — removes the
// local-trust mark (and only it: a sourcify/blockscan row answers 404 and
// stays intact). Deleting the row clears the source cache, so the next
// GET re-probes the remote verifiers and the contract reverts to
// unverified unless they now cover it.
app.delete(
  '/chains/:chainId/contracts/:address/verify/manual',
  requireAdminTokenIfConfigured,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    let deleted: boolean;
    try {
      deleted = await contractSourceService.deleteManualVerification(chainId, address);
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Manual verification delete failed');
      return respondError(
        c,
        500,
        'verification_failed',
        'Failed to delete manual verification',
      );
    }

    if (!deleted) {
      return respondError(
        c,
        404,
        'not_found',
        'No manual verification mark exists for this contract',
      );
    }

    return c.json({ success: true, message: 'Manual verification mark removed' });
  },
);

// GET /chains/:chainId/contracts/:address/verify/compilers — the solc
// builds available for local compile verification (official wasm list,
// 24h server-cached; releases and prereleases flagged). Open read: no
// external hop happens per request and the answer is cacheable.
//
// Response contract:
// - 200 { versions: [{version, longVersion, prerelease}], degraded? }
//   (degraded names why the list came from the local soljson cache —
//   or is empty — instead of binaries.soliditylang.org)
app.get('/chains/:chainId/contracts/:address/verify/compilers', async c => {
  try {
    const list = await compileVerifyService.listCompilerVersions();
    return c.json(list);
  } catch (error) {
    logger.error({ err: error }, 'Compiler list fetch failed');
    return respondError(c, 502, 'compilers_unavailable', 'Failed to load the compiler list');
  }
});

// POST /chains/:chainId/contracts/:address/verify/compile — local
// compile-based verification: the server downloads the requested solc
// build (cached under data/solc-cache), compiles the caller's Standard
// JSON input (a Hardhat build-info file is accepted verbatim), and
// matches the recompiled runtime bytecode against the chain's own
// eth_getCode. Body { compilerVersion, standardJsonInput, contractName? }
// — contractName is required when the input compiles to more than one
// contract.
//
// Response contract:
// - 200 { verified: true, tier: 'exact'|'matches-metadata-only',
//        contractName, compilerVersion, comparison, warnings?,
//        verificationStatus?, contractSource? } — any match tier persists
//   the source (verificationSource 'local-compile') and clears the source
//   cache exactly like the Sourcify success flow; contractSource is the
//   freshly re-read source, omitted only when the read-back failed
// - 200 { verified: false, kind: 'mismatch'|'compile_error'|'no_contracts'|
//        'no_runtime_bytecode', message|errors, comparison? } — domain
//   outcomes, answered without touching stored data
// - 400 { error: 'invalid_input'|'contract_name_required'|'unknown_contract'|
//         'not_a_contract', message, candidates? }
// - 400 invalid_json (malformed raw JSON) — the shared readJsonBody envelope
// - 502 { error: 'compilers_unavailable'|'compiler_unavailable'|
//         'rpc_unavailable', message } — the network need is named
// - 500 { error: 'compile_failed', message } — the compiler build itself
//   crashed (OOM/abort)
app.post(
  '/chains/:chainId/contracts/:address/verify/compile',
  requireAdminTokenIfConfigured,
  contractVerifyRateLimiter,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    const body = await readJsonBody(c);
    const record = isRecord(body) ? body : {};

    let outcome;
    try {
      outcome = await compileVerifyService.verifyByCompilation(chainId, address, {
        compilerVersion: record.compilerVersion,
        standardJsonInput: record.standardJsonInput,
        ...(record.contractName !== undefined ? { contractName: record.contractName } : {}),
      });
    } catch (error) {
      // Deliberately NOT respondError: the typed service error carries
      // documented TOP-LEVEL extras (e.g. contract_name_required's
      // candidates array — pinned by tests) that must keep spreading
      // beside error/message, not nest inside a details field.
      if (error instanceof CompileVerifyHttpError) {
        return c.json(
          {
            error: error.code,
            message: error.message,
            ...(error.details ?? {}),
          },
          error.status,
        );
      }
      logger.error({ err: error, chainId, address }, 'Compile verification failed');
      return respondError(c, 500, 'verification_failed', 'Compile verification failed');
    }

    if (!outcome.ok) {
      return c.json({
        verified: false,
        kind: outcome.kind,
        ...('message' in outcome ? { message: outcome.message } : {}),
        ...('errors' in outcome ? { errors: outcome.errors } : {}),
        ...('comparison' in outcome ? { comparison: outcome.comparison } : {}),
      });
    }

    // Any match tier persists the source. Same sequence as the Sourcify
    // success flow: clearCache drops the stale row (and its negative
    // cache), the save re-writes it with real provenance, and the
    // read-back serves exactly what the next GET will.
    try {
      await contractSourceService.clearCache(chainId, address);
      await contractSourceService.saveLocalCompileVerification(chainId, address, outcome.saved);
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Compile verification save failed');
      return respondError(c, 500, 'verification_failed', 'Failed to save the verified source');
    }

    let fresh: Awaited<ReturnType<typeof contractSourceService.getContractSource>>;
    try {
      fresh = await contractSourceService.getContractSource(chainId, address);
    } catch (error) {
      logger.warn(
        { err: error, chainId, address },
        'Post-compile-verification source read-back failed; the verified source was saved',
      );
      fresh = null;
    }

    // safeJsonResponse round-trips the ContractSource's Date fields to
    // ISO strings (same treatment as the manual verify route).
    return c.json(
      safeJsonResponse({
        verified: true,
        tier: outcome.tier,
        contractName: outcome.contractName,
        compilerVersion: outcome.compilerVersion,
        comparison: outcome.comparison,
        warnings: outcome.warnings,
        ...(fresh ? { verificationStatus: fresh.verificationStatus, contractSource: fresh } : {}),
      }),
    );
  },
);

export default app;
