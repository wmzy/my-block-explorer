import { getRpcClient, withRetry } from './rpcClient';
import type { Abi, Address } from 'viem';

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
 * 解析合约 ABI，提取可调用的函数
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
 * 调用只读合约函数
 */
export async function readContract(
  params: ContractCallParams & { abi?: string },
): Promise<ContractCallResult> {
  try {
    const client = getRpcClient(params.chainId);

    let abi: Abi;

    if (params.abi) {
      // 直接使用提供的 ABI
      abi = JSON.parse(params.abi) as Abi;
    } else {
      // 从 API 获取合约 ABI
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
 * 模拟合约调用
 */
export async function simulateContract(
  params: ContractCallParams & { abi?: string },
): Promise<ContractCallResult> {
  try {
    const client = getRpcClient(params.chainId);

    let abi: Abi;

    if (params.abi) {
      // 直接使用提供的 ABI
      abi = JSON.parse(params.abi) as Abi;
    } else {
      // 从 API 获取合约 ABI
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
 * 估算合约调用的 Gas 费用
 */
export async function estimateContractGas(params: ContractCallParams): Promise<{
  gasLimit: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
} | null> {
  try {
    const client = getRpcClient(params.chainId);

    // 获取合约 ABI
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

    // 获取当前 gas 价格
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
 * 获取合约源码（从后端API获取）
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
    const response = await fetch(`/api/chains/${chainId}/contracts/${contractAddress}/source`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.contractSource;
  } catch (error) {
    console.error('Failed to fetch contract source:', error);
    return null;
  }
}

/**
 * 格式化合约调用结果
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
 * 格式化错误信息
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
 * 验证函数参数
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
 * 验证单个参数
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
    // 地址类型验证
    if (type === 'address') {
      if (typeof value !== 'string' || !value.match(/^0x[a-fA-F0-9]{40}$/)) {
        return { valid: false, error: 'Invalid address format' };
      }
    }

    // 数字类型验证
    if (type.startsWith('uint') || type.startsWith('int')) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        const _num = BigInt(value);
        // 可以添加更多的范围检查
      }
    }

    // 字节类型验证
    if (type.startsWith('bytes')) {
      if (typeof value !== 'string' || !value.startsWith('0x')) {
        return {
          valid: false,
          error: 'Invalid bytes format, should start with 0x',
        };
      }
    }

    // 布尔类型验证
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
