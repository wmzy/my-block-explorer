import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { contractSourceService } from '../services/ContractSourceService';

const logger = createLogger('contracts-routes');
import { contractInteractionService } from '../services/ContractInteractionService';
import { getChainName } from '../config/chains';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import { parseStrictInteger } from '../utils/validation';
import { safeJsonResponse } from '../utils/serialization';
import { createApiError, respondError } from '../utils/api-error';
import { parseStateOverride, type StateOverride } from '../utils/stateOverride';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { createRateLimiter } from '../middleware/rate-limit';
import {
  detectInstalledIdes,
  getDetectedIdesInfo,
  openInIde,
  type IdeId,
} from '../services/IdeService';
import {
  CONTRACT_DIRECTORY_DEFAULT_LIMIT,
  CONTRACT_DIRECTORY_MAX_LIMIT,
  CONTRACT_DIRECTORY_MAX_OFFSET,
  listCachedContracts,
} from '../services/SearchService';

const app = new Hono();

// --- Cached-contract directory (GET /chains/:chainId/contracts) ---
//
// Pagination follows the transactions list conventions (see
// routes/transactions.ts): a missing/empty param keeps its default, junk
// fails loudly with 400 instead of silently paging from 0, a negative
// offset clamps to 0 and a runaway offset clamps at the scan cap. One
// deliberate deviation: an over-cap limit 400s instead of clamping — the
// directory page always asks for its fixed page size, so anything above
// the cap is a client bug worth surfacing, not silently shrinking.
const parseContractsLimitParam = (raw: string | undefined): number | null => {
  if (raw === undefined || raw === '') return CONTRACT_DIRECTORY_DEFAULT_LIMIT;
  // Strict decimal parse: parseInt() accepted a valid prefix and ignored
  // the rest, so `?limit=20abc` was served as limit 20 — the "silently
  // paging" failure the comment above rules out.
  const parsed = parseStrictInteger(raw);
  if (parsed === null || parsed < 1) return null;
  if (parsed > CONTRACT_DIRECTORY_MAX_LIMIT) return null;
  return parsed;
};

const parseContractsOffsetParam = (raw: string | undefined): number | null => {
  if (raw === undefined || raw === '') return 0;
  // Strict decimal parse: parseInt() accepted a valid prefix and ignored
  // the rest, so `?offset=5abc` was served as offset 5. A genuinely
  // negative offset still clamps to 0 (documented policy).
  const parsed = raw.startsWith('-') ? Number(raw) : parseStrictInteger(raw);
  if (parsed === null || !Number.isSafeInteger(parsed)) return null;
  return Math.min(Math.max(parsed, 0), CONTRACT_DIRECTORY_MAX_OFFSET);
};

// Parses the optional eth_call-style stateOverride body field shared by
// the simulate and estimate-gas endpoints (foundry parity). Absent →
// undefined; present but invalid → the 400 body; an empty map {} is
// accepted and treated exactly like absent so the RPC request stays
// byte-identical to the pre-override behavior.
const parseBodyStateOverride = (
  raw: unknown,
):
  | { error: ReturnType<typeof createApiError>; status: 400 }
  | { value: StateOverride | undefined } => {
  if (raw === undefined) return { value: undefined };
  const parsed = parseStateOverride(raw);
  if (!parsed.ok) {
    return {
      error: createApiError(
        400,
        'invalid_state_override',
        'stateOverride must map addresses to valid override objects',
        parsed.details,
      ),
      status: 400,
    };
  }
  const hasEntries = Object.keys(parsed.value).length > 0;
  return { value: hasEntries ? parsed.value : undefined };
};

// Parses the optional wei `value` body field shared by the simulate and
// estimate-gas endpoints. Falsy keeps the legacy undefined passthrough
// (no value attached); valid quantities (0x-hex or decimal integer,
// string or integer number) convert to bigint exactly like the previous
// inline BigInt() call; junk like '1.5' or 'abc' used to throw inside
// the generic try and surface as an opaque 500 — now a 400 invalid_value.
const parseBodyValue = (raw: unknown): { ok: true; value?: bigint } | { ok: false } => {
  if (!raw) return { ok: true };
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? { ok: true, value: BigInt(raw) } : { ok: false };
  }
  if (typeof raw === 'string' && /^-?(0x[0-9a-fA-F]+|\d+)$/.test(raw)) {
    return { ok: true, value: BigInt(raw) };
  }
  return { ok: false };
};

