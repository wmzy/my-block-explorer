import { rpcManager } from './RpcManager';
import { createRetryableRpcCall } from '../utils/errorHandler';
import { ContractSourceService } from './ContractSourceService';
import { createLogger } from '../server/logger';
import type { Abi, Address } from 'viem';

const logger = createLogger('contract-interaction-service');

export type ContractFunction = {
  name: string;
  type: 'function';
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
  gasLimit?: bigint;
};

export type ContractCallParams = {
  chainId: number;
  contractAddress: Address;
  functionName: string;
  args: unknown[];
  value?: bigint;
  from?: string;
};

export class ContractInteractionService {
  private contractSourceService: ContractSourceService;

  constructor() {
    this.contractSourceService = new ContractSourceService();
  }

  /**
   * 解析合约 ABI，提取可调用的函数
   */
  async getContractFunctions(
    chainId: number,
    contractAddress: Address,
    customABI?: string,
  ): Promise<{
    readFunctions: ContractFunction[];
    writeFunctions: ContractFunction[];
  }> {
    try {
      let abi: Abi;

      if (customABI) {
        abi = JSON.parse(customABI);
      } else {
        const contractSource = await this.contractSourceService.getContractSource(
          chainId,
          contractAddress,
        );

        if (!contractSource?.abi) {
          return { readFunctions: [], writeFunctions: [] };
        }

        abi = JSON.parse(contractSource.abi);
      }

      const functions = abi.filter(
        (item: unknown) => (item as { type?: string }).type === 'function',
      ) as ContractFunction[];

      const readFunctions = functions.filter(
        func => func.stateMutability === 'view' || func.stateMutability === 'pure',
      );

      const writeFunctions = functions.filter(
        func => func.stateMutability === 'nonpayable' || func.stateMutability === 'payable',
      );

      return { readFunctions, writeFunctions };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get contract functions');
      return { readFunctions: [], writeFunctions: [] };
    }
  }

  /**
   * 调用只读合约函数 (readContract) - 使用提供的ABI
   */
  async readContractWithABI(
    params: ContractCallParams & { abi: string },
  ): Promise<ContractCallResult> {
    try {
      const client = await rpcManager.getClient(params.chainId);

      if (!params.abi) {
        return {
          success: false,
          error: 'Contract ABI not provided',
        };
      }

      const abi = JSON.parse(params.abi);

      const readCall = createRetryableRpcCall(async () => {
        return await client.readContract({
          address: params.contractAddress,
          abi,
          functionName: params.functionName,
          args: params.args,
        });
      }, params.chainId);

      const result = await readCall();

      return {
        success: true,
        result: this.formatContractResult(result),
      };
    } catch (error: unknown) {
      logger.error({ err: error }, 'Read contract failed');
      return {
        success: false,
        error: this.formatError(error),
      };
    }
  }

  /**
   * 调用只读合约函数 (readContract)
   */
  async readContract(params: ContractCallParams): Promise<ContractCallResult> {
    try {
      const client = await rpcManager.getClient(params.chainId);
      const contractSource = await this.contractSourceService.getContractSource(
        params.chainId,
        params.contractAddress,
      );

      if (!contractSource?.abi) {
        return {
          success: false,
          error: 'Contract ABI not available',
        };
      }

      const abi = JSON.parse(contractSource.abi);

      const readCall = createRetryableRpcCall(async () => {
        return await client.readContract({
          address: params.contractAddress,
          abi,
          functionName: params.functionName,
          args: params.args,
        });
      }, params.chainId);

      const result = await readCall();

      return {
        success: true,
        result: this.formatContractResult(result),
      };
    } catch (error: unknown) {
      logger.error({ err: error }, 'Read contract failed');
      return {
        success: false,
        error: this.formatError(error),
      };
    }
  }

  /**
   * 模拟合约调用 (simulateContract) - 使用提供的ABI
   */
  async simulateContractWithABI(
    params: ContractCallParams & { abi: string },
  ): Promise<ContractCallResult> {
    try {
      const client = await rpcManager.getClient(params.chainId);

      if (!params.abi) {
        return {
          success: false,
          error: 'Contract ABI not provided',
        };
      }

      const abi = JSON.parse(params.abi);

      const simulateCall = createRetryableRpcCall(async () => {
        return await client.simulateContract({
          address: params.contractAddress,
          abi,
          functionName: params.functionName,
          args: params.args,
          value: params.value,
          account: params.from as `0x${string}` | undefined,
        });
      }, params.chainId);

      const simulation = await simulateCall();

      return {
        success: true,
        result: this.formatContractResult(simulation.result),
        gasUsed: simulation.request.gas,
      };
    } catch (error: unknown) {
      logger.error({ err: error }, 'Simulate contract failed');
      return {
        success: false,
        error: this.formatError(error),
      };
    }
  }

