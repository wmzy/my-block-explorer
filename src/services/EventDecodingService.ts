/**
 * ABI event decoding service
 * Decodes Ethereum event logs into type-safe results
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
 * Event decoding configuration
 */
interface DecodingConfig {
  enableStrictValidation: boolean;
  sanitizeValues: boolean;
  preserveRawData: boolean;
  maxRecursionDepth: number;
}

/**
 * Default decoding configuration
 */
const DEFAULT_DECODING_CONFIG: DecodingConfig = {
  enableStrictValidation: true,
  sanitizeValues: true,
  preserveRawData: true,
  maxRecursionDepth: 10,
};

/**
 * Event decoding service
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
   * Decode a single event log
   */
  async decodeLog(
    log: Log,
    abiEvent: EventParameter[],
    chainId: number,
    blockTimestamp?: number,
  ): Promise<DecodedEvent> {
    try {
      // Build a viem-compatible ABI event definition
      const abiEventDef = this.buildAbiEventDefinition(abiEvent);
      const abi: Abi = [abiEventDef];

      // Decode the event with viem
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

      // Format the decoded arguments
      const formattedArgs = await this.formatDecodedArgs(
        decodedLog.args as unknown as DecodedEventData,
        abiEvent,
      );

      // Build the complete event object
      const decodedEvent: DecodedEvent = {
        chainId,
        contractAddress: log.address,
        eventName: decodedLog.eventName ?? 'Unknown',
        eventSignature: this.getEventSignature(abiEvent),

        // Transaction info
        txHash: log.transactionHash ?? '0x',
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        transactionIndex: log.transactionIndex!,
        logIndex: log.logIndex!,

        // Timestamp info — absent stays null; a zero would fake epoch time
        blockTimestamp: blockTimestamp ?? null,

        // Decoded data
        args: formattedArgs,
        rawTopics: log.topics,
        rawData: log.data,

        // Processing info
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
   * Decode event logs in batch
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
        // Find the ABI event definition matching topic 0
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

      // Invoke the progress callback
      onProgress?.(i + 1, logs.length);
    }

    // Errors could be reported to a logger or monitoring system
    if (errors.length > 0) {
      console.warn(`Decoded ${results.length} events with ${errors.length} errors`);
      errors.forEach(error => console.error(error.message, error.cause));
    }

    return results;
  }

  /**
   * Get the event signature
   */
  getEventSignature(eventParams: EventParameter[]): `0x${string}` {
    const signature = `${eventParams[0]?.name || 'Unknown'}(${eventParams
      .map(p => p.type)
      .join(',')})`;
    return keccak256(toHex(signature));
  }

  /**
   * Extract ABI definitions from contract source code
   * @param sourceCode The contract's Solidity source
   * @returns The extracted ABI array
   */
  extractAbiFromSource(sourceCode: string): Abi | null {
    try {
      // Find interface or contract definitions after the pragma statement
      const abiMatch = sourceCode.match(/(interface|contract)\s+\w+\s*{[\s\S]*?(?=\})/g);

      if (!abiMatch) {
        throw new EventDecodingError('No ABI found in source code', undefined, undefined, 0);
      }

      // Extract ABI items (events, functions, etc.)
      const abiItems: AbiEvent[] = [];

      // Match event definitions
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
   * Parse a single event's ABI definition
   * @param eventDefStr The event definition string
   * @returns The parsed event ABI object
   */
  parseEventAbi(eventDefStr: string): AbiEvent | null {
    try {
      // Parse the event name
      const nameMatch = eventDefStr.match(/event\s+(\w+)/);
      if (!nameMatch) {
        return null;
      }
      const eventName = nameMatch[1];

      // Parse the parameter list
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

      // Split the parameters and parse them
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
   * Register a custom data converter
   */
  registerTransformer(abiType: string, transformer: EventDataTransformer): void {
    this.transformers.set(abiType, transformer);
  }

  /**
   * Register a custom data validator
   */
  registerValidator(abiType: string, validator: EventDataValidator): void {
    this.validators.set(abiType, validator);
  }

  /**
   * Build a viem-compatible ABI event definition
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
   * Format decoded arguments
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
        // Validate the data
        const validation = this.validateParameter(param, value);
        if (!validation.valid) {
          throw new Error(`Validation failed for parameter ${param.name}: ${validation.error}`);
        }

        // Convert the data
        const transformedValue = this.transformParameter(param, validation.sanitizedValue ?? value);
        formatted[param.name] = transformedValue;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to format parameter ${param.name}: ${errorMessage}`);
        formatted[param.name] = value; // fall back to the raw value
      }
    }

    return formatted;
  }

  /**
   * Validate a parameter value
   */
  private validateParameter(param: EventParameter, value: unknown): ValidationResult {
    // Use the custom validator when present
    const customValidator = this.validators.get(param.type);
    if (customValidator) {
      return customValidator.validate(param, value);
    }

    // Default validation logic
    if (value === null || value === undefined) {
      // Allow null/undefined unless it is a required indexed parameter
      if (param.indexed) {
        return { valid: false, error: 'Indexed parameters cannot be null or undefined' };
      }
      return { valid: true, sanitizedValue: null };
    }

    // Validate by type
    return this.validateByType(param.type, value);
  }

  /**
   * Validate a value by type
   */
  private validateByType(type: string, value: unknown): ValidationResult {
    // Address type validation
    if (type === 'address') {
      if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
        return { valid: false, error: 'Invalid address format' };
      }
      return { valid: true };
    }

    // Numeric type validation
    if (type.match(/^(u?)int\d+$/)) {
      try {
        const num = BigInt(value as string | number | bigint | boolean);
        return { valid: true, sanitizedValue: num };
      } catch {
        return { valid: false, error: 'Invalid number format' };
      }
    }

    // Boolean type validation
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

    // Bytes type validation
    if (type.match(/^bytes\d*$/)) {
      if (typeof value !== 'string' || !/^0x[a-fA-F0-9]*$/.test(value)) {
        return { valid: false, error: 'Invalid bytes format' };
      }
      return { valid: true };
    }

    // String type validation
    if (type === 'string') {
      if (typeof value !== 'string') {
        return { valid: false, error: 'Invalid string value' };
      }
      return { valid: true };
    }

    // Array type validation
    if (type.includes('[]')) {
      if (!Array.isArray(value)) {
        return { valid: false, error: 'Invalid array value' };
      }
      return { valid: true, sanitizedValue: value };
    }

    // Struct type validation
    if (type === 'tuple') {
      if (typeof value !== 'object' || value === null) {
        return { valid: false, error: 'Invalid tuple value' };
      }
      return { valid: true };
    }

    // Unknown type: pass by default
    return { valid: true };
  }

  /**
   * Convert a parameter value
   */
  private transformParameter(param: EventParameter, value: unknown): unknown {
    // Use the custom converter when present
    const customTransformer = this.transformers.get(param.type);
    if (customTransformer) {
      return customTransformer.transform(param, value);
    }

    // Default conversion logic
    return this.transformByType(param.type, value);
  }

  /**
   * Convert a value by type
   */
  private transformByType(type: string, value: unknown): unknown {
    // Big numbers are stored as strings
    if (type.match(/^(u?)int\d+$/)) {
      return String(value);
    }

    // Address types stay as-is
    if (type === 'address') {
      return typeof value === 'string' ? value.toLowerCase() : String(value).toLowerCase();
    }

    // Bytes types stay as-is
    if (type.match(/^bytes\d*$/)) {
      return value;
    }

    // Arrays are converted to JSON strings
    if (type.includes('[]')) {
      return JSON.stringify(value);
    }

    // Structs are converted to JSON strings
    if (type === 'tuple') {
      return JSON.stringify(value);
    }

    // Other types stay as-is
    return value;
  }

  /**
   * Initialize default handlers
   */
  private initializeDefaultHandlers(): void {
    // Register default converters
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

    // Register default validators
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
 * Export a singleton instance
 */
export const eventDecodingService = new EventDecodingService();