// Every contract_sources row this explorer has cached for the chain —
// populated by opening (or force-refreshing) a contract page, never by
// this endpoint. Read-only and open; X-Data-Source says 'database'
// because this is the local cache, not an on-chain fact.
app.get('/chains/:chainId/contracts', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));

  const limit = parseContractsLimitParam(c.req.query('limit'));
  if (limit === null) {
    return respondError(
      c,
      400,
      'invalid_limit',
      `limit must be a positive integer no greater than ${CONTRACT_DIRECTORY_MAX_LIMIT}`,
    );
  }

  const offset = parseContractsOffsetParam(c.req.query('offset'));
  if (offset === null) {
    return respondError(c, 400, 'invalid_offset', 'offset must be a non-negative integer');
  }

  try {
    const page = await listCachedContracts({
      chainId,
      q: c.req.query('q'),
      limit,
      offset,
    });

    c.header('X-Data-Source', 'database');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      contracts: page.contracts,
      total: page.total,
      q: page.q,
      offset: page.offset,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Contract directory API error');
    return respondError(c, 500, 'internal_error', 'Failed to list cached contracts');
  }
});

app.get('/chains/:chainId/contracts/stats', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));

  try {
    const stats = await contractSourceService.getContractStats(chainId);

    c.header('X-Data-Source', 'database');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      stats,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Contract stats API error');
    return respondError(c, 500, 'internal_error', 'Failed to get contract stats');
  }
});

app.get('/chains/:chainId/contracts/:address/source', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const contractSource = await contractSourceService.getContractSource(chainId, address);

    if (!contractSource) {
      // null means the address has no deployed code (C-1: the frontend
      // detects err.code === 'not_a_contract' to show an EOA state).
      // The extra `code` key is the discriminator util/http.ts's toApiError
      // reads (it only maps body.code, not body.error, onto ApiError.code)
      // — kept until that parser learns the canonical `error` field.
      return c.json(
        {
          ...createApiError(
            404,
            'not_a_contract',
            `Address ${address} is not a contract on chain ${chainId}`,
          ),
          code: 'not_a_contract',
        },
        404,
      );
    }

    c.header('X-Data-Source', 'contract-verification');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      contractSource,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Contract source API error');
    return respondError(c, 500, 'internal_error', 'Failed to get contract source');
  }
});

// Opt-in admin gate: clearing the source cache is non-destructive (the
// immutable data is simply re-fetched on the next read), so a zero-config
// self-hosted session keeps Force Refresh working. With ADMIN_TOKEN set,
// the x-admin-token header is enforced as usual.
app.post(
  '/chains/:chainId/contracts/:address/clear-cache',
  requireAdminTokenIfConfigured,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      await contractSourceService.clearCache(chainId, address);

      return c.json({ success: true, message: 'Cache cleared' });
    } catch (error) {
      logger.error({ err: error }, 'Clear contract cache API error');
      return respondError(c, 500, 'internal_error', 'Failed to clear contract cache');
    }
  },
);

app.get('/chains/:chainId/contracts/:address/abi', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const [contractSource, contractFunctions] = await Promise.all([
      contractSourceService.getContractSource(chainId, address),
      contractSourceService.getContractFunctions(chainId, address),
    ]);

    if (!contractSource) {
      // Same C-1 contract as the source endpoint: null === no deployed code.
      // The extra `code` key feeds util/http.ts's body.code-only mapper (see
      // the source route above).
      return c.json(
        {
          ...createApiError(
            404,
            'not_a_contract',
            `Address ${address} is not a contract on chain ${chainId}`,
          ),
          code: 'not_a_contract',
        },
        404,
      );
    }

    c.header('X-Data-Source', 'contract-verification');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      abi: contractSource.abi,
      functions: contractFunctions.functions,
      events: contractFunctions.events,
      errors: contractFunctions.errors,
      verificationStatus: contractSource.verificationStatus,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Contract ABI API error');
    return respondError(c, 500, 'internal_error', 'Failed to get contract ABI');
  }
});

app.get('/chains/:chainId/contracts/:address/functions', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const contractSource = await contractSourceService.getContractSource(chainId, address);

    let targetABI = contractSource?.abi;

    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetABI = contractSource.implementationContract.abi;
    }

    const { readFunctions, writeFunctions } = await contractInteractionService.getContractFunctions(
      chainId,
      address,
      targetABI,
    );

    c.header('X-Chain-Name', getChainName(chainId));
    c.header('Cache-Control', 'public, max-age=300');

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      readFunctions,
      writeFunctions,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Contract functions API error');
    return respondError(c, 500, 'internal_error', 'Failed to get contract functions');
  }
});

