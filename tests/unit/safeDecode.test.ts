// Pure decoder tests for the Safe execTransaction calldata decoder: all
// fixtures are built with viem's encodeFunctionData so the decoder is
// exercised against canonical ABI encodings. Covers the happy path (every
// typed field), the DELEGATECALL mapping, the honest signature-count
// estimate (65-byte ECDSA packing, floored), and every rejection path —
// wrong selector, truncated calldata (including the tail-truncation case
// viem decodes leniently instead of throwing), empty input, and an
// out-of-range operation byte.
import { describe, it, expect } from 'vitest';
import { encodeFunctionData, getAddress, parseAbi, toFunctionSelector } from 'viem';

import { decodeSafeExecTransaction } from '@/utils/safeDecode';

// The same fragment the decoder uses, redeclared for fixture encoding —
// the decoder's own fragment is exercised through the module import.
const safeExecAbi = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) payable returns (bool success)',
]);

const INNER_TARGET = '0x28fab2ecd37becd3e6c5c7e0f180f35f0a2e6b42';
const GAS_TOKEN = '0x5ab4258245c0fd068c47c11aaa4c071e630c8a21';
const REFUND_RECEIVER = '0x7f1e14b5e5d1a2c3b4d5e6f70819202122232425';

// ERC-20 transfer as the inner call: gives the decoded `data` a real
// selector to resolve downstream.
const innerTransferData = encodeFunctionData({
  abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
  args: [INNER_TARGET, 1_000_000_000_000_000_000n],
});

type ExecFixture = {
  /** Raw uint8 — tests deliberately pass out-of-enum values for rejection. */
  operation?: number;
  data?: `0x${string}`;
  signatures?: `0x${string}`;
  safeTxGas?: bigint;
  baseGas?: bigint;
  gasPrice?: bigint;
};

const encodeExec = (changes: ExecFixture = {}): string =>
  encodeFunctionData({
    abi: safeExecAbi,
    args: [
      INNER_TARGET,
      1_500_000_000_000_000_000n,
      changes.data ?? innerTransferData,
      changes.operation ?? 0,
      changes.safeTxGas ?? 0n,
      changes.baseGas ?? 0n,
      changes.gasPrice ?? 0n,
      GAS_TOKEN,
      REFUND_RECEIVER,
      changes.signatures ?? `0x${'ab'.repeat(130)}`,
    ],
  });

describe('decodeSafeExecTransaction', () => {
  it('decodes every typed field of a canonical execTransaction payload', () => {
    const decoded = decodeSafeExecTransaction(encodeExec());

    expect(decoded).not.toBeNull();
    expect(decoded?.to).toBe(getAddress(INNER_TARGET));
    expect(decoded?.value).toBe(1_500_000_000_000_000_000n);
    expect(decoded?.data).toBe(innerTransferData);
    expect(decoded?.operation).toBe('CALL');
    expect(decoded?.safeTxGas).toBe(0n);
    expect(decoded?.baseGas).toBe(0n);
    expect(decoded?.gasPrice).toBe(0n);
    expect(decoded?.gasToken).toBe(getAddress(GAS_TOKEN));
    expect(decoded?.refundReceiver).toBe(getAddress(REFUND_RECEIVER));
    expect(decoded?.signatures).toBe(`0x${'ab'.repeat(130)}`);
    expect(decoded?.signatureByteLength).toBe(130);
    expect(decoded?.approximateSignatureCount).toBe(2);
  });

  it('maps operation 1 to DELEGATECALL', () => {
    const decoded = decodeSafeExecTransaction(encodeExec({ operation: 1 }));
    expect(decoded?.operation).toBe('DELEGATECALL');
  });

  it('rejects an operation byte outside the Safe enum {0, 1}', () => {
    expect(decodeSafeExecTransaction(encodeExec({ operation: 2 }))).toBeNull();
  });

  it('returns null for a wrong selector', () => {
    const erc20Transfer = encodeFunctionData({
      abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
      args: [INNER_TARGET, 1n],
    });
    expect(erc20Transfer.slice(0, 10)).not.toBe('0x6a761202');
    expect(decodeSafeExecTransaction(erc20Transfer)).toBeNull();
  });

  it('returns null for calldata truncated inside the signatures blob', () => {
    // Tail truncation of the final dynamic bytes param: viem decodes this
    // leniently (fabricating the missing bytes) instead of throwing, so
    // the round-trip guard is what must catch it.
    const full = encodeExec();
    const tailTruncated = full.slice(0, full.length - 20);
    expect(decodeSafeExecTransaction(tailTruncated)).toBeNull();
  });

  it('returns null for calldata truncated inside the static head', () => {
    const headTruncated = encodeExec().slice(0, 74);
    expect(decodeSafeExecTransaction(headTruncated)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(decodeSafeExecTransaction('0x')).toBeNull();
    expect(decodeSafeExecTransaction('')).toBeNull();
    expect(decodeSafeExecTransaction(undefined)).toBeNull();
  });

  it('floors the signature-count estimate and handles an empty blob', () => {
    // 3×65 + 10 spare bytes: the count is honest about being an estimate.
    expect(
      decodeSafeExecTransaction(encodeExec({ signatures: `0x${'ab'.repeat(205)}` }))
        ?.approximateSignatureCount,
    ).toBe(3);
    // An empty signatures blob decodes fine — nothing was collected yet.
    const empty = decodeSafeExecTransaction(encodeExec({ signatures: '0x' }));
    expect(empty?.signatureByteLength).toBe(0);
    expect(empty?.approximateSignatureCount).toBe(0);
  });

  it('decodes a plain inner transfer (empty data) alongside nonzero gas fields', () => {
    const decoded = decodeSafeExecTransaction(
      encodeExec({ data: '0x', safeTxGas: 21_000n, baseGas: 100n, gasPrice: 5_000_000_000n }),
    );
    expect(decoded?.data).toBe('0x');
    expect(decoded?.safeTxGas).toBe(21_000n);
    expect(decoded?.baseGas).toBe(100n);
    expect(decoded?.gasPrice).toBe(5_000_000_000n);
  });
});

// The selector constant pinned against viem's own derivation, so a typo in
// the local fragment can never silently move the gate.
describe('execTransaction selector', () => {
  it('is keccak-derived from the canonical signature', () => {
    expect(
      toFunctionSelector(
        'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
      ),
    ).toBe('0x6a761202');
  });
});
