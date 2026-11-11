import { rpcManager } from './RpcManager';
import { createRetryableRpcCall } from '../utils/errorHandler';
import { ContractSourceService } from './ContractSourceService';
import { createLogger } from '../server/logger';
import type {
  Abi,
  Address,
  StateMapping as ViemStateMapping,
  StateOverride as ViemStateOverride,
} from 'viem';
import type { StateOverride } from '../utils/stateOverride';

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

// Converts one parsed state/stateDiff map into viem's {slot, value}[]
// mapping form.
const toViemStateMapping = (map: Record<`0x${string}`, `0x${string}`>): ViemStateMapping =>
  Object.entries(map).map(([slot, slotValue]) => ({
    slot: slot as `0x${string}`,
    value: slotValue,
  }));

// Converts the parsed hex-string wire form (src/utils/stateOverride.ts)
// into the array-of-overrides shape viem's simulateContract /
// estimateContractGas accept. Numeric coercion lives here and only here:
// balance becomes bigint, nonce a number. Returns undefined untouched so
// requests without an override are byte-identical to before.
//
// The cast is needed because viem types StateOverride as a OneOf union on
// state/stateDiff that cannot express "both keys present, one undefined";
// a request genuinely carrying both is forwarded verbatim so the node's
// own conflict error surfaces instead of us silently dropping half of it.
const toViemStateOverride = (
  override: StateOverride | undefined,
): ViemStateOverride | undefined => {
  if (!override) return undefined;
  return Object.entries(override).map(([address, entry]) => ({
    address: address as Address,
    balance: entry.balance !== undefined ? BigInt(entry.balance) : undefined,
    nonce: entry.nonce !== undefined ? Number(BigInt(entry.nonce)) : undefined,
    code: entry.code,
    state: entry.state !== undefined ? toViemStateMapping(entry.state) : undefined,
    stateDiff: entry.stateDiff !== undefined ? toViemStateMapping(entry.stateDiff) : undefined,
  })) as ViemStateOverride;
};

export class ContractInteractionService {
  private contractSourceService: ContractSourceService;

  constructor() {
    this.contractSourceService = new ContractSourceService();
  }

  /**
   * Parse a contract ABI and extract callable functions
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
      // An empty list is the honest answer for a contract whose ABI has no
      // functions (or for an EOA, which has no ABI at all). A failed
      // source read or unparseable ABI is not: rethrow, so the route
      // answers 500 instead of "this contract has no callable functions".
      logger.error({ err: error }, 'Failed to get contract functions');
      throw error;
    }
  }

  /**
   * Call a read-only contract function (readContract) - with a provided ABI
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
   * Simulate a contract call (simulateContract) - with a provided ABI
   */
  async simulateContractWithABI(
    params: ContractCallParams & { abi: string; stateOverride?: StateOverride },
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
      const stateOverride = toViemStateOverride(params.stateOverride);

      const simulateCall = createRetryableRpcCall(async () => {
        return await client.simulateContract({
          address: params.contractAddress,
          abi,
          functionName: params.functionName,
          args: params.args,
          value: params.value,
          account: params.from as `0x${string}` | undefined,
          stateOverride,
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
   * Estimate gas for a contract call - with a provided ABI
   */
  async estimateContractGasWithABI(
    params: ContractCallParams & { abi: string; stateOverride?: StateOverride },
  ): Promise<{
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
      const stateOverride = toViemStateOverride(params.stateOverride);

      const estimateGas = createRetryableRpcCall(async () => {
        return await client.estimateContractGas({
          address: params.contractAddress,
          abi,
          functionName: params.functionName,
          args: params.args,
          value: params.value,
          account: params.from as `0x${string}` | undefined,
          stateOverride,
        });
      }, params.chainId);

      const gasLimit = await estimateGas();

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
      logger.error({ err: error }, 'Gas estimation failed');
      return null;
    }
  }

  /**
   * Format a contract call result
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
   * Format an error message
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

// Export a singleton instance
export const contractInteractionService = new ContractInteractionService();
