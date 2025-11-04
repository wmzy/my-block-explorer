/**
 * Form validation utilities for different Solidity types
 */

import { ValidationRule, FormData, RangeValue, DateTimeRangeValue } from '../types/forms';

/**
 * Validate form input against validation rules
 */
export function validateSolidityInput(value: any, rules: ValidationRule[] = []): string[] {
  const errors: string[] = [];

  for (const rule of rules) {
    const error = validateRule(value, rule);
    if (error) {
      errors.push(error);
    }
  }

  return errors;
}

/**
 * Validate a single rule
 */
function validateRule(value: any, rule: ValidationRule): string | null {
  switch (rule.type) {
    case 'required':
      if (!value || value === '' || value === null || value === undefined) {
        return rule.message || 'This field is required';
      }
      break;

    case 'pattern':
      if (value && !rule.value.test(value)) {
        return rule.message || 'Invalid format';
      }
      break;

    case 'min':
      if (typeof value === 'number' && value < rule.value) {
        return rule.message || `Value must be at least ${rule.value}`;
      }
      if (typeof value === 'string' && value.length < rule.value) {
        return rule.message || `Must be at least ${rule.value} characters`;
      }
      break;

    case 'max':
      if (typeof value === 'number' && value > rule.value) {
        return rule.message || `Value must be at most ${rule.value}`;
      }
      if (typeof value === 'string' && value.length > rule.value) {
        return rule.message || `Must be at most ${rule.value} characters`;
      }
      break;

    case 'maxLength':
      if (value && value.length > rule.value) {
        return rule.message || `Maximum length is ${rule.value} characters`;
      }
      break;

    case 'numeric':
      if (value && isNaN(Number(value))) {
        return rule.message || 'Must be a valid number';
      }
      break;

    case 'range':
      if (value && typeof value === 'object') {
        const range = value as RangeValue;
        const from = Number(range.from);
        const to = Number(range.to);

        if (range.from && range.to && from > to) {
          return rule.message || 'From value must be less than or equal to to value';
        }
      }
      break;

    case 'dateRange':
      if (value && typeof value === 'object') {
        const range = value as DateTimeRangeValue;
        const from = range.from ? new Date(range.from) : null;
        const to = range.to ? new Date(range.to) : null;

        if (from && to && from > to) {
          return rule.message || 'From date must be before or equal to to date';
        }
      }
      break;

    case 'array':
      if (value && typeof value === 'string') {
        const lines = value.trim().split('\n').filter(line => line.trim());
        for (const line of lines) {
          if (!validateArrayItem(line, rule.itemType)) {
            return rule.message || `Invalid ${rule.itemType} in array`;
          }
        }
      }
      break;
  }

  return null;
}

/**
 * Validate array item based on type
 */
function validateArrayItem(value: string, type: string): boolean {
  switch (type) {
    case 'address':
      return /^0x[a-fA-F0-9]{40}$/.test(value);
    case 'uint256':
    case 'uint128':
    case 'uint64':
    case 'uint32':
      return /^\d+$/.test(value) && Number(value) >= 0;
    case 'int256':
    case 'int128':
      return /^-?\d+$/.test(value);
    case 'bool':
      return ['true', 'false'].includes(value.toLowerCase());
    case 'string':
      return value.length > 0;
    case 'bytes':
    case 'bytes32':
      return /^0x[a-fA-F0-9]*$/.test(value);
    default:
      return true; // Unknown types are accepted
  }
}

/**
 * Convert Solidity type to form input type
 */
export function convertInputType(solidityType: string): string {
  if (solidityType === 'bool') return 'checkbox';
  if (solidityType === 'string') return 'text';
  if (solidityType.startsWith('uint') || solidityType.startsWith('int')) return 'number';
  if (solidityType.startsWith('bytes')) return 'text';
  if (solidityType === 'address') return 'text';
  if (solidityType.endsWith('[]')) return 'textarea';
  return 'text';
}

/**
 * Convert form value to Solidity type
 */
export function convertFormValue(value: any, solidityType: string): any {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  switch (solidityType) {
    case 'bool':
      return Boolean(value);

    case 'uint256':
    case 'uint128':
    case 'uint64':
    case 'uint32':
      return typeof value === 'string' ? value : String(BigInt(value));

    case 'int256':
    case 'int128':
      return typeof value === 'string' ? value : String(BigInt(value));

    case 'string':
      return value;

    case 'address':
      return value.toLowerCase();

    case 'bytes':
    case 'bytes32':
      return value.toLowerCase();

    default:
      if (solidityType.endsWith('[]')) {
        // Handle array types
        if (typeof value === 'string') {
          const lines = value.trim().split('\n').filter(line => line.trim());
          return lines.map(line => convertFormValue(line.trim(), solidityType.slice(0, -2)));
        }
        return value;
      }

      return value;
  }
}

/**
 * Validate Ethereum address
 */
export function validateAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate transaction hash
 */
export function validateTxHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

/**
 * Validate block number
 */
export function validateBlockNumber(blockNumber: string | number): boolean {
  const num = typeof blockNumber === 'string' ? parseInt(blockNumber, 10) : blockNumber;
  return !isNaN(num) && num >= 0 && num <= Number.MAX_SAFE_INTEGER;
}

/**
 * Validate timestamp
 */
export function validateTimestamp(timestamp: string): boolean {
  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

/**
 * Validate hex string
 */
export function validateHexString(hex: string, length?: number): boolean {
  const hexPattern = length
    ? new RegExp(`^0x[a-fA-F0-9]{${length}}$`)
    : /^0x[a-fA-F0-9]+$/;

  return hexPattern.test(hex);
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, ''); // Remove potential XSS
}

/**
 * Parse range value
 */
