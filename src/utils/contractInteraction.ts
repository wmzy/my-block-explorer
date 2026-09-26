import { getRpcClient, withRetry } from './rpcClient';
import { get } from '@/util/http';
import type { Abi, AbiParameter, Address, StateOverride } from 'viem';

export type ContractFunction = {
  name: string;
  type: string;
  inputs: ContractFunctionInput[];
  outputs: ContractFunctionOutput[];
  stateMutability: 'pure' | 'view' | 'nonpayable' | 'payable';
};

export type ContractFunctionInput = {
  name: string;
  type: string;
  internalType?: string;
  // Struct components of tuple inputs ('tuple', 'tuple[]'): preserved from
  // the ABI so the Interact form can validate tuple arguments recursively.
  components?: AbiParameter[];
};

export type ContractFunctionOutput = {
  name: string;
  type: string;
  internalType?: string;
};

export type ContractCallResult = {
  success: boolean;
  result?: unknown;
  error?: string;
  gasUsed?: bigint;
};

export type ContractCallParams = {
  chainId: number;
  contractAddress: string;
  functionName: string;
  args: unknown[];
  value?: bigint;
  from?: string;
  blockNumber?: bigint;
};

/**
 * Parse a contract ABI and extract callable functions
 */
export function parseContractFunctions(abi: string): {
  readFunctions: ContractFunction[];
  writeFunctions: ContractFunction[];
} {
  try {
    const parsedAbi = JSON.parse(abi) as Abi;
    const functions = parsedAbi.filter(
      (item): item is ContractFunction & { type: 'function' } => item.type === 'function',
    );

    const readFunctions = functions.filter(
      func => func.stateMutability === 'view' || func.stateMutability === 'pure',
    );

    const writeFunctions = functions.filter(
      func => func.stateMutability === 'nonpayable' || func.stateMutability === 'payable',
    );

    return { readFunctions, writeFunctions };
  } catch (error) {
    console.error('Failed to parse contract ABI:', error);
    return { readFunctions: [], writeFunctions: [] };
  }
}

/**
 * Call a read-only contract function
 */
export async function readContract(
  params: ContractCallParams & { abi?: string },
): Promise<ContractCallResult> {
  try {
    const client = getRpcClient(params.chainId);

    let abi: Abi;

    if (params.abi) {
      // Use the provided ABI directly
      abi = JSON.parse(params.abi) as Abi;
    } else {
      // Fetch the contract ABI from the API
      const contractSource = await fetchContractSource(params.chainId, params.contractAddress);
      if (!contractSource?.abi) {
        return {
          success: false,
          error: 'Contract ABI not available',
        };
      }
      abi = JSON.parse(contractSource.abi) as Abi;
    }

    const result = await withRetry(async () => {
      return await client.readContract({
        address: params.contractAddress as Address,
        abi,
        functionName: params.functionName,
        args: params.args,
        blockNumber: params.blockNumber,
      });
    });

    return {
      success: true,
      result: formatContractResult(result),
    };
  } catch (error: unknown) {
    console.error('Read contract failed:', error);
    return {
      success: false,
      error: formatError(error),
    };
  }
}

/**
 * Simulate a contract call
 */
export async function simulateContract(
  params: ContractCallParams & { abi?: string; stateOverride?: StateOverride },
): Promise<ContractCallResult> {
  try {
    const client = getRpcClient(params.chainId);

    let abi: Abi;

    if (params.abi) {
      // Use the provided ABI directly
      abi = JSON.parse(params.abi) as Abi;
    } else {
      // Fetch the contract ABI from the API
      const contractSource = await fetchContractSource(params.chainId, params.contractAddress);
      if (!contractSource?.abi) {
        return {
          success: false,
          error: 'Contract ABI not available',
        };
      }
      abi = JSON.parse(contractSource.abi) as Abi;
    }

    const simulation = await withRetry(async () => {
      return await client.simulateContract({
        address: params.contractAddress as Address,
        abi,
        functionName: params.functionName,
        args: params.args,
        value: params.value,
        account: params.from as Address | undefined,
        // Absent → the key is not spread at all: viem's serializer drops
        // undefined overrides, keeping the eth_call request byte-identical
        // to the pre-override wire format.
        ...(params.stateOverride !== undefined ? { stateOverride: params.stateOverride } : {}),
      });
    });

    return {
      success: true,
      result: formatContractResult(simulation.result),
      gasUsed: simulation.request.gas,
    };
  } catch (error: unknown) {
    console.error('Simulate contract failed:', error);
    return {
      success: false,
      error: formatError(error),
    };
  }
}

