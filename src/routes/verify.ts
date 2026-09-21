// Verification submission route: proxies a metadata.json + sources bundle
// to Sourcify via ContractVerifyService. This is a write that posts to an
// external service, so it is admin-gated when ADMIN_TOKEN is configured
// (open in a zero-config local session, like clear-cache) and carries a
// tight limiter — one submission can mean 30s of upstream compilation.
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

const logger = createLogger('verify-routes');

const isRecordLike = (value: unknown): value is { files?: unknown } =>
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

export default app;
