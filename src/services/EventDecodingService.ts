/**
 * ABI事件解码服务
 * 负责解码以太坊事件日志并提供类型安全的解码结果
 */

import { decodeEventLog, Log, Abi, toHex, keccak256, AbiEvent } from 'viem';
import {
  DecodedEvent,
  EventDecodingError,
  DecodedEventData,
  EventDataTransformer,
  EventDataValidator,
  ValidationResult,
  EventParameter,
} from '../types/events';

/**
 * 事件解码配置
 */
interface DecodingConfig {
  enableStrictValidation: boolean;
  sanitizeValues: boolean;
  preserveRawData: boolean;
  maxRecursionDepth: number;
}

/**
 * 默认解码配置
 */
const DEFAULT_DECODING_CONFIG: DecodingConfig = {
  enableStrictValidation: true,
  sanitizeValues: true,
  preserveRawData: true,
  maxRecursionDepth: 10,
};

/**
 * 事件解码服务类
 */
export class EventDecodingService {
  private config: DecodingConfig;
  private transformers: Map<string, EventDataTransformer>;
  private validators: Map<string, EventDataValidator>;

  constructor(config: Partial<DecodingConfig> = {}) {
    this.config = { ...DEFAULT_DECODING_CONFIG, ...config };
    this.transformers = new Map();
    this.validators = new Map();
    this.initializeDefaultHandlers();
  }

  /**
   * 解码单个事件日志
   */
  async decodeLog(
    log: Log,
    abiEvent: EventParameter[],
    chainId: number,
    blockTimestamp?: number,
  ): Promise<DecodedEvent> {
    try {
      // 构建Viem兼容的ABI事件定义
      const abiEventDef = this.buildAbiEventDefinition(abiEvent);
      const abi: Abi = [abiEventDef];

      // 使用Viem解码事件
      const decodedLog = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });

      if (!decodedLog) {
        throw new EventDecodingError(
          'Event decoding returned null',
          log.blockHash ?? undefined,
          log.logIndex ?? undefined,
          chainId,
        );
      }

      // 格式化解码后的参数
      const formattedArgs = await this.formatDecodedArgs(
        decodedLog.args as unknown as DecodedEventData,
        abiEvent,
      );

      // 构建完整的事件对象
      const decodedEvent: DecodedEvent = {
        chainId,
        contractAddress: log.address,
        eventName: decodedLog.eventName ?? 'Unknown',
        eventSignature: this.getEventSignature(abiEvent),

        // 交易信息
        txHash: log.transactionHash ?? '0x',
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        transactionIndex: log.transactionIndex!,
        logIndex: log.logIndex!,

        // 时间信息
        blockTimestamp: blockTimestamp ?? 0,

        // 解码数据
        args: formattedArgs,
        rawTopics: log.topics,
        rawData: log.data,

        // 处理信息
        indexedAt: new Date(),
        processingErrors: [],
      };