/**
 * Estimate gas for a contract call
 */
export async function estimateContractGas(params: ContractCallParams): Promise<{
  gasLimit: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
} | null> {
  try {
    const client = getRpcClient(params.chainId);

    // Fetch the contract ABI
    const contractSource = await fetchContractSource(params.chainId, params.contractAddress);
    if (!contractSource?.abi) {
      return null;
    }

    const abi = JSON.parse(contractSource.abi) as Abi;

    const gasLimit = await withRetry(async () => {
      return await client.estimateContractGas({
        address: params.contractAddress as Address,
        abi,
        functionName: params.functionName,
        args: params.args,
        value: params.value,
        account: params.from as Address | undefined,
      });
    });

    // Get the current gas price
    const [gasPrice, feeData] = await Promise.all([
      client.getGasPrice().catch(() => null),
      client.estimateFeesPerGas().catch(() => null),
    ]);

    return {
      gasLimit,
      gasPrice: gasPrice ?? undefined,
      maxFeePerGas: feeData?.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: feeData?.maxPriorityFeePerGas ?? undefined,
    };
  } catch (error) {
    console.error('Gas estimation failed:', error);
    return null;
  }
}

/**
 * Fetch contract source (from the backend API)
 */
async function fetchContractSource(
  chainId: number,
  contractAddress: string,
): Promise<{
  abi: string;
  isProxy?: boolean;
  implementationContract?: { abi: string };
} | null> {
  try {
    const data = await get<{
      contractSource?: {
        abi: string;
        isProxy?: boolean;
        implementationContract?: { abi: string };
      };
    }>(`/api/chains/${chainId}/contracts/${contractAddress}/source`);

    return data.contractSource ?? null;
  } catch (error) {
    console.error('Failed to fetch contract source:', error);
    return null;
  }
}

/**
 * Format a contract call result
 */
function formatContractResult(result: unknown): unknown {
  if (typeof result === 'bigint') {
    return result.toString();
  }

  if (Array.isArray(result)) {
    return result.map(item => formatContractResult(item));
  }

  if (typeof result === 'object' && result !== null) {
    const formatted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result)) {
      formatted[key] = formatContractResult(value);
    }
    return formatted;
  }

  return result;
}

/**
 * Format an error message
 */
function formatError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    if ('shortMessage' in error && typeof error.shortMessage === 'string') {
      return error.shortMessage;
    }
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error occurred';
}

/**
 * Validate function arguments
 */