// Contract read/simulate proxy public RPC calls per request; each endpoint
// gets its own generous bucket (independent quotas) so read polling cannot
// starve simulate submissions and vice versa.
const contractReadRateLimiter = createRateLimiter({
  name: 'contracts-read',
  requestsPerMinute: 60,
  burst: 20,
});
app.post('/chains/:chainId/contracts/:address/read', contractReadRateLimiter, async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  // A malformed JSON body must not reach the generic catch below, where it
  // would surface as an opaque 500 'Failed to read contract'.
  let body;
  try {
    body = await c.req.json();
  } catch {
    return respondError(c, 400, 'invalid_json', 'Request body must be valid JSON');
  }

  try {
    const { functionName, args = [] } = body;

    if (!functionName || typeof functionName !== 'string') {
      return respondError(c, 400, 'invalid_function_name', 'Function name is required');
    }

    if (!Array.isArray(args)) {
      return respondError(c, 400, 'invalid_args', 'Arguments must be an array');
    }

    const contractSource = await contractSourceService.getContractSource(chainId, address);

    let targetABI = contractSource?.abi;

    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetABI = contractSource.implementationContract.abi;
    }

    if (!targetABI) {
      return respondError(c, 400, 'abi_unavailable', 'Contract ABI not available');
    }

    const result = await contractInteractionService.readContractWithABI({
      chainId,
      contractAddress: address,
      functionName,
      args,
      abi: targetABI,
    });

    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address,
      functionName,
      args,
      result: result.result,
      success: result.success,
      error: result.error,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData, result.success ? 200 : 400);
  } catch (error) {
    logger.error({ err: error }, 'Read contract API error');
    return respondError(c, 500, 'internal_error', 'Failed to read contract');
  }
});

const contractSimulateRateLimiter = createRateLimiter({
  name: 'contracts-simulate',
  requestsPerMinute: 60,
  burst: 20,
});
app.post('/chains/:chainId/contracts/:address/simulate', contractSimulateRateLimiter, async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  // A malformed JSON body must not reach the generic catch below, where it
  // would surface as an opaque 500 'Failed to simulate contract'.
  let body;
  try {
    body = await c.req.json();
  } catch {
    return respondError(c, 400, 'invalid_json', 'Request body must be valid JSON');
  }

  try {
    const { functionName, args = [], value, from, stateOverride: stateOverrideRaw } = body;

    if (!functionName || typeof functionName !== 'string') {
      return respondError(c, 400, 'invalid_function_name', 'Function name is required');
    }

    if (!Array.isArray(args)) {
      return respondError(c, 400, 'invalid_args', 'Arguments must be an array');
    }

    const parsedValue = parseBodyValue(value);
    if (!parsedValue.ok) {
      return respondError(
        c,
        400,
        'invalid_value',
        'value must be a 0x-hex or decimal integer quantity',
      );
    }

    const override = parseBodyStateOverride(stateOverrideRaw);
    if ('error' in override) {
      return c.json(override.error, override.status);
    }

    const contractSource = await contractSourceService.getContractSource(chainId, address);

    let targetABI = contractSource?.abi;

    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetABI = contractSource.implementationContract.abi;
    }

    if (!targetABI) {
      return respondError(c, 400, 'abi_unavailable', 'Contract ABI not available');
    }

    const result = await contractInteractionService.simulateContractWithABI({
      chainId,
      contractAddress: address,
      functionName,
      args,
      value: parsedValue.value,
      from,
      abi: targetABI,
      stateOverride: override.value,
    });

    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address,
      functionName,
      args,
      value,
      from,
      result: result.result,
      success: result.success,
      error: result.error,
      gasUsed: result.gasUsed?.toString(),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData, result.success ? 200 : 400);
  } catch (error) {
    logger.error({ err: error }, 'Simulate contract API error');
    return respondError(c, 500, 'internal_error', 'Failed to simulate contract');
  }
});