      return decodedEvent;
    } catch (error) {
      const eventError = error instanceof Error ? error : new Error(String(error));
      throw new EventDecodingError(
        `Failed to decode event: ${eventError.message}`,
        log.blockHash ?? undefined,
        log.logIndex ?? undefined,
        chainId,
        eventError,
      );
    }
  }

  /**
   * 批量解码事件日志
   */
  async decodeLogs(
    logs: Log[],
    abiEvents: Map<string, EventParameter[]>,
    chainId: number,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<DecodedEvent[]> {
    const results: DecodedEvent[] = [];
    const errors: EventDecodingError[] = [];

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      try {
        // 根据主题0找到对应的ABI事件定义
        const eventSignature = log.topics[0];
        const abiEvent = eventSignature ? abiEvents.get(eventSignature) : undefined;

        if (!abiEvent) {
          errors.push(
            new EventDecodingError(
              `No ABI found for event signature: ${eventSignature ?? 'unknown'}`,
              log.blockHash ?? undefined,
              log.logIndex ?? undefined,
              chainId,
            ),
          );
          continue;
        }

        const decodedEvent = await this.decodeLog(log, abiEvent, chainId);
        results.push(decodedEvent);
      } catch (error) {
        const eventError =
          error instanceof EventDecodingError ? error : new EventDecodingError(String(error));
        errors.push(eventError);
      }

      // 调用进度回调
      onProgress?.(i + 1, logs.length);
    }

    // 如果有错误，可以记录到日志或监控系统
    if (errors.length > 0) {
      console.warn(`Decoded ${results.length} events with ${errors.length} errors`);
      errors.forEach(error => console.error(error.message, error.cause));
    }

    return results;
  }

  /**
   * 获取事件签名
   */
  getEventSignature(eventParams: EventParameter[]): `0x${string}` {
    const signature = `${eventParams[0]?.name || 'Unknown'}(${eventParams
      .map(p => p.type)
      .join(',')})`;
    return keccak256(toHex(signature));
  }

  /**
   * 从合约源码中提取ABI定义
   * @param sourceCode 合约的Solidity源码
   * @returns 提取的ABI数组
   */
  extractAbiFromSource(sourceCode: string): Abi | null {
    try {
      // 查找pragma声明后的interface或contract定义
      const abiMatch = sourceCode.match(/(interface|contract)\s+\w+\s*{[\s\S]*?(?=\})/g);

      if (!abiMatch) {
        throw new EventDecodingError('No ABI found in source code', undefined, undefined, 0);
      }

      // 提取ABI项（event、function等）
      const abiItems: AbiEvent[] = [];

      // 匹配event定义
      const eventMatches =
        sourceCode.match(/event\s+\w+\([^)]+\)\s*(?:indexed\s*\w+[^;]*;|;)/g) ?? [];
      for (const eventDef of eventMatches) {
        try {
          const abiItem = this.parseEventAbi(eventDef);
          if (abiItem) {
            abiItems.push(abiItem);
          }
        } catch (error) {
          console.warn('Failed to parse event ABI:', eventDef, error);
        }
      }

      return abiItems.length > 0 ? abiItems : null;
    } catch (error) {
      throw new EventDecodingError(
        `Failed to extract ABI from source: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        undefined,
        0,
      );
    }
  }

  /**
   * 解析单个事件的ABI定义
   * @param eventDefStr 事件定义字符串
   * @returns 解析后的事件ABI对象
   */
  parseEventAbi(eventDefStr: string): AbiEvent | null {
    try {
      // 解析事件名称
      const nameMatch = eventDefStr.match(/event\s+(\w+)/);
      if (!nameMatch) {
        return null;
      }
      const eventName = nameMatch[1];

      // 解析参数列表
      const paramsMatch = eventDefStr.match(/\(([^)]+)\)/);
      if (!paramsMatch) {
        return null;
      }

      const paramsStr = paramsMatch[1];
      const inputs: Array<{
        name: string;
        type: string;
        indexed?: boolean;
        internalType?: string;
      }> = [];

      // 分割参数并解析
      if (paramsStr.trim()) {
        const params = paramsStr.split(',').map(p => p.trim());
        for (const param of params) {
          const parts = param.split(/\s+/);
          if (parts.length >= 2) {
            const type = parts[0];
            const name = parts[1].replace(/[,;]/g, '');
            const indexed = param.includes('indexed');

            inputs.push({
              name,
              type,
              indexed,
              internalType: type,
            });
          }
        }
      }

      return {
        type: 'event',
        name: eventName,
        inputs,
      };
    } catch (error) {
      console.error('Error parsing event ABI:', error);
      return null;
    }
  }

  /**
   * 注册自定义数据转换器
   */
  registerTransformer(abiType: string, transformer: EventDataTransformer): void {
    this.transformers.set(abiType, transformer);
  }

  /**
   * 注册自定义数据验证器
   */
  registerValidator(abiType: string, validator: EventDataValidator): void {
    this.validators.set(abiType, validator);
  }

  /**
   * 构建Viem兼容的ABI事件定义
   */
  private buildAbiEventDefinition(eventParams: EventParameter[]): AbiEvent {
    return {
      type: 'event',
      name: eventParams[0]?.name || 'Unknown',
      inputs: eventParams.map(param => ({
        name: param.name,
        type: param.type,
        indexed: param.indexed,
        internalType: param.internalType,
      })),
    };
  }

  /**
   * 格式化解码后的参数
   */
  private async formatDecodedArgs(
    args: DecodedEventData,
    eventParams: EventParameter[],
  ): Promise<DecodedEventData> {
    const formatted: DecodedEventData = {};

    for (let i = 0; i < eventParams.length; i++) {
      const param = eventParams[i];
      const value = args[i];

      try {
        // 验证数据
        const validation = this.validateParameter(param, value);
        if (!validation.valid) {
          throw new Error(`Validation failed for parameter ${param.name}: ${validation.error}`);
        }

        // 转换数据
        const transformedValue = this.transformParameter(param, validation.sanitizedValue ?? value);
        formatted[param.name] = transformedValue;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to format parameter ${param.name}: ${errorMessage}`);
        formatted[param.name] = value; // 使用原始值作为后备
      }
    }

    return formatted;
  }

  /**
   * 验证参数值
   */
  private validateParameter(param: EventParameter, value: unknown): ValidationResult {
    // 如果有自定义验证器，使用它
    const customValidator = this.validators.get(param.type);
    if (customValidator) {
      return customValidator.validate(param, value);
    }

    // 默认验证逻辑
    if (value === null || value === undefined) {
      // 允许null/undefined，除非是必需的indexed参数
      if (param.indexed) {
        return { valid: false, error: 'Indexed parameters cannot be null or undefined' };
      }
      return { valid: true, sanitizedValue: null };
    }

    // 根据类型进行验证
    return this.validateByType(param.type, value);
  }

  /**
   * 根据类型验证值
   */
  private validateByType(type: string, value: unknown): ValidationResult {
    // 地址类型验证
    if (type === 'address') {
      if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
        return { valid: false, error: 'Invalid address format' };
      }
      return { valid: true };
    }

    // 数字类型验证
    if (type.match(/^(u?)int\d+$/)) {
      try {
        const num = BigInt(value as string | number | bigint | boolean);
        return { valid: true, sanitizedValue: num };
      } catch {
        return { valid: false, error: 'Invalid number format' };
      }
    }

    // 布尔类型验证
    if (type === 'bool') {
      if (typeof value === 'boolean') {
        return { valid: true };
      }
      if (value === 'true' || value === '1' || value === 1) {
        return { valid: true, sanitizedValue: true };
      }
      if (value === 'false' || value === '0' || value === 0) {
        return { valid: true, sanitizedValue: false };
      }
      return { valid: false, error: 'Invalid boolean value' };
    }

    // 字节类型验证
    if (type.match(/^bytes\d*$/)) {
      if (typeof value !== 'string' || !/^0x[a-fA-F0-9]*$/.test(value)) {
        return { valid: false, error: 'Invalid bytes format' };
      }
      return { valid: true };
    }

    // 字符串类型验证
    if (type === 'string') {
      if (typeof value !== 'string') {
        return { valid: false, error: 'Invalid string value' };
      }
      return { valid: true };
    }

    // 数组类型验证
    if (type.includes('[]')) {
      if (!Array.isArray(value)) {
        return { valid: false, error: 'Invalid array value' };
      }
      return { valid: true, sanitizedValue: value };
    }

    // 结构体类型验证
    if (type === 'tuple') {
      if (typeof value !== 'object' || value === null) {
        return { valid: false, error: 'Invalid tuple value' };
      }
      return { valid: true };
    }

    // 未知类型，默认通过
    return { valid: true };
  }

  /**
   * 转换参数值
   */
  private transformParameter(param: EventParameter, value: unknown): unknown {
    // 如果有自定义转换器，使用它
    const customTransformer = this.transformers.get(param.type);
    if (customTransformer) {
      return customTransformer.transform(param, value);
    }

    // 默认转换逻辑
    return this.transformByType(param.type, value);
  }

  /**
   * 根据类型转换值
   */
  private transformByType(type: string, value: unknown): unknown {
    // 大数字转换为字符串存储
    if (type.match(/^(u?)int\d+$/)) {
      return String(value);
    }

    // 地址类型保持原样
    if (type === 'address') {
      return typeof value === 'string' ? value.toLowerCase() : String(value).toLowerCase();
    }

    // 字节类型保持原样
    if (type.match(/^bytes\d*$/)) {
      return value;
    }

    // 数组类型转换为JSON字符串
    if (type.includes('[]')) {
      return JSON.stringify(value);
    }

    // 结构体类型转换为JSON字符串
    if (type === 'tuple') {
      return JSON.stringify(value);
    }

    // 其他类型保持原样
    return value;
  }

  /**
   * 初始化默认处理器
   */
  private initializeDefaultHandlers(): void {
    // 注册默认转换器
    this.registerTransformer('uint256', {
      transform: (param, value) => {
        if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') {
          return value.toString();
        }
        return String(value);
      },
      reverseTransform: (param, value) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
          return BigInt(value);
        }
        return BigInt(0);
      },
    });

    this.registerTransformer('address', {
      transform: (param, value) => {
        if (typeof value === 'string') {
          return value.toLowerCase();
        }
        return value;
      },
      reverseTransform: (param, value) => value,
    });

    this.registerTransformer('bool', {
      transform: (param, value) => Boolean(value),
      reverseTransform: (param, value) => value,
    });

    // 注册默认验证器
    this.registerValidator('address', {
      validate: (param, value) => {
        if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
          return { valid: false, error: 'Invalid address format' };
        }
        return { valid: true, sanitizedValue: value.toLowerCase() };
      },
    });

    this.registerValidator('uint256', {
      validate: (param, value) => {
        try {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
            const num = BigInt(value);
            return { valid: true, sanitizedValue: num };
          }
          return { valid: false, error: 'Invalid uint256 format' };
        } catch {
          return { valid: false, error: 'Invalid uint256 format' };
        }
      },
    });
  }
}

/**
 * 导出单例实例
 */
export const eventDecodingService = new EventDecodingService();
