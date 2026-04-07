import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { contractSourceService } from '../services/ContractSourceService';

const logger = createLogger('contracts-routes');
import { contractInteractionService } from '../services/ContractInteractionService';
import { getChainName, isChainSupported } from '../config/chains';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import { safeJsonResponse } from '../utils/serialization';
import {
  detectInstalledIdes,
  getDetectedIdesInfo,
  openInIde,
  type IdeId,
} from '../services/IdeService';

const app = new Hono();

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
    return c.json({ error: 'Failed to get contract stats' }, 500);
  }
});

app.get('/chains/:chainId/contracts/:address/source', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const contractSource = await contractSourceService.getContractSource(chainId, address);

    if (!contractSource) {
      return c.json({ error: 'Contract not found or not a contract address' }, 404);
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
    return c.json({ error: 'Failed to get contract source' }, 500);
  }
});

app.post('/chains/:chainId/contracts/:address/clear-cache', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    await contractSourceService.clearCache(chainId, address);

    return c.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    logger.error({ err: error }, 'Clear contract cache API error');
    return c.json({ error: 'Failed to clear contract cache' }, 500);
  }
});

app.get('/chains/:chainId/contracts/:address/abi', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const [contractSource, contractFunctions] = await Promise.all([
      contractSourceService.getContractSource(chainId, address),
      contractSourceService.getContractFunctions(chainId, address),
    ]);

    if (!contractSource) {
      return c.json({ error: 'Contract not found or not a contract address' }, 404);
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
    return c.json({ error: 'Failed to get contract ABI' }, 500);
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
    c.header('X-Cache-Control', 'public, max-age=300');

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
    return c.json({ error: 'Failed to get contract functions' }, 500);
  }
});

app.post('/chains/:chainId/contracts/:address/read', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: 'Unsupported chain' }, 400);
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: 'Invalid contract address' }, 400);
  }

  try {
    const body = await c.req.json();
    const { functionName, args = [] } = body;

    if (!functionName || typeof functionName !== 'string') {
      return c.json({ error: 'Function name is required' }, 400);
    }

    if (!Array.isArray(args)) {
      return c.json({ error: 'Arguments must be an array' }, 400);
    }

    const contractSource = await contractSourceService.getContractSource(chainId, address);

    let targetABI = contractSource?.abi;

    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetABI = contractSource.implementationContract.abi;
    }

    if (!targetABI) {
      return c.json({ error: 'Contract ABI not available' }, 400);
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
    return c.json({ error: 'Failed to read contract' }, 500);
  }
});

app.post('/chains/:chainId/contracts/:address/simulate', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: 'Unsupported chain' }, 400);
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: 'Invalid contract address' }, 400);
  }

  try {
    const body = await c.req.json();
    const { functionName, args = [], value, from } = body;

    if (!functionName || typeof functionName !== 'string') {
      return c.json({ error: 'Function name is required' }, 400);
    }

    if (!Array.isArray(args)) {
      return c.json({ error: 'Arguments must be an array' }, 400);
    }

    const contractSource = await contractSourceService.getContractSource(chainId, address);

    let targetABI = contractSource?.abi;

    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetABI = contractSource.implementationContract.abi;
    }

    if (!targetABI) {
      return c.json({ error: 'Contract ABI not available' }, 400);
    }

    const result = await contractInteractionService.simulateContractWithABI({
      chainId,
      contractAddress: address,
      functionName,
      args,
      value: value ? BigInt(value) : undefined,
      from,
      abi: targetABI,
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
    return c.json({ error: 'Failed to simulate contract' }, 500);
  }
});

app.post('/chains/:chainId/contracts/:address/estimate-gas', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: 'Unsupported chain' }, 400);
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: 'Invalid contract address' }, 400);
  }

  try {
    const body = await c.req.json();
    const { functionName, args = [], value, from } = body;

    if (!functionName || typeof functionName !== 'string') {
      return c.json({ error: 'Function name is required' }, 400);
    }

    if (!Array.isArray(args)) {
      return c.json({ error: 'Arguments must be an array' }, 400);
    }

    const contractSource = await contractSourceService.getContractSource(chainId, address);

    let targetABI = contractSource?.abi;

    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetABI = contractSource.implementationContract.abi;
    }

    if (!targetABI) {
      return c.json({ error: 'Contract ABI not available' }, 400);
    }

    const gasEstimate = await contractInteractionService.estimateContractGasWithABI({
      chainId,
      contractAddress: address,
      functionName,
      args,
      value: value ? BigInt(value) : undefined,
      from,
      abi: targetABI,
    });

    c.header('X-Chain-Name', getChainName(chainId));

    if (!gasEstimate) {
      return c.json({ error: 'Failed to estimate gas' }, 400);
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
    return c.json({ error: 'Failed to estimate gas' }, 500);
  }
});

app.get('/chains/:chainId/contracts/:address/creation', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: 'Unsupported chain' }, 400);
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: 'Invalid contract address' }, 400);
  }

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
    return c.json({ error: 'Failed to get contract creation info' }, 500);
  }
});

app.get('/chains/:chainId/contracts/:address/ides', async c => {
  const ides = getDetectedIdesInfo();

  return c.json({
    ides,
    timestamp: new Date().toISOString(),
  });
});

app.post('/chains/:chainId/contracts/:address/open-in-ide', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const body = await c.req.json();
    const ide = body.ide as IdeId;

    const validIdes: IdeId[] = ['vscode', 'cursor', 'zed', 'webstorm', 'sublime'];
    if (!ide || !validIdes.includes(ide)) {
      return c.json(
        { error: 'Unsupported IDE. Must be one of: vscode, cursor, zed, webstorm, sublime' },
        400,
      );
    }

    const installedIdes = detectInstalledIdes();
    if (!installedIdes.includes(ide)) {
      return c.json({ error: `${ide} is not installed or not in PATH` }, 400);
    }

    const contractSource = await contractSourceService.getContractSource(chainId, address);
    if (!contractSource) {
      return c.json({ error: 'Contract not found or not a contract address' }, 404);
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
    return c.json({ error: 'Failed to open contract in IDE' }, 500);
  }
});

export default app;