  /**
   * 模拟合约调用 (simulateContract)
   */
  async simulateContract(params: ContractCallParams): Promise<ContractCallResult> {
    try {
      const client = await rpcManager.getClient(params.chainId);
      const contractSource = await this.contractSourceService.getContractSource(
        params.chainId,
        params.contractAddress,
      );

      if (!contractSource?.abi) {
        return {
          success: false,
          error: 'Contract ABI not available',
        };
      }

      const abi = JSON.parse(contractSource.abi);

      const simulateCall = createRetryableRpcCall(async () => {
        return await client.simulateContract({
          address: params.contractAddress,
          abi,
          functionName: params.functionName,
          args: params.args,
          value: params.value,
          account: params.from as `0x${string}` | undefined,
        });
      }, params.chainId);

      const simulation = await simulateCall();

      return {
        success: true,
        result: this.formatContractResult(simulation.result),
        gasUsed: simulation.request.gas,
      };
    } catch (error: unknown) {
      logger.error({ err: error }, 'Simulate contract failed');
      return {
        success: false,
        error: this.formatError(error),
      };
    }
  }

  /**
   * 估算合约调用的 Gas 费用 - 使用提供的ABI
   */
  async estimateContractGasWithABI(params: ContractCallParams & { abi: string }): Promise<{
    gasLimit: bigint;
    gasPrice?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  } | null> {
    try {
      const client = await rpcManager.getClient(params.chainId);

      if (!params.abi) {
        return null;
      }

      const abi = JSON.parse(params.abi);

      const estimateGas = createRetryableRpcCall(async () => {
        return await client.estimateContractGas({
          address: params.contractAddress,
          abi,
          functionName: params.functionName,
          args: params.args,
          value: params.value,
          account: params.from as `0x${string}` | undefined,
        });
      }, params.chainId);

      const gasLimit = await estimateGas();

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
      logger.error({ err: error }, 'Gas estimation failed');
      return null;
    }
  }

  /**
   * 估算合约调用的 Gas 费用
   */
  async estimateContractGas(params: ContractCallParams): Promise<{
    gasLimit: bigint;
    gasPrice?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  } | null> {
    try {
      const client = await rpcManager.getClient(params.chainId);
      const contractSource = await this.contractSourceService.getContractSource(
        params.chainId,
        params.contractAddress,
      );

      if (!contractSource?.abi) {
        return null;
      }

      const abi = JSON.parse(contractSource.abi);

      const estimateGas = createRetryableRpcCall(async () => {
        return await client.estimateContractGas({
          address: params.contractAddress,
          abi,
          functionName: params.functionName,
          args: params.args,
          value: params.value,
          account: params.from as `0x${string}` | undefined,
        });
      }, params.chainId);

      const gasLimit = await estimateGas();

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
      logger.error({ err: error }, 'Gas estimation failed');
      return null;
    }
  }

  /**
   * 获取函数签名的输入参数类型
   */
  getFunctionInputTypes(contractFunction: ContractFunction): string[] {
    return contractFunction.inputs.map(input => input.type);
  }

  /**
   * 验证函数参数
   */
  validateFunctionArgs(
    contractFunction: ContractFunction,
    args: unknown[],
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (args.length !== contractFunction.inputs.length) {
      errors.push(`Expected ${contractFunction.inputs.length} arguments, got ${args.length}`);
    }

    contractFunction.inputs.forEach((input, index) => {
      const arg = args[index];
      const validation = this.validateArgument(input.type, arg, input.name);
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
  private validateArgument(
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
        const _num = BigInt(value as string | number | bigint | boolean);
        // 可以添加更多的范围检查
      }

      // 字节类型验证
      if (type.startsWith('bytes')) {
        if (typeof value !== 'string' || !value.startsWith('0x')) {
          return { valid: false, error: 'Invalid bytes format, should start with 0x' };
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

  /**
   * 格式化合约调用结果
   */
  private formatContractResult(result: unknown): unknown {
    if (typeof result === 'bigint') {
      return result.toString();
    }

    if (Array.isArray(result)) {
      return result.map(item => this.formatContractResult(item));
    }

    if (typeof result === 'object' && result !== null) {
      const formatted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(result)) {
        formatted[key] = this.formatContractResult(value);
      }
      return formatted;
    }

    return result;
  }

  /**
   * 格式化错误信息
   */
  private formatError(error: unknown): string {
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
}

// 导出单例实例
export const contractInteractionService = new ContractInteractionService();
