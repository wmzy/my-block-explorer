/**
 * Event Validation Service
 * Provides comprehensive TypeScript validation and error handling for event operations
 * Ensures type safety, data integrity, and proper error reporting
 */

import { Address, Hex, isValidAddress, isHex } from 'viem';
import { z } from 'zod';
import {
  EventParameter,
  EventFilters,
  PaginationParams,
  DecodedEvent,
  DecodedEventParameter,
  EventDecodingError,
  ChainDatabaseError,
  EventIndexingError,
} from '../types/events';

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  sanitizedData?: any;
}

/**
 * Validation error interface
 */
export interface ValidationError {
  field: string;
  code: string;
  message: string;
  value?: any;
  severity: 'error' | 'warning';
}

/**
 * Validation warning interface
 */
export interface ValidationWarning {
  field: string;
  code: string;
  message: string;
  recommendation?: string;
}

/**
 * Event validation options
 */
export interface EventValidationOptions {
  strict?: boolean; // Throw errors for validation failures
  sanitize?: boolean; // Sanitize invalid data
  enableWarnings?: boolean; // Generate warnings for potential issues
  validateTypes?: boolean; // Validate TypeScript types
  validateFormats?: boolean; // Validate data formats
}

/**
 * Chain validation context
 */
export interface ValidationContext {
  chainId: number;
  contractAddress?: Address;
  operation: 'indexing' | 'querying' | 'decoding' | 'parsing';
  timestamp: Date;
}

/**
 * Event Validation Service
 * Provides comprehensive validation with detailed error reporting
 */
export class EventValidationService {
  private chainId: number;
  private validationContext: ValidationContext;
  private errorCache: Map<string, ValidationError[]> = new Map();

  constructor(chainId: number, operation: ValidationContext['operation']) {
    this.chainId = chainId;
    this.validationContext = {
      chainId,
      operation,
      timestamp: new Date(),
    };
  }

  /**
   * Validate event filters
   */
  validateEventFilters(filters: EventFilters, options: EventValidationOptions = {}): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const sanitizedFilters = { ...filters };

    // Validate contract address
    if (filters.contractAddress) {
      const addressValidation = this.validateAddress(filters.contractAddress, 'contractAddress');
      errors.push(...addressValidation.errors);
      warnings.push(...addressValidation.warnings);
      if (addressValidation.sanitizedData) {
        sanitizedFilters.contractAddress = addressValidation.sanitizedData;
      }
    }

    // Validate block numbers
    if (filters.fromBlock !== undefined) {
      const blockValidation = this.validateBlockNumber(filters.fromBlock, 'fromBlock');
      errors.push(...blockValidation.errors);
      warnings.push(...blockValidation.warnings);
      if (blockValidation.sanitizedData) {
        sanitizedFilters.fromBlock = blockValidation.sanitizedData;
      }
    }

    if (filters.toBlock !== undefined) {
      const blockValidation = this.validateBlockNumber(filters.toBlock, 'toBlock');
      errors.push(...blockValidation.errors);
      warnings.push(...blockValidation.warnings);
      if (blockValidation.sanitizedData) {
        sanitizedFilters.toBlock = blockValidation.sanitizedData;
      }
    }

    // Validate block range
    if (filters.fromBlock !== undefined && filters.toBlock !== undefined) {
      const rangeValidation = this.validateBlockRange(filters.fromBlock, filters.toBlock);
      errors.push(...rangeValidation.errors);
      warnings.push(...rangeValidation.warnings);
    }

    // Validate timestamps
    if (filters.fromTimestamp !== undefined) {
      const timestampValidation = this.validateTimestamp(filters.fromTimestamp, 'fromTimestamp');
      errors.push(...timestampValidation.errors);
      warnings.push(...timestampValidation.warnings);
      if (timestampValidation.sanitizedData) {
        sanitizedFilters.fromTimestamp = timestampValidation.sanitizedData;
      }
    }

