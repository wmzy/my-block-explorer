import { describe, it, expect } from 'vitest';
import {
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionData,
  parseAbi,
  type Abi,
} from 'viem';
import {
  decodeFunctionCall,
  decodeRevertReason,
  extractRevertData,
  formatArgValue,
  formatCallArgs,
  selectorOf,
} from '@/utils/txDecode';

const TRANSFER_SELECTOR = '0xa9059cbb'; // transfer(address,uint256)
const APPROVE_SELECTOR = '0x095ea7b3'; // approve(address,uint256)
const ERROR_STRING_SELECTOR = '0x08c379a0'; // Error(string)
const PANIC_SELECTOR = '0x4e487b71'; // Panic(uint256)

const RECIPIENT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const AMOUNT = 100000000000000000000n; // 100 tokens

const erc20Abi: Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const approveOnlyAbi: Abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const customErrorAbi: Abi = parseAbi(['error InsufficientBalance(uint256 available, uint256 required)']);

// ABI-encoded Error(string) payload, exactly what Solidity's revert("…") emits.
const errorStringData = `${ERROR_STRING_SELECTOR}${encodeAbiParameters(
  [{ type: 'string' }],
  ['Insufficient balance'],
).slice(2)}`;

// ABI-encoded Panic(uint256): selector + the code left-padded to 32 bytes.
const panicData = (code: number): string =>
  `${PANIC_SELECTOR}${code.toString(16).padStart(64, '0')}`;

describe('selectorOf', () => {
  it('returns the lowercased 4-byte selector for valid calldata', () => {
    const calldata = `0xA9059CBB${'1a'.repeat(32)}${'2b'.repeat(32)}`;
    expect(selectorOf(calldata)).toBe(TRANSFER_SELECTOR);
  });

  it('returns null for plain-transfer input (0x)', () => {
    expect(selectorOf('0x')).toBeNull();
  });

  it('returns null for input shorter than a selector', () => {
    expect(selectorOf('0x1234')).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(selectorOf(undefined)).toBeNull();
  });

  it('returns null for non-hex input', () => {
    expect(selectorOf('0xzzzzzzzz00000000000000000000000000000000000000000000000000000')).toBeNull();
  });
});

describe('decodeFunctionCall', () => {
  it('decodes an encoded transfer call back to name and args', () => {
    const input = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [RECIPIENT, AMOUNT],
    });
    const decoded = decodeFunctionCall(input, erc20Abi);
    expect(decoded).not.toBeNull();
    expect(decoded?.functionName).toBe('transfer');
    expect(decoded?.args).toEqual([RECIPIENT, AMOUNT]);
    expect(decoded?.args[1]).toBeTypeOf('bigint');
  });

  it('returns null when the selector is absent from the ABI', () => {
    const input = encodeFunctionData({
      abi: approveOnlyAbi,
      functionName: 'approve',
      args: [RECIPIENT, AMOUNT],
    });
    expect(input.slice(0, 10).toLowerCase()).toBe(APPROVE_SELECTOR);
    expect(decodeFunctionCall(input, erc20Abi)).toBeNull();
  });

  it('returns null for empty 0x input', () => {
    expect(decodeFunctionCall('0x', erc20Abi)).toBeNull();
  });
});

describe('decodeRevertReason', () => {
  it('decodes Error(string) payloads to the plain message', () => {
    expect(decodeRevertReason(errorStringData)).toBe('Insufficient balance');
  });

  it('maps documented Panic codes to their cause', () => {
    expect(decodeRevertReason(panicData(0x01))).toContain('assert failed');
    expect(decodeRevertReason(panicData(0x11))).toContain('arithmetic overflow/underflow');
    expect(decodeRevertReason(panicData(0x12))).toContain('division by zero');
  });

  it('labels undocumented Panic codes as unknown', () => {
    expect(decodeRevertReason(panicData(0x99))).toBe('Panic 0x99: unknown panic code');
  });

  it('decodes custom errors from the ABI with decimal arg display', () => {
    const data = encodeErrorResult({
      abi: customErrorAbi,
      errorName: 'InsufficientBalance',
      args: [100n, 250n],
    });
    expect(decodeRevertReason(data, customErrorAbi)).toBe('InsufficientBalance(100, 250)');
  });

  it('returns null for an unknown selector when no ABI is given', () => {
    expect(decodeRevertReason(`0xdeadbeef${'0'.repeat(120)}`)).toBeNull();
  });

  it('returns null for an unknown selector when the ABI lacks the error', () => {
    expect(decodeRevertReason(`0xdeadbeef${'0'.repeat(120)}`, erc20Abi)).toBeNull();
  });
});

describe('extractRevertData', () => {
  it('walks a nested cause chain to the hex revert payload', () => {
    const error = { cause: { cause: { data: errorStringData } } };
    expect(extractRevertData(error)).toBe(errorStringData);
  });

  it('returns the payload from the top-level error object', () => {
    expect(extractRevertData({ data: errorStringData })).toBe(errorStringData);
  });

  it('returns null when no hex data exists anywhere in the chain', () => {
    expect(extractRevertData({ cause: { cause: { data: 'some message' } } })).toBeNull();
    expect(extractRevertData(new Error('no data property at all'))).toBeNull();
    expect(extractRevertData(null)).toBeNull();
  });
});

describe('formatArgValue / formatCallArgs', () => {
  it('renders bigints in decimal', () => {
    expect(formatArgValue(12345678901234567890n)).toBe('12345678901234567890');
  });

  it('quotes human strings but keeps 0x-hex strings verbatim', () => {
    expect(formatArgValue('hello')).toBe('"hello"');
    expect(formatArgValue('0xAbCdEf0123456789')).toBe('0xAbCdEf0123456789');
  });

  it('joins mixed arg lists with ", "', () => {
    expect(formatCallArgs([100n, 'hello', '0xabc'])).toBe('100, "hello", 0xabc');
  });
});