export function validateFunctionArgs(
  contractFunction: ContractFunction,
  args: unknown[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (args.length !== contractFunction.inputs.length) {
    errors.push(`Expected ${contractFunction.inputs.length} arguments, got ${args.length}`);
  }

  contractFunction.inputs.forEach((input, index) => {
    const arg = args[index];
    const validation = validateArgument(input.type, arg, input.name);
    if (!validation.valid) {
      errors.push(`Argument ${index} (${input.name}): ${validation.error}`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single argument
 */
function validateArgument(
  type: string,
  value: unknown,
  _name: string,
): { valid: boolean; error?: string } {
  if (value === undefined || value === null || value === '') {
    return { valid: false, error: 'Value is required' };
  }

  try {
    // Address type validation
    if (type === 'address') {
      if (typeof value !== 'string' || !value.match(/^0x[a-fA-F0-9]{40}$/)) {
        return { valid: false, error: 'Invalid address format' };
      }
    }

    // Numeric type validation
    if (type.startsWith('uint') || type.startsWith('int')) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        const _num = BigInt(value);
        // More range checks could be added
      }
    }

    // Bytes type validation
    if (type.startsWith('bytes')) {
      if (typeof value !== 'string' || !value.startsWith('0x')) {
        return {
          valid: false,
          error: 'Invalid bytes format, should start with 0x',
        };
      }
    }

    // Boolean type validation
    if (type === 'bool') {
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        return { valid: false, error: 'Invalid boolean value' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: `Invalid ${type} value` };
  }
}

// Source tag for proxy contracts: 'proxy' = admin functions on proxy, 'impl' = implementation contract
export type FunctionSource = 'proxy' | 'impl';

// Enhanced function type with source and interaction type tags
export type EnhancedContractFunction = ContractFunction & {
  interactionType: 'read' | 'write';
  source: FunctionSource;
};

// Filter types for function filtering
export type ReadWriteFilter = 'all' | 'read' | 'write';
export type SourceFilter = 'all' | 'proxy' | 'impl';

export type FilterState = {
  readWrite: ReadWriteFilter;
  source: SourceFilter;
  name: string;
};

// Canonical name(inputs) signature: disambiguates same-name overloads for
// dedupe and per-call result keys. `inputs` is optional because raw
// JSON.parse'd ABI entries may omit the key (the parser loop guards the
// same way).
export function functionSignature(func: {
  name: string;
  inputs?: readonly { type: string; name?: string }[];
}): string {
  return `${func.name}(${(func.inputs ?? []).map(i => i.type).join(',')})`;
}

/**
 * Parse both proxy and implementation ABIs, tagging functions by source
 * For non-proxy contracts, all functions are tagged as 'impl'
 */
export function parseContractFunctionsUnified(
  proxyABI: string | undefined,
  implABI: string | undefined,
): EnhancedContractFunction[] {
  const functions: EnhancedContractFunction[] = [];

  // Parse implementation ABI (or proxy ABI if no impl)
  const targetABI = implABI ?? proxyABI;
  if (targetABI) {
    try {
      const parsed = JSON.parse(targetABI) as Abi;
      const funcs = parsed.filter(
        (item): item is ContractFunction & { type: 'function' } => item.type === 'function',
      );

      for (const func of funcs) {
        const isRead = func.stateMutability === 'view' || func.stateMutability === 'pure';
        functions.push({
          name: func.name,
          type: func.type,
          inputs: (func.inputs ?? []).map(input => ({
            name: input.name ?? '',
            type: input.type,
            internalType: input.internalType,
            components: input.components,
          })),
          outputs: (func.outputs ?? []).map(output => ({
            name: output.name ?? '',
            type: output.type,
            internalType: output.internalType,
          })),
          stateMutability: func.stateMutability ?? 'nonpayable',
          interactionType: isRead ? 'read' : 'write',
          source: implABI ? 'impl' : 'impl',
        });
      }
    } catch (error) {
      console.error('Failed to parse ABI:', error);
    }
  }

  // Signatures already provided by the implementation ABI: the proxy loop
  // dedupes on the full signature, not the bare name — a same-name overload
  // with different parameters is a distinct entry, only an exact signature
  // match is a duplicate.
  const implSignatures = new Set(functions.map(functionSignature));

  // If this is a proxy contract AND we have a separate proxy ABI, also add proxy functions
  // Note: Most proxy admin functions are NOT in the proxy ABI, but some custom proxies may have them
  if (proxyABI && implABI && proxyABI !== implABI) {
    try {
      const parsed = JSON.parse(proxyABI) as Abi;
      const funcs = parsed.filter(
        (item): item is ContractFunction & { type: 'function' } => item.type === 'function',
      );

      for (const func of funcs) {
        // Skip signatures that exist in impl (avoid duplicates)
        if (implSignatures.has(functionSignature(func))) continue;

        const isRead = func.stateMutability === 'view' || func.stateMutability === 'pure';
        functions.push({
          name: func.name,
          type: func.type,
          inputs: (func.inputs ?? []).map(input => ({
            name: input.name ?? '',
            type: input.type,
            internalType: input.internalType,
            components: input.components,
          })),
          outputs: (func.outputs ?? []).map(output => ({
            name: output.name ?? '',
            type: output.type,
            internalType: output.internalType,
          })),
          stateMutability: func.stateMutability ?? 'nonpayable',
          interactionType: isRead ? 'read' : 'write',
          source: 'proxy',
        });
      }
    } catch (error) {
      console.error('Failed to parse proxy ABI:', error);
    }
  }

  return functions;
}

/**
 * Filter functions by read/write, source (proxy/impl), and name
 */
export function filterFunctions(
  functions: EnhancedContractFunction[],
  filters: FilterState,
): EnhancedContractFunction[] {
  return functions.filter(func => {
    // Filter by read/write
    if (filters.readWrite !== 'all' && func.interactionType !== filters.readWrite) {
      return false;
    }

    // Filter by source (only for proxy contracts)
    if (filters.source !== 'all' && func.source !== filters.source) {
      return false;
    }

    // Filter by name (case-insensitive substring)
    if (filters.name) {
      const nameLower = func.name.toLowerCase();
      const searchLower = filters.name.toLowerCase();
      if (!nameLower.includes(searchLower)) {
        return false;
      }
    }

    return true;
  });
}