    if (filters.toTimestamp !== undefined) {
      const timestampValidation = this.validateTimestamp(filters.toTimestamp, 'toTimestamp');
      errors.push(...timestampValidation.errors);
      warnings.push(...timestampValidation.warnings);
      if (timestampValidation.sanitizedData) {
        sanitizedFilters.toTimestamp = timestampValidation.sanitizedData;
      }
    }

    // Validate topics
    if (filters.topics) {
      const topicsValidation = this.validateTopics(filters.topics);
      errors.push(...topicsValidation.errors);
      warnings.push(...topicsValidation.warnings);
      if (topicsValidation.sanitizedData) {
        sanitizedFilters.topics = topicsValidation.sanitizedData;
      }
    }

    // Validate dynamic parameters
    for (const [key, value] of Object.entries(filters)) {
      if (!['contractAddress', 'fromBlock', 'toBlock', 'fromTimestamp', 'toTimestamp', 'topics'].includes(key)) {
        const paramValidation = this.validateDynamicParameter(key, value);
        errors.push(...paramValidation.errors);
        warnings.push(...paramValidation.warnings);
        if (paramValidation.sanitizedData) {
          sanitizedFilters[key] = paramValidation.sanitizedData;
        }
      }
    }

    const result: ValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedData: options.sanitize ? sanitizedFilters : undefined,
    };

    this.handleValidationResult(result, options);

    return result;
  }

  /**
   * Validate pagination parameters
   */
  validatePaginationParams(params: PaginationParams, options: EventValidationOptions = {}): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const sanitizedParams = { ...params };

    // Validate limit
    if (params.limit !== undefined) {
      const limitValidation = this.validateLimit(params.limit);
      errors.push(...limitValidation.errors);
      warnings.push(...limitValidation.warnings);
      if (limitValidation.sanitizedData) {
        sanitizedParams.limit = limitValidation.sanitizedData;
      }
    }

    // Validate offset
    if (params.offset !== undefined) {
      const offsetValidation = this.validateOffset(params.offset);
      errors.push(...offsetValidation.errors);
      warnings.push(...offsetValidation.warnings);
      if (offsetValidation.sanitizedData) {
        sanitizedParams.offset = offsetValidation.sanitizedData;
      }
    }

    // Validate cursor
    if (params.cursor !== undefined) {
      const cursorValidation = this.validateCursor(params.cursor);
      errors.push(...cursorValidation.errors);
      warnings.push(...cursorValidation.warnings);
      if (cursorValidation.sanitizedData) {
        sanitizedParams.cursor = cursorValidation.sanitizedData;
      }
    }

    // Validate direction
    if (params.direction !== undefined) {
      const directionValidation = this.validateDirection(params.direction);
      errors.push(...directionValidation.errors);
      warnings.push(...directionValidation.warnings);
      if (directionValidation.sanitizedData) {
        sanitizedParams.direction = directionValidation.sanitizedData;
      }
    }

    const result: ValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedData: options.sanitize ? sanitizedParams : undefined,
    };

    this.handleValidationResult(result, options);

    return result;
  }

  /**
   * Validate decoded event
   */
  validateDecodedEvent(event: any, options: EventValidationOptions = {}): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check required fields
    const requiredFields = ['chainId', 'contractAddress', 'eventName', 'txHash', 'blockNumber', 'logIndex'];
    for (const field of requiredFields) {
      if (!event[field]) {
        errors.push({
          field,
          code: 'MISSING_REQUIRED_FIELD',
          message: `Required field '${field}' is missing`,
          severity: 'error',
        });
      }
    }

    // Validate chain ID
    if (event.chainId !== undefined) {
      const chainIdValidation = this.validateChainId(event.chainId);
      errors.push(...chainIdValidation.errors);
      warnings.push(...chainIdValidation.warnings);
    }

    // Validate contract address
    if (event.contractAddress) {
      const addressValidation = this.validateAddress(event.contractAddress, 'contractAddress');
      errors.push(...addressValidation.errors);
      warnings.push(...addressValidation.warnings);
    }

    // Validate transaction hash
    if (event.txHash) {
      const hashValidation = this.validateHash(event.txHash, 'txHash', 32);
      errors.push(...hashValidation.errors);
      warnings.push(...hashValidation.warnings);
    }

    // Validate block hash
    if (event.blockHash) {
      const hashValidation = this.validateHash(event.blockHash, 'blockHash', 32);
      errors.push(...hashValidation.errors);
      warnings.push(...hashValidation.warnings);
    }

    // Validate block number
    if (event.blockNumber !== undefined) {
      const blockValidation = this.validateBlockNumber(event.blockNumber, 'blockNumber');
      errors.push(...blockValidation.errors);
      warnings.push(...blockValidation.warnings);
    }

    // Validate log index
    if (event.logIndex !== undefined) {
      const indexValidation = this.validateLogIndex(event.logIndex);
      errors.push(...indexValidation.errors);
      warnings.push(...indexValidation.warnings);
    }

    // Validate event name
    if (event.eventName) {
      const nameValidation = this.validateEventName(event.eventName);
      errors.push(...nameValidation.errors);
      warnings.push(...nameValidation.warnings);
    }

    // Validate event signature
    if (event.eventSignature) {
      const signatureValidation = this.validateEventSignature(event.eventSignature);
      errors.push(...signatureValidation.errors);
      warnings.push(...signatureValidation.warnings);
    }

    // Validate event arguments
    if (event.args && typeof event.args === 'object') {
      const argsValidation = this.validateEventArguments(event.args, event.eventName);
      errors.push(...argsValidation.errors);
      warnings.push(...argsValidation.warnings);
    }

    // Validate indexed at timestamp
    if (event.indexedAt) {
      const timestampValidation = this.validateTimestamp(event.indexedAt, 'indexedAt');
      errors.push(...timestampValidation.errors);
      warnings.push(...timestampValidation.warnings);
    }

    const result: ValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };

    this.handleValidationResult(result, options);

    return result;
  }

  /**
   * Validate event parameters
   */
  validateEventParameters(
    parameters: DecodedEventParameter[],
    eventAbi?: any,
    options: EventValidationOptions = {},
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const param of parameters) {
      // Validate parameter name
      if (!param.name || typeof param.name !== 'string') {
        errors.push({
          field: 'parameter.name',
          code: 'INVALID_PARAMETER_NAME',
          message: 'Parameter name must be a non-empty string',
          value: param.name,
          severity: 'error',
        });
      }

      // Validate parameter type
      if (!param.type || typeof param.type !== 'string') {
        errors.push({
          field: 'parameter.type',
          code: 'INVALID_PARAMETER_TYPE',
          message: 'Parameter type must be a non-empty string',
          value: param.type,
          severity: 'error',
        });
      }

      // Validate parameter value
      if (param.value === undefined && !param.indexed) {
        warnings.push({
          field: param.name,
          code: 'UNDEFINED_PARAMETER_VALUE',
          message: `Parameter '${param.name}' has undefined value`,
        });
      }

      // Type-specific validation
      if (param.type && param.value !== undefined) {
        const typeValidation = this.validateParameterByType(param);
        errors.push(...typeValidation.errors);
        warnings.push(...typeValidation.warnings);
      }
    }

    // Check for duplicate parameter names
    const names = parameters.map(p => p.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    for (const duplicate of duplicates) {
      errors.push({
        field: 'parameter.name',
        code: 'DUPLICATE_PARAMETER_NAME',
        message: `Duplicate parameter name: ${duplicate}`,
        severity: 'error',
      });
    }

    const result: ValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };

    this.handleValidationResult(result, options);

    return result;
  }

  /**
   * Validate address
   */
  private validateAddress(address: any, fieldName: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let sanitizedAddress = address;

    if (typeof address !== 'string') {
      errors.push({
        field: fieldName,
        code: 'INVALID_ADDRESS_TYPE',
        message: 'Address must be a string',
        value: address,
        severity: 'error',
      });
      return { valid: false, errors, warnings };
    }

    // Normalize address format
    const normalizedAddress = address.toLowerCase();

    if (!isValidAddress(address)) {
      errors.push({
        field: fieldName,
        code: 'INVALID_ADDRESS_FORMAT',
        message: 'Invalid Ethereum address format',
        value: address,
        severity: 'error',
      });
    }
    else {
      // Check checksum
      if (address !== normalizedAddress && address !== address.toUpperCase()) {
        warnings.push({
          field: fieldName,
          code: 'ADDRESS_CHECKSUM_MISMATCH',
          message: 'Address checksum may be incorrect',
          recommendation: 'Use proper checksummed address format',
        });
        sanitizedAddress = normalizedAddress;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedData: sanitizedAddress !== address ? sanitizedAddress : undefined,
    };
  }

  /**
   * Validate block number
   */
  private validateBlockNumber(blockNumber: any, fieldName: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let sanitizedBlockNumber = blockNumber;

    // Accept bigint, number, or string
    if (typeof blockNumber === 'bigint') {
      if (blockNumber < 0) {
        errors.push({
          field: fieldName,
          code: 'NEGATIVE_BLOCK_NUMBER',
          message: 'Block number cannot be negative',
          value: blockNumber,
          severity: 'error',
        });
      }
    }
    else if (typeof blockNumber === 'number') {
      if (!Number.isInteger(blockNumber)) {
        errors.push({
          field: fieldName,
          code: 'NON_INTEGER_BLOCK_NUMBER',
          message: 'Block number must be an integer',
          value: blockNumber,
          severity: 'error',
        });
      }
      if (blockNumber < 0) {
        errors.push({
          field: fieldName,
          code: 'NEGATIVE_BLOCK_NUMBER',
          message: 'Block number cannot be negative',
          value: blockNumber,
          severity: 'error',
        });
      }
      // Convert to bigint for consistency
      sanitizedBlockNumber = BigInt(blockNumber);
    }
    else if (typeof blockNumber === 'string') {
      const parsed = parseInt(blockNumber, 10);
      if (isNaN(parsed) || !Number.isInteger(parsed)) {
        errors.push({
          field: fieldName,
          code: 'INVALID_BLOCK_NUMBER_STRING',
          message: 'Block number string must be a valid integer',
          value: blockNumber,
          severity: 'error',
        });
      }
      else {
        sanitizedBlockNumber = BigInt(parsed);
      }
    }
    else {
      errors.push({
        field: fieldName,
        code: 'INVALID_BLOCK_NUMBER_TYPE',
        message: 'Block number must be bigint, number, or string',
        value: blockNumber,
        severity: 'error',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedData: sanitizedBlockNumber !== blockNumber ? sanitizedBlockNumber : undefined,
    };
  }

  /**
   * Validate block range
   */
  private validateBlockRange(fromBlock: any, toBlock: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Convert to numbers for comparison
    const from = typeof fromBlock === 'bigint' ? fromBlock : BigInt(fromBlock);
    const to = typeof toBlock === 'bigint' ? toBlock : BigInt(toBlock);

    if (from > to) {
      errors.push({
        field: 'blockRange',
        code: 'INVALID_BLOCK_RANGE',
        message: 'fromBlock cannot be greater than toBlock',
        value: { fromBlock, toBlock },
        severity: 'error',
      });
    }

    // Warn about very large ranges
    const rangeSize = to - from;
    if (rangeSize > 1000000n) {
      warnings.push({
        field: 'blockRange',
        code: 'LARGE_BLOCK_RANGE',
        message: 'Very large block range may impact performance',
        recommendation: 'Consider narrowing the range or using pagination',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate timestamp
   */
  private validateTimestamp(timestamp: any, fieldName: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let sanitizedTimestamp = timestamp;

    if (typeof timestamp === 'number') {
      if (!Number.isInteger(timestamp)) {
        errors.push({
          field: fieldName,
          code: 'NON_INTEGER_TIMESTAMP',
          message: 'Timestamp must be an integer',
          value: timestamp,
          severity: 'error',
        });
      }
      if (timestamp < 0) {
        errors.push({
          field: fieldName,
          code: 'NEGATIVE_TIMESTAMP',
          message: 'Timestamp cannot be negative',
          value: timestamp,
          severity: 'error',
        });
      }
      // Check if timestamp is reasonable (not too far in future or past)
      const now = Date.now();
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      if (timestamp > now + yearMs) {
        warnings.push({
          field: fieldName,
          code: 'FUTURE_TIMESTAMP',
          message: 'Timestamp is far in the future',
          value: timestamp,
        });
      }
      if (timestamp < now - 50 * yearMs) {
        warnings.push({
          field: fieldName,
          code: 'ANCIENT_TIMESTAMP',
          message: 'Timestamp is very far in the past',
          value: timestamp,
        });
      }
    }
    else if (typeof timestamp === 'string') {
      const parsed = new Date(timestamp).getTime();
      if (isNaN(parsed)) {
        errors.push({
          field: fieldName,
          code: 'INVALID_TIMESTAMP_STRING',
          message: 'Timestamp string must be a valid date format',
          value: timestamp,
          severity: 'error',
        });
      }
      else {
        sanitizedTimestamp = parsed;
      }
    }
    else if (timestamp instanceof Date) {
      sanitizedTimestamp = timestamp.getTime();
    }
    else {
      errors.push({
        field: fieldName,
        code: 'INVALID_TIMESTAMP_TYPE',
        message: 'Timestamp must be number, string, or Date',
        value: timestamp,
        severity: 'error',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedData: sanitizedTimestamp !== timestamp ? sanitizedTimestamp : undefined,
    };
  }

  /**
   * Validate topics array
   */
  private validateTopics(topics: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let sanitizedTopics = topics;

    if (!Array.isArray(topics)) {
      errors.push({
        field: 'topics',
        code: 'INVALID_TOPICS_TYPE',
        message: 'Topics must be an array',
        value: topics,
        severity: 'error',
      });
      return { valid: false, errors, warnings };
    }

    if (topics.length > 4) {
      errors.push({
        field: 'topics',
        code: 'TOO_MANY_TOPICS',
        message: 'Topics array cannot have more than 4 elements',
        value: topics.length,
        severity: 'error',
      });
    }

    sanitizedTopics = topics.map((topic, index) => {
      if (topic === null || topic === undefined) {
        return null; // Allow null for wildcard topics
      }

      if (typeof topic !== 'string') {
        errors.push({
          field: `topics[${index}]`,
          code: 'INVALID_TOPIC_TYPE',
          message: 'Topic must be a string or null',
          value: topic,
          severity: 'error',
        });
        return topic;
      }

      if (!isHex(topic) || topic.length !== 66) {
        errors.push({
          field: `topics[${index}]`,
          code: 'INVALID_TOPIC_FORMAT',
          message: 'Topic must be a 32-byte hex string',
          value: topic,
          severity: 'error',
        });
      }

      return topic;
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedData: sanitizedTopics,
    };
  }

  /**
   * Validate dynamic parameter
   */
  private validateDynamicParameter(name: string, value: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate parameter name
    if (typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      errors.push({
        field: 'parameterName',
        code: 'INVALID_PARAMETER_NAME',
        message: 'Parameter name must be a valid identifier',
        value: name,
        severity: 'error',
      });
    }

    // Basic value validation based on type
    if (value !== null && value !== undefined) {
      if (typeof value === 'string' && value.length > 1000) {
        warnings.push({
          field: name,
          code: 'LONG_STRING_VALUE',
          message: 'String value is very long and may impact performance',
          recommendation: 'Consider indexing or limiting string length',
        });
      }

      if (typeof value === 'object' && !Array.isArray(value)) {
        warnings.push({
          field: name,
          code: 'OBJECT_PARAMETER',
          message: 'Object parameter should be validated against schema',
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate limit parameter
   */
  private validateLimit(limit: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let sanitizedLimit = limit;

    if (typeof limit !== 'number' || !Number.isInteger(limit)) {
      errors.push({
        field: 'limit',
        code: 'INVALID_LIMIT_TYPE',
        message: 'Limit must be an integer',
        value: limit,
        severity: 'error',
      });
    }
    else if (limit < 1) {
      errors.push({
        field: 'limit',
        code: 'INVALID_LIMIT_RANGE',
        message: 'Limit must be greater than 0',
        value: limit,
        severity: 'error',
      });
    }
    else if (limit > 1000) {
      warnings.push({
        field: 'limit',
        code: 'HIGH_LIMIT_VALUE',
        message: 'High limit value may impact performance',
        recommendation: 'Consider using a smaller limit with pagination',
      });
      // Cap at reasonable maximum
      sanitizedLimit = 1000;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedData: sanitizedLimit !== limit ? sanitizedLimit : undefined,
    };
  }

  /**
   * Validate offset parameter
   */
  private validateOffset(offset: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (typeof offset !== 'number' || !Number.isInteger(offset)) {
      errors.push({
        field: 'offset',
        code: 'INVALID_OFFSET_TYPE',
        message: 'Offset must be an integer',
        value: offset,
        severity: 'error',
      });
    }
    else if (offset < 0) {
      errors.push({
        field: 'offset',
        code: 'NEGATIVE_OFFSET',
        message: 'Offset cannot be negative',
        value: offset,
        severity: 'error',
      });
    }
    else if (offset > 100000) {
      warnings.push({
        field: 'offset',
        code: 'HIGH_OFFSET_VALUE',
        message: 'High offset value may impact performance',
        recommendation: 'Consider using cursor-based pagination',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate cursor parameter
   */
  private validateCursor(cursor: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (typeof cursor !== 'string') {
      errors.push({
        field: 'cursor',
        code: 'INVALID_CURSOR_TYPE',
        message: 'Cursor must be a string',
        value: cursor,
        severity: 'error',
      });
    }
    else if (cursor.length === 0) {
      errors.push({
        field: 'cursor',
        code: 'EMPTY_CURSOR',
        message: 'Cursor cannot be empty',
        severity: 'error',
      });
    }
    else if (cursor.length > 1000) {
      warnings.push({
        field: 'cursor',
        code: 'LONG_CURSOR',
        message: 'Cursor string is unusually long',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate direction parameter
   */
  private validateDirection(direction: any): ValidationResult {
    const errors: ValidationError[] = [];

    if (direction !== 'asc' && direction !== 'desc') {
      errors.push({
        field: 'direction',
        code: 'INVALID_DIRECTION',
        message: 'Direction must be either "asc" or "desc"',
        value: direction,
        severity: 'error',
      });
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  /**
   * Validate chain ID
   */
  private validateChainId(chainId: any): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof chainId !== 'number' || !Number.isInteger(chainId)) {
      errors.push({
        field: 'chainId',
        code: 'INVALID_CHAIN_ID_TYPE',
        message: 'Chain ID must be an integer',
        value: chainId,
        severity: 'error',
      });
    }
    else if (chainId < 1) {
      errors.push({
        field: 'chainId',
        code: 'INVALID_CHAIN_ID_RANGE',
        message: 'Chain ID must be greater than 0',
        value: chainId,
        severity: 'error',
      });
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  /**
   * Validate hash
   */
  private validateHash(hash: any, fieldName: string, expectedLength: number): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof hash !== 'string') {
      errors.push({
        field: fieldName,
        code: 'INVALID_HASH_TYPE',
        message: `${fieldName} must be a string`,
        value: hash,
        severity: 'error',
      });
    }
    else if (!isHex(hash)) {
      errors.push({
        field: fieldName,
        code: 'INVALID_HASH_FORMAT',
        message: `${fieldName} must be a valid hex string`,
        value: hash,
        severity: 'error',
      });
    }
    else if (hash.length !== expectedLength * 2 + 2) { // +2 for '0x' prefix
      errors.push({
        field: fieldName,
        code: 'INVALID_HASH_LENGTH',
        message: `${fieldName} must be ${expectedLength} bytes (${expectedLength * 2 + 2} characters with 0x prefix)`,
        value: hash,
        severity: 'error',
      });
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  /**
   * Validate log index
   */
  private validateLogIndex(logIndex: any): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof logIndex !== 'number' || !Number.isInteger(logIndex)) {
      errors.push({
        field: 'logIndex',
        code: 'INVALID_LOG_INDEX_TYPE',
        message: 'Log index must be an integer',
        value: logIndex,
        severity: 'error',
      });
    }
    else if (logIndex < 0) {
      errors.push({
        field: 'logIndex',
        code: 'NEGATIVE_LOG_INDEX',
        message: 'Log index cannot be negative',
        value: logIndex,
        severity: 'error',
      });
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  /**
   * Validate event name
   */
  private validateEventName(eventName: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (typeof eventName !== 'string') {
      errors.push({
        field: 'eventName',
        code: 'INVALID_EVENT_NAME_TYPE',
        message: 'Event name must be a string',
        value: eventName,
        severity: 'error',
      });
    }
    else if (!/^[A-Z][a-zA-Z0-9]*$/.test(eventName)) {
      warnings.push({
        field: 'eventName',
        code: 'NON_STANDARD_EVENT_NAME',
        message: 'Event name should follow Solidity naming convention (PascalCase)',
        value: eventName,
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate event signature
   */
  private validateEventSignature(signature: any): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof signature !== 'string') {
      errors.push({
        field: 'eventSignature',
        code: 'INVALID_EVENT_SIGNATURE_TYPE',
        message: 'Event signature must be a string',
        value: signature,
        severity: 'error',
      });
    }
    else if (!/^[A-Za-z][A-Za-z0-9]*\([^)]*\)$/.test(signature)) {
      errors.push({
        field: 'eventSignature',
        code: 'INVALID_EVENT_SIGNATURE_FORMAT',
        message: 'Event signature must be in format "EventName(type1,type2)"',
        value: signature,
        severity: 'error',
      });
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  /**
   * Validate event arguments
   */
  private validateEventArguments(args: any, eventName?: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (typeof args !== 'object' || args === null) {
      errors.push({
        field: 'args',
        code: 'INVALID_ARGS_TYPE',
        message: 'Event arguments must be an object',
        value: args,
        severity: 'error',
      });
      return { valid: false, errors, warnings };
    }

    // Check for empty arguments
    if (Object.keys(args).length === 0 && eventName) {
      warnings.push({
        field: 'args',
        code: 'EMPTY_EVENT_ARGS',
        message: `Event ${eventName} has no arguments`,
      });
    }

    // Validate each argument
    for (const [key, value] of Object.entries(args)) {
      if (typeof key !== 'string' || key.length === 0) {
        errors.push({
          field: 'args.key',
          code: 'INVALID_ARG_KEY',
          message: 'Argument key must be a non-empty string',
          value: key,
          severity: 'error',
        });
      }

      // Check for undefined values
      if (value === undefined) {
        warnings.push({
          field: `args.${key}`,
          code: 'UNDEFINED_ARG_VALUE',
          message: `Argument '${key}' has undefined value`,
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate parameter by type
   */
  private validateParameterByType(param: DecodedEventParameter): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const { type, value, indexed } = param;

    // Address validation
    if (type === 'address') {
      if (typeof value === 'string' && !isValidAddress(value)) {
        errors.push({
          field: param.name,
          code: 'INVALID_ADDRESS_VALUE',
          message: `Parameter '${param.name}' is not a valid address`,
          value,
          severity: 'error',
        });
      }
    }

    // Number validation
    if (type.match(/^u?int\d*$/)) {
      if (typeof value === 'bigint' && value < 0) {
        errors.push({
          field: param.name,
          code: 'NEGATIVE_UINT_VALUE',
          message: `Parameter '${param.name}' cannot be negative for unsigned type`,
          value,
          severity: 'error',
        });
      }

      if (typeof value === 'number' && (value < 0 || !Number.isInteger(value))) {
        errors.push({
          field: param.name,
          code: 'INVALID_INT_VALUE',
          message: `Parameter '${param.name}' must be a non-negative integer`,
          value,
          severity: 'error',
        });
      }
    }

    // Boolean validation
    if (type === 'bool' && typeof value !== 'boolean') {
      errors.push({
        field: param.name,
        code: 'INVALID_BOOLEAN_VALUE',
        message: `Parameter '${param.name}' must be a boolean`,
        value,
        severity: 'error',
      });
    }

    // Bytes validation
    if (type.match(/^bytes\d+$/) && typeof value === 'string') {
      const expectedLength = parseInt(type.slice(5), 10);
      if (!isHex(value) || value.length !== expectedLength * 2 + 2) {
        errors.push({
          field: param.name,
          code: 'INVALID_BYTES_VALUE',
          message: `Parameter '${param.name}' must be ${expectedLength} bytes`,
          value,
          severity: 'error',
        });
      }
    }

    // Array validation
    if (type.endsWith('[]') && !Array.isArray(value)) {
      errors.push({
        field: param.name,
        code: 'INVALID_ARRAY_VALUE',
        message: `Parameter '${param.name}' must be an array`,
        value,
        severity: 'error',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Handle validation result based on options
   */
  private handleValidationResult(result: ValidationResult, options: EventValidationOptions): void {
    if (options.strict && !result.valid) {
      const errorMessages = result.errors.map(e => `[${e.field}] ${e.message}`).join('; ');
      throw new EventDecodingError(
        `Validation failed: ${errorMessages}`,
        undefined,
        undefined,
        this.chainId,
      );
    }

    if (options.enableWarnings && result.warnings.length > 0) {
      console.warn(`Validation warnings for ${this.validationContext.operation}:`, result.warnings);
    }

    // Cache validation errors for analytics
    if (result.errors.length > 0) {
      const cacheKey = `${this.validationContext.operation}_${this.validationContext.chainId}_${Date.now()}`;
      this.errorCache.set(cacheKey, result.errors);
    }
  }

  /**
   * Get validation errors summary
   */
  getValidationErrorsSummary(): Array<{ code: string; count: number; lastSeen: Date }> {
    const summary = new Map<string, { count: number; lastSeen: Date }>();

    for (const errors of this.errorCache.values()) {
      for (const error of errors) {
        const existing = summary.get(error.code) || { count: 0, lastSeen: new Date() };
        summary.set(error.code, {
          count: existing.count + 1,
          lastSeen: new Date(),
        });
      }
    }

    return Array.from(summary.entries()).map(([code, data]) => ({
      code,
      ...data,
    }));
  }

  /**
   * Clear error cache
   */
  clearErrorCache(): void {
    this.errorCache.clear();
  }

  /**
   * Get chain ID
   */
  getChainId(): number {
    return this.chainId;
  }

  /**
   * Get validation context
   */
  getValidationContext(): ValidationContext {
    return { ...this.validationContext };
  }
}

// Export singleton manager
class EventValidationServiceManager {
  private services: Map<string, EventValidationService> = new Map();

  getService(chainId: number, operation: ValidationContext['operation']): EventValidationService {
    const key = `${chainId}_${operation}`;
    if (!this.services.has(key)) {
      this.services.set(key, new EventValidationService(chainId, operation));
    }
    return this.services.get(key)!;
  }

  removeService(chainId: number, operation: ValidationContext['operation']): void {
    const key = `${chainId}_${operation}`;
    this.services.delete(key);
  }

  getAllServices(): EventValidationService[] {
    return Array.from(this.services.values());
  }

  clearAllErrorCaches(): void {
    this.services.forEach(service => service.clearErrorCache());
  }
}

export const eventValidationServiceManager = new EventValidationServiceManager();