export function parseRangeValue(value: RangeValue): { from?: number; to?: number } | null {
  if (!value) return null;

  const result: { from?: number; to?: number } = {};

  if (value.from) {
    const from = Number(value.from);
    if (!isNaN(from)) result.from = from;
  }

  if (value.to) {
    const to = Number(value.to);
    if (!isNaN(to)) result.to = to;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse datetime range value
 */
export function parseDateTimeRangeValue(value: DateTimeRangeValue): { from?: Date; to?: Date } | null {
  if (!value) return null;

  const result: { from?: Date; to?: Date } = {};

  if (value.from) {
    const from = new Date(value.from);
    if (!isNaN(from.getTime())) result.from = from;
  }

  if (value.to) {
    const to = new Date(value.to);
    if (!isNaN(to.getTime())) result.to = to;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Enhanced search filter generation for ABI-based event filtering
 */
export function generateSearchFilter(formData: FormData): Record<string, any> {
  const filter: Record<string, any> = {};

  // Handle event name
  if (formData.eventName) {
    filter.eventName = formData.eventName;
  }

  // Auto-detect field types and apply appropriate filtering
  Object.entries(formData).forEach(([key, value]) => {
    if (!value || value === '' || value === null || value === undefined) return;

    // Skip special fields that are handled separately
    if (['eventName', 'blockRange', 'timestampRange'].includes(key)) return;

    // Handle range objects
    if (typeof value === 'object' && (value.from || value.to || value.like)) {
      if (value.from !== undefined || value.to !== undefined) {
        // Numeric or timestamp range
        const rangeFilter: any = {};
        if (value.from !== undefined) rangeFilter.gte = value.from;
        if (value.to !== undefined) rangeFilter.lte = value.to;
        filter[key] = rangeFilter;
      } else if (value.like) {
        // Text search with LIKE
        filter[key] = {
          like: `%${value.like}%`,
          caseInsensitive: true
        };
      }
      return;
    }

    // Handle specific field types based on naming patterns
    if (isAddressField(key)) {
      if (validateAddress(value)) {
        filter[key] = value.toLowerCase();
      }
    } else if (isNumericField(key)) {
      filter[key] = value;
    } else if (isBooleanField(key)) {
      filter[key] = Boolean(value);
    } else if (isHashField(key)) {
      if (validateHexString(value, getHashLength(key))) {
        filter[key] = value.toLowerCase();
      }
    } else {
      // Default: text search with LIKE
      filter[key] = {
        like: `%${value}%`,
        caseInsensitive: true
      };
    }
  });

  // Handle block range
  if (formData.blockRange) {
    const range = parseRangeValue(formData.blockRange);
    if (range) {
      if (range.from !== undefined) filter.fromBlock = String(range.from);
      if (range.to !== undefined) filter.toBlock = String(range.to);
    }
  }

  // Handle timestamp range
  if (formData.timestampRange) {
    const range = parseDateTimeRangeValue(formData.timestampRange);
    if (range) {
      if (range.from) filter.fromTimestamp = Math.floor(range.from.getTime() / 1000);
      if (range.to) filter.toTimestamp = Math.floor(range.to.getTime() / 1000);
    }
  }

  return Object.keys(filter).length > 0 ? filter : null;
}

/**
 * Check if field name suggests it's an address
 */
function isAddressField(fieldName: string): boolean {
  const addressPatterns = [
    /^(from|to|owner|sender|recipient|spender|minter|burner|operator|proxy)$/i,
    /address$/i,
    /account$/i,
    /wallet$/i
  ];

  return addressPatterns.some(pattern => pattern.test(fieldName));
}

/**
 * Check if field name suggests it's numeric
 */
function isNumericField(fieldName: string): boolean {
  const numericPatterns = [
    /^(value|amount|balance|price|cost|fee|rate|ratio)$/i,
    /^(tokenId|token|id|nonce|epoch|slot|gas|limit)$/i,
    /^(block|timestamp|time|date|age|duration)$/i,
    /number$/i,
    /count$/i,
    /index$/i,
    /level$/i,
    /version$/i
  ];

  return numericPatterns.some(pattern => pattern.test(fieldName));
}

/**
 * Check if field name suggests it's boolean
 */
function isBooleanField(fieldName: string): boolean {
  const booleanPatterns = [
    /^(is|has|can|should|will|are|was|were|am|been|being)$/i,
    /^(enabled|disabled|active|inactive|paused|stopped|started)$/i,
    /^(approved|rejected|accepted|denied|allowed|forbidden)$/i,
    /^(true|false|yes|no|on|off)$/i,
    /(is|has|can)[A-Z]/,
    /[A-Z](is|has|can)/,
    /able$/i,
    /ible$/i
  ];

  return booleanPatterns.some(pattern => pattern.test(fieldName));
}

/**
 * Check if field name suggests it's a hash
 */
function isHashField(fieldName: string): boolean {
  const hashPatterns = [
    /^(hash|tx|transaction|block|log|event)$/i,
    /hash$/i,
    /signature$/i,
    /digest$/i,
    /identifier$/i
  ];

  return hashPatterns.some(pattern => pattern.test(fieldName));
}

/**
 * Get expected hash length based on field name
 */
function getHashLength(fieldName: string): number | undefined {
  if (fieldName.toLowerCase().includes('tx') || fieldName.toLowerCase().includes('transaction')) {
    return 64; // 32 bytes = 64 hex chars
  }
  if (fieldName.toLowerCase().includes('block')) {
    return 64; // block hash is 32 bytes
  }
  if (fieldName.toLowerCase().includes('log') || fieldName.toLowerCase().includes('event')) {
    return 64; // log topics are 32 bytes
  }
  return undefined; // Don't enforce specific length
}