// estimate-gas drives the same per-request RPC proxying as simulate, so
// it gets the same dedicated bucket (independent quota — estimating
// cannot starve simulate and vice versa); named for the ops dashboard's
// per-bucket stats.
const contractEstimateGasRateLimiter = createRateLimiter({
  name: 'contract-estimate-gas',
  requestsPerMinute: 60,
  burst: 20,
});
app.post(
  '/chains/:chainId/contracts/:address/estimate-gas',
  contractEstimateGasRateLimiter,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    // Same contract as simulate: a malformed JSON body is a 400 invalid_json,
    // not an opaque 500 'Failed to estimate gas'.
    let body;
    try {
      body = await c.req.json();
    } catch {
      return respondError(c, 400, 'invalid_json', 'Request body must be valid JSON');
    }

    try {
      const { functionName, args = [], value, from, stateOverride: stateOverrideRaw } = body;

      if (!functionName || typeof functionName !== 'string') {
        return respondError(c, 400, 'invalid_function_name', 'Function name is required');
      }

      if (!Array.isArray(args)) {
        return respondError(c, 400, 'invalid_args', 'Arguments must be an array');
      }

      const parsedValue = parseBodyValue(value);
      if (!parsedValue.ok) {
        return respondError(
          c,
          400,
          'invalid_value',
          'value must be a 0x-hex or decimal integer quantity',
        );
      }

      const override = parseBodyStateOverride(stateOverrideRaw);
      if ('error' in override) {
        return c.json(override.error, override.status);
      }

      const contractSource = await contractSourceService.getContractSource(chainId, address);

      let targetABI = contractSource?.abi;

      if (contractSource?.isProxy && contractSource?.implementationContract) {
        targetABI = contractSource.implementationContract.abi;
      }

      if (!targetABI) {
        return respondError(c, 400, 'abi_unavailable', 'Contract ABI not available');
      }

      const gasEstimate = await contractInteractionService.estimateContractGasWithABI({
        chainId,
        contractAddress: address,
        functionName,
        args,
        value: parsedValue.value,
        from,
        abi: targetABI,
        stateOverride: override.value,
      });

      c.header('X-Chain-Name', getChainName(chainId));

      if (!gasEstimate) {
        return respondError(c, 400, 'gas_estimation_failed', 'Failed to estimate gas');
      }

      const responseData = safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        functionName,
        args,
        value,
        from,
        gasLimit: gasEstimate.gasLimit.toString(),
        gasPrice: gasEstimate.gasPrice?.toString(),
        maxFeePerGas: gasEstimate.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas?.toString(),
        timestamp: new Date().toISOString(),
      });

      return c.json(responseData);
    } catch (error) {
      logger.error({ err: error }, 'Gas estimation API error');
      return respondError(c, 500, 'internal_error', 'Failed to estimate gas');
    }
  },
);

app.get('/chains/:chainId/contracts/:address/creation', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const creationInfo = await contractSourceService.getContractCreationInfo(chainId, address);

    c.header('X-Data-Source', 'rpc');
    c.header('X-Chain-Name', getChainName(chainId));

    if (!creationInfo) {
      return c.json({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        found: false,
        message: 'Contract creation information not found',
        timestamp: new Date().toISOString(),
      });
    }

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address,
      found: true,
      creation: {
        txHash: creationInfo.txHash,
        blockNumber: creationInfo.blockNumber,
        creator: creationInfo.creator,
        timestamp: creationInfo.timestamp,
        gasUsed: creationInfo.gasUsed.toString(),
        gasPrice: creationInfo.gasPrice.toString(),
      },
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Contract creation info API error');
    return respondError(c, 500, 'internal_error', 'Failed to get contract creation info');
  }
});

app.get('/chains/:chainId/contracts/:address/ides', async c => {
  const ides = getDetectedIdesInfo();

  return c.json({
    ides,
    timestamp: new Date().toISOString(),
  });
});

// Writes contract sources to disk and spawns a local IDE process, so this
// is strictly admin-gated when ADMIN_TOKEN is configured (the frontend http
// layer injects the x-admin-token header automatically).
app.post(
  '/chains/:chainId/contracts/:address/open-in-ide',
  requireAdminTokenIfConfigured,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    // A malformed JSON body must not reach the generic catch below, where it
    // would surface as an opaque 500.
    let body;
    try {
      body = await c.req.json();
    } catch {
      return respondError(c, 400, 'invalid_json', 'Request body must be valid JSON');
    }

    try {
      const ide = body.ide as IdeId;

      const validIdes: IdeId[] = ['vscode', 'cursor', 'zed', 'webstorm', 'sublime'];
      if (!ide || !validIdes.includes(ide)) {
        return respondError(
          c,
          400,
          'invalid_ide',
          'Unsupported IDE. Must be one of: vscode, cursor, zed, webstorm, sublime',
        );
      }

      const installedIdes = detectInstalledIdes();
      if (!installedIdes.includes(ide)) {
        return respondError(c, 400, 'ide_not_installed', `${ide} is not installed or not in PATH`);
      }

      const contractSource = await contractSourceService.getContractSource(chainId, address);
      if (!contractSource) {
        return respondError(
          c,
          404,
          'contract_not_found',
          'Contract not found or not a contract address',
        );
      }

      const targetSource = contractSource.implementationContract ?? contractSource;
      const contractName = targetSource.name ?? `contract-${address.slice(0, 8)}`;

      const result = await openInIde(
        ide,
        contractName,
        address,
        chainId,
        targetSource.sourceCode,
        targetSource.sourceFiles,
        targetSource.compilerVersion,
        targetSource.optimizationEnabled,
        targetSource.optimizationRuns,
      );

      return c.json({
        success: true,
        directory: result.directory,
        ide,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, 'Open in IDE API error');
      return respondError(c, 500, 'internal_error', 'Failed to open contract in IDE');
    }
  },
);

export default app;
