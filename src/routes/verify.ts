// Verification submission route: proxies a metadata.json + sources bundle
// to Sourcify via ContractVerifyService. This is a write that posts to an
// external service, so it is admin-gated when ADMIN_TOKEN is configured
// (open in a zero-config local session, like clear-cache) and carries a
// tight limiter — one submission can mean 30s of upstream compilation.
// The /verify/manual siblings write a local-trust mark instead (no
// external hop): same gate, same limiter on the POST.
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
import { contractSourceService } from '../services/ContractSourceService';
import { safeJsonResponse } from '../utils/serialization';

const logger = createLogger('verify-routes');

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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
// - 400 { error: 'invalid_files', message } — structural bundle problems
// - 502 { error: 'sourcify_unreachable', message } — upstream unavailable
app.post(
  '/chains/:chainId/contracts/:address/verify',
  requireAdminTokenIfConfigured,
  contractVerifyRateLimiter,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const validation = validateVerificationFiles(
      isRecordLike(body) ? body.files : undefined,
    );
    if (!validation.ok) {
      return c.json({ error: 'invalid_files', message: validation.message }, 400);
    }

    let outcome;
    try {
      outcome = await contractVerifyService.submitVerification(chainId, address, validation.files);
    } catch (error) {
      if (error instanceof SourcifyUnreachableError) {
        return c.json({ error: 'sourcify_unreachable', message: error.message }, 502);
      }
      logger.error({ err: error, chainId, address }, 'Contract verification submission failed');
      return c.json(
        { error: 'verification_failed', message: 'Contract verification failed' },
        500,
      );
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
// - 400 { error: 'missing_fields' | 'invalid_abi', message }
app.post(
  '/chains/:chainId/contracts/:address/verify/manual',
  requireAdminTokenIfConfigured,
  contractVerifyRateLimiter,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }

    const record = isRecordLike(body) ? body : {};
    const abi = typeof record.abi === 'string' ? record.abi : undefined;
    const sourceCode = typeof record.sourceCode === 'string' ? record.sourceCode : undefined;
    const name = typeof record.name === 'string' ? record.name : undefined;

    if (abi === undefined || abi.trim() === '') {
      return c.json(
        { error: 'missing_fields', message: 'abi is required and must be a non-empty string' },
        400,
      );
    }
    if (
      (record.sourceCode !== undefined && sourceCode === undefined) ||
      (record.name !== undefined && name === undefined)
    ) {
      return c.json(
        { error: 'missing_fields', message: 'sourceCode and name must be strings when present' },
        400,
      );
    }
    let parsedAbi: unknown;
    try {
      parsedAbi = JSON.parse(abi);
    } catch {
      parsedAbi = null;
    }
    if (!Array.isArray(parsedAbi) || parsedAbi.length === 0) {
      return c.json(
        { error: 'invalid_abi', message: 'abi must be valid JSON parsing to a non-empty array' },
        400,
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
      return c.json(
        { error: 'verification_failed', message: 'Failed to save manual verification' },
        500,
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
        ...(fresh
          ? { verificationStatus: fresh.verificationStatus, contractSource: fresh }
          : {}),
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
      return c.json(
        { error: 'verification_failed', message: 'Failed to delete manual verification' },
        500,
      );
    }

    if (!deleted) {
      return c.json(
        {
          error: 'not_found',
          message: 'No manual verification mark exists for this contract',
        },
        404,
      );
    }

    return c.json({ success: true, message: 'Manual verification mark removed' });
  },
);

export default app;